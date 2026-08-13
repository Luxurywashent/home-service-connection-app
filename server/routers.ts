import { z } from "zod";
import Stripe from "stripe";
import { TRPCError } from "@trpc/server";
import { triggerGhlSms } from "./_core/index";
import { COOKIE_NAME } from "../shared/const.js";
import { getSessionCookieOptions } from "./_core/cookies";
import { systemRouter } from "./_core/systemRouter";
import { aiRouter } from "./aiRouter";
import { publicProcedure, router } from "./_core/trpc";
import * as db from "./db";
import * as inv from "./inventoryDb";
import * as fin from "./financeDb";
import * as bank from "./bankStatementDb";
import * as customerDb from "./customerDb";
import { findOrCreateManualCustomer } from "./customerDb";
import * as fleetDb from "./fleetDb";
import * as investorDb from "./investorDb";
import * as jobSyncAuth from "./jobsyncAuth";
import { storagePut, storageGet } from "./storage";
import { sendEmail, buildNotificationEmail, buildBookingConfirmationEmail, buildAdminBookingAlertEmail, buildAdminBookingChangeEmail, buildOnTheWayEmail, buildLateArrivalEmail, buildInspectionReportEmail, buildReviewRequestEmail, getReviewLinkForCity, buildTipRequestEmail, buildPaymentReceiptEmail } from "./email";
import { ENV } from "./_core/env";
import { invokeLLM } from "./_core/llm";
import { sql, eq, or, like, and } from "drizzle-orm";

export const appRouter = router({
  system: systemRouter,
  ai: aiRouter,
  auth: router({
    me: publicProcedure.query((opts) => opts.ctx.user),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),

  jobsyncAuth: router({
    companyLogin: publicProcedure
      .input(z.object({ companyId: z.string().trim().min(1).max(32), email: z.string().trim().toLowerCase().email(), password: z.string().min(8).max(128) }))
      .mutation(async ({ input }) => {
        const session = await jobSyncAuth.loginJobSyncCompany(input);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid Company ID, email, or password." });
        return session;
      }),
    platformLogin: publicProcedure
      .input(z.object({ email: z.string().trim().toLowerCase().email(), password: z.string().min(8).max(128) }))
      .mutation(async ({ input }) => {
        const session = await jobSyncAuth.loginJobSyncPlatform(input);
        if (!session) throw new TRPCError({ code: "UNAUTHORIZED", message: "Invalid platform-admin email or password." });
        return session;
      }),
    me: publicProcedure
      .input(z.object({ token: z.string().min(1).max(4096) }))
      .query(({ input }) => jobSyncAuth.verifyJobSyncNativeSession(input.token)),
  }),

  employee: router({
    login: publicProcedure
      .input(z.object({ identifier: z.string().min(1), pin: z.string().min(4).max(6) }))
      .mutation(async ({ input }) => {
        const employee = await db.getEmployeeByLogin(input.identifier, input.pin);
        if (!employee) return { success: false as const, error: "Invalid credentials" };
        return {
          success: true as const,
          employee: {
            employeeId: employee.employeeId, fullName: employee.fullName, email: employee.email,
            role: employee.role, city: employee.city, hireDate: employee.hireDate,
            profilePhotoUrl: employee.profilePhotoUrl, phoneNumber: employee.phoneNumber,
            hourlyRate: null,
            upsellBonusPct: null,
          },
        };
      }),
    getById: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getEmployeeById(input.employeeId)),
    listAll: publicProcedure.query(async () => db.getAllActiveEmployees()),
    savePushToken: publicProcedure
      .input(z.object({ employeeId: z.string(), pushToken: z.string() }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error('DB unavailable');
        const { employees } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        await drizzleDb.update(employees).set({ pushToken: input.pushToken }).where(eq(employees.employeeId, input.employeeId));
        return { success: true as const };
      }),
    listDetailers: publicProcedure.query(async () => db.getAllDetailers()),
    resetPin: publicProcedure
      .input(z.object({ employeeId: z.string(), newPin: z.string().min(4).max(6) }))
      .mutation(async ({ input }) => { await db.updateEmployeePin(input.employeeId, input.newPin); return { success: true }; }),
    create: publicProcedure
      .input(z.object({
        employeeId: z.string().min(1),
        fullName: z.string().min(1),
        email: z.string().optional(),
        pin: z.string().min(4).max(6),
        role: z.enum(["detailer", "admin", "office", "operations_manager", "door_hanger_rep", "sales"]),
        city: z.string().optional(),
        phoneNumber: z.string().optional(),
        hireDate: z.string().optional(),
        shift: z.enum(["shift1", "shift2"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const existing = await db.getEmployeeById(input.employeeId);
        if (existing) return { success: false as const, error: "Team Member ID already exists" };
        const { shift, ...employeeData } = input;
        await db.createEmployee(employeeData);
        // If a shift was specified (detailer), create a placeholder van assignment so the calendar knows their shift
        if (shift && input.role === "detailer") {
          const dbConn = await db.getDb();
          if (dbConn) {
            await dbConn.execute(
              sql`INSERT INTO employee_van_assignments (employee_id, van_id, van_name, shift, assigned_by) VALUES (${input.employeeId}, ${'unassigned'}, ${'Unassigned'}, ${shift}, ${'Admin'}) ON DUPLICATE KEY UPDATE shift = VALUES(shift)`
            ).catch(() => { /* ignore if table structure differs */ });
          }
        }
        // Send welcome email if the new team member has an email address
        if (input.email) {
          try {
            const { sendEmail, buildTeamMemberWelcomeEmail } = await import('./email');
            const welcomeEmail = buildTeamMemberWelcomeEmail({
              fullName: input.fullName,
              employeeId: input.employeeId,
              pin: input.pin,
              role: input.role,
              hireDate: input.hireDate,
              city: input.city,
            });
            await sendEmail({
              to: input.email,
              subject: welcomeEmail.subject,
              html: welcomeEmail.html,
              type: 'other',
              urgent: true, // bypass quiet hours — credentials should arrive immediately
              customerName: input.fullName,
            });
          } catch (emailErr) {
            console.error('[employees.create] Welcome email error:', emailErr);
            // Non-fatal — account was created successfully even if email fails
          }
        }
        return { success: true as const };
      }),
    update: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string().optional(),
        email: z.string().nullable().optional(),
        phoneNumber: z.string().nullable().optional(),
        city: z.string().nullable().optional(),
        role: z.enum(["detailer", "admin", "office", "operations_manager", "door_hanger_rep", "sales"]).optional(),
        pin: z.string().min(4).max(6).optional(),
        hourlyRate: z.number().min(0).max(999).nullable().optional(),
        upsellBonusPct: z.number().min(0).max(100).nullable().optional(),
        shiftStartHour: z.number().min(0).max(24).nullable().optional(),
        shiftEndHour: z.number().min(0).max(24).nullable().optional(),
        shift: z.enum(["shift1", "shift2"]).optional(),
        customWorkDays: z.string().nullable().optional(), // comma-separated day numbers: 0=Sun..6=Sat
      }))
      .mutation(async ({ input }) => {
        const { employeeId, ...data } = input;
        await db.updateEmployee(employeeId, data);
        return { success: true };
      }),
    resendWelcomeEmail: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .mutation(async ({ input }) => {
        const emp = await db.getEmployeeById(input.employeeId);
        if (!emp) return { success: false as const, error: 'Team member not found' };
        if (!emp.email) return { success: false as const, error: 'No email address on file' };
        try {
          const { sendEmail, buildTeamMemberWelcomeEmail } = await import('./email');
          const welcomeEmail = buildTeamMemberWelcomeEmail({
            fullName: emp.fullName,
            employeeId: emp.employeeId,
            pin: emp.pin,
            role: emp.role,
            hireDate: emp.hireDate ?? undefined,
            city: emp.city ?? undefined,
          });
          await sendEmail({
            to: emp.email,
            subject: welcomeEmail.subject,
            html: welcomeEmail.html,
            type: 'other',
            urgent: true,
            customerName: emp.fullName,
          });
          return { success: true as const };
        } catch (err: any) {
          console.error('[employee.resendWelcomeEmail] Error:', err);
          return { success: false as const, error: err?.message ?? 'Email send failed' };
        }
      }),
    deactivate: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deactivateEmployee(input.employeeId);
        // Remove from live map tracking
        await db.deactivateDetailerLocation(input.employeeId);
        return { success: true };
      }),
    deactivateWithJobs: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .mutation(async ({ input }) => {
        // Get all future/active jobs for this employee before deactivating
        const jobs = await db.getActiveJobsForEmployee(input.employeeId);
        // Auto-unassign ALL their jobs so they move to the Unassigned column
        for (const job of jobs) {
          await db.unassignJob(job.jobId);
        }
        await db.deactivateEmployee(input.employeeId);
        // Remove from live map tracking
        await db.deactivateDetailerLocation(input.employeeId);
        return { success: true, jobs };
      }),
    transferJob: publicProcedure
      .input(z.object({
        jobId: z.string(),
        toEmployeeId: z.string(),
        toEmployeeName: z.string(),
        toEmployeePhone: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.reassignJob(input.jobId, input.toEmployeeId, input.toEmployeeName);
        // Send push notification to the new detailer
        await db.sendJobTransferNotification(input.toEmployeeId, input.toEmployeeName, input.jobId);
        return { success: true };
      }),
    unassignJob: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .mutation(async ({ input }) => {
        await db.unassignJob(input.jobId);
        return { success: true };
      }),
    /** Change a detailer's city and unassign all their active/future jobs so nothing is lost. */
    changeCityWithJobUnassign: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        newCity: z.string(),
      }))
      .mutation(async ({ input }) => {
        const jobs = await db.getActiveJobsForEmployee(input.employeeId);
        for (const job of jobs) {
          await db.unassignJob(job.jobId);
        }
        await db.updateEmployee(input.employeeId, { city: input.newCity });
        return { success: true, unassignedCount: jobs.length };
      }),
    listDeactivated: publicProcedure.query(async () => db.getDeactivatedEmployees()),
    reactivate: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .mutation(async ({ input }) => {
        await db.reactivateEmployee(input.employeeId);
        // Restore detailer to city calendar by re-inserting a neutral location record
        const emp = await db.getEmployeeById(input.employeeId);
        if (emp && emp.role === "detailer" && emp.city) {
          // Use city center coordinates as placeholder until they clock in
          const CITY_COORDS: Record<string, { lat: string; lng: string }> = {
            "Niceville": { lat: "30.5180", lng: "-86.4860" },
            "Crestview": { lat: "30.7460", lng: "-86.5710" },
            "Destin": { lat: "30.3935", lng: "-86.4958" },
            "Fort Walton Beach": { lat: "30.4058", lng: "-86.6188" },
            "Pensacola": { lat: "30.4213", lng: "-87.2169" },
          };
          const coords = CITY_COORDS[emp.city] ?? { lat: "30.5180", lng: "-86.4860" };
          await db.upsertDetailerLocation({
            employeeId: emp.employeeId,
            fullName: emp.fullName,
            lat: coords.lat,
            lng: coords.lng,
            status: "inactive",
            updatedAt: new Date(),
          });
        }
        return { success: true };
      }),
    getUnassignedJobs: publicProcedure
      .input(z.object({ city: z.string().optional() }))
      .query(async ({ input }) => db.getUnassignedJobs(input.city)),
    getAvailableDetailersForSlot: publicProcedure
      .input(z.object({ date: z.string(), startHour: z.number(), endHour: z.number(), city: z.string() }))
      .query(async ({ input }) => db.getAvailableDetailersForSlot(input.date, input.startHour, input.endHour, input.city)),
    getShiftCoverage: publicProcedure
      .input(z.object({ weekStartDate: z.string(), city: z.string() }))
      .query(async ({ input }) => db.getShiftCoverageForWeek(input.weekStartDate, input.city)),
    getAvailableSlots: publicProcedure
      .input(z.object({ date: z.string(), city: z.string(), packageName: z.string() }))
      .query(async ({ input }) => {
        const SLOTS: Record<string, { label: string; startHour: number; endHour: number }[]> = {
          "Basic Detail":    [ { label: "8:00 AM – 10:00 AM", startHour: 8, endHour: 10 }, { label: "10:00 AM – 12:00 PM", startHour: 10, endHour: 12 }, { label: "1:00 PM – 3:00 PM", startHour: 13, endHour: 15 }, { label: "3:00 PM – 5:00 PM", startHour: 15, endHour: 17 } ],
          "Interior Detail": [ { label: "8:00 AM – 10:00 AM", startHour: 8, endHour: 10 }, { label: "10:00 AM – 12:00 PM", startHour: 10, endHour: 12 }, { label: "1:00 PM – 3:00 PM", startHour: 13, endHour: 15 }, { label: "3:00 PM – 5:00 PM", startHour: 15, endHour: 17 } ],
          "Exterior Detail": [ { label: "8:00 AM – 10:00 AM", startHour: 8, endHour: 10 }, { label: "10:00 AM – 12:00 PM", startHour: 10, endHour: 12 }, { label: "1:00 PM – 3:00 PM", startHour: 13, endHour: 15 }, { label: "3:00 PM – 5:00 PM", startHour: 15, endHour: 17 } ],
          "Full Detail":     [ { label: "8:00 AM – 11:00 AM", startHour: 8, endHour: 11 }, { label: "11:00 AM – 2:00 PM", startHour: 11, endHour: 14 }, { label: "2:00 PM – 5:00 PM", startHour: 14, endHour: 17 } ],
          "Luxury Detail":   [ { label: "8:00 AM – 12:00 PM", startHour: 8, endHour: 12 }, { label: "1:00 PM – 5:00 PM", startHour: 13, endHour: 17 } ],
        };
        const slots = SLOTS[input.packageName] ?? SLOTS["Basic Detail"];

        // 2-hour lead time: for same-day requests, mark slots too soon as unavailable
        const todayCSTStr = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Chicago',
          year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(new Date());
        const isToday = input.date === todayCSTStr;
        let nowCSTDecimal = 0;
        if (isToday) {
          const parts = new Intl.DateTimeFormat('en-US', {
            timeZone: 'America/Chicago',
            hour: 'numeric', minute: 'numeric', hour12: false,
          }).formatToParts(new Date());
          const h = parseInt(parts.find(p => p.type === 'hour')?.value ?? '0', 10);
          const m = parseInt(parts.find(p => p.type === 'minute')?.value ?? '0', 10);
          nowCSTDecimal = h + m / 60;
        }

        const results = await Promise.all(
          slots.map(async (slot) => {
            // Block same-day slots that start within 2 hours of now
            if (isToday && slot.startHour < nowCSTDecimal + 2) {
              return { ...slot, available: false, detailerCount: 0 };
            }
            const available = await db.getAvailableDetailersForSlot(input.date, slot.startHour, slot.endHour, input.city);
            return { ...slot, available: available.length > 0, detailerCount: available.length };
          })
        );
        return results;
      }),
    getAvailableDates: publicProcedure
      .input(z.object({ city: z.string(), daysAhead: z.number().optional() }))
      .query(async ({ input }) => db.getAvailableDates(input.city, input.daysAhead ?? 90)),
    seed: publicProcedure.mutation(async () => {
      const result = await db.seedDemoData();
      await db.seedDoorHangerData();
      await db.seedTrainingData();
      await db.seedChallengeData();
      return result;
    }),
  }),

  performance: router({
    getByDate: publicProcedure
      .input(z.object({ employeeId: z.string(), date: z.string() }))
      .query(async ({ input }) => db.getPerformanceByDate(input.employeeId, input.date)),
    getDateRange: publicProcedure
      .input(z.object({ employeeId: z.string(), startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) => db.getPerformanceDateRange(input.employeeId, input.startDate, input.endDate)),
    getAllByDate: publicProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input }) => db.getAllPerformanceByDate(input.date)),
    getAllDateRange: publicProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) => db.getAllPerformanceDateRange(input.startDate, input.endDate)),
    getHistory: publicProcedure
      .input(z.object({ employeeId: z.string(), limit: z.number().optional() }))
      .query(async ({ input }) => db.getPerformanceHistory(input.employeeId, input.limit)),
    upsert: publicProcedure
      .input(z.object({
        recordId: z.string(), date: z.string(), employeeId: z.string(),
        fullName: z.string().optional(), city: z.string().optional(),
        hoursWorked: z.string().optional(), revenueProduced: z.string().optional(),
        efficiencyPercent: z.string().optional(), upsells: z.string().optional(),
        tips: z.string().optional(),
        createdBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await db.upsertPerformance(input); return { success: true }; }),
    // Admin: re-sync all performance records for a date range from actual job data
    resyncDateRange: publicProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .mutation(async ({ input }) => {
        const count = await db.resyncPerformanceForDateRange(input.startDate, input.endDate);
        return { success: true, count };
      }),

    /** Weekly Detailer Leaderboard — aggregates revenue, referrals for the current or specified week */
    weeklyDetailerLeaderboard: publicProcedure
      .input(z.object({
        startDate: z.string().optional(), // YYYY-MM-DD, defaults to current week Monday
        endDate: z.string().optional(),   // YYYY-MM-DD, defaults to current week Sunday
      }))
      .query(async ({ input }) => {
        // Compute week bounds (Mon–Sun, America/Chicago)
        const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
        const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon
        const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
        const monday = new Date(now);
        monday.setDate(now.getDate() + diffToMon);
        const sunday = new Date(monday);
        sunday.setDate(monday.getDate() + 6);
        const fmt = (d: Date) => d.toISOString().slice(0, 10);
        const startDate = input.startDate ?? fmt(monday);
        const endDate = input.endDate ?? fmt(sunday);

        // 1. Get all active detailers
        const detailers = await db.getAllDetailers();
        const ALLOWED = ["casey", "lamont", "michael", "cameron", "gabe", "giovanni"];
        const filtered = detailers.filter(d =>
          ALLOWED.some(n => d.fullName.toLowerCase().includes(n))
        );

        // 2. Get daily performance rows for the week
        const perfRows = await db.getAllPerformanceDateRange(startDate, endDate);

        // 3. Get referrals submitted this week
        const { salesCallbacks } = await import("../drizzle/schema.js");
        const { and: dbAnd, gte: dbGte, lte: dbLte, eq: dbEq } = await import("drizzle-orm");
        const dbConn = await (db as any).getDb?.() ?? null;

        let referralRows: Array<{ referredBy: string | null }> = [];
        try {
          const { getDb } = await import("./db.js");
          const conn = await getDb();
          if (conn) {
            referralRows = await conn
              .select({ referredBy: salesCallbacks.referredBy })
              .from(salesCallbacks)
              .where(dbAnd(
                dbEq(salesCallbacks.source, "detailer_referral" as any),
                dbGte(salesCallbacks.createdAt, new Date(startDate + "T00:00:00")),
                dbLte(salesCallbacks.createdAt, new Date(endDate + "T23:59:59")),
              ));
          }
        } catch (_e) { /* non-blocking */ }

        // 4. Aggregate per detailer
        const referralMap: Record<string, number> = {};
        for (const r of referralRows) {
          if (r.referredBy) referralMap[r.referredBy] = (referralMap[r.referredBy] ?? 0) + 1;
        }

        const leaderboard = filtered.map(d => {
          const rows = perfRows.filter(p => p.employeeId === d.employeeId);
          const revenue = rows.reduce((s, r) => s + parseFloat(r.revenueProduced ?? "0"), 0);
          const upsells = rows.reduce((s, r) => s + parseFloat(r.upsells ?? "0"), 0);
          const tips = rows.reduce((s, r) => s + parseFloat(r.tips ?? "0"), 0);
          const referrals = referralMap[d.employeeId] ?? 0;
          return {
            employeeId: d.employeeId,
            fullName: d.fullName,
            profilePhotoUrl: d.profilePhotoUrl ?? null,
            revenue: parseFloat(revenue.toFixed(2)),
            upsells: parseFloat(upsells.toFixed(2)),
            tips: parseFloat(tips.toFixed(2)),
            referrals,
            // Composite score: revenue (1pt per $) + referrals (200pt each) + upsells (1pt per $)
            score: Math.round(revenue + upsells + referrals * 200),
          };
        });

        leaderboard.sort((a, b) => b.score - a.score);
        return { leaderboard, startDate, endDate };
      }),
  }),

  notifications: router({
    getForEmployee: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getNotificationsForEmployee(input.employeeId)),
    getById: publicProcedure
      .input(z.object({ notificationId: z.string() }))
      .query(async ({ input }) => db.getNotificationById(input.notificationId)),
    getAll: publicProcedure.query(async () => db.getAllNotifications()),
    getUnacknowledgedCritical: publicProcedure.query(async () => db.getUnacknowledgedCriticalNotifications()),
    create: publicProcedure
      .input(z.object({
        notificationId: z.string(), employeeId: z.string(), fullName: z.string().optional(),
        notificationType: z.enum(["qc_issue", "write_up", "missed_step", "coaching_note", "time_off_update", "company_announcement", "clock_alert", "clock_check_5pm"]),
        title: z.string(), message: z.string().optional(), createdBy: z.string().optional(),
        requiresAcknowledgment: z.enum(["yes", "no"]).default("no"),
        sendEmail: z.boolean().optional().default(false),
      }))
      .mutation(async ({ input }) => {
        await db.createNotification(input);
        // Optionally send a Gmail email to the team member
        if (input.sendEmail) {
          try {
            const emp = await db.getEmployeeById(input.employeeId);
            const recipientEmail = emp?.email;
            if (recipientEmail) {
              const { subject, html } = buildNotificationEmail({
                recipientName: input.fullName ?? emp?.fullName ?? "Team Member",
                notificationType: input.notificationType,
                title: input.title,
                message: input.message,
                requiresAcknowledgment: input.requiresAcknowledgment === "yes",
                createdBy: input.createdBy,
              });
              await sendEmail({
                to: recipientEmail,
                subject,
                html,
                type: "notification",
                customerName: input.fullName ?? emp?.fullName,
              });
            } else {
              console.warn(`[Email] No email address on file for employee ${input.employeeId} — skipping email.`);
            }
          } catch (emailErr) {
            console.error("[Email] Error sending notification email:", emailErr);
          }
        }
        return { success: true };
      }),
    markRead: publicProcedure
      .input(z.object({ notificationId: z.string(), employeeId: z.string() }))
      .mutation(async ({ input }) => {
        await db.markNotificationRead(input.notificationId);
        await db.createReadLog({ logId: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, notificationId: input.notificationId, employeeId: input.employeeId, actionType: "read" });
        return { success: true };
      }),
    markAcknowledged: publicProcedure
      .input(z.object({ notificationId: z.string(), employeeId: z.string() }))
      .mutation(async ({ input }) => {
        await db.markNotificationAcknowledged(input.notificationId);
        await db.createReadLog({ logId: `LOG-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`, notificationId: input.notificationId, employeeId: input.employeeId, actionType: "acknowledged" });
        return { success: true };
      }),
    markAllRead: publicProcedure
      .mutation(async () => {
        await db.markAllNotificationsRead();
        return { success: true };
      }),
  }),

  timeOff: router({
    getForEmployee: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getTimeOffRequestsForEmployee(input.employeeId)),
    getAll: publicProcedure.query(async () => db.getAllTimeOffRequests()),
    getByStatus: publicProcedure
      .input(z.object({ status: z.enum(["pending", "approved", "denied"]) }))
      .query(async ({ input }) => db.getTimeOffRequestsByStatus(input.status)),
    getPendingCount: publicProcedure.query(async () => db.getPendingTimeOffCount()),
    create: publicProcedure
      .input(z.object({
        requestId: z.string(), employeeId: z.string(), fullName: z.string().optional(),
        startDate: z.string(), endDate: z.string(), totalDaysRequested: z.number(),
        daysNoticeGiven: z.number(), reason: z.string().optional(),
        policyValid: z.enum(["yes", "no"]), policyMessage: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await db.createTimeOffRequest(input); return { success: true }; }),
    updateStatus: publicProcedure
      .input(z.object({
        requestId: z.string(), status: z.enum(["approved", "denied"]),
        decidedBy: z.string(), managerNote: z.string().optional(),
        employeeId: z.string(), employeeName: z.string().optional(),
        startDate: z.string().optional(), endDate: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateTimeOffRequestStatus(input.requestId, input.status, input.decidedBy, input.managerNote);
        const notifId = `NOTIF-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        await db.createNotification({
          notificationId: notifId, employeeId: input.employeeId, fullName: input.employeeName,
          notificationType: "time_off_update",
          title: `Time Off Request ${input.status === "approved" ? "Approved" : "Denied"}`,
          message: input.managerNote ? `Your time off request has been ${input.status}. Manager note: ${input.managerNote}` : `Your time off request has been ${input.status}.`,
          createdBy: input.decidedBy, requiresAcknowledgment: "no",
        });

        // Auto-create schedule blockers for each approved day
        if (input.status === "approved") {
          try {
            // Fetch the time off request to get startDate/endDate if not passed
            const drizzleDb = await db.getDb();
            if (!drizzleDb) throw new Error('DB unavailable');

            // Get startDate/endDate — prefer passed values, fall back to DB lookup
            let startDate = input.startDate;
            let endDate = input.endDate;
            if (!startDate || !endDate) {
              const { timeOffRequests: torTable } = await import('../drizzle/schema');
              const rows = await drizzleDb.select({ startDate: torTable.startDate, endDate: torTable.endDate })
                .from(torTable).where(eq(torTable.requestId, input.requestId)).limit(1);
              startDate = rows[0]?.startDate;
              endDate = rows[0]?.endDate;
            }
            if (!startDate || !endDate) throw new Error('Missing dates');

            // Look up the employee's city and full name
            const emp = await db.getEmployeeById(input.employeeId);
            const detailerName = emp?.fullName ?? input.employeeName ?? input.employeeId;
            const city = emp?.city ?? 'Crestview';

            // Normalize city slug → full label
            const CITY_SLUG_TO_LABEL: Record<string, string> = {
              fwb: 'Fort Walton Beach',
              crestview: 'Crestview',
              niceville: 'Niceville',
              destin: 'Destin',
              pensacola: 'Pensacola',
            };
            const normalizedCity = CITY_SLUG_TO_LABEL[city.toLowerCase()] ?? city;

            // Loop through each day from startDate to endDate and create a blocker
            const { scheduleBlockers } = await import('../drizzle/schema');
            const start = new Date(startDate + 'T12:00:00Z');
            const end = new Date(endDate + 'T12:00:00Z');
            const current = new Date(start);
            while (current <= end) {
              const dateStr = current.toISOString().substring(0, 10);
              const blockerId = `TIMEOFF-${input.requestId}-${dateStr}`;
              // Skip if blocker already exists (idempotent)
              const existing = await drizzleDb.select({ id: scheduleBlockers.id })
                .from(scheduleBlockers).where(eq(scheduleBlockers.id, blockerId)).limit(1);
              if (existing.length === 0) {
                await drizzleDb.insert(scheduleBlockers).values({
                  id: blockerId,
                  detailerName,
                  city: normalizedCity,
                  date: dateStr,
                  startHour: '8',
                  endHour: '17',
                  allDay: 1,
                  reason: 'Time Off',
                  createdBy: input.decidedBy ?? null,
                });
              }
              current.setUTCDate(current.getUTCDate() + 1);
            }
          } catch (e) {
            console.error('[timeOff] Failed to create schedule blockers:', e);
            // Don't throw — approval still succeeds even if blocker creation fails
          }
        }

        return { success: true };
      }),
  }),

  alerts: router({
    getSummary: publicProcedure.query(async () => {
      const pendingTimeOff = await db.getPendingTimeOffCount();
      const unacknowledged = await db.getUnacknowledgedCriticalNotifications();
      return { pendingTimeOffCount: pendingTimeOff, unacknowledgedCount: unacknowledged.length, unacknowledgedNotifications: unacknowledged };
    }),
  }),

  challenge: router({
    getAll: publicProcedure.query(async () => db.getAllChallenges()),
    getActive: publicProcedure.query(async () => db.getActiveChallenge()),
    getById: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(async ({ input }) => db.getChallengeById(input.challengeId)),
    create: publicProcedure
      .input(z.object({
        challengeId: z.string(),
        title: z.string().min(1),
        prizeName: z.string().optional(),
        prizeEmoji: z.string().optional(),
        isActive: z.enum(["yes", "no"]).optional(),
        expiresAt: z.string().optional().nullable(),
        createdBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await db.createChallenge(input); return { success: true }; }),
    update: publicProcedure
      .input(z.object({
        challengeId: z.string(),
        title: z.string().optional(),
        prizeName: z.string().optional().nullable(),
        prizeEmoji: z.string().optional().nullable(),
        isActive: z.enum(["yes", "no"]).optional(),
        expiresAt: z.string().optional().nullable(),
      }))
      .mutation(async ({ input }) => {
        const { challengeId, ...data } = input;
        await db.updateChallenge(challengeId, data as any);
        return { success: true };
      }),
    delete: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .mutation(async ({ input }) => { await db.deleteChallenge(input.challengeId); return { success: true }; }),
  }),

  quiz: router({
    getAll: publicProcedure.query(async () => db.getAllQuizQuestions()),
    getForChallenge: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(async ({ input }) => db.getQuestionsForChallenge(input.challengeId)),
    getCount: publicProcedure.query(async () => db.getQuizQuestionCount()),
    create: publicProcedure
      .input(z.object({
        questionId: z.string(),
        challengeId: z.string(),
        orderIndex: z.number(),
        questionText: z.string().min(1),
        optionA: z.string().min(1),
        optionB: z.string().min(1),
        optionC: z.string().min(1),
        optionD: z.string().optional(),
        correctAnswer: z.enum(["A", "B", "C", "D"]),
        explanationCorrect: z.string().optional(),
        explanationIncorrect: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await db.createQuizQuestion(input as any); return { success: true }; }),
    update: publicProcedure
      .input(z.object({
        questionId: z.string(),
        questionText: z.string().optional(),
        optionA: z.string().optional(),
        optionB: z.string().optional(),
        optionC: z.string().optional(),
        optionD: z.string().optional().nullable(),
        correctAnswer: z.enum(["A", "B", "C", "D"]).optional(),
        explanationCorrect: z.string().optional().nullable(),
        explanationIncorrect: z.string().optional().nullable(),
        orderIndex: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const { questionId, ...data } = input;
        await db.updateTrainingQuizQuestion(questionId, data as any);
        return { success: true };
      }),
    delete: publicProcedure
      .input(z.object({ questionId: z.string() }))
      .mutation(async ({ input }) => { await db.deleteTrainingQuizQuestion(input.questionId); return { success: true }; }),
  }),

  mysteryBonus: router({
    getChallenge: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => {
        const activeChallenge = await db.getActiveChallenge();
        if (!activeChallenge) return { hasChallenge: false as const };
        const today = db.todayCST();
        // Check expiration
        if (activeChallenge.expiresAt && today > activeChallenge.expiresAt) {
          return { hasChallenge: false as const, expired: true };
        }
        // Get all questions for this challenge
        const questions = await db.getQuestionsForChallenge(activeChallenge.challengeId);
        if (questions.length === 0) return { hasChallenge: false as const };
        // Find the next unanswered question for this employee
        let allCorrect = true;
        let nextQuestion = null;
        let answeredCount = 0;
        let failedQuestionId: string | null = null;
        for (const q of questions) {
          const attempt = await db.getAttemptForQuestion(input.employeeId, q.questionId);
          if (attempt) {
            answeredCount++;
            if (attempt.attemptResult === "incorrect") {
              allCorrect = false;
              failedQuestionId = q.questionId;
              break; // Failed - challenge over
            }
          } else {
            if (!nextQuestion) nextQuestion = q;
            break;
          }
        }
        // If they failed any question, challenge is over
        if (failedQuestionId) {
          return {
            hasChallenge: true as const,
            alreadyAttempted: true,
            attemptResult: "incorrect" as const,
            challengeTitle: activeChallenge.title,
            totalQuestions: questions.length,
            answeredCount,
            expiresAt: activeChallenge.expiresAt,
            prizeName: activeChallenge.prizeName,
            prizeEmoji: activeChallenge.prizeEmoji,
          };
        }
        // If all questions answered correctly
        if (answeredCount === questions.length && allCorrect) {
          return {
            hasChallenge: true as const,
            alreadyAttempted: true,
            attemptResult: "correct" as const,
            challengeTitle: activeChallenge.title,
            totalQuestions: questions.length,
            answeredCount,
            expiresAt: activeChallenge.expiresAt,
            prizeName: activeChallenge.prizeName,
            prizeEmoji: activeChallenge.prizeEmoji,
          };
        }
        // There's a next question to answer
        return {
          hasChallenge: true as const,
          alreadyAttempted: false,
          challengeTitle: activeChallenge.title,
          totalQuestions: questions.length,
          answeredCount,
          expiresAt: activeChallenge.expiresAt,
          prizeName: activeChallenge.prizeName,
          prizeEmoji: activeChallenge.prizeEmoji,
          question: nextQuestion ? {
            questionId: nextQuestion.questionId,
            questionText: nextQuestion.questionText,
            optionA: nextQuestion.optionA,
            optionB: nextQuestion.optionB,
            optionC: nextQuestion.optionC,
            optionD: nextQuestion.optionD,
          } : null,
        };
      }),
    submitAnswer: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        questionId: z.string(),
        answer: z.enum(["A", "B", "C", "D"]),
      }))
      .mutation(async ({ input }) => {
        const today = db.todayCST();
        // Check if already attempted
        const alreadyAttempted = await db.hasAttemptedQuestion(input.employeeId, input.questionId);
        if (alreadyAttempted) return { success: false as const, error: "Already attempted" };
        const questions = await db.getAllQuizQuestions();
        const question = questions.find(q => q.questionId === input.questionId);
        if (!question) return { success: false as const, error: "Question not found" };
        const isCorrect = input.answer === question.correctAnswer;
        // Record attempt
        await db.recordProgression({
          employeeId: input.employeeId,
          questionId: input.questionId,
          attemptResult: isCorrect ? "correct" : "incorrect",
          completedDate: today,
        });
        if (isCorrect) {
          return {
            success: true as const,
            correct: true,
            explanationCorrect: question.explanationCorrect,
          };
        } else {
          return {
            success: true as const,
            correct: false,
            correctAnswer: question.correctAnswer,
            explanationIncorrect: question.explanationIncorrect,
          };
        }
      }),
    getAttemptSummary: publicProcedure
      .input(z.object({ challengeId: z.string() }))
      .query(async ({ input }) => {
        const questions = await db.getQuestionsForChallenge(input.challengeId);
        const allAttempts: Array<{ employeeId: string; questionId: string; attemptResult: string; completedDate: string }> = [];
        for (const q of questions) {
          const attempts = await db.getAttemptSummaryForQuestion(q.questionId);
          allAttempts.push(...attempts);
        }
        return { questions: questions.length, attempts: allAttempts };
      }),
    getAllSummary: publicProcedure.query(async () => db.getAllProgressionSummary()),
    reset: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .mutation(async ({ input }) => { await db.resetEmployeeProgression(input.employeeId); return { success: true }; }),
    initializeChallenge: publicProcedure
      .mutation(async () => {
        const activeChallenge = await db.getActiveChallenge();
        if (activeChallenge) return { success: true, alreadyExists: true };
        
        const tomorrow = new Date();
        tomorrow.setDate(tomorrow.getDate() + 1);
        const expiresAt = new Intl.DateTimeFormat('en-CA', {
          timeZone: 'America/Chicago',
          year: 'numeric', month: '2-digit', day: '2-digit',
        }).format(tomorrow);
        

        
        const challengeId = `challenge_${Date.now()}`;
        await db.createChallenge({
          challengeId,
          title: "Weekly Bonus Challenge",
          isActive: "yes",
          createdAt: new Date(),
          expiresAt,
          prizeName: "Mystery Bonus",
          prizeEmoji: "🎁",
        });
        
        const q1: any = {
          questionId: `q_${Date.now()}_1`,
          challengeId,
          questionText: "What is the most important step in detailing?",
          optionA: "Speed",
          optionB: "Attention to detail",
          optionC: "Using expensive products",
          optionD: "Working alone",
          correctAnswer: "B",
          explanationCorrect: "Correct! Attention to detail is what makes a great detailer.",
          explanationIncorrect: "Attention to detail is the most important factor in quality detailing.",
          orderIndex: 0,
        };
        
        const q2: any = {
          questionId: `q_${Date.now()}_2`,
          challengeId,
          questionText: "What's the key to customer satisfaction?",
          optionA: "Low prices",
          optionB: "Fast service",
          optionC: "Exceeding expectations",
          optionD: "Using social media",
          correctAnswer: "C",
          explanationCorrect: "Excellent! Exceeding customer expectations builds loyalty.",
          explanationIncorrect: "Exceeding customer expectations is the key to satisfaction and loyalty.",
          orderIndex: 1,
        };
        
        await db.createQuestion(q1);
        await db.createQuestion(q2);
        
        return { success: true, alreadyExists: false, challengeId };
      }),
  }),

  doorHanger: router({
    createEntry: publicProcedure
      .input(z.object({ employeeId: z.string(), date: z.string(), address: z.string(), city: z.string(), outreachType: z.enum(["door_hangers", "business_cards", "yard_signs", "table_toppers"]), quantityDistributed: z.number().int().positive(), notes: z.string().optional(), photoUrls: z.array(z.string()).optional(), latitude: z.number().optional(), longitude: z.number().optional() }))
      .mutation(async ({ input }) => {
        const entryId = `DHE_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const { photoUrls, ...entryData } = input;
        const photoUrlsJson = photoUrls && photoUrls.length > 0 ? JSON.stringify(photoUrls) : null;
        await db.createDoorHangerEntry({ entryId, ...entryData, photoUrls: photoUrlsJson });
        return { success: true, entryId };
      }),
    getEntries: publicProcedure
      .input(z.object({ employeeId: z.string(), dateFrom: z.string().optional(), dateTo: z.string().optional() }))
      .query(async ({ input }) => db.getDoorHangerEntries(input.employeeId, input.dateFrom, input.dateTo)),
    getStats: publicProcedure
      .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }))
      .query(async ({ input }) => db.getDoorHangerStats(input.dateFrom, input.dateTo)),
    getAllEntries: publicProcedure
      .input(z.object({ dateFrom: z.string().optional(), dateTo: z.string().optional() }))
      .query(async ({ input }) => db.getAllDoorHangerEntries(input.dateFrom, input.dateTo)),
    uploadPhoto: publicProcedure
      .input(z.object({
        base64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        employeeId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const ext = input.mimeType === "image/png" ? "png" : "jpg";
        const suffix = Math.random().toString(36).substr(2, 8);
        const key = `door-hanger-photos/${input.employeeId}/${Date.now()}_${suffix}.${ext}`;
        const buffer = Buffer.from(input.base64, "base64");
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { success: true as const, url };
      }),
    deleteEntry: publicProcedure
      .input(z.object({ entryId: z.string() }))
      .mutation(async ({ input }) => { await db.deleteDoorHangerEntry(input.entryId); return { success: true }; }),
    updateEntry: publicProcedure
      .input(z.object({ entryId: z.string(), address: z.string().optional(), city: z.string().optional(), outreachType: z.enum(["door_hangers", "business_cards", "yard_signs", "table_toppers"]).optional(), notes: z.string().nullable().optional() }))
      .mutation(async ({ input }) => { const { entryId, ...updates } = input; await db.updateDoorHangerEntry(entryId, updates); return { success: true }; }),
    getGoals: publicProcedure.query(async () => db.getDoorHangerGoals()),
    updateGoals: publicProcedure
      .input(z.object({ dailyDoorHangerGoal: z.number().int().positive(), dailyBusinessCardGoal: z.number().int().positive(), dailyYardSignGoal: z.number().int().positive(), dailyTableTopperGoal: z.number().int().positive(), updatedBy: z.string() }))
      .mutation(async ({ input }) => {
        await db.updateDoorHangerGoals(input.dailyDoorHangerGoal, input.dailyBusinessCardGoal, input.dailyYardSignGoal, input.dailyTableTopperGoal, input.updatedBy);
        return { success: true };
      }),
    getCityAvailability: publicProcedure.query(async () => db.getCityAvailabilityForNextWeek()),
    getSuggestedCity: publicProcedure.query(async () => db.getSuggestedCityForDoorHangers()),
    getWeeklyEarnings: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getWeeklyDoorHangerEarnings(input.employeeId)),
    upsertWeeklyEarnings: publicProcedure
      .input(z.object({ employeeId: z.string(), fullName: z.string(), photoCount: z.number().int().nonnegative() }))
      .mutation(async ({ input }) => {
        await db.upsertDoorHangerEarnings(input.employeeId, input.fullName, input.photoCount);
        return { success: true };
      }),
  }),

  training: router({
    getAllModules: publicProcedure.query(async () => db.getAllTrainingModules()),
    getModuleById: publicProcedure
      .input(z.object({ moduleId: z.string() }))
      .query(async ({ input }) => db.getTrainingModuleById(input.moduleId)),
    // Look up a training module by its interactive moduleKey (e.g. "carpet-cleaning-mpd2vek8")
    // Used by [moduleId].tsx for admin-created modules whose URL segment is the moduleKey
    getModuleByKey: publicProcedure
      .input(z.object({ moduleKey: z.string() }))
      .query(async ({ input }) => db.getTrainingModuleByKey(input.moduleKey)),
    createModule: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        icon: z.string().optional(),
        videoUrl: z.string().optional().nullable(),
        quizTitle: z.string().optional().nullable(),
        orderIndex: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const moduleId = `TM_CUSTOM_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
        const allModules = await db.getAllTrainingModules();
        const nextOrder = input.orderIndex ?? allModules.length;
        await db.createTrainingModule({
          moduleId,
          name: input.name,
          description: input.description ?? null,
          icon: input.icon ?? null,
          videoUrl: input.videoUrl ?? null,
          quizTitle: input.quizTitle ?? null,
          orderIndex: nextOrder,
        });
        return { success: true, moduleId };
      }),
    deleteModule: publicProcedure
      .input(z.object({ moduleId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteTrainingModule(input.moduleId);
        return { success: true };
      }),
    reorderModules: publicProcedure
      .input(z.object({ orderedIds: z.array(z.string()) }))
      .mutation(async ({ input }) => {
        await db.reorderTrainingModules(input.orderedIds);
        return { success: true };
      }),
    reorderSteps: publicProcedure
      .input(z.object({ orderedStepIds: z.array(z.string()) }))
      .mutation(async ({ input }) => {
        await db.reorderTrainingSteps(input.orderedStepIds);
        return { success: true };
      }),
    updateModule: publicProcedure
      .input(z.object({
        moduleId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        icon: z.string().optional(),
        videoUrl: z.string().optional().nullable(),
        quizTitle: z.string().optional().nullable(),
      }))
      .mutation(async ({ input }) => {
        const { moduleId, ...updateData } = input;
        await db.updateTrainingModule(moduleId, updateData);
        return { success: true };
      }),
    getToolsForModule: publicProcedure
      .input(z.object({ moduleId: z.string() }))
      .query(async ({ input }) => db.getToolsForModule(input.moduleId)),
    getStepsForModule: publicProcedure
      .input(z.object({ moduleId: z.string() }))
      .query(async ({ input }) => db.getStepsForModule(input.moduleId)),
    updateStep: publicProcedure
      .input(z.object({
        stepId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        imageUrl: z.string().url().optional().nullable(),
        videoUrl: z.string().url().optional().nullable(),
        warnings: z.string().optional().nullable(),
        tips: z.string().optional().nullable(),
      }))
      .mutation(async ({ input }) => {
        const { stepId, ...updateData } = input;
        await db.updateTrainingStep(stepId, updateData);
        return { success: true };
      }),
    getUserProgress: publicProcedure
      .input(z.object({ employeeId: z.string(), moduleId: z.string() }))
      .query(async ({ input }) => db.getUserTrainingProgress(input.employeeId, input.moduleId)),
    getAllUserProgress: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getAllUserTrainingProgress(input.employeeId)),
    updateProgress: publicProcedure
      .input(z.object({ employeeId: z.string(), moduleId: z.string(), completedSteps: z.string().optional(), isModuleCompleted: z.enum(["yes", "no"]), completedAt: z.date().optional() }))
      .mutation(async ({ input }) => {
        const progressId = `TPROG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.upsertUserTrainingProgress({
          progressId,
          employeeId: input.employeeId,
          moduleId: input.moduleId,
          completedSteps: input.completedSteps,
          isModuleCompleted: input.isModuleCompleted,
          completedAt: input.completedAt,
          startedAt: new Date(),
        });
        return { success: true };
      }),
    // ── Quiz Questions ──────────────────────────────────────────────────────────
    getQuizQuestions: publicProcedure
      .input(z.object({ moduleId: z.string() }))
      .query(async ({ input }) => db.getQuizQuestionsForModule(input.moduleId)),
    addQuizQuestion: publicProcedure
      .input(z.object({
        moduleId: z.string(),
        questionText: z.string(),
        optionA: z.string(),
        optionB: z.string(),
        optionC: z.string(),
        optionD: z.string(),
        correctAnswer: z.enum(["A", "B", "C", "D"]),
        orderIndex: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const questionId = `TQ_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.createTrainingQuizQuestion({
          questionId,
          moduleId: input.moduleId,
          questionText: input.questionText,
          optionA: input.optionA,
          optionB: input.optionB,
          optionC: input.optionC,
          optionD: input.optionD,
          correctAnswer: input.correctAnswer,
          orderIndex: input.orderIndex ?? 0,
        });
        return { success: true, questionId };
      }),
    updateQuizQuestion: publicProcedure
      .input(z.object({
        questionId: z.string(),
        questionText: z.string().optional(),
        optionA: z.string().optional(),
        optionB: z.string().optional(),
        optionC: z.string().optional(),
        optionD: z.string().optional(),
        correctAnswer: z.enum(["A", "B", "C", "D"]).optional(),
        orderIndex: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const { questionId, ...updateData } = input;
        await db.updateTrainingQuizQuestion(questionId, updateData);
        return { success: true };
      }),
    deleteQuizQuestion: publicProcedure
      .input(z.object({ questionId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteTrainingQuizQuestion(input.questionId);
        return { success: true };
      }),
    // ── Quiz Attempts ───────────────────────────────────────────────────────────
    submitQuizAttempt: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        moduleId: z.string(),
        score: z.number().int(),
        totalQuestions: z.number().int(),
        answers: z.string().optional(),
        passed: z.enum(["yes", "no"]),
      }))
      .mutation(async ({ input }) => {
        const attemptId = `TATTEMPT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.submitQuizAttempt({
          attemptId,
          employeeId: input.employeeId,
          moduleId: input.moduleId,
          score: input.score,
          totalQuestions: input.totalQuestions,
          answers: input.answers,
          passed: input.passed,
        });
        return { success: true, passed: input.passed === "yes" };
      }),
    getQuizAttempts: publicProcedure
      .input(z.object({ employeeId: z.string(), moduleId: z.string() }))
      .query(async ({ input }) => db.getQuizAttemptsForEmployee(input.employeeId, input.moduleId)),
    getBestQuizAttempt: publicProcedure
      .input(z.object({ employeeId: z.string(), moduleId: z.string() }))
      .query(async ({ input }) => db.getBestQuizAttempt(input.employeeId, input.moduleId)),
    getAllQuizAttemptsForEmployee: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getAllQuizAttemptsForEmployee(input.employeeId)),
    // ── Progress Management ─────────────────────────────────────────────────────
    getAllEmployeesProgress: publicProcedure
      .query(async () => db.getAllEmployeesTrainingProgress()),
    markScrollComplete: publicProcedure
      .input(z.object({ employeeId: z.string(), moduleId: z.string() }))
      .mutation(async ({ input }) => {
        await db.markScrollComplete(input.employeeId, input.moduleId);
        return { success: true };
      }),
    resetEmployeeProgress: publicProcedure
      .input(z.object({ employeeId: z.string(), moduleId: z.string() }))
      .mutation(async ({ input }) => {
        await db.resetEmployeeModuleProgress(input.employeeId, input.moduleId);
        return { success: true };
      }),
    // ── Seed ────────────────────────────────────────────────────────────────────
    seedV2: publicProcedure
      .mutation(async () => db.seedTrainingModulesV2()),
    // ── Step CRUD ───────────────────────────────────────────────────────────────
    addStep: publicProcedure
      .input(z.object({
        moduleId: z.string(),
        title: z.string(),
        description: z.string(),
        imageUrl: z.string().optional().nullable(),
        warnings: z.string().optional().nullable(),
        tips: z.string().optional().nullable(),
        orderIndex: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const stepId = `TSTEP_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.createTrainingStep({
          stepId,
          moduleId: input.moduleId,
          title: input.title,
          description: input.description,
          imageUrl: input.imageUrl,
          warnings: input.warnings,
          tips: input.tips,
          orderIndex: input.orderIndex ?? 0,
        });
        return { success: true, stepId };
      }),
    deleteStep: publicProcedure
      .input(z.object({ stepId: z.string() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { trainingSteps: ts } = await import("../drizzle/schema");
        const { eq: eqFn } = await import("drizzle-orm");
        await dbConn.delete(ts).where(eqFn(ts.stepId, input.stepId));
        return { success: true };
      }),
    // ── Interactive Step Overrides ──────────────────────────────────────────────
    getInteractiveOverrides: publicProcedure
      .input(z.object({ moduleId: z.string() }))
      .query(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) return [];
        const { interactiveStepOverrides } = await import("../drizzle/schema");
        const { eq: eqFn2 } = await import("drizzle-orm");
        return dbConn.select().from(interactiveStepOverrides)
          .where(eqFn2(interactiveStepOverrides.moduleId, input.moduleId));
      }),
    upsertInteractiveOverride: publicProcedure
      .input(z.object({
        moduleId: z.string(),
        stepIndex: z.number().int(),
        title: z.string().optional().nullable(),
        instruction: z.string().optional().nullable(),
        area: z.string().optional().nullable(),
        question: z.string().optional().nullable(),
        proTip: z.string().optional().nullable(),
        choiceLabels: z.string().optional().nullable(),
        vehicleImageUrl: z.string().optional().nullable(),
        videoUrl: z.string().optional().nullable(),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveStepOverrides } = await import("../drizzle/schema");
        const { eq: eqFn3 } = await import("drizzle-orm");
        const overrideKey = `${input.moduleId}:${input.stepIndex}`;
        const existing = await dbConn.select().from(interactiveStepOverrides)
          .where(eqFn3(interactiveStepOverrides.overrideKey, overrideKey)).limit(1);
        const data = {
          overrideKey,
          moduleId: input.moduleId,
          stepIndex: input.stepIndex,
          title: input.title ?? null,
          instruction: input.instruction ?? null,
          area: input.area ?? null,
          question: input.question ?? null,
          proTip: input.proTip ?? null,
          choiceLabels: input.choiceLabels ?? null,
          vehicleImageUrl: input.vehicleImageUrl ?? null,
          videoUrl: input.videoUrl ?? null,
        };
        if (existing.length > 0) {
          await dbConn.update(interactiveStepOverrides).set(data)
            .where(eqFn3(interactiveStepOverrides.overrideKey, overrideKey));
        } else {
          await dbConn.insert(interactiveStepOverrides).values(data);
        }
        return { success: true };
      }),
    uploadTrainingImage: publicProcedure
      .input(z.object({
        base64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        moduleId: z.string(),
        stepIndex: z.number().int(),
      }))
      .mutation(async ({ input }) => {
        const ext = input.mimeType === "image/png" ? "png" : "jpg";
        const suffix = Math.random().toString(36).substr(2, 8);
        const key = `training-images/${input.moduleId}/step${input.stepIndex}_${suffix}.${ext}`;
        const buffer = Buffer.from(input.base64, "base64");
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { success: true as const, url };
      }),
    uploadTrainingVideo: publicProcedure
      .input(z.object({
        base64: z.string(),
        mimeType: z.string().default("video/mp4"),
        moduleId: z.string(),
        stepIndex: z.number().int(),
      }))
      .mutation(async ({ input }) => {
        const ext = input.mimeType.includes("quicktime") ? "mov" : "mp4";
        const suffix = Math.random().toString(36).substr(2, 8);
        const key = `training-videos/${input.moduleId}/step${input.stepIndex}_${suffix}.${ext}`;
        const buffer = Buffer.from(input.base64, "base64");
        const { url } = await storagePut(key, buffer, input.mimeType);
                return { success: true as const, url };
      }),
    // ── Interactive Modules (DB-backed, editable from admin) ──────────────────
    getAllInteractiveModules: publicProcedure.query(async () => {
      const dbConn = await (await import("./db")).getDb();
      if (!dbConn) return [];
      const { interactiveModules } = await import("../drizzle/schema");
      const { asc } = await import("drizzle-orm");
      return dbConn.select().from(interactiveModules).orderBy(asc(interactiveModules.orderIndex));
    }),
    updateInteractiveModule: publicProcedure
      .input(z.object({
        moduleKey: z.string(),
        title: z.string().optional(),
        subtitle: z.string().optional(),
        emoji: z.string().optional(),
        color: z.string().optional(),
        bgColor: z.string().optional(),
        stepCount: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModules } = await import("../drizzle/schema");
        const { eq: eqIM } = await import("drizzle-orm");
        const updates: Record<string, unknown> = {};
        if (input.title !== undefined) updates.title = input.title;
        if (input.subtitle !== undefined) updates.subtitle = input.subtitle;
        if (input.emoji !== undefined) updates.emoji = input.emoji;
        if (input.color !== undefined) updates.color = input.color;
        if (input.bgColor !== undefined) updates.bgColor = input.bgColor;
        if (input.stepCount !== undefined) updates.stepCount = input.stepCount;
        if (Object.keys(updates).length > 0) {
          await dbConn.update(interactiveModules).set(updates).where(eqIM(interactiveModules.moduleKey, input.moduleKey));
        }
        return { success: true };
      }),
    reorderInteractiveModules: publicProcedure
      .input(z.object({ orderedKeys: z.array(z.string()) }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModules } = await import("../drizzle/schema");
        const { eq: eqIM2 } = await import("drizzle-orm");
        for (let i = 0; i < input.orderedKeys.length; i++) {
          await dbConn.update(interactiveModules)
            .set({ orderIndex: i })
            .where(eqIM2(interactiveModules.moduleKey, input.orderedKeys[i]));
        }
        return { success: true };
      }),
    createInteractiveModule: publicProcedure
      .input(z.object({
        title: z.string(),
        subtitle: z.string().default(""),
        emoji: z.string().default("📋"),
        color: z.string().default("#0a7ea4"),
        bgColor: z.string().default("#E6F4FE"),
        stepCount: z.number().int().default(0),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModules } = await import("../drizzle/schema");
        const { sql: sqlIM } = await import("drizzle-orm");
        // Generate a unique key from the title
        const baseKey = input.title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
        const moduleKey = `${baseKey}-${Date.now().toString(36)}`;
        // Get current max orderIndex
        const maxResult = await dbConn.select({ maxOrder: sqlIM<number>`MAX(order_index_im)` }).from(interactiveModules);
        const nextOrder = ((maxResult[0]?.maxOrder ?? -1) as number) + 1;
        // Build the route from the key — must match the dynamic screen at /training/[moduleId]
        const route = `/training/${moduleKey}`;
        await dbConn.insert(interactiveModules).values({
          moduleKey,
          title: input.title,
          subtitle: input.subtitle,
          emoji: input.emoji,
          color: input.color,
          bgColor: input.bgColor,
          stepCount: input.stepCount,
          route,
          orderIndex: nextOrder,
          isActive: 1,
        });
        return { success: true, moduleKey };
      }),
    deleteInteractiveModule: publicProcedure
      .input(z.object({ moduleKey: z.string() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModules } = await import("../drizzle/schema");
        const { eq: eqDel } = await import("drizzle-orm");
        await dbConn.delete(interactiveModules).where(eqDel(interactiveModules.moduleKey, input.moduleKey));
        return { success: true };
      }),
    // ── Folder endpoints ──────────────────────────────────────────────────────
    getFolders: publicProcedure.query(async () => {
      const dbConn = await (await import("./db")).getDb();
      if (!dbConn) return [];
      const { interactiveModuleFolders, interactiveModules: imTable } = await import("../drizzle/schema");
      const { asc: ascF } = await import("drizzle-orm");
      const folders = await dbConn.select().from(interactiveModuleFolders).orderBy(ascF(interactiveModuleFolders.orderIndex));
      const modules = await dbConn.select().from(imTable).orderBy(ascF(imTable.orderIndex));
      return folders.map(f => ({
        ...f,
        modules: modules.filter(m => m.folderId === f.id),
      }));
    }),
    createFolder: publicProcedure
      .input(z.object({ name: z.string(), emoji: z.string().default("📁") }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModuleFolders } = await import("../drizzle/schema");
        const { sql: sqlF } = await import("drizzle-orm");
        const [{ maxOrder }] = await dbConn.select({ maxOrder: sqlF<number>`COALESCE(MAX(order_index_imf), -1)` }).from(interactiveModuleFolders);
        await dbConn.insert(interactiveModuleFolders).values({ name: input.name, emoji: input.emoji, orderIndex: (maxOrder ?? -1) + 1 });
        return { success: true };
      }),
    updateFolder: publicProcedure
      .input(z.object({ id: z.number(), name: z.string().optional(), emoji: z.string().optional(), orderIndex: z.number().optional(), isCollapsed: z.number().optional() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModuleFolders } = await import("../drizzle/schema");
        const { eq: eqF } = await import("drizzle-orm");
        const updates: Record<string, unknown> = {};
        if (input.name !== undefined) updates.name = input.name;
        if (input.emoji !== undefined) updates.emoji = input.emoji;
        if (input.orderIndex !== undefined) updates.orderIndex = input.orderIndex;
        if (input.isCollapsed !== undefined) updates.isCollapsed = input.isCollapsed;
        if (Object.keys(updates).length > 0) await dbConn.update(interactiveModuleFolders).set(updates).where(eqF(interactiveModuleFolders.id, input.id));
        return { success: true };
      }),
    deleteFolder: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModuleFolders, interactiveModules: imTable } = await import("../drizzle/schema");
        const { eq: eqFD, sql: sqlFD } = await import("drizzle-orm");
        // Unassign modules from this folder
        await dbConn.update(imTable).set({ folderId: null } as any).where(eqFD((imTable as any).folderId, input.id));
        await dbConn.delete(interactiveModuleFolders).where(eqFD(interactiveModuleFolders.id, input.id));
        return { success: true };
      }),
    assignModuleToFolder: publicProcedure
      .input(z.object({ moduleKey: z.string(), folderId: z.number().nullable() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModules: imTable } = await import("../drizzle/schema");
        const { eq: eqA } = await import("drizzle-orm");
        await dbConn.update(imTable).set({ folderId: input.folderId } as any).where(eqA(imTable.moduleKey, input.moduleKey));
        return { success: true };
      }),
    reorderFolders: publicProcedure
      .input(z.array(z.object({ id: z.number(), orderIndex: z.number() })))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModuleFolders } = await import("../drizzle/schema");
        const { eq: eqR } = await import("drizzle-orm");
        await Promise.all(input.map(({ id, orderIndex }) =>
          dbConn.update(interactiveModuleFolders).set({ orderIndex }).where(eqR(interactiveModuleFolders.id, id))
        ));
        return { success: true };
      }),
    // ── Module Tools endpoints ──────────────────────────────────────────────
    getModuleTools: publicProcedure
      .input(z.object({ moduleKey: z.string() }))
      .query(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) return [];
        const { moduleTools } = await import("../drizzle/schema");
        const { eq: eqMT, asc: ascMT } = await import("drizzle-orm");
        return dbConn.select().from(moduleTools).where(eqMT(moduleTools.moduleKey, input.moduleKey)).orderBy(ascMT(moduleTools.orderIndex));
      }),
    addModuleTool: publicProcedure
      .input(z.object({ moduleKey: z.string(), name: z.string(), photoUrl: z.string().optional(), category: z.enum(["tool", "chemical", "towel"]).default("tool") }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { moduleTools } = await import("../drizzle/schema");
        const { eq: eqMT, sql: sqlMT } = await import("drizzle-orm");
        const [{ maxOrder }] = await dbConn.select({ maxOrder: sqlMT<number>`COALESCE(MAX(order_index), -1)` }).from(moduleTools).where(eqMT(moduleTools.moduleKey, input.moduleKey));
        await dbConn.insert(moduleTools).values({ moduleKey: input.moduleKey, name: input.name, photoUrl: input.photoUrl ?? null, category: input.category, orderIndex: (maxOrder ?? -1) + 1 });
        return { success: true };
      }),
    updateModuleTool: publicProcedure
      .input(z.object({ id: z.number(), name: z.string().optional(), photoUrl: z.string().nullable().optional(), category: z.enum(["tool", "chemical", "towel"]).optional() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { moduleTools } = await import("../drizzle/schema");
        const { eq: eqMT } = await import("drizzle-orm");
        const updates: Record<string, unknown> = {};
        if (input.name !== undefined) updates.name = input.name;
        if (input.photoUrl !== undefined) updates.photoUrl = input.photoUrl;
        if (input.category !== undefined) updates.category = input.category;
        if (Object.keys(updates).length > 0) await dbConn.update(moduleTools).set(updates).where(eqMT(moduleTools.id, input.id));
        return { success: true };
      }),
    deleteModuleTool: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { moduleTools } = await import("../drizzle/schema");
        const { eq: eqMT } = await import("drizzle-orm");
        await dbConn.delete(moduleTools).where(eqMT(moduleTools.id, input.id));
        return { success: true };
      }),
    // ── Interactive Module Steps endpoints ────────────────────────────────────
    getInteractiveSteps: publicProcedure
      .input(z.object({ moduleKey: z.string() }))
      .query(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) return [];
        const { interactiveModuleSteps } = await import("../drizzle/schema");
        const { eq: eqIS, asc: ascIS } = await import("drizzle-orm");
        return dbConn.select().from(interactiveModuleSteps)
          .where(eqIS(interactiveModuleSteps.moduleKey, input.moduleKey))
          .orderBy(ascIS(interactiveModuleSteps.orderIndex));
      }),
    addInteractiveStep: publicProcedure
      .input(z.object({
        moduleKey: z.string(),
        title: z.string(),
        instruction: z.string(),
        area: z.string().optional(),
        question: z.string().optional(),
        choices: z.array(z.object({ id: z.string(), label: z.string() })).optional(),
        correctId: z.string().optional(),
        wrongExplanation: z.string().optional(),
        correctExplanation: z.string().optional(),
        proTip: z.string().optional(),
        vehicleImageUrl: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModuleSteps } = await import("../drizzle/schema");
        const { eq: eqIS, sql: sqlIS } = await import("drizzle-orm");
        const [{ maxOrder }] = await dbConn.select({ maxOrder: sqlIS<number>`COALESCE(MAX(order_index), -1)` })
          .from(interactiveModuleSteps).where(eqIS(interactiveModuleSteps.moduleKey, input.moduleKey));
        const stepId = `IMS_${input.moduleKey}_${Date.now()}`;
        await dbConn.insert(interactiveModuleSteps).values({
          moduleKey: input.moduleKey,
          stepId,
          title: input.title,
          instruction: input.instruction,
          area: input.area ?? null,
          question: input.question ?? null,
          choices: input.choices ?? null,
          correctId: input.correctId ?? null,
          wrongExplanation: input.wrongExplanation ?? null,
          correctExplanation: input.correctExplanation ?? null,
          proTip: input.proTip ?? null,
          vehicleImageUrl: input.vehicleImageUrl ?? null,
          orderIndex: (maxOrder ?? -1) + 1,
        });
        return { success: true, stepId };
      }),
    updateInteractiveStep: publicProcedure
      .input(z.object({
        stepId: z.string(),
        title: z.string().optional(),
        instruction: z.string().optional(),
        area: z.string().nullable().optional(),
        question: z.string().nullable().optional(),
        choices: z.array(z.object({ id: z.string(), label: z.string() })).nullable().optional(),
        correctId: z.string().nullable().optional(),
        wrongExplanation: z.string().nullable().optional(),
        correctExplanation: z.string().nullable().optional(),
        proTip: z.string().nullable().optional(),
        vehicleImageUrl: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModuleSteps } = await import("../drizzle/schema");
        const { eq: eqIS } = await import("drizzle-orm");
        const updates: Record<string, unknown> = {};
        const { stepId, ...fields } = input;
        for (const [k, v] of Object.entries(fields)) { if (v !== undefined) updates[k] = v; }
        if (Object.keys(updates).length > 0)
          await dbConn.update(interactiveModuleSteps).set(updates).where(eqIS(interactiveModuleSteps.stepId, stepId));
        return { success: true };
      }),
    deleteInteractiveStep: publicProcedure
      .input(z.object({ stepId: z.string() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModuleSteps } = await import("../drizzle/schema");
        const { eq: eqIS } = await import("drizzle-orm");
        await dbConn.delete(interactiveModuleSteps).where(eqIS(interactiveModuleSteps.stepId, input.stepId));
        return { success: true };
      }),
    reorderInteractiveSteps: publicProcedure
      .input(z.object({ orderedStepIds: z.array(z.string()) }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveModuleSteps } = await import("../drizzle/schema");
        const { eq: eqIS } = await import("drizzle-orm");
        await Promise.all(input.orderedStepIds.map((stepId, idx) =>
          dbConn.update(interactiveModuleSteps).set({ orderIndex: idx }).where(eqIS(interactiveModuleSteps.stepId, stepId))
        ));
        return { success: true };
      }),
    // Hides a built-in (hardcoded) step by writing an isDeleted=true override record
    deleteBuiltInStep: publicProcedure
      .input(z.object({ moduleId: z.string(), stepIndex: z.number() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveStepOverrides } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const overrideKey = `${input.moduleId}:${input.stepIndex}`;
        const existing = await dbConn.select().from(interactiveStepOverrides).where(eq(interactiveStepOverrides.overrideKey, overrideKey)).limit(1);
        if (existing.length > 0) {
          await dbConn.update(interactiveStepOverrides).set({ isDeleted: true }).where(eq(interactiveStepOverrides.overrideKey, overrideKey));
        } else {
          await (dbConn.insert(interactiveStepOverrides) as any).values({ overrideKey, moduleId: input.moduleId, stepIndex: input.stepIndex, isDeleted: true });
        }
        return { success: true };
      }),
    // Restores a previously deleted built-in step
    restoreBuiltInStep: publicProcedure
      .input(z.object({ moduleId: z.string(), stepIndex: z.number() }))
      .mutation(async ({ input }) => {
        const dbConn = await (await import("./db")).getDb();
        if (!dbConn) throw new Error("DB unavailable");
        const { interactiveStepOverrides } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const overrideKey = `${input.moduleId}:${input.stepIndex}`;
        await dbConn.update(interactiveStepOverrides).set({ isDeleted: false }).where(eq(interactiveStepOverrides.overrideKey, overrideKey));
        return { success: true };
      }),
  }),
  chat: router({
    sendMessage: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string(),
        profilePhotoUrl: z.string().optional(),
        messageText: z.string().optional(),
        imageUrl: z.string().optional(),
        channel: z.string().default("general"),
        recipientId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const messageId = `MSG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        await db.createTeamChatMessage({
          messageId,
          employeeId: input.employeeId,
          fullName: input.fullName,
          profilePhotoUrl: input.profilePhotoUrl,
          messageText: input.messageText,
          imageUrl: input.imageUrl,
          channel: input.channel,
          recipientId: input.recipientId,
        });
        // Send push notifications — DM targets only the recipient; group channels target everyone except sender
        try {
          const { employees: empTable } = await import('../drizzle/schema');
          const { ne, eq: eqOp } = await import('drizzle-orm');
          const drizzleDb = await db.getDb();
          if (drizzleDb) {
            let recipients;
            if (input.channel === 'dm' && input.recipientId) {
              // Direct message — only push the specific recipient
              recipients = await drizzleDb.select({ pushToken: empTable.pushToken }).from(empTable).where(eqOp(empTable.employeeId, input.recipientId));
            } else {
              // Group channel — push everyone except sender
              recipients = await drizzleDb.select({ pushToken: empTable.pushToken }).from(empTable).where(ne(empTable.employeeId, input.employeeId));
            }
            const tokens = recipients.map((r: any) => r.pushToken).filter((t: any): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              const msgPreview = input.messageText ? input.messageText.slice(0, 80) : (input.imageUrl ? '📷 Image' : '🎤 Voice message');
              const channelLabel = input.channel === 'dm' ? 'Direct Message' : input.channel === 'ptt' ? 'Luxury Talk' : input.channel;
              const pushTitle = input.channel === 'dm' ? `💬 ${input.fullName} (DM)` : `💬 ${input.fullName} • ${channelLabel}`;
              const pushPayloads = tokens.map((to: string) => ({ to, title: pushTitle, body: msgPreview, sound: 'default', data: { screen: 'team-chat', channel: input.channel, senderId: input.employeeId, senderName: input.fullName, recipientId: input.recipientId ?? null, messageId } }));
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pushPayloads),
              });
            }
          }
        } catch (e) {
          console.error('[push] team chat push failed:', e);
        }
        return { success: true, messageId };
      }),
    getMessages: publicProcedure
      .input(z.object({ limit: z.number().int().positive().default(50), offset: z.number().int().nonnegative().default(0) }))
      .query(async ({ input }) => {
        const messages = await db.getTeamChatMessages(input.limit, input.offset);
        return messages.reverse();
      }),
    getMessagesAfter: publicProcedure
      .input(z.object({ afterDate: z.date(), limit: z.number().int().positive().default(50) }))
      .query(async ({ input }) => {
        const messages = await db.getTeamChatMessagesAfter(input.afterDate, input.limit);
        return messages.reverse();
      }),
    getChannelMessages: publicProcedure
      .input(z.object({ channel: z.string(), limit: z.number().int().positive().default(60) }))
      .query(async ({ input }) => {
        const messages = await db.getChannelMessages(input.channel, input.limit);
        return messages.reverse();
      }),
    getDmMessages: publicProcedure
      .input(z.object({ employeeIdA: z.string(), employeeIdB: z.string(), limit: z.number().int().positive().default(60) }))
      .query(async ({ input }) => {
        const messages = await db.getDmMessages(input.employeeIdA, input.employeeIdB, input.limit);
        return messages.reverse();
      }),
    getDmConversations: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => {
        return await db.getDmConversations(input.employeeId);
      }),
    getTeamMembers: publicProcedure
      .query(async () => {
        return await db.getAllActiveEmployees();
      }),
    sendVoiceMessage: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string(),
        audioBase64: z.string(),
        mimeType: z.string().default("audio/m4a"),
        durationSeconds: z.number().int().optional(),
        channel: z.string().default("ptt"),
        recipientId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const messageId = `PTT_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        const key = `voice-messages/${input.employeeId}/${messageId}.m4a`;
        const buffer = Buffer.from(input.audioBase64, "base64");
        const { url } = await storagePut(key, buffer, input.mimeType);
        await db.createTeamChatMessage({
          messageId,
          employeeId: input.employeeId,
          fullName: input.fullName,
          audioUrl: url,
          durationSeconds: input.durationSeconds ?? null,
          channel: input.channel,
          recipientId: input.recipientId ?? null,
        });
        // Send push notifications for voice messages
        try {
          const { employees: empTable } = await import('../drizzle/schema');
          const { ne, eq: eqOp } = await import('drizzle-orm');
          const drizzleDb2 = await db.getDb();
          if (drizzleDb2) {
            let recipients;
            if (input.recipientId) {
              // DM voice message — only push the specific recipient
              recipients = await drizzleDb2.select({ pushToken: empTable.pushToken }).from(empTable).where(eqOp(empTable.employeeId, input.recipientId));
            } else {
              // Group/PTT voice message — push everyone except sender
              recipients = await drizzleDb2.select({ pushToken: empTable.pushToken }).from(empTable).where(ne(empTable.employeeId, input.employeeId));
            }
            const tokens = recipients.map((r: any) => r.pushToken).filter((t: any): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              const channelLabel = input.channel === 'ptt' ? 'Luxury Talk' : input.channel;
              const pushPayloads = tokens.map((to: string) => ({ to, title: `🎙️ ${input.fullName}`, body: `Sent a voice message in ${channelLabel}`, sound: 'default', data: { screen: 'team-chat', channel: input.channel, senderId: input.employeeId, senderName: input.fullName, recipientId: input.recipientId ?? null, messageId } }));
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pushPayloads),
              });
            }
          }
        } catch (e) {
          console.error('[push] voice message push failed:', e);
        }
        return { success: true, messageId, audioUrl: url };
      }),
    getPttMessages: publicProcedure
      .input(z.object({ limit: z.number().int().positive().default(30) }))
      .query(async ({ input }) => {
        const messages = await db.getChannelMessages("ptt", input.limit);
        return messages.reverse();
      }),
    /** Mark a channel (or DM) as seen for the given employee — resets unread count */
    markSeen: publicProcedure
      .input(z.object({ employeeId: z.string(), channelKey: z.string() }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { success: false };
        await drizzleDb.execute(
          sql`INSERT INTO chat_last_seen (employee_id, channel_key, last_seen_at)
            VALUES (${input.employeeId}, ${input.channelKey}, NOW())
            ON DUPLICATE KEY UPDATE last_seen_at = NOW()`
        );
        return { success: true };
      }),
    /** Get total unread message count across all channels for the given employee */
    getUnreadCount: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { total: 0, hasDm: false, hasGroup: false, hasCommunity: false };
        try {
          const groupChannels = ['ptt', 'general', 'admin', 'detailers', 'sales', 'door_hangers'];
          let groupUnread = 0;
          for (const ch of groupChannels) {
            const rows = await drizzleDb.execute(
              sql`SELECT COUNT(*) as cnt FROM team_chat_messages tcm
               LEFT JOIN chat_last_seen cls ON cls.employee_id = ${input.employeeId} AND cls.channel_key = ${ch}
               WHERE tcm.channel = ${ch} AND tcm.employee_id != ${input.employeeId}
               AND (cls.last_seen_at IS NULL OR tcm.created_at > cls.last_seen_at)`
            ) as any;
            groupUnread += Number(rows?.[0]?.[0]?.cnt ?? rows?.[0]?.cnt ?? 0);
          }
          const dmRows = await drizzleDb.execute(
            sql`SELECT COUNT(*) as cnt FROM team_chat_messages tcm
             LEFT JOIN chat_last_seen cls ON cls.employee_id = ${input.employeeId} AND cls.channel_key = CONCAT('dm:', tcm.employee_id)
             WHERE tcm.channel = 'dm' AND tcm.recipient_id = ${input.employeeId}
             AND (cls.last_seen_at IS NULL OR tcm.created_at > cls.last_seen_at)`
          ) as any;
          const dmUnread = Number(dmRows?.[0]?.[0]?.cnt ?? dmRows?.[0]?.cnt ?? 0);
          const commRows = await drizzleDb.execute(
            sql`SELECT COUNT(*) as cnt FROM community_posts cp
             LEFT JOIN chat_last_seen cls ON cls.employee_id = ${input.employeeId} AND cls.channel_key = 'community'
             WHERE cp.author_id != ${input.employeeId}
             AND (cls.last_seen_at IS NULL OR cp.created_at > cls.last_seen_at)`
          ) as any;
          const communityUnread = Number(commRows?.[0]?.[0]?.cnt ?? commRows?.[0]?.cnt ?? 0);
          const total = groupUnread + dmUnread + communityUnread;
          return { total, hasDm: dmUnread > 0, hasGroup: groupUnread > 0, hasCommunity: communityUnread > 0 };
        } catch (e) {
          console.error('[chat.getUnreadCount] error:', e);
          return { total: 0, hasDm: false, hasGroup: false, hasCommunity: false };
        }
      }),
  }),

  timesheet: router({
    clockIn: publicProcedure
      .input(z.object({ employeeId: z.string(), fullName: z.string(), lat: z.number().optional(), lng: z.number().optional() }))
      .mutation(async ({ input }) => {
        return await db.clockIn(input.employeeId, input.fullName, input.lat, input.lng);
      }),
    clockOut: publicProcedure
      .input(z.object({ employeeId: z.string(), lat: z.number().optional(), lng: z.number().optional() }))
      .mutation(async ({ input }) => {
        return await db.clockOut(input.employeeId, input.lat, input.lng);
      }),
    getTodayStatus: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => {
        return await db.getTodayClockStatus(input.employeeId);
      }),
    getTodayBreaks: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => {
        return await db.getTodayBreaks(input.employeeId);
      }),
    createBreakNotification: publicProcedure
      .input(z.object({ employeeId: z.string(), fullName: z.string(), breakType: z.enum(["morning_15min", "afternoon_15min", "lunch_30min"]), startLat: z.number().optional(), startLng: z.number().optional() }))
      .mutation(async ({ input }) => {
        return await db.createBreakNotification(input.employeeId, input.fullName, input.breakType, input.startLat, input.startLng);
      }),
    updateBreakStatus: publicProcedure
      .input(z.object({ breakId: z.string(), status: z.enum(["pending", "taken", "skipped"]), startLat: z.number().optional(), startLng: z.number().optional(), endLat: z.number().optional(), endLng: z.number().optional() }))
      .mutation(async ({ input }) => {
        await db.updateBreakStatus(input.breakId, input.status, undefined, undefined, input.startLat, input.startLng, input.endLat, input.endLng);
        // Auto-recalc hours on the clock record for this employee/date
        try {
          const { getDb } = await import('./db');
          const { eq } = await import('drizzle-orm');
          const { breakRecords } = await import('../drizzle/schema');
          const dbConn = await getDb();
          if (dbConn) {
            const br = await dbConn.select().from(breakRecords).where(eq(breakRecords.breakId, input.breakId)).limit(1);
            if (br[0]) await db.recalcClockRecordForDate(br[0].employeeId!, br[0].date!);
          }
        } catch (_) { /* non-fatal */ }
        return { success: true };
      }),
    getWeeklyLogs: publicProcedure
      .input(z.object({ employeeId: z.string(), startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) => {
        return await db.getWeeklyClockLogs(input.employeeId, input.startDate, input.endDate);
      }),
    getWeeklyHours: publicProcedure
      .input(z.object({ employeeId: z.string(), startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) => {
        return await db.getWeeklyHours(input.employeeId, input.startDate, input.endDate);
      }),
    updateClockInTime: publicProcedure
      .input(z.object({ recordId: z.string(), clockInTime: z.date() }))
      .mutation(async ({ input }) => {
        return await db.updateClockInTime(input.recordId, input.clockInTime);
      }),
    updateClockOutTime: publicProcedure
      .input(z.object({ recordId: z.string(), clockOutTime: z.date() }))
      .mutation(async ({ input }) => {
        return await db.updateClockOutTime(input.recordId, input.clockOutTime);
      }),
    recalculateHours: publicProcedure
      .input(z.object({ recordId: z.string() }))
      .mutation(async ({ input }) => {
        return await db.updateClockOutTime(
          input.recordId,
          // Pass the existing clockOutTime — the function will re-fetch it and recompute with break deduction
          await (async () => {
            const { getDb } = await import('./db');
            const dbConn = await getDb();
            if (!dbConn) throw new Error('DB unavailable');
            const { eq } = await import('drizzle-orm');
            const { clockInOutRecords } = await import('../drizzle/schema');
            const rows = await dbConn.select().from(clockInOutRecords).where(eq(clockInOutRecords.recordId, input.recordId)).limit(1);
            if (!rows[0]?.clockOutTime) throw new Error('Record has no clock-out time');
            return new Date(rows[0].clockOutTime);
          })()
        );
      }),
    getActiveBreak: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => {
        return await db.getActiveBreak(input.employeeId);
      }),
    endBreak: publicProcedure
      .input(z.object({ breakId: z.string(), endLat: z.number().optional(), endLng: z.number().optional() }))
      .mutation(async ({ input }) => {
        const result = await db.endBreak(input.breakId, input.endLat, input.endLng);
        // Auto-recalc hours on the clock record after break ends
        try {
          const { getDb } = await import('./db');
          const { eq } = await import('drizzle-orm');
          const { breakRecords } = await import('../drizzle/schema');
          const dbConn = await getDb();
          if (dbConn) {
            const br = await dbConn.select().from(breakRecords).where(eq(breakRecords.breakId, input.breakId)).limit(1);
            if (br[0]) await db.recalcClockRecordForDate(br[0].employeeId!, br[0].date!);
          }
        } catch (_) { /* non-fatal */ }
        return result;
      }),
    // Detailer responds to 5PM "Still Working?" prompt
    respondToClockCheck: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string(),
        response: z.enum(["still_working", "clock_me_out"]),
        notificationId: z.string(),
      }))
      .mutation(async ({ input }) => {
        // Mark the notification as acknowledged so the prompt disappears
        await db.markNotificationAcknowledged(input.notificationId);
        if (input.response === "clock_me_out") {
          // Clock them out immediately — if already clocked out, treat as no-op
          let result: { totalHours?: number } = {};
          try {
            result = await db.clockOut(input.employeeId);
          } catch (err: any) {
            if (err?.message === "No active clock in found") {
              // Employee was already clocked out — acknowledge silently
              return { action: "already_clocked_out" };
            }
            throw err;
          }
          // Notify admins
          const admins = await db.getAdminEmployees();
          for (const admin of admins) {
            await db.createNotification({
              notificationId: `CLOCK_RESP_${Date.now()}_${admin.employeeId}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName,
              notificationType: "clock_alert",
              title: `✅ Clocked Out: ${input.fullName}`,
              message: `${input.fullName} responded to the 5PM check and chose to clock out. Total hours: ${Number(result.totalHours).toFixed(2)}h.`,
              createdBy: "System",
              status: "unread",
              requiresAcknowledgment: "no",
            });
          }
          return { action: "clocked_out", ...result };
        }
        // "still_working" — just acknowledge, nothing else needed
        return { action: "still_working" };
      }),
    // Get pending 5PM clock check notification for this employee
    getTodayClockSummary: publicProcedure
      .query(async () => db.getTodayClockSummary()),
    getPendingClockCheck: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => {
        const notifs = await db.getNotificationsForEmployee(input.employeeId);
        const pending = notifs.find(
          (n: any) => n.notificationType === "clock_check_5pm" && n.status !== "acknowledged"
        );
        return pending ?? null;
      }),
    /** Admin: add a new clock record (time slot) for an employee on a specific date */
    addClockRecord: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string(),
        date: z.string(), // YYYY-MM-DD
        clockInTime: z.date(),
        clockOutTime: z.date().optional(),
      }))
      .mutation(async ({ input }) => {
        return await db.adminAddClockRecord(input);
      }),
    /** Admin: delete a clock record */
    deleteClockRecord: publicProcedure
      .input(z.object({ recordId: z.string() }))
      .mutation(async ({ input }) => {
        await db.adminDeleteClockRecord(input.recordId);
        return { success: true };
      }),
    /** Admin: add a break record for an employee on a specific date */
    addBreak: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string(),
        date: z.string(), // YYYY-MM-DD
        breakType: z.enum(["morning_15min", "afternoon_15min", "lunch_30min"]),
        breakStartTime: z.date().optional(),
        breakEndTime: z.date().optional(),
        status: z.enum(["pending", "taken", "skipped"]).default("taken"),
      }))
      .mutation(async ({ input }) => {
        const result = await db.adminAddBreak(input);
        // Auto-recalc hours after adding a break
        try { await db.recalcClockRecordForDate(input.employeeId, input.date); } catch (_) { /* non-fatal */ }
        return result;
      }),
    /** Admin: update break times and status */
    updateBreak: publicProcedure
      .input(z.object({
        breakId: z.string(),
        breakStartTime: z.date().optional(),
        breakEndTime: z.date().optional(),
        status: z.enum(["pending", "taken", "skipped"]).optional(),
      }))
      .mutation(async ({ input }) => {
        await db.adminUpdateBreak(input.breakId, {
          breakStartTime: input.breakStartTime,
          breakEndTime: input.breakEndTime,
          status: input.status,
        });
        // Auto-recalc hours after updating a break
        try {
          const { getDb } = await import('./db');
          const { eq } = await import('drizzle-orm');
          const { breakRecords } = await import('../drizzle/schema');
          const dbConn = await getDb();
          if (dbConn) {
            const br = await dbConn.select().from(breakRecords).where(eq(breakRecords.breakId, input.breakId)).limit(1);
            if (br[0]) await db.recalcClockRecordForDate(br[0].employeeId!, br[0].date!);
          }
        } catch (_) { /* non-fatal */ }
        return { success: true };
      }),
    /** Admin: delete a break record */
    deleteBreak: publicProcedure
      .input(z.object({ breakId: z.string() }))
      .mutation(async ({ input }) => {
        // Fetch break info before deleting so we can recalc
        let empId: string | undefined;
        let breakDate: string | undefined;
        try {
          const { getDb } = await import('./db');
          const { eq } = await import('drizzle-orm');
          const { breakRecords } = await import('../drizzle/schema');
          const dbConn = await getDb();
          if (dbConn) {
            const br = await dbConn.select().from(breakRecords).where(eq(breakRecords.breakId, input.breakId)).limit(1);
            empId = br[0]?.employeeId ?? undefined;
            breakDate = br[0]?.date ?? undefined;
          }
        } catch (_) { /* non-fatal */ }
        await db.adminDeleteBreak(input.breakId);
        // Auto-recalc hours after deleting a break
        try { if (empId && breakDate) await db.recalcClockRecordForDate(empId, breakDate); } catch (_) { /* non-fatal */ }
        return { success: true };
      }),
    /** Returns all employees currently clocked in (status = clocked_in) for today */
    getActiveClockedIn: publicProcedure
      .query(async () => db.getAllActiveClockedIn()),
    /** Returns total clocked hours for ALL employees within a date range — used by Efficiency screen */
    getTeamHoursByDateRange: publicProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) => {
        const { getDb } = await import('./db');
        const { clockInOutRecords } = await import('../drizzle/schema');
        const dbConn = await getDb();
        if (!dbConn) return [] as { employeeId: string; totalHours: number }[];
        const { and, gte, lte, eq, sql } = await import('drizzle-orm');
        const rows = await dbConn
          .select({
            employeeId: clockInOutRecords.employeeId,
            totalHours: sql<number>`COALESCE(SUM(${clockInOutRecords.totalHours}), 0)`,
          })
          .from(clockInOutRecords)
          .where(
            and(
              gte(clockInOutRecords.date, input.startDate),
              lte(clockInOutRecords.date, input.endDate),
              eq(clockInOutRecords.status, 'clocked_out')
            )
          )
          .groupBy(clockInOutRecords.employeeId);
        return rows.map(r => ({
          employeeId: r.employeeId ?? '',
          totalHours: Number(r.totalHours ?? 0),
        })).filter(r => r.employeeId);
      }),
    getTeamDashboard: publicProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) => {
        const { getDb } = await import('./db');
        const { clockInOutRecords, breakRecords } = await import('../drizzle/schema');
        const dbConn = await getDb();
        if (!dbConn) return { members: [] as { employeeId: string; fullName: string; totalHours: number; breakMinutes: number }[] };
        const { and, gte, lte, eq, sql } = await import('drizzle-orm');
        // Get total hours per employee
        const hoursRows = await dbConn
          .select({
            employeeId: clockInOutRecords.employeeId,
            fullName: clockInOutRecords.fullName,
            totalHours: sql<number>`COALESCE(SUM(${clockInOutRecords.totalHours}), 0)`,
          })
          .from(clockInOutRecords)
          .where(
            and(
              gte(clockInOutRecords.date, input.startDate),
              lte(clockInOutRecords.date, input.endDate),
              eq(clockInOutRecords.status, 'clocked_out')
            )
          )
          .groupBy(clockInOutRecords.employeeId, clockInOutRecords.fullName);
        // Get total break minutes per employee
        const breakRows = await dbConn
          .select({
            employeeId: breakRecords.employeeId,
            totalBreakMinutes: sql<number>`COALESCE(SUM(${breakRecords.durationMinutes}), 0)`,
          })
          .from(breakRecords)
          .where(
            and(
              gte(breakRecords.date, input.startDate),
              lte(breakRecords.date, input.endDate),
              eq(breakRecords.status, 'taken')
            )
          )
          .groupBy(breakRecords.employeeId);
        const breakMap = new Map(breakRows.map(r => [r.employeeId ?? '', Number(r.totalBreakMinutes ?? 0)]));
        const members = hoursRows
          .filter(r => r.employeeId)
          .map(r => ({
            employeeId: r.employeeId ?? '',
            fullName: r.fullName ?? '',
            totalHours: Number(r.totalHours ?? 0),
            breakMinutes: breakMap.get(r.employeeId ?? '') ?? 0,
          }))
          .sort((a, b) => b.totalHours - a.totalHours);
        return { members };
      }),
  }),
  stripe: router({
    createPaymentIntent: publicProcedure
      .input(z.object({
        amountCents: z.number().int().positive(),
        currency: z.string().default("usd"),
        description: z.string().optional(),
        captureMethod: z.enum(["automatic", "manual"]).default("automatic"),
        paymentMethodTypes: z.array(z.string()).optional(),
        // Pass jobId so the server can deduplicate rapid retries within 90 seconds
        jobId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          return { clientSecret: "pi_test_demo_secret_for_ui_testing", demo: true };
        }
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });

        // ── Idempotency / duplicate-charge guard + admin alert ────────────────────
        // If the same jobId was used to create a PaymentIntent in the last 90 s
        // and that intent already SUCCEEDED, fire an admin push alert immediately
        // and return the existing intent so no third charge is created.
        // If it is still open, reuse it (normal retry path).
        if (input.jobId) {
          try {
            const windowSec = Math.floor((Date.now() - 90_000) / 1000);
            const recent = await stripe.paymentIntents.list({ limit: 15, created: { gte: windowSec } });

            // Dangerous case: a charge for this job already SUCCEEDED
            const succeededDupe = recent.data.find((pi) =>
              pi.metadata?.job_id === input.jobId &&
              pi.amount === input.amountCents &&
              pi.status === 'succeeded'
            );
            if (succeededDupe) {
              console.warn(`[Stripe] ⚠️  DUPLICATE CHARGE for job ${input.jobId} — PI ${succeededDupe.id} already succeeded`);
              // Push alert to all admins / ops managers
              try {
                const { employees } = await import('../drizzle/schema');
                const { inArray: inArrDup } = await import('drizzle-orm');
                const dbConn = await db.getDb();
                if (dbConn) {
                  const adminRows = await dbConn
                    .select({ pushToken: employees.pushToken })
                    .from(employees)
                    .where(inArrDup(employees.role, ['admin', 'office', 'operations_manager']));
                  const adminTokens = adminRows
                    .map((r: { pushToken: string | null }) => r.pushToken)
                    .filter((t: string | null): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
                  if (adminTokens.length > 0) {
                    const dollars = (input.amountCents / 100).toFixed(2);
                    const desc = input.description ?? `Job #${input.jobId}`;
                    await fetch('https://exp.host/--/api/v2/push/send', {
                      method: 'POST',
                      headers: { 'Content-Type': 'application/json' },
                      body: JSON.stringify(adminTokens.map((to: string) => ({
                        to,
                        title: '⚠️ Duplicate Charge Detected',
                        body: `${desc} — $${dollars} may have been charged twice. Job #${input.jobId}. Check Stripe now.`,
                        sound: 'default',
                        priority: 'high',
                        data: { type: 'duplicate_charge', jobId: input.jobId, paymentIntentId: succeededDupe.id, amount: dollars },
                      }))),
                    });
                    console.log(`[Stripe] Duplicate-charge alert sent to ${adminTokens.length} admin(s)`);
                  }
                }
              } catch (alertErr) {
                console.error('[Stripe] Failed to send duplicate-charge admin alert:', alertErr);
              }
              // Return the existing succeeded intent — do NOT create another charge
              return { clientSecret: succeededDupe.client_secret ?? '', paymentIntentId: succeededDupe.id, demo: false, reused: true };
            }

            // Normal retry path: reuse an open intent
            const match = recent.data.find((pi) =>
              pi.metadata?.job_id === input.jobId &&
              pi.amount === input.amountCents &&
              ['requires_payment_method', 'requires_confirmation', 'requires_action', 'processing'].includes(pi.status)
            );
            if (match && match.client_secret) {
              console.log(`[Stripe] Reusing PaymentIntent ${match.id} for job ${input.jobId} (dedup guard)`);
              return { clientSecret: match.client_secret, paymentIntentId: match.id, demo: false, reused: true };
            }
          } catch (dedupErr) {
            // Non-fatal — fall through and create a fresh intent
            console.warn('[Stripe dedup] lookup failed, creating new intent:', dedupErr);
          }
        }

        // ── Build receipt description with job ID ────────────────────────────────────
        // This appears in the Stripe dashboard description column and on email receipts.
        const baseDescription = input.description ?? 'Detail Service';
        const receiptDescription = input.jobId
          ? `${baseDescription} [Job #${input.jobId}]`
          : baseDescription;

        const createParams: any = {
          amount: input.amountCents,
          currency: input.currency,
          description: receiptDescription,
          capture_method: input.captureMethod,
          // job_id in metadata makes it searchable in the Stripe dashboard
          metadata: input.jobId ? { job_id: input.jobId } : undefined,
        };
        if (input.paymentMethodTypes && input.paymentMethodTypes.length > 0) {
          createParams.payment_method_types = input.paymentMethodTypes;
          // For card_present (Terminal / Tap to Pay) payments, attach the approved
          // payment method configuration so Stripe knows this account is enabled for Tap to Pay
          if (input.paymentMethodTypes.includes('card_present')) {
            createParams.payment_method_configuration = 'pmc_1TXo8yAchceR25t2ezdohtkN';
          }
        } else {
          createParams.automatic_payment_methods = { enabled: true };
        }
        const paymentIntent = await stripe.paymentIntents.create(createParams);
        return { clientSecret: paymentIntent.client_secret!, paymentIntentId: paymentIntent.id, demo: false, reused: false };
      }),
    getPaymentStatus: publicProcedure
      .input(z.object({ paymentIntentId: z.string() }))
      .query(async ({ input }) => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) return { status: "demo", amount: 0 };
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
        const pi = await stripe.paymentIntents.retrieve(input.paymentIntentId);
        return { status: pi.status, amount: pi.amount, currency: pi.currency };
      }),
    /** Scan a card image and extract card number + expiry using AI vision */
    scanCard: publicProcedure
      .input(z.object({
        imageBase64: z.string(),
        mimeType: z.string().default("image/jpeg"),
      }))
      .mutation(async ({ input }) => {
        const dataUrl = `data:${input.mimeType};base64,${input.imageBase64}`;
        try {
          const result = await invokeLLM({
            messages: [
              {
                role: "user",
                content: [
                  { type: "image_url", image_url: { url: dataUrl, detail: "high" } },
                  { type: "text", text: `You are a card OCR assistant. Extract the payment card details from this image.\nReturn ONLY a JSON object with these fields (no markdown, no explanation):\n{\n  "cardNumber": "the full card number with spaces every 4 digits, e.g. 4111 1111 1111 1111",\n  "expiry": "MM/YY format, e.g. 12/27",\n  "cardholderName": "name on card if visible, else empty string"\n}\nIf you cannot read a field clearly, return an empty string for that field. Never guess.` },
                ],
              },
            ],
          });
          const rawContent = result.choices[0]?.message?.content;
          const text = typeof rawContent === "string" ? rawContent : JSON.stringify(rawContent ?? "{}");
          const cleaned = text.replace(/```json|```/g, "").trim();
          const parsed = JSON.parse(cleaned);
          const digits = (parsed.cardNumber ?? "").replace(/\D/g, "");
          const formatted = digits.replace(/(\d{4})(?=\d)/g, "$1 ").trim();
          return { cardNumber: formatted, expiry: parsed.expiry ?? "", cardholderName: parsed.cardholderName ?? "" };
        } catch {
          return { cardNumber: "", expiry: "", cardholderName: "" };
        }
      }),
    getConnectionToken: publicProcedure
      .mutation(async () => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          return { secret: "demo_connection_token" };
        }
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
        const token = await stripe.terminal.connectionTokens.create();
        return { secret: token.secret };
      }),
    captureTerminalPayment: publicProcedure
      .input(z.object({
        paymentIntentId: z.string(),
      }))
      .mutation(async ({ input }) => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          return { status: "succeeded", demo: true };
        }
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
        const pi = await stripe.paymentIntents.capture(input.paymentIntentId);
        return { status: pi.status, demo: false };
      }),
        refundPayment: publicProcedure
      .input(z.object({
        paymentIntentId: z.string(),
        amountCents: z.number().int().positive().optional(), // omit for full refund
        reason: z.enum(["duplicate", "fraudulent", "requested_by_customer"]).default("requested_by_customer"),
        adminNote: z.string().optional(),
        issuedBy: z.string().default("admin"),
        jobId: z.string().optional(),
        bookingId: z.string().optional(),
        customerName: z.string().optional(),
        customerEmail: z.string().optional(),
        customerPhone: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        const dbConn = await db.getDb();

        // ── Demo mode (no Stripe key) ──────────────────────────────────────
        if (!stripeKey) {
          const demoAmount = input.amountCents ?? 0;
          if (dbConn) {
            const { refundRecords } = await import('../drizzle/schema');
            await dbConn.insert(refundRecords).values({
              refundRecordId: `rr_demo_${Date.now()}`,
              jobId: input.jobId ?? null,
              bookingId: input.bookingId ?? null,
              paymentIntentId: input.paymentIntentId,
              stripeRefundId: 're_demo',
              amountCents: demoAmount,
              reason: input.reason,
              adminNote: input.adminNote ?? null,
              issuedBy: input.issuedBy,
              customerName: input.customerName ?? null,
              customerEmail: input.customerEmail ?? null,
              status: 'succeeded',
            });
          }
          return { refundId: 're_demo', status: 'succeeded', amountCents: demoAmount, demo: true };
        }

        // ── Live Stripe refund ─────────────────────────────────────────────
        const stripe = new Stripe(stripeKey, { apiVersion: '2025-03-31.basil' });
        const refund = await stripe.refunds.create({
          payment_intent: input.paymentIntentId,
          ...(input.amountCents ? { amount: input.amountCents } : {}),
          reason: input.reason,
        });

        // ── Log refund in DB ───────────────────────────────────────────────
        if (dbConn) {
          const { refundRecords } = await import('../drizzle/schema');
          await dbConn.insert(refundRecords).values({
            refundRecordId: `rr_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
            jobId: input.jobId ?? null,
            bookingId: input.bookingId ?? null,
            paymentIntentId: input.paymentIntentId,
            stripeRefundId: refund.id,
            amountCents: refund.amount,
            reason: input.reason,
            adminNote: input.adminNote ?? null,
            issuedBy: input.issuedBy,
            customerName: input.customerName ?? null,
            customerEmail: input.customerEmail ?? null,
            status: refund.status ?? 'succeeded',
          });
        }

        // ── Email customer ─────────────────────────────────────────────────
        if (input.customerEmail) {
          const dollarAmount = (refund.amount / 100).toFixed(2);
          await sendEmail({
            to: input.customerEmail,
            subject: `Refund of $${dollarAmount} Issued — Luxury Wash On Wheels`,
            html: `
              <div style="font-family:sans-serif;max-width:560px;margin:0 auto;padding:24px">
                <h2 style="color:#1A1A1A">You've Been Refunded</h2>
                <p>Hi${input.customerName ? ` ${input.customerName.split(' ')[0]}` : ''},</p>
                <p>A refund of <strong>$${dollarAmount}</strong> has been issued to your original payment method by the Luxury Wash On Wheels team.</p>
                <table style="width:100%;border-collapse:collapse;margin:16px 0">
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Refund Amount</td><td style="padding:8px;border-bottom:1px solid #eee;font-weight:700">$${dollarAmount}</td></tr>
                  <tr><td style="padding:8px;border-bottom:1px solid #eee;color:#666">Stripe Refund ID</td><td style="padding:8px;border-bottom:1px solid #eee;font-family:monospace;font-size:12px">${refund.id}</td></tr>
                  ${input.adminNote ? `<tr><td style="padding:8px;color:#666">Note</td><td style="padding:8px">${input.adminNote}</td></tr>` : ''}
                </table>
                <p style="color:#666;font-size:13px">Refunds typically appear on your statement within 5–10 business days depending on your bank.</p>
                <p style="color:#666;font-size:13px">Questions? Reply to this email or call us.</p>
                <p>— The Luxury Wash On Wheels Team</p>
              </div>
            `,
          });
        }

        // ── SMS customer via Twilio ──────────────────────────────────────────
        if (input.customerPhone) {
          try {
            const twilioSid  = process.env.TWILIO_ACCOUNT_SID;
            const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
            const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
            if (twilioSid && twilioAuth && twilioFrom) {
              const dollarAmount = (refund.amount / 100).toFixed(2);
              const firstName = input.customerName ? input.customerName.split(' ')[0] : 'there';
              const digits = input.customerPhone.replace(/\D/g, '');
              const toNumber = digits.startsWith('1') ? `+${digits}` : `+1${digits}`;
              const smsBody = `Hi ${firstName}, a refund of $${dollarAmount} has been issued to your original payment method by Luxury Wash On Wheels. It typically appears within 5-10 business days. Questions? Call or text us!`;
              const smsParams = new URLSearchParams({ To: toNumber, From: twilioFrom, Body: smsBody });
              await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64')}` },
                body: smsParams.toString(),
              });
            }
          } catch (smsErr) {
            console.error('[Refund] SMS send failed:', smsErr);
          }
        }

        return { refundId: refund.id, status: refund.status, amountCents: refund.amount, demo: false };
      }),

    /** Admin: list all refunds for a specific job or booking */
    listRefunds: publicProcedure
      .input(z.object({
        jobId: z.string().optional(),
        bookingId: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) return [];
        const { refundRecords } = await import('../drizzle/schema');
        const { eq, or } = await import('drizzle-orm');
        const conditions = [];
        if (input.jobId) conditions.push(eq(refundRecords.jobId, input.jobId));
        if (input.bookingId) conditions.push(eq(refundRecords.bookingId, input.bookingId));
        if (conditions.length === 0) return [];
        const rows = await dbConn.select().from(refundRecords)
          .where(or(...conditions))
          .orderBy(refundRecords.createdAt);
        return rows;
      }),
  }),
  salesCallback: router({
    schedule: publicProcedure
      .input(z.object({
        callbackId: z.string(),
        assignedTo: z.string(),
        assignedToName: z.string().optional(),
        prospectFirstName: z.string().min(1),
        prospectLastName: z.string().min(1),
        prospectPhone: z.string().min(7),
        prospectEmail: z.string().email().optional(),
        scheduledAt: z.string(), // ISO datetime string
        timezone: z.string().default("America/Chicago"),
        notes: z.string().optional(),
        createdBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.createSalesCallback({
          callbackId: input.callbackId,
          assignedTo: input.assignedTo,
          assignedToName: input.assignedToName,
          prospectFirstName: input.prospectFirstName,
          prospectLastName: input.prospectLastName,
          prospectPhone: input.prospectPhone,
          prospectEmail: input.prospectEmail,
          scheduledAt: new Date(input.scheduledAt),
          timezone: input.timezone,
          notes: input.notes,
          createdBy: input.createdBy,
        });
        // Trigger GHL webhook asynchronously (don't block response)
        triggerGhlSms(input.callbackId, input.prospectFirstName, input.prospectPhone, input.scheduledAt, input.timezone).catch(console.error);
        return { success: true as const };
      }),
    listMine: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getSalesCallbacksByEmployee(input.employeeId)),
    listAll: publicProcedure.query(async () => db.getAllSalesCallbacks()),
    getById: publicProcedure
      .input(z.object({ callbackId: z.string() }))
      .query(async ({ input }) => db.getSalesCallbackById(input.callbackId)),
    updateStatus: publicProcedure
      .input(z.object({
        callbackId: z.string(),
        status: z.enum(["scheduled", "completed", "missed", "cancelled", "rescheduled"]).optional(),
        completedAt: z.string().optional(),
        outcome: z.string().optional(),
        notes: z.string().optional(),
        scheduledAt: z.string().optional(),
        assignedTo: z.string().optional(),
        assignedToName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { callbackId, ...rest } = input;
        const data: Parameters<typeof db.updateSalesCallbackStatus>[1] = {};
        if (rest.status) data.status = rest.status;
        if (rest.completedAt) data.completedAt = new Date(rest.completedAt);
        if (rest.outcome !== undefined) data.outcome = rest.outcome;
        if (rest.notes !== undefined) data.notes = rest.notes;
        if (rest.scheduledAt) data.scheduledAt = new Date(rest.scheduledAt);
        if (rest.assignedTo) data.assignedTo = rest.assignedTo;
        if (rest.assignedToName) data.assignedToName = rest.assignedToName;
        await db.updateSalesCallbackStatus(callbackId, data);
        return { success: true };
      }),
    listSalesReps: publicProcedure.query(async () => db.getAllSalesReps()),

    /** Detailer submits a field referral — creates a callback assigned to a sales rep */
    submitReferral: publicProcedure
      .input(z.object({
        callbackId: z.string(),
        referredBy: z.string(),
        referredByName: z.string(),
        assignedTo: z.string(),
        assignedToName: z.string().optional(),
        prospectFirstName: z.string().min(1),
        prospectLastName: z.string().min(1),
        prospectPhone: z.string().min(7),
        notes: z.string().optional(),
        timezone: z.string().default("America/Chicago"),
      }))
      .mutation(async ({ input }) => {
        const scheduledAt = new Date(Date.now() + 60 * 60 * 1000);
        await db.createSalesCallback({
          callbackId: input.callbackId,
          assignedTo: input.assignedTo,
          assignedToName: input.assignedToName,
          prospectFirstName: input.prospectFirstName,
          prospectLastName: input.prospectLastName,
          prospectPhone: input.prospectPhone,
          scheduledAt,
          timezone: input.timezone,
          notes: input.notes,
          createdBy: input.referredBy,
          source: "detailer_referral" as const,
          referredBy: input.referredBy,
          referredByName: input.referredByName,
        });
        try {
          const rep = await db.getEmployeeById(input.assignedTo);
          if (rep?.pushToken) {
            await fetch("https://exp.host/--/api/v2/push/send", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                to: rep.pushToken,
                title: "📋 New Field Referral",
                body: `${input.referredByName} referred ${input.prospectFirstName} ${input.prospectLastName} — tap to call`,
                data: { screen: "callbacks" },
                sound: "default",
              }),
            });
          }
        } catch (_e) { /* non-blocking */ }
        return { success: true as const };
      }),
  }),
  // ─── Schedule Jobs ─────────────────────────────────────────────────────────
  jobs: router({
    /** Upsert (create or update) a job — called when admin/detailer saves a job in the app */
    upsert: publicProcedure
      .input(z.object({
        jobId: z.string(),
        location: z.string(),
        date: z.string(),
        timeSlot: z.string().optional(),
        startHour: z.number().optional(),
        endHour: z.number().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        customerEmail: z.string().optional(),
        vehicleType: z.string().optional(),
        vehicleColor: z.string().optional(),
        vehicleYear: z.string().optional(),
        vehicleMake: z.string().optional(),
        vehicleModel: z.string().optional(),
        packageType: z.string().optional(),
        serviceDescription: z.string().optional(),
        selectedAddons: z.string().optional(),
        totalPrice: z.number().optional(),
        tips: z.number().optional(),
        assignedTo: z.string().optional(),
        status: z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled"]).optional(),
        source: z.enum(["manual", "online"]).optional(),
        onlineBookingId: z.string().optional(),
        notes: z.string().optional(),
        customerAddress: z.string().optional(),
        additionalVehicles: z.string().optional(), // JSON string of AdditionalVehicle[]
        createdBy: z.string().optional(),
        upsellTotal: z.number().optional(),
        customPrice: z.number().nullable().optional(), // per-booking price override (admin only)
        notifyCustomer: z.boolean().optional(), // if false, suppress confirmation email
        isNewCustomer: z.boolean().optional(), // true = first-time customer badge for detailers
        discountCode: z.string().optional(),
        discountAmount: z.number().optional(),
        recommendedServices: z.string().optional(), // JSON array of addon IDs recommended for next visit
        paymentMethod: z.string().optional(), // e.g. "cash", "card", "check", "zelle", "venmo"
        paymentTotal: z.number().optional(), // amount paid (defaults to totalPrice if not specified)
      }))
      .mutation(async ({ input }) => {
        const data: import("../drizzle/schema").InsertScheduleJob = {
          jobId: input.jobId,
          location: input.location,
          date: input.date,
          timeSlot: input.timeSlot,
          startHour: input.startHour != null ? String(input.startHour) : undefined,
          endHour: input.endHour != null ? String(input.endHour) : undefined,
          customerName: input.customerName,
          customerPhone: input.customerPhone,
          customerEmail: input.customerEmail,
          vehicleType: input.vehicleType,
          vehicleColor: input.vehicleColor,
          vehicleYear: input.vehicleYear,
          vehicleMake: input.vehicleMake,
          vehicleModel: input.vehicleModel,
          packageType: input.packageType,
          serviceDescription: input.serviceDescription,
          selectedAddons: input.selectedAddons,
          totalPrice: input.totalPrice !== undefined ? String(input.totalPrice) : undefined,
          tips: input.tips !== undefined ? String(input.tips) : "0",
          assignedTo: input.assignedTo,
          status: input.status ?? "confirmed",
          source: input.source ?? "manual",
          onlineBookingId: input.onlineBookingId,
          notes: input.notes,
          customerAddress: input.customerAddress,
          additionalVehicles: input.additionalVehicles,
          createdBy: input.createdBy,
          upsellTotal: input.upsellTotal !== undefined ? String(input.upsellTotal) : undefined,
          customPrice: input.customPrice != null ? String(input.customPrice) : undefined,
          discountCode: input.discountCode,
          discountAmount: input.discountAmount !== undefined ? String(input.discountAmount) : undefined,
          recommendedServices: input.recommendedServices,
          isNewCustomer: input.isNewCustomer ? 1 : 0,
          paymentMethod: input.paymentMethod ?? undefined,
          paymentTotal: input.paymentMethod ? String(input.paymentTotal ?? input.totalPrice ?? 0) : undefined,
          paymentPaidAt: input.paymentMethod ? new Date().toISOString() : undefined,
        };
        // ── Save the job first (without customerId) ──────────────────────────
        // Detect if this is a new job (for push notification)
        const existingJob = await db.getScheduleJobById(input.jobId).catch(() => null);
        const isNewJob = !existingJob;
        // Detect reschedule: existing job with different date or timeSlot
        const isReschedule = !isNewJob && existingJob &&
          (existingJob.date !== input.date || existingJob.timeSlot !== input.timeSlot);
        // Detect reassignment: existing job where assignedTo changed to a new detailer
        const isReassignment = !isNewJob && existingJob && input.assignedTo &&
          existingJob.assignedTo !== input.assignedTo;
        await db.upsertScheduleJob(data);


        // ── Sync changes back to customer_bookings (portal ↔ admin two-way sync) ──
        // When admin edits a portal-originated job, mirror date/time/status/package
        // back to customer_bookings so the customer portal stays accurate.
        if (input.onlineBookingId || (existingJob?.onlineBookingId && existingJob.onlineBookingId.startsWith('bk_'))) {
          try {
            const portalRef = input.onlineBookingId ?? existingJob?.onlineBookingId;
            if (portalRef) {
              const { customerBookings: cbSync } = await import('../drizzle/schema');
              const { eq: eqSync } = await import('drizzle-orm');
              const dbSync = await db.getDb();
              if (dbSync) {
                const syncFields: Record<string, string | null> = {};
                if (input.date) syncFields.scheduledDate = input.date;
                if (input.timeSlot) syncFields.scheduledTime = input.timeSlot;
                if (input.packageType) syncFields.packageName = input.packageType;
                if (input.customerAddress) syncFields.addressLabel = input.customerAddress;
                if (input.assignedTo) syncFields.assignedEmployeeId = input.assignedTo;
                // Mirror status: in_progress → in_progress, completed → completed, cancelled → cancelled, confirmed → confirmed
                if (input.status === 'in_progress') syncFields.status = 'in_progress';
                else if (input.status === 'completed') syncFields.status = 'completed';
                else if (input.status === 'cancelled') syncFields.status = 'cancelled';
                else if (input.status === 'confirmed' && !isNewJob) syncFields.status = 'confirmed';
                if (Object.keys(syncFields).length > 0) {
                  await dbSync.update(cbSync).set(syncFields as any).where(eqSync(cbSync.bookingRef, portalRef));
                }
              }
            }
          } catch (syncErr) {
            console.error('[jobs.upsert] customer_bookings sync failed (non-blocking):', syncErr);
          }
        }

        // ── Sync changes back to online_bookings (admin → online_bookings two-way sync) ──
        // When admin edits a job that originated from an online booking, mirror date/time/status
        // back to online_bookings so the detailer sync stays consistent.
        if (existingJob?.jobId?.startsWith('online_')) {
          try {
            const obId = existingJob.jobId.replace(/^online_/, '');
            const { onlineBookings: obSync } = await import('../drizzle/schema');
            const { eq: eqObSync } = await import('drizzle-orm');
            const dbObSync = await db.getDb();
            if (dbObSync) {
              const obFields: Record<string, any> = {};
              if (input.date) obFields.bookingDate = input.date;
              if (input.timeSlot) obFields.timeSlot = input.timeSlot;
              if (input.startHour != null) obFields.startHour = String(input.startHour);
              if (input.endHour != null) obFields.endHour = String(input.endHour);
              if (input.status === 'cancelled') obFields.status = 'cancelled';
              else if (input.status === 'completed') obFields.status = 'completed';
              if (input.assignedTo) obFields.assignedTo = input.assignedTo;
              if (Object.keys(obFields).length > 0) {
                await dbObSync.update(obSync).set(obFields as any).where(eqObSync(obSync.bookingId, obId));
              }
            }
          } catch (obSyncErr) {
            console.error('[jobs.upsert] online_bookings sync failed (non-blocking):', obSyncErr);
          }
        }

        // ── Auto-link / create a customer profile ──────────────────────────────
        // Runs whenever the job has at least an email or phone number.
        // Uses find-or-create with email-first dedup so we never create duplicates.
        if (input.customerEmail || input.customerPhone) {
          try {
            const linkedCustomerId = await findOrCreateManualCustomer({
              customerName: input.customerName,
              customerEmail: input.customerEmail,
              customerPhone: input.customerPhone,
            });
            if (linkedCustomerId) {
              // Re-upsert the job with the resolved customerId linked
              await db.upsertScheduleJob({ ...data, customerId: linkedCustomerId });
            }
          } catch (e) {
            console.error("[jobs.upsert] customer link failed (non-blocking):", e);
          }
        }
        // ── Auto-promote any matching abandoned cart to confirmed ────────────────
        // When an admin manually creates a job for a customer who had an abandoned cart,
        // mark their abandoned record(s) as confirmed so they no longer appear in the pipeline.
        if (input.customerPhone || input.customerEmail) {
          try {
            const { onlineBookings: obTable } = await import('../drizzle/schema.js');
            const { and: andOb, or: orOb, eq: eqOb, like: likeOb } = await import('drizzle-orm');
            const drizzleDbOb = await db.getDb();
            if (drizzleDbOb) {
              const normPhone = input.customerPhone ? input.customerPhone.replace(/\D/g, '').slice(-10) : null;
              const matchConds: any[] = [];
              if (normPhone && normPhone.length === 10) {
                matchConds.push(likeOb(obTable.phone, `%${normPhone}`));
              }
              if (input.customerEmail) {
                matchConds.push(eqOb(obTable.email, input.customerEmail.toLowerCase()));
              }
              if (matchConds.length > 0) {
                const abandonedCarts = await (drizzleDbOb.select({ bookingId: obTable.bookingId }) as any)
                  .from(obTable)
                  .where(andOb(eqOb(obTable.status as any, 'abandoned'), orOb(...matchConds)))
                  .limit(10);
                for (const cart of abandonedCarts) {
                  await (drizzleDbOb.update(obTable) as any)
                    .set({ status: 'confirmed' })
                    .where(eqOb(obTable.bookingId, cart.bookingId));
                  console.log(`[jobs.upsert] Auto-promoted abandoned cart ${cart.bookingId} to confirmed`);
                }
              }
            }
          } catch (promoteErr) {
            console.error('[jobs.upsert] Failed to auto-promote abandoned cart:', promoteErr);
          }
        }
        // Auto-record sales performance when a sales rep creates a booking
        if (input.createdBy) {
          try {
            const rep = await db.getEmployeeById(input.createdBy);
            if (rep && rep.role === "sales") {
              // Always use TODAY as the booking date (not the scheduled job date)
              // so "Jobs Booked Today" reflects when the booking was made, not when the job is scheduled
              await db.upsertSalesPerformance({
                employeeId: rep.employeeId,
                fullName: rep.fullName,
                date: db.todayCST(),
                jobsBookedDelta: 1,
                revenueDelta: input.totalPrice ?? 0,
                lastJobId: input.jobId,
              });
            }
          } catch { /* fail silently — don't block job creation */ }
        }
        // ── Send booking confirmation email to customer (if notifyCustomer !== false) ──
        // Only send when the job has a customer email and the caller has not opted out.
        // Fall back to existing DB record for email/name/address if not passed in input (e.g. reschedule from admin).
        const notifyEmail = input.customerEmail || existingJob?.customerEmail || undefined;
        const notifyName = input.customerName || existingJob?.customerName || undefined;
        const notifyAddress = input.customerAddress || existingJob?.customerAddress || undefined;
        const notifyPackageType = input.packageType || existingJob?.packageType || undefined;
        const notifyTotalPrice = input.totalPrice ?? (existingJob?.totalPrice ? parseFloat(existingJob.totalPrice) : undefined);
        const notifyStartHour = input.startHour ?? (existingJob?.startHour ? parseInt(existingJob.startHour) : undefined);
        const notifyEndHour = input.endHour ?? (existingJob?.endHour ? parseInt(existingJob.endHour) : undefined);
        const notifyDate = input.date || existingJob?.date || undefined;
        if (input.notifyCustomer === true && notifyEmail) {
          try {
            const customerName = notifyName || "Valued Customer";
            // Format a human-readable time string from startHour/endHour or fall back to timeSlot
            const fmtHour = (h: number) => {
              const period = h >= 12 ? "PM" : "AM";
              const hr = h > 12 ? h - 12 : h === 0 ? 12 : h;
              return `${hr}:00 ${period}`;
            };
            const scheduledTime = (notifyStartHour !== undefined && notifyEndHour !== undefined)
              ? `${fmtHour(notifyStartHour)} – ${fmtHour(notifyEndHour)}`
              : (input.timeSlot ?? existingJob?.timeSlot ?? "TBD");
            // Format date as "Monday, May 26, 2026"
            const scheduledDate = (() => {
              try {
                const d = new Date((notifyDate ?? input.date) + "T12:00:00");
                return d.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
              } catch { return notifyDate ?? input.date; }
            })();
            const packageName = await db.resolvePackageNameAsync(notifyPackageType) || input.serviceDescription || existingJob?.serviceDescription || "Detail Service";
            // Parse add-ons from JSON string if present
            let addons: string[] | undefined;
            if (input.selectedAddons) {
              try {
                const parsed = JSON.parse(input.selectedAddons);
                if (Array.isArray(parsed)) addons = parsed.map((a: any) => typeof a === "string" ? a : (a.title ?? a.name ?? String(a)));
              } catch { /* ignore */ }
            }
            // Build multi-vehicle list for the email
            const primaryVehicleLabel = [input.vehicleYear, input.vehicleMake, input.vehicleModel, input.vehicleColor].filter(Boolean).join(" ") || input.vehicleType || "";
            let emailVehicles: { label: string; packageName: string }[] | undefined;
            if (input.additionalVehicles) {
              try {
                const extraVehicles = JSON.parse(input.additionalVehicles) as Array<{ vehicleType?: string; vehicleYear?: string; vehicleMake?: string; vehicleModel?: string; vehicleColor?: string; packageId?: string; }>;
                if (Array.isArray(extraVehicles) && extraVehicles.length > 0) {
                  const resolvedExtras = await Promise.all(extraVehicles.map(async (v) => ({
                    label: [v.vehicleYear, v.vehicleMake, v.vehicleModel, v.vehicleColor].filter(Boolean).join(" ") || v.vehicleType || "Vehicle",
                    packageName: (await db.resolvePackageNameAsync(v.packageId).catch(() => null)) || v.packageId || "",
                  })));
                  emailVehicles = [
                    { label: primaryVehicleLabel, packageName },
                    ...resolvedExtras,
                  ];
                }
              } catch { /* fall back to single vehicle */ }
            }
            const basePrice = notifyTotalPrice ?? 0;
            const discAmt = input.discountAmount ?? 0;
            // Detect reschedule vs new booking for subject line
            const isRescheduleEmail = !isNewJob;
            const { subject, html } = buildBookingConfirmationEmail({
              customerName,
              bookingRef: input.jobId,
              packageName,
              vehicleLabel: emailVehicles ? undefined : (primaryVehicleLabel || undefined),
              vehicles: emailVehicles,
              scheduledDate,
              scheduledTime,
              addressLabel: notifyAddress || undefined,
              addons,
              total: discAmt > 0 ? Math.max(0, basePrice - discAmt) : basePrice,
              originalTotal: discAmt > 0 ? basePrice : undefined,
              discountAmount: discAmt > 0 ? discAmt : undefined,
              discountCode: input.discountCode || undefined,
              notes: input.notes || existingJob?.notes || undefined,
              isReschedule: isRescheduleEmail,
            });
            await sendEmail({
              to: notifyEmail!,
              subject,
              html,
              type: "booking_confirmation",
              customerName,
              bookingRef: input.jobId,
            });
            console.log(`[jobs.upsert] ${isRescheduleEmail ? 'Reschedule' : 'Confirmation'} email sent to ${notifyEmail}`);
          } catch (emailErr) {
            console.error("[jobs.upsert] Failed to send confirmation email:", emailErr);
          }
        }
        // ── Job event: push notification to assigned detailer only ──────────
        if (isNewJob || isReschedule || isReassignment) {
          try {
            const { jobEvents: jobEventsTable, employees: empTable } = await import('../drizzle/schema');
            const { eq: eqOp } = await import('drizzle-orm');
            const drizzleDb = await db.getDb();
            if (drizzleDb) {
              const eventType = isNewJob ? 'created' : isReassignment ? 'reassigned' : 'rescheduled';
              await drizzleDb.insert(jobEventsTable).values({
                jobId: input.jobId,
                eventType,
                customerName: input.customerName,
                location: input.location,
                dateStr: input.date,
                timeSlot: input.timeSlot,
                assignedTo: input.assignedTo,
              });
              const custName = input.customerName || 'A customer';
              const pushTitle = eventType === 'created' ? '📋 New Job Booked' : eventType === 'reassigned' ? '📋 Job Assigned to You' : '🔄 Job Rescheduled';
              const pushBody = eventType === 'created'
                ? `${custName} · ${input.date ?? ''} ${input.timeSlot ?? ''} · ${input.packageType ?? input.serviceDescription ?? 'Detail Service'}`.trim()
                : eventType === 'reassigned'
                  ? `${custName} · ${input.date ?? ''} ${input.timeSlot ?? ''} · ${input.packageType ?? input.serviceDescription ?? 'Detail Service'}`.trim()
                  : `${custName} moved to ${input.date ?? ''} ${input.timeSlot ?? ''}`.trim();
              const pushData = {
                screen: eventType === 'created' ? 'new_bookings' : 'job_detail',
                jobId: input.jobId,
                date: input.date,
                timeSlot: input.timeSlot,
                customerName: input.customerName,
                packageType: input.packageType ?? input.serviceDescription ?? '',
                location: input.location,
                eventType,
              };

              // 1. Push to assigned detailer only
              if (input.assignedTo) {
                const { or: orOp, like: likeOp } = await import('drizzle-orm');
                const empRows = await drizzleDb
                  .select({ pushToken: empTable.pushToken, employeeId: empTable.employeeId })
                  .from(empTable)
                  .where(orOp(
                    eqOp(empTable.employeeId, input.assignedTo),
                    eqOp(empTable.fullName, input.assignedTo),
                    likeOp(empTable.fullName, `%${input.assignedTo}%`),
                    likeOp(empTable.employeeId, `%${input.assignedTo.toUpperCase()}%`),
                  ))
                  .limit(3);
                const assignedEmp = empRows.find(e => e.employeeId === input.assignedTo) ?? empRows[0];
                const detailerToken = assignedEmp?.pushToken;
                if (detailerToken && (detailerToken.startsWith('ExponentPushToken[') || detailerToken.startsWith('ExpoPushToken['))) {
                  const detailerTitle = eventType === 'created' || eventType === 'reassigned' ? '📋 New Job Assigned' : '🔄 Job Rescheduled';
                  await fetch('https://exp.host/--/api/v2/push/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([{ to: detailerToken, title: detailerTitle, body: pushBody, sound: 'default', data: pushData }]),
                  });
                }
              }

              // 2. Push to admins and ops managers only (not all detailers)
              if (eventType === 'created') {
                const { inArray: inArrayOp } = await import('drizzle-orm');
                const adminRows = await drizzleDb
                  .select({ pushToken: empTable.pushToken, employeeId: empTable.employeeId })
                  .from(empTable)
                  .where(inArrayOp(empTable.role, ['admin', 'office', 'operations_manager']));
                const adminTokens = adminRows
                  .map(r => r.pushToken)
                  .filter((t): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
                if (adminTokens.length > 0) {
                  await fetch('https://exp.host/--/api/v2/push/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(adminTokens.map(to => ({ to, title: pushTitle, body: pushBody, sound: 'default', data: pushData }))),
                  });
                }
              }
            }
          } catch (pushErr) {
            console.error('[jobs.upsert] job event push failed:', pushErr);
          }
        }
        return { success: true as const };
      }),
    /** List jobs for a location and date range. Pass assignedTo to filter by detailer (detailer view). */
    listByLocation: publicProcedure
      .input(z.object({
        location: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        assignedTo: z.string().optional(), // if provided, only return jobs for this detailer
      }))
      .query(async ({ input }) =>
        db.getScheduleJobsByLocationAndDateRange(input.location, input.startDate, input.endDate, input.assignedTo)
      ),
    /** List all jobs across all locations for a date range (admin) */
    listAll: publicProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) =>
        db.getAllScheduleJobsByDateRange(input.startDate, input.endDate)
      ),
    /** List jobs created (booked) in the last N days, sorted newest first — used by the Recently Booked screen */
    listRecentlyBooked: publicProcedure
      .input(z.object({ days: z.number().min(1).max(90).default(7) }))
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const { scheduleJobs: sjTable } = await import('../drizzle/schema.js');
        const { gte, desc, ne } = await import('drizzle-orm');
        const cutoff = new Date();
        cutoff.setDate(cutoff.getDate() - input.days);
        const rows = await drizzleDb
          .select()
          .from(sjTable)
          .where(gte(sjTable.createdAt, cutoff))
          .orderBy(desc(sjTable.createdAt))
          .limit(200);
        return rows.filter(r => r.status !== 'cancelled');
      }),
    /** Cancel a job — marks it as cancelled (stays in history with Cancelled badge) */
    cancel: publicProcedure
      .input(z.object({ jobId: z.string(), customerName: z.string().optional(), location: z.string().optional(), dateStr: z.string().optional(), timeSlot: z.string().optional() }))
      .mutation(async ({ input }) => {
        const jobInfo = await db.getScheduleJobById(input.jobId).catch(() => null);
        await db.cancelScheduleJob(input.jobId);
        // Push notification to all detailers/admins
        try {
          const { jobEvents: jobEventsTable, employees: empTable } = await import('../drizzle/schema');
          const drizzleDb = await db.getDb();
          if (drizzleDb) {
            await drizzleDb.insert(jobEventsTable).values({
              jobId: input.jobId,
              eventType: 'cancelled',
              customerName: jobInfo?.customerName ?? input.customerName,
              location: jobInfo?.location ?? input.location,
              dateStr: jobInfo?.date ?? input.dateStr,
              timeSlot: jobInfo?.timeSlot ?? input.timeSlot,
              assignedTo: jobInfo?.assignedTo,
            });
            const allEmps = await drizzleDb.select({ pushToken: empTable.pushToken, role: empTable.role }).from(empTable);
            const tokens = allEmps
              .filter((e: any) => e.role === 'detailer' || e.role === 'admin' || e.role === 'operations_manager')
              .map((e: any) => e.pushToken)
              .filter((t: any): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              const custName = jobInfo?.customerName ?? input.customerName ?? 'A job';
              const pushBody = `${custName} — ${jobInfo?.location ?? input.location ?? ''} ${jobInfo?.date ?? input.dateStr ?? ''}`.trim();
              const pushPayloads = tokens.map((to: string) => ({ to, title: '❌ Job Cancelled', body: pushBody, sound: 'default', data: { screen: 'schedule', eventType: 'cancelled' } }));
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pushPayloads),
              });
            }
          }
        } catch (pushErr) {
          console.error('[jobs.cancel] job event push failed:', pushErr);
        }
        return { success: true as const };
      }),
    /** Hard-delete a job — completely removes it from all views (admin, detailer, customer portal) */
    delete: publicProcedure
      .input(z.object({ jobId: z.string(), customerName: z.string().optional(), location: z.string().optional(), dateStr: z.string().optional(), timeSlot: z.string().optional() }))
      .mutation(async ({ input }) => {
        // Fetch job info before deleting (for push notification)
        const jobInfo = await db.getScheduleJobById(input.jobId).catch(() => null);
        await db.deleteScheduleJob(input.jobId);
        // Push notification to all detailers/admins
        try {
          const { jobEvents: jobEventsTable, employees: empTable } = await import('../drizzle/schema');
          const drizzleDb = await db.getDb();
          if (drizzleDb) {
            await drizzleDb.insert(jobEventsTable).values({
              jobId: input.jobId,
              eventType: 'cancelled',
              customerName: jobInfo?.customerName ?? input.customerName,
              location: jobInfo?.location ?? input.location,
              dateStr: jobInfo?.date ?? input.dateStr,
              timeSlot: jobInfo?.timeSlot ?? input.timeSlot,
              assignedTo: jobInfo?.assignedTo,
            });
            const allEmps = await drizzleDb.select({ pushToken: empTable.pushToken, role: empTable.role }).from(empTable);
            const tokens = allEmps
              .filter((e: any) => e.role === 'detailer' || e.role === 'admin' || e.role === 'operations_manager')
              .map((e: any) => e.pushToken)
              .filter((t: any): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              const custName = jobInfo?.customerName ?? input.customerName ?? 'A job';
              const pushBody = `${custName} — ${jobInfo?.location ?? input.location ?? ''} ${jobInfo?.date ?? input.dateStr ?? ''}`.trim();
              const pushPayloads = tokens.map((to: string) => ({ to, title: '❌ Job Deleted', body: pushBody, sound: 'default', data: { screen: 'schedule', eventType: 'cancelled' } }));
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pushPayloads),
              });
            }
          }
        } catch (pushErr) {
          console.error('[jobs.delete] job event push failed:', pushErr);
        }
        return { success: true as const };
      }),
    /** Delete recurring series — mode "all" removes all non-completed instances,
     * mode "future" removes non-completed instances from fromDate onwards */
    deleteRecurringSeries: publicProcedure
      .input(z.object({
        recurrenceParentId: z.string(),
        mode: z.enum(["all", "future"]),
        fromDate: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.deleteRecurringSeries(input.recurrenceParentId, input.mode, input.fromDate);
        return { success: true as const };
      }),
    /** Cancel recurring series (sets status to cancelled, preserves history) */
    cancelRecurringSeries: publicProcedure
      .input(z.object({
        recurrenceParentId: z.string(),
        mode: z.enum(["all", "future", "single"]),
        fromDate: z.string().optional(),
        jobId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.cancelRecurringSeries(input.recurrenceParentId, input.mode, input.fromDate, input.jobId);
        return { success: true as const };
      }),
    /** Update job status (and optionally tips) */
    updateStatus: publicProcedure
      .input(z.object({
        jobId: z.string(),
        status: z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled"]),
        tips: z.number().optional(),
        upsellTotal: z.number().optional(),
        totalPrice: z.number().optional(),
        upsellIds: z.array(z.string()).optional(),
        upsellQtys: z.record(z.string(), z.number()).optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateScheduleJobStatus(input.jobId, input.status, input.tips, input.upsellTotal, input.totalPrice, input.upsellIds, input.upsellQtys);
        // Send push notification to matching customer portal account
        try {
          const job = await db.getScheduleJobById(input.jobId);
          if (job) {
            const resolvedPkgName = await db.resolvePackageNameAsync(job.packageType as string | null);
            const NOTIFY_STATUSES: Record<string, { title: string; body: (j: any) => string }> = {
              confirmed:   { title: "Booking Confirmed ✅", body: (_j) => `Your ${resolvedPkgName} on ${job.date} has been confirmed!` },
              in_progress: { title: "We're Working on Your Car 🚗", body: (_j) => `Your ${resolvedPkgName} is now in progress.` },
              completed:   { title: "Your Detail is Complete! ✨", body: (_j) => `Your ${resolvedPkgName} is done. Tap to leave a quick review — it means the world to us! ⭐` },
            };
            const notifConfig = NOTIFY_STATUSES[input.status];
            if (notifConfig) {
              let matchedCustomer = null;
              if (job.customerEmail) matchedCustomer = await customerDb.getCustomerByEmail(job.customerEmail);
              if (!matchedCustomer && job.customerPhone) matchedCustomer = await customerDb.getCustomerByPhone(job.customerPhone);
              if (matchedCustomer?.customerId) {
                // For 'completed' status, include review data so the customer app can show the review overlay
                const pushData: Record<string, string> | undefined = input.status === 'completed' ? {
                  screen: 'review',
                  jobId: input.jobId,
                  city: (job.location as string) ?? '',
                  detailerName: (job.assignedTo as string) ?? '',
                } : undefined;
                await customerDb.sendCustomerPushNotification(
                  matchedCustomer.customerId,
                  notifConfig.title,
                  notifConfig.body(job),
                  pushData
                );
              }
            }
          }
        } catch (e) {
          console.error('[push] Failed to notify customer on status change:', e);
        }

        // ── Notify admins when job is completed ──────────────────────────────────
        if (input.status === 'completed') {
          try {
            const completedJob = await db.getScheduleJobById(input.jobId);
            if (completedJob) {
              const drizzleDb = await db.getDb();
              if (drizzleDb) {
                const { employees: empTableAdmin } = await import('../drizzle/schema.js');
                const { inArray: inArrayAdmin } = await import('drizzle-orm');
                const adminRows = await drizzleDb
                  .select({ pushToken: empTableAdmin.pushToken })
                  .from(empTableAdmin)
                  .where(inArrayAdmin(empTableAdmin.role, ['admin', 'office', 'operations_manager']));
                const adminTokens = adminRows
                  .map((r: any) => r.pushToken)
                  .filter((t: any): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
                if (adminTokens.length > 0) {
                  const cName = (completedJob.customerName as string) ?? 'Customer';
                  const cPackage = await db.resolvePackageNameAsync(completedJob.packageType as string | null);
                  const cLocation = (completedJob.location as string) ?? '';
                  const cDetailer = (completedJob.assignedTo as string) ?? 'Detailer';
                  await fetch('https://exp.host/--/api/v2/push/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(adminTokens.map((to: string) => ({
                      to,
                      title: '\u2705 Job Completed',
                      body: `${cName}'s ${cPackage} in ${cLocation} completed by ${cDetailer}.`,
                      sound: 'default',
                      data: { screen: 'schedule', jobId: input.jobId },
                    }))),
                  });
                }
              }
            }
          } catch (e) {
            console.error('[push] Failed to notify admins on job completion:', e);
          }
        }

        // ── Auto-spawn next job for neverEnds recurring series ──────────────────
        if (input.status === 'completed') {
          try {
            const job = await db.getScheduleJobById(input.jobId);
            if (job && job.recurrenceRule && job.recurrenceParentId) {
              let rule: any;
              try { rule = JSON.parse(job.recurrenceRule as string); } catch { rule = null; }
              if (rule && rule.neverEnds === true) {
                // Compute the next occurrence date after this job's date
                const toDateStr = (d: Date) => {
                  const y = d.getFullYear();
                  const m = String(d.getMonth() + 1).padStart(2, '0');
                  const day = String(d.getDate()).padStart(2, '0');
                  return `${y}-${m}-${day}`;
                };
                const getOrdinalDate = (from: Date, dow: number, ordinal: number): Date => {
                  const d = new Date(from); d.setDate(1);
                  const month = d.getMonth();
                  const occ: Date[] = [];
                  const tmp = new Date(d);
                  while (tmp.getMonth() === month) {
                    if (tmp.getDay() === dow) occ.push(new Date(tmp));
                    tmp.setDate(tmp.getDate() + 1);
                  }
                  if (ordinal === -1) return occ[occ.length - 1] ?? d;
                  return occ[(ordinal - 1) % occ.length] ?? d;
                };
                const cur = new Date((job.date as string) + 'T12:00:00');
                const ruleType = rule.type as string;
                const targetDow = rule.dayOfWeek ?? cur.getDay();
                const ordinal = rule.ordinal ?? 1;
                let nextDate: Date;
                if (ruleType === 'weekly') {
                  nextDate = new Date(cur); nextDate.setDate(cur.getDate() + 7);
                } else if (ruleType === 'biweekly') {
                  nextDate = new Date(cur); nextDate.setDate(cur.getDate() + 14);
                } else if (ruleType === 'monthly_date') {
                  nextDate = new Date(cur); nextDate.setMonth(cur.getMonth() + 1);
                } else {
                  // monthly_ordinal
                  nextDate = new Date(cur); nextDate.setMonth(cur.getMonth() + 1);
                  nextDate = getOrdinalDate(nextDate, targetDow, ordinal);
                }
                const nextDateStr = toDateStr(nextDate);
                // Only spawn if this date doesn't already exist in the series
                const existingSeries = await db.getJobsByRecurrenceParent(job.recurrenceParentId as string);
                const alreadyExists = (existingSeries as any[]).some((j: any) => j.date === nextDateStr);
                if (!alreadyExists) {
                  const newJobId = `${job.recurrenceParentId}_spawn_${Date.now()}`;
                  await db.upsertScheduleJob({
                    jobId: newJobId,
                    location: job.location as string,
                    date: nextDateStr,
                    timeSlot: job.timeSlot as string,
                    startHour: job.startHour as string | undefined,
                    endHour: job.endHour as string | undefined,
                    customerName: job.customerName as string,
                    customerPhone: job.customerPhone as string | undefined,
                    customerEmail: job.customerEmail as string | undefined,
                    vehicleType: job.vehicleType as string | undefined,
                    packageType: job.packageType as string | undefined,
                    serviceDescription: job.serviceDescription as string | undefined,
                    selectedAddons: job.selectedAddons as string | undefined,
                    totalPrice: job.totalPrice as string | undefined,
                    assignedTo: job.assignedTo as string | undefined,
                    customerAddress: job.customerAddress as string | undefined,
                    additionalVehicles: job.additionalVehicles as string | undefined,
                    createdBy: job.createdBy as string | undefined,
                    status: 'confirmed',
                    source: (job.source as 'manual' | 'online') ?? 'manual',
                    customPrice: job.customPrice as string | undefined,
                    discountCode: job.discountCode as string | undefined,
                    discountAmount: job.discountAmount as string | undefined,
                    recurrenceRule: job.recurrenceRule as string,
                    recurrenceParentId: job.recurrenceParentId as string,
                  });
                  console.log(`[neverEnds] Spawned next job ${newJobId} for series ${job.recurrenceParentId} on ${nextDateStr}`);
                }
              }
            }
          } catch (e) {
            console.error('[neverEnds] Failed to auto-spawn next job:', e);
          }
        }

        return { success: true as const };
      }),
    /** Stamp on_my_way_at or arrived_at on a job when detailer taps the status button */
    stampTimestamp: publicProcedure
      .input(z.object({
        jobId: z.string(),
        field: z.enum(["onMyWayAt", "arrivedAt", "finishedAt"]),
        timestamp: z.string(), // ISO string from client
      }))
      .mutation(async ({ input }) => {
        await db.stampJobTimestamp(input.jobId, input.field, new Date(input.timestamp));

        // ── Queue review request email 1 hour after job is finished ──────────
        if (input.field === "finishedAt") {
          try {
            const job = await db.getScheduleJobById(input.jobId);
            // Look up detailer name once, shared by email + push blocks
            const assignedToOuter = (job as any)?.assignedTo as string ?? "";
            let detailerFirstNameOuter = "your detailer";
            if (assignedToOuter) {
              try {
                const emp = await db.getEmployeeById(assignedToOuter);
                if (emp?.fullName) detailerFirstNameOuter = emp.fullName.split(" ")[0] || emp.fullName;
              } catch { /* fallback */ }
            }
            // ── Send immediate push notification to customer ──────────────────
            if (job) {
              try {
                let matchedCustomer = null;
                if ((job as any).customerEmail) matchedCustomer = await customerDb.getCustomerByEmail((job as any).customerEmail as string);
                if (!matchedCustomer && (job as any).customerPhone) matchedCustomer = await customerDb.getCustomerByPhone((job as any).customerPhone as string);
                if (matchedCustomer?.customerId) {
                  await customerDb.sendCustomerPushNotification(
                    matchedCustomer.customerId,
                    '✨ Your Detail is Complete!',
                    `${detailerFirstNameOuter} has finished your vehicle. Tap to leave a review!`,
                    {
                      screen: 'review',
                      jobId: input.jobId,
                      city: (job as any).location as string ?? '',
                      detailerName: (job as any).assignedTo as string ?? detailerFirstNameOuter,
                    }
                  );
                  console.log(`[ReviewPush] Sent review push to customer ${matchedCustomer.customerId}`);
                }
              } catch (pushErr) {
                console.error('[ReviewPush] Failed to send review push:', pushErr);
              }
            }
            if (job && (job as any).customerEmail) {
              const customerEmail = (job as any).customerEmail as string;
              const customerName = (job as any).customerName as string ?? "Valued Customer";
              const city = (job as any).location as string ?? "";
              const packageType = (job as any).packageType as string ?? "detail";
              const serviceType = await db.resolvePackageNameAsync(packageType);
              // Look up detailer's actual first name from the employees table
              const assignedTo = (job as any).assignedTo as string ?? "";
              let detailerFirstName = "your detailer";
              if (assignedTo) {
                try {
                  const detailerEmp = await db.getEmployeeById(assignedTo);
                  if (detailerEmp?.fullName) {
                    detailerFirstName = detailerEmp.fullName.split(" ")[0] || detailerEmp.fullName;
                  }
                } catch { /* fallback to default */ }
              }
              const reviewLink = getReviewLinkForCity(city);
              const { subject, html } = buildReviewRequestEmail({
                customerName,
                detailerFirstName,
                serviceType,
                city,
                reviewLink,
              });
              // Schedule for 1 hour from now
              const sendAfter = new Date(Date.now() + 60 * 60 * 1000);
              // Insert directly into the email queue table
              const { emailQueue } = await import('../drizzle/schema.js');
              const drizzleDb = await db.getDb();
              if (drizzleDb) {
                const queueId = `review_${input.jobId}_${Date.now()}`;
                await drizzleDb.insert(emailQueue).values({
                  queueId,
                  to: customerEmail,
                  subject,
                  html,
                  textBody: null,
                  type: "review_request",
                  customerName,
                  bookingRef: input.jobId,
                  status: "pending",
                  sendAfter,
                });
                console.log(`[ReviewEmail] Queued review request for ${customerEmail} (job ${input.jobId}), sends at ${sendAfter.toISOString()}`);
              }
            }
          } catch (reviewErr) {
            console.error("[ReviewEmail] Failed to queue review email:", reviewErr);
          }
        }
        // ─────────────────────────────────────────────────────────────────────

        return { success: true as const };
      }),

    /** Send ETA SMS to customer when detailer taps On My Way */
    sendEtaNotification: publicProcedure
      .input(z.object({
        jobId: z.string(),
        etaMinutes: z.number(),       // from Google Directions API
        detailerFirstName: z.string(), // shown in the SMS
      }))
      .mutation(async ({ input }) => {
        const { jobId, etaMinutes, detailerFirstName } = input;

        // Fetch the job to get customer phone + address
        const job = await db.getScheduleJobById(jobId);
        if (!job) return { sent: false, reason: "job_not_found" };

        const customerPhone = job.customerPhone;
        if (!customerPhone) return { sent: false, reason: "no_phone" };

        // Format ETA string
        const etaStr = etaMinutes < 2
          ? "less than a minute"
          : etaMinutes === 1
          ? "1 minute"
          : `${etaMinutes} minutes`;

        const firstName = job.customerName?.split(" ")[0] ?? "there";
        const body = `Hi ${firstName}! Your Luxury Wash On Wheels detailer ${detailerFirstName} is on the way and should arrive in approximately ${etaStr}. We'll see you soon! 🚗✨`;

        // Send via Twilio
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken  = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;

        if (!accountSid || !authToken || !fromNumber) {
          console.warn("[ETA] Twilio not configured — skipping ETA SMS");
          return { sent: false, reason: "twilio_not_configured" };
        }

        // Normalize phone to E.164
        const digits = customerPhone.replace(/\D/g, "");
        const toNumber = digits.startsWith("1") ? `+${digits}` : `+1${digits}`;

        const params = new URLSearchParams({ To: toNumber, From: fromNumber, Body: body });
        const resp = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
          {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
              Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
            },
            body: params.toString(),
          }
        );

        if (!resp.ok) {
          const err = await resp.text();
          console.error("[ETA] Twilio send failed:", err);
          return { sent: false, reason: "twilio_error" };
        }

        console.log(`[ETA] SMS sent to ${toNumber} — ETA ${etaMinutes} min`);
        return { sent: true };
      }),

    /** Save payment record for a job after admin collects payment */
    savePayment: publicProcedure
      .input(z.object({
        jobId: z.string(),
        method: z.enum(["credit_debit", "cash", "check", "other", "tap_to_pay", "apple_pay"]),
        subtotal: z.number(),
        tipAmount: z.number(),
        total: z.number(),
        paidAt: z.string(),
        paymentIntentId: z.string().optional(),
        signatureDataUrl: z.string().optional(),
        referenceNote: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.saveJobPayment(input.jobId, {
          paymentMethod: input.method,
          paymentIntentId: input.paymentIntentId,
          paymentSubtotal: String(input.subtotal),
          paymentTip: String(input.tipAmount),
          paymentTotal: String(input.total),
          // Use server-side timestamp to avoid device clock drift/timezone issues
          paymentPaidAt: new Date().toISOString(),
          paymentSignatureUrl: input.signatureDataUrl,
          paymentReferenceNote: input.referenceNote,
        });

        // Send admin payment confirmation email
        try {
          const jobRow = await db.getScheduleJobById(input.jobId);
          if (jobRow) {
            const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || "admin@luxurywashonwheels.com";
            const methodLabels: Record<string, string> = {
              credit_debit: "Credit / Debit Card",
              cash: "Cash",
              check: "Check",
              tap_to_pay: "Tap to Pay",
              apple_pay: "Apple Pay",
              other: "Other",
            };
            const methodLabel = methodLabels[input.method] ?? input.method;
            const serviceTitle = await db.resolvePackageNameAsync((jobRow as any).packageType);
            const adminSubject = `\u2705 Payment Received \u2014 ${(jobRow as any).customerName} \u00b7 $${input.total.toFixed(2)}`;
            const tipLine = input.tipAmount > 0 ? `<tr><td style="color:#888;font-size:13px;padding:5px 0;">Tip</td><td style="color:#16a34a;font-size:13px;text-align:right;">+$${input.tipAmount.toFixed(2)}</td></tr>` : "";
            const adminHtml = `<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f5f5f5;margin:0;padding:20px;"><div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);"><div style="background:#16a34a;padding:20px 28px;"><h2 style="color:#fff;margin:0;font-size:18px;">&#x2705; Payment Received</h2><p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;">Luxury Wash On Wheels</p></div><div style="padding:24px 28px;"><table style="width:100%;border-collapse:collapse;"><tr><td style="color:#888;font-size:13px;padding:5px 0;">Customer</td><td style="color:#111;font-size:13px;font-weight:600;text-align:right;">${(jobRow as any).customerName ?? ""}</td></tr><tr><td style="color:#888;font-size:13px;padding:5px 0;">Service</td><td style="color:#111;font-size:13px;text-align:right;">${serviceTitle}</td></tr><tr><td style="color:#888;font-size:13px;padding:5px 0;">Date</td><td style="color:#111;font-size:13px;text-align:right;">${(jobRow as any).date ?? ""}</td></tr><tr><td style="color:#888;font-size:13px;padding:5px 0;">Detailer</td><td style="color:#111;font-size:13px;text-align:right;">${(jobRow as any).assignedTo ?? ""}</td></tr><tr><td style="color:#888;font-size:13px;padding:5px 0;">Method</td><td style="color:#111;font-size:13px;text-align:right;">${methodLabel}</td></tr><tr><td style="color:#888;font-size:13px;padding:5px 0;">Subtotal</td><td style="color:#111;font-size:13px;text-align:right;">$${input.subtotal.toFixed(2)}</td></tr>${tipLine}<tr style="border-top:1px solid #e5e7eb;"><td style="color:#111;font-size:16px;font-weight:700;padding:10px 0 5px;">Total Collected</td><td style="color:#16a34a;font-size:20px;font-weight:800;text-align:right;">$${input.total.toFixed(2)}</td></tr></table></div></div></body></html>`;
            await sendEmail({ to: adminEmail, subject: adminSubject, html: adminHtml, type: "other", customerName: (jobRow as any).customerName ?? "" });
          }
        } catch (emailErr) {
          console.warn("[savePayment] Admin notification email failed:", emailErr);
        }

        // ── Push notification to admin/office team members when payment is received ──
        try {
          const { employees: empTable } = await import('../drizzle/schema.js');
          const { inArray } = await import('drizzle-orm');
          const drizzleDb = await db.getDb();
          if (drizzleDb) {
            const admins = await drizzleDb
              .select({ pushToken: empTable.pushToken })
              .from(empTable)
              .where(inArray(empTable.role, ['admin', 'office', 'operations_manager']));
            const tokens = admins
              .map((a: { pushToken: string | null }) => a.pushToken)
              .filter((t: string | null): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              const jobRow = await db.getScheduleJobById(input.jobId);
              const customerName = (jobRow as any)?.customerName ?? 'Customer';
              const methodLabels: Record<string, string> = {
                credit_debit: 'Credit/Debit', cash: 'Cash', check: 'Check',
                tap_to_pay: 'Tap to Pay', apple_pay: 'Apple Pay', other: 'Other',
              };
              const methodLabel = methodLabels[input.method] ?? input.method;
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tokens.map((to: string) => ({
                  to,
                  title: `💵 Payment Received — $${input.total.toFixed(2)}`,
                  body: `${customerName} · ${methodLabel}${input.tipAmount > 0 ? ` (incl. $${input.tipAmount.toFixed(2)} tip)` : ''}`,
                  sound: 'default',
                  data: { screen: 'schedule', jobId: input.jobId },
                }))),
              });
            }
          }
                } catch (pushErr) {
          console.error('[savePayment] Admin push notification error:', pushErr);
        }
        // ── Customer receipt email ─────────────────────────────────────────────
        try {
          const jobRow = await db.getScheduleJobById(input.jobId);
          const customerEmail = (jobRow as any)?.customerEmail;
          if (jobRow && customerEmail) {
            const serviceTitle = await db.resolvePackageNameAsync((jobRow as any).packageType);
            const paidAtFormatted = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Chicago',
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            }).format(new Date());
            const { subject, html } = buildPaymentReceiptEmail({
              customerName: (jobRow as any).customerName ?? 'Valued Customer',
              jobId: input.jobId,
              serviceDate: (jobRow as any).date ?? '',
              packageName: serviceTitle,
              vehicleInfo: [(jobRow as any).vehicleType, (jobRow as any).vehicleColor].filter(Boolean).join(' ') || 'Vehicle',
              serviceAddress: (jobRow as any).location ?? '',
              paymentMethod: input.method,
              subtotal: input.subtotal,
              tip: input.tipAmount,
              total: input.total,
              paidAt: paidAtFormatted,
              detailerName: (jobRow as any).assignedTo ?? undefined,
            });
            await sendEmail({ to: customerEmail, subject, html, type: 'other', urgent: true, customerName: (jobRow as any).customerName ?? '' });
          }
        } catch (receiptErr) {
          console.warn('[savePayment] Customer receipt email failed:', receiptErr);
        }
        return { success: true as const };
      }),
    /** Admin manual mark-paid — for reconciling jobs that were paid but not recorded */
    markPaid: publicProcedure
      .input(z.object({
        jobId: z.string(),
        method: z.enum(["credit_debit", "cash", "check", "other", "tap_to_pay", "apple_pay"]),
        total: z.number(),
        referenceNote: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.saveJobPayment(input.jobId, {
          paymentMethod: input.method,
          paymentIntentId: undefined,
          paymentSubtotal: String(input.total),
          paymentTip: "0",
          paymentTotal: String(input.total),
          paymentPaidAt: new Date().toISOString(),
          paymentSignatureUrl: undefined,
          paymentReferenceNote: input.referenceNote ?? "Manually marked paid by admin",
        });
        // ── Customer receipt email ─────────────────────────────────────────────
        try {
          const jobRow = await db.getScheduleJobById(input.jobId);
          const customerEmail = (jobRow as any)?.customerEmail;
          if (jobRow && customerEmail) {
            const serviceTitle = await db.resolvePackageNameAsync((jobRow as any).packageType);
            const paidAtFormatted = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Chicago',
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            }).format(new Date());
            const { subject, html } = buildPaymentReceiptEmail({
              customerName: (jobRow as any).customerName ?? 'Valued Customer',
              jobId: input.jobId,
              serviceDate: (jobRow as any).date ?? '',
              packageName: serviceTitle,
              vehicleInfo: [(jobRow as any).vehicleType, (jobRow as any).vehicleColor].filter(Boolean).join(' ') || 'Vehicle',
              serviceAddress: (jobRow as any).location ?? '',
              paymentMethod: input.method,
              subtotal: input.total,
              tip: 0,
              total: input.total,
              paidAt: paidAtFormatted,
              detailerName: (jobRow as any).assignedTo ?? undefined,
              referenceNote: input.referenceNote,
            });
            await sendEmail({ to: customerEmail, subject, html, type: 'other', urgent: true, customerName: (jobRow as any).customerName ?? '' });
          }
        } catch (receiptErr) {
          console.warn('[markPaid] Customer receipt email failed:', receiptErr);
        }
        return { success: true as const };
      }),
    /** Manually send a payment receipt email to the customer for a job */
    sendReceipt: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .mutation(async ({ input }) => {
        const jobRow = await db.getScheduleJobById(input.jobId);
        if (!jobRow) throw new Error('Job not found');
        const customerEmail = (jobRow as any)?.customerEmail;
        if (!customerEmail) throw new Error('No customer email on file for this job');
        const serviceTitle = await db.resolvePackageNameAsync((jobRow as any).packageType);
        const payment = (jobRow as any).payment;
        const total = payment ? parseFloat(payment.paymentTotal ?? '0') : 0;
        const tip = payment ? parseFloat(payment.paymentTip ?? '0') : 0;
        const subtotal = total - tip;
        const method = payment?.paymentMethod ?? 'other';
        const paidAt = payment?.paymentPaidAt
          ? new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Chicago',
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            }).format(new Date(payment.paymentPaidAt))
          : new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Chicago',
              month: 'short', day: 'numeric', year: 'numeric',
            }).format(new Date());
        const { subject, html } = buildPaymentReceiptEmail({
          customerName: (jobRow as any).customerName ?? 'Valued Customer',
          jobId: input.jobId,
          serviceDate: (jobRow as any).date ?? '',
          packageName: serviceTitle,
          vehicleInfo: [(jobRow as any).vehicleType, (jobRow as any).vehicleColor].filter(Boolean).join(' ') || 'Vehicle',
          serviceAddress: (jobRow as any).location ?? '',
          paymentMethod: method,
          subtotal,
          tip,
          total,
          paidAt,
          detailerName: (jobRow as any).assignedTo ?? undefined,
        });
        await sendEmail({ to: customerEmail, subject, html, type: 'other', urgent: true, customerName: (jobRow as any).customerName ?? '' });
        return { success: true as const };
      }),

    /** Reassign a job to a different detailer */
    reassign: publicProcedure
      .input(z.object({
        jobId: z.string(),
        newAssignedTo: z.string(), // empty string = unassign
      }))
      .mutation(async ({ input }) => {
        // Empty string means unassign — set assignedTo to null in DB
        await db.reassignScheduleJob(input.jobId, input.newAssignedTo || null);
        return { success: true as const };
      }),
    /** Create a recurring job series — generates all instances from a base job + recurrence rule */
    createRecurring: publicProcedure
      .input(z.object({
        // Base job fields (same as upsert)
        location: z.string(),
        date: z.string(), // YYYY-MM-DD of first occurrence
        timeSlot: z.string(),
        startHour: z.number(),
        endHour: z.number(),
        customerName: z.string(),
        customerPhone: z.string().optional(),
        customerEmail: z.string().optional(),
        vehicleType: z.string().optional(),
        packageType: z.string().optional(),
        serviceDescription: z.string().optional(),
        selectedAddons: z.string().optional(),
        totalPrice: z.number().optional(),
        assignedTo: z.string().optional(),
        customerAddress: z.string().optional(),
        additionalVehicles: z.string().optional(),
        createdBy: z.string().optional(),
        status: z.enum(["pending", "confirmed", "in_progress", "completed", "cancelled"]).optional(),
        source: z.enum(["manual", "online"]).optional(),
        customPrice: z.number().nullable().optional(),
        discountCode: z.string().optional(),
        discountAmount: z.number().optional(),
        isNewCustomer: z.boolean().optional(),
        // Recurrence rule
        recurrenceRule: z.object({
          type: z.enum(["weekly", "biweekly", "monthly_date", "monthly_ordinal"]),
          dayOfWeek: z.number().optional(),
          ordinal: z.number().optional(),
          endDate: z.string().optional(),
          /** When true: generate exactly 13 future occurrences; auto-spawn next on completion */
          neverEnds: z.boolean().optional(),
        }),
      }))
      .mutation(async ({ input }) => {
        const { recurrenceRule, ...baseFields } = input;
        const ruleJson = JSON.stringify(recurrenceRule);
        const parentId = `rec_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

        // Generate all occurrence dates inline
        const toDateStr = (d: Date) => {
          const y = d.getFullYear();
          const m = String(d.getMonth() + 1).padStart(2, "0");
          const day = String(d.getDate()).padStart(2, "0");
          return `${y}-${m}-${day}`;
        };
        const getOrdinalDate = (from: Date, dow: number, ordinal: number): Date => {
          const d = new Date(from); d.setDate(1);
          const month = d.getMonth();
          const occ: Date[] = [];
          const tmp = new Date(d);
          while (tmp.getMonth() === month) {
            if (tmp.getDay() === dow) occ.push(new Date(tmp));
            tmp.setDate(tmp.getDate() + 1);
          }
          if (ordinal === -1) return occ[occ.length - 1] ?? d;
          return occ[(ordinal - 1) % occ.length] ?? d;
        };
        const genDates: string[] = [];
        const ruleType = recurrenceRule.type;
        const targetDow = recurrenceRule.dayOfWeek ?? new Date(input.date + "T12:00:00").getDay();
        const ordinal = recurrenceRule.ordinal ?? 1;
        const endDateLimit = recurrenceRule.endDate ? new Date(recurrenceRule.endDate + "T23:59:59") : null;
        // neverEnds: create exactly 13 future jobs (including the seed job = 12 more)
        const MAX = recurrenceRule.neverEnds ? 12 : 52;
        let cur = new Date(input.date + "T12:00:00");
        if (ruleType === "weekly" || ruleType === "biweekly") {
          const diff = (targetDow - cur.getDay() + 7) % 7;
          cur.setDate(cur.getDate() + (diff === 0 ? (ruleType === "biweekly" ? 14 : 7) : diff));
        } else if (ruleType === "monthly_date") {
          cur.setMonth(cur.getMonth() + 1);
        } else if (ruleType === "monthly_ordinal") {
          cur.setMonth(cur.getMonth() + 1);
          cur = getOrdinalDate(cur, targetDow, ordinal);
        }
        for (let i = 0; i < MAX; i++) {
          if (endDateLimit && cur > endDateLimit) break;
          genDates.push(toDateStr(cur));
          if (ruleType === "weekly") cur.setDate(cur.getDate() + 7);
          else if (ruleType === "biweekly") cur.setDate(cur.getDate() + 14);
          else if (ruleType === "monthly_date") cur.setMonth(cur.getMonth() + 1);
          else if (ruleType === "monthly_ordinal") {
            cur.setMonth(cur.getMonth() + 1);
            cur = getOrdinalDate(cur, targetDow, ordinal);
          }
        }
        const uniqueDates = [...new Set([input.date, ...genDates])].sort();

        const jobs = uniqueDates.map((dateStr, idx) => ({
          jobId: `${parentId}_${idx}`,
          location: baseFields.location,
          date: dateStr,
          timeSlot: baseFields.timeSlot,
          startHour: baseFields.startHour != null ? String(baseFields.startHour) : undefined,
          endHour: baseFields.endHour != null ? String(baseFields.endHour) : undefined,
          customerName: baseFields.customerName,
          customerPhone: baseFields.customerPhone,
          customerEmail: baseFields.customerEmail,
          vehicleType: baseFields.vehicleType,
          packageType: baseFields.packageType,
          serviceDescription: baseFields.serviceDescription,
          selectedAddons: baseFields.selectedAddons,
          totalPrice: baseFields.totalPrice !== undefined ? String(baseFields.totalPrice) : undefined,
          assignedTo: baseFields.assignedTo,
          customerAddress: baseFields.customerAddress,
          additionalVehicles: baseFields.additionalVehicles,
          createdBy: baseFields.createdBy,
          status: (baseFields.status ?? "confirmed") as "pending" | "confirmed" | "in_progress" | "completed" | "cancelled",
          source: (baseFields.source ?? "manual") as "manual" | "online",
          customPrice: baseFields.customPrice != null ? String(baseFields.customPrice) : undefined,
          discountCode: baseFields.discountCode,
          discountAmount: baseFields.discountAmount !== undefined ? String(baseFields.discountAmount) : undefined,
          isNewCustomer: baseFields.isNewCustomer ? 1 : 0,
          recurrenceRule: ruleJson,
          recurrenceParentId: parentId,
        }));

        // Bulk insert all instances
        for (const job of jobs) {
          await db.upsertScheduleJob(job);
        }
        return { success: true as const, count: jobs.length, parentId };
      }),

    /** Get completed jobs for a detailer in a date range (dashboard revenue) */
    completedForDetailer: publicProcedure
      .input(z.object({
        assignedTo: z.string(),
        startDate: z.string(),
        endDate: z.string(),
      }))
      .query(async ({ input }) =>
        db.getCompletedJobsForDetailer(input.assignedTo, input.startDate, input.endDate)
      ),
    /** List all jobs booked by a specific sales rep (for rep history view) */
    listByCreatedBy: publicProcedure
      .input(z.object({ createdBy: z.string(), limit: z.number().optional() }))
      .query(async ({ input }) => db.getJobsBookedByRep(input.createdBy, input.limit ?? 100)),

    /** Update job metadata: tags, privateNotes, taxAmount, discountCode, discountAmount, notes */
    updateMeta: publicProcedure
      .input(z.object({
        jobId: z.string(),
        tags: z.string().nullable().optional(),
        privateNotes: z.string().nullable().optional(),
        taxAmount: z.string().nullable().optional(),
        discountCode: z.string().nullable().optional(),
        discountAmount: z.string().nullable().optional(),
        depositAmount: z.string().nullable().optional(),
        notes: z.string().nullable().optional(),
        customerAddress: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateJobMeta(input.jobId, {
          tags: input.tags,
          privateNotes: input.privateNotes,
          taxAmount: input.taxAmount,
          discountCode: input.discountCode,
          discountAmount: input.discountAmount,
          depositAmount: input.depositAmount,
          notes: input.notes,
          customerAddress: input.customerAddress,
        });
        // If this is a portal-originated job, sync discount + total back to customerBookings
        // so the customer sees the updated price in their portal.
        if (input.discountAmount !== undefined || input.discountCode !== undefined) {
          try {
            const job = await db.getScheduleJobById(input.jobId);
            if (job?.onlineBookingId) {
              // Recalculate total: base price - discount + tax
              const base = parseFloat(String(job.totalPrice ?? 0));
              const disc = parseFloat(String(input.discountAmount ?? job.discountAmount ?? 0));
              const tax = parseFloat(String(input.taxAmount ?? job.taxAmount ?? 0));
              const newTotal = Math.max(0, base - disc + tax);
              await customerDb.updateCustomerBookingPricing(job.onlineBookingId, {
                discountCode: input.discountCode !== undefined ? (input.discountCode ?? null) : undefined,
                discountAmount: input.discountAmount !== undefined ? String(input.discountAmount) : undefined,
                total: String(newTotal),
              });
            }
          } catch (e) {
            console.error('[jobs.updateMeta] customerBookings sync failed (non-blocking):', e);
          }
        }
        return { success: true as const };
      }),
    /** Get customer history by phone or email */
    customerHistory: publicProcedure
      .input(z.object({
        phone: z.string().optional(),
        email: z.string().optional(),
        excludeJobId: z.string().optional(),
      }))
      .query(async ({ input }) =>
        db.getCustomerHistory(input.phone, input.email, input.excludeJobId)
      ),

    // ── Private Notes ──────────────────────────────────────────────────────
    /** Get all private notes for a job */
    getPrivateNotes: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ input }) => db.getPrivateNotes(input.jobId)),

    /** Add a new private note */
    addPrivateNote: publicProcedure
      .input(z.object({
        jobId: z.string(),
        authorId: z.string(),
        authorName: z.string(),
        text: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const note = await db.addPrivateNote(input.jobId, {
          authorId: input.authorId,
          authorName: input.authorName,
          text: input.text,
        });
        return { success: true as const, note };
      }),

    /** Edit an existing private note (author only) */
    editPrivateNote: publicProcedure
      .input(z.object({
        jobId: z.string(),
        noteId: z.string(),
        requesterId: z.string(),
        newText: z.string().min(1),
      }))
      .mutation(async ({ input }) => {
        const result = await db.editPrivateNote(input.jobId, input.noteId, input.requesterId, input.newText);
        return result;
      }),

    /** Delete a private note (author or admin) */
    deletePrivateNote: publicProcedure
      .input(z.object({
        jobId: z.string(),
        noteId: z.string(),
        requesterId: z.string(),
        requesterRole: z.string(),
      }))
      .mutation(async ({ input }) => {
        const result = await db.deletePrivateNote(input.jobId, input.noteId, input.requesterId, input.requesterRole);
        return result;
      }),

    // ── Job Photos ─────────────────────────────────────────────────────────
    /** Get all photo URLs for a job */
    getPhotos: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ input }) => {
        const urls = await db.getJobPhotoUrls(input.jobId);
        return { urls };
      }),

    /** Upload a job photo (base64) to S3 and store the URL */
    uploadPhoto: publicProcedure
      .input(z.object({
        jobId: z.string(),
        base64: z.string(),
        mimeType: z.string().default("image/jpeg"),
      }))
      .mutation(async ({ input }) => {
        const { storagePut } = await import("./storage");
        const suffix = Math.random().toString(36).substr(2, 8);
        const ext = input.mimeType === "image/png" ? "png" : "jpg";
        const key = `job-photos/${input.jobId}/${Date.now()}_${suffix}.${ext}`;
        const buffer = Buffer.from(input.base64, "base64");
        const { url } = await storagePut(key, buffer, input.mimeType);
        const urls = await db.addJobPhotoUrl(input.jobId, url);
        return { success: true as const, url, urls };
      }),

    /** Delete a job photo URL */
    deletePhoto: publicProcedure
      .input(z.object({
        jobId: z.string(),
        url: z.string(),
      }))
      .mutation(async ({ input }) => {
        const urls = await db.removeJobPhotoUrl(input.jobId, input.url);
        return { success: true as const, urls };
      }),
    /** Upload a job video (base64) to S3 and store the URL */
    uploadVideo: publicProcedure
      .input(z.object({
        jobId: z.string(),
        base64: z.string(),
        mimeType: z.string().default('video/mp4'),
      }))
      .mutation(async ({ input }) => {
        const { storagePut } = await import('./storage');
        const suffix = Math.random().toString(36).substr(2, 8);
        const ext = input.mimeType.includes('quicktime') ? 'mov' : 'mp4';
        const key = `job-videos/${input.jobId}/${Date.now()}_${suffix}.${ext}`;
        const buffer = Buffer.from(input.base64, 'base64');
        const { url } = await storagePut(key, buffer, input.mimeType);
        const urls = await db.addJobVideoUrl(input.jobId, url);
        return { success: true as const, url, urls };
      }),
    /** Delete a job video URL */
    deleteVideo: publicProcedure
      .input(z.object({
        jobId: z.string(),
        url: z.string(),
      }))
            .mutation(async ({ input }) => {
        const urls = await db.removeJobVideoUrl(input.jobId, input.url);
        return { success: true as const, urls };
      }),
    // ── Address Location Photos ──
    getAddressPhotos: publicProcedure
      .input(z.object({ addressKey: z.string() }))
      .query(async ({ input }) => {
        return db.getAddressPhotosByKey(input.addressKey);
      }),
    uploadAddressPhoto: publicProcedure
      .input(z.object({
        addressKey: z.string(),
        base64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        caption: z.string().optional(),
        uploadedBy: z.string().optional(),
        uploadedByRole: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { storagePut } = await import("./storage");
        const suffix = Math.random().toString(36).substr(2, 8);
        const ext = input.mimeType === "image/png" ? "png" : "jpg";
        const key = `address-photos/${Date.now()}_${suffix}.${ext}`;
        const buffer = Buffer.from(input.base64, "base64");
        const { url: photoUrl } = await storagePut(key, buffer, input.mimeType);
        return db.addAddressPhoto({
          addressKey: input.addressKey,
          photoUrl,
          caption: input.caption,
          uploadedBy: input.uploadedBy,
          uploadedByRole: input.uploadedByRole,
        });
      }),
    deleteAddressPhoto: publicProcedure
      .input(z.object({ photoId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteAddressPhoto(input.photoId);
        return { success: true };
      }),
    /** Get unseen job events for an employee (for the in-app banner) */
    getUnseenEvents: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => {
        try {
          const { jobEvents: jobEventsTable, jobEventSeen: jobEventSeenTable } = await import('../drizzle/schema');
          const { notInArray, sql: sqlFn } = await import('drizzle-orm');
          const drizzleDb = await db.getDb();
          if (!drizzleDb) return [];
          // Get IDs of events already seen by this employee
          const seenRows = await drizzleDb.select({ jobEventId: jobEventSeenTable.jobEventId }).from(jobEventSeenTable).where(sqlFn`${jobEventSeenTable.employeeId} = ${input.employeeId}`);
          const seenIds = seenRows.map((r: any) => r.jobEventId);
          // Get all events from the last 48 hours not yet seen, capped at 50
          const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);
          const allRecent = await drizzleDb.select().from(jobEventsTable)
            .where(sqlFn`${jobEventsTable.createdAt} >= ${cutoff}`)
            .orderBy(sqlFn`${jobEventsTable.createdAt} DESC`)
            .limit(200);
          const unseen = seenIds.length > 0 ? allRecent.filter((e: any) => !seenIds.includes(e.id)) : allRecent;
          // Cap at 50 to avoid overwhelming the banner and slow renders
          return unseen.slice(0, 50);
        } catch (e) {
          console.error('[jobs.getUnseenEvents] error:', e);
          return [];
        }
      }),
    /** Append an additional vehicle to an existing job and recalculate the price */
    appendVehicleToJob: publicProcedure
      .input(z.object({
        jobId: z.string(),
        vehicleType: z.string(),
        vehicleYear: z.string().optional(),
        vehicleMake: z.string().optional(),
        vehicleModel: z.string().optional(),
        vehicleColor: z.string().optional(),
        packageId: z.string().optional(),
        addonIds: z.array(z.string()).optional(),
        addonQtys: z.record(z.string(), z.number()).optional(),
        price: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error('DB unavailable');
        const { scheduleJobs } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        // Fetch current job
        const rows = await drizzleDb.select().from(scheduleJobs).where(eq(scheduleJobs.jobId, input.jobId)).limit(1);
        if (!rows.length) throw new Error('Job not found');
        const job = rows[0] as any;
        // Parse existing additional vehicles
        let existing: any[] = [];
        try { existing = job.additionalVehicles ? JSON.parse(job.additionalVehicles) : []; } catch { existing = []; }
        // Build new vehicle entry
        const newVehicle = {
          vehicleType: input.vehicleType,
          vehicleYear: input.vehicleYear,
          vehicleMake: input.vehicleMake,
          vehicleModel: input.vehicleModel,
          vehicleColor: input.vehicleColor,
          packageId: input.packageId,
          addonIds: input.addonIds ?? [],
          addonQtys: input.addonQtys ?? {},
          price: input.price ?? 0,
        };
        const updated = [...existing, newVehicle];
        // Recalculate total price
        // Derive primary vehicle price = current total minus any already-added extra vehicles
        const existingExtrasTotal = existing.reduce((sum: number, v: any) => sum + (Number(v.price) || 0), 0);
        const currentTotal = Number((job as any).customPrice ?? (job as any).totalPrice) || 0;
        const primaryVehiclePrice = currentTotal - existingExtrasTotal;
        const newVehiclePrice = Number(input.price) || 0;
        const newTotal = primaryVehiclePrice + existingExtrasTotal + newVehiclePrice;
        await drizzleDb.update(scheduleJobs)
          .set({
            additionalVehicles: JSON.stringify(updated),
            totalPrice: String(newTotal),
          })
          .where(eq(scheduleJobs.jobId, input.jobId));
        return { success: true, additionalVehicles: updated, newTotal };
      }),

    /** Remove an additional vehicle from a job by index and recalculate price */
    removeVehicleFromJob: publicProcedure
      .input(z.object({
        jobId: z.string(),
        vehicleIndex: z.number(), // index in additionalVehicles array (0-based)
      }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error('DB unavailable');
        const { scheduleJobs } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const rows = await drizzleDb.select().from(scheduleJobs).where(eq(scheduleJobs.jobId, input.jobId)).limit(1);
        if (!rows.length) throw new Error('Job not found');
        const job = rows[0] as any;
        let existing: any[] = [];
        try { existing = job.additionalVehicles ? JSON.parse(job.additionalVehicles) : []; } catch { existing = []; }
        const updated = existing.filter((_: any, i: number) => i !== input.vehicleIndex);
        // Use the full current total (customPrice takes priority, then totalPrice, then price as fallback)
        const currentTotal = Number(job.customPrice ?? job.totalPrice ?? job.price) || 0;
        const removedPrice = Number(existing[input.vehicleIndex]?.price) || 0;
        const newTotal = Math.max(0, currentTotal - removedPrice);
        await drizzleDb.update(scheduleJobs)
          .set({
            additionalVehicles: JSON.stringify(updated),
            totalPrice: String(newTotal),
          })
          .where(eq(scheduleJobs.jobId, input.jobId));
        return { success: true, additionalVehicles: updated, newTotal };
      }),

    /** Update the package of an additional vehicle (idx >= 0 in additionalVehicles array) */
    updateAdditionalVehiclePackage: publicProcedure
      .input(z.object({
        jobId: z.string(),
        vehicleIndex: z.number(),
        packageId: z.string(),
        vehicleType: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error('DB unavailable');
        const { scheduleJobs } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const rows = await drizzleDb.select().from(scheduleJobs).where(eq(scheduleJobs.jobId, input.jobId)).limit(1);
        if (!rows.length) throw new Error('Job not found');
        const job = rows[0] as any;
        let existing: any[] = [];
        try { existing = job.additionalVehicles ? JSON.parse(job.additionalVehicles) : []; } catch { existing = []; }
        if (input.vehicleIndex < 0 || input.vehicleIndex >= existing.length) throw new Error('Vehicle index out of range');
        const updated = existing.map((v: any, i: number) => i === input.vehicleIndex ? { ...v, packageId: input.packageId } : v);
        await drizzleDb.update(scheduleJobs)
          .set({ additionalVehicles: JSON.stringify(updated) })
          .where(eq(scheduleJobs.jobId, input.jobId));
        return { success: true, additionalVehicles: updated };
      }),

    /**
     * Update addons for a vehicle on an existing job.
     * vehicleIndex = -1 means the primary vehicle; 0+ means additionalVehicles[vehicleIndex].
     * Also recalculates totalPrice by diffing the old addon total vs new addon total.
     */
    updateJobAddons: publicProcedure
      .input(z.object({
        jobId: z.string(),
        vehicleIndex: z.number(), // -1 for primary, 0+ for additional
        addonIds: z.array(z.string()),
        addonQtys: z.record(z.string(), z.number()),
        addonPriceDelta: z.number(), // new addon total minus old addon total
      }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error('DB unavailable');
        const { scheduleJobs } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const rows = await drizzleDb.select().from(scheduleJobs).where(eq(scheduleJobs.jobId, input.jobId)).limit(1);
        if (!rows.length) throw new Error('Job not found');
        const job = rows[0] as any;
        const currentTotal = Number(job.customPrice ?? job.totalPrice ?? 0);
        const newTotal = Math.max(0, currentTotal + input.addonPriceDelta);
        if (input.vehicleIndex === -1) {
          // Primary vehicle — store in selectedAddons + addonQtys columns
          await drizzleDb.update(scheduleJobs)
            .set({
              selectedAddons: JSON.stringify(input.addonIds),
              addonQtys: JSON.stringify(input.addonQtys),
              totalPrice: String(newTotal),
            })
            .where(eq(scheduleJobs.jobId, input.jobId));
          return { success: true, newTotal, addonIds: input.addonIds, addonQtys: input.addonQtys };
        } else {
          // Additional vehicle
          let existing: any[] = [];
          try { existing = job.additionalVehicles ? JSON.parse(job.additionalVehicles) : []; } catch { existing = []; }
          if (input.vehicleIndex < 0 || input.vehicleIndex >= existing.length) throw new Error('Vehicle index out of range');
          const updated = existing.map((v: any, i: number) =>
            i === input.vehicleIndex
              ? { ...v, addonIds: input.addonIds, addonQtys: input.addonQtys }
              : v
          );
          await drizzleDb.update(scheduleJobs)
            .set({
              additionalVehicles: JSON.stringify(updated),
              totalPrice: String(newTotal),
            })
            .where(eq(scheduleJobs.jobId, input.jobId));
          return { success: true, newTotal, additionalVehicles: updated };
        }
      }),

    /** Get all unpaid completed/confirmed jobs — for admin follow-up */
    getUnpaid: publicProcedure
      .input(z.object({
        limit: z.number().optional().default(200),
        includeInProgress: z.boolean().optional().default(true),
      }))
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { jobs: [] };
        const { scheduleJobs: sjTbl } = await import('../drizzle/schema');
        const { isNull, inArray, or, and, isNotNull, ne } = await import('drizzle-orm');
        const statuses: Array<"confirmed" | "in_progress" | "completed"> = input.includeInProgress
          ? ["confirmed", "in_progress", "completed"]
          : ["completed"];
        const rows = await drizzleDb
          .select({
            jobId: sjTbl.jobId,
            date: sjTbl.date,
            timeSlot: sjTbl.timeSlot,
            customerName: sjTbl.customerName,
            customerPhone: sjTbl.customerPhone,
            customerEmail: sjTbl.customerEmail,
            customerAddress: sjTbl.customerAddress,
            vehicleType: sjTbl.vehicleType,
            packageType: sjTbl.packageType,
            totalPrice: sjTbl.totalPrice,
            customPrice: sjTbl.customPrice,
            depositAmount: sjTbl.depositAmount,
            discountAmount: sjTbl.discountAmount,
            status: sjTbl.status,
            assignedTo: sjTbl.assignedTo,
            paymentMethod: sjTbl.paymentMethod,
            paymentTotal: sjTbl.paymentTotal,
            paymentPaidAt: sjTbl.paymentPaidAt,
            notes: sjTbl.notes,
            location: sjTbl.location,
          })
          .from(sjTbl)
          .where(
            and(
              inArray(sjTbl.status, statuses),
              isNull(sjTbl.paymentPaidAt),   // no payment recorded
              isNull(sjTbl.paymentMethod),   // belt-and-suspenders
              isNotNull(sjTbl.totalPrice),   // has a price set
              ne(sjTbl.totalPrice, "0.00"),  // price is not zero
            )
          )
          .orderBy(sjTbl.date)
          .limit(input.limit);
        // Calculate balance owed for each job
        const jobs = rows.map((j) => {
          const total = parseFloat(j.totalPrice ?? j.customPrice ?? "0");
          const deposit = parseFloat(j.depositAmount ?? "0");
          const discount = parseFloat(j.discountAmount ?? "0");
          const balanceDue = Math.max(0, total - deposit - discount);
          return { ...j, balanceDue: parseFloat(balanceDue.toFixed(2)) };
        });
        return { jobs };
      }),

    /** Reconcile a job against Stripe — if a succeeded PaymentIntent exists for this job, mark it paid automatically */
    reconcileFromStripe: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .mutation(async ({ input }) => {
        try {
          const { ENV } = await import('./_core/env');
          const stripeKey = ENV.stripeSecretKey;
          console.log('[reconcileFromStripe] jobId:', input.jobId, 'stripeKey exists:', !!stripeKey, 'stripeKey starts with:', stripeKey?.substring(0, 10));
          if (!stripeKey) {
            console.error('[reconcileFromStripe] No Stripe key found in ENV');
            return { success: false, reason: 'Stripe not configured' };
          }
          // Search Stripe for a succeeded PaymentIntent with this job_id in metadata
          const searchRes = await fetch(
            `https://api.stripe.com/v1/payment_intents/search?query=metadata%5B%27job_id%27%5D%3A%22${encodeURIComponent(input.jobId)}%22%20AND%20status%3A%22succeeded%22&limit=3`,
            { headers: { Authorization: `Bearer ${stripeKey}` } }
          );
          const searchData = await searchRes.json() as any;
          const intents = searchData?.data ?? [];
          if (intents.length === 0) return { success: false, reason: 'No succeeded PaymentIntent found in Stripe for this job' };
          // Use the most recent succeeded intent
          const intent = intents[0];
          const amountTotal = (intent.amount ?? 0) / 100;
          const amountTip = (intent.metadata?.tip_amount ? parseFloat(intent.metadata.tip_amount) : 0);
          const amountSubtotal = amountTotal - amountTip;
          await db.saveJobPayment(input.jobId, {
            paymentMethod: 'credit_debit',
            paymentIntentId: intent.id,
            paymentSubtotal: String(amountSubtotal.toFixed(2)),
            paymentTip: String(amountTip.toFixed(2)),
            paymentTotal: String(amountTotal.toFixed(2)),
            paymentPaidAt: new Date(intent.created * 1000).toISOString(),
            paymentSignatureUrl: undefined,
            paymentReferenceNote: `Auto-reconciled from Stripe (${intent.id})`,
          });
          return { success: true, paymentIntentId: intent.id, total: amountTotal };
        } catch (e: any) {
          console.error('[reconcileFromStripe] error:', e);
          return { success: false, reason: e?.message ?? 'Unknown error' };
        }
      }),

    /** Mark job events as seen for an employee */
    markEventsSeen: publicProcedure
      .input(z.object({ employeeId: z.string(), eventIds: z.array(z.number()) }))
      .mutation(async ({ input }) => {
        try {
          const { jobEventSeen: jobEventSeenTable } = await import('../drizzle/schema');
          const drizzleDb = await db.getDb();
          if (!drizzleDb || input.eventIds.length === 0) return { success: true };
          const rows = input.eventIds.map((id) => ({ employeeId: input.employeeId, jobEventId: id }));
          await drizzleDb.insert(jobEventSeenTable).values(rows).onDuplicateKeyUpdate({ set: { seenAt: new Date() } });
          return { success: true };
        } catch (e) {
          console.error('[jobs.markEventsSeen] error:', e);
          return { success: false };
        }
      }),
  }),
  // --- Location & Tracking ---
  location: router({
    /** Detailer upserts their GPS position every ~30s while on the way */
    upsert: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string().optional(),
        lat: z.number(),
        lng: z.number(),
        jobId: z.string().optional(),
        customerAddress: z.string().optional(),
        status: z.enum(["on_my_way", "arrived", "inactive", "clocked_in"]).default("on_my_way"),
      }))
      .mutation(async ({ input }) => {
        await db.upsertDetailerLocation({
          employeeId: input.employeeId,
          fullName: input.fullName,
          lat: String(input.lat),
          lng: String(input.lng),
          jobId: input.jobId,
          customerAddress: input.customerAddress,
          status: input.status,
        });
        return { success: true as const };
      }),

    /** Mark detailer inactive (arrived or clocked out) */
    deactivate: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deactivateDetailerLocation(input.employeeId);
        return { success: true as const };
      }),

    /** Admin: get all active van locations */
    getActive: publicProcedure
      .query(async () => db.getActiveDetailerLocations()),

    /** Create a 30-min tracking token for a job */
    createToken: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        jobId: z.string(),
        customerAddress: z.string().optional(),
        customerName: z.string().optional(),
        detailerName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        // Geocode customer address to lat/lng for map routing
        let customerLat: string | undefined;
        let customerLng: string | undefined;
        if (input.customerAddress) {
          try {
            const encoded = encodeURIComponent(input.customerAddress);
            const geoRes = await fetch(
              `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`,
              { headers: { "User-Agent": "LuxuryWashOnWheels/1.0" }, signal: AbortSignal.timeout(6000) }
            );
            if (geoRes.ok) {
              const geoJson = await geoRes.json() as Array<{ lat: string; lon: string }>;
              if (geoJson.length > 0) {
                customerLat = geoJson[0].lat;
                customerLng = geoJson[0].lon;
              }
            }
          } catch {
            // Geocoding failed — route polyline won't show but tracking still works
          }
        }
        const token = await db.createTrackingToken({
          employeeId: input.employeeId,
          jobId: input.jobId,
          customerAddress: input.customerAddress,
          customerName: input.customerName,
          detailerName: input.detailerName,
          customerLat,
          customerLng,
        });

        // Fire customer notifications (email + push) non-blocking
        (async () => {
          try {
            const APP_BASE = process.env.PUBLIC_URL ?? "https://www.luxurywashonwheels.app";
            const trackUrl = APP_BASE + "/track/" + token;
            const job = await db.getScheduleJobById(input.jobId);
            if (!job) return;
            const customerFirstName = (job.customerName ?? "there").split(" ")[0];
            const detailerFirstName = (input.detailerName ?? "Your detailer").split(" ")[0];
            // 1. Email with tracking link
            if (job.customerEmail) {
              const { subject, html } = buildOnTheWayEmail({
                customerFirstName,
                detailerFirstName,
                trackUrl,
                phone: "850-517-7874",
              });
              await sendEmail({
                to: job.customerEmail,
                subject,
                html,
                type: "other",
                customerName: job.customerName ?? undefined,
                bookingRef: input.jobId,
              });
            }
            // 2. Push notification to customer portal app
            let matchedCustomer = null;
            if (job.customerEmail) matchedCustomer = await customerDb.getCustomerByEmail(job.customerEmail);
            if (!matchedCustomer && job.customerPhone) matchedCustomer = await customerDb.getCustomerByPhone(job.customerPhone);
            if (matchedCustomer?.customerId) {
              await customerDb.sendCustomerPushNotification(
                matchedCustomer.customerId,
                detailerFirstName + " is on the way!",
                "Tap to track " + detailerFirstName + " live on the map."
              );
            }
          } catch (e) {
            console.error("[OnMyWay] Failed to send customer notifications:", e);
          }
        })();

        return { token };
      }),

    /** Deactivate tracking tokens when detailer arrives */
    expireTokens: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deactivateTrackingTokensForJob(input.jobId);
        return { success: true as const };
      }),

    /** Public: get tracking data for a token (used by customer tracking page) */
    getByToken: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => db.getTrackingTokenData(input.token)),
    /** Public: get active tracking data by jobId (customer tracking screen polls this) */
    getByJobId: publicProcedure
      .input(z.object({ jobId: z.string() }))
      .query(async ({ input }) => db.getActiveTokenDataByJobId(input.jobId)),
    /** Server-side route proxy: geocodes address if needed, fetches OSRM road route, returns coords + ETA */
    getRoute: publicProcedure
      .input(z.object({
        fromLat: z.number(),
        fromLng: z.number(),
        toAddress: z.string().optional(),
        toLat: z.number().optional(),
        toLng: z.number().optional(),
      }))
      .query(async ({ input }) => {
        let destLat = input.toLat;
        let destLng = input.toLng;
        // Geocode address if lat/lng not provided — use Google Maps for accuracy, fall back to Nominatim
        if ((!destLat || !destLng) && input.toAddress) {
          const googleKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
          // Ensure address includes state/country context for better accuracy
          const addressWithContext = /fl|florida|pensacola|destin|niceville|crestview|fort walton|navarre|milton|gulf breeze/i.test(input.toAddress)
            ? input.toAddress
            : `${input.toAddress}, FL, USA`;
          if (googleKey) {
            try {
              const encoded = encodeURIComponent(addressWithContext);
              const geoRes = await fetch(
                `https://maps.googleapis.com/maps/api/geocode/json?address=${encoded}&key=${googleKey}&region=us`,
                { signal: AbortSignal.timeout(6000) }
              );
              if (geoRes.ok) {
                const geoJson = await geoRes.json() as { status: string; results: Array<{ geometry: { location: { lat: number; lng: number } } }> };
                if (geoJson.status === 'OK' && geoJson.results.length > 0) {
                  destLat = geoJson.results[0].geometry.location.lat;
                  destLng = geoJson.results[0].geometry.location.lng;
                }
              }
            } catch { /* fall through to Nominatim */ }
          }
          // Fallback to Nominatim if Google geocoding failed or no key
          if (!destLat || !destLng) {
            try {
              const encoded = encodeURIComponent(addressWithContext);
              const geoRes = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1&countrycodes=us`,
                { headers: { "User-Agent": "LuxuryWashOnWheels/1.0" }, signal: AbortSignal.timeout(6000) }
              );
              if (geoRes.ok) {
                const geoJson = await geoRes.json() as Array<{ lat: string; lon: string }>;
                if (geoJson.length > 0) {
                  destLat = parseFloat(geoJson[0].lat);
                  destLng = parseFloat(geoJson[0].lon);
                }
              }
            } catch { /* geocoding failed */ }
          }
        }
        if (!destLat || !destLng) return null;
        // Fetch OSRM route (GeoJSON geometry)
        try {
          const url = `https://router.project-osrm.org/route/v1/driving/${input.fromLng},${input.fromLat};${destLng},${destLat}?overview=full&geometries=geojson`;
          const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
          if (!res.ok) return null;
          const json = await res.json() as { code: string; routes?: Array<{ geometry: { coordinates: [number, number][] }; duration: number }> };
          if (json.code !== "Ok" || !json.routes?.length) return null;
          const coords = json.routes[0].geometry.coordinates.map(([lng, lat]: [number, number]) => ({ latitude: lat, longitude: lng }));
          return { coords, durationSec: Math.round(json.routes[0].duration), destLat, destLng };
        } catch { return null; }
      }),
  }),

  weather: router({
    /** Server-side weather proxy: geocodes city, fetches Open-Meteo forecast, returns structured data */
    getForecast: publicProcedure
      .input(z.object({ city: z.string().optional() }))
      .query(async ({ input }) => {
        const DEFAULT_COORDS = { lat: 30.5188, lon: -86.4786, label: "Northwest FL" };
        let coords = DEFAULT_COORDS;
        // Geocode city
        if (input.city?.trim()) {
          try {
            const geoUrl = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(input.city)}&count=1&language=en&format=json`;
            const geoRes = await fetch(geoUrl, { signal: AbortSignal.timeout(6000) });
            if (geoRes.ok) {
              const geoData = await geoRes.json() as { results?: Array<{ latitude: number; longitude: number; name: string; admin1?: string; country?: string }> };
              const r = geoData.results?.[0];
              if (r) coords = { lat: r.latitude, lon: r.longitude, label: [r.name, r.admin1].filter(Boolean).join(", ") };
            }
          } catch { /* use default */ }
        }
        // Fetch weather
        const url = `https://api.open-meteo.com/v1/forecast?latitude=${coords.lat}&longitude=${coords.lon}` +
          `&current=temperature_2m,apparent_temperature,relative_humidity_2m,wind_speed_10m,weather_code,is_day` +
          `&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max,wind_speed_10m_max` +
          `&temperature_unit=fahrenheit&wind_speed_unit=mph&forecast_days=5&timezone=America%2FChicago`;
        const res = await fetch(url, { signal: AbortSignal.timeout(10000) });
        if (!res.ok) throw new Error("Weather fetch failed");
        const data = await res.json() as {
          current: { temperature_2m: number; apparent_temperature: number; relative_humidity_2m: number; wind_speed_10m: number; weather_code: number; is_day: number };
          daily: { time: string[]; temperature_2m_max: number[]; temperature_2m_min: number[]; weather_code: number[]; precipitation_probability_max: number[]; wind_speed_10m_max: number[] };
        };
        const c = data.current;
        const d = data.daily;
        return {
          location: coords.label,
          current: {
            temp: Math.round(c.temperature_2m),
            feelsLike: Math.round(c.apparent_temperature),
            humidity: Math.round(c.relative_humidity_2m),
            windSpeed: Math.round(c.wind_speed_10m),
            weatherCode: c.weather_code,
            isDay: c.is_day === 1,
          },
          daily: (d.time as string[]).map((date: string, i: number) => ({
            date,
            maxTemp: Math.round(d.temperature_2m_max[i]),
            minTemp: Math.round(d.temperature_2m_min[i]),
            weatherCode: d.weather_code[i],
            precipProb: Math.round(d.precipitation_probability_max[i] ?? 0),
            windSpeed: Math.round(d.wind_speed_10m_max[i] ?? 0),
          })),
        };
      }),
  }),

  morningMeeting: router({
    getConfig: publicProcedure.query(async () => db.getMorningMeetingConfig()),
    updateConfig: publicProcedure
      .input(z.object({
        zoomLink: z.string().min(1),
        meetingTime: z.string().optional(),
        enabled: z.enum(["yes", "no"]).optional(),
        updatedBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertMorningMeetingConfig(input);
        return { success: true as const };
      }),
    /** Record that a team member attended the morning meeting */
    recordAttendance: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string(),
        meetingDate: z.string(), // YYYY-MM-DD
      }))
      .mutation(async ({ input }) => {
        await db.recordMeetingAttendance(input.employeeId, input.fullName, input.meetingDate);
        return { success: true as const };
      }),
    /** Get all attendance records for a specific date */
    getAttendanceForDate: publicProcedure
      .input(z.object({ meetingDate: z.string() }))
      .query(async ({ input }) => db.getMeetingAttendanceForDate(input.meetingDate)),
    /** Check if a specific employee attended on a given date */
    didAttend: publicProcedure
      .input(z.object({ employeeId: z.string(), meetingDate: z.string() }))
      .query(async ({ input }) => db.didEmployeeAttendMeeting(input.employeeId, input.meetingDate)),
  }),
  daysOff: router({
    /** Assign a day off to a team member */
    assign: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string(),
        offDate: z.string(), // YYYY-MM-DD
        reason: z.enum(["pto", "sick", "personal", "other"]).optional(),
        notes: z.string().optional(),
        assignedBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const dayOffId = await db.assignDayOff(input);
        return { success: true as const, dayOffId };
      }),
    /** Remove a day off record */
    remove: publicProcedure
      .input(z.object({ dayOffId: z.string() }))
      .mutation(async ({ input }) => {
        await db.removeDayOff(input.dayOffId);
        return { success: true as const };
      }),
    /** Get all upcoming days off */
    getUpcoming: publicProcedure.query(async () => db.getUpcomingDaysOff()),
    /** Get days off for a specific employee */
    getForEmployee: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getDaysOffForEmployee(input.employeeId)),
    /** Get all team members off on a specific date */
    getForDate: publicProcedure
      .input(z.object({ offDate: z.string() }))
      .query(async ({ input }) => db.getDaysOffForDate(input.offDate)),
    /** Check if a specific employee is off on a given date */
    isOff: publicProcedure
      .input(z.object({ employeeId: z.string(), offDate: z.string() }))
      .query(async ({ input }) => db.isEmployeeOffOnDate(input.employeeId, input.offDate)),
  }),
  companyMeetings: router({
    getUpcoming: publicProcedure.query(async () => db.getUpcomingCompanyMeetings()),
    getAll: publicProcedure.query(async () => db.getAllCompanyMeetings()),
    getImminent: publicProcedure.query(async () => db.getImminentCompanyMeeting()),
    create: publicProcedure
      .input(z.object({
        title: z.string().min(1),
        description: z.string().optional(),
        meetingDate: z.string(),
        meetingTime: z.string(),
        zoomLink: z.string().optional(),
        isRecurring: z.enum(["yes", "no"]).optional(),
        recurringDay: z.string().optional(),
        createdBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const meetingId = `MTG_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
        await db.createCompanyMeeting({
          meetingId,
          title: input.title,
          description: input.description,
          meetingDate: input.meetingDate,
          meetingTime: input.meetingTime,
          zoomLink: input.zoomLink,
          isRecurring: input.isRecurring ?? "no",
          recurringDay: input.recurringDay,
          createdBy: input.createdBy,
        });
        return { success: true as const, meetingId };
      }),
    update: publicProcedure
      .input(z.object({
        meetingId: z.string(),
        title: z.string().min(1).optional(),
        description: z.string().optional(),
        meetingDate: z.string().optional(),
        meetingTime: z.string().optional(),
        zoomLink: z.string().optional(),
        isRecurring: z.enum(["yes", "no"]).optional(),
        recurringDay: z.string().optional(),
        status: z.enum(["upcoming", "cancelled", "completed"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const { meetingId, ...data } = input;
        await db.updateCompanyMeeting(meetingId, data as any);
        return { success: true as const };
      }),
    delete: publicProcedure
      .input(z.object({ meetingId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteCompanyMeeting(input.meetingId);
        return { success: true as const };
      }),
  }),
  salesPerformance: router({
    /** Get performance stats for a sales rep (today / week / all-time) */
    getStats: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getSalesPerformance(input.employeeId)),

    /** Admin: get all reps performance for a date (default today) */
    getLeaderboard: publicProcedure
      .input(z.object({ date: z.string().optional() }))
      .query(async ({ input }) => db.getAllSalesPerformance(input.date)),

    /** Called when a sales rep books a job — increments their daily stats */
    recordBooking: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string(),
        date: z.string(),
        revenue: z.number(),
        jobId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertSalesPerformance({
          employeeId: input.employeeId,
          fullName: input.fullName,
          date: input.date,
          jobsBookedDelta: 1,
          revenueDelta: input.revenue,
          lastJobId: input.jobId,
        });
        return { success: true as const };
      }),
  }),
  customers: router({
    /** List all customers with optional search, sorted by lifetime value */
    listAll: publicProcedure
      .input(z.object({ search: z.string().optional() }))
      .query(async ({ input }) => db.getAllCustomers(input.search)),
    /** Get all jobs for a specific customer */
    getJobs: publicProcedure
      .input(z.object({
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        name: z.string(),
        customerId: z.string().nullable().optional(),
      }))
      .query(async ({ input }) => db.getCustomerJobs(input.phone ?? null, input.email ?? null, input.name, input.customerId ?? null)),
    /** Admin: add customer to Do Not Service list */
    setDoNotService: publicProcedure
      .input(z.object({
        customerKey: z.string(),
        fullName: z.string().optional(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        reason: z.string().optional(),
        addedBy: z.string().optional(),
        remove: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        if (input.remove) return db.removeFromDoNotServiceList(input.customerKey);
        return db.addToDoNotServiceList(input);
      }),
    /** Check if a customer key is on the Do Not Service list */
    checkDoNotService: publicProcedure
      .input(z.object({ customerKey: z.string() }))
      .query(async ({ input }) => ({ doNotService: await db.isOnDoNotServiceList(input.customerKey) })),
    /** Get the full Do Not Service list */
    getDoNotServiceList: publicProcedure
      .query(async () => db.getDoNotServiceList()),
    /** Admin: update customer contact info across all tables */
    updateContactInfo: publicProcedure
      .input(z.object({
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        name: z.string(),
        newName: z.string(),
        newPhone: z.string().nullable().optional(),
        newEmail: z.string().nullable().optional(),
        newAddress: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => db.updateCustomerContactInfo({
        phone: input.phone ?? null,
        email: input.email ?? null,
        name: input.name,
        newName: input.newName,
        newPhone: input.newPhone ?? null,
        newEmail: input.newEmail ?? null,
        newAddress: input.newAddress ?? null,
      })),
    /** Admin: permanently delete all records for a customer */
    adminDelete: publicProcedure
      .input(z.object({
        customerKey: z.string(),
        phone: z.string().nullable().optional(),
        email: z.string().nullable().optional(),
        name: z.string(),
      }))
      .mutation(async ({ input }) => db.deleteCustomerByKey(input.customerKey, input.phone ?? null, input.email ?? null, input.name)),
    /** Admin: get all customer locations for the fleet map */
    getMapLocations: publicProcedure
      .query(async () => db.getCustomerMapLocations()),
  }),

  attachments: router({
    listForCustomer: publicProcedure
      .input(z.object({
        customerName: z.string(),
        customerPhone: z.string().nullable().optional(),
        customerEmail: z.string().nullable().optional(),
      }))
      .query(async ({ input }) => db.getCustomerAttachments(input.customerName, input.customerPhone ?? null, input.customerEmail ?? null)),
    upload: publicProcedure
      .input(z.object({
        attachmentId: z.string(),
        customerName: z.string(),
        customerPhone: z.string().nullable().optional(),
        customerEmail: z.string().nullable().optional(),
        fileName: z.string(),
        mimeType: z.string(),
        base64Data: z.string(),
        fileSizeBytes: z.number().optional(),
        caption: z.string().optional(),
        uploadedBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const safeName = input.customerName.replace(/\s+/g, '-').toLowerCase();
        const key = `customer-attachments/${safeName}/${input.attachmentId}/${input.fileName}`;
        const buffer = Buffer.from(input.base64Data, 'base64');
        const { url } = await storagePut(key, buffer, input.mimeType);
        return db.createCustomerAttachment({
          attachmentId: input.attachmentId,
          customerName: input.customerName,
          customerPhone: input.customerPhone ?? null,
          customerEmail: input.customerEmail ?? null,
          fileName: input.fileName,
          fileUrl: url,
          fileKey: key,
          mimeType: input.mimeType,
          fileSizeBytes: input.fileSizeBytes ?? null,
          caption: input.caption ?? null,
          uploadedBy: input.uploadedBy ?? null,
        });
      }),
    delete: publicProcedure
      .input(z.object({ attachmentId: z.string() }))
      .mutation(async ({ input }) => db.deleteCustomerAttachment(input.attachmentId)),
  }),

  estimates: router({
    listAll: publicProcedure
      .input(z.object({ search: z.string().optional(), status: z.string().optional() }))
      .query(async ({ input }) => db.getAllEstimates(input.search, input.status)),
    listForCustomer: publicProcedure
      .input(z.object({
        customerName: z.string(),
        customerPhone: z.string().nullable().optional(),
        customerEmail: z.string().nullable().optional(),
      }))
      .query(async ({ input }) => db.getCustomerEstimates(input.customerName, input.customerPhone ?? null, input.customerEmail ?? null)),
    getById: publicProcedure
      .input(z.object({ estimateId: z.string() }))
      .query(async ({ input }) => db.getEstimateById(input.estimateId)),
    create: publicProcedure
      .input(z.object({
        estimateId: z.string(),
        estimateNumber: z.number().optional(),
        customerName: z.string(),
        customerPhone: z.string().nullable().optional(),
        customerEmail: z.string().nullable().optional(),
        customerAddress: z.string().nullable().optional(),
        vehicleYear: z.string().nullable().optional(),
        vehicleMake: z.string().nullable().optional(),
        vehicleModel: z.string().nullable().optional(),
        vehicleColor: z.string().nullable().optional(),
        lineItems: z.array(z.object({ description: z.string(), qty: z.number(), unitPrice: z.number(), total: z.number() })),
        subtotal: z.number(),
        taxRate: z.number().optional(),
        taxAmount: z.number().optional(),
        discountAmount: z.number().optional(),
        total: z.number(),
        notes: z.string().nullable().optional(),
        internalNotes: z.string().nullable().optional(),
        validUntil: z.string().nullable().optional(),
        createdBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => db.createEstimate(input)),
    updateStatus: publicProcedure
      .input(z.object({ estimateId: z.string(), status: z.enum(['draft','sent','viewed','accepted','declined','expired']) }))
      .mutation(async ({ input }) => db.updateEstimateStatus(input.estimateId, input.status)),
    update: publicProcedure
      .input(z.object({
        estimateId: z.string(),
        customerName: z.string().optional(),
        customerPhone: z.string().nullable().optional(),
        customerEmail: z.string().nullable().optional(),
        customerAddress: z.string().nullable().optional(),
        vehicleYear: z.string().nullable().optional(),
        vehicleMake: z.string().nullable().optional(),
        vehicleModel: z.string().nullable().optional(),
        vehicleColor: z.string().nullable().optional(),
        lineItems: z.array(z.object({ description: z.string(), qty: z.number(), unitPrice: z.number(), total: z.number() })).optional(),
        subtotal: z.number().optional(),
        taxRate: z.number().optional(),
        taxAmount: z.number().optional(),
        discountAmount: z.number().optional(),
        total: z.number().optional(),
        notes: z.string().nullable().optional(),
        internalNotes: z.string().nullable().optional(),
        validUntil: z.string().nullable().optional(),
      }))
      .mutation(async ({ input }) => db.updateEstimate(input)),
    markSent: publicProcedure
      .input(z.object({ estimateId: z.string() }))
      .mutation(async ({ input }) => db.markEstimateSent(input.estimateId)),
    delete: publicProcedure
      .input(z.object({ estimateId: z.string() }))
      .mutation(async ({ input }) => db.deleteEstimate(input.estimateId)),
  }),
  // ─── Community Posts ──────────────────────────────────────────────────────────
  community: router({
    listPosts: publicProcedure
      .input(z.object({ category: z.string().optional(), limit: z.number().optional() }))
      .query(async ({ input }) => db.listCommunityPosts(input.category, input.limit ?? 50)),
    createPost: publicProcedure
      .input(z.object({
        postId: z.string(),
        authorId: z.string(),
        authorName: z.string(),
        title: z.string(),
        body: z.string(),
        category: z.string().optional(),
        mediaUrls: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        await db.createCommunityPost({ ...input, mediaUrls: input.mediaUrls ? JSON.stringify(input.mediaUrls) : null });
        // Push notification to all team members except the author
        try {
          const { employees: empTable } = await import('../drizzle/schema');
          const { ne } = await import('drizzle-orm');
          const drizzleDb = await db.getDb();
          if (drizzleDb) {
            const recipients = await drizzleDb.select({ pushToken: empTable.pushToken }).from(empTable).where(ne(empTable.employeeId, input.authorId));
            const tokens = recipients.map((r: any) => r.pushToken).filter((t: any): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              const preview = input.body.slice(0, 80);
              const pushPayloads = tokens.map((to: string) => ({ to, title: `💬 ${input.authorName} posted in Community`, body: input.title || preview, sound: 'default', data: { screen: 'team-chat', channel: 'community', tab: 'community', senderId: input.authorId, senderName: input.authorName } }));
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pushPayloads),
              });
            }
          }
        } catch (e) {
          console.error('[push] community post push failed:', e);
        }
        return { success: true };
      }),
    uploadMedia: publicProcedure
      .input(z.object({
        base64: z.string(),
        mimeType: z.string(),
        fileName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const suffix = Math.random().toString(36).substr(2, 8);
        const ext = input.mimeType.split('/')[1]?.split(';')[0] ?? 'bin';
        const key = `community-media/${Date.now()}_${suffix}.${ext}`;
        const buffer = Buffer.from(input.base64, 'base64');
        const { url } = await storagePut(key, buffer, input.mimeType);
        return { url };
      }),
    deletePost: publicProcedure
      .input(z.object({ postId: z.string() }))
      .mutation(async ({ input }) => db.deleteCommunityPost(input.postId)),
    pinPost: publicProcedure
      .input(z.object({ postId: z.string(), isPinned: z.boolean() }))
      .mutation(async ({ input }) => db.pinCommunityPost(input.postId, input.isPinned)),
    likePost: publicProcedure
      .input(z.object({ postId: z.string(), employeeId: z.string(), liked: z.boolean() }))
      .mutation(async ({ input }) => db.likeCommunityPost(input.postId, input.employeeId, input.liked)),
    getMyLikes: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getCommunityPostLikesByEmployee(input.employeeId)),
    listComments: publicProcedure
      .input(z.object({ postId: z.string() }))
      .query(async ({ input }) => db.listCommunityComments(input.postId)),
    createComment: publicProcedure
      .input(z.object({
        commentId: z.string(),
        postId: z.string(),
        authorId: z.string(),
        authorName: z.string(),
        body: z.string(),
      }))
      .mutation(async ({ input }) => {
        await db.createCommunityComment(input);
        // Push notification to post author + prior commenters (excluding the commenter)
        try {
          const { employees: empTable, communityPosts, communityComments } = await import('../drizzle/schema');
          const { eq, inArray } = await import('drizzle-orm');
          const drizzleDb = await db.getDb();
          if (drizzleDb) {
            // Get post author
            const posts = await drizzleDb.select({ authorId: communityPosts.authorId, title: communityPosts.title }).from(communityPosts).where(eq(communityPosts.postId, input.postId)).limit(1);
            const postAuthorId = posts[0]?.authorId ?? null;
            const postTitle = posts[0]?.title ?? 'a post';
            // Get prior commenters
            const priorComments = await drizzleDb.select({ authorId: communityComments.authorId }).from(communityComments).where(eq(communityComments.postId, input.postId));
            const priorCommenterIds = [...new Set(priorComments.map((c: any) => c.authorId))];
            // Collect all unique recipient IDs (post author + prior commenters), excluding the current commenter
            const recipientIds = [...new Set([postAuthorId, ...priorCommenterIds].filter((id): id is string => !!id && id !== input.authorId))];
            if (recipientIds.length > 0) {
              const recipients = await drizzleDb.select({ pushToken: empTable.pushToken, employeeId: empTable.employeeId }).from(empTable).where(inArray(empTable.employeeId, recipientIds));
              const tokens = recipients.map((r: any) => r.pushToken).filter((t: any): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
              if (tokens.length > 0) {
                const preview = input.body.slice(0, 80);
                const pushPayloads = tokens.map((to: string) => ({ to, title: `💬 ${input.authorName} commented`, body: `On "${postTitle}": ${preview}`, sound: 'default', data: { screen: 'team-chat', channel: 'community', tab: 'community', postId: input.postId, senderId: input.authorId, senderName: input.authorName } }));
                await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(pushPayloads),
                });
              }
            }
          }
        } catch (e) {
          console.error('[push] community comment push failed:', e);
        }
        return { success: true };
      }),
    deleteComment: publicProcedure
      .input(z.object({ commentId: z.string(), postId: z.string() }))
      .mutation(async ({ input }) => db.deleteCommunityComment(input.commentId, input.postId)),
  }),
  inventory: router({
    // ─── Setup ───────────────────────────────────────────────────────────────
    seed: publicProcedure.mutation(async () => { await inv.seedDefaultInventory(); return { success: true }; }),

    // ─── Categories ──────────────────────────────────────────────────────────
    getCategories: publicProcedure.query(async () => inv.getAllCategories()),
    createCategory: publicProcedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input }) => { const id = await inv.createCategory(input.name); return { categoryId: id }; }),
    updateCategory: publicProcedure
      .input(z.object({ categoryId: z.string(), name: z.string().min(1) }))
      .mutation(async ({ input }) => { await inv.updateCategory(input.categoryId, input.name); return { success: true }; }),
    deleteCategory: publicProcedure
      .input(z.object({ categoryId: z.string() }))
      .mutation(async ({ input }) => { await inv.deleteCategory(input.categoryId); return { success: true }; }),

    // ─── Items ────────────────────────────────────────────────────────────────
    getItems: publicProcedure.query(async () => inv.getAllItems()),
    getItemsByCategory: publicProcedure
      .input(z.object({ categoryId: z.string() }))
      .query(async ({ input }) => inv.getItemsByCategory(input.categoryId)),
    createItem: publicProcedure
      .input(z.object({ categoryId: z.string(), name: z.string().min(1), minThreshold: z.number().int().min(0).default(0) }))
      .mutation(async ({ input }) => { const id = await inv.createItem(input.categoryId, input.name, input.minThreshold); return { itemId: id }; }),
    updateItem: publicProcedure
      .input(z.object({ itemId: z.string(), name: z.string().optional(), minThreshold: z.number().int().min(0).optional(), categoryId: z.string().optional() }))
      .mutation(async ({ input }) => { const { itemId, ...data } = input; await inv.updateItem(itemId, data); return { success: true }; }),
    deleteItem: publicProcedure
      .input(z.object({ itemId: z.string() }))
      .mutation(async ({ input }) => { await inv.deleteItem(input.itemId); return { success: true }; }),

    // ─── Locations (Blue Boxes) ───────────────────────────────────────────────
    getLocations: publicProcedure.query(async () => inv.getAllLocations()),
    createLocation: publicProcedure
      .input(z.object({ name: z.string().min(1), city: z.string().optional(), address: z.string().optional(), gateCode: z.string().optional(), boxCode: z.string().optional() }))
      .mutation(async ({ input }) => { const id = await inv.createLocation(input.name, input.city, input.address, input.gateCode, input.boxCode); return { locationId: id }; }),
    updateLocation: publicProcedure
      .input(z.object({ locationId: z.string(), name: z.string().optional(), city: z.string().optional(), address: z.string().optional(), gateCode: z.string().optional(), boxCode: z.string().optional() }))
      .mutation(async ({ input }) => { const { locationId, ...data } = input; await inv.updateLocation(locationId, data); return { success: true }; }),
    deleteLocation: publicProcedure
      .input(z.object({ locationId: z.string() }))
      .mutation(async ({ input }) => { await inv.deleteLocation(input.locationId); return { success: true }; }),

    // ─── Vans ─────────────────────────────────────────────────────────────────
    getVans: publicProcedure.query(async () => inv.getAllVans()),
    getVansByLocation: publicProcedure
      .input(z.object({ locationId: z.string() }))
      .query(async ({ input }) => inv.getVansByLocation(input.locationId)),
    createVan: publicProcedure
      .input(z.object({ name: z.string().min(1), locationId: z.string(), assignedEmployeeId: z.string().optional() }))
      .mutation(async ({ input }) => { const id = await inv.createVan(input.name, input.locationId, input.assignedEmployeeId); return { vanId: id }; }),
    updateVan: publicProcedure
      .input(z.object({ vanId: z.string(), name: z.string().optional(), locationId: z.string().optional(), assignedEmployeeId: z.string().nullable().optional() }))
      .mutation(async ({ input }) => { const { vanId, ...data } = input; await inv.updateVan(vanId, data); return { success: true }; }),
    deleteVan: publicProcedure
      .input(z.object({ vanId: z.string() }))
      .mutation(async ({ input }) => { await inv.deleteVan(input.vanId); return { success: true }; }),

    // ─── Stock ────────────────────────────────────────────────────────────────
    getStock: publicProcedure
      .input(z.object({ locationType: z.enum(["warehouse", "location", "van"]), locationId: z.string() }))
      .query(async ({ input }) => inv.getStock(input.locationType, input.locationId)),
    getAllStock: publicProcedure.query(async () => inv.getAllStock()),
    getStockWithDetails: publicProcedure.query(async () => inv.getStockWithDetails()),
    getLowStock: publicProcedure.query(async () => inv.getLowStockItems()),

    // ─── Actions ──────────────────────────────────────────────────────────────
    add: publicProcedure
      .input(z.object({
        itemId: z.string(), itemName: z.string(),
        locationType: z.enum(["warehouse", "location", "van"]), locationId: z.string(), locationName: z.string(),
        quantity: z.number().int().positive(), performedBy: z.string(), note: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await inv.addInventory(input.itemId, input.itemName, input.locationType, input.locationId, input.locationName, input.quantity, input.performedBy, input.note); return { success: true }; }),
    remove: publicProcedure
      .input(z.object({
        itemId: z.string(), itemName: z.string(),
        locationType: z.enum(["warehouse", "location", "van"]), locationId: z.string(), locationName: z.string(),
        quantity: z.number().int().positive(), performedBy: z.string(), note: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await inv.removeInventory(input.itemId, input.itemName, input.locationType, input.locationId, input.locationName, input.quantity, input.performedBy, input.note); return { success: true }; }),
    adjust: publicProcedure
      .input(z.object({
        itemId: z.string(), itemName: z.string(),
        locationType: z.enum(["warehouse", "location", "van"]), locationId: z.string(), locationName: z.string(),
        newQuantity: z.number().int().min(0), performedBy: z.string(), note: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await inv.adjustInventory(input.itemId, input.itemName, input.locationType, input.locationId, input.locationName, input.newQuantity, input.performedBy, input.note); return { success: true }; }),
    transfer: publicProcedure
      .input(z.object({
        itemId: z.string(), itemName: z.string(),
        fromType: z.enum(["warehouse", "location", "van"]), fromId: z.string(), fromName: z.string(),
        toType: z.enum(["warehouse", "location", "van"]), toId: z.string(), toName: z.string(),
        quantity: z.number().int().positive(), performedBy: z.string(), note: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await inv.transferInventory(input.itemId, input.itemName, input.fromType, input.fromId, input.fromName, input.toType, input.toId, input.toName, input.quantity, input.performedBy, input.note); return { success: true }; }),

    // ─── Location/Van Item Assignment ────────────────────────────────────────────────────────────────────────────────────
    assignItemToLocation: publicProcedure
      .input(z.object({ itemId: z.string(), locationType: z.enum(["location", "van"]), locationId: z.string() }))
      .mutation(async ({ input }) => { await inv.assignItemToLocation(input.itemId, input.locationType, input.locationId); return { success: true }; }),
    unassignItemFromLocation: publicProcedure
      .input(z.object({ itemId: z.string(), locationType: z.enum(["location", "van"]), locationId: z.string() }))
      .mutation(async ({ input }) => { await inv.unassignItemFromLocation(input.itemId, input.locationType, input.locationId); return { success: true }; }),

    // ─── Reporting ────────────────────────────────────────────────────────────────────────────────────────
    getTransactions: publicProcedure
      .input(z.object({ limit: z.number().int().optional(), itemId: z.string().optional() }))
      .query(async ({ input }) => inv.getTransactions(input.limit, input.itemId)),
    getTransactionsByLocation: publicProcedure
      .input(z.object({ locationType: z.enum(["warehouse", "location", "van"]), locationId: z.string(), limit: z.number().int().optional() }))
      .query(async ({ input }) => inv.getTransactionsByLocation(input.locationType, input.locationId, input.limit)),
    getUsageSummary: publicProcedure
      .input(z.object({ days: z.number().int().optional() }))
      .query(async ({ input }) => inv.getUsageSummary(input.days)),
  }),

  finance: router({
    // Cities
    getCities: publicProcedure.query(() => fin.getAllFinanceCities()),
    createCity: publicProcedure
      .input(z.object({ name: z.string().min(1) }))
      .mutation(async ({ input }) => fin.createFinanceCity(input.name)),
    updateCity: publicProcedure
      .input(z.object({ cityId: z.string(), name: z.string().min(1) }))
      .mutation(async ({ input }) => fin.updateFinanceCity(input.cityId, input.name)),
    deleteCity: publicProcedure
      .input(z.object({ cityId: z.string() }))
      .mutation(async ({ input }) => fin.deleteFinanceCity(input.cityId)),

    // Categories
    getCategories: publicProcedure.query(() => fin.getAllFinanceCategories()),
    createCategory: publicProcedure
      .input(z.object({ type: z.enum(["income", "expense"]), name: z.string().min(1) }))
      .mutation(async ({ input }) => fin.createFinanceCategory(input.type, input.name)),
    updateCategory: publicProcedure
      .input(z.object({ categoryId: z.string(), name: z.string().min(1) }))
      .mutation(async ({ input }) => fin.updateFinanceCategory(input.categoryId, input.name)),
    deleteCategory: publicProcedure
      .input(z.object({ categoryId: z.string() }))
      .mutation(async ({ input }) => fin.deleteFinanceCategory(input.categoryId)),

    // Transactions
    getTransactions: publicProcedure
      .input(z.object({
        type: z.enum(["income", "expense"]).optional(),
        location: z.string().optional(),
        categoryId: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
        cityId: z.string().optional(),
        missingReceiptOnly: z.boolean().optional(),
        limit: z.number().int().optional(),
        offset: z.number().int().optional(),
      }))
      .query(async ({ input }) => fin.getTransactions(input)),
    createTransaction: publicProcedure
      .input(z.object({
        type: z.enum(["income", "expense"]),
        categoryId: z.string(),
        categoryName: z.string(),
        amount: z.string(),
        date: z.string(),
        location: z.string(),
        cityId: z.string().optional(),
        van: z.string().optional(),
        notes: z.string().optional(),
        receiptUrl: z.string().optional(),
        performedBy: z.string(),
      }))
      .mutation(async ({ input }) => fin.createTransaction(input)),
    updateTransaction: publicProcedure
      .input(z.object({
        txId: z.string(),
        categoryId: z.string().optional(),
        categoryName: z.string().optional(),
        amount: z.string().optional(),
        date: z.string().optional(),
        location: z.string().optional(),
        van: z.string().optional(),
        notes: z.string().optional(),
        receiptUrl: z.string().optional(),
        performedBy: z.string(),
      }))
      .mutation(async ({ input }) => fin.updateTransaction(input.txId, input)),
    deleteTransaction: publicProcedure
      .input(z.object({ txId: z.string() }))
      .mutation(async ({ input }) => fin.deleteTransaction(input.txId)),

    // Reporting
    getSummary: publicProcedure
      .input(z.object({ dateFrom: z.string(), dateTo: z.string(), cityId: z.string().optional() }))
      .query(async ({ input }) => fin.getSummary(input.dateFrom, input.dateTo, input.cityId)),
    getByLocation: publicProcedure
      .input(z.object({ dateFrom: z.string(), dateTo: z.string() }))
      .query(async ({ input }) => fin.getByLocation(input.dateFrom, input.dateTo)),
    getByCategory: publicProcedure
      .input(z.object({ dateFrom: z.string(), dateTo: z.string(), type: z.enum(["income", "expense"]).optional(), cityId: z.string().optional() }))
      .query(async ({ input }) => fin.getByCategory(input.dateFrom, input.dateTo, input.type, input.cityId)),
    getMissingReceipts: publicProcedure
      .input((val: any) => val as { cityId?: string })
      .query(({ input }) => fin.getMissingReceipts(input?.cityId)),
    getPendingExpenseSummary: publicProcedure
      .input(z.object({ cityId: z.string().optional() }))
      .query(({ input }) => fin.getPendingExpenseSummary(input.cityId)),

    // Balance Sheet
    getBalanceSheet: publicProcedure.query(() => fin.getBalanceSheet()),

    // Assets
    getAssets: publicProcedure.query(() => fin.getAllAssets()),
    createAsset: publicProcedure
      .input(z.object({ assetType: z.enum(["current", "fixed"]), name: z.string(), value: z.string(), location: z.string().optional(), dateAdded: z.string(), notes: z.string().optional() }))
      .mutation(async ({ input }) => fin.createAsset(input)),
    updateAsset: publicProcedure
      .input(z.object({ assetId: z.string(), name: z.string().optional(), value: z.string().optional(), location: z.string().optional(), dateAdded: z.string().optional(), notes: z.string().optional() }))
      .mutation(async ({ input }) => fin.updateAsset(input.assetId, input)),
    deleteAsset: publicProcedure
      .input(z.object({ assetId: z.string() }))
      .mutation(async ({ input }) => fin.deleteAsset(input.assetId)),

    // Liabilities
    getLiabilities: publicProcedure.query(() => fin.getAllLiabilities()),
    createLiability: publicProcedure
      .input(z.object({ liabilityType: z.enum(["loan", "credit_card", "equipment_financing", "other"]), name: z.string(), balance: z.string(), monthlyPayment: z.string().optional(), interestRate: z.string().optional(), dueDate: z.string().optional(), notes: z.string().optional() }))
      .mutation(async ({ input }) => fin.createLiability(input)),
    updateLiability: publicProcedure
      .input(z.object({ liabilityId: z.string(), name: z.string().optional(), balance: z.string().optional(), monthlyPayment: z.string().optional(), interestRate: z.string().optional(), dueDate: z.string().optional(), notes: z.string().optional() }))
      .mutation(async ({ input }) => fin.updateLiability(input.liabilityId, input)),
    deleteLiability: publicProcedure
      .input(z.object({ liabilityId: z.string() }))
      .mutation(async ({ input }) => fin.deleteLiability(input.liabilityId)),

    // Equity
    getEquity: publicProcedure.query(() => fin.getAllEquity()),
    createEquity: publicProcedure
      .input(z.object({ description: z.string(), amount: z.string(), date: z.string(), notes: z.string().optional(), performedBy: z.string() }))
      .mutation(async ({ input }) => fin.createEquity(input)),
    deleteEquity: publicProcedure
      .input(z.object({ equityId: z.string() }))
      .mutation(async ({ input }) => fin.deleteEquity(input.equityId)),

    // Vendors
    getVendors: publicProcedure.query(() => fin.getAllVendors()),
    createVendor: publicProcedure
      .input(z.object({ name: z.string(), category: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), website: z.string().optional(), loginEmail: z.string().optional(), loginPassword: z.string().optional(), notes: z.string().optional() }))
      .mutation(async ({ input }) => fin.createVendor(input)),
    updateVendor: publicProcedure
      .input(z.object({ vendorId: z.string(), name: z.string().optional(), category: z.string().optional(), phone: z.string().optional(), email: z.string().optional(), website: z.string().optional(), loginEmail: z.string().optional(), loginPassword: z.string().optional(), notes: z.string().optional() }))
      .mutation(async ({ input }) => fin.updateVendor(input.vendorId, input)),
    deleteVendor: publicProcedure
      .input(z.object({ vendorId: z.string() }))
      .mutation(async ({ input }) => fin.deleteVendor(input.vendorId)),

    // Bank Statements
    uploadStatement: publicProcedure
      .input(z.object({
        base64Data: z.string(),
        fileName: z.string(),
        mimeType: z.string(),
        cityId: z.string().optional(),
        uploadedBy: z.string(),
      }))
      .mutation(async ({ input }) => bank.uploadAndParseStatement(input)),
    getStatements: publicProcedure
      .input(z.object({ cityId: z.string().optional() }))
      .query(async ({ input }) => bank.getStatements(input.cityId)),
    getBankTransactions: publicProcedure
      .input(z.object({ statementId: z.string() }))
      .query(async ({ input }) => bank.getBankTransactions(input.statementId)),
    matchBankTx: publicProcedure
      .input(z.object({ bankTxId: z.string(), financeTxId: z.string() }))
      .mutation(async ({ input }) => bank.matchBankTx(input)),
    unmatchBankTx: publicProcedure
      .input(z.object({ bankTxId: z.string() }))
      .mutation(async ({ input }) => bank.unmatchBankTx(input.bankTxId)),
    ignoreBankTx: publicProcedure
      .input(z.object({ bankTxId: z.string() }))
      .mutation(async ({ input }) => bank.ignoreBankTx(input.bankTxId)),
    importBankTx: publicProcedure
      .input(z.object({ bankTxId: z.string(), cityId: z.string().optional(), performedBy: z.string() }))
      .mutation(async ({ input }) => bank.importBankTxToFinance(input)),
    bulkImportStatement: publicProcedure
      .input(z.object({ statementId: z.string(), cityId: z.string().optional(), performedBy: z.string() }))
      .mutation(async ({ input }) => bank.bulkImportStatement(input)),
    deleteStatement: publicProcedure
      .input(z.object({ statementId: z.string() }))
      .mutation(async ({ input }) => bank.deleteStatement(input.statementId)),

    // Receipt upload
    uploadReceipt: publicProcedure
      .input(z.object({ base64: z.string(), mimeType: z.string(), txId: z.string().optional(), performedBy: z.string() }))
      .mutation(async ({ input }) => {
        const buf = Buffer.from(input.base64, "base64");
        const ext = input.mimeType.includes("pdf") ? "pdf" : "jpg";
        const key = `receipts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { url } = await storagePut(key, buf, input.mimeType);
        if (input.txId) {
          await fin.updateTransaction(input.txId, { receiptUrl: url, performedBy: input.performedBy });
        }
        return { url };
      }),
    // ─── Expense Submissions (Team Member) ────────────────────────────────────
    submitExpense: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        fullName: z.string(),
        amount: z.number().positive(),
        category: z.enum(["fuel", "supplies", "equipment", "car_wash", "food", "other"]),
        note: z.string().optional(),
        receiptBase64: z.string().optional(),
        receiptMimeType: z.string().optional(),
        jobId: z.string().optional(),
        cityId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        let receiptUrl: string | undefined;
        if (input.receiptBase64 && input.receiptMimeType) {
          const buf = Buffer.from(input.receiptBase64, "base64");
          const ext = input.receiptMimeType.includes("pdf") ? "pdf" : "jpg";
          const key = `expense-receipts/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
          const { url } = await storagePut(key, buf, input.receiptMimeType);
          receiptUrl = url;
        }
        return fin.submitExpense({
          employeeId: input.employeeId,
          fullName: input.fullName,
          amount: input.amount,
          category: input.category,
          note: input.note,
          receiptUrl,
          jobId: input.jobId,
          cityId: input.cityId,
        });
      }),
    getMyExpenses: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(({ input }) => fin.getExpensesForEmployee(input.employeeId)),
    getAllExpenses: publicProcedure
      .input(z.object({ status: z.enum(["pending", "approved", "rejected"]).optional(), cityName: z.string().optional() }))
      .query(({ input }) => fin.getAllExpenseSubmissions(input.status, input.cityName)),
    reviewExpense: publicProcedure
      .input(z.object({
        expenseId: z.string(),
        status: z.enum(["approved", "rejected"]),
        adminNote: z.string().optional(),
        reviewedBy: z.string(),
      }))
      .mutation(({ input }) => fin.reviewExpense(input.expenseId, input)),
    getFlexPassRequests: publicProcedure
      .input(z.object({ status: z.enum(["pending", "confirmed", "declined"]).optional() }))
      .query(async ({ input }) => {
        const conn = await (await import("mysql2/promise")).default.createConnection(process.env.DATABASE_URL!);
        try {
          let where = "WHERE 1=1";
          const params: any[] = [];
          if (input.status) { where += " AND status = ?"; params.push(input.status); }
          const [rows]: any = await conn.execute(
            `SELECT id, contract_id, contract_number, customer_name, customer_email, requested_date, requested_time, city, notes, status, admin_note, created_at FROM flex_pass_requests ${where} ORDER BY created_at DESC LIMIT 200`,
            params
          );
          return { requests: rows };
        } finally {
          await conn.end();
        }
      }),
    reviewFlexPassRequest: publicProcedure
      .input(z.object({
        requestId: z.number(),
        status: z.enum(["confirmed", "declined"]),
        adminNote: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const conn = await (await import("mysql2/promise")).default.createConnection(process.env.DATABASE_URL!);
        try {
          await conn.execute(
            `UPDATE flex_pass_requests SET status = ?, admin_note = ?, updated_at = NOW() WHERE id = ?`,
            [input.status, input.adminNote ?? null, input.requestId]
          );
          return { success: true };
        } finally {
          await conn.end();
        }
      }),
  }),

  customer: router({
    signup: publicProcedure
      .input(z.object({
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().optional(),
        password: z.string().min(6),
      }))
      .mutation(async ({ input }) => {
        const status = await customerDb.getCustomerPasswordStatus(input.email);
        if (status.exists && status.hasPassword) {
          // Account exists AND already has a password — tell them to log in instead
          return { success: false as const, message: "An account with this email already exists. Please log in or use Forgot Password to reset your password." };
        }
        if (status.exists && !status.hasPassword && status.customerId) {
          // Account exists but no password yet (added from a booking) — let them claim it
          await customerDb.setCustomerPassword(status.customerId, input.password);
          const token = await customerDb.createCustomerSession(status.customerId);
          const customer = await customerDb.getCustomerByEmail(input.email);
          return { success: true as const, token, customer: { customerId: customer!.customerId, firstName: customer!.firstName, lastName: customer!.lastName, email: customer!.email, phone: customer!.phone, profilePhotoUrl: customer!.profilePhotoUrl ?? null } };
        }
        // Brand new customer
        const customer = await customerDb.createCustomer(input);
        const token = await customerDb.createCustomerSession(customer.customerId);
        return { success: true as const, token, customer: { customerId: customer.customerId, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone, profilePhotoUrl: customer.profilePhotoUrl ?? null } };
      }),

    login: publicProcedure
      .input(z.object({ email: z.string().email(), password: z.string().min(1) }))
      .mutation(async ({ input }) => {
        const customer = await customerDb.verifyCustomerPassword(input.email, input.password);
        if (!customer) return { success: false as const, message: "Invalid email or password." };
        const token = await customerDb.createCustomerSession(customer.customerId);
        return { success: true as const, token, customer: { customerId: customer.customerId, firstName: customer.firstName, lastName: customer.lastName, email: customer.email, phone: customer.phone, profilePhotoUrl: null } };
      }),

    me: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) return null;
        return customerDb.getCustomerById(session.customerId);
      }),

    // ── Forgot Password / Portal Access ──────────────────────────────────────
    forgotPassword: publicProcedure
      .input(z.object({ email: z.string().email() }))
      .mutation(async ({ input }) => {
        // Always return success to avoid email enumeration
        const status = await customerDb.getCustomerPasswordStatus(input.email);
        if (!status.exists || !status.customerId) return { success: true };
        try {
          const resetToken = await customerDb.createPasswordResetToken(status.customerId);
          const resetLink = `https://luxurywashonwheels.app/api/reset-password?token=${resetToken}`;
          const { buildPortalAccessEmail } = await import('./email');
          const { subject, html } = buildPortalAccessEmail({
            customerFirstName: status.firstName ?? 'there',
            resetLink,
            isNewSetup: !status.hasPassword,
          });
          await sendEmail({ to: input.email, subject, html, type: 'other', urgent: true });
        } catch (e) { console.error('[ForgotPassword] failed:', e); }
        return { success: true };
      }),

    resetPassword: publicProcedure
      .input(z.object({ token: z.string(), newPassword: z.string().min(6) }))
      .mutation(async ({ input }) => {
        const customerId = await customerDb.validatePasswordResetToken(input.token);
        if (!customerId) return { success: false as const, message: 'This link has expired or is invalid. Please request a new one.' };
        await customerDb.setCustomerPassword(customerId, input.newPassword);
        await customerDb.consumePasswordResetToken(input.token);
        const sessionToken = await customerDb.createCustomerSession(customerId);
        const customer = await customerDb.getCustomerById(customerId);
        return { success: true as const, token: sessionToken, customer: { customerId: customer!.customerId, firstName: customer!.firstName, lastName: customer!.lastName, email: customer!.email, phone: customer!.phone, profilePhotoUrl: customer!.profilePhotoUrl ?? null } };
      }),

    // Admin: send portal access / password setup email to any customer
    adminSendPortalAccess: publicProcedure
      .input(z.object({ customerId: z.string(), email: z.string().optional(), phone: z.string().optional() }))
      .mutation(async ({ input }) => {
        let customer = await customerDb.getCustomerById(input.customerId);
        // customerId may be a key string like 'phone:8505551234' or 'email:foo@bar.com'
        // (used for schedule-only customers who don't have a portal account yet).
        // In that case, try to find or create a portal account by email/phone.
        if (!customer) {
          // Try to find by email first, then phone
          const { customers: custTable } = await import('../drizzle/schema');
          const db2 = db;
          const lookupEmail = input.email ?? (input.customerId.startsWith('email:') ? input.customerId.slice(6) : null);
          const lookupPhone = input.phone ?? (input.customerId.startsWith('phone:') ? input.customerId.slice(6) : null);
          if (lookupEmail || lookupPhone) {
            const conditions: any[] = [];
            if (lookupEmail) conditions.push(eq(custTable.email, lookupEmail));
            if (lookupPhone) {
              const np = lookupPhone.replace(/\D/g, '').slice(-10);
              if (np.length === 10) conditions.push(eq(custTable.phone, lookupPhone), eq(custTable.phone, np));
            }
            const dbInst = await db2.getDb();
            if (dbInst && conditions.length > 0) {
              const rows = await dbInst.select().from(custTable).where(or(...conditions)).limit(1);
              if (rows[0]) {
                const { passwordHash, ...safe } = rows[0];
                customer = safe as any;
              }
            }
          }
        }
        if (!customer) {
          // Auto-create a portal account so admin can send the setup link
          const createEmail = input.email ?? (input.customerId.startsWith('email:') ? input.customerId.slice(6) : null);
          const createPhone = input.phone ?? (input.customerId.startsWith('phone:') ? input.customerId.slice(6) : null);
          if (!createEmail) throw new Error('No email address found for this customer. Please add an email to their profile first, then try again.');
          // Create a new portal account with a random temporary password
          const { randomBytes: rb } = await import('crypto');
          const tempPassword = rb(12).toString('hex');
          customer = await customerDb.createCustomer({
            firstName: 'Customer',
            lastName: '',
            email: createEmail,
            phone: createPhone ?? undefined,
            password: tempPassword,
          });
        }
        if (!customer.email) throw new Error('Customer has no email address on file.');
        const status = await customerDb.getCustomerPasswordStatus(customer.email);
        const resetToken = await customerDb.createPasswordResetToken(customer.customerId);
        const resetLink = `https://luxurywashonwheels.app/api/reset-password?token=${resetToken}`;
        const { buildPortalAccessEmail } = await import('./email');
        const { subject, html } = buildPortalAccessEmail({
          customerFirstName: customer.firstName ?? 'there',
          resetLink,
          isNewSetup: !status.hasPassword,
        });
        await sendEmail({ to: customer.email, subject, html, type: 'other', urgent: true });
        return { success: true, email: customer.email };
      }),

    // Vehicles
    listVehicles: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) return [];
        return customerDb.getCustomerVehicles(session.customerId);
      }),

    addVehicle: publicProcedure
      .input(z.object({
        token: z.string(),
        year: z.string(),
        make: z.string(),
        model: z.string(),
        vehicleType: z.enum(["sedan", "suv", "large_suv_van", "truck", "rv"]),
        color: z.string().optional(),
        rvClass: z.string().optional(),
        rvLengthFt: z.number().int().positive().optional(),
        isDefault: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        return customerDb.addCustomerVehicle({ ...input, customerId: session.customerId });
      }),

    updateVehicle: publicProcedure
      .input(z.object({
        token: z.string(),
        vehicleId: z.string(),
        year: z.string().optional(),
        make: z.string().optional(),
        model: z.string().optional(),
        vehicleType: z.enum(["sedan", "suv", "large_suv_van", "truck", "rv"]).optional(),
        color: z.string().optional(),
        rvClass: z.string().optional(),
        rvLengthFt: z.number().int().positive().optional(),
        isDefault: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const { token, vehicleId, ...data } = input;
        return customerDb.updateCustomerVehicle(vehicleId, session.customerId, data);
      }),

    deleteVehicle: publicProcedure
      .input(z.object({ token: z.string(), vehicleId: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        return customerDb.deleteCustomerVehicle(input.vehicleId, session.customerId);
      }),

    // Addresses
    listAddresses: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) return [];
        return customerDb.getCustomerAddresses(session.customerId);
      }),

    addAddress: publicProcedure
      .input(z.object({
        token: z.string(),
        label: z.string().default("Home"),
        street: z.string(),
        unit: z.string().optional(),
        city: z.string(),
        state: z.string(),
        zip: z.string(),
        isDefault: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        return customerDb.addCustomerAddress({ ...input, customerId: session.customerId });
      }),

    updateAddress: publicProcedure
      .input(z.object({
        token: z.string(),
        addressId: z.string(),
        label: z.string().optional(),
        street: z.string().optional(),
        unit: z.string().nullable().optional(),
        city: z.string().optional(),
        state: z.string().optional(),
        zip: z.string().optional(),
        isDefault: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const { token, addressId, ...data } = input;
        return customerDb.updateCustomerAddress(addressId, session.customerId, data);
      }),

    deleteAddress: publicProcedure
      .input(z.object({ token: z.string(), addressId: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        return customerDb.deleteCustomerAddress(input.addressId, session.customerId);
      }),

    /** Customer: delete their own account (keeps job history, removes account + sessions + vehicles + addresses) */
    deleteMyAccount: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        return customerDb.deleteCustomer(session.customerId);
      }),

    // Bookings
    createBooking: publicProcedure
      .input(z.object({
        token: z.string(),
        vehicleId: z.string(),
        vehicleType: z.enum(["sedan", "suv", "large_suv_van", "truck", "rv"]),
        vehicleLabel: z.string().optional(),
        packageId: z.string(),
        packageName: z.string(),
        addons: z.array(z.string()).optional(),
        addressId: z.string().optional(),
        addressLabel: z.string().optional(),
        city: z.string().optional(),
        scheduledDate: z.string(),
        scheduledTime: z.string(),
        subtotal: z.number(),
        total: z.number(),
        notes: z.string().optional(),
        discountCode: z.string().optional(),
        discountAmount: z.number().optional(),
        depositAmount: z.number().optional(),
        depositPaymentIntentId: z.string().optional(),
        referralCode: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        // Check Do Not Service list using customer phone/email
        const customer = await customerDb.getCustomerById(session.customerId);
        if (customer) {
          const np = customer.phone ? customer.phone.replace(/\D/g, '').slice(-10) : null;
          const customerKey = (np && np.length === 10)
            ? `phone:${np}`
            : customer.email
            ? `email:${customer.email.toLowerCase()}`
            : `name:${(customer.firstName + ' ' + customer.lastName).toLowerCase().trim()}`;
          const isDns = await db.isOnDoNotServiceList(customerKey);
          if (isDns) throw new Error("We are unable to process your booking at this time. Please contact us for assistance.");
        }
        const { token, ...data } = input;
        const booking = await customerDb.createCustomerBooking({ ...data, customerId: session.customerId });
        // Auto-populate customer city from booking address (only if not already set)
        if (data.city) {
          try { await customerDb.updateCustomerCity(session.customerId, data.city); } catch (e) { console.error('[Booking] Failed to update customer city:', e); }
        }
        // Auto-save address to customer_addresses if it's a new address (no addressId provided)
        // This ensures addresses entered during booking are saved for future bookings
        if (!data.addressId && data.addressLabel) {
          try {
            // Parse "123 Main St, Niceville, FL 32578" or "123 Main St, Unit 4B, Niceville, FL 32578"
            const parseAddressLabel = (label: string) => {
              // Split by comma and trim each part
              const parts = label.split(',').map(p => p.trim()).filter(Boolean);
              if (parts.length < 2) return null;
              // Last part: try to extract state + zip (e.g. "FL 32578")
              const lastPart = parts[parts.length - 1];
              const stateZipMatch = lastPart.match(/^([A-Z]{2})\s+(\d{5}(?:-\d{4})?)$/);
              if (!stateZipMatch) return null;
              const state = stateZipMatch[1];
              const zip = stateZipMatch[2];
              // Second-to-last part: city
              const city = parts[parts.length - 2];
              // Everything before city is street (join back with comma)
              const street = parts.slice(0, parts.length - 2).join(', ');
              if (!street || !city) return null;
              return { street, city, state, zip };
            };
            const parsed = parseAddressLabel(data.addressLabel);
            if (parsed) {
              // Check if customer already has this address saved (match on street + city)
              const existingAddresses = await customerDb.getCustomerAddresses(session.customerId);
              const alreadySaved = existingAddresses.some(
                a => a.street.toLowerCase().trim() === parsed.street.toLowerCase().trim() &&
                     a.city.toLowerCase().trim() === parsed.city.toLowerCase().trim()
              );
              if (!alreadySaved) {
                const isFirst = existingAddresses.length === 0;
                await customerDb.addCustomerAddress({
                  customerId: session.customerId,
                  label: 'Service Location',
                  street: parsed.street,
                  city: parsed.city,
                  state: parsed.state,
                  zip: parsed.zip,
                  isDefault: isFirst, // make it default if it's their first address
                });
              }
            }
          } catch (addrErr) {
            console.error('[Booking] Failed to auto-save address:', addrErr);
          }
        }

        // Generate confirm token outside the try block so it's in scope for the email send below
        const { randomBytes: _rbOuter } = await import('crypto');
        const confirmToken = _rbOuter(24).toString('hex');
        const baseUrl = process.env.APP_URL ?? 'https://luxurywashonwheels.app';
        const confirmUrl = `${baseUrl}/api/confirm/${confirmToken}`;

        // Mirror booking into schedule_jobs so it appears on the admin/team calendar immediately
        try {
          const customerName = customer
            ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim()
            : "Portal Customer";
          // Parse hours from slot label like "8:00 AM – 12:00 PM" or "1:00 PM – 5:00 PM"
          const parseHour = (t: string): number => {
            const m = t.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
            if (!m) return 8;
            let h = parseInt(m[1], 10);
            const mins = m[2] ? parseInt(m[2], 10) : 0;
            const ampm = m[3].toUpperCase();
            if (ampm === "PM" && h !== 12) h += 12;
            if (ampm === "AM" && h === 12) h = 0;
            return h + (mins >= 30 ? 0.5 : 0);
          };
          // Extract start and end from slot label (e.g. "8:00 AM – 12:00 PM")
          const parts = data.scheduledTime.split(/[–\-]/).map(s => s.trim());
          const startHour = parseHour(parts[0] ?? data.scheduledTime);
          const endHour = parts[1] ? parseHour(parts[1]) : Math.min(startHour + 3, 17);
          const timeSlot = data.scheduledTime;
          const vParts = (data.vehicleLabel ?? "").split(" ");
          const vYear = vParts[0] ?? "";
          const vMake = vParts[1] ?? "";
          const vModel = vParts.slice(2).join(" ") || "";
          // Auto-assign first available detailer for this city/date/slot
          const city = data.city ?? "";
          const availableDetailers = city
            ? await db.getAvailableDetailersForSlot(data.scheduledDate, startHour, endHour, city)
            : [];
          const assignedDetailer = availableDetailers[0] ?? null;
          // confirmToken / confirmUrl already defined above (outer scope)
          await db.upsertScheduleJob({
            jobId: `portal_${booking.bookingRef}`,
            location: city || "Unknown",
            date: data.scheduledDate,
            timeSlot,
            startHour: String(startHour),
            endHour: String(endHour),
            customerId: session.customerId,
            customerName,
            customerPhone: customer?.phone ?? "",
            customerEmail: customer?.email ?? "",
            customerAddress: data.addressLabel ?? "",
            vehicleType: data.vehicleType,
            vehicleYear: vYear,
            vehicleMake: vMake,
            vehicleModel: vModel,
            vehicleColor: "",
            packageType: data.packageId,
            serviceDescription: data.packageName,
            selectedAddons: JSON.stringify(data.addons ?? []),
            totalPrice: String(data.total),
            depositAmount: data.depositAmount != null ? String(data.depositAmount) : "0",
            discountCode: data.discountCode,
            discountAmount: data.discountAmount != null ? String(data.discountAmount) : "0",
            status: "pending",
            source: "portal_app",
            onlineBookingId: booking.bookingRef,
            notes: data.notes ?? "",
            assignedTo: assignedDetailer?.employeeId ?? undefined,
            apptConfirmToken: confirmToken,
          });
          // Notify assigned detailer (in-app notification + push)
          if (assignedDetailer) {
            try {
              await db.createNotification({
                notificationId: `ASSIGNED_${booking.bookingRef}_${assignedDetailer.employeeId}`,
                employeeId: assignedDetailer.employeeId,
                fullName: assignedDetailer.fullName,
                notificationType: "ai_booking",
                title: `New Job Assigned: ${customerName}`,
                message: `You have been assigned a ${data.packageName} on ${data.scheduledDate} at ${data.scheduledTime} in ${city}. Customer: ${customerName}. Ref: ${booking.bookingRef}`,
                createdBy: "Customer Portal",
                status: "unread",
                requiresAcknowledgment: "no",
              });
            } catch (e) { console.error("[Booking] Failed to notify detailer:", e); }
            // Push notification to assigned detailer only
            try {
              const { employees: empTable } = await import('../drizzle/schema.js');
              const { eq: eqOp2 } = await import('drizzle-orm');
              const drizzleDb2 = await db.getDb();
              if (drizzleDb2) {
                const [detailerRow] = await drizzleDb2
                  .select({ pushToken: empTable.pushToken })
                  .from(empTable)
                  .where(eqOp2(empTable.employeeId, assignedDetailer.employeeId))
                  .limit(1);
                const token = detailerRow?.pushToken;
                if (token && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))) {
                  const cityLabel = city.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
                  const portalJobId = `portal_${booking.bookingRef}`;
                  await fetch('https://exp.host/--/api/v2/push/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify([{
                      to: token,
                      title: `📋 New Job Assigned — ${cityLabel}`,
                      body: `${customerName} · ${data.scheduledDate} ${data.scheduledTime} · ${data.packageName}`,
                      sound: 'default',
                      data: {
                        screen: 'job_detail',
                        jobId: portalJobId,
                        date: data.scheduledDate,
                        timeSlot: data.scheduledTime,
                        customerName,
                        packageType: data.packageName,
                        location: city,
                        eventType: 'created',
                      },
                    }]),
                  });
                }
              }
            } catch (pushErr) {
              console.error('[Booking] Portal detailer push notification error:', pushErr);
            }
          }
        } catch (schedErr) {
          console.error("[Booking] Failed to mirror to schedule_jobs:", schedErr);
        }
        // Send booking confirmation email (non-blocking))
        if (customer?.email) {
          try {
            const customerName = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Valued Customer";
            // Resolve price book ID (pb_xxx) to human-readable name
            let resolvedPackageName = data.packageName;
            if (data.packageName && data.packageName.startsWith("pb_")) {
              try {
                const pbServices = await db.listPriceBookServices();
                const pbMatch = pbServices.find((s) => s.serviceId === data.packageName);
                if (pbMatch) resolvedPackageName = pbMatch.name;
              } catch { /* fallback to raw id */ }
            }
            const { subject, html } = buildBookingConfirmationEmail({
              customerName,
              bookingRef: booking.bookingRef,
              packageName: resolvedPackageName,
              vehicleLabel: data.vehicleLabel,
              scheduledDate: data.scheduledDate,
              scheduledTime: data.scheduledTime,
              addressLabel: data.addressLabel,
              addons: data.addons,
              total: data.total,
              notes: data.notes,
              confirmUrl,
            });
            await sendEmail({
              to: customer.email,
              subject,
              html,
              type: "booking_confirmation",
              customerName,
              bookingRef: booking.bookingRef,
            });
          } catch (emailErr) {
            console.error("[Email] Failed to send booking confirmation:", emailErr);
          }
        }
        // Admin new booking alert — email + in-app notification
        try {
          const cName = customer
            ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Portal Customer"
            : "Portal Customer";
          const admins = await db.getAdminEmployees();
          for (const admin of admins) {
            await db.createNotification({
              notificationId: `PORTAL_BOOKING_${booking.bookingRef}_${admin.employeeId}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName,
              notificationType: "ai_booking",
              title: `New Portal Booking: ${cName}`,
              message: `${cName} booked a ${data.packageName} on ${data.scheduledDate} at ${data.scheduledTime} in ${data.city ?? "Unknown"}. Ref: ${booking.bookingRef}`,
              createdBy: "Customer Portal",
              status: "unread",
              requiresAcknowledgment: "no",
            });
          }
          if (ENV.gmailUser) {
            const alertEmail = buildAdminBookingAlertEmail({
              customerName: cName,
              customerEmail: customer?.email ?? "",
              bookingRef: booking.bookingRef,
              packageName: data.packageName,
              vehicleLabel: data.vehicleLabel ?? "",
              scheduledDate: data.scheduledDate,
              scheduledTime: data.scheduledTime,
              city: data.city ?? "",
              addressLabel: data.addressLabel,
              total: data.total,
            });
            await sendEmail({ to: ENV.gmailUser, subject: alertEmail.subject, html: alertEmail.html, type: "other", urgent: true, customerName: cName, bookingRef: booking.bookingRef });
          }
        } catch (alertErr) {
          console.error("[Booking] Failed to send admin alert:", alertErr);
        }
        // ── Auto-promote any matching abandoned cart to confirmed ────────────────
        // When a customer who had an abandoned cart completes a booking,
        // update their abandoned record(s) to "confirmed" so they no longer
        // appear in the Abandoned pipeline column.
        try {
          if (customer?.phone || customer?.email) {
            const { onlineBookings: obTable } = await import('../drizzle/schema.js');
            const drizzleDb2 = await db.getDb();
            if (drizzleDb2) {
              const normPhone = customer?.phone ? customer.phone.replace(/\D/g, '').slice(-10) : null;
              const matchConditions: any[] = [];
              if (normPhone && normPhone.length === 10) {
                matchConditions.push(like(obTable.phone, `%${normPhone}`));
              }
              if (customer?.email) {
                matchConditions.push(eq(obTable.email, customer.email.toLowerCase()));
              }
              if (matchConditions.length > 0) {
                const abandonedCarts = await (drizzleDb2.select({ bookingId: obTable.bookingId }) as any)
                  .from(obTable)
                  .where(and(eq(obTable.status as any, 'abandoned'), or(...matchConditions)))
                  .limit(10);
                for (const cart of abandonedCarts) {
                  await (drizzleDb2.update(obTable) as any)
                    .set({ status: 'confirmed' })
                    .where(eq(obTable.bookingId, cart.bookingId));
                  console.log(`[Booking] Auto-promoted abandoned cart ${cart.bookingId} to confirmed`);
                }
              }
            }
          }
        } catch (promoteErr) {
          console.error('[Booking] Failed to auto-promote abandoned cart:', promoteErr);
        }

        // Award referral points if a referral code was provided
        if (input.referralCode) {
          try {
            const referrer = await db.getCustomerByReferralCode(input.referralCode);
            if (referrer && referrer.customerId !== session.customerId) {
              const referralId = await db.createReferral(
                referrer.customerId,
                session.customerId,
                customer?.email ?? ''
              );
              await db.completeReferral(referralId);
              // Notify the referrer that their friend booked and they earned points
              try {
                const referrerPushToken = await db.getCustomerPushToken(referrer.customerId);
                if (referrerPushToken && (referrerPushToken.startsWith('ExponentPushToken[') || referrerPushToken.startsWith('ExpoPushToken['))) {
                  await fetch('https://exp.host/--/api/v2/push/send', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      to: referrerPushToken,
                      title: '🎉 Your referral just booked!',
                      body: 'A friend used your referral code and booked a service. You earned 500 points!',
                      data: { screen: 'profile', section: 'rewards' },
                      sound: 'default',
                    }),
                  });
                }
              } catch (pushErr) {
                console.error('[Referral] Failed to send push notification to referrer:', pushErr);
              }
            }
          } catch (refErr) {
            console.error('[Booking] Failed to process referral reward:', refErr);
          }
        }
        return booking;
      }),
    // Customer: cancel a booking (only allowed >24h before appointment)
    cancelBooking: publicProcedure
      .input(z.object({ token: z.string(), bookingRef: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Not authenticated");
        const bk = await customerDb.getCustomerBookingByRef(input.bookingRef, session.customerId);
        if (!bk) throw new Error("Booking not found");
        if (bk.status === "cancelled") throw new Error("Booking is already cancelled.");
        if (bk.status === "completed") throw new Error("Cannot cancel a completed booking.");
        const parseHour = (t: string): number => {
          const m = t.trim().match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
          if (!m) return 8;
          let h = parseInt(m[1], 10);
          const mins = m[2] ? parseInt(m[2], 10) : 0;
          if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
          if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
          return h + (mins >= 30 ? 0.5 : 0);
        };
        const startPart = bk.scheduledTime.split(/[\u2013\-]/)[0] ?? bk.scheduledTime;
        const startHour = parseHour(startPart);
        const apptDt = new Date(`${bk.scheduledDate}T${String(startHour).padStart(2, "0")}:00:00`);
        const hoursUntil = (apptDt.getTime() - Date.now()) / 3600000;
        if (hoursUntil < 24) throw new Error("Cancellations must be made at least 24 hours before your appointment.");
        await customerDb.updateCustomerBookingStatus(input.bookingRef, "cancelled");
        try {
          const { scheduleJobs, onlineBookings: obCancel } = await import("../drizzle/schema");
          const { eq: eqSj, or: orSj, and: andSj } = await import("drizzle-orm");
          const dbConn = await (await import("./db")).getDb();
          if (dbConn) {
            // Cancel schedule_jobs matched by onlineBookingId (online-booked jobs)
            await dbConn.update(scheduleJobs).set({ status: "cancelled" }).where(eqSj(scheduleJobs.onlineBookingId, input.bookingRef));
            // Also cancel admin-created schedule_jobs matched by customerId + date + timeSlot
            // (these have onlineBookingId = NULL so the above WHERE never matches them)
            if (bk.customerId && bk.scheduledDate && bk.scheduledTime) {
              await dbConn.update(scheduleJobs)
                .set({ status: "cancelled" })
                .where(andSj(
                  eqSj(scheduleJobs.customerId, bk.customerId),
                  eqSj(scheduleJobs.date, bk.scheduledDate),
                  eqSj(scheduleJobs.timeSlot, bk.scheduledTime),
                  orSj(eqSj(scheduleJobs.status, "confirmed"), eqSj(scheduleJobs.status, "pending"))
                ));
            }
            // Also cancel the linked online_bookings row so it disappears from detailer/admin sync
            await dbConn.update(obCancel).set({ status: 'cancelled' }).where(eqSj(obCancel.bookingId, input.bookingRef));
          }
        } catch (e) { console.error("[Cancel] schedule_jobs/online_bookings update failed:", e); }
        const cust = await customerDb.getCustomerById(session.customerId);
        const cName2 = cust ? `${cust.firstName ?? ""} ${cust.lastName ?? ""}`.trim() : "Portal Customer";
        try {
          const admins2 = await db.getAdminEmployees();
          for (const admin of admins2) {
            await db.createNotification({
              notificationId: `CANCEL_${input.bookingRef}_${admin.employeeId}_${Date.now()}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName,
              notificationType: "ai_booking",
              title: `Booking Cancelled: ${cName2}`,
              message: `${cName2} cancelled their ${bk.packageName} on ${bk.scheduledDate} at ${bk.scheduledTime}. Ref: ${input.bookingRef}`,
              createdBy: "Customer Portal",
              status: "unread",
              requiresAcknowledgment: "no",
            });
          }
          if (ENV.gmailUser) {
            const ce = buildAdminBookingChangeEmail({ changeType: "cancellation", customerName: cName2, customerEmail: cust?.email ?? "", bookingRef: input.bookingRef, packageName: bk.packageName, vehicleLabel: bk.vehicleLabel ?? "", originalDate: bk.scheduledDate, originalTime: bk.scheduledTime, city: bk.city ?? "" });
            await sendEmail({ to: ENV.gmailUser, subject: ce.subject, html: ce.html, type: "other", urgent: true, customerName: cName2, bookingRef: input.bookingRef });
          }
        } catch (e) { console.error("[Cancel] admin notify failed:", e); }
        // Notify assigned detailer via push
        try {
          if (bk.assignedEmployeeId) {
            const { employees: empTbl } = await import('../drizzle/schema');
            const { eq: eqEmp, or: orEmp, like: likeEmp } = await import('drizzle-orm');
            const dbPush = await db.getDb();
            if (dbPush) {
              const empRows = await dbPush.select({ pushToken: empTbl.pushToken }).from(empTbl)
                .where(orEmp(eqEmp(empTbl.employeeId, bk.assignedEmployeeId), likeEmp(empTbl.fullName, `%${bk.assignedEmployeeId}%`))).limit(2);
              const token = empRows[0]?.pushToken;
              if (token && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))) {
                await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify([{ to: token, title: '❌ Job Cancelled by Customer', body: `${cName2} cancelled their ${bk.packageName} on ${bk.scheduledDate}`, sound: 'default' }]),
                });
              }
            }
          }
        } catch (e) { console.error('[Cancel] detailer push failed:', e); }
        return { success: true };
      }),
    // Customer: reschedule a booking (only allowed >24h before appointment)
    rescheduleBooking: publicProcedure
      .input(z.object({ token: z.string(), bookingRef: z.string(), newDate: z.string(), newTime: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Not authenticated");
        const bk2 = await customerDb.getCustomerBookingByRef(input.bookingRef, session.customerId);
        if (!bk2) throw new Error("Booking not found");
        if (bk2.status === "cancelled") throw new Error("Cannot reschedule a cancelled booking.");
        if (bk2.status === "completed") throw new Error("Cannot reschedule a completed booking.");
        const parseHour2 = (t: string): number => {
          const m = t.trim().match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
          if (!m) return 8;
          let h = parseInt(m[1], 10);
          const mins = m[2] ? parseInt(m[2], 10) : 0;
          if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
          if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
          return h + (mins >= 30 ? 0.5 : 0);
        };
        const sp2 = bk2.scheduledTime.split(/[\u2013\-]/)[0] ?? bk2.scheduledTime;
        const sh2 = parseHour2(sp2);
        const apptDt2 = new Date(`${bk2.scheduledDate}T${String(sh2).padStart(2, "0")}:00:00`);
        if ((apptDt2.getTime() - Date.now()) / 3600000 < 24) throw new Error("Reschedules must be made at least 24 hours before your appointment.");
        const newStartPart = input.newTime.split(/[\u2013\-]/)[0] ?? input.newTime;
        const newEndPart = input.newTime.split(/[\u2013\-]/).pop() ?? input.newTime;
        const newSH = parseHour2(newStartPart);
        const newEH = parseHour2(newEndPart);
        if (bk2.city) {
          const avail = await db.getAvailableDetailersForSlot(input.newDate, newSH, newEH, bk2.city);
          if (avail.length === 0) throw new Error("No detailers are available for the selected time slot. Please choose a different time.");
        }
        const dbConn3 = await (await import("./db")).getDb();
        if (!dbConn3) throw new Error("Database not available");
        const { customerBookings: cbTable } = await import("../drizzle/schema");
        const { eq: eqCb } = await import("drizzle-orm");
        await dbConn3.update(cbTable).set({ scheduledDate: input.newDate, scheduledTime: input.newTime }).where(eqCb(cbTable.bookingRef, input.bookingRef));
        try {
          const { scheduleJobs: sjTable } = await import("../drizzle/schema");
          await dbConn3.update(sjTable).set({ date: input.newDate, timeSlot: input.newTime, startHour: String(newSH), endHour: String(newEH) }).where(eqCb(sjTable.onlineBookingId, input.bookingRef));
        } catch (e) { console.error("[Reschedule] schedule_jobs update failed:", e); }
        const cust3 = await customerDb.getCustomerById(session.customerId);
        const cName3 = cust3 ? `${cust3.firstName ?? ""} ${cust3.lastName ?? ""}`.trim() : "Portal Customer";
        try {
          const admins3 = await db.getAdminEmployees();
          for (const admin of admins3) {
            await db.createNotification({
              notificationId: `RESCHEDULE_${input.bookingRef}_${admin.employeeId}_${Date.now()}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName,
              notificationType: "ai_booking",
              title: `Booking Rescheduled: ${cName3}`,
              message: `${cName3} rescheduled their ${bk2.packageName} from ${bk2.scheduledDate} ${bk2.scheduledTime} to ${input.newDate} ${input.newTime}. Ref: ${input.bookingRef}`,
              createdBy: "Customer Portal",
              status: "unread",
              requiresAcknowledgment: "no",
            });
          }
          if (ENV.gmailUser) {
            const re = buildAdminBookingChangeEmail({ changeType: "reschedule", customerName: cName3, customerEmail: cust3?.email ?? "", bookingRef: input.bookingRef, packageName: bk2.packageName, vehicleLabel: bk2.vehicleLabel ?? "", originalDate: bk2.scheduledDate, originalTime: bk2.scheduledTime, newDate: input.newDate, newTime: input.newTime, city: bk2.city ?? "" });
            await sendEmail({ to: ENV.gmailUser, subject: re.subject, html: re.html, type: "other", urgent: true, customerName: cName3, bookingRef: input.bookingRef });
          }
        } catch (e) { console.error("[Reschedule] admin notify failed:", e); }
        // Notify assigned detailer via push
        try {
          if (bk2.assignedEmployeeId) {
            const { employees: empTbl2 } = await import('../drizzle/schema');
            const { eq: eqEmp2, or: orEmp2, like: likeEmp2 } = await import('drizzle-orm');
            const dbPush2 = await db.getDb();
            if (dbPush2) {
              const empRows2 = await dbPush2.select({ pushToken: empTbl2.pushToken }).from(empTbl2)
                .where(orEmp2(eqEmp2(empTbl2.employeeId, bk2.assignedEmployeeId), likeEmp2(empTbl2.fullName, `%${bk2.assignedEmployeeId}%`))).limit(2);
              const token2 = empRows2[0]?.pushToken;
              if (token2 && (token2.startsWith('ExponentPushToken[') || token2.startsWith('ExpoPushToken['))) {
                await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify([{ to: token2, title: '🔄 Job Rescheduled by Customer', body: `${cName3} moved their ${bk2.packageName} to ${input.newDate} ${input.newTime}`, sound: 'default' }]),
                });
              }
            }
          }
        } catch (e) { console.error('[Reschedule] detailer push failed:', e); }
        return { success: true };
      }),
    listBookings: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) return [];
        return customerDb.getCustomerBookings(session.customerId);
      }),

    getBooking: publicProcedure
      .input(z.object({ token: z.string(), bookingRef: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) return null;
        return customerDb.getCustomerBookingByRef(input.bookingRef, session.customerId);
      }),

    // Guest: lookup booking by email and reference number (no auth required)
    lookupGuestBooking: publicProcedure
      .input(z.object({ email: z.string().email(), bookingRef: z.string() }))
      .query(async ({ input }) => {
        const booking = await customerDb.getGuestBookingByEmailAndRef(input.email, input.bookingRef);
        if (!booking) return null;
        // Return minimal booking info for guest (no sensitive customer data beyond what they already know)
        return {
          bookingRef: booking.bookingRef,
          vehicleLabel: booking.vehicleLabel,
          packageName: booking.packageName,
          scheduledDate: booking.scheduledDate,
          scheduledTime: booking.scheduledTime,
          city: booking.city,
          addressLabel: booking.addressLabel,
          total: booking.total,
          status: booking.status,
          createdAt: booking.createdAt,
        };
      }),

    // Staff-facing: list all customer portal bookings for a city/date range (no auth token needed — staff only)
    listByLocation: publicProcedure
      .input(z.object({
        location: z.string(),
        startDate: z.string(),
        endDate: z.string(),
        assignedTo: z.string().optional(), // if provided, only return portal bookings for this detailer
      }))
      .query(async ({ input }) => {
        return customerDb.getCustomerBookingsByLocation(input.location, input.startDate, input.endDate, input.assignedTo);
      }),
    // Admin: permanently delete a customer
    adminDelete: publicProcedure
      .input(z.object({ customerId: z.string() }))
      .mutation(async ({ input }) => customerDb.deleteCustomer(input.customerId)),
    // Admin: set or clear the Do Not Service flag
    setDoNotService: publicProcedure
      .input(z.object({
        customerId: z.string(),
        doNotService: z.boolean(),
        reason: z.string().optional(),
      }))
      .mutation(async ({ input }) => customerDb.setDoNotService(input.customerId, input.doNotService, input.reason)),
    // Check if a customer is flagged Do Not Service (used during booking flow)
    checkDoNotService: publicProcedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => ({ doNotService: await customerDb.isCustomerDoNotService(input.customerId) })),

    // Customer: cancel a schedule_job by its numeric id (admin-scheduled jobs)
    cancelScheduleJob: publicProcedure
      .input(z.object({ token: z.string(), jobId: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Not authenticated");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error("Database not available");
        const { scheduleJobs: sjTbl } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const customer = await customerDb.getCustomerById(session.customerId);
        if (!customer) throw new Error("Customer not found");
        const normPhone = customer.phone ? customer.phone.replace(/\D/g, "").slice(-10) : null;
        const normEmail = customer.email ? customer.email.toLowerCase() : null;
        // Find the job and verify it belongs to this customer
        const rows = await drizzleDb.select().from(sjTbl).where(
          eq(sjTbl.id, parseInt(input.jobId, 10))
        );
        const job = rows[0];
        if (!job) throw new Error("Job not found");
        // Verify ownership: customerId, email, or phone must match
        const jobPhone = job.customerPhone ? job.customerPhone.replace(/\D/g, "").slice(-10) : null;
        const jobEmail = job.customerEmail ? job.customerEmail.toLowerCase() : null;
        const owned = job.customerId === session.customerId ||
          (normEmail && jobEmail && normEmail === jobEmail) ||
          (normPhone && jobPhone && normPhone === jobPhone);
        if (!owned) throw new Error("Job not found");
        if (job.status === "cancelled") throw new Error("Job is already cancelled.");
        if (job.status === "completed") throw new Error("Cannot cancel a completed job.");
        // 24-hour guard
        const parseHourLocal = (t: string): number => {
          const m = t.trim().match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
          if (!m) return 8;
          let h = parseInt(m[1], 10);
          if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
          if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
          return h;
        };
        const startPart = (job.timeSlot ?? "").split(/[\u2013\-]/)[0] ?? job.timeSlot ?? "";
        const startHour = parseHourLocal(startPart);
        const apptDt = new Date(`${job.date}T${String(startHour).padStart(2, "0")}:00:00`);
        if ((apptDt.getTime() - Date.now()) / 3600000 < 24) throw new Error("Cancellations must be made at least 24 hours before your appointment.");
        await drizzleDb.update(sjTbl).set({ status: "cancelled" }).where(eq(sjTbl.id, parseInt(input.jobId, 10)));
        // Also cancel the linked online_bookings row so it disappears from detailer/admin sync
        try {
          if (job.onlineBookingId) {
            const { onlineBookings: obTbl } = await import("../drizzle/schema");
            await drizzleDb.update(obTbl).set({ status: 'cancelled' }).where(eq(obTbl.bookingId, job.onlineBookingId as string));
          }
        } catch (e) { console.error("[CancelScheduleJob] online_bookings cancel failed:", e); }
        // Notify admins
        try {
          const cName = `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim() || "Portal Customer";
          const admins = await db.getAdminEmployees();
          for (const admin of admins) {
            await db.createNotification({
              notificationId: `CANCEL_SJ_${input.jobId}_${admin.employeeId}_${Date.now()}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName,
              notificationType: "ai_booking",
              title: `Job Cancelled: ${cName}`,
              message: `${cName} cancelled their ${await db.resolvePackageNameAsync(job.packageType as string | null)} on ${job.date} at ${job.timeSlot ?? ""}.`,
              createdBy: "Customer Portal",
              status: "unread",
              requiresAcknowledgment: "no",
            });
          }
        } catch (e) { console.error("[CancelScheduleJob] admin notify failed:", e); }
        return { success: true };
      }),

    // Customer: reschedule a schedule_job by its numeric id (admin-scheduled jobs)
    rescheduleScheduleJob: publicProcedure
      .input(z.object({ token: z.string(), jobId: z.string(), newDate: z.string(), newTime: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Not authenticated");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error("Database not available");
        const { scheduleJobs: sjTbl2 } = await import("../drizzle/schema");
        const { eq: eqSj2 } = await import("drizzle-orm");
        const customer2 = await customerDb.getCustomerById(session.customerId);
        if (!customer2) throw new Error("Customer not found");
        const normPhone2 = customer2.phone ? customer2.phone.replace(/\D/g, "").slice(-10) : null;
        const normEmail2 = customer2.email ? customer2.email.toLowerCase() : null;
        const rows2 = await drizzleDb.select().from(sjTbl2).where(eqSj2(sjTbl2.id, parseInt(input.jobId, 10)));
        const job2 = rows2[0];
        if (!job2) throw new Error("Job not found");
        const jobPhone2 = job2.customerPhone ? job2.customerPhone.replace(/\D/g, "").slice(-10) : null;
        const jobEmail2 = job2.customerEmail ? job2.customerEmail.toLowerCase() : null;
        const owned2 = job2.customerId === session.customerId ||
          (normEmail2 && jobEmail2 && normEmail2 === jobEmail2) ||
          (normPhone2 && jobPhone2 && normPhone2 === jobPhone2);
        if (!owned2) throw new Error("Job not found");
        if (job2.status === "cancelled") throw new Error("Cannot reschedule a cancelled job.");
        if (job2.status === "completed") throw new Error("Cannot reschedule a completed job.");
        const parseHourLocal2 = (t: string): number => {
          const m = t.trim().match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
          if (!m) return 8;
          let h = parseInt(m[1], 10);
          if (m[3].toUpperCase() === "PM" && h !== 12) h += 12;
          if (m[3].toUpperCase() === "AM" && h === 12) h = 0;
          return h;
        };
        const sp = (job2.timeSlot ?? "").split(/[\u2013\-]/)[0] ?? job2.timeSlot ?? "";
        const sh = parseHourLocal2(sp);
        const apptDt2 = new Date(`${job2.date}T${String(sh).padStart(2, "0")}:00:00`);
        if ((apptDt2.getTime() - Date.now()) / 3600000 < 24) throw new Error("Reschedules must be made at least 24 hours before your appointment.");
        const newSH2 = parseHourLocal2(input.newTime.split(/[\u2013\-]/)[0] ?? input.newTime);
        const newEH2 = parseHourLocal2(input.newTime.split(/[\u2013\-]/).pop() ?? input.newTime);
        await drizzleDb.update(sjTbl2).set({ date: input.newDate, timeSlot: input.newTime, startHour: String(newSH2), endHour: String(newEH2) }).where(eqSj2(sjTbl2.id, parseInt(input.jobId, 10)));
        // Also update the linked online_bookings row so admin sync stays consistent
        try {
          if (job2.onlineBookingId) {
            const { onlineBookings: obTbl2 } = await import("../drizzle/schema");
            await drizzleDb.update(obTbl2).set({ bookingDate: input.newDate, timeSlot: input.newTime, startHour: String(newSH2), endHour: String(newEH2) }).where(eqSj2(obTbl2.bookingId, job2.onlineBookingId));
          }
        } catch (e) { console.error("[RescheduleScheduleJob] online_bookings update failed:", e); }
        // Notify admins
        try {
          const cName2 = `${customer2.firstName ?? ""} ${customer2.lastName ?? ""}`.trim() || "Portal Customer";
          const admins2 = await db.getAdminEmployees();
          for (const admin of admins2) {
            await db.createNotification({
              notificationId: `RESCHEDULE_SJ_${input.jobId}_${admin.employeeId}_${Date.now()}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName,
              notificationType: "ai_booking",
              title: `Job Rescheduled: ${cName2}`,
              message: `${cName2} rescheduled their ${await db.resolvePackageNameAsync(job2.packageType as string | null)} from ${job2.date} ${job2.timeSlot ?? ""} to ${input.newDate} ${input.newTime}.`,
              createdBy: "Customer Portal",
              status: "unread",
              requiresAcknowledgment: "no",
            });
          }
        } catch (e) { console.error("[RescheduleScheduleJob] admin notify failed:", e); }
        return { success: true };
      }),

    // Unified job history: merges customer_bookings + schedule_jobs + online_bookings by email/phone
    allJobs: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) return [];
        const customer = await customerDb.getCustomerById(session.customerId);
        if (!customer) return [];

        const drizzleDb = await db.getDb();

        // Normalize phone to last 10 digits for matching
        const normPhone = customer.phone ? customer.phone.replace(/\D/g, "").slice(-10) : null;
        const normEmail = customer.email ? customer.email.toLowerCase() : null;

        // 1. Customer portal bookings (already linked by customerId)
        const portalBookings = await customerDb.getCustomerBookings(session.customerId);
        const portalJobs = portalBookings.map((b: any) => ({
          id: b.bookingRef ?? `portal_${b.id}`,
          source: "portal" as const,
          date: b.scheduledDate ?? "",
          time: b.scheduledTime ?? "",
          packageName: b.packageName ?? "",
          packageId: b.packageId ?? "",
          vehicleLabel: b.vehicleLabel ?? "",
          vehicleType: b.vehicleType ?? "",
          addons: (() => { try { return JSON.parse(b.addons ?? "[]"); } catch { return []; } })(),
          total: Number(b.total ?? 0),
          status: b.status ?? "pending",
          city: b.city ?? "",
          addressLabel: b.addressLabel ?? "",
          notes: b.notes ?? "",
          bookingRef: b.bookingRef ?? null,
          createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : "",
          paymentPaidAt: b.paymentPaidAt ?? null,
          paymentMethod: b.paymentMethod ?? null,
          paymentTotal: b.paymentTotal ? Number(b.paymentTotal) : null,
          lateEta: b.lateEta ?? null,
        }));

        if (!drizzleDb) return portalJobs;

        // 2. Schedule jobs matched by customerId, email, or phone
        const { scheduleJobs, onlineBookings: onlineBookingsTable } = await import("../drizzle/schema");
        const { or, eq, like } = await import("drizzle-orm");

        const scheduleConditions: any[] = [];
        // Primary: match by customerId (most reliable — set by auto-link and manual fix)
        scheduleConditions.push(eq(scheduleJobs.customerId, session.customerId));
        if (normEmail) scheduleConditions.push(eq(scheduleJobs.customerEmail, normEmail));
        if (normPhone) scheduleConditions.push(like(scheduleJobs.customerPhone, `%${normPhone}`));

        const scheduleRows = scheduleConditions.length > 0
          ? await drizzleDb.select().from(scheduleJobs).where(or(...scheduleConditions))
          : [];

        // Filter out cancelled/deleted schedule jobs and VIP interest/lead records
        const activeScheduleRows = scheduleRows.filter((j: any) => {
          const status = (j.status ?? "").toLowerCase();
          if (status === "cancelled" || status === "deleted") return false;
          // Filter out VIP Program Interest leads — they are lead capture records, not real bookings
          const svcDesc = (j.serviceDescription ?? "").toLowerCase();
          const pkgType = (j.packageType ?? "").toLowerCase();
          const src = (j.source ?? "").toLowerCase();
          if (svcDesc.includes("vip program interest") || svcDesc.includes("vip landing")) return false;
          if (pkgType.includes("vip_interest") || pkgType.includes("vip-interest")) return false;
          if (src === "vip-landing" || src === "vip_landing") return false;
          // Also filter jobs with no date (malformed records)
          if (!j.date) return false;
          return true;
        });

        // Resolve all package names in parallel using the same static map as resolvePackageNameAsync
        const resolvePackageLabel = (packageType: string | null | undefined, fallback?: string | null): string => {
          if (!packageType) return fallback ?? "Detail Service";
          const staticMap: Record<string, string> = {
            pb_basic: "Basic Detail", pb_full: "Full Detail", pb_luxury: "Luxury Detail",
            pb_interior: "Interior Detail", pb_exterior: "Exterior Detail",
            pb_vip: "VIP", pb_express: "Express Detail", pb_premium: "Premium Detail",
            pb_rv_wash: "RV Wash", pb_rv_maintenance: "RV Maintenance", pb_rv_paint_sealant: "RV Paint Sealant",
            // Dynamic pricebook IDs — add new ones here when created
            pb_mpn0yohe0qes: "VIP", pb_mpssufsvme94: "Maintenance Program", pb_mpws9prd5cu1: "VIP Renewal",
            interior: "Interior Detail", exterior: "Exterior Detail", luxury: "Luxury Detail",
            full: "Full Detail", basic: "Basic Detail", vip: "VIP",
            full_detail: "Full Detail", basic_detail: "Basic Detail",
            interior_detail: "Interior Detail", exterior_detail: "Exterior Detail",
            luxury_detail: "Luxury Detail", premium_detail: "Premium Detail",
          };
          const key = packageType.toLowerCase().replace(/[^a-z0-9_]/g, "");
          return staticMap[key] ?? staticMap[packageType] ?? fallback ?? packageType;
        };

        const scheduleJobsList = activeScheduleRows.map((j: any) => ({
          id: j.id ? String(j.id) : `sj_${j.date}_${j.customerName}`,
          jobId: j.jobId ?? null,
          onlineBookingId: j.onlineBookingId ?? null,
          source: (j.source === 'vip_credit' ? 'vip_credit' : 'schedule') as any,
          date: j.date ?? "",
          time: j.timeSlot ?? "",
          packageName: j.source === 'vip_credit'
            ? resolvePackageLabel(j.packageType, j.serviceDescription) + ' — VIP Credit'
            : resolvePackageLabel(j.packageType, j.serviceDescription),
          vehicleLabel: [j.vehicleYear, j.vehicleMake, j.vehicleModel].filter(Boolean).join(" ") || j.vehicleType || "",
          vehicleType: j.vehicleType ?? "",
          addons: (() => { try { return JSON.parse(j.selectedAddons ?? "[]"); } catch { return []; } })(),
          total: Number(j.totalPrice ?? 0),
          status: j.status ?? "confirmed",
          city: j.location ?? "",
          addressLabel: j.customerAddress ?? "",
          notes: j.notes ?? "",
          createdAt: j.createdAt ? new Date(j.createdAt).toISOString() : "",
          paymentPaidAt: j.paymentPaidAt ?? null,
          paymentMethod: j.paymentMethod ?? null,
          paymentTotal: j.paymentTotal ? Number(j.paymentTotal) : null,
        }));

        // 3. Online bookings matched by email or phone
        const onlineConditions: any[] = [];
        if (normEmail) onlineConditions.push(eq(onlineBookingsTable.email, normEmail));
        if (normPhone) onlineConditions.push(like(onlineBookingsTable.phone, `%${normPhone}`));

        const onlineRows = onlineConditions.length > 0
          ? await drizzleDb.select().from(onlineBookingsTable).where(or(...onlineConditions))
          : [];

        // Filter out abandoned/closed carts and VIP interest leads — they are NOT real bookings
        const activeOnlineRows = onlineRows.filter((b: any) => {
          const status = (b.status ?? "").toLowerCase();
          // Only show bookings that are actual confirmed/pending/active jobs
          if (status === "abandoned" || status === "closed") return false;
          // Also filter out ABANDONED- prefix IDs as a safety net
          if ((b.bookingId ?? "").startsWith("ABANDONED-")) return false;
          // Filter out LEAD_ prefix IDs — these are lead captures, not real bookings
          if ((b.bookingId ?? "").startsWith("LEAD_")) return false;
          // Filter out VIP/Maintenance interest leads by packageType or service description
          const pkgType = (b.packageType ?? "").toLowerCase();
          if (pkgType.includes("vip program interest") || pkgType.includes("vip interest") || pkgType.includes("vip landing")) return false;
          if (pkgType.includes("maintenance interest") || pkgType.includes("maintenance program interest")) return false;
          // Filter out records with no real date (TBD = lead capture, not a booking)
          const bookingDate = (b.bookingDate ?? "").toLowerCase();
          if (bookingDate === "tbd" || bookingDate === "") return false;
          return true;
        });

        const onlineJobsList = activeOnlineRows.map((b: any) => ({
          id: b.bookingId ?? `ob_${b.id}`,
          source: "online" as const,
          date: b.bookingDate ?? "",
          time: b.timeSlot ?? "",
          packageName: resolvePackageLabel(b.packageType),
          vehicleLabel: b.vehicleType ?? "",
          vehicleType: b.vehicleType ?? "",
          addons: (() => { try { return JSON.parse(b.selectedAddons ?? "[]"); } catch { return []; } })(),
          total: Number(b.finalTotal ?? b.totalPrice ?? 0),
          status: b.status ?? "confirmed",
          city: b.city ?? b.location ?? "",
          addressLabel: [b.streetAddress, b.city, b.state].filter(Boolean).join(", "),
          notes: "",
          createdAt: b.createdAt ? new Date(b.createdAt).toISOString() : "",
        }));

        // Deduplicate: prefer portal entries over schedule/online entries.
        // A portal booking (customer_bookings) and its mirrored schedule_job share the same bookingRef.
        // The schedule_job's jobId is `portal_<bookingRef>` and onlineBookingId is the bookingRef.
        // Use multiple dedup keys to catch all cases:
        //   1. Exact bookingRef match (portal_<ref> jobId or onlineBookingId === portal bookingRef)
        //   2. date + time + packageName (normalized) as a strong composite key
        const portalRefs = new Set<string>(
          portalJobs
            .map((j: any) => j.bookingRef)
            .filter(Boolean)
        );
        // Only use non-cancelled portal bookings for date/time/package dedup keys.
        // Cancelled portal bookings should not block real upcoming VIP credit or schedule jobs.
        const activePortalJobs = portalJobs.filter((j: any) => j.status !== 'cancelled' && j.status !== 'abandoned' && j.status !== 'closed');
        const portalDateTimeKeys = new Set<string>(
          activePortalJobs.map((j: any) => `${j.date}|${j.time}|${(j.packageName ?? '').toLowerCase().trim()}`)
        );

        const isScheduleDupe = (j: any): boolean => {
          // VIP credit bookings are never duplicates — they are unique credit redemptions
          if ((j as any).source === 'schedule' && (j as any).jobId?.startsWith('vip-credit-')) return false;
          // If the schedule job's jobId is portal_<ref> or onlineBookingId matches a portal bookingRef → dupe
          const jid = j.jobId ?? "";
          const oid = j.onlineBookingId ?? "";
          const refFromJobId = jid.startsWith("portal_") ? jid.replace(/^portal_/, "") : null;
          if (refFromJobId && portalRefs.has(refFromJobId)) return true;
          if (oid && portalRefs.has(oid)) return true;
          // Fallback: same date + time + package (only against active portal bookings)
          const key = `${j.date}|${j.time}|${(j.packageName ?? '').toLowerCase().trim()}`;
          return portalDateTimeKeys.has(key);
        };

        const isOnlineDupe = (j: any): boolean => {
          // If the online_booking id matches a portal bookingRef → dupe
          if (j.id && portalRefs.has(j.id)) return true;
          const key = `${j.date}|${j.time}|${(j.packageName ?? '').toLowerCase().trim()}`;
          return portalDateTimeKeys.has(key);
        };

        const deduped = [
          ...portalJobs,
          ...scheduleJobsList.filter((j: any) => !isScheduleDupe(j)),
          ...onlineJobsList.filter((j: any) => !isOnlineDupe(j)),
        ];

        // Sort by date descending
        return deduped.sort((a: any, b: any) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));
      }),

    /** Staff-facing: update a portal booking status (e.g. en_route when detailer taps On My Way) */
    updatePortalBookingStatus: publicProcedure
      .input(z.object({
        bookingRef: z.string(),
        status: z.enum(["pending", "confirmed", "en_route", "arrived", "in_progress", "completed", "cancelled"]),
      }))
      .mutation(async ({ input }) => {
        await customerDb.updateCustomerBookingStatus(input.bookingRef, input.status);
        return { success: true as const };
      }),
    /** Record payment on a portal booking and mark it completed */
    savePortalBookingPayment: publicProcedure
      .input(z.object({
        bookingRef: z.string(),
        paymentMethod: z.string(),
        paymentIntentId: z.string().optional().nullable(),
        paymentTotal: z.string(),
        paymentPaidAt: z.string(),
      }))
      .mutation(async ({ input }) => {
        await customerDb.savePortalBookingPayment(input.bookingRef, {
          paymentMethod: input.paymentMethod,
          paymentIntentId: input.paymentIntentId,
          paymentTotal: input.paymentTotal,
          paymentPaidAt: input.paymentPaidAt,
        });
        return { success: true as const };
      }),
    /** Check if any of the customer's upcoming bookings have an active tracking token.
     * Returns the first active tracking data found (van location + job id). */
    activeTracking: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) return null;
        const customer = await customerDb.getCustomerById(session.customerId);
        if (!customer) return null;
        const today = new Date().toISOString().split('T')[0];

        // ── 1. Check portal (customer_bookings) entries ──────────────────────
        const portalBookings = await customerDb.getCustomerBookings(session.customerId);
        const upcomingPortal = portalBookings.filter((b: any) => b.scheduledDate >= today && b.status !== 'cancelled' && b.status !== 'completed');
        for (const booking of upcomingPortal) {
          const trackData = await db.getActiveTokenDataByJobId(booking.bookingRef);
          if (trackData && !trackData.arrived && trackData.location) {
            return {
              jobId: booking.bookingRef,
              bookingRef: booking.bookingRef,
              detailerName: trackData.token.detailerName ?? 'Your Detailer',
              lat: trackData.location.lat,
              lng: trackData.location.lng,
              customerAddress: trackData.token.customerAddress ?? '',
              packageName: booking.packageName ?? '',
              scheduledDate: booking.scheduledDate ?? '',
              scheduledTime: booking.scheduledTime ?? '',
            };
          }
        }

        // ── 2. Check schedule_jobs matched by customerId / email / phone ──────
        // Most real jobs are staff-entered in schedule_jobs with numeric IDs.
        // The tracking token stores the numeric jobId — we must check those too.
        try {
          const normPhone = customer.phone ? customer.phone.replace(/\D/g, '').slice(-10) : null;
          const normEmail = customer.email ? customer.email.toLowerCase() : null;
          const { scheduleJobsList } = await db.getCustomerJobs(
            normPhone,
            normEmail,
            customer.firstName ? `${customer.firstName} ${customer.lastName ?? ''}`.trim() : '',
            session.customerId,
          );
          // Only check jobs scheduled today or in the future
          const upcomingSchedule = scheduleJobsList.filter((j: any) =>
            j.date >= today && j.status !== 'cancelled' && j.status !== 'completed'
          );
          for (const sj of upcomingSchedule) {
            // Use jobId (UUID) field — that's what tracking_tokens.job_id stores
            const jobId = sj.jobId ? String(sj.jobId) : null;
            if (!jobId) continue;
            const trackData = await db.getActiveTokenDataByJobId(jobId);
            if (trackData && !trackData.arrived && trackData.location) {
              return {
                jobId,
                bookingRef: jobId,
                detailerName: trackData.token.detailerName ?? 'Your Detailer',
                lat: trackData.location.lat,
                lng: trackData.location.lng,
                customerAddress: trackData.token.customerAddress ?? (sj as any).customerAddress ?? '',
                packageName: (sj as any).packageType ?? (sj as any).serviceDescription ?? '',
                scheduledDate: sj.date ?? '',
                scheduledTime: (sj as any).timeSlot ?? '',
              };
            }
          }
        } catch {
          // Non-fatal: schedule_jobs lookup failed, fall through to null
        }

        return null;
      }),
    /** Save Expo push token for customer notifications */
    savePushToken: publicProcedure
      .input(z.object({ token: z.string(), pushToken: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        await customerDb.savePushToken(session.customerId, input.pushToken);
        return { success: true as const };
      }),

    /** Update customer email and/or phone */
    updateProfile: publicProcedure
      .input(z.object({
        token: z.string(),
        email: z.string().email().optional(),
        phone: z.string().optional(),
        firstName: z.string().optional(),
        lastName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const { token: _t, ...data } = input;
        return customerDb.updateCustomerProfile(session.customerId, data);
      }),
    /** Upload a vehicle/profile photo for the customer avatar */
    uploadProfilePhoto: publicProcedure
      .input(z.object({
        token: z.string(),
        imageBase64: z.string(),
        mimeType: z.string().default("image/jpeg"),
      }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const buffer = Buffer.from(input.imageBase64, "base64");
        const ext = input.mimeType === "image/png" ? "png" : "jpg";
        const key = `customer-photos/${session.customerId}/profile.${ext}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        await customerDb.updateCustomerProfile(session.customerId, { profilePhotoUrl: url });
        return { success: true, url };
      }),

    /** Send a message to the admin team from the customer portal */
    sendMessage: publicProcedure
      .input(z.object({ token: z.string(), body: z.string().min(1).max(2000), imageUrl: z.string().optional() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error("DB unavailable");
        const { portalMessages } = await import("../drizzle/schema");
        await drizzleDb.insert(portalMessages).values({
          customerId: session.customerId,
          direction: "inbound",
          body: input.body.trim(),
          imageUrl: input.imageUrl ?? null,
          isRead: 0,
        });
        // Create admin notification + push for all admin/office team members
        const customer = await customerDb.getCustomerById(session.customerId);
        const name = customer ? `${customer.firstName} ${customer.lastName}`.trim() : "Customer";
        try {
          const { employees: empTable } = await import('../drizzle/schema');
          const { inArray } = await import('drizzle-orm');
          const drizzleDb2 = await db.getDb();
          if (drizzleDb2) {
            const admins = await drizzleDb2
              .select({ employeeId: empTable.employeeId, fullName: empTable.fullName, pushToken: empTable.pushToken })
              .from(empTable)
              .where(inArray(empTable.role, ['admin', 'office', 'operations_manager']));
            // Create an in-app notification for each admin
            for (const admin of admins) {
              try {
                await db.createNotification({
                  notificationId: `PORTAL_MSG_${Date.now()}_${admin.employeeId}`,
                  employeeId: admin.employeeId,
                  fullName: admin.fullName ?? admin.employeeId,
                  notificationType: 'missed_call',
                  title: `💬 New message from ${name}`,
                  message: input.body.trim().slice(0, 100),
                  createdBy: 'Customer Portal',
                  status: 'unread',
                  requiresAcknowledgment: 'no',
                });
              } catch (e) {
                console.error('[notif] portal message notification failed for', admin.employeeId, e);
              }
            }
            // Push notification to all admin/office team members
            const tokens = admins.map(a => a.pushToken).filter((t): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tokens.map(to => ({
                  to,
                  title: `💬 ${name}`,
                  body: input.body.trim().slice(0, 100),
                  sound: 'default',
                  data: { screen: 'portal-inbox', customerId: session.customerId },
                }))),
              });
            }
          }
        } catch (e) {
          console.error('[push] portal message admin notification/push failed:', e);
        }
        return { success: true as const };
      }),
    /** Get the customer's message thread with the admin team */
    getMessages: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) return [];
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const { portalMessages } = await import("../drizzle/schema");
        const { eq, asc, and } = await import("drizzle-orm");
        const rows = await drizzleDb
          .select()
          .from(portalMessages)
          .where(eq(portalMessages.customerId, session.customerId))
          .orderBy(asc(portalMessages.createdAt));
        // Mark outbound (admin reply) messages as read when customer views thread
        await drizzleDb
          .update(portalMessages)
          .set({ isRead: 1 })
          .where(and(eq(portalMessages.customerId, session.customerId), eq(portalMessages.direction, 'outbound')));
        return rows.map((r: any) => ({
          id: r.id,
          direction: r.direction as "inbound" | "outbound",
          body: r.body,
          imageUrl: r.imageUrl ?? null,
          sentByName: r.sentByName ?? null,
          isRead: r.isRead === 1,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        }));
      }),
    /** Get count of unread admin replies for the customer badge */
    unreadCount: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) return { count: 0 };
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { count: 0 };
        const { portalMessages } = await import("../drizzle/schema");
        const { sql, eq, and } = await import("drizzle-orm");
        const result = await drizzleDb
          .select({ count: sql<number>`COUNT(*)` })
          .from(portalMessages)
          .where(and(
            eq(portalMessages.customerId, session.customerId),
            eq(portalMessages.direction, 'outbound'),
            eq(portalMessages.isRead, 0),
          ));
        return { count: Number(result[0]?.count ?? 0) };
      }),

    /** Customer expresses interest in the VIP Maintenance Program — notifies admin team */
    vipInterest: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error('Unauthorized');
        const customer = await customerDb.getCustomerById(session.customerId);
        const name = customer ? `${customer.firstName} ${customer.lastName}`.trim() : 'A customer';
        const email = customer?.email ?? '';
        const phone = customer?.phone ?? '';
        // Insert an inbound portal message so admin sees it in the inbox
        const drizzleDb = await db.getDb();
        if (drizzleDb) {
          const { portalMessages } = await import('../drizzle/schema');
          await drizzleDb.insert(portalMessages).values({
            customerId: session.customerId,
            direction: 'inbound',
            body: `⭐ I'm interested in the VIP Maintenance Program! Please reach out to get me set up.`,
            isRead: 0,
          });
        }
        // Notify all admin/office staff
        try {
          const { employees: empTable } = await import('../drizzle/schema');
          const { inArray } = await import('drizzle-orm');
          const drizzleDb2 = await db.getDb();
          if (drizzleDb2) {
            const admins = await drizzleDb2
              .select({ employeeId: empTable.employeeId, fullName: empTable.fullName, pushToken: empTable.pushToken })
              .from(empTable)
              .where(inArray(empTable.role, ['admin', 'office', 'operations_manager']));
            for (const admin of admins) {
              try {
                await db.createNotification({
                  notificationId: `VIP_INTEREST_${Date.now()}_${admin.employeeId}`,
                  employeeId: admin.employeeId,
                  fullName: admin.fullName ?? admin.employeeId,
                  notificationType: 'missed_call',
                  title: `⭐ VIP Interest: ${name}`,
                  message: `${name} (${email}${phone ? ` · ${phone}` : ''}) wants to join the VIP Maintenance Program.`,
                  createdBy: 'Customer Portal',
                  status: 'unread',
                  requiresAcknowledgment: 'no',
                });
              } catch (e) { console.error('[vipInterest] notification failed', e); }
            }
            const tokens = admins.map(a => a.pushToken).filter((t): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tokens.map(to => ({
                  to,
                  title: `⭐ VIP Interest: ${name}`,
                  body: `${name} wants to join the VIP Maintenance Program.`,
                  sound: 'default',
                  data: { screen: 'portal-inbox', customerId: session.customerId },
                }))),
              });
            }
          }
        } catch (e) { console.error('[vipInterest] push failed', e); }
        return { success: true as const };
      }),

    maintenanceInterest: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error('Unauthorized');
        const customer = await customerDb.getCustomerById(session.customerId);
        const name = customer ? `${customer.firstName} ${customer.lastName}`.trim() : 'A customer';
        const email = customer?.email ?? '';
        const phone = customer?.phone ?? '';
        const drizzleDb = await db.getDb();
        if (drizzleDb) {
          const { portalMessages } = await import('../drizzle/schema');
          await drizzleDb.insert(portalMessages).values({
            customerId: session.customerId,
            direction: 'inbound',
            body: `🔧 I'm interested in the Maintenance Program! Please reach out to get me set up.`,
            isRead: 0,
          });
        }
        try {
          const { employees: empTable } = await import('../drizzle/schema');
          const { inArray } = await import('drizzle-orm');
          const drizzleDb2 = await db.getDb();
          if (drizzleDb2) {
            const admins = await drizzleDb2
              .select({ employeeId: empTable.employeeId, fullName: empTable.fullName, pushToken: empTable.pushToken })
              .from(empTable)
              .where(inArray(empTable.role, ['admin', 'office', 'operations_manager']));
            for (const admin of admins) {
              try {
                await db.createNotification({
                  notificationId: `MAINT_INTEREST_${Date.now()}_${admin.employeeId}`,
                  employeeId: admin.employeeId,
                  fullName: admin.fullName ?? admin.employeeId,
                  notificationType: 'missed_call',
                  title: `🔧 Maintenance Interest: ${name}`,
                  message: `${name} (${email}${phone ? ` · ${phone}` : ''}) wants to join the Maintenance Program.`,
                  createdBy: 'Customer Portal',
                  status: 'unread',
                  requiresAcknowledgment: 'no',
                });
              } catch (e) { console.error('[maintenanceInterest] notification failed', e); }
            }
            const tokens = admins.map(a => a.pushToken).filter((t): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tokens.map(to => ({
                  to,
                  title: `🔧 Maintenance Interest: ${name}`,
                  body: `${name} wants to join the Maintenance Program.`,
                  sound: 'default',
                  data: { screen: 'portal-inbox', customerId: session.customerId },
                }))),
              });
            }
          }
        } catch (e) { console.error('[maintenanceInterest] push failed', e); }
        return { success: true as const };
      }),

    renewalInterest: publicProcedure
      .input(z.object({ token: z.string(), contractNumber: z.string(), programType: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error('Unauthorized');
        const customer = await customerDb.getCustomerById(session.customerId);
        const name = customer ? `${customer.firstName} ${customer.lastName}`.trim() : 'A customer';
        const email = customer?.email ?? '';
        const phone = customer?.phone ?? '';
        const programLabel = input.programType === 'maintenance' ? 'Maintenance Program' : 'VIP Program';
        const drizzleDb = await db.getDb();
        if (drizzleDb) {
          const { portalMessages } = await import('../drizzle/schema');
          await drizzleDb.insert(portalMessages).values({
            customerId: session.customerId,
            direction: 'inbound',
            body: `🔄 I'd like to renew my ${programLabel} contract (${input.contractNumber}). Please reach out to get me set up for another year!`,
            isRead: 0,
          });
        }
        try {
          const { employees: empTable } = await import('../drizzle/schema');
          const { inArray } = await import('drizzle-orm');
          const drizzleDb2 = await db.getDb();
          if (drizzleDb2) {
            const admins = await drizzleDb2
              .select({ employeeId: empTable.employeeId, fullName: empTable.fullName, pushToken: empTable.pushToken })
              .from(empTable)
              .where(inArray(empTable.role, ['admin', 'office', 'operations_manager']));
            for (const admin of admins) {
              try {
                await db.createNotification({
                  notificationId: `RENEWAL_${Date.now()}_${admin.employeeId}`,
                  employeeId: admin.employeeId,
                  fullName: admin.fullName ?? admin.employeeId,
                  notificationType: 'missed_call',
                  title: `🔄 Renewal Request: ${name}`,
                  message: `${name} (${email}${phone ? ` · ${phone}` : ''}) wants to renew their ${programLabel} — Contract ${input.contractNumber}.`,
                  createdBy: 'Customer Portal',
                  status: 'unread',
                  requiresAcknowledgment: 'no',
                });
              } catch (e) { console.error('[renewalInterest] notification failed', e); }
            }
            const tokens = admins.map(a => a.pushToken).filter((t): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            if (tokens.length > 0) {
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(tokens.map(to => ({
                  to,
                  title: `🔄 Renewal Request: ${name}`,
                  body: `${name} wants to renew their ${programLabel} (${input.contractNumber}).`,
                  sound: 'default',
                  data: { screen: 'portal-inbox', customerId: session.customerId },
                }))),
              });
            }
          }
        } catch (e) { console.error('[renewalInterest] push failed', e); }
        return { success: true as const };
      }),
    /** Create a booking for a guest (unauthenticated) customer */
    createGuestBooking: publicProcedure
      .input(z.object({
        // Guest contact info
        firstName: z.string().min(1),
        lastName: z.string().min(1),
        email: z.string().email(),
        phone: z.string().min(7),
        // Booking details
        vehicleYear: z.string(),
        vehicleMake: z.string(),
        vehicleModel: z.string(),
        vehicleType: z.enum(["sedan", "suv", "large_suv_van", "truck", "rv"]),
        vehicleColor: z.string().optional(),
        vehicleLabel: z.string(),
        packageId: z.string(),
        packageName: z.string(),
        addons: z.array(z.string()).optional(),
        addressLabel: z.string().optional(),
        city: z.string().optional(),
        scheduledDate: z.string(),
        scheduledTime: z.string(),
        subtotal: z.number(),
        total: z.number(),
        discountCode: z.string().optional(),
        discountAmount: z.number().optional(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const customerName = `${input.firstName} ${input.lastName}`.trim();
        // 1. Find or create a customer record by email
        const customerId = await customerDb.findOrCreateManualCustomer({
          customerName,
          customerEmail: input.email,
          customerPhone: input.phone,
        });
        if (!customerId) throw new Error("Could not create customer record. Please try again.");
        // 2. Create a vehicle record for this customer
        const vehicle = await customerDb.addCustomerVehicle({
          customerId,
          year: input.vehicleYear,
          make: input.vehicleMake,
          model: input.vehicleModel,
          vehicleType: input.vehicleType,
          color: input.vehicleColor,
          isDefault: true,
        });
        // 3. Create the booking record
        const booking = await customerDb.createCustomerBooking({
          customerId,
          vehicleId: vehicle.vehicleId,
          vehicleType: input.vehicleType,
          vehicleLabel: input.vehicleLabel,
          packageId: input.packageId,
          packageName: input.packageName,
          addons: input.addons,
          addressLabel: input.addressLabel,
          city: input.city,
          scheduledDate: input.scheduledDate,
          scheduledTime: input.scheduledTime,
          subtotal: input.subtotal,
          total: input.total,
          discountCode: input.discountCode,
          discountAmount: input.discountAmount,
          notes: input.notes,
        });
        // 4. Mirror to schedule_jobs so it appears on the admin calendar
        try {
          const parseHour = (t: string): number => {
            const m = t.match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
            if (!m) return 8;
            let h = parseInt(m[1], 10);
            const mins = m[2] ? parseInt(m[2], 10) : 0;
            const ampm = m[3].toUpperCase();
            if (ampm === "PM" && h !== 12) h += 12;
            if (ampm === "AM" && h === 12) h = 0;
            return h + (mins >= 30 ? 0.5 : 0);
          };
          const parts = input.scheduledTime.split(/[\u2013\-]/).map((s: string) => s.trim());
          const startHour = parseHour(parts[0] ?? input.scheduledTime);
          const endHour = parts[1] ? parseHour(parts[1]) : Math.min(startHour + 3, 17);
          const city = input.city ?? "";
          const availableDetailers = city
            ? await db.getAvailableDetailersForSlot(input.scheduledDate, startHour, endHour, city)
            : [];
          const assignedDetailer = availableDetailers[0] ?? null;
          await db.upsertScheduleJob({
            jobId: `portal_${booking.bookingRef}`,
            location: city || "Unknown",
            date: input.scheduledDate,
            timeSlot: input.scheduledTime,
            startHour: String(startHour),
            endHour: String(endHour),
            customerId,
            customerName,
            customerPhone: input.phone,
            customerEmail: input.email,
            customerAddress: input.addressLabel ?? "",
            vehicleType: input.vehicleType,
            vehicleYear: input.vehicleYear,
            vehicleMake: input.vehicleMake,
            vehicleModel: input.vehicleModel,
            vehicleColor: input.vehicleColor ?? "",
            packageType: input.packageId,
            serviceDescription: input.packageName,
            selectedAddons: JSON.stringify(input.addons ?? []),
            totalPrice: String(input.total),
            discountCode: input.discountCode,
            discountAmount: input.discountAmount != null ? String(input.discountAmount) : "0",
            status: "pending",
            source: "portal_app",
            onlineBookingId: booking.bookingRef,
            notes: input.notes ?? "",
            assignedTo: assignedDetailer?.employeeId ?? undefined,
            leadSource: "Online Booking (Guest)",
          });
        } catch (schedErr) {
          console.error("[GuestBooking] Failed to mirror to schedule_jobs:", schedErr);
        }
        // 5. Send booking confirmation email to guest
        try {
          const { subject, html } = buildBookingConfirmationEmail({
            customerName,
            bookingRef: booking.bookingRef,
            packageName: input.packageName,
            vehicleLabel: input.vehicleLabel,
            scheduledDate: input.scheduledDate,
            scheduledTime: input.scheduledTime,
            addressLabel: input.addressLabel,
            addons: input.addons,
            total: input.total,
            notes: input.notes,
          });
          await sendEmail({
            to: input.email,
            subject,
            html,
            type: "booking_confirmation",
            customerName,
            bookingRef: booking.bookingRef,
          });
        } catch (emailErr) {
          console.error("[GuestBooking] Failed to send confirmation email:", emailErr);
        }
        // 6. Admin new booking alert
        try {
          const admins = await db.getAdminEmployees();
          for (const admin of admins) {
            await db.createNotification({
              notificationId: `GUEST_BOOKING_${booking.bookingRef}_${admin.employeeId}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName,
              notificationType: "ai_booking",
              title: `New Guest Booking: ${customerName}`,
              message: `${customerName} (guest) booked ${input.packageName} on ${input.scheduledDate} at ${input.scheduledTime} in ${input.city ?? "Unknown"}. Ref: ${booking.bookingRef}`,
              createdBy: "Customer Portal (Guest)",
              status: "unread",
              requiresAcknowledgment: "no",
            });
          }
          if (ENV.gmailUser) {
            const alertEmail = buildAdminBookingAlertEmail({
              customerName,
              customerEmail: input.email,
              bookingRef: booking.bookingRef,
              packageName: input.packageName,
              vehicleLabel: input.vehicleLabel,
              scheduledDate: input.scheduledDate,
              scheduledTime: input.scheduledTime,
              city: input.city ?? "",
              addressLabel: input.addressLabel,
              total: input.total,
            });
            await sendEmail({ to: ENV.gmailUser, subject: alertEmail.subject, html: alertEmail.html, type: "other", urgent: true, customerName, bookingRef: booking.bookingRef });
          }
        } catch (alertErr) {
          console.error("[GuestBooking] Failed to send admin alert:", alertErr);
        }
        // 7. Create an abandoned cart record (status=confirmed) so it appears in the pipeline
        try {
          await db.createAbandonedCart({
            firstName: input.firstName,
            lastName: input.lastName,
            email: input.email,
            phone: input.phone,
            location: input.city ?? "Unknown",
            vehicleType: input.vehicleType,
            packageName: input.packageName,
            bookingDate: input.scheduledDate,
            totalPrice: String(input.total),
          });
        } catch (cartErr) {
          console.error("[GuestBooking] Failed to create abandoned cart record:", cartErr);
        }
        return { bookingRef: booking.bookingRef };
      }),
  }),
  maintenance: router({
    /** List all maintenance records for the logged-in customer */
    listRecords: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error("DB unavailable");
        const { maintenanceRecords } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        return drizzleDb.select().from(maintenanceRecords)
          .where(eq(maintenanceRecords.customerId, session.customerId))
          .orderBy(desc(maintenanceRecords.serviceDate));
      }),

    /** Add a maintenance record */
    addRecord: publicProcedure
      .input(z.object({
        token: z.string(),
        type: z.enum(["oil_change","wiper_blades","tire_rotation","air_filter","brake_service","other"]),
        label: z.string(),
        serviceDate: z.string(),
        mileageAtService: z.number().optional(),
        nextServiceDate: z.string().optional(),
        nextServiceMileage: z.number().optional(),
        notes: z.string().optional(),
        vehicleId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error("DB unavailable");
        const { maintenanceRecords } = await import("../drizzle/schema");
        const recordId = `MR_${Date.now()}_${Math.random().toString(36).slice(2,8).toUpperCase()}`;
        await drizzleDb.insert(maintenanceRecords).values({
          recordId,
          customerId: session.customerId,
          vehicleId: input.vehicleId ?? null,
          type: input.type,
          label: input.label,
          serviceDate: input.serviceDate,
          mileageAtService: input.mileageAtService ?? null,
          nextServiceDate: input.nextServiceDate ?? null,
          nextServiceMileage: input.nextServiceMileage ?? null,
          notes: input.notes ?? null,
        });
        return { success: true, recordId };
      }),

    /** Delete a maintenance record */
    deleteRecord: publicProcedure
      .input(z.object({ token: z.string(), recordId: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error("DB unavailable");
        const { maintenanceRecords } = await import("../drizzle/schema");
        const { and, eq } = await import("drizzle-orm");
        await drizzleDb.delete(maintenanceRecords)
          .where(and(eq(maintenanceRecords.recordId, input.recordId), eq(maintenanceRecords.customerId, session.customerId)));
        return { success: true };
      }),

    /** List warranty docs for the logged-in customer */
    listWarranties: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error("DB unavailable");
        const { warrantyDocs } = await import("../drizzle/schema");
        const { eq, desc } = await import("drizzle-orm");
        return drizzleDb.select().from(warrantyDocs)
          .where(eq(warrantyDocs.customerId, session.customerId))
          .orderBy(desc(warrantyDocs.createdAt));
      }),

    /** Upload a warranty document (base64 PDF or image) */
    uploadWarranty: publicProcedure
      .input(z.object({
        token: z.string(),
        category: z.enum(["battery","tire","brake","other"]),
        label: z.string(),
        fileBase64: z.string(),
        fileName: z.string(),
        mimeType: z.string().default("application/pdf"),
        expiryDate: z.string().optional(),
        notes: z.string().optional(),
        vehicleId: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error("DB unavailable");
        const buffer = Buffer.from(input.fileBase64, "base64");
        const ext = input.fileName.split(".").pop() ?? "pdf";
        const docId = `WD_${Date.now()}_${Math.random().toString(36).slice(2,8).toUpperCase()}`;
        const key = `customer-warranties/${session.customerId}/${docId}.${ext}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        const { warrantyDocs } = await import("../drizzle/schema");
        await drizzleDb.insert(warrantyDocs).values({
          docId,
          customerId: session.customerId,
          vehicleId: input.vehicleId ?? null,
          category: input.category,
          label: input.label,
          fileUrl: url,
          fileName: input.fileName,
          expiryDate: input.expiryDate ?? null,
          notes: input.notes ?? null,
        });
        return { success: true, docId, url };
      }),

    /** Delete a warranty document */
    deleteWarranty: publicProcedure
      .input(z.object({ token: z.string(), docId: z.string() }))
      .mutation(async ({ input }) => {
        const session = await customerDb.getCustomerSession(input.token);
        if (!session) throw new Error("Unauthorized");
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error("DB unavailable");
        const { warrantyDocs } = await import("../drizzle/schema");
        const { and, eq } = await import("drizzle-orm");
        await drizzleDb.delete(warrantyDocs)
          .where(and(eq(warrantyDocs.docId, input.docId), eq(warrantyDocs.customerId, session.customerId)));
        return { success: true };
      }),
  }),

  fleet: router({
    // Vans
    listVans: publicProcedure
      .input(z.object({ city: z.string().optional() }))
      .query(async ({ input }) => fleetDb.listVans(input.city)),
    getVan: publicProcedure
      .input(z.object({ id: z.string() }))
      .query(async ({ input }) => fleetDb.getVan(input.id)),
    createVan: publicProcedure
      .input(z.object({
        name: z.string(),
        make: z.string().optional(),
        model: z.string().optional(),
        year: z.number().optional(),
        vin: z.string().optional(),
        plate: z.string().optional(),
        color: z.string().optional(),
        city: z.string().optional(),
        odometer: z.number().optional(),
        assigned_driver: z.string().optional(),
        device_imei: z.string().optional(),
      }))
      .mutation(async ({ input }) => fleetDb.createVan(input)),
    updateVan: publicProcedure
      .input(z.object({
        id: z.string(),
        name: z.string().optional(),
        make: z.string().optional(),
        model: z.string().optional(),
        year: z.number().optional(),
        vin: z.string().optional(),
        plate: z.string().optional(),
        color: z.string().optional(),
        city: z.string().optional(),
        odometer: z.number().optional(),
        fuel_percent: z.number().optional(),
        battery_voltage: z.number().optional(),
        dtc_count: z.number().optional(),
        recall_count: z.number().optional(),
        status: z.enum(["active", "parked", "maintenance"]).optional(),
        last_location: z.string().optional(),
        last_lat: z.number().optional(),
        last_lng: z.number().optional(),
        last_seen_at: z.string().optional(),
        assigned_driver: z.string().optional(),
        device_imei: z.string().optional(),
      }))
      .mutation(async ({ input }) => { const { id, ...data } = input; await fleetDb.updateVan(id, data); return { success: true }; }),
    deleteVan: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => { await fleetDb.deleteVan(input.id); return { success: true }; }),
    // Maintenance
    listMaintenance: publicProcedure
      .input(z.object({ vanId: z.string() }))
      .query(async ({ input }) => fleetDb.listMaintenance(input.vanId)),
    addMaintenance: publicProcedure
      .input(z.object({
        van_id: z.string(),
        type: z.string(),
        description: z.string().optional(),
        service_date: z.string(),
        odometer_at_service: z.number().optional(),
        next_due_date: z.string().optional(),
        next_due_odometer: z.number().optional(),
        cost: z.number().optional(),
        shop_name: z.string().optional(),
        notes: z.string().optional(),
        proof_image_url: z.string().optional(),
      }))
      .mutation(async ({ input }) => fleetDb.addMaintenance(input)),
    uploadMaintenanceProof: publicProcedure
      .input(z.object({ base64: z.string(), mimeType: z.string().default('image/jpeg') }))
      .mutation(async ({ input }) => {
        const buf = Buffer.from(input.base64, 'base64');
        const ext = input.mimeType.includes('png') ? 'png' : 'jpg';
        const key = `fleet-maintenance/${Date.now()}_${Math.random().toString(36).slice(2)}.${ext}`;
        const { url } = await storagePut(key, buf, input.mimeType);
        return { url };
      }),
    deleteMaintenance: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => { await fleetDb.deleteMaintenance(input.id); return { success: true }; }),
    // Fuel Logs
    listFuelLogs: publicProcedure
      .input(z.object({ vanId: z.string() }))
      .query(async ({ input }) => fleetDb.listFuelLogs(input.vanId)),
    addFuelLog: publicProcedure
      .input(z.object({
        van_id: z.string(),
        log_date: z.string(),
        gallons: z.number().optional(),
        cost_per_gallon: z.number().optional(),
        total_cost: z.number().optional(),
        odometer: z.number().optional(),
        station: z.string().optional(),
      }))
      .mutation(async ({ input }) => fleetDb.addFuelLog(input)),
    deleteFuelLog: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => { await fleetDb.deleteFuelLog(input.id); return { success: true }; }),
    // Alerts
    listAlerts: publicProcedure
      .input(z.object({ city: z.string().optional(), vanId: z.string().optional() }))
      .query(async ({ input }) => fleetDb.listAlerts(input.city, input.vanId)),
    markAlertRead: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => { await fleetDb.markAlertRead(input.id); return { success: true }; }),
    createAlert: publicProcedure
      .input(z.object({
        van_id: z.string(),
        type: z.string(),
        message: z.string(),
        severity: z.enum(["info", "warning", "critical"]).optional(),
      }))
      .mutation(async ({ input }) => fleetDb.createAlert(input)),
    // Trips
    listTrips: publicProcedure
      .input(z.object({ vanId: z.string(), startDate: z.string().optional(), endDate: z.string().optional() }))
      .query(async ({ input }) => fleetDb.listTrips(input.vanId, input.startDate, input.endDate)),
    addTrip: publicProcedure
      .input(z.object({
        van_id: z.string(),
        trip_date: z.string(),
        start_address: z.string().optional(),
        end_address: z.string().optional(),
        start_time: z.string().optional(),
        end_time: z.string().optional(),
        duration_minutes: z.number().optional(),
        distance_miles: z.number().optional(),
      }))
      .mutation(async ({ input }) => fleetDb.addTrip(input)),
    // ── Repair Equipment (admin-managed list) ──
    listRepairEquipment: publicProcedure
      .query(async () => fleetDb.listRepairEquipment()),
    addRepairEquipment: publicProcedure
      .input(z.object({
        name: z.string(),
        category: z.string().optional(),
        subIssues: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => fleetDb.addRepairEquipment(input)),
    updateRepairEquipment: publicProcedure
      .input(z.object({
        equipmentId: z.string(),
        name: z.string().optional(),
        category: z.string().optional(),
        subIssues: z.array(z.string()).optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => { await fleetDb.updateRepairEquipment(input); return { success: true }; }),
    deleteRepairEquipment: publicProcedure
      .input(z.object({ equipmentId: z.string() }))
      .mutation(async ({ input }) => { await fleetDb.deleteRepairEquipment(input.equipmentId); return { success: true }; }),
    // ── Repair Orders ──
    listRepairOrders: publicProcedure
      .input(z.object({
        status: z.enum(["open", "in_progress", "resolved", "all"]).optional(),
        vanId: z.string().optional(),
        employeeId: z.string().optional(),
        dateFrom: z.string().optional(),
        dateTo: z.string().optional(),
      }))
      .query(async ({ input }) => fleetDb.listRepairOrders(input)),
    countOpenRepairs: publicProcedure
      .query(async () => fleetDb.countOpenRepairs()),
    createRepairOrder: publicProcedure
      .input(z.object({
        vanId: z.string(),
        vanName: z.string().optional(),
        employeeId: z.string(),
        employeeName: z.string().optional(),
        equipmentId: z.string(),
        equipmentName: z.string(),
        subIssue: z.string().optional(),
        notes: z.string().optional(),
        priority: z.enum(["low", "medium", "high"]).optional(),
      }))
      .mutation(async ({ input }) => {
        const order = await fleetDb.createRepairOrder(input);
        // ── Notify all admins via in-app notification ──
        try {
          const { notifyOwner } = await import("./_core/notification");
          const admins = await db.getAdminEmployees();
          const priorityLabel = input.priority === "high" ? "🔴 HIGH" : input.priority === "medium" ? "🟡 MEDIUM" : "🟢 LOW";
          const vanLabel = input.vanName || input.vanId;
          const detailerLabel = input.employeeName || input.employeeId;
          const issueLabel = input.subIssue ? `${input.equipmentName} — ${input.subIssue}` : input.equipmentName;
          const title = `🔧 Repair Request: ${vanLabel}`;
          const message = `${detailerLabel} reported: ${issueLabel} [${priorityLabel}]${input.notes ? `\nNotes: ${input.notes}` : ""}`;
          for (const admin of admins) {
            await db.createNotification({
              notificationId: `REPAIR-NOTIF-${Date.now()}-${admin.employeeId}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName,
              notificationType: "repair_request",
              title,
              message,
              createdBy: detailerLabel,
              requiresAcknowledgment: input.priority === "high" ? "yes" : "no",
            });
          }
          // Also push to project owner
          await notifyOwner({ title, content: message }).catch(() => {});
        } catch (e) {
          console.warn("[RepairOrder] Failed to send notifications:", e);
        }
        return order;
      }),
    updateRepairStatus: publicProcedure
      .input(z.object({
        repairId: z.string(),
        status: z.enum(["open", "in_progress", "resolved"]),
        resolvedBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await fleetDb.updateRepairStatus(input); return { success: true }; }),
    // ── Van Assignment ──
    getVanAssignment: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => fleetDb.getVanAssignment(input.employeeId)),
    getVanAssignments: publicProcedure
      .input(z.object({ vanId: z.string() }))
      .query(async ({ input }) => fleetDb.getVanAssignments(input.vanId)),
    getAllVanAssignments: publicProcedure
      .query(async () => fleetDb.getAllVanAssignments()),
    setVanAssignment: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        vanId: z.string(),
        vanName: z.string().optional(),
        shift: z.enum(["shift1", "shift2"]),
        assignedBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => { await fleetDb.setVanAssignment({ ...input, shift: input.shift }); return { success: true }; }),
    removeVanAssignment: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .mutation(async ({ input }) => { await fleetDb.removeVanAssignment(input.employeeId); return { success: true }; }),
  }),

  investor: router({
    login: publicProcedure
      .input(z.object({ email: z.string(), password: z.string() }))
      .mutation(async ({ input }) => {
        const inv = await investorDb.getInvestorByEmail(input.email);
        if (!inv) throw new Error("Invalid email or password");
        if (inv.passwordHash !== investorDb.hashPassword(input.password)) throw new Error("Invalid email or password");
        if (inv.accountStatus !== "active") throw new Error("Account is not active. Contact support.");
        const token = await investorDb.createInvestorSession(inv.investorId);
        await investorDb.addAuditLog({ actorId: inv.investorId, actorName: `${inv.firstName} ${inv.lastName}`, actionType: "login", recordType: "investor", recordId: inv.investorId });
        return { token, investor: { investorId: inv.investorId, firstName: inv.firstName, lastName: inv.lastName, email: inv.email, phone: inv.phone, accountStatus: inv.accountStatus, role: (inv as any).role ?? 'investor' } };
      }),

    logout: publicProcedure
      .input(z.object({ token: z.string() }))
      .mutation(async ({ input }) => { await investorDb.deleteInvestorSession(input.token); return { success: true }; }),

    me: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const inv = await investorDb.getInvestorBySession(input.token);
        if (!inv) throw new Error("Session expired");
        return { investorId: inv.investorId, firstName: inv.firstName, lastName: inv.lastName, email: inv.email, phone: inv.phone, accountStatus: inv.accountStatus, role: (inv as any).role ?? 'investor' };
      }),

    getDashboard: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const inv = await investorDb.getInvestorBySession(input.token);
        if (!inv) throw new Error("Session expired");
        const invests = await investorDb.getInvestmentsByInvestor(inv.investorId);
        const summaries = await Promise.all(invests.map(async (i) => {
          const { payments, amountPaid, completedCount } = await investorDb.getRepaymentSummary(i.investmentId);
          const totalRepayment = parseFloat(i.totalRepaymentAmount ?? i.investmentAmount);
          const nextPayment = payments.find(p => p.status === "scheduled" || p.status === "pending");
          return { ...i, amountPaid, completedCount, totalRepayment, nextPayment: nextPayment ?? null };
        }));
        const updates = await investorDb.listInvestorUpdates();
        return { investor: { investorId: inv.investorId, firstName: inv.firstName, lastName: inv.lastName, email: inv.email }, investments: summaries, recentUpdates: updates.slice(0, 5) };
      }),

    getInvestments: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const inv = await investorDb.getInvestorBySession(input.token);
        if (!inv) throw new Error("Session expired");
        return investorDb.getInvestmentsByInvestor(inv.investorId);
      }),

    getPayments: publicProcedure
      .input(z.object({ token: z.string(), investmentId: z.string() }))
      .query(async ({ input }) => {
        const inv = await investorDb.getInvestorBySession(input.token);
        if (!inv) throw new Error("Session expired");
        const investment = await investorDb.getInvestmentById(input.investmentId);
        if (!investment || investment.investorId !== inv.investorId) throw new Error("Not found");
        return investorDb.getPaymentsByInvestment(input.investmentId);
      }),

    getDocuments: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const inv = await investorDb.getInvestorBySession(input.token);
        if (!inv) throw new Error("Session expired");
        return investorDb.getDocumentsByInvestor(inv.investorId, false);
      }),

    getUpdates: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const inv = await investorDb.getInvestorBySession(input.token);
        if (!inv) throw new Error("Session expired");
        return investorDb.listInvestorUpdates();
      }),

    getSupportRequests: publicProcedure
      .input(z.object({ token: z.string() }))
      .query(async ({ input }) => {
        const inv = await investorDb.getInvestorBySession(input.token);
        if (!inv) throw new Error("Session expired");
        return investorDb.getSupportRequestsByInvestor(inv.investorId);
      }),

    submitSupportRequest: publicProcedure
      .input(z.object({ token: z.string(), subject: z.string(), messageBody: z.string() }))
      .mutation(async ({ input }) => {
        const inv = await investorDb.getInvestorBySession(input.token);
        if (!inv) throw new Error("Session expired");
        const requestId = await investorDb.createSupportRequest({ investorId: inv.investorId, subject: input.subject, messageBody: input.messageBody });
        await investorDb.addAuditLog({ actorId: inv.investorId, actorName: `${inv.firstName} ${inv.lastName}`, actionType: "support_request", recordType: "support", recordId: requestId });
        return { requestId };
      }),

    adminListInvestors: publicProcedure
      .query(async () => investorDb.listAllInvestors()),

    adminCreateInvestor: publicProcedure
      .input(z.object({ adminName: z.string().optional(), firstName: z.string(), lastName: z.string(), email: z.string(), phone: z.string().optional(), password: z.string() }))
      .mutation(async ({ input }) => {
        const investorId = await investorDb.createInvestor(input);
        await investorDb.addAuditLog({ actorId: input.adminName ?? "admin", actorName: input.adminName, actionType: "create_investor", recordType: "investor", recordId: investorId });
        return { investorId };
      }),

    adminUpdateInvestor: publicProcedure
      .input(z.object({ adminName: z.string().optional(), investorId: z.string(), firstName: z.string().optional(), lastName: z.string().optional(), email: z.string().optional(), phone: z.string().optional(), accountStatus: z.enum(["active","pending","suspended","closed"]).optional(), password: z.string().optional() }))
      .mutation(async ({ input }) => {
        await investorDb.updateInvestor(input.investorId, input);
        await investorDb.addAuditLog({ actorId: input.adminName ?? "admin", actorName: input.adminName, actionType: "update_investor", recordType: "investor", recordId: input.investorId });
        return { success: true };
      }),

    adminCreateInvestment: publicProcedure
      .input(z.object({ adminName: z.string().optional(), investorId: z.string(), investmentAmount: z.string(), investmentDate: z.string(), loanTermMonths: z.number().optional(), repaymentType: z.string().optional(), agreedReturnAmount: z.string().optional(), totalRepaymentAmount: z.string().optional(), totalPaymentsExpected: z.number().optional(), status: z.enum(["pending_funding","active","repayment_in_progress","paid_in_full","delayed","document_pending","closed"]).optional(), notes: z.string().optional(), adminNotes: z.string().optional() }))
      .mutation(async ({ input }) => {
        const investmentId = await investorDb.createInvestment(input);
        await investorDb.addAuditLog({ actorId: input.adminName ?? "admin", actorName: input.adminName, actionType: "create_investment", recordType: "investment", recordId: investmentId });
        return { investmentId };
      }),

    adminUpdateInvestment: publicProcedure
      .input(z.object({ adminName: z.string().optional(), investmentId: z.string(), investmentAmount: z.string().optional(), investmentDate: z.string().optional(), loanTermMonths: z.number().optional(), repaymentType: z.string().optional(), agreedReturnAmount: z.string().optional(), totalRepaymentAmount: z.string().optional(), totalPaymentsExpected: z.number().optional(), status: z.enum(["pending_funding","active","repayment_in_progress","paid_in_full","delayed","document_pending","closed"]).optional(), notes: z.string().optional(), adminNotes: z.string().optional() }))
      .mutation(async ({ input }) => {
        await investorDb.updateInvestment(input.investmentId, input);
        await investorDb.addAuditLog({ actorId: input.adminName ?? "admin", actorName: input.adminName, actionType: "update_investment", recordType: "investment", recordId: input.investmentId });
        return { success: true };
      }),

    adminRecordPayment: publicProcedure
      .input(z.object({ adminName: z.string().optional(), investmentId: z.string(), dueDate: z.string().optional(), paidDate: z.string().optional(), amountDue: z.string(), amountPaid: z.string().optional(), status: z.enum(["scheduled","pending","completed","missed","delayed"]).optional(), paymentMethod: z.string().optional(), referenceNumber: z.string().optional(), adminNotes: z.string().optional() }))
      .mutation(async ({ input }) => {
        const paymentId = await investorDb.createPayment(input);
        await investorDb.addAuditLog({ actorId: input.adminName ?? "admin", actorName: input.adminName, actionType: "record_payment", recordType: "payment", recordId: paymentId });
        return { paymentId };
      }),

    adminUpdatePayment: publicProcedure
      .input(z.object({ adminName: z.string().optional(), paymentId: z.string(), dueDate: z.string().optional(), paidDate: z.string().optional(), amountDue: z.string().optional(), amountPaid: z.string().optional(), status: z.enum(["scheduled","pending","completed","missed","delayed"]).optional(), paymentMethod: z.string().optional(), referenceNumber: z.string().optional(), adminNotes: z.string().optional() }))
      .mutation(async ({ input }) => {
        await investorDb.updatePayment(input.paymentId, input);
        await investorDb.addAuditLog({ actorId: input.adminName ?? "admin", actorName: input.adminName, actionType: "update_payment", recordType: "payment", recordId: input.paymentId });
        return { success: true };
      }),

    adminGetInvestorDetail: publicProcedure
      .input(z.object({ investorId: z.string() }))
      .query(async ({ input }) => {
        const inv = await investorDb.getInvestorById(input.investorId);
        if (!inv) throw new Error("Investor not found");
        const invests = await investorDb.getInvestmentsByInvestor(input.investorId);
        const investmentsWithPayments = await Promise.all(invests.map(async (i) => {
          const { payments, amountPaid, completedCount } = await investorDb.getRepaymentSummary(i.investmentId);
          return { ...i, payments, amountPaid, completedCount };
        }));
        const documents = await investorDb.getDocumentsByInvestor(input.investorId, true);
        const supportRequests = await investorDb.getSupportRequestsByInvestor(input.investorId);
        return { investor: inv, investments: investmentsWithPayments, documents, supportRequests };
      }),

    adminUploadDocument: publicProcedure
      .input(z.object({ adminName: z.string().optional(), investorId: z.string(), investmentId: z.string().optional(), documentTitle: z.string(), documentType: z.enum(["agreement","promissory_note","receipt","statement","tax_document","company_update","other"]), fileKey: z.string(), fileUrl: z.string().optional(), visibilityStatus: z.enum(["visible","hidden"]).optional() }))
      .mutation(async ({ input }) => {
        const documentId = await investorDb.createDocument({ ...input, uploadedBy: input.adminName });
        await investorDb.addAuditLog({ actorId: input.adminName ?? "admin", actorName: input.adminName, actionType: "upload_document", recordType: "document", recordId: documentId });
        return { documentId };
      }),

    adminToggleDocumentVisibility: publicProcedure
      .input(z.object({ documentId: z.string(), visibilityStatus: z.enum(["visible","hidden"]) }))
      .mutation(async ({ input }) => { await investorDb.updateDocumentVisibility(input.documentId, input.visibilityStatus); return { success: true }; }),

    adminDeleteDocument: publicProcedure
      .input(z.object({ documentId: z.string() }))
      .mutation(async ({ input }) => { await investorDb.deleteDocument(input.documentId); return { success: true }; }),

    adminPostUpdate: publicProcedure
      .input(z.object({ adminName: z.string().optional(), title: z.string(), body: z.string(), category: z.enum(["business_progress","fleet_expansion","revenue_milestone","repayment_update","important_notice","general"]).optional() }))
      .mutation(async ({ input }) => {
        const updateId = await investorDb.createInvestorUpdate({ ...input, createdBy: input.adminName });
        await investorDb.addAuditLog({ actorId: input.adminName ?? "admin", actorName: input.adminName, actionType: "post_update", recordType: "update", recordId: updateId });
        return { updateId };
      }),

    adminListUpdates: publicProcedure
      .query(async () => investorDb.listAllInvestorUpdates()),
    adminDeleteUpdate: publicProcedure
      .input(z.object({ updateId: z.string() }))
      .mutation(async ({ input }) => { await investorDb.deleteInvestorUpdate(input.updateId); return { success: true }; }),

    adminListSupportRequests: publicProcedure
      .query(async () => investorDb.listAllSupportRequests()),

    adminRespondToSupport: publicProcedure
      .input(z.object({ requestId: z.string(), adminResponse: z.string(), respondedBy: z.string(), status: z.enum(["open","in_review","resolved"]).optional() }))
      .mutation(async ({ input }) => { await investorDb.respondToSupportRequest(input.requestId, input); return { success: true }; }),

    adminGetAuditLog: publicProcedure
      .input(z.object({ limit: z.number().optional() }))
      .query(async ({ input }) => investorDb.getAuditLog(input.limit ?? 100)),

    adminListInvestments: publicProcedure
      .query(async () => investorDb.listAllInvestments()),

    // ─── Investor Inquiries (Lead Capture) ─────────────────────────────────────
    submitInquiry: publicProcedure
      .input(z.object({
        fullName: z.string().min(1),
        email: z.string().min(1),
        phone: z.string().optional(),
        investmentInterest: z.string().optional(),
        message: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const inquiryId = await investorDb.createInvestorInquiry(input);
        try {
          const adminEmail = "adrian@luxurywashonwheels.com";
          const html = `
            <div style="font-family:Arial,sans-serif;max-width:600px;margin:0 auto;">
              <div style="background:#7C3AED;padding:24px;border-radius:12px 12px 0 0;">
                <h1 style="color:#fff;margin:0;font-size:22px;">New Investor Inquiry</h1>
              </div>
              <div style="background:#f9fafb;padding:24px;border:1px solid #e5e7eb;border-top:none;border-radius:0 0 12px 12px;">
                <p style="margin:0 0 12px;"><strong>Name:</strong> ${input.fullName}</p>
                <p style="margin:0 0 12px;"><strong>Email:</strong> ${input.email}</p>
                <p style="margin:0 0 12px;"><strong>Phone:</strong> ${input.phone || "Not provided"}</p>
                <p style="margin:0 0 12px;"><strong>Investment Range:</strong> ${input.investmentInterest || "Not specified"}</p>
                <p style="margin:0 0 12px;"><strong>Message:</strong></p>
                <p style="margin:0;padding:12px;background:#fff;border-radius:8px;border:1px solid #e5e7eb;">${input.message || "No message provided"}</p>
                <hr style="margin:20px 0;border:none;border-top:1px solid #e5e7eb;" />
                <p style="margin:0;color:#6b7280;font-size:13px;">Submitted via the Luxury Wash On Wheels investor portal. View all inquiries in the admin panel under Investors → Investor Inquiries.</p>
              </div>
            </div>
          `;
          await sendEmail({ to: adminEmail, subject: `New Investor Inquiry from ${input.fullName}`, html, urgent: true });
        } catch (e) {
          console.error("[Investor] Failed to send inquiry notification email:", e);
        }
        return { success: true, inquiryId };
      }),

    adminListInquiries: publicProcedure
      .query(async () => investorDb.listAllInvestorInquiries()),

    adminUpdateInquiryStatus: publicProcedure
      .input(z.object({
        inquiryId: z.string(),
        status: z.enum(["new", "contacted", "qualified", "closed"]).optional(),
        adminNotes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await investorDb.updateInvestorInquiryStatus(input.inquiryId, input);
        return { success: true };
      }),
  }),

  // ─── Phase C: Booking Pipeline ────────────────────────────────────────────────────────
    pipeline: router({

    list: publicProcedure
      .input(z.object({
        startDate: z.string(),
        endDate: z.string(),
        location: z.string().optional(),
      }))
      .query(async ({ input }) => db.getPipelineBookings(input)),

    listLeads: publicProcedure
      .input(z.object({
        location: z.string().optional(),
      }))
      .query(async ({ input }) => db.getLeads(input)),

    conversionStats: publicProcedure
      .query(async () => db.getAbandonedCartConversionStats()),

    recoveredCustomers: publicProcedure
      .query(async () => db.getRecoveredCustomers(50)),

    convertLeadToBooking: publicProcedure
      .input(z.object({
        bookingId: z.string(),
        bookingDate: z.string(),
        timeSlot: z.string().optional(),
        assignedTo: z.string().optional(),
        preferredDetailerName: z.string().optional(),
        pipelineNotes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { bookingId, ...updates } = input;
        await db.updateBookingPipelineStage(bookingId, 'confirmed', updates.pipelineNotes);
        // Also update the booking date/time/detailer
        const dbConn = await (db as any).getDb?.();
        if (dbConn) {
          const { onlineBookings } = await import('../drizzle/schema.js');
          const { eq } = await import('drizzle-orm');
          const updateData: Record<string, unknown> = { status: 'confirmed', bookingDate: updates.bookingDate };
          if (updates.timeSlot) updateData.timeSlot = updates.timeSlot;
          if (updates.assignedTo) updateData.assignedTo = updates.assignedTo;
          if (updates.preferredDetailerName) updateData.preferredDetailerName = updates.preferredDetailerName;
          if (updates.pipelineNotes !== undefined) updateData.pipelineNotes = updates.pipelineNotes;
          await dbConn.update(onlineBookings).set(updateData).where(eq(onlineBookings.bookingId, bookingId));
        }
        return { success: true };
      }),

    updateStage: publicProcedure
      .input(z.object({
        bookingId: z.string(),
        status: z.enum(["abandoned", "pending", "confirmed", "en_route", "in_progress", "completed", "follow_up_sent", "closed", "cancelled"]),
        pipelineNotes: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.updateBookingPipelineStage(input.bookingId, input.status, input.pipelineNotes);
        return { success: true };
      }),

    sendFollowUpSms: publicProcedure
      .input(z.object({
        bookingId: z.string(),
        phone: z.string(),
        firstName: z.string(),
      }))
      .mutation(async ({ input }) => {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        if (accountSid && authToken && fromNumber) {
          const msg = `Hi ${input.firstName}! Thank you for choosing Luxury Wash on Wheels 🚗✨ We hope you loved your detail! Would you mind leaving us a quick review? It means the world to us ⭐ https://g.page/r/luxurywash/review\n\nReady to book your next detail? Reply BOOK or call 850-517-7874!`;
          const toNumber = input.phone.startsWith('+') ? input.phone : `+1${input.phone.replace(/\D/g, '')}`;
          const body = new URLSearchParams({ To: toNumber, From: fromNumber, Body: msg });
          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
            body: body.toString(),
          }).catch(e => console.error('[Pipeline SMS] Follow-up send error:', e));
        }
        await db.updateBookingPipelineStage(input.bookingId, "follow_up_sent");
        return { success: true };
      }),
    abandonCart: publicProcedure
      .input(z.object({
        firstName: z.string(),
        lastName: z.string(),
        email: z.string(),
        phone: z.string(),
        location: z.string(),
        vehicleType: z.string().optional(),
        packageName: z.string().optional(),
        bookingDate: z.string().optional(),
        source: z.enum(["portal_app", "website"]).default("website"),
        customerId: z.string().optional(),
        estimatedTotal: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        const bookingId = await db.createAbandonedCart(input);
        // Also record in the new abandoned_carts analytics table
        try {
          const conn = await db.getConnection();
          const cartId = `cart_${bookingId ?? Date.now()}`;
          await conn.execute(
            `INSERT INTO abandoned_carts (cart_id, customer_id, source, package_name, vehicle_type, city, customer_email, customer_name, estimated_total, step_reached)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE step_reached = VALUES(step_reached), updated_at = NOW()`,
            [
              cartId, input.customerId ?? null, input.source,
              input.packageName ?? null, input.vehicleType ?? null,
              input.location ?? null, input.email ?? null,
              `${input.firstName} ${input.lastName}`.trim(),
              input.estimatedTotal ?? null, "package_selection",
            ]
          );
          await conn.end();
        } catch (e) {
          console.error('[abandonCart] analytics insert failed:', e);
        }
        return { success: true, bookingId };
      }),
    promoteAbandonedCart: publicProcedure
      .input(z.object({
        abandonedBookingId: z.string(),
        packageType: z.string().optional(),
        timeSlot: z.string().optional(),
        startHour: z.number().optional(),
        endHour: z.number().optional(),
        totalPrice: z.string().optional(),
        bookingDate: z.string().optional(),
        preferredDetailerId: z.string().optional(),
        preferredDetailerName: z.string().optional(),
        assignedTo: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const { abandonedBookingId, ...updates } = input;
        await db.promoteAbandonedCart(abandonedBookingId, updates);
        return { success: true };
      }),
    sendRecoverySms: publicProcedure
      .input(z.object({
        bookingId: z.string(),
        phone: z.string(),
        firstName: z.string(),
        packageName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER;
        if (accountSid && authToken && fromNumber) {
          const pkgLine = input.packageName
            ? `We saved your ${input.packageName} quote — ready to book?`
            : `We'd love to take care of your vehicle!`;
          const msg = `Hi ${input.firstName}! 👋 We noticed you started booking with Luxury Wash on Wheels but didn't finish. ${pkgLine} Book now at luxurywashonwheels.com or call 850-517-7874. We'll make it shine ✨`;
          const toNumber = input.phone.startsWith('+') ? input.phone : `+1${input.phone.replace(/\D/g, '')}`;
          const body = new URLSearchParams({ To: toNumber, From: fromNumber, Body: msg });
          await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
            body: body.toString(),
          }).catch(e => console.error('[Pipeline SMS] Recovery send error:', e));
        }
        await db.updateBookingPipelineStage(input.bookingId, "abandoned");
        return { success: true };
      }),
  }),
  aiKnowledge: router({
    list: publicProcedure.query(async () => {
      return await db.getAiKnowledgeEntries();
    }),
    create: publicProcedure
      .input((val: any) => val as { category: string; title: string; content: string; orderIndex?: number })
      .mutation(async ({ input }) => {
        const entryId = `AK-${Date.now()}-${Math.random().toString(36).substring(2, 7)}`;
        await db.createAiKnowledgeEntry({
          entryId,
          category: input.category,
          title: input.title,
          content: input.content,
          isActive: 1,
          orderIndex: input.orderIndex ?? 0,
        });
        return { success: true, entryId };
      }),
    update: publicProcedure
      .input((val: any) => val as { entryId: string; title?: string; content?: string; category?: string; isActive?: number; orderIndex?: number })
      .mutation(async ({ input }) => {
        const { entryId, ...data } = input;
        await db.updateAiKnowledgeEntry(entryId, data);
        return { success: true };
      }),
    delete: publicProcedure
      .input((val: any) => val as { entryId: string })
      .mutation(async ({ input }) => {
        await db.deleteAiKnowledgeEntry(input.entryId);
        return { success: true };
      }),
  }),

  // ─── Saved Cards ──────────────────────────────────────────────────────────
  savedCards: router({
    // Create a Stripe SetupIntent so the client can collect card details
    createSetupIntent: publicProcedure
      .input((val: any) => val as { customerKey: string; customerName: string; customerEmail?: string })
      .mutation(async ({ input }) => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) throw new Error("Stripe not configured");
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
        // Create or retrieve a Stripe Customer for this customer key
        const existing = await db.getCustomerPaymentMethods(input.customerKey);
        let stripeCustomerId: string;
        if (existing.length > 0) {
          stripeCustomerId = existing[0].stripeCustomerId;
        } else {
          const customer = await stripe.customers.create({
            name: input.customerName,
            email: input.customerEmail ?? undefined,
            metadata: { customerKey: input.customerKey },
          });
          stripeCustomerId = customer.id;
        }
        const setupIntent = await stripe.setupIntents.create({
          customer: stripeCustomerId,
          payment_method_types: ["card"],
        });
        return { clientSecret: setupIntent.client_secret, stripeCustomerId };
      }),

    // Save a payment method after SetupIntent confirmation
    saveCard: publicProcedure
      .input((val: any) => val as {
        customerKey: string; customerName: string; customerPhone?: string; customerEmail?: string;
        stripeCustomerId: string; stripePaymentMethodId: string;
      })
      .mutation(async ({ input }) => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) throw new Error("Stripe not configured");
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
        const pm = await stripe.paymentMethods.retrieve(input.stripePaymentMethodId);
        const card = pm.card;
        const methodId = `PM_${Date.now()}_${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
        // Attach payment method to customer if not already
        if (!pm.customer) {
          await stripe.paymentMethods.attach(input.stripePaymentMethodId, { customer: input.stripeCustomerId });
        }
        const existing = await db.getCustomerPaymentMethods(input.customerKey);
        await db.saveCustomerPaymentMethod({
          methodId,
          customerKey: input.customerKey,
          customerName: input.customerName,
          customerPhone: input.customerPhone ?? null,
          customerEmail: input.customerEmail ?? null,
          stripeCustomerId: input.stripeCustomerId,
          stripePaymentMethodId: input.stripePaymentMethodId,
          cardBrand: card?.brand ?? null,
          cardLast4: card?.last4 ?? null,
          cardExpMonth: card?.exp_month ?? null,
          cardExpYear: card?.exp_year ?? null,
          isDefault: existing.length === 0 ? 1 : 0,
        });
        return { success: true, methodId };
      }),

    // List saved cards for a customer
    list: publicProcedure
      .input((val: any) => val as { customerKey: string })
      .query(async ({ input }) => {
        return db.getCustomerPaymentMethods(input.customerKey);
      }),

    // Delete a saved card
    delete: publicProcedure
      .input((val: any) => val as { methodId: string; stripePaymentMethodId: string })
      .mutation(async ({ input }) => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        if (stripeKey) {
          const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
          try { await stripe.paymentMethods.detach(input.stripePaymentMethodId); } catch {}
        }
        await db.deleteCustomerPaymentMethod(input.methodId);
        return { success: true };
      }),

    // Set a card as default
    setDefault: publicProcedure
      .input((val: any) => val as { customerKey: string; methodId: string })
      .mutation(async ({ input }) => {
        await db.setDefaultPaymentMethod(input.customerKey, input.methodId);
        return { success: true };
      }),

    // Charge a saved card
    chargeCard: publicProcedure
      .input((val: any) => val as {
        stripeCustomerId: string; stripePaymentMethodId: string;
        amountCents: number; description: string;
      })
      .mutation(async ({ input }) => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) throw new Error("Stripe not configured");
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
        const SUCCEEDED = ['succeeded', 'requires_capture', 'processing'];
        let pi: any;
        try {
          pi = await stripe.paymentIntents.create({
            amount: input.amountCents,
            currency: "usd",
            customer: input.stripeCustomerId,
            payment_method: input.stripePaymentMethodId,
            confirm: true,
            off_session: true,
            description: input.description,
          });
        } catch (err: any) {
          // Stripe throws a StripeCardError when the card requires action (3DS) or is declined.
          // If the error contains a payment_intent, verify its actual status before failing —
          // the charge may have already succeeded or be in requires_capture state.
          if (err?.payment_intent?.id) {
            try {
              const verified = await stripe.paymentIntents.retrieve(err.payment_intent.id);
              if (SUCCEEDED.includes(verified.status)) {
                console.log(`[chargeCard] Stripe threw but PI ${verified.id} status=${verified.status} — treating as success`);
                return { success: true, paymentIntentId: verified.id, status: verified.status };
              }
            } catch (_) { /* ignore retrieval error, fall through to original error */ }
            // Genuinely failed — surface a clean message
            throw new Error((err as any)?.raw?.message ?? (err as any)?.message ?? 'Card charge failed.');
          }
          throw err;
        }
        // Handle requires_action / requires_capture returned without an exception
        if (!SUCCEEDED.includes(pi.status)) {
          const verified = await stripe.paymentIntents.retrieve(pi.id);
          if (!SUCCEEDED.includes(verified.status)) {
            throw new Error(`Payment was not completed (status: ${verified.status}). Please try again.`);
          }
          return { success: true, paymentIntentId: verified.id, status: verified.status };
        }
        return { success: true, paymentIntentId: pi.id, status: pi.status };
      }),

    generateTipLink: publicProcedure
      .input((val: any) => val as {
        jobId: string;
        customerName: string;
        customerEmail: string;
        detailerName: string;
        serviceTitle: string;
        serviceTotal: number;
        stripeCustomerId: string;
        stripePaymentMethodId: string;
        cardLast4?: string;
        cardBrand?: string;
      })
      .mutation(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          const crypto = await import('crypto');
          const token = crypto.randomBytes(32).toString('hex');
          const expiresAt = new Date(Date.now() + 48 * 60 * 60 * 1000);
          await conn.execute(
            `INSERT INTO tip_requests (token, job_id, customer_name, customer_email, detailer_name, service_title, service_total, stripe_customer_id, stripe_payment_method_id, card_last4, card_brand, status, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
            [token, input.jobId, input.customerName, input.customerEmail, input.detailerName ?? null, input.serviceTitle ?? null, input.serviceTotal.toFixed(2), input.stripeCustomerId, input.stripePaymentMethodId, input.cardLast4 ?? null, input.cardBrand ?? null, expiresAt]
          );
          const baseUrl = process.env.API_BASE_URL || 'https://luxurywashonwheels.app';
          const tipUrl = `${baseUrl}/tip/${token}`;
          const firstName = input.customerName.split(' ')[0] || input.customerName;
          const cardBrand = input.cardBrand ? (input.cardBrand.charAt(0).toUpperCase() + input.cardBrand.slice(1)) : 'Card';
          const email = buildTipRequestEmail({
            customerFirstName: firstName,
            detailerName: input.detailerName || 'your detailer',
            serviceTitle: input.serviceTitle || 'your service',
            serviceTotal: input.serviceTotal.toFixed(2),
            cardBrand,
            cardLast4: input.cardLast4 || '****',
            tipUrl,
          });
          await sendEmail({ to: input.customerEmail, subject: email.subject, html: email.html, type: 'other', customerName: input.customerName, urgent: true });
          return { success: true, token, tipUrl };
        } finally { await conn.end(); }
      }),
  }),

  // ─── Phone System ───────────────────────────────────────────────────────────
  phone: router({
    listLines: publicProcedure.query(async () => {
      const conn = await db.getConnection();
      try {
        const [rows] = await conn.execute("SELECT * FROM phone_lines WHERE is_active=1 ORDER BY id ASC") as [any[], any];
        return rows as Array<{ id: number; line_name: string; phone_number: string; twilio_sid: string | null; color: string; ai_receptionist_enabled: number; forward_to_employees: number; is_active: number }>;
      } finally { await conn.end(); }
    }),

    upsertLine: publicProcedure
      .input((val: any) => val as { id?: number; lineName: string; phoneNumber: string; twilioSid?: string; color?: string; aiReceptionistEnabled?: boolean; forwardToEmployees?: boolean })
      .mutation(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          if (input.id) {
            await conn.execute(
              "UPDATE phone_lines SET line_name=?, phone_number=?, twilio_sid=?, color=?, ai_receptionist_enabled=?, forward_to_employees=?, updated_at=NOW() WHERE id=?",
              [input.lineName, input.phoneNumber, input.twilioSid ?? null, input.color ?? '#0a7ea4', input.aiReceptionistEnabled ? 1 : 0, input.forwardToEmployees !== false ? 1 : 0, input.id]
            );
          } else {
            await conn.execute(
              "INSERT INTO phone_lines (line_name, phone_number, twilio_sid, color, ai_receptionist_enabled, forward_to_employees) VALUES (?, ?, ?, ?, ?, ?)",
              [input.lineName, input.phoneNumber, input.twilioSid ?? null, input.color ?? '#0a7ea4', input.aiReceptionistEnabled ? 1 : 0, input.forwardToEmployees !== false ? 1 : 0]
            );
          }
          return { success: true };
        } finally { await conn.end(); }
      }),

    toggleAI: publicProcedure
      .input((val: any) => val as { lineId: number; enabled: boolean })
      .mutation(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          await conn.execute("UPDATE phone_lines SET ai_receptionist_enabled=?, updated_at=NOW() WHERE id=?", [input.enabled ? 1 : 0, input.lineId]);
          return { success: true };
        } finally { await conn.end(); }
      }),

    deleteLine: publicProcedure
      .input((val: any) => val as { lineId: number })
      .mutation(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          await conn.execute("UPDATE phone_lines SET is_active=0 WHERE id=?", [input.lineId]);
          return { success: true };
        } finally { await conn.end(); }
      }),

    getInbox: publicProcedure
      .input((val: any) => val as { lineId?: number; limit?: number; offset?: number })
      .query(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          const limit = input.limit ?? 50;
          const offset = input.offset ?? 0;
          const lineFilter = input.lineId ? `AND m.line_id = ${Number(input.lineId)}` : '';
          const query = `
            SELECT m.*, pl.line_name, pl.color as line_color,
              (SELECT COUNT(*) FROM sms_messages m2
               WHERE m2.from_number = m.from_number AND m2.line_id = m.line_id
               AND m2.is_read = 0 AND m2.direction = 'inbound') as unread_count
            FROM sms_messages m
            LEFT JOIN phone_lines pl ON pl.id = m.line_id
            WHERE m.id IN (
              SELECT MAX(id) FROM sms_messages
              WHERE 1=1 ${lineFilter}
              GROUP BY from_number, line_id
            )
            ORDER BY m.created_at DESC
            LIMIT ? OFFSET ?`;
          const [rows] = await conn.execute(query, [limit, offset]) as [any[], any];
          return rows;
        } finally { await conn.end(); }
      }),

    getThread: publicProcedure
      .input((val: any) => val as { contactNumber: string; lineId: number; limit?: number })
      .query(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          const [rows] = await conn.execute(
            `SELECT m.*, e.full_name as sent_by_name FROM sms_messages m
             LEFT JOIN employees e ON e.employee_id = m.sent_by_employee_id
             WHERE m.line_id = ? AND (m.from_number = ? OR m.to_number = ?)
             ORDER BY m.created_at ASC LIMIT ?`,
            [input.lineId, input.contactNumber, input.contactNumber, input.limit ?? 100]
          ) as [any[], any];
          await conn.execute(
            "UPDATE sms_messages SET is_read=1 WHERE line_id=? AND from_number=? AND direction='inbound' AND is_read=0",
            [input.lineId, input.contactNumber]
          );
          return rows;
        } finally { await conn.end(); }
      }),

    sendSms: publicProcedure
      .input((val: any) => val as { lineId: number; toNumber: string; body: string; employeeId: string })
      .mutation(async ({ input }) => {
        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        if (!accountSid || !authToken) throw new Error("Twilio not configured — add TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN in Settings");
        const conn = await db.getConnection();
        try {
          const [lineRows] = await conn.execute("SELECT * FROM phone_lines WHERE id=? LIMIT 1", [input.lineId]) as [any[], any];
          const line = lineRows[0];
          if (!line) throw new Error("Phone line not found");
          const formData = new URLSearchParams({ From: line.phone_number, To: input.toNumber, Body: input.body });
          const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
            method: "POST",
            headers: { Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`, "Content-Type": "application/x-www-form-urlencoded" },
            body: formData.toString(),
          });
          const result = await response.json() as any;
          if (!response.ok) throw new Error(result.message ?? "Twilio send failed");
          await conn.execute(
            "INSERT INTO sms_messages (line_id, twilio_message_sid, direction, from_number, to_number, body, status, sent_by_employee_id, is_read) VALUES (?, ?, 'outbound', ?, ?, ?, 'sent', ?, 1)",
            [input.lineId, result.sid, line.phone_number, input.toNumber, input.body, input.employeeId]
          );
          return { success: true, sid: result.sid };
        } finally { await conn.end(); }
      }),

    getCallLogs: publicProcedure
      .input((val: any) => (val ?? {}) as { lineId?: number; limit?: number; offset?: number })
      .query(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          const limit = Number(input.limit ?? 50);
          const offset = Number(input.offset ?? 0);
          const lineFilter = input.lineId ? `WHERE cl.line_id = ${Number(input.lineId)}` : '';
          const [rows] = await conn.execute(
            `SELECT cl.id, cl.line_id, cl.twilio_call_sid, cl.direction,
                    cl.from_number AS caller_number, cl.to_number,
                    cl.status AS call_status, cl.duration_seconds,
                    cl.answered_by_employee_id, cl.recording_url,
                    cl.ai_handled, cl.created_at,
                    pl.line_name, pl.color AS line_color,
                    e.full_name AS answered_by_name
             FROM call_logs cl
             LEFT JOIN phone_lines pl ON pl.id = cl.line_id
             LEFT JOIN employees e ON e.employee_id = cl.answered_by_employee_id
             ${lineFilter}
             ORDER BY cl.created_at DESC LIMIT ${limit} OFFSET ${offset}`,
            []
          ) as [any[], any];
          return rows;
        } finally { await conn.end(); }
      }),

    getMissedCallCount: publicProcedure
      .input((val: any) => (val ?? {}) as { since?: string })
      .query(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          const since = input.since ? new Date(input.since) : new Date(0);
          const [rows] = await conn.execute(
            "SELECT COUNT(*) as count FROM call_logs WHERE status = 'no-answer' AND created_at > ?",
            [since]
          ) as [any[], any];
          return { count: Number(rows[0]?.count ?? 0) };
        } finally { await conn.end(); }
      }),
    getUnreadCount: publicProcedure.query(async () => {
      const conn = await db.getConnection();
      try {
        const [rows] = await conn.execute(
          "SELECT COUNT(*) as count FROM sms_messages WHERE is_read=0 AND direction='inbound'"
        ) as [any[], any];
        return { count: Number(rows[0]?.count ?? 0) };
      } finally { await conn.end(); }
    }),

    sendLateArrivalNotification: publicProcedure
      .input((val: any) => val as {
        jobId: string;
        customerPhone: string;
        customerEmail?: string;
        customerName: string;
        detailerName: string;
        employeeId: string;
        delayMinutes: number;
        scheduledTime: string;
      })
      .mutation(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          // Calculate new ETA from scheduled time + delay
          const [hStr, mStr] = input.scheduledTime.split(":");
          const origDate = new Date();
          origDate.setHours(Number(hStr), Number(mStr), 0, 0);
          const newEta = new Date(origDate.getTime() + input.delayMinutes * 60 * 1000);
          const etaStr = newEta.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
          const detailerFirstName = (input.detailerName ?? "Your detailer").split(" ")[0];

          // Send push notification to customer portal account
          try {
            let matchedCustomer = null;
            if (input.customerEmail) matchedCustomer = await customerDb.getCustomerByEmail(input.customerEmail);
            if (!matchedCustomer && input.customerPhone) matchedCustomer = await customerDb.getCustomerByPhone(input.customerPhone);
            if (matchedCustomer?.customerId) {
              await customerDb.sendCustomerPushNotification(
                matchedCustomer.customerId,
                `\u26a0\ufe0f Your Detailer is Running Late`,
                `${detailerFirstName} is running ~${input.delayMinutes} min behind. New estimated arrival: ${etaStr}.`
              );
              // Store ETA on the portal booking so the app can display it
              const bookingRef = input.jobId.startsWith("portal_") ? input.jobId.replace("portal_", "") : null;
              if (bookingRef) {
                await conn.execute(
                  "UPDATE customer_bookings SET late_eta = ?, late_notified_at = ? WHERE booking_ref = ?",
                  [etaStr, new Date().toISOString(), bookingRef]
                );
              }
            }
          } catch (pushErr) {
            console.error("[LateArrival] Push notification failed:", pushErr);
          }

          // Send late arrival email to customer if email is available
          if (input.customerEmail) {
            const customerFirstName = input.customerName.split(" ")[0] || input.customerName;
            const lateEmail = buildLateArrivalEmail({
              customerFirstName,
              detailerName: detailerFirstName,
              delayMinutes: input.delayMinutes,
              newEta: etaStr,
              phone: "850-517-7874",
            });
            await sendEmail({
              to: input.customerEmail,
              subject: lateEmail.subject,
              html: lateEmail.html,
              type: "other",
              customerName: input.customerName,
              bookingRef: input.jobId,
            }).catch((err) => console.error("[LateArrival] Email send failed:", err));
            console.log(`[LateArrival] Email sent to ${input.customerEmail} for job ${input.jobId}`);
          }

          const { notifyOwner } = await import("./_core/notification");
          const admins = await db.getAdminEmployees();
          for (const admin of admins) {
            await db.createNotification({
              notificationId: `LATE_${input.jobId}_${Date.now()}_${admin.employeeId}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName,
              notificationType: "clock_alert",
              title: `\u26a0\ufe0f Running Late: ${input.detailerName}`,
              message: `${input.detailerName} is running ~${input.delayMinutes} min late for ${input.customerName}. Customer notified via push notification${input.customerEmail ? " & email" : ""}. New ETA: ${etaStr}.`,
              requiresAcknowledgment: "no",
            });
          }
          await notifyOwner({ title: `\u26a0\ufe0f Running Late: ${input.detailerName}`, content: `${input.detailerName} is running ~${input.delayMinutes} min late for ${input.customerName}. New ETA: ${etaStr}.` }).catch(() => {});
          return { success: true, etaStr };
        } finally { await conn.end(); }
      }),

    getLateArrivalHistory: publicProcedure
      .input((val: any) => val as { jobId?: string; employeeId?: string; limit?: number })
      .query(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          const conditions: string[] = [];
          const params: any[] = [];
          if (input?.jobId) { conditions.push("job_id = ?"); params.push(input.jobId); }
          if (input?.employeeId) { conditions.push("employee_id = ?"); params.push(input.employeeId); }
          const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
          const limit = input?.limit ?? 50;
          const [rows] = await conn.execute(`SELECT * FROM late_arrival_history ${where} ORDER BY sent_at DESC LIMIT ?`, [...params, limit]) as [any[], any];
          return rows;
        } finally { await conn.end(); }
      }),

    configureWebhooks: publicProcedure.mutation(async () => {
      const response = await fetch(`http://127.0.0.1:${process.env.PORT || 3000}/api/phone/configure-webhooks`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      return response.json();
    }),
  }),

  // ─── Accountability Points System ───
  points: router({
    /** Get points for a single detailer (auto-inits / resets if new week) */
    getMyPoints: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getOrInitDetailerPoints(input.employeeId)),

    /** Get points for all detailers (admin/ops view) */
    getAllPoints: publicProcedure
      .query(async () => db.getAllDetailerPoints()),

    /** Issue a violation and deduct points */
    issueViolation: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        employeeName: z.string(),
        violationType: z.enum([
          "missed_morning_meeting",
          "no_before_after_photos",
          "no_late_arrival_notice",
          "vehicle_damage",
          "qc_issue",
          "forgot_clock_in_out",
          "other",
        ]),
        pointsDeducted: z.number().min(0.1).max(10),
        notes: z.string().optional(),
        issuedBy: z.string(),
      }))
      .mutation(async ({ input }) => db.issueViolation(input)),

    /** Get violation history for a detailer */
    getViolations: publicProcedure
      .input(z.object({ employeeId: z.string(), weekStartDate: z.string().optional() }))
      .query(async ({ input }) => db.getViolationsForEmployee(input.employeeId, input.weekStartDate)),

    /** Get all violations for a week (admin view) */
    getAllViolations: publicProcedure
      .input(z.object({ weekStartDate: z.string().optional() }))
      .query(async ({ input }) => db.getAllViolationsForWeek(input.weekStartDate)),

    /** Get all violations within a date range (for period filter) */
    getViolationsByDateRange: publicProcedure
      .input(z.object({ startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) => db.getViolationsByDateRange(input.startDate, input.endDate)),

    /** Manual point adjustment (admin override) */
    adjustPoints: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        adjustment: z.number(),
        issuedBy: z.string(),
        notes: z.string().optional(),
      }))
      .mutation(async ({ input }) => db.adjustDetailerPoints(input.employeeId, input.adjustment, input.issuedBy, input.notes)),

    /**
     * Issue a formal write-up:
     * 1. Deducts points via issueViolation
     * 2. Creates a write_up notification so the detailer is alerted
     * Returns both the updated points and the notification ID.
     */
    issueWriteUp: publicProcedure
      .input(z.object({
        employeeId: z.string(),
        employeeName: z.string(),
        violationType: z.enum([
          "missed_morning_meeting",
          "no_before_after_photos",
          "no_late_arrival_notice",
          "vehicle_damage",
          "qc_issue",
          "forgot_clock_in_out",
          "other",
        ]),
        pointsDeducted: z.number().min(0.1).max(10),
        title: z.string(),
        message: z.string().optional(),
        issuedBy: z.string(),
      }))
      .mutation(async ({ input }) => {
        const notifId = `WRITEUP-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
        // 1. Deduct points and log the violation
        const result = await db.issueViolation({
          employeeId: input.employeeId,
          employeeName: input.employeeName,
          violationType: input.violationType,
          pointsDeducted: input.pointsDeducted,
          notes: input.message,
          issuedBy: input.issuedBy,
          writeUpNotifId: notifId,
        });
        // 2. Send write_up notification to the detailer
        await db.createNotification({
          notificationId: notifId,
          employeeId: input.employeeId,
          fullName: input.employeeName,
          notificationType: "write_up",
          title: input.title,
          message: input.message ?? `You have received a write-up: ${input.title}. Points deducted: ${input.pointsDeducted}. Issued by: ${input.issuedBy}.`,
          createdBy: input.issuedBy,
          requiresAcknowledgment: "yes",
          status: "unread",
        });
        return { ...result, notifId };
      }),

    /** Get all write-up notifications for a detailer */
    getMyWriteUps: publicProcedure
      .input(z.object({ employeeId: z.string() }))
      .query(async ({ input }) => db.getWriteUpsForEmployee(input.employeeId)),

    /** Get all write-ups across all detailers (admin view) */
    getAllWriteUps: publicProcedure
      .query(async () => db.getAllWriteUps()),
  }),

  // ─── Geofence Zones & Events ─────────────────────────────────────────────
  geofence: router({
    listZones: publicProcedure
      .query(async () => db.listGeofenceZones()),

    createZone: publicProcedure
      .input(z.object({
        zoneId: z.string(),
        name: z.string(),
        address: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        radiusMeters: z.number().default(402),
        createdBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.createGeofenceZone(input);
        return { success: true };
      }),

    toggleZone: publicProcedure
      .input(z.object({ zoneId: z.string(), isActive: z.number() }))
      .mutation(async ({ input }) => {
        await db.toggleGeofenceZone(input.zoneId, input.isActive);
        return { success: true };
      }),

    deleteZone: publicProcedure
      .input(z.object({ zoneId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteGeofenceZone(input.zoneId);
        return { success: true };
      }),

    logEvent: publicProcedure
      .input(z.object({
        eventId: z.string(),
        employeeId: z.string(),
        fullName: z.string().optional(),
        zoneId: z.string(),
        zoneName: z.string().optional(),
        eventType: z.enum(["enter", "exit"]),
        latitude: z.number().optional(),
        longitude: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.logGeofenceEvent(input);
        const admins = await db.getAdminEmployees();
        const emoji = input.eventType === "enter" ? "📍" : "🚗";
        const verb = input.eventType === "enter" ? "entered" : "exited";
        for (const admin of admins) {
          await db.createNotification({
            notificationId: `GEO_${input.eventId}_${admin.employeeId}`,
            employeeId: admin.employeeId,
            fullName: admin.fullName,
            notificationType: "clock_alert",
            title: `${emoji} ${input.fullName ?? input.employeeId} ${verb} ${input.zoneName ?? input.zoneId}`,
            message: `${input.fullName ?? input.employeeId} has ${verb} the geofence zone "${input.zoneName ?? input.zoneId}".`,
            createdBy: "System",
            requiresAcknowledgment: "no",
            status: "unread",
          });
        }
        return { success: true };
      }),

    listEvents: publicProcedure
      .input(z.object({ limit: z.number().default(100) }))
      .query(async ({ input }) => db.listGeofenceEvents(input.limit)),
  }),

  // ─── EOD Checklists ───────────────────────────────────────────────────────
  eodChecklist: router({
    getToday: publicProcedure
      .input(z.object({ employeeId: z.string(), fullName: z.string().optional() }))
      .query(async ({ input }) => {
        const data = await db.getOrCreateEodChecklist(input.employeeId, input.fullName);
        if (!data) return data;
        // Refresh photo URLs so the Detailer always sees valid signed download URLs
        const refreshedItems = await Promise.all(
          (data.items ?? []).map(async (item: any) => {
            if (!item.photoUrl) return item;
            try {
              let storageKey: string | null = null;
              if (item.photoUrl.startsWith("eod-photos/")) {
                storageKey = item.photoUrl;
              } else {
                const match = item.photoUrl.match(/eod-photos\/[^?#]+/);
                if (match) storageKey = match[0];
              }
              if (storageKey) {
                const { url } = await storageGet(storageKey);
                return { ...item, photoUrl: url };
              }
            } catch {
              // Fall back to stored URL
            }
            return item;
          }),
        );
        return { ...data, items: refreshedItems };
      }),

    submitStep: publicProcedure
      .input(z.object({
        checklistId: z.string(),
        stepKey: z.enum(["trash_removed", "chemicals_stocked", "towels_stocked"]),
        photoUrl: z.string(),
      }))
      .mutation(async ({ input }) => {
        await db.submitEodChecklistStep(input.checklistId, input.stepKey, input.photoUrl);
        return { success: true };
      }),

    submit: publicProcedure
      .input(z.object({ checklistId: z.string(), employeeId: z.string(), fullName: z.string().optional() }))
      .mutation(async ({ input }) => {
        await db.submitEodChecklist(input.checklistId);
        const admins = await db.getAdminEmployees();
        for (const admin of admins) {
          await db.createNotification({
            notificationId: `EOD_SUBMIT_${input.checklistId}_${admin.employeeId}`,
            employeeId: admin.employeeId,
            fullName: admin.fullName,
            notificationType: "clock_alert",
            title: `✅ EOD Checklist Submitted: ${input.fullName ?? input.employeeId}`,
            message: `${input.fullName ?? input.employeeId} has submitted their end-of-day van checklist.`,
            createdBy: "System",
            requiresAcknowledgment: "no",
            status: "unread",
          });
        }
        return { success: true };
      }),

    uploadPhoto: publicProcedure
      .input(z.object({
        base64: z.string(),
        mimeType: z.string().default("image/jpeg"),
        employeeId: z.string(),
        stepKey: z.string(),
      }))
      .mutation(async ({ input }) => {
        const ext = input.mimeType === "image/png" ? "png" : "jpg";
        const key = `eod-photos/${input.employeeId}/${input.stepKey}-${Date.now()}.${ext}`;
        const buffer = Buffer.from(input.base64, "base64");
        const { url } = await storagePut(key, buffer, input.mimeType);
        // Return both the storage key (for DB storage) and the signed URL (for immediate preview)
        return { success: true as const, key, url };
      }),

    listByDate: publicProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input }) => {
        const entries = await db.listEodChecklistsByDate(input.date);
        // Refresh photo URLs so admin always sees valid signed download URLs
        const refreshed = await Promise.all(
          entries.map(async (entry) => ({
            ...entry,
            items: await Promise.all(
              entry.items.map(async (item) => {
                if (!item.photoUrl) return item;
                try {
                  // Support two storage formats:
                  // 1. Relative key: "eod-photos/employeeId/stepKey-timestamp.jpg"
                  // 2. Full URL containing "eod-photos/" path segment
                  let storageKey: string | null = null;
                  if (item.photoUrl.startsWith("eod-photos/")) {
                    storageKey = item.photoUrl;
                  } else {
                    const match = item.photoUrl.match(/eod-photos\/[^?#]+/);
                    if (match) storageKey = match[0];
                  }
                  if (storageKey) {
                    const { url } = await storageGet(storageKey);
                    return { ...item, photoUrl: url };
                  }
                } catch {
                  // If refresh fails, fall back to stored URL
                }
                return item;
              }),
            ),
          })),
        );
        return refreshed;
      }),

    review: publicProcedure
      .input(z.object({
        checklistId: z.string(),
        status: z.enum(["approved", "violated"]),
        reviewedBy: z.string(),
        reviewNote: z.string().optional(),
        employeeId: z.string(),
        employeeName: z.string().optional(),
        pointsDeducted: z.number().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.reviewEodChecklist({
          checklistId: input.checklistId,
          status: input.status,
          reviewedBy: input.reviewedBy,
          reviewNote: input.reviewNote,
        });
        if (input.status === "violated") {
          const points = input.pointsDeducted ?? 5;
          await db.createNotification({
            notificationId: `EOD_VIOL_${input.checklistId}_${input.employeeId}`,
            employeeId: input.employeeId,
            fullName: input.employeeName,
            notificationType: "write_up",
            title: "⚠️ EOD Checklist Violation",
            message: `Your end-of-day van checklist was marked as a violation by ${input.reviewedBy}. ${points} point${points !== 1 ? "s" : ""} deducted.${input.reviewNote ? " Note: " + input.reviewNote : ""}`,
            createdBy: input.reviewedBy,
            requiresAcknowledgment: "yes",
            status: "unread",
          });
        }
        return { success: true };
      }),
  }),


  ops: router({
    /** Get today's jobs with punctuality status (on-time / late / not checked in) */
    getTodayPunctuality: publicProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { scheduleJobs } = await import("../drizzle/schema");
        const { eq, and, ne } = await import("drizzle-orm");
        const jobs = await database.select().from(scheduleJobs)
          .where(and(eq(scheduleJobs.date, input.date), ne(scheduleJobs.status, "cancelled")))
          .orderBy(scheduleJobs.startHour);
        return jobs;
      }),
    /** Submit a site inspection */
    submitInspection: publicProcedure
      .input(z.object({
        inspectionId: z.string(),
        opsManagerId: z.string(),
        opsManagerName: z.string().optional(),
        detailerId: z.string(),
        detailerName: z.string().optional(),
        bookingId: z.string().optional(),
        jobAddress: z.string().optional(),
        inspectedAt: z.string(),
        overallPass: z.boolean(),
        notes: z.string().optional(),
        items: z.array(z.object({
          itemId: z.string(),
          checkKey: z.string(),
          checkLabel: z.string(),
          passed: z.boolean(),
          notes: z.string().optional(),
        })),
      }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return { success: false };
        const { siteInspections, siteInspectionItems } = await import("../drizzle/schema");
        await database.insert(siteInspections).values({
          inspectionId: input.inspectionId,
          opsManagerId: input.opsManagerId,
          opsManagerName: input.opsManagerName,
          detailerId: input.detailerId,
          detailerName: input.detailerName,
          bookingId: input.bookingId,
          jobAddress: input.jobAddress,
          inspectedAt: new Date(input.inspectedAt),
          overallPass: input.overallPass ? 1 : 0,
          notes: input.notes,
        });
        if (input.items.length > 0) {
          await database.insert(siteInspectionItems).values(
            input.items.map(item => ({
              itemId: item.itemId,
              inspectionId: input.inspectionId,
              checkKey: item.checkKey,
              checkLabel: item.checkLabel,
              passed: item.passed ? 1 : 0,
              notes: item.notes,
            }))
          );
        }
        // ── Send inspection report email to detailer (non-blocking) ──────────────
        try {
          const db2 = await (await import("./db")).getDb();
          if (db2) {
            const { employees: empTable } = await import("../drizzle/schema");
            const { eq, like } = await import("drizzle-orm");
            // Try to find detailer by name match
            const detailerRows = await db2.select().from(empTable)
              .where(like(empTable.fullName, `%${input.detailerName ?? input.detailerId}%`))
              .limit(1);
            const detailerEmail = detailerRows[0]?.email;
            if (detailerEmail) {
              const reportEmail = buildInspectionReportEmail({
                detailerName: input.detailerName ?? input.detailerId,
                opsManagerName: input.opsManagerName ?? input.opsManagerId,
                inspectedAt: input.inspectedAt,
                jobAddress: input.jobAddress,
                overallPass: input.overallPass,
                notes: input.notes,
                items: input.items.map((i) => ({ checkLabel: i.checkLabel, passed: i.passed, notes: i.notes })),
              });
              sendEmail({ to: detailerEmail, subject: reportEmail.subject, html: reportEmail.html, type: "other", customerName: input.detailerName ?? input.detailerId, urgent: true }).catch(() => {});
            }
          }
        } catch { /* non-blocking — don't fail the mutation */ }
        return { success: true };
      }),
    /** Get recent inspections */
    listInspections: publicProcedure
      .input(z.object({ limit: z.number().optional().default(50) }))
      .query(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { siteInspections } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        return database.select().from(siteInspections)
          .orderBy(desc(siteInspections.inspectedAt))
          .limit(input.limit);
      }),
    /** Get items for a specific inspection */
    listInspectionItems: publicProcedure
      .input(z.object({ inspectionId: z.string() }))
      .query(async ({ input }) => {
        if (!input.inspectionId) return [];
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { siteInspectionItems } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        return database.select().from(siteInspectionItems)
          .where(eq(siteInspectionItems.inspectionId, input.inspectionId));
      }),
    /** Submit a van checklist */
    submitVanChecklist: publicProcedure
      .input(z.object({
        checklistId: z.string(),
        opsManagerId: z.string(),
        opsManagerName: z.string().optional(),
        detailerId: z.string(),
        detailerName: z.string().optional(),
        submittedAt: z.string(),
        allItemsPresent: z.boolean(),
        notes: z.string().optional(),
        items: z.array(z.object({
          itemId: z.string(),
          category: z.string(),
          itemName: z.string(),
          present: z.boolean(),
        })),
      }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return { success: false };
        const { vanChecklists, vanChecklistItems } = await import("../drizzle/schema");
        await database.insert(vanChecklists).values({
          checklistId: input.checklistId,
          opsManagerId: input.opsManagerId,
          opsManagerName: input.opsManagerName,
          detailerId: input.detailerId,
          detailerName: input.detailerName,
          submittedAt: new Date(input.submittedAt),
          allItemsPresent: input.allItemsPresent ? 1 : 0,
          notes: input.notes,
        });
        if (input.items.length > 0) {
          await database.insert(vanChecklistItems).values(
            input.items.map(item => ({
              itemId: item.itemId,
              checklistId: input.checklistId,
              category: item.category,
              itemName: item.itemName,
              present: item.present ? 1 : 0,
            }))
          );
        }
        return { success: true };
      }),
    /** Get recent van checklists */
    listVanChecklists: publicProcedure
      .input(z.object({ limit: z.number().optional().default(50) }))
      .query(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { vanChecklists } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        return database.select().from(vanChecklists)
          .orderBy(desc(vanChecklists.submittedAt))
          .limit(input.limit);
      }),
    listVanChecklistsByDetailer: publicProcedure
      .input(z.object({ detailerId: z.string(), limit: z.number().optional().default(20) }))
      .query(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { vanChecklists } = await import("../drizzle/schema");
        const { desc, eq } = await import("drizzle-orm");
        return database.select().from(vanChecklists)
          .where(eq(vanChecklists.detailerId, input.detailerId))
          .orderBy(desc(vanChecklists.submittedAt))
          .limit(input.limit);
      }),
    getVanChecklistItems: publicProcedure
      .input(z.object({ checklistId: z.string() }))
      .query(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { vanChecklistItems } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        return database.select().from(vanChecklistItems)
          .where(eq(vanChecklistItems.checklistId, input.checklistId));
      }),
    getVanCustomItems: publicProcedure
      .query(async () => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { vanChecklistCustomItems } = await import("../drizzle/schema");
        return database.select().from(vanChecklistCustomItems);
      }),
    manageVanChecklistItem: publicProcedure
      .input(z.object({
        category: z.string(),
        itemName: z.string(),
        action: z.enum(["add", "remove"]),
      }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) throw new Error("Database unavailable");
        const { vanChecklistCustomItems } = await import("../drizzle/schema");
        const { and, eq } = await import("drizzle-orm");
        await database.delete(vanChecklistCustomItems)
          .where(and(
            eq(vanChecklistCustomItems.category, input.category),
            eq(vanChecklistCustomItems.itemName, input.itemName),
          ));
        await database.insert(vanChecklistCustomItems).values({
          category: input.category,
          itemName: input.itemName,
          action: input.action,
        });
        return { success: true };
      }),
    deleteVanCustomItem: publicProcedure
      .input(z.object({ id: z.number() }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) throw new Error("Database unavailable");
        const { vanChecklistCustomItems } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await database.delete(vanChecklistCustomItems).where(eq(vanChecklistCustomItems.id, input.id));
        return { success: true };
      }),

    // ─── QC Routes ────────────────────────────────────────────────────────────
    /** Get today's completed jobs with QC status (left-joined from qc_records) */
    qcGetTodayJobs: publicProcedure
      .input(z.object({ date: z.string() }))
      .query(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { scheduleJobs, qcRecords } = await import("../drizzle/schema");
        const { eq, and } = await import("drizzle-orm");
        // Fetch all completed jobs for the given date
        const jobs = await database
          .select()
          .from(scheduleJobs)
          .where(and(eq(scheduleJobs.date, input.date), eq(scheduleJobs.status, "completed")))
          .orderBy(scheduleJobs.startHour);
        if (jobs.length === 0) return [];
        // Fetch existing QC records for these jobs
        const jobIds = jobs.map(j => j.jobId);
        const qcRows = await database
          .select()
          .from(qcRecords)
          .where(eq(qcRecords.jobDate, input.date));
        const qcMap = new Map(qcRows.map(r => [r.jobId, r]));
        return jobs.map(job => ({
          jobId: job.jobId,
          date: job.date,
          customerName: job.customerName ?? "",
          customerPhone: job.customerPhone ?? "",
          detailerName: job.assignedTo ?? "",
          city: job.location ?? "",
          packageType: job.packageType ?? "",
          timeSlot: job.timeSlot ?? "",
          qc: qcMap.get(job.jobId) ?? null,
        }));
      }),

    /**
     * Initiate a masked QC call via Twilio.
     * Twilio calls the ops/admin phone first, then bridges to the customer.
     * Customer sees the business number (850-367-8586), not the caller's personal number.
     */
    qcLogCall: publicProcedure
      .input(z.object({
        jobId: z.string(),
        jobDate: z.string(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        detailerName: z.string().optional(),
        city: z.string().optional(),
        packageType: z.string().optional(),
        reviewedBy: z.string().optional(),
        reviewedById: z.string().optional(),
        callerPhone: z.string().optional(), // ops/admin personal phone to bridge
      }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) throw new Error("Database unavailable");
        const { qcRecords } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const now = new Date();

        const accountSid = process.env.TWILIO_ACCOUNT_SID;
        const authToken = process.env.TWILIO_AUTH_TOKEN;
        const fromNumber = process.env.TWILIO_PHONE_NUMBER ?? "+18503678586";
        const publicUrl = "https://luxurywashonwheels.app";

        let twilioCallSid: string | null = null;
        let usedMaskedCall = false;

        // ── Attempt Twilio masked call if credentials + phones are available ──
        if (accountSid && authToken && input.callerPhone && input.customerPhone) {
          try {
            const normPhone = (p: string) => {
              const d = p.replace(/\D/g, "");
              if (d.length === 10) return `+1${d}`;
              if (d.length === 11 && d.startsWith("1")) return `+${d}`;
              return `+${d}`;
            };
            const callerE164 = normPhone(input.callerPhone);
            const customerE164 = normPhone(input.customerPhone);
            const twiml = `<?xml version="1.0" encoding="UTF-8"?><Response><Say voice="alice">Connecting your QC call now.</Say><Dial callerId="${fromNumber}" timeout="30" record="record-from-answer" recordingStatusCallback="${publicUrl}/api/phone/recording-status"><Number>${customerE164}</Number></Dial></Response>`;
            const formData = new URLSearchParams({
              To: callerE164,
              From: fromNumber,
              Twiml: twiml,
              StatusCallback: `${publicUrl}/api/phone/call-status`,
              StatusCallbackMethod: "POST",
            });
            const response = await fetch(
              `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Calls.json`,
              {
                method: "POST",
                headers: {
                  Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
                  "Content-Type": "application/x-www-form-urlencoded",
                },
                body: formData.toString(),
              }
            );
            if (response.ok) {
              const data = await response.json() as { sid: string };
              twilioCallSid = data.sid;
              usedMaskedCall = true;
              console.log(`[QC] Masked call initiated: ${twilioCallSid} — ${callerE164} → ${customerE164}`);
            } else {
              const errText = await response.text();
              console.error(`[QC] Twilio call failed: ${errText}`);
            }
          } catch (err) {
            console.error("[QC] Twilio call error:", err);
          }
        }

        // ── Log the call in qc_records ──
        const existing = await database.select().from(qcRecords).where(eq(qcRecords.jobId, input.jobId)).limit(1);
        if (existing.length > 0) {
          await database.update(qcRecords)
            .set({ calledAt: now, callConfirmed: 1, twilioCallSid: twilioCallSid ?? undefined, callerPhone: input.callerPhone ?? undefined })
            .where(eq(qcRecords.jobId, input.jobId));
        } else {
          const qcId = `QC-${input.jobId}-${Date.now()}`;
          await database.insert(qcRecords).values({
            qcId, jobId: input.jobId, jobDate: input.jobDate,
            customerName: input.customerName, customerPhone: input.customerPhone,
            detailerName: input.detailerName, city: input.city, packageType: input.packageType,
            calledAt: now, callConfirmed: 1,
            twilioCallSid: twilioCallSid ?? undefined, callerPhone: input.callerPhone ?? undefined,
            status: "pending", reviewedBy: input.reviewedBy, reviewedById: input.reviewedById,
          });
        }
        return { success: true, calledAt: now.toISOString(), maskedCall: usedMaskedCall, twilioCallSid };
      }),

    /** Update the outcome tag on a QC call */
    qcUpdateOutcome: publicProcedure
      .input(z.object({
        jobId: z.string(),
        outcome: z.enum(["satisfied", "issue_reported", "no_answer", "voicemail"]),
      }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) throw new Error("Database unavailable");
        const { qcRecords } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await database.update(qcRecords).set({ callOutcome: input.outcome }).where(eq(qcRecords.jobId, input.jobId));
        return { success: true };
      }),

    /** Save QC pass/fail result and optional feedback */
    qcSaveResult: publicProcedure
      .input(z.object({
        jobId: z.string(),
        jobDate: z.string(),
        status: z.enum(["pass", "fail"]),
        feedback: z.string().optional(),
        customerName: z.string().optional(),
        customerPhone: z.string().optional(),
        detailerName: z.string().optional(),
        city: z.string().optional(),
        packageType: z.string().optional(),
        reviewedBy: z.string().optional(),
        reviewedById: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) throw new Error("Database unavailable");
        const { qcRecords } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const existing = await database.select().from(qcRecords).where(eq(qcRecords.jobId, input.jobId)).limit(1);
        if (existing.length > 0) {
          await database.update(qcRecords)
            .set({ status: input.status, feedback: input.feedback ?? null, reviewedBy: input.reviewedBy, reviewedById: input.reviewedById })
            .where(eq(qcRecords.jobId, input.jobId));
        } else {
          const qcId = `QC-${input.jobId}-${Date.now()}`;
          await database.insert(qcRecords).values({
            qcId,
            jobId: input.jobId,
            jobDate: input.jobDate,
            customerName: input.customerName,
            customerPhone: input.customerPhone,
            detailerName: input.detailerName,
            city: input.city,
            packageType: input.packageType,
            callConfirmed: 0,
            status: input.status,
            feedback: input.feedback,
            reviewedBy: input.reviewedBy,
            reviewedById: input.reviewedById,
          });
        }
        return { success: true };
      }),

    /** List QC records for history (past days, most recent first) */
    qcListHistory: publicProcedure
      .input(z.object({ limit: z.number().optional().default(100) }))
      .query(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { qcRecords } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        return database.select().from(qcRecords)
          .orderBy(desc(qcRecords.createdAt))
          .limit(input.limit);
      }),

    /** Get (or create) today's ops daily checklist for the given ops manager */
    getDailyChecklist: publicProcedure
      .input(z.object({ opsManagerId: z.string() }))
      .query(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return null;
        const { opsDailyChecklist } = await import("../drizzle/schema");
        const { and, eq } = await import("drizzle-orm");
        const { todayCST } = await import("./db");
        const today = todayCST();
        const existing = await database.select().from(opsDailyChecklist)
          .where(and(eq(opsDailyChecklist.date, today), eq(opsDailyChecklist.opsManagerId, input.opsManagerId)))
          .limit(1);
        if (existing.length > 0) return existing[0];
        // Create a fresh record for today
        await database.insert(opsDailyChecklist).values({
          date: today,
          opsManagerId: input.opsManagerId,
          siteInspections: 0,
          vanInspections: 0,
          doorHangers: 0,
          inventoryCheck: 0,
          morningTeamCheckIn: 0,
          afternoonTeamCheckIn: 0,
          qcCallsDone: 0,
        });
        const created = await database.select().from(opsDailyChecklist)
          .where(and(eq(opsDailyChecklist.date, today), eq(opsDailyChecklist.opsManagerId, input.opsManagerId)))
          .limit(1);
        return created[0] ?? null;
      }),

    /** Update a field on today's ops daily checklist */
    updateDailyChecklist: publicProcedure
      .input(z.object({
        opsManagerId: z.string(),
        field: z.enum(["siteInspections", "vanInspections", "doorHangers", "inventoryCheck", "morningTeamCheckIn", "afternoonTeamCheckIn", "qcCallsDone"]),
        value: z.number(),
      }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return { success: false };
        const { opsDailyChecklist } = await import("../drizzle/schema");
        const { and, eq } = await import("drizzle-orm");
        const { todayCST } = await import("./db");
        const today = todayCST();
        // Ensure record exists
        const existing = await database.select().from(opsDailyChecklist)
          .where(and(eq(opsDailyChecklist.date, today), eq(opsDailyChecklist.opsManagerId, input.opsManagerId)))
          .limit(1);
        if (existing.length === 0) {
          await database.insert(opsDailyChecklist).values({
            date: today,
            opsManagerId: input.opsManagerId,
            siteInspections: 0,
            vanInspections: 0,
            doorHangers: 0,
            inventoryCheck: 0,
            morningTeamCheckIn: 0,
            afternoonTeamCheckIn: 0,
            qcCallsDone: 0,
          });
        }
        await database.update(opsDailyChecklist)
          .set({ [input.field]: input.value })
          .where(and(eq(opsDailyChecklist.date, today), eq(opsDailyChecklist.opsManagerId, input.opsManagerId)));
        return { success: true };
      }),
  }),
  serviceLocations: router({
    list: publicProcedure
      .query(async () => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { serviceLocations, serviceLocationDetailers } = await import("../drizzle/schema");
        const { asc } = await import("drizzle-orm");
        const locs = await database.select().from(serviceLocations).orderBy(asc(serviceLocations.sortOrder));
        const detailers = await database.select().from(serviceLocationDetailers);
        return locs.map(loc => ({ ...loc, detailers: detailers.filter(d => d.locationId === loc.locationId) }));
      }),
    create: publicProcedure
      .input(z.object({
        name: z.string(),
        slug: z.string(),
        state: z.string().default("FL"),
        isActive: z.number().default(1),
        sortOrder: z.number().default(0),
        zapierWebhookUrl: z.string().optional(),
        thankYouPageUrl: z.string().optional(),
        bookingUrl: z.string().optional(),
        availableDays: z.string().optional(),
        startHour: z.number().default(8),
        endHour: z.number().default(18),
        slotDurationMinutes: z.number().default(60),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        radiusMeters: z.number().default(40000),
        notes: z.string().optional(),
        detailerIds: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) throw new Error("DB unavailable");
        const { serviceLocations, serviceLocationDetailers } = await import("../drizzle/schema");
        const locationId = `loc_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
        await database.insert(serviceLocations).values({
          locationId,
          name: input.name,
          slug: input.slug,
          state: input.state,
          isActive: input.isActive,
          sortOrder: input.sortOrder,
          zapierWebhookUrl: input.zapierWebhookUrl ?? null,
          thankYouPageUrl: input.thankYouPageUrl ?? null,
          bookingUrl: input.bookingUrl ?? null,
          availableDays: input.availableDays ?? null,
          startHour: input.startHour,
          endHour: input.endHour,
          slotDurationMinutes: input.slotDurationMinutes,
          latitude: input.latitude ?? null,
          longitude: input.longitude ?? null,
          radiusMeters: input.radiusMeters,
          notes: input.notes ?? null,
        });
        if (input.detailerIds?.length) {
          await database.insert(serviceLocationDetailers).values(
            input.detailerIds.map((empId, i) => ({ locationId, employeeId: empId, isPrimary: i === 0 ? 1 : 0 }))
          );
        }
        // Auto-create matching finance city so revenue auto-syncs
        try {
          const { financeCities } = await import("../drizzle/schema");
          const { sql: sqlFn, eq: eqFc } = await import("drizzle-orm");
          const existing = await database.select({ id: financeCities.cityId })
            .from(financeCities)
            .where(eqFc(financeCities.slug, input.slug))
            .limit(1);
          if (existing.length === 0) {
            const maxOrder = await database.select({ m: sqlFn<number>`MAX(sort_order)` }).from(financeCities);
            const nextOrder = (maxOrder[0]?.m ?? 0) + 1;
            const cityId = `city_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
            await database.insert(financeCities).values({ cityId, name: input.name, slug: input.slug, sortOrder: nextOrder });
          }
        } catch (e) { console.warn("[serviceLocations.create] finance city sync failed:", e); }
        return { locationId };
      }),
    update: publicProcedure
      .input(z.object({
        locationId: z.string(),
        name: z.string().optional(),
        slug: z.string().optional(),
        state: z.string().optional(),
        isActive: z.number().optional(),
        sortOrder: z.number().optional(),
        zapierWebhookUrl: z.string().optional(),
        thankYouPageUrl: z.string().optional(),
        bookingUrl: z.string().optional(),
        availableDays: z.string().optional(),
        startHour: z.number().optional(),
        endHour: z.number().optional(),
        slotDurationMinutes: z.number().optional(),
        latitude: z.string().optional(),
        longitude: z.string().optional(),
        radiusMeters: z.number().optional(),
        notes: z.string().optional(),
        detailerIds: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) throw new Error("DB unavailable");
        const { serviceLocations, serviceLocationDetailers } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        const { locationId, detailerIds, ...fields } = input;
        const updateData: Record<string, unknown> = {};
        for (const [k, v] of Object.entries(fields)) { if (v !== undefined) updateData[k] = v; }
        if (Object.keys(updateData).length > 0) {
          await database.update(serviceLocations).set(updateData).where(eq(serviceLocations.locationId, locationId));
        }
        if (detailerIds !== undefined) {
          await database.delete(serviceLocationDetailers).where(eq(serviceLocationDetailers.locationId, locationId));
          if (detailerIds.length > 0) {
            await database.insert(serviceLocationDetailers).values(
              detailerIds.map((empId, i) => ({ locationId, employeeId: empId, isPrimary: i === 0 ? 1 : 0 }))
            );
          }
        }
        return { success: true };
      }),
    delete: publicProcedure
      .input(z.object({ locationId: z.string() }))
      .mutation(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) throw new Error("DB unavailable");
        const { serviceLocations, serviceLocationDetailers } = await import("../drizzle/schema");
        const { eq } = await import("drizzle-orm");
        await database.delete(serviceLocationDetailers).where(eq(serviceLocationDetailers.locationId, input.locationId));
        await database.delete(serviceLocations).where(eq(serviceLocations.locationId, input.locationId));
        return { success: true };
      }),
  }),
  emailLogs: router({
    list: publicProcedure
      .input(z.object({
        limit: z.number().optional().default(100),
        offset: z.number().optional().default(0),
      }))
      .query(async ({ input }) => {
        const database = await (await import("./db")).getDb();
        if (!database) return [];
        const { emailLogs } = await import("../drizzle/schema");
        const { desc } = await import("drizzle-orm");
        return database.select().from(emailLogs)
          .orderBy(desc(emailLogs.sentAt))
          .limit(input.limit)
          .offset(input.offset);
      }),
    counts: publicProcedure
      .query(async () => {
        const database = await (await import("./db")).getDb();
        if (!database) return { total: 0, bookings: 0, alerts: 0 };
        const { emailLogs } = await import("../drizzle/schema");
        const { sql, eq } = await import("drizzle-orm");
        const [totalRow] = await database.select({ count: sql<number>`COUNT(*)` }).from(emailLogs);
        const [bookingsRow] = await database.select({ count: sql<number>`COUNT(*)` }).from(emailLogs).where(eq(emailLogs.type, "booking_confirmation"));
        const [alertsRow] = await database.select({ count: sql<number>`COUNT(*)` }).from(emailLogs).where(eq(emailLogs.type, "notification"));
        return {
          total: Number(totalRow?.count ?? 0),
          bookings: Number(bookingsRow?.count ?? 0),
          alerts: Number(alertsRow?.count ?? 0),
        };
      }),
  }),
  promotions: router({
    list: publicProcedure.query(async () => db.listPromotions()),
    getActive: publicProcedure.query(async () => db.getActivePromotions()),
    validateCode: publicProcedure
      .input(z.object({ code: z.string(), subtotal: z.number() }))
      .mutation(async ({ input }) => {
        const active = await db.getActivePromotions();
        const promo = active.find(
          (p: any) => p.promoCode && p.promoCode.toUpperCase() === input.code.toUpperCase()
        );
        if (!promo) return { valid: false, message: "Invalid or expired promo code." };
        let discountAmount = 0;
        if (promo.discountType === "percent" && promo.discountValue) {
          discountAmount = Math.round(input.subtotal * (parseFloat(String(promo.discountValue)) / 100) * 100) / 100;
        } else if (promo.discountType === "fixed" && promo.discountValue) {
          discountAmount = Math.min(parseFloat(String(promo.discountValue)), input.subtotal);
        }
        return {
          valid: true,
          promoId: promo.promoId,
          title: promo.title,
          discountType: promo.discountType,
          discountValue: promo.discountValue ? parseFloat(String(promo.discountValue)) : 0,
          discountAmount,
          message: `${promo.title} applied!`,
        };
      }),
    create: publicProcedure
      .input(z.object({
        title: z.string(),
        description: z.string().optional(),
        discountType: z.enum(["percent", "fixed", "none"]),
        discountValue: z.number().optional(),
        promoCode: z.string().optional(),
        bgColor: z.string().optional(),
        emoji: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        createdBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const promoId = await db.createPromotion(input);
        return { promoId };
      }),
    update: publicProcedure
      .input(z.object({
        promoId: z.string(),
        title: z.string().optional(),
        description: z.string().optional(),
        discountType: z.enum(["percent", "fixed", "none"]).optional(),
        discountValue: z.number().optional(),
        promoCode: z.string().optional(),
        bgColor: z.string().optional(),
        emoji: z.string().optional(),
        startDate: z.string().optional(),
        endDate: z.string().optional(),
        isActive: z.boolean().optional(),
      }))
      .mutation(async ({ input }) => {
        const { promoId, ...rest } = input;
        await db.updatePromotion(promoId, rest);
        return { success: true };
      }),
    delete: publicProcedure
      .input(z.object({ promoId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deletePromotion(input.promoId);
        return { success: true };
      }),
  }),

  subsidiaryCities: router({
    list: publicProcedure
      .input(z.object({ locationId: z.string().optional() }))
      .query(async ({ input }) => {
        return db.getSubsidiaryCities(input.locationId);
      }),
    listGrouped: publicProcedure
      .query(async () => {
        return db.getAllSubsidiaryCitiesGrouped();
      }),
    add: publicProcedure
      .input(z.object({ locationId: z.string(), name: z.string().min(1).max(100) }))
      .mutation(async ({ input }) => {
        const id = await db.addSubsidiaryCity(input.locationId, input.name);
        return { id };
      }),
    remove: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        await db.removeSubsidiaryCity(input.id);
        return { success: true };
      }),
  }),

  // ─── Referral Program ────────────────────────────────────────────────────────
  referral: router({
    getMyCode: publicProcedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => {
        const customer = await customerDb.getCustomerById(input.customerId);
        const code = await db.getOrCreateReferralCode(input.customerId, customer?.firstName);
        return { code };
      }),
    getBalance: publicProcedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => {
        const balance = await db.getCustomerPointBalance(input.customerId);
        return { balance };
      }),
    getHistory: publicProcedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => db.getCustomerPointsHistory(input.customerId)),
    getMyReferrals: publicProcedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => db.getCustomerReferrals(input.customerId)),
    validateCode: publicProcedure
      .input(z.object({ code: z.string() }))
      .query(async ({ input }) => {
        const result = await db.getCustomerByReferralCode(input.code);
        if (!result) return { valid: false, referrerId: null };
        return { valid: true, referrerId: result.customerId };
      }),
    recordSignup: publicProcedure
      .input(z.object({ referrerId: z.string(), friendId: z.string(), friendEmail: z.string() }))
      .mutation(async ({ input }) => {
        const referralId = await db.createReferral(input.referrerId, input.friendId, input.friendEmail);
        return { referralId };
      }),
    completeReferral: publicProcedure
      .input(z.object({ referralId: z.string() }))
      .mutation(async ({ input }) => {
        await db.completeReferral(input.referralId);
        return { success: true };
      }),
    getRewardTiers: publicProcedure
      .query(async () => db.getActiveRewardTiers()),
    getAllRewardTiers: publicProcedure
      .query(async () => db.getAllRewardTiers()),
    createRewardTier: publicProcedure
      .input(z.object({
        name: z.string().min(1),
        description: z.string().optional(),
        pointCost: z.number().int().positive(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const tierId = await db.createRewardTier(input);
        return { tierId };
      }),
    updateRewardTier: publicProcedure
      .input(z.object({
        tierId: z.string(),
        name: z.string().optional(),
        description: z.string().optional(),
        pointCost: z.number().int().positive().optional(),
        isActive: z.enum(['yes', 'no']).optional(),
        sortOrder: z.number().int().optional(),
      }))
      .mutation(async ({ input }) => {
        const { tierId, ...data } = input;
        await db.updateRewardTier(tierId, data);
        return { success: true };
      }),
    deleteRewardTier: publicProcedure
      .input(z.object({ tierId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteRewardTier(input.tierId);
        return { success: true };
      }),
    redeem: publicProcedure
      .input(z.object({ customerId: z.string(), tierId: z.string() }))
      .mutation(async ({ input }) => {
        const redemptionId = await db.redeemPoints(input.customerId, input.tierId);
        return { redemptionId };
      }),
    getMyRedemptions: publicProcedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => db.getCustomerRedemptions(input.customerId)),
    getPendingRedemptions: publicProcedure
      .query(async () => db.getAllPendingRedemptions()),
    applyRedemption: publicProcedure
      .input(z.object({ redemptionId: z.string() }))
      .mutation(async ({ input }) => {
        await db.applyRedemption(input.redemptionId);
        return { success: true };
      }),
    /** Detailer fulfills a pending redemption for a customer during a job */
    fulfillRedemption: publicProcedure
      .input(z.object({
        redemptionId: z.string(),
        fulfilledBy: z.string(),
        fulfilledByEmployeeId: z.string(),
      }))
      .mutation(async ({ input }) => {
        await db.fulfillRedemption(input.redemptionId, input.fulfilledBy, input.fulfilledByEmployeeId);
        return { success: true };
      }),
    /** Get pending redemptions for a specific customer (detailer job card badge) */
    getPendingForCustomer: publicProcedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => {
        return db.getPendingRedemptionsForCustomer(input.customerId);
      }),
  }),

  // ─── Reporting Router ────────────────────────────────────────────────────────
  pricebook: router({
    /** List all active price book services (for customer portal) */
    list: publicProcedure
      .query(async () => {
        const services = await db.listPriceBookServices();
        return services.map((s) => ({
          serviceId: s.serviceId,
          name: s.name,
          emoji: s.emoji,
          description: s.description ?? "",
          features: s.features ? JSON.parse(s.features) as string[] : [],
          vehiclePrices: JSON.parse(s.vehiclePrices) as { sedan: number; suv: number; xl_suv_van: number; truck: number; rv_20_29?: number; rv_30_39?: number; rv_40_plus?: number },
          imageUrl: s.imageUrl ?? null,
          sortOrder: s.sortOrder,
        }));
      }),
    /** List ALL price book services including inactive (for admin) */
    listAll: publicProcedure
      .query(async () => {
        const services = await db.listAllPriceBookServices();
        return services.map((s) => ({
          serviceId: s.serviceId,
          name: s.name,
          emoji: s.emoji,
          description: s.description ?? "",
          features: s.features ? JSON.parse(s.features) as string[] : [],
          vehiclePrices: JSON.parse(s.vehiclePrices) as { sedan: number; suv: number; xl_suv_van: number; truck: number; rv_20_29?: number; rv_30_39?: number; rv_40_plus?: number },
          imageUrl: s.imageUrl ?? null,
          sortOrder: s.sortOrder,
          isActive: s.isActive === "yes",
        }));
      }),
    /** Toggle a service active/inactive */
    toggleActive: publicProcedure
      .input(z.object({ serviceId: z.string(), isActive: z.boolean() }))
      .mutation(async ({ input }) => {
        await db.togglePriceBookServiceActive(input.serviceId, input.isActive);
        return { success: true as const };
      }),
    /** Create or update a price book service */
    upsert: publicProcedure
      .input(z.object({
        serviceId: z.string(),
        name: z.string().min(1),
        emoji: z.string().default("🚗"),
        description: z.string().optional(),
        features: z.array(z.string()).optional(),
        vehiclePrices: z.object({
          sedan: z.number().min(0),
          suv: z.number().min(0),
          xl_suv_van: z.number().min(0),
          truck: z.number().min(0),
          rv_20_29: z.number().min(0).optional(),
          rv_30_39: z.number().min(0).optional(),
          rv_40_plus: z.number().min(0).optional(),
        }),
        sortOrder: z.number().optional(),
        imageUrl: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        await db.upsertPriceBookService(input);
        return { success: true as const };
      }),
    /** Upload a service photo from device (base64) to S3 and update the price book entry */
    uploadServiceImage: publicProcedure
      .input(z.object({
        serviceId: z.string().min(1),
        base64: z.string(),
        mimeType: z.string().default('image/jpeg'),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64, 'base64');
        const ext = input.mimeType === 'image/png' ? 'png' : 'webp';
        const key = `pricebook-images/${input.serviceId}-${Date.now()}.${ext}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        await db.upsertPriceBookServiceImage(input.serviceId, url);
        return { success: true as const, url };
      }),
    /** Soft-delete a price book service */
    delete: publicProcedure
      .input(z.object({ serviceId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deletePriceBookService(input.serviceId);
        return { success: true as const };
      }),
    /** Reorder: accepts ordered array of serviceIds and updates sortOrder */
    reorder: publicProcedure
      .input(z.object({ orderedIds: z.array(z.string()) }))
      .mutation(async ({ input }) => {
        await db.reorderPriceBookServices(input.orderedIds);
        return { success: true as const };
      }),
  }),
  reporting: router({
    /** Get summary stats for a date range: revenue, job count, avg job hours, tips, upsells */
    getSummary: publicProcedure
      .input(z.object({
        startDate: z.string(),
        endDate: z.string(),
        location: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const jobs = await db.getAllScheduleJobsByDateRange(input.startDate, input.endDate);
        const filtered = input.location
          ? jobs.filter((j: any) => j.location === input.location)
          : jobs;
        const active = filtered.filter((j: any) => j.status !== 'cancelled');
        const completed = filtered.filter((j: any) => j.status === 'completed');

        let totalRevenue = 0, totalTips = 0, totalUpsells = 0;
        let totalJobHours = 0, jobHoursCount = 0;

        for (const j of active) {
          const jDiscount = parseFloat(j.discountAmount ?? '0');
          totalRevenue += Math.max(0, parseFloat(j.totalPrice ?? '0') - jDiscount);
          totalTips += parseFloat(j.tips ?? '0');
          totalUpsells += parseFloat(j.upsellTotal ?? '0');
          if (j.startHour != null && j.endHour != null && parseFloat(String(j.endHour)) > parseFloat(String(j.startHour))) {
            totalJobHours += (parseFloat(String(j.endHour)) - parseFloat(String(j.startHour)));
            jobHoursCount++;
          }
        }

        return {
          totalJobs: active.length,
          completedJobs: completed.length,
          totalRevenue: +totalRevenue.toFixed(2),
          totalTips: +totalTips.toFixed(2),
          totalUpsells: +totalUpsells.toFixed(2),
          avgRevenuePerJob: active.length > 0 ? +(totalRevenue / active.length).toFixed(2) : 0,
          totalJobHours: +totalJobHours.toFixed(1),
          avgJobHours: jobHoursCount > 0 ? +(totalJobHours / jobHoursCount).toFixed(1) : 0,
        };
      }),

    /** Get per-package breakdown: job count, total revenue, avg hours */
    getPackageBreakdown: publicProcedure
      .input(z.object({
        startDate: z.string(),
        endDate: z.string(),
        location: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const jobs = await db.getAllScheduleJobsByDateRange(input.startDate, input.endDate);
        const filtered = (input.location
          ? jobs.filter((j: any) => j.location === input.location)
          : jobs).filter((j: any) => j.status !== 'cancelled');

        // Build a static name map (same as resolvePackageNameAsync but sync)
        const PKG_NAME: Record<string, string> = {
          pb_basic: 'Basic Detail', pb_full: 'Full Detail', pb_luxury: 'Luxury Detail',
          pb_interior: 'Interior Detail', pb_exterior: 'Exterior Detail', pb_vip: 'VIP Detail',
          pb_express: 'Express Detail', pb_premium: 'Premium Detail',
          interior: 'Interior Detail', exterior: 'Exterior Detail', luxury: 'Luxury Detail',
          full: 'Full Detail', basic: 'Basic Detail', vip: 'VIP Detail',
          full_detail: 'Full Detail', basic_detail: 'Basic Detail',
          interior_detail: 'Interior Detail', exterior_detail: 'Exterior Detail',
          luxury_detail: 'Luxury Detail', premium_detail: 'Premium Detail',
          roadtrip: 'Road Trip Refresh', vacint: 'Vacation Interior Clean',
          vacfull: 'Full Vacation Detail',
        };
        // Fetch price_book_services names for dynamic pb_ IDs
        let pbServiceNames: Record<string, string> = {};
        try {
          const pbList = await db.listPriceBookServices();
          for (const row of pbList) { if (row.serviceId && row.name) pbServiceNames[row.serviceId] = row.name; }
        } catch { /* ignore */ }
        const resolvePkg = (raw: string | null | undefined): string => {
          if (!raw) return 'Unknown';
          const key = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
          if (PKG_NAME[key]) return PKG_NAME[key];
          if (pbServiceNames[raw]) return pbServiceNames[raw];
          if (raw.startsWith('pb_') && pbServiceNames[raw]) return pbServiceNames[raw];
          return raw;
        };
        const map: Record<string, { count: number; revenue: number; hours: number; hoursCount: number }> = {};
        for (const j of filtered) {
          const pkg = resolvePkg(j.packageType);
          if (!map[pkg]) map[pkg] = { count: 0, revenue: 0, hours: 0, hoursCount: 0 };
          map[pkg].count++;
          map[pkg].revenue += Math.max(0, parseFloat(j.totalPrice ?? '0') - parseFloat(j.discountAmount ?? '0'));
          if (j.startHour != null && j.endHour != null && parseFloat(String(j.endHour)) > parseFloat(String(j.startHour))) {
            map[pkg].hours += (parseFloat(String(j.endHour)) - parseFloat(String(j.startHour)));
            map[pkg].hoursCount++;
          }
        }
        return Object.entries(map)
          .map(([packageType, s]) => ({
            packageType,
            jobCount: s.count,
            totalRevenue: +s.revenue.toFixed(2),
            avgRevenue: s.count > 0 ? +(s.revenue / s.count).toFixed(2) : 0,
            avgHours: s.hoursCount > 0 ? +(s.hours / s.hoursCount).toFixed(1) : 0,
          }))
          .sort((a, b) => b.totalRevenue - a.totalRevenue);
      }),

    /** Get per-detailer stats: jobs, revenue, avg hours */
    getDetailerStats: publicProcedure
      .input(z.object({
        startDate: z.string(),
        endDate: z.string(),
        location: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const jobs = await db.getAllScheduleJobsByDateRange(input.startDate, input.endDate);
        const filtered = (input.location
          ? jobs.filter((j: any) => j.location === input.location)
          : jobs).filter((j: any) => j.status !== 'cancelled' && j.assignedTo && j.assignedTo.trim() !== '');

        // Build a normalization map: legacy name/ID variants → canonical display name
        // This merges split profiles caused by old jobs stored with plain names vs employee IDs
        const allEmployees = await db.getAllActiveEmployees();
        const nameNormMap: Record<string, string> = {};
        for (const emp of allEmployees) {
          const displayName = emp.fullName.split(' ')[0]; // use first name as display
          const empIdLower = emp.employeeId.toLowerCase();
          // Map the employeeId itself
          nameNormMap[emp.employeeId] = displayName;
          // Map common legacy variants: strip DET_ or DET prefix from ID
          const stripped = emp.employeeId.replace(/^DET_?/i, '').toLowerCase();
          if (stripped) nameNormMap[stripped] = displayName;
          // Map the full name and first name
          nameNormMap[emp.fullName] = displayName;
          nameNormMap[emp.fullName.split(' ')[0]] = displayName;
          nameNormMap[emp.fullName.split(' ')[0].toLowerCase()] = displayName;
          nameNormMap[emp.fullName.toLowerCase()] = displayName;
          nameNormMap[empIdLower] = displayName;
        }
        const normalizeAssignedTo = (raw: string): string => {
          if (!raw) return 'Unassigned';
          return nameNormMap[raw] ?? nameNormMap[raw.toLowerCase()] ?? raw;
        };

        const map: Record<string, { count: number; revenue: number; tips: number; hours: number; hoursCount: number }> = {};
        for (const j of filtered) {
          const name = normalizeAssignedTo(j.assignedTo ?? 'Unassigned');
          if (!map[name]) map[name] = { count: 0, revenue: 0, tips: 0, hours: 0, hoursCount: 0 };
          map[name].count++;
          map[name].revenue += Math.max(0, parseFloat(j.totalPrice ?? '0') - parseFloat(j.discountAmount ?? '0'));
          map[name].tips += parseFloat(j.tips ?? '0');
          if (j.startHour != null && j.endHour != null && parseFloat(String(j.endHour)) > parseFloat(String(j.startHour))) {
            map[name].hours += (parseFloat(String(j.endHour)) - parseFloat(String(j.startHour)));
            map[name].hoursCount++;
          }
        }
        return Object.entries(map)
          .map(([detailer, s]) => ({
            detailer,
            jobCount: s.count,
            totalRevenue: +s.revenue.toFixed(2),
            totalTips: +s.tips.toFixed(2),
            avgRevenuePerJob: s.count > 0 ? +(s.revenue / s.count).toFixed(2) : 0,
            totalHours: +s.hours.toFixed(1),
            avgHoursPerJob: s.hoursCount > 0 ? +(s.hours / s.hoursCount).toFixed(1) : 0,
          }))
          .sort((a, b) => b.totalRevenue - a.totalRevenue);
      }),

    /** Get drive time stats: avg drive time per detailer, per location, per day */
    getDriveTimeStats: publicProcedure
      .input(z.object({
        startDate: z.string(),
        endDate: z.string(),
        location: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const jobs = await db.getAllScheduleJobsByDateRange(input.startDate, input.endDate);
        const filtered: any[] = (input.location
          ? jobs.filter((j: any) => j.location === input.location)
          : jobs).filter((j: any) => j.status !== 'cancelled');

        // Build the same name normalization map used in getDetailerStats
        const driveAllEmployees = await db.getAllActiveEmployees();
        const driveNameMap: Record<string, string> = {};
        for (const emp of driveAllEmployees) {
          const displayName = emp.fullName.split(' ')[0];
          const empIdLower = emp.employeeId.toLowerCase();
          driveNameMap[emp.employeeId] = displayName;
          const stripped = emp.employeeId.replace(/^DET_?/i, '').toLowerCase();
          if (stripped) driveNameMap[stripped] = displayName;
          driveNameMap[emp.fullName] = displayName;
          driveNameMap[emp.fullName.split(' ')[0]] = displayName;
          driveNameMap[emp.fullName.split(' ')[0].toLowerCase()] = displayName;
          driveNameMap[emp.fullName.toLowerCase()] = displayName;
          driveNameMap[empIdLower] = displayName;
        }
        const normDriveName = (raw: string | null | undefined): string => {
          if (!raw) return 'Unassigned';
          return driveNameMap[raw] ?? driveNameMap[raw.toLowerCase()] ?? raw;
        };

        type DriveEntry = { totalMins: number; count: number };
        const byDetailer: Record<string, DriveEntry> = {};
        const byLocation: Record<string, DriveEntry> = {};
        const byDay: Record<string, DriveEntry> = {};
        let totalMins = 0, totalCount = 0;

        for (const j of filtered) {
          if (!j.onMyWayAt || !j.arrivedAt) continue;
          const driveMins = (new Date(j.arrivedAt).getTime() - new Date(j.onMyWayAt).getTime()) / 60000;
          if (driveMins < 0 || driveMins > 300) continue; // ignore bad data (>5h)

          totalMins += driveMins;
          totalCount++;

          const det = normDriveName(j.assignedTo);
          if (!byDetailer[det]) byDetailer[det] = { totalMins: 0, count: 0 };
          byDetailer[det].totalMins += driveMins;
          byDetailer[det].count++;

          const loc = j.location ?? 'Unknown';
          if (!byLocation[loc]) byLocation[loc] = { totalMins: 0, count: 0 };
          byLocation[loc].totalMins += driveMins;
          byLocation[loc].count++;

          const day = j.date;
          if (!byDay[day]) byDay[day] = { totalMins: 0, count: 0 };
          byDay[day].totalMins += driveMins;
          byDay[day].count++;
        }

        return {
          totalJobsWithDriveData: totalCount,
          avgDriveMinutes: totalCount > 0 ? +(totalMins / totalCount).toFixed(1) : 0,
          byDetailer: Object.entries(byDetailer)
            .map(([detailer, s]) => ({
              detailer,
              jobCount: s.count,
              avgDriveMinutes: +(s.totalMins / s.count).toFixed(1),
              totalDriveMinutes: +s.totalMins.toFixed(1),
            }))
            .sort((a, b) => b.avgDriveMinutes - a.avgDriveMinutes),
          byLocation: Object.entries(byLocation)
            .map(([location, s]) => ({
              location,
              jobCount: s.count,
              avgDriveMinutes: +(s.totalMins / s.count).toFixed(1),
            }))
            .sort((a, b) => b.avgDriveMinutes - a.avgDriveMinutes),
          byDay: Object.entries(byDay)
            .map(([date, s]) => ({
              date,
              jobCount: s.count,
              avgDriveMinutes: +(s.totalMins / s.count).toFixed(1),
            }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        };
      }),
    /** Get per-city performance breakdown (only meaningful when no location filter applied) */
    getCityBreakdown: publicProcedure
      .input(z.object({
        startDate: z.string(),
        endDate: z.string(),
      }))
      .query(async ({ input }) => {
        const jobs = await db.getAllScheduleJobsByDateRange(input.startDate, input.endDate);
        const active = jobs.filter((j: any) => j.status !== 'cancelled');
        const map: Record<string, { count: number; completed: number; revenue: number; tips: number; upsells: number }> = {};
        for (const j of active) {
          const city = (j.location ?? 'Unknown').trim();
          if (!map[city]) map[city] = { count: 0, completed: 0, revenue: 0, tips: 0, upsells: 0 };
          map[city].count++;
          if (j.status === 'completed') map[city].completed++;
          map[city].revenue += Math.max(0, parseFloat(j.totalPrice ?? '0') - parseFloat(j.discountAmount ?? '0'));
          map[city].tips += parseFloat(j.tips ?? '0');
          map[city].upsells += parseFloat(j.upsellTotal ?? '0');
        }
        return Object.entries(map)
          .map(([city, s]) => ({
            city,
            jobCount: s.count,
            completedJobs: s.completed,
            totalRevenue: +s.revenue.toFixed(2),
            totalTips: +s.tips.toFixed(2),
            totalUpsells: +s.upsells.toFixed(2),
            avgRevenuePerJob: s.count > 0 ? +(s.revenue / s.count).toFixed(2) : 0,
          }))
          .sort((a, b) => b.totalRevenue - a.totalRevenue);
      }),
    /** Get daily revenue trend for sparkline/chart */
    getDailyTrend: publicProcedure
      .input(z.object({
        startDate: z.string(),
        endDate: z.string(),
        location: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const jobs = await db.getAllScheduleJobsByDateRange(input.startDate, input.endDate);
        const filtered = (input.location
          ? jobs.filter((j: any) => j.location === input.location)
          : jobs).filter((j: any) => j.status !== 'cancelled');

        const map: Record<string, { revenue: number; jobs: number }> = {};
        for (const j of filtered) {
          if (!map[j.date]) map[j.date] = { revenue: 0, jobs: 0 };
          map[j.date].revenue += Math.max(0, parseFloat(j.totalPrice ?? '0') - parseFloat(j.discountAmount ?? '0'));
          map[j.date].jobs++;
        }
        return Object.entries(map)
          .map(([date, s]) => ({ date, revenue: +s.revenue.toFixed(2), jobs: s.jobs }))
          .sort((a, b) => a.date.localeCompare(b.date));
      }),

    /**
     * Booked Revenue — queries by job CREATION date (createdAt), not service date.
     * Returns summary + daily trend + breakdown by booker (createdBy) + by city + by package.
     * Excludes cancelled jobs.
     */
    getBookedRevenue: publicProcedure
      .input(z.object({
        startDate: z.string(), // YYYY-MM-DD  (local date, treated as UTC midnight)
        endDate: z.string(),
        location: z.string().optional(),
      }))
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return {
          totalRevenue: 0, totalJobs: 0, avgRevenuePerJob: 0,
          byBooker: [], byCity: [], byPackage: [], byDay: [],
        };
        const { scheduleJobs: sj } = await import('../drizzle/schema');
        const { and, gte, lte, ne, sql: sqlExpr } = await import('drizzle-orm');

        // Build date range filter on createdAt
        const startTs = `${input.startDate} 00:00:00`;
        const endTs   = `${input.endDate} 23:59:59`;

        const rows = await drizzleDb
          .select({
            jobId:          sj.jobId,
            createdAt:      sj.createdAt,
            createdBy:      sj.createdBy,
            location:       sj.location,
            packageType:    sj.packageType,
            totalPrice:     sj.totalPrice,
            discountAmount: sj.discountAmount,
            status:         sj.status,
            date:           sj.date,
          })
          .from(sj)
          .where(and(
            gte(sqlExpr`${sj.createdAt}`, sqlExpr`${startTs}`),
            lte(sqlExpr`${sj.createdAt}`, sqlExpr`${endTs}`),
            ne(sj.status, 'cancelled'),
          ));

        // Optional location filter
        const filtered = input.location
          ? rows.filter((r: any) => r.location === input.location)
          : rows;

        // Resolve raw packageType IDs to human-readable names
        const BREV_PKG_NAME: Record<string, string> = {
          pb_basic: 'Basic Detail', pb_full: 'Full Detail', pb_luxury: 'Luxury Detail',
          pb_interior: 'Interior Detail', pb_exterior: 'Exterior Detail', pb_vip: 'VIP Detail',
          pb_express: 'Express Detail', pb_premium: 'Premium Detail',
          interior: 'Interior Detail', exterior: 'Exterior Detail', luxury: 'Luxury Detail',
          full: 'Full Detail', basic: 'Basic Detail', vip: 'VIP Detail',
          full_detail: 'Full Detail', basic_detail: 'Basic Detail',
          interior_detail: 'Interior Detail', exterior_detail: 'Exterior Detail',
          luxury_detail: 'Luxury Detail', premium_detail: 'Premium Detail',
          roadtrip: 'Road Trip Refresh', vacint: 'Vacation Interior Clean',
          vacfull: 'Full Vacation Detail',
        };
        let bRevPbNames: Record<string, string> = {};
        try {
          const pbList2 = await db.listPriceBookServices();
          for (const row of pbList2) { if (row.serviceId && row.name) bRevPbNames[row.serviceId] = row.name; }
        } catch { /* ignore */ }
        const resolvePkgRev = (raw: string | null | undefined): string => {
          if (!raw) return 'Unknown';
          const key = raw.toLowerCase().replace(/[^a-z0-9_]/g, '');
          if (BREV_PKG_NAME[key]) return BREV_PKG_NAME[key];
          if (bRevPbNames[raw]) return bRevPbNames[raw];
          return raw;
        };

        let totalRevenue = 0;
        const byBooker:  Record<string, { jobs: number; revenue: number }> = {};
        const byCity:    Record<string, { jobs: number; revenue: number }> = {};
        const byPackage: Record<string, { jobs: number; revenue: number }> = {};
        const byDay:     Record<string, { jobs: number; revenue: number }> = {};

        for (const r of filtered) {
          const rev = Math.max(0, parseFloat(String(r.totalPrice ?? '0')) - parseFloat(String(r.discountAmount ?? '0')));
          totalRevenue += rev;

          // Booker attribution
          const booker = r.createdBy ?? 'Online / Unknown';
          if (!byBooker[booker]) byBooker[booker] = { jobs: 0, revenue: 0 };
          byBooker[booker].jobs++;
          byBooker[booker].revenue += rev;

          // City
          const city = (r.location ?? 'Unknown').trim();
          if (!byCity[city]) byCity[city] = { jobs: 0, revenue: 0 };
          byCity[city].jobs++;
          byCity[city].revenue += rev;

          // Package
          const pkg = resolvePkgRev(r.packageType);
          if (!byPackage[pkg]) byPackage[pkg] = { jobs: 0, revenue: 0 };
          byPackage[pkg].jobs++;
          byPackage[pkg].revenue += rev;

          // Daily trend — use the CREATION date (createdAt date portion)
          const dayKey = r.createdAt instanceof Date
            ? r.createdAt.toISOString().slice(0, 10)
            : String(r.createdAt ?? r.date ?? '').slice(0, 10);
          if (dayKey) {
            if (!byDay[dayKey]) byDay[dayKey] = { jobs: 0, revenue: 0 };
            byDay[dayKey].jobs++;
            byDay[dayKey].revenue += rev;
          }
        }

        const totalJobs = filtered.length;
        return {
          totalRevenue:     +totalRevenue.toFixed(2),
          totalJobs,
          avgRevenuePerJob: totalJobs > 0 ? +(totalRevenue / totalJobs).toFixed(2) : 0,
          byBooker: Object.entries(byBooker)
            .map(([name, s]) => ({ name, jobs: s.jobs, revenue: +s.revenue.toFixed(2) }))
            .sort((a, b) => b.revenue - a.revenue),
          byCity: Object.entries(byCity)
            .map(([city, s]) => ({ city, jobs: s.jobs, revenue: +s.revenue.toFixed(2) }))
            .sort((a, b) => b.revenue - a.revenue),
          byPackage: Object.entries(byPackage)
            .map(([pkg, s]) => ({ pkg, jobs: s.jobs, revenue: +s.revenue.toFixed(2) }))
            .sort((a, b) => b.revenue - a.revenue),
          byDay: Object.entries(byDay)
            .map(([date, s]) => ({ date, jobs: s.jobs, revenue: +s.revenue.toFixed(2) }))
            .sort((a, b) => a.date.localeCompare(b.date)),
        };
      }),
  }),

  portalInbox: router({
    /** List all customer conversations (latest message per customer) for admin inbox */
    listThreads: publicProcedure
      .query(async () => {
        const conn = await db.getConnection();
        try {
          // Get latest message per customer with unread count
          // Uses getConnection() pattern (like all other raw SQL in this file) so [rows] destructuring works correctly
          const [rows] = await conn.execute(`
            SELECT
              pm.customer_id AS customerId,
              latest.body AS latestBody,
              latest.direction AS latestDirection,
              latest.created_at AS latestAt,
              SUM(CASE WHEN pm.is_read = 0 AND pm.direction = 'inbound' THEN 1 ELSE 0 END) AS unreadCount,
              c.first_name AS firstName,
              c.last_name AS lastName,
              c.phone,
              c.email,
              c.city
            FROM portal_messages pm
            INNER JOIN customers c ON pm.customer_id = c.customer_id
            INNER JOIN (
              SELECT pm2.customer_id, pm2.body, pm2.direction, pm2.created_at
              FROM portal_messages pm2
              INNER JOIN (
                SELECT customer_id, MAX(created_at) AS max_at
                FROM portal_messages
                GROUP BY customer_id
              ) latest_ts ON pm2.customer_id = latest_ts.customer_id AND pm2.created_at = latest_ts.max_at
            ) latest ON pm.customer_id = latest.customer_id
            GROUP BY pm.customer_id, latest.body, latest.direction, latest.created_at, c.first_name, c.last_name, c.phone, c.email, c.city
            ORDER BY latest.created_at DESC
          `) as [any[], any];
          return rows.map((r: any) => ({
            customerId: r.customerId ?? null,
            customerName: `${r.firstName ?? ''} ${r.lastName ?? ''}`.trim() || 'Unknown',
            phone: r.phone ?? '',
            email: r.email ?? '',
            city: r.city ?? '',
            latestBody: r.latestBody ?? '',
            latestDirection: (r.latestDirection ?? 'inbound') as 'inbound' | 'outbound',
            latestAt: r.latestAt instanceof Date ? r.latestAt.toISOString() : (r.latestAt ? new Date(String(r.latestAt).replace(' ', 'T') + (String(r.latestAt).includes('T') || String(r.latestAt).includes('Z') ? '' : 'Z')).toISOString() : ''),
            unreadCount: Number(r.unreadCount ?? 0),
          }));
        } finally { await conn.end(); }
      }),

    /** Get full message thread for a specific customer */
    getThread: publicProcedure
      .input(z.object({ customerId: z.string() }))
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const { portalMessages } = await import("../drizzle/schema");
        const { eq, asc } = await import("drizzle-orm");
        const rows = await drizzleDb
          .select()
          .from(portalMessages)
          .where(eq(portalMessages.customerId, input.customerId))
          .orderBy(asc(portalMessages.createdAt));
        // Mark inbound messages as read
        await drizzleDb
          .update(portalMessages)
          .set({ isRead: 1 })
          .where(eq(portalMessages.customerId, input.customerId));
        return rows.map((r: any) => ({
          id: r.id,
          direction: r.direction as 'inbound' | 'outbound',
          body: r.body,
          imageUrl: r.imageUrl ?? null,
          sentByName: r.sentByName ?? null,
          isRead: r.isRead === 1,
          createdAt: r.createdAt instanceof Date ? r.createdAt.toISOString() : String(r.createdAt),
        }));
      }),

    /** Admin replies to a customer portal message */
    reply: publicProcedure
      .input(z.object({
        customerId: z.string(),
        body: z.string().min(1).max(2000),
        imageUrl: z.string().optional(),
        employeeId: z.string().optional(),
        employeeName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error('DB unavailable');
        const { portalMessages, customers: custTable } = await import("../drizzle/schema");
        const { eq } = await import('drizzle-orm');
        await drizzleDb.insert(portalMessages).values({
          customerId: input.customerId,
          direction: 'outbound',
          body: input.body.trim(),
          imageUrl: input.imageUrl ?? null,
          sentByEmployeeId: input.employeeId ?? null,
          sentByName: input.employeeName ?? 'Team',
          isRead: 0, // Customer hasn't read it yet — badge will show until they open messages
        });
        // Push notification to the customer
        try {
          const custRows = await drizzleDb.select({ pushToken: custTable.pushToken }).from(custTable).where(eq(custTable.customerId, input.customerId)).limit(1);
          const token = custRows[0]?.pushToken;
          if (token && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))) {
            await fetch('https://exp.host/--/api/v2/push/send', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                to: token,
                title: '💬 Luxury Wash On Wheels',
                body: `${input.employeeName ?? 'Team'}: ${input.body.trim().slice(0, 100)}`,
                sound: 'default',
                data: { screen: 'messages' },
              }),
            });
          }
        } catch (e) {
          console.error('[push] portal reply push failed:', e);
        }
        return { success: true as const };
      }),

    /** Get total unread portal message count for admin badge */
    unreadCount: publicProcedure
      .query(async () => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return { count: 0 };
        const { portalMessages } = await import("../drizzle/schema");
        const { sql } = await import("drizzle-orm");
        const result = await drizzleDb
          .select({ count: sql<number>`COUNT(*)` })
          .from(portalMessages)
          .where(sql`${portalMessages.isRead} = 0 AND ${portalMessages.direction} = 'inbound'`);
        return { count: Number(result[0]?.count ?? 0) };
      }),

    /** Portal analytics: registered users, bookings, revenue, recent signups */
    getStats: publicProcedure
      .query(async () => {
        const conn = await db.getConnection();
        try {
          // Registered portal users
          const [userRows] = await conn.execute(`
            SELECT COUNT(*) AS totalUsers,
              SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 ELSE 0 END) AS newLast30Days,
              SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 ELSE 0 END) AS newLast7Days
            FROM customers
          `) as [any[], any];
          const users = userRows[0] ?? {};

          // Portal bookings & revenue
          const [bookingRows] = await conn.execute(`
            SELECT
              COUNT(*) AS totalBookings,
              SUM(CASE WHEN status != 'cancelled' THEN 1 ELSE 0 END) AS activeBookings,
              SUM(CASE WHEN status = 'completed' THEN 1 ELSE 0 END) AS completedBookings,
              SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) AS cancelledBookings,
              SUM(CASE WHEN status != 'cancelled' THEN COALESCE(total, 0) ELSE 0 END) AS totalRevenue,
              SUM(CASE WHEN status = 'completed' THEN COALESCE(payment_total, total, 0) ELSE 0 END) AS collectedRevenue,
              SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND status != 'cancelled' THEN 1 ELSE 0 END) AS bookingsLast30Days,
              SUM(CASE WHEN created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) AND status != 'cancelled' THEN COALESCE(total, 0) ELSE 0 END) AS revenueLast30Days
            FROM customer_bookings
          `) as [any[], any];
          const bookings = bookingRows[0] ?? {};

          // Recent signups (last 10)
          const [recentRows] = await conn.execute(`
            SELECT first_name, last_name, email, city, created_at
            FROM customers
            ORDER BY created_at DESC
            LIMIT 10
          `) as [any[], any];

          // Top cities by booking count
          const [cityRows] = await conn.execute(`
            SELECT city, COUNT(*) AS bookingCount, SUM(COALESCE(total, 0)) AS revenue
            FROM customer_bookings
            WHERE status != 'cancelled' AND city IS NOT NULL AND city != ''
            GROUP BY city
            ORDER BY bookingCount DESC
            LIMIT 5
          `) as [any[], any];

          return {
            registeredUsers: Number(users.totalUsers ?? 0),
            newUsersLast30Days: Number(users.newLast30Days ?? 0),
            newUsersLast7Days: Number(users.newLast7Days ?? 0),
            totalBookings: Number(bookings.totalBookings ?? 0),
            activeBookings: Number(bookings.activeBookings ?? 0),
            completedBookings: Number(bookings.completedBookings ?? 0),
            cancelledBookings: Number(bookings.cancelledBookings ?? 0),
            totalRevenue: parseFloat(bookings.totalRevenue ?? '0'),
            collectedRevenue: parseFloat(bookings.collectedRevenue ?? '0'),
            bookingsLast30Days: Number(bookings.bookingsLast30Days ?? 0),
            revenueLast30Days: parseFloat(bookings.revenueLast30Days ?? '0'),
            recentSignups: (recentRows as any[]).map((r: any) => ({
              name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim(),
              email: r.email ?? '',
              city: r.city ?? '',
              joinedAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
            })),
            topCities: (cityRows as any[]).map((r: any) => ({
              city: r.city,
              bookingCount: Number(r.bookingCount),
              revenue: parseFloat(r.revenue ?? '0'),
            })),
          };
        } finally { await conn.end(); }
      }),
  }),

  scheduleBlockers: router({
    /** List blockers for a city and date range */
    list: publicProcedure
      .input(z.object({ city: z.string(), startDate: z.string(), endDate: z.string() }))
      .query(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) return [];
        const { scheduleBlockers } = await import('../drizzle/schema');
        const { and, gte, lte, or } = await import('drizzle-orm');
        // Normalize city slug → full label
        const CITY_SLUG_TO_LABEL: Record<string, string> = {
          fwb: 'Fort Walton Beach',
          crestview: 'Crestview',
          niceville: 'Niceville',
          destin: 'Destin',
          pensacola: 'Pensacola',
        };
        const normalizedCity = CITY_SLUG_TO_LABEL[input.city.toLowerCase()] ?? input.city;
        return drizzleDb
          .select()
          .from(scheduleBlockers)
          .where(and(
            or(eq(scheduleBlockers.city, normalizedCity), eq(scheduleBlockers.city, input.city)),
            gte(scheduleBlockers.date, input.startDate),
            lte(scheduleBlockers.date, input.endDate),
          ));
      }),

    /** Create a new blocker */
    create: publicProcedure
      .input(z.object({
        id: z.string(),
        detailerName: z.string(),
        city: z.string(),
        date: z.string(),
        startHour: z.number().default(8),
        endHour: z.number().default(17),
        allDay: z.boolean().default(true),
        reason: z.string().default('Day Off'),
        createdBy: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error('DB unavailable');
        const { scheduleBlockers } = await import('../drizzle/schema');
        // Normalize city slug → full label so it matches the booking website's city values
        const CITY_SLUG_TO_LABEL: Record<string, string> = {
          fwb: 'Fort Walton Beach',
          crestview: 'Crestview',
          niceville: 'Niceville',
          destin: 'Destin',
          pensacola: 'Pensacola',
        };
        const normalizedCity = CITY_SLUG_TO_LABEL[input.city.toLowerCase()] ?? input.city;
        // Resolve first-name-only detailerName to full name from employees table
        const { employees } = await import('../drizzle/schema');
        const empRows = await drizzleDb.select({ fullName: employees.fullName })
          .from(employees)
          .where(sql`LOWER(${employees.city}) = LOWER(${normalizedCity}) AND (${employees.fullName} = ${input.detailerName} OR SUBSTRING_INDEX(${employees.fullName}, ' ', 1) = ${input.detailerName})`)
          .limit(1);
        const resolvedName = empRows[0]?.fullName ?? input.detailerName;
        // Ensure date is stored as plain YYYY-MM-DD string (strip any time component)
        const plainDate = input.date.substring(0, 10);
        await drizzleDb.insert(scheduleBlockers).values({
          id: input.id,
          detailerName: resolvedName,
          city: normalizedCity,
          date: plainDate,
          startHour: String(input.startHour),
          endHour: String(input.endHour),
          allDay: input.allDay ? 1 : 0,
          reason: input.reason,
          createdBy: input.createdBy ?? null,
        });
        return { success: true };
      }),

    /** Delete a blocker */
    delete: publicProcedure
      .input(z.object({ id: z.string() }))
      .mutation(async ({ input }) => {
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error('DB unavailable');
        const { scheduleBlockers } = await import('../drizzle/schema');
        await drizzleDb.delete(scheduleBlockers).where(eq(scheduleBlockers.id, input.id));
        return { success: true };
      }),
  }),

  standaloneInvoices: router({
    list: publicProcedure
      .input(z.object({ search: z.string().optional() }))
      .query(async ({ input }) => db.getAllStandaloneInvoices(input.search)),

    getById: publicProcedure
      .input(z.object({ invoiceId: z.string() }))
      .query(async ({ input }) => db.getStandaloneInvoiceById(input.invoiceId)),

    create: publicProcedure
      .input(z.object({
        customerName: z.string(),
        customerEmail: z.string().optional(),
        customerPhone: z.string().optional(),
        notes: z.string().optional(),
        taxRate: z.number().optional(),
        discountAmount: z.number().optional(),
        dueDate: z.string().optional(),
        createdBy: z.string().optional(),
        lineItems: z.array(z.object({
          description: z.string(),
          quantity: z.number(),
          unitPrice: z.number(),
        })),
      }))
      .mutation(async ({ input }) => db.createStandaloneInvoice(input)),

    updateStatus: publicProcedure
      .input(z.object({
        invoiceId: z.string(),
        status: z.enum(['draft', 'sent', 'paid', 'partial', 'void']),
        amountPaid: z.number().optional(),
        paymentMethod: z.string().optional(),
        paymentNote: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const extra: any = {};
        if (input.status === 'sent') extra.sentAt = new Date();
        if (input.status === 'paid' || input.status === 'partial') extra.paidAt = new Date();
        if (input.amountPaid != null) extra.amountPaid = input.amountPaid;
        if (input.paymentMethod) extra.paymentMethod = input.paymentMethod;
        if (input.paymentNote) extra.paymentNote = input.paymentNote;
        await db.updateStandaloneInvoiceStatus(input.invoiceId, input.status, extra);
        return { success: true };
      }),

    send: publicProcedure
      .input(z.object({
        invoiceId: z.string(),
        method: z.enum(['email', 'sms']),
        overrideEmail: z.string().optional(),
        overridePhone: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const inv = await db.getStandaloneInvoiceById(input.invoiceId);
        if (!inv) throw new Error('Invoice not found');
        if (inv.status === 'paid') throw new Error('Invoice already paid');

        // Generate or reuse token
        const drizzleDb = await db.getDb();
        if (!drizzleDb) throw new Error('DB unavailable');
        const crypto = await import('crypto');
        let token = (inv as any).paymentToken as string | undefined;
        if (!token) {
          token = crypto.randomBytes(32).toString('hex');
          const { standaloneInvoices: siTable } = await import('../drizzle/schema');
          await drizzleDb.update(siTable).set({ paymentToken: token } as any).where(eq(siTable.invoiceId, input.invoiceId));
        }

        const publicUrl = process.env.PUBLIC_URL ?? 'https://www.luxurywashonwheels.app';
        const paymentUrl = `${publicUrl}/api/invoice/standalone/${token}`;
        const totalDue = parseFloat(inv.totalAmount as any) - parseFloat(inv.amountPaid as any ?? '0');
        const firstName = inv.customerName.split(' ')[0] ?? 'Customer';
        const businessName = 'Luxury Wash On Wheels';

        // Build line items summary for email
        const linesSummary = inv.lineItems.map(li =>
          `<tr><td style="color:#888;font-size:13px;padding:4px 0">${li.description}</td><td style="color:#111;font-size:13px;text-align:right">$${parseFloat(li.lineTotal as any).toFixed(2)}</td></tr>`
        ).join('');

        if (input.method === 'email') {
          const email = (input.overrideEmail?.trim()) || inv.customerEmail;
          if (!email) throw new Error('No email address available');
          const subject = `Your Invoice from ${businessName} — $${totalDue.toFixed(2)} Due`;
          const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)"><div style="background:#0a7ea4;padding:28px 32px;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">🚗 ${businessName}</h1><p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px">Invoice ${inv.invoiceNumber}</p></div><div style="padding:28px 32px"><p style="color:#333;font-size:16px;margin:0 0 20px">Hi ${firstName},</p><p style="color:#555;font-size:15px;margin:0 0 24px;line-height:1.5">Your invoice is ready. Please review the details below and click <strong>Pay Now</strong> to complete your payment.</p><div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px"><table style="width:100%;border-collapse:collapse">${linesSummary}<tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:12px"></td></tr><tr><td style="color:#111;font-size:16px;font-weight:700;padding:4px 0">Amount Due</td><td style="color:#0a7ea4;font-size:20px;font-weight:800;text-align:right">$${totalDue.toFixed(2)}</td></tr></table></div><div style="text-align:center;margin-bottom:24px"><a href="${paymentUrl}" style="display:inline-block;background:#0a7ea4;color:#fff;text-decoration:none;padding:14px 40px;border-radius:50px;font-size:16px;font-weight:700">💳 Pay Now — $${totalDue.toFixed(2)}</a></div><p style="color:#888;font-size:12px;text-align:center;margin:0">Questions? Call us at 850-517-7874.</p></div><div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center"><p style="color:#aaa;font-size:12px;margin:0">${businessName} · Serving NW Florida</p></div></div></body></html>`;
          const { sendEmail } = await import('./email');
          await sendEmail({ to: email, subject, html, type: 'other', customerName: inv.customerName });
        } else {
          const phone = (input.overridePhone?.trim()) || inv.customerPhone;
          if (!phone) throw new Error('No phone number available');
          const smsBody = `Hi ${firstName}! Your invoice #${inv.invoiceNumber} from ${businessName} is ready — $${totalDue.toFixed(2)} due. Pay here: ${paymentUrl}`;
          // Use Twilio if configured
          const accountSid = process.env.TWILIO_ACCOUNT_SID;
          const authToken = process.env.TWILIO_AUTH_TOKEN;
          const fromNumber = process.env.TWILIO_PHONE_NUMBER;
          if (accountSid && authToken && fromNumber) {
            const toNumber = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
            const params = new URLSearchParams({ To: toNumber, From: fromNumber, Body: smsBody });
            await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded', Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}` },
              body: params.toString(),
            });
          }
        }

        await db.updateStandaloneInvoiceStatus(input.invoiceId, 'sent', { sentAt: new Date() });
        return { success: true, paymentUrl };
      }),

    delete: publicProcedure
      .input(z.object({ invoiceId: z.string() }))
      .mutation(async ({ input }) => {
        await db.deleteStandaloneInvoice(input.invoiceId);
        return { success: true };
      }),

    /** Send a payment receipt email to the customer for a paid/partial invoice */
    sendReceipt: publicProcedure
      .input(z.object({ invoiceId: z.string() }))
      .mutation(async ({ input }) => {
        const inv = await db.getStandaloneInvoiceById(input.invoiceId);
        if (!inv) throw new Error('Invoice not found');
        const email = inv.customerEmail;
        if (!email) throw new Error('No customer email on file for this invoice');

        const businessName = 'Luxury Wash On Wheels';
        const firstName = inv.customerName.split(' ')[0] ?? 'Customer';
        const totalAmount = parseFloat(inv.totalAmount as any);
        const amountPaid = parseFloat(inv.amountPaid as any ?? '0');
        const balanceDue = Math.max(0, totalAmount - amountPaid);
        const isPaidInFull = balanceDue === 0;

        const linesSummary = inv.lineItems.map((li: any) =>
          `<tr><td style="color:#888;font-size:13px;padding:4px 0">${li.description}</td><td style="color:#111;font-size:13px;text-align:right">$${parseFloat(li.lineTotal).toFixed(2)}</td></tr>`
        ).join('');

        const subject = isPaidInFull
          ? `✅ Payment Receipt — ${businessName} Invoice ${inv.invoiceNumber}`
          : `🧾 Partial Payment Receipt — ${businessName} Invoice ${inv.invoiceNumber}`;

        const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;margin:0;padding:20px"><div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,.08)"><div style="background:#16a34a;padding:28px 32px;text-align:center"><h1 style="color:#fff;margin:0;font-size:22px;font-weight:700">✅ Payment ${isPaidInFull ? 'Received' : 'Partial'}</h1><p style="color:rgba(255,255,255,.85);margin:6px 0 0;font-size:14px">${businessName} · Invoice ${inv.invoiceNumber}</p></div><div style="padding:28px 32px"><p style="color:#333;font-size:16px;margin:0 0 20px">Hi ${firstName},</p><p style="color:#555;font-size:15px;margin:0 0 24px;line-height:1.5">Thank you for your payment! Here is your receipt.</p><div style="background:#f9fafb;border:1px solid #e5e7eb;border-radius:10px;padding:20px;margin-bottom:24px"><table style="width:100%;border-collapse:collapse">${linesSummary}<tr><td colspan="2" style="border-top:1px solid #e5e7eb;padding-top:12px"></td></tr><tr><td style="color:#888;font-size:14px;padding:4px 0">Invoice Total</td><td style="color:#111;font-size:14px;text-align:right">$${totalAmount.toFixed(2)}</td></tr><tr><td style="color:#16a34a;font-size:16px;font-weight:700;padding:4px 0">Amount Paid</td><td style="color:#16a34a;font-size:18px;font-weight:800;text-align:right">$${amountPaid.toFixed(2)}</td></tr>${balanceDue > 0 ? `<tr><td style="color:#ef4444;font-size:14px;padding:4px 0">Balance Due</td><td style="color:#ef4444;font-size:14px;font-weight:700;text-align:right">$${balanceDue.toFixed(2)}</td></tr>` : ''}</table></div><p style="color:#888;font-size:12px;text-align:center;margin:0">Questions? Call us at 850-517-7874.</p></div><div style="background:#f9fafb;border-top:1px solid #e5e7eb;padding:16px 32px;text-align:center"><p style="color:#aaa;font-size:12px;margin:0">${businessName} · Serving NW Florida</p></div></div></body></html>`;

        const { sendEmail } = await import('./email.js');
        await sendEmail({ to: email, subject, html, type: 'other', urgent: true, customerName: inv.customerName });
        return { success: true };
      }),
  }),

  // ── payments router (alias for customer booking deposit flow) ──
  payments: router({
    createPaymentIntent: publicProcedure
      .input(z.object({
        amountCents: z.number().int().positive(),
        currency: z.string().default("usd"),
        description: z.string().optional(),
        captureMethod: z.enum(["automatic", "manual"]).default("automatic"),
        paymentMethodTypes: z.array(z.string()).optional(),
      }))
      .mutation(async ({ input }) => {
        const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
        if (!stripeKey) {
          return { clientSecret: "pi_test_demo_secret_for_ui_testing", demo: true };
        }
        const stripe = new Stripe(stripeKey, { apiVersion: "2025-03-31.basil" });
        const createParams: any = {
          amount: input.amountCents,
          currency: input.currency,
          description: input.description,
          capture_method: input.captureMethod,
        };
        if (input.paymentMethodTypes && input.paymentMethodTypes.length > 0) {
          createParams.payment_method_types = input.paymentMethodTypes;
        } else {
          createParams.automatic_payment_methods = { enabled: true };
        }
        const paymentIntent = await stripe.paymentIntents.create(createParams);
        return { clientSecret: paymentIntent.client_secret!, paymentIntentId: paymentIntent.id, demo: false };
      }),
  }),

  // ─── In-App Messaging ────────────────────────────────────────────────────────
  // DoorDash-style chat between customer and detailer.
  // Active when detailer status is 'on_the_way' or 'in_progress',
  // and stays open for 3 hours after job completion.
  messaging: router({
    // Send a message (customer or detailer)
    send: publicProcedure
      .input(z.object({
        bookingRef: z.string(),
        senderType: z.enum(['customer', 'detailer']),
        senderId: z.string(),
        senderName: z.string().optional(),
        message: z.string().min(1).max(1000),
      }))
      .mutation(async ({ input }) => {
        const { jobMessages, customerBookings, employees } = await import('../drizzle/schema');
        const { eq, or, like } = await import('drizzle-orm');
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB unavailable');

        // Verify messaging window is open
        const bkRows = await dbConn.select().from(customerBookings)
          .where(eq(customerBookings.bookingRef, input.bookingRef)).limit(1);
        const bk = bkRows[0];
        if (!bk) throw new Error('Booking not found');

        const status = (bk.status ?? '').toLowerCase();
        const completedAt = (bk as any).completedAt as Date | null | undefined;
        const now = new Date();
        const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

        const isActive =
          status === 'on_the_way' ||
          status === 'in_progress' ||
          (status === 'completed' && completedAt && completedAt > threeHoursAgo);

        if (!isActive) {
          throw new Error('Messaging window is not open for this booking');
        }

        // Insert message
        await dbConn.insert(jobMessages).values({
          bookingRef: input.bookingRef,
          senderType: input.senderType,
          senderId: input.senderId,
          senderName: input.senderName ?? null,
          message: input.message,
        });

        // Send push notification to the other party
        try {
          if (input.senderType === 'customer') {
            // Notify detailer
            if (bk.assignedEmployeeId) {
              const empRows = await dbConn.select({ pushToken: employees.pushToken })
                .from(employees)
                .where(or(
                  eq(employees.employeeId, bk.assignedEmployeeId),
                  like(employees.fullName, `%${bk.assignedEmployeeId}%`)
                )).limit(2);
              const token = empRows[0]?.pushToken;
              if (token && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))) {
                await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify([{
                    to: token,
                    title: `💬 ${input.senderName ?? 'Customer'}`,
                    body: input.message.length > 80 ? input.message.slice(0, 77) + '...' : input.message,
                    sound: 'default',
                    data: { type: 'message', bookingRef: input.bookingRef },
                  }]),
                });
              }
            }
          } else {
            // Notify customer — look up their push token via customerId
            const custId = bk.customerId ?? '';
            const custRows = await dbConn.execute(
              sql`SELECT push_token FROM customers WHERE id = ${custId} OR customer_id = ${custId} LIMIT 1`
            ) as any;
            const custToken = (custRows?.rows ?? custRows)?.[0]?.push_token;
            if (custToken && (custToken.startsWith('ExponentPushToken[') || custToken.startsWith('ExpoPushToken['))) {
              await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify([{
                  to: custToken,
                  title: `💬 ${input.senderName ?? 'Your Detailer'}`,
                  body: input.message.length > 80 ? input.message.slice(0, 77) + '...' : input.message,
                  sound: 'default',
                  data: { type: 'message', bookingRef: input.bookingRef },
                }]),
              });
            }
          }
        } catch (pushErr) {
          console.error('[messaging.send] push notification failed (non-blocking):', pushErr);
        }

        return { success: true };
      }),

    // List messages for a booking
    list: publicProcedure
      .input(z.object({
        bookingRef: z.string(),
        limit: z.number().min(1).max(100).default(50),
      }))
      .query(async ({ input }) => {
        const { jobMessages } = await import('../drizzle/schema');
        const { eq, desc } = await import('drizzle-orm');
        const dbConn = await db.getDb();
        if (!dbConn) return { messages: [], windowOpen: false };

        const messages = await dbConn.select().from(jobMessages)
          .where(eq(jobMessages.bookingRef, input.bookingRef))
          .orderBy(desc(jobMessages.createdAt))
          .limit(input.limit);

        // Check if messaging window is open
        const { customerBookings } = await import('../drizzle/schema');
        const bkRows = await dbConn.select().from(customerBookings)
          .where(eq(customerBookings.bookingRef, input.bookingRef)).limit(1);
        const bk = bkRows[0];
        const status = (bk?.status ?? '').toLowerCase();
        const completedAt = (bk as any)?.completedAt as Date | null | undefined;
        const now = new Date();
        const threeHoursAgo = new Date(now.getTime() - 3 * 60 * 60 * 1000);

        const windowOpen =
          status === 'on_the_way' ||
          status === 'on_my_way' ||
          status === 'en_route' ||
          status === 'in_progress' ||
          status === 'arrived' ||
          status === 'started' ||
          (status === 'completed' && completedAt && completedAt > threeHoursAgo);

        return {
          messages: messages.reverse(),
          windowOpen: !!windowOpen,
        };
      }),

    // Mark messages as read for a party
    markRead: publicProcedure
      .input(z.object({
        bookingRef: z.string(),
        readerType: z.enum(['customer', 'detailer']),
      }))
      .mutation(async ({ input }) => {
        const { jobMessages } = await import('../drizzle/schema');
        const { eq, and, isNull, ne } = await import('drizzle-orm');
        const dbConn = await db.getDb();
        if (!dbConn) return { success: false };

        // Mark all unread messages from the OTHER party as read
        const senderType = input.readerType === 'customer' ? 'detailer' : 'customer';
        await dbConn.update(jobMessages)
          .set({ readAt: new Date() })
          .where(and(
            eq(jobMessages.bookingRef, input.bookingRef),
            eq(jobMessages.senderType, senderType),
            isNull(jobMessages.readAt)
          ));

        return { success: true };
      }),

    // Get unread count for a booking (from the other party's perspective)
    unreadCount: publicProcedure
      .input(z.object({
        bookingRef: z.string(),
        readerType: z.enum(['customer', 'detailer']),
      }))
      .query(async ({ input }) => {
        const { jobMessages } = await import('../drizzle/schema');
        const { eq, and, isNull } = await import('drizzle-orm');
        const dbConn = await db.getDb();
        if (!dbConn) return { count: 0 };

        const senderType = input.readerType === 'customer' ? 'detailer' : 'customer';
        const rows = await dbConn.select({ id: jobMessages.id }).from(jobMessages)
          .where(and(
            eq(jobMessages.bookingRef, input.bookingRef),
            eq(jobMessages.senderType, senderType),
            isNull(jobMessages.readAt)
          ));

        return { count: rows.length };
      }),
  }),

  packages: router({
    /** Get all package image URLs — fetched at runtime so images can be changed without a rebuild */
    getImages: publicProcedure.query(async () => {
      const dbConn = await db.getDb();
      if (!dbConn) return {};
      const { packageImages } = await import('../drizzle/schema');
      const rows = await dbConn.select().from(packageImages);
      const map: Record<string, string> = {};
      for (const row of rows) map[row.packageId] = row.imageUrl;
      return map;
    }),

    /** Admin: update the image URL for a package */
    updateImage: publicProcedure
      .input(z.object({
        packageId: z.string().min(1),
        imageUrl: z.string().url(),
      }))
      .mutation(async ({ input }) => {
        const dbConn = await db.getDb();
        if (!dbConn) throw new Error('DB unavailable');
        const { packageImages } = await import('../drizzle/schema');
        const { eq } = await import('drizzle-orm');
        const existing = await dbConn.select({ id: packageImages.id }).from(packageImages)
          .where(eq(packageImages.packageId, input.packageId));
        if (existing.length > 0) {
          await dbConn.update(packageImages)
            .set({ imageUrl: input.imageUrl })
            .where(eq(packageImages.packageId, input.packageId));
        } else {
          await dbConn.insert(packageImages).values({ packageId: input.packageId, imageUrl: input.imageUrl });
        }
        return { success: true, packageId: input.packageId, imageUrl: input.imageUrl };
      }),

    /** Admin: upload a photo from device (base64) to S3 and update the package image */
    uploadImage: publicProcedure
      .input(z.object({
        packageId: z.string().min(1),
        base64: z.string(),
        mimeType: z.string().default('image/jpeg'),
      }))
      .mutation(async ({ input }) => {
        const buffer = Buffer.from(input.base64, 'base64');
        const ext = input.mimeType === 'image/png' ? 'png' : 'webp';
        const key = `package-images/${input.packageId}-${Date.now()}.${ext}`;
        const { url } = await storagePut(key, buffer, input.mimeType);
        // Persist the new URL in the package_images table
        const dbConn = await db.getDb();
        if (dbConn) {
          const { packageImages } = await import('../drizzle/schema');
          const { eq } = await import('drizzle-orm');
          const existing = await dbConn.select({ id: packageImages.id }).from(packageImages)
            .where(eq(packageImages.packageId, input.packageId));
          if (existing.length > 0) {
            await dbConn.update(packageImages).set({ imageUrl: url }).where(eq(packageImages.packageId, input.packageId));
          } else {
            await dbConn.insert(packageImages).values({ packageId: input.packageId, imageUrl: url });
          }
        }
        return { success: true, packageId: input.packageId, url };
      }),
  }),

  // ─── Customer Activity Tracking ─────────────────────────────────────────────
  customerActivity: router({
    /** Called when customer opens the app — creates a new session record */
    startSession: publicProcedure
      .input(z.object({
        customerId: z.string(),
        source: z.enum(["portal_app", "website"]).default("portal_app"),
        devicePlatform: z.string().optional(),
        appVersion: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          const sessionId = `act_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
          await conn.execute(
            `INSERT INTO customer_activity_sessions (session_id, customer_id, source, device_platform, app_version) VALUES (?, ?, ?, ?, ?)`,
            [sessionId, input.customerId, input.source, input.devicePlatform ?? null, input.appVersion ?? null]
          );
          return { sessionId };
        } finally { await conn.end(); }
      }),

    /** Called when customer leaves the app — updates session with duration */
    endSession: publicProcedure
      .input(z.object({
        sessionId: z.string(),
        durationSeconds: z.number().int().min(0),
        lastScreen: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          await conn.execute(
            `UPDATE customer_activity_sessions SET ended_at = NOW(), duration_seconds = ?, last_screen = ? WHERE session_id = ?`,
            [input.durationSeconds, input.lastScreen ?? null, input.sessionId]
          );
          return { success: true };
        } finally { await conn.end(); }
      }),

    /** Admin: get activity stats for all customers */
    getActivityStats: publicProcedure
      .query(async () => {
        const conn = await db.getConnection();
        try {
          // Overall stats
          const [overallRows] = await conn.execute(`
            SELECT
              COUNT(DISTINCT customer_id) AS activeUsers,
              COUNT(*) AS totalSessions,
              AVG(duration_seconds) AS avgSessionSeconds,
              SUM(duration_seconds) AS totalSessionSeconds,
              COUNT(DISTINCT CASE WHEN started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN customer_id END) AS activeUsersLast7Days,
              COUNT(DISTINCT CASE WHEN started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN customer_id END) AS activeUsersLast30Days,
              COUNT(CASE WHEN started_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) AS sessionsLast7Days,
              COUNT(CASE WHEN started_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) AS sessionsLast30Days
            FROM customer_activity_sessions
          `) as [any[], any];
          const overall = overallRows[0] ?? {};

          // Per-customer stats (top 20 most active)
          const [customerRows] = await conn.execute(`
            SELECT
              cas.customer_id,
              c.first_name, c.last_name, c.email,
              COUNT(*) AS sessionCount,
              SUM(cas.duration_seconds) AS totalSeconds,
              AVG(cas.duration_seconds) AS avgSeconds,
              MAX(cas.started_at) AS lastSeenAt,
              MIN(cas.started_at) AS firstSeenAt,
              DATEDIFF(NOW(), c.created_at) AS daysSinceSignup
            FROM customer_activity_sessions cas
            LEFT JOIN customers c ON c.customer_id = cas.customer_id
            GROUP BY cas.customer_id, c.first_name, c.last_name, c.email
            ORDER BY lastSeenAt DESC
            LIMIT 20
          `) as [any[], any];

          // Platform breakdown
          const [platformRows] = await conn.execute(`
            SELECT device_platform, COUNT(*) AS sessionCount
            FROM customer_activity_sessions
            WHERE device_platform IS NOT NULL
            GROUP BY device_platform
            ORDER BY sessionCount DESC
          `) as [any[], any];

          return {
            activeUsers: Number(overall.activeUsers ?? 0),
            totalSessions: Number(overall.totalSessions ?? 0),
            avgSessionMinutes: overall.avgSessionSeconds ? +(Number(overall.avgSessionSeconds) / 60).toFixed(1) : 0,
            totalSessionHours: overall.totalSessionSeconds ? +(Number(overall.totalSessionSeconds) / 3600).toFixed(1) : 0,
            activeUsersLast7Days: Number(overall.activeUsersLast7Days ?? 0),
            activeUsersLast30Days: Number(overall.activeUsersLast30Days ?? 0),
            sessionsLast7Days: Number(overall.sessionsLast7Days ?? 0),
            sessionsLast30Days: Number(overall.sessionsLast30Days ?? 0),
            topCustomers: (customerRows as any[]).map((r: any) => ({
              customerId: r.customer_id,
              name: `${r.first_name ?? ''} ${r.last_name ?? ''}`.trim() || r.email,
              email: r.email ?? '',
              sessionCount: Number(r.sessionCount),
              totalMinutes: r.totalSeconds ? +(Number(r.totalSeconds) / 60).toFixed(1) : 0,
              avgMinutes: r.avgSeconds ? +(Number(r.avgSeconds) / 60).toFixed(1) : 0,
              lastSeenAt: r.lastSeenAt instanceof Date ? r.lastSeenAt.toISOString() : String(r.lastSeenAt ?? ''),
              daysSinceSignup: Number(r.daysSinceSignup ?? 0),
            })),
            platforms: (platformRows as any[]).map((r: any) => ({
              platform: r.device_platform,
              sessionCount: Number(r.sessionCount),
            })),
          };
        } finally { await conn.end(); }
      }),
  }),

  // ─── Abandoned Cart Tracking ─────────────────────────────────────────────────
  abandonedCarts: router({
    /** Record or update a cart — called when customer starts checkout */
    upsert: publicProcedure
      .input(z.object({
        cartId: z.string(),
        customerId: z.string().optional(),
        source: z.enum(["portal_app", "website"]),
        packageId: z.string().optional(),
        packageName: z.string().optional(),
        vehicleType: z.string().optional(),
        selectedDate: z.string().optional(),
        estimatedTotal: z.number().optional(),
        stepReached: z.string().optional(),
        city: z.string().optional(),
        customerEmail: z.string().optional(),
        customerName: z.string().optional(),
      }))
      .mutation(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          await conn.execute(
            `INSERT INTO abandoned_carts (cart_id, customer_id, source, package_id, package_name, vehicle_type, selected_date, estimated_total, step_reached, city, customer_email, customer_name)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON DUPLICATE KEY UPDATE
               step_reached = VALUES(step_reached),
               selected_date = VALUES(selected_date),
               estimated_total = VALUES(estimated_total),
               updated_at = NOW()`,
            [
              input.cartId, input.customerId ?? null, input.source,
              input.packageId ?? null, input.packageName ?? null, input.vehicleType ?? null,
              input.selectedDate ?? null, input.estimatedTotal ?? null, input.stepReached ?? null,
              input.city ?? null, input.customerEmail ?? null, input.customerName ?? null,
            ]
          );
          return { success: true };
        } finally { await conn.end(); }
      }),

    /** Mark a cart as completed (booking was made) */
    complete: publicProcedure
      .input(z.object({ cartId: z.string() }))
      .mutation(async ({ input }) => {
        const conn = await db.getConnection();
        try {
          await conn.execute(
            `UPDATE abandoned_carts SET completed_at = NOW() WHERE cart_id = ?`,
            [input.cartId]
          );
          return { success: true };
        } finally { await conn.end(); }
      }),

    /** Admin: get abandoned cart analytics */
    getStats: publicProcedure
      .query(async () => {
        const conn = await db.getConnection();
        try {
          // Overall funnel
          const [overallRows] = await conn.execute(`
            SELECT
              source,
              COUNT(*) AS total,
              SUM(CASE WHEN completed_at IS NULL THEN 1 ELSE 0 END) AS abandoned,
              SUM(CASE WHEN completed_at IS NOT NULL THEN 1 ELSE 0 END) AS completed,
              AVG(CASE WHEN completed_at IS NULL THEN estimated_total END) AS avgAbandonedValue,
              SUM(CASE WHEN completed_at IS NULL THEN estimated_total ELSE 0 END) AS totalAbandonedValue,
              COUNT(CASE WHEN completed_at IS NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 7 DAY) THEN 1 END) AS abandonedLast7Days,
              COUNT(CASE WHEN completed_at IS NULL AND created_at >= DATE_SUB(NOW(), INTERVAL 30 DAY) THEN 1 END) AS abandonedLast30Days
            FROM abandoned_carts
            GROUP BY source
          `) as [any[], any];

          // Step breakdown (where do people drop off?)
          const [stepRows] = await conn.execute(`
            SELECT step_reached, source, COUNT(*) AS count
            FROM abandoned_carts
            WHERE completed_at IS NULL AND step_reached IS NOT NULL
            GROUP BY step_reached, source
            ORDER BY count DESC
          `) as [any[], any];

          // Package breakdown
          const [packageRows] = await conn.execute(`
            SELECT package_name, source, COUNT(*) AS count
            FROM abandoned_carts
            WHERE completed_at IS NULL AND package_name IS NOT NULL
            GROUP BY package_name, source
            ORDER BY count DESC
            LIMIT 10
          `) as [any[], any];

          // Recent abandoned carts (last 20)
          const [recentRows] = await conn.execute(`
            SELECT cart_id, customer_name, customer_email, source, package_name, step_reached, estimated_total, city, created_at
            FROM abandoned_carts
            WHERE completed_at IS NULL
            ORDER BY created_at DESC
            LIMIT 20
          `) as [any[], any];

          return {
            bySource: (overallRows as any[]).map((r: any) => ({
              source: r.source as string,
              total: Number(r.total),
              abandoned: Number(r.abandoned),
              completed: Number(r.completed),
              conversionRate: r.total > 0 ? +((Number(r.completed) / Number(r.total)) * 100).toFixed(1) : 0,
              avgAbandonedValue: parseFloat(r.avgAbandonedValue ?? '0'),
              totalAbandonedValue: parseFloat(r.totalAbandonedValue ?? '0'),
              abandonedLast7Days: Number(r.abandonedLast7Days),
              abandonedLast30Days: Number(r.abandonedLast30Days),
            })),
            dropOffByStep: (stepRows as any[]).map((r: any) => ({
              step: r.step_reached as string,
              source: r.source as string,
              count: Number(r.count),
            })),
            abandonedByPackage: (packageRows as any[]).map((r: any) => ({
              packageName: r.package_name as string,
              source: r.source as string,
              count: Number(r.count),
            })),
            recentAbandoned: (recentRows as any[]).map((r: any) => ({
              cartId: r.cart_id,
              customerName: r.customer_name ?? 'Anonymous',
              customerEmail: r.customer_email ?? '',
              source: r.source as string,
              packageName: r.package_name ?? '',
              stepReached: r.step_reached ?? '',
              estimatedTotal: parseFloat(r.estimated_total ?? '0'),
              city: r.city ?? '',
              createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at ?? ''),
            })),
          };
        } finally { await conn.end(); }
      }),
  }),
});
export type AppRouter = typeof appRouter;

// ─── Schedule Blockers sub-router (wired into appRouter above via scheduleBlockers key) ───
