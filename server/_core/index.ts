import "dotenv/config";
import express from "express";
import { createServer } from "http";
import path from "path";
import fs from "fs";
import { adminHtml } from "../admin-html.js";
import mysql from "mysql2/promise";
import { startClockMonitor } from "../clockMonitor";
import { startCallbackReminderMonitor } from "../callbackReminderMonitor";
import { startApptConfirmationMonitor } from "../apptConfirmationMonitor";
import { startAutoDeductMonitor } from "../autoDeductMonitor";
import { startAbandonedCartMonitor } from "../abandoned-cart-monitor";
import { startStripeReconciliationJob } from "../stripe-reconciliation-job";
import { startPaymentReminderScheduler } from "../loanReminderScheduler";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { registerOAuthRoutes } from "./oauth";
import { registerStorageProxy } from "./storageProxy";
import { appRouter } from "../routers";
import { createContext } from "./context";
import * as db from "../db";
import { createReceptionistRouter } from "../receptionistRouter";
import { createPhoneRouter } from "../phoneRouter";
import { createInvoiceRouter } from "../invoiceRouter";
import { vipRouter } from "../vipRouter";
import { ENV } from "./env";

function isPortAvailable(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}

async function findAvailablePort(startPort: number = 3000): Promise<number> {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}

async function startServer() {
  const app = express();
  const server = createServer(app);

  // Enable CORS for all routes - reflect the request origin to support credentials
  app.use((req, res, next) => {
    const origin = req.headers.origin;
    if (origin) {
      res.header("Access-Control-Allow-Origin", origin);
    }
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header(
      "Access-Control-Allow-Headers",
      "Origin, X-Requested-With, Content-Type, Accept, Authorization",
    );
    res.header("Access-Control-Allow-Credentials", "true");

    // Handle preflight requests
    if (req.method === "OPTIONS") {
      res.sendStatus(200);
      return;
    }
    next();
  });

  app.use(express.json({ limit: "50mb" }));
  app.use(express.urlencoded({ limit: "50mb", extended: true }));

  registerStorageProxy(app);
  registerOAuthRoutes(app);

  // ─── Admin Web Portal ──────────────────────────────────────────────────────
  // HTML is inlined at build time via admin-html.ts to avoid file path issues in production
  const serveAdmin = (_req: any, res: any) => {
    res.setHeader("Content-Type", "text/html");
    res.setHeader("Cache-Control", "no-store, no-cache, must-revalidate, proxy-revalidate");
    res.setHeader("Pragma", "no-cache");
    res.setHeader("Expires", "0");
    res.send(adminHtml);
  };
  app.get("/admin", serveAdmin);
  // Also serve at /api/admin since the deployment proxy only passes /api/* routes
  app.get("/api/admin", serveAdmin);

  app.get("/api/health", (_req, res) => {
    res.json({ ok: true, timestamp: Date.now() });
  });

  // ─── Cache Version ───────────────────────────────────────────────────────────────────────────────
  // Bump CACHE_VERSION whenever you need all devices to silently clear their local
  // job cache and re-fetch fresh data. Devices check this on every app foreground.
  const CACHE_VERSION = "v10";
  app.get("/api/cache-version", (_req, res) => {
    res.json({ version: CACHE_VERSION });
  });

  // ─── Generic File Upload Endpoint ─────────────────────────────────────────────
  // Accepts multipart/form-data with a 'file' field, stores to S3, returns { url }
  app.post("/api/upload", async (req, res) => {
    try {
      const busboy = (await import("busboy")).default;
      const bb = busboy({ headers: req.headers, limits: { fileSize: 20 * 1024 * 1024 } });
      let fileBuffer: Buffer | null = null;
      let mimeType = "image/jpeg";
      let filename = `upload-${Date.now()}.jpg`;
      await new Promise<void>((resolve, reject) => {
        bb.on("file", (_fieldname: string, stream: any, info: any) => {
          mimeType = info.mimeType || "image/jpeg";
          filename = info.filename || filename;
          const chunks: Buffer[] = [];
          stream.on("data", (chunk: Buffer) => chunks.push(chunk));
          stream.on("end", () => { fileBuffer = Buffer.concat(chunks); });
          stream.on("error", reject);
        });
        bb.on("finish", resolve);
        bb.on("error", reject);
        req.pipe(bb);
      });
      if (!fileBuffer || (fileBuffer as Buffer).length === 0) {
        res.status(400).json({ error: "No file received" });
        return;
      }
      const ext = filename.split(".").pop() ?? "jpg";
      const key = `uploads/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
      const { storagePut } = await import("../storage.js");
      const { url } = await storagePut(key, fileBuffer as Buffer, mimeType);
      res.json({ url });
    } catch (e: any) {
      console.error("[upload] Error:", e.message);
      res.status(500).json({ error: e.message });
    }
  });

  // ─── Booking Webhook (receives POST from WordPress booking form or customer app) ─
  // URL format: POST /api/booking/webhook?location=crestview&source=portal
  // Accepts application/x-www-form-urlencoded or JSON
  // source: "portal_app" for customer portal bookings, "website" for website bookings (defaults to "website")
  app.post("/api/booking/webhook", async (req, res) => {
    try {
      const locationParam = (req.query.location as string) || (req.body.location as string) || "";
      const location = db.normalizeLocation(locationParam);
      const sourceParam = (req.query.source as string) || (req.body.source as string) || "website";
      const bookingSource = sourceParam === "portal_app" ? "portal_app" : "website";

      const knownLocations = ["crestview", "niceville", "destin", "fwb", "pensacola"];
      if (!location || !knownLocations.includes(location)) {
        res.status(400).json({ error: `Unknown location: '${locationParam}'. Use: crestview, niceville, destin, fwb, pensacola` });
        return;
      }

      const body = req.body as Record<string, string>;

      // Require at minimum: firstName, selectedDate, selectedTime
      const firstName = body.firstName || "";
      const lastName = body.lastName || "";
      const selectedDate = body.selectedDate || "";
      const selectedTime = body.selectedTime || "";

      if (!firstName || !selectedDate || !selectedTime) {
        res.status(400).json({ error: "Missing required fields: firstName, selectedDate, selectedTime" });
        return;
      }

      // Parse time slot to hours
      const { startHour, endHour } = db.parseTimeSlot(selectedTime);

      // ── Double-booking protection: reject if all detailers are occupied for this slot ──
      const [existingBookings, locationCapacity, existingScheduleJobs, locationDetailers] = await Promise.all([
        db.getBookingsByDateAndLocation(location, selectedDate),
        db.getLocationCapacity(location),
        db.getScheduleJobsByLocationAndDateRange(location, selectedDate, selectedDate),
        db.getDetailersByLocation(location),
      ]);

      // ── Shift-aware filtering: only count detailers who work on this day-of-week ──
      // customWorkDays (when set) overrides the legacy shift1/shift2 pattern.
      // customWorkDays = comma-separated JS day numbers: 0=Sun,1=Mon,...,6=Sat
      const wh_shift1Days = new Set([1, 2, 3, 4]); // Mon–Thu (legacy fallback)
      const [wh_yyyy, wh_mm, wh_dd] = selectedDate.split('-').map(Number);
      const wh_dow = new Date(wh_yyyy, wh_mm - 1, wh_dd).getDay();

      const workingLocationDetailers = locationDetailers.filter((d: any) => {
        if (d.customWorkDays) {
          const customDays = d.customWorkDays.split(',').map((x: string) => parseInt(x.trim(), 10));
          return customDays.includes(wh_dow);
        }
        const shift = (d.shift ?? 'shift1') as 'shift1' | 'shift2';
        if (shift === 'shift1') return wh_shift1Days.has(wh_dow); // Mon–Thu
        return wh_dow === 5 || wh_dow === 6 || wh_dow === 0; // Fri–Sun only for shift2
      });

      // If no detailers work this day, reject immediately
      if (workingLocationDetailers.length === 0) {
        res.status(409).json({
          error: "conflict",
          message: "No detailers are available on that day.",
          date: selectedDate,
          location,
        });
        return;
      }

      // Count raw overlapping jobs (not just registered-detailer matches) so that
      // jobs assigned to anyone (Elijah, Nick, etc.) correctly consume capacity.
      // effectiveCapacity = min(locationCapacity, registeredCount) when detailers
      // are registered; fall back to locationCapacity if no detailers are registered.
      const wh_registeredCount = workingLocationDetailers.length;
      const webhookEffectiveCapacity = wh_registeredCount > 0
        ? Math.min(locationCapacity, wh_registeredCount)
        : locationCapacity;

      // Count overlapping jobs, de-duplicating online_booking mirrors
      let totalOccupied = 0;
      const wh_seenIds = new Set<string>();

      for (const b of existingBookings) {
        if (b.startHour != null && b.endHour != null && Number(b.startHour) < endHour && Number(b.endHour) > startHour) {
          const bid = (b as any).bookingId || (b as any).id || "";
          if (!wh_seenIds.has(bid)) {
            wh_seenIds.add(bid);
            totalOccupied++;
          }
        }
      }
      for (const j of existingScheduleJobs) {
        if (j.status === "cancelled") continue;
        const jStart = Number(j.startHour ?? 0);
        const jEnd = Number(j.endHour ?? 24);
        if (jStart < endHour && jEnd > startHour) {
          const mirrorId = (j as any).onlineBookingId || "";
          if (mirrorId && wh_seenIds.has(mirrorId)) continue;
          const jid = (j as any).jobId || (j as any).id || "";
          if (!wh_seenIds.has(jid)) {
            wh_seenIds.add(jid);
            totalOccupied++;
          }
        }
      }

      const hasConflict = totalOccupied >= webhookEffectiveCapacity;
      if (hasConflict) {
        res.status(409).json({
          error: "conflict",
          message: "That time slot was just booked by someone else.",
          date: selectedDate,
          location,
        });
        return;
      }

      // Generate unique booking ID
      const bookingId = `BK_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

      // Phase B: if customer chose a preferred detailer, use them; otherwise auto-assign
      const preferredDetailerId = (body.preferredDetailerId || "").trim() || null;
      const preferredDetailerName = (body.preferredDetailerName || "").trim() || null;
      // Auto-assign: use preferred detailer if provided, else pick least-loaded
      const assignedTo = preferredDetailerId
        ? preferredDetailerId
        : await db.getLeastLoadedDetailer(location, selectedDate, startHour, endHour);

      await db.createOnlineBooking({
        bookingId,
        location,
        firstName,
        lastName,
        email: body.email || null,
        phone: body.phone || null,
        streetAddress: body.streetAddress || null,
        unit: body.unit || null,
        city: body.city || null,
        state: body.state || null,
        zipCode: body.zipCode || null,
        vehicleType: body.vehicleType || null,
        packageType: body.packageType || null,
        selectedAddons: body.selectedAddons || null,
        totalPrice: body.totalPrice ? body.totalPrice : null,
        discountCode: body.discountCode || null,
        discountAmount: body.discountAmount ? body.discountAmount : "0",
        finalTotal: body.finalTotal ? body.finalTotal : null,
        bookingDate: selectedDate,
        timeSlot: selectedTime,
        startHour: String(startHour),
        endHour: String(endHour),
        preferredDetailerId,
        preferredDetailerName,
        assignedTo,
        status: "pending",
        sourceUrl: body.page || null,
        webhookPayload: JSON.stringify(body),
      });
      // Mirror online booking into schedule_jobs so mobile app sees it in the unified calendar
      const scheduleJobId = `online_${bookingId}`;
      await db.upsertScheduleJob({
        jobId: scheduleJobId,
        location,
        date: selectedDate,
        timeSlot: selectedTime,
        startHour: String(startHour),
        endHour: String(endHour),
        customerName: `${firstName} ${lastName}`.trim(),
        customerPhone: body.phone || null,
        customerEmail: body.email || null,
        vehicleType: body.vehicleType || null,
        packageType: body.packageType || null,
        serviceDescription: null,
        selectedAddons: body.selectedAddons || null,
        totalPrice: body.finalTotal || body.totalPrice || null,
        tips: "0",
        assignedTo,
        status: "pending",
        source: bookingSource === "portal_app" ? "portal_app" : "online",
        onlineBookingId: bookingId,
        notes: bookingSource === "portal_app" ? `Booked via customer portal. Address: ${body.streetAddress || ''}${body.unit ? ' ' + body.unit : ''}, ${body.city || ''} ${body.state || ''} ${body.zipCode || ''}. Booking ref: ${bookingId}` : null,
        createdBy: null,
      });
      console.log(`[Booking] Assigned to detailer: ${assignedTo ?? 'unassigned'}`);
      console.log(`[Booking] New booking for ${location}: ${firstName} ${lastName} on ${selectedDate} at ${selectedTime}`);
      // Send Twilio SMS confirmation to customer (non-blocking — don't delay the response)
      if (body.phone) {
        sendBookingConfirmationSms({
          phone: body.phone,
          firstName,
          lastName,
          date: selectedDate,
          time: selectedTime,
          vehicleType: body.vehicleType || null,
          packageType: body.packageType || null,
          streetAddress: body.streetAddress || null,
          city: body.city || null,
          finalTotal: body.finalTotal || body.totalPrice || null,
        }).catch(err => console.error('[Booking] SMS send error:', err));
      }
      // Send confirmation email to customer + admin alert (non-blocking)
      Promise.all([
        import("../email.js"),
        import("../db.js").then(m => m.resolvePackageNameAsync(body.packageType)).catch(() => body.packageType || "Mobile Detailing"),
      ]).then(([{ sendEmail, buildBookingConfirmationEmail, buildAdminBookingAlertEmail }, resolvedPackageName]) => {
        const customerName = `${firstName} ${lastName}`.trim();
        const addressLabel = [body.streetAddress, body.city, body.state, body.zipCode].filter(Boolean).join(", ");
        const totalNum = parseFloat(body.finalTotal || body.totalPrice || "0") || 0;
        const addons = body.selectedAddons ? body.selectedAddons.split(",").map((s: string) => s.trim()).filter(Boolean) : [];
        const packageDisplayName = resolvedPackageName || "Mobile Detailing";
        // Customer confirmation email
        if (body.email) {
          const customerEmail = buildBookingConfirmationEmail({
            customerName,
            bookingRef: bookingId,
            packageName: packageDisplayName,
            vehicleLabel: body.vehicleType || undefined,
            scheduledDate: selectedDate,
            scheduledTime: selectedTime,
            addressLabel: addressLabel || undefined,
            addons,
            total: totalNum,
          });
          sendEmail({ to: body.email, subject: customerEmail.subject, html: customerEmail.html, type: "booking_confirmation", customerName, bookingRef: bookingId })
            .catch(err => console.error('[Booking] Customer email error:', err));
        }
        // Admin alert email
        if (ENV.gmailUser) {
          const adminEmail = buildAdminBookingAlertEmail({
            customerName,
            customerEmail: body.email || "",
            bookingRef: bookingId,
            packageName: packageDisplayName,
            vehicleLabel: body.vehicleType || "",
            scheduledDate: selectedDate,
            scheduledTime: selectedTime,
            city: location,
            addressLabel: addressLabel || undefined,
            total: totalNum,
            assignedDetailer: assignedTo || undefined,
          });
          sendEmail({ to: ENV.gmailUser, subject: adminEmail.subject, html: adminEmail.html, type: "other", urgent: true, customerName, bookingRef: bookingId })
            .catch(err => console.error('[Booking] Admin email error:', err));
        }
      }).catch(err => console.error('[Booking] Email module load error:', err));
      // ── Push notification to assigned detailer only + create job_event ──
      try {
        const { employees: empTable, jobEvents: jobEventsTable } = await import('../../drizzle/schema.js');
        const { eq: eqOp } = await import('drizzle-orm');
        const drizzleDb = await db.getDb();
        if (drizzleDb) {
          const cityLabel = location.split('-').map((w: string) => w.charAt(0).toUpperCase() + w.slice(1)).join(' ');
          const customerName = `${firstName} ${lastName}`.trim();
          const jobId = `online_${bookingId}`;
          // Create a job_event record so the in-app banner shows
          try {
            await drizzleDb.insert(jobEventsTable).values({
              jobId,
              eventType: 'created',
              customerName: customerName || 'New Customer',
              location: cityLabel,
              dateStr: selectedDate,
              timeSlot: selectedTime,
              assignedTo: assignedTo ?? null,
            });
          } catch (jeErr) {
            console.error('[Booking] job_event insert error:', jeErr);
          }
          const resolvedPkgForPush = await import('../db.js').then(m => m.resolvePackageNameAsync(body.packageType)).catch(() => body.packageType || 'Detail Service');
          const pushBodyText = `${customerName} · ${selectedDate} ${selectedTime} · ${resolvedPkgForPush}`;
          const pushDataBase = { jobId, date: selectedDate, timeSlot: selectedTime, customerName, packageType: body.packageType ?? 'Detail Service', location, eventType: 'created' };

          // 1. Push to assigned detailer only (routes to job_detail so they can see their assignment)
          if (assignedTo) {
            try {
              const [assignedEmp] = await drizzleDb
                .select({ pushToken: empTable.pushToken })
                .from(empTable)
                .where(eqOp(empTable.employeeId, assignedTo))
                .limit(1);
              const token = assignedEmp?.pushToken;
              console.log(`[Booking] Detailer ${assignedTo} token: ${token ? token.substring(0, 30) + '...' : 'NONE'}`);
              if (token && (token.startsWith('ExponentPushToken[') || token.startsWith('ExpoPushToken['))) {
                const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify([{ to: token, title: `📋 New Job Assigned — ${cityLabel}`, body: pushBodyText, sound: 'default', data: { screen: 'job_detail', ...pushDataBase } }]),
                });
                const pushData = await pushRes.json();
                if (!pushRes.ok) {
                  console.error(`[Booking] Detailer push failed: ${pushRes.status}`, pushData);
                } else {
                  console.log(`[Booking] Detailer push sent successfully`);
                }
              } else {
                console.warn(`[Booking] Detailer ${assignedTo} has no valid push token`);
              }
            } catch (detailerPushErr) {
              console.error(`[Booking] Detailer push error for ${assignedTo}:`, detailerPushErr);
            }
          }

          // 2. Push to admins and ops managers (routes to new_bookings list)
          try {
            const { inArray: inArrayOp } = await import('drizzle-orm');
            const adminRows = await drizzleDb
              .select({ pushToken: empTable.pushToken })
              .from(empTable)
              .where(inArrayOp(empTable.role, ['admin', 'office', 'operations_manager']));
            console.log(`[Booking] Found ${adminRows.length} admin/ops users`);
            const adminTokens = adminRows
              .map((r: any) => r.pushToken)
              .filter((t: any): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
            console.log(`[Booking] Found ${adminTokens.length} valid push tokens for admins`);
            if (adminTokens.length > 0) {
              const pushPayloads = adminTokens.map((to: string) => ({ to, title: `📋 New Job Booked — ${cityLabel}`, body: pushBodyText, sound: 'default', data: { screen: 'new_bookings', ...pushDataBase } }));
              const pushRes = await fetch('https://exp.host/--/api/v2/push/send', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(pushPayloads),
              });
              const pushData = await pushRes.json();
              if (!pushRes.ok) {
                console.error(`[Booking] Admin push failed: ${pushRes.status}`, pushData);
              } else {
                console.log(`[Booking] Admin push sent to ${adminTokens.length} recipients:`, pushData);
              }
            } else {
              console.warn('[Booking] No valid push tokens found for admins/ops');
            }
          } catch (adminPushErr) {
            console.error('[Booking] Admin push error:', adminPushErr);
          }
        }
      } catch (pushErr) {
        console.error('[Booking] Push notification error:', pushErr);
      }
      res.json({ success: true, bookingId, location, date: selectedDate, time: selectedTime });
    } catch (err) {
      console.error("[Booking webhook error]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Lead Webhook (Maintenance, Ceramic Coating, and other non-scheduled service inquiries) ───
  // URL format: POST /api/lead/webhook?location=crestview
  // Saves lead to online_bookings with status=pending, no date/time conflict check
  app.post("/api/lead/webhook", async (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    try {
      const locationParam = (req.query.location as string) || (req.body.location as string) || "";
      const location = db.normalizeLocation(locationParam);
      const knownLocations = ["crestview", "niceville", "destin", "fwb", "pensacola"];
      if (!location || !knownLocations.includes(location)) {
        res.status(400).json({ error: `Unknown location: '${locationParam}'. Use: crestview, niceville, destin, fwb, pensacola` });
        return;
      }
      const body = req.body as Record<string, string>;
      const firstName = body.firstName || "";
      if (!firstName) {
        res.status(400).json({ error: "Missing required field: firstName" });
        return;
      }
      const bookingId = `LEAD_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;
      await db.createOnlineBooking({
        bookingId,
        location,
        firstName,
        lastName: body.lastName || "",
        email: body.email || null,
        phone: body.phone || null,
        streetAddress: body.streetAddress || null,
        unit: body.unit || null,
        city: body.city || null,
        state: body.state || null,
        zipCode: body.zipCode || null,
        vehicleType: body.vehicleType || null,
        packageType: body.serviceType || body.packageType || null,
        selectedAddons: body.selectedAddons || body.preferredDay || null,
        totalPrice: body.totalPrice ? body.totalPrice : null,
        discountCode: null,
        discountAmount: "0",
        finalTotal: body.totalPrice ? body.totalPrice : null,
        bookingDate: "TBD",
        timeSlot: body.preferredDay || body.preferredTime || "TBD",
        startHour: null,
        endHour: null,
        preferredDetailerId: null,
        preferredDetailerName: null,
        assignedTo: null,
        status: "pending",
        sourceUrl: body.page || null,
        webhookPayload: JSON.stringify(body),
      });
      console.log(`[Lead] New lead for ${location}: ${firstName} ${body.lastName || ""} — ${body.serviceType || body.packageType || "unknown service"}`);
      res.json({ success: true, leadId: bookingId, location });
    } catch (err) {
      console.error("[Lead webhook error]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // Handle CORS preflight for lead webhook
  app.options("/api/lead/webhook", (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(200);
  });

  // ─── Abandoned Cart Endpoint ─────────────────────────────────────────────────
  // URL format: POST /api/booking/abandoned?location=crestview
  // Called by the booking form as soon as the visitor completes the personal info step
  // (before they pick a date/time). If they leave without finishing, they appear in the
  // Pipeline under the "Abandoned Cart" column so the team can send a recovery SMS.
  app.post("/api/booking/abandoned", async (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    try {
      const locationParam = (req.query.location as string) || (req.body.location as string) || "";
      const location = db.normalizeLocation(locationParam);
      const knownLocations = ["crestview", "niceville", "destin", "fwb", "pensacola"];
      if (!location || !knownLocations.includes(location)) {
        res.status(400).json({ error: `Unknown location: '${locationParam}'` });
        return;
      }
      const body = req.body as Record<string, string>;
      const firstName = body.firstName || "";
      if (!firstName) {
        res.status(400).json({ error: "Missing required field: firstName" });
        return;
      }
      // Check if this visitor already has an abandoned cart (deduplicate by phone+location)
      // If so, update it rather than creating a duplicate
      const existingId = body.existingBookingId || null;
      if (existingId) {
        // Visitor already has a cart — update vehicle/package if provided
        const vt = body.vehicleType || "";
        const pt = body.packageType || "";
        if (vt && pt) {
          await db.updateAbandonedCartVehicle(existingId, vt, pt);
          console.log(`[Abandoned Cart] Updated vehicle/package for ${existingId}: ${vt} / ${pt}`);
        }
        res.json({ success: true, bookingId: existingId, location, updated: true });
        return;
      }
      const bookingId = await db.createAbandonedCart({
        firstName,
        lastName: body.lastName || "",
        email: body.email || "",
        phone: body.phone || "",
        location,
        vehicleType: body.vehicleType || undefined,
        packageName: body.packageType || undefined,
        bookingDate: body.selectedDate || undefined,
        totalPrice: body.totalPrice || undefined,
      });
      console.log(`[Abandoned Cart] ${location}: ${firstName} ${body.lastName || ""} — ${body.vehicleType || "?"} / ${body.packageType || "?"}`);
      res.json({ success: true, bookingId, location });
    } catch (err) {
      console.error("[Abandoned cart error]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // CORS preflight for abandoned cart
  app.options("/api/booking/abandoned", (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(200);
  });

  // ─── Mark Abandoned Cart as Completed (called when booking is confirmed) ──────
  // URL format: POST /api/booking/abandoned/complete
  // Removes the abandoned cart record so it doesn't stay in the pipeline after booking
  app.post("/api/booking/abandoned/complete", async (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    try {
      const body = req.body as Record<string, string>;
      const bookingId = body.bookingId || "";
      if (!bookingId) { res.json({ success: true }); return; }
      // Move the abandoned cart to "closed" so it disappears from the pipeline
      await db.updateBookingPipelineStage(bookingId, "closed");
      res.json({ success: true });
    } catch (err) {
      res.json({ success: true }); // fail silently — booking already completed
    }
  });

  app.options("/api/booking/abandoned/complete", (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "POST, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Content-Type");
    res.sendStatus(200);
  });

  // ─── Availability Endpoint (called by WordPress form to grey out booked slots) ─
  // URL format: GET /api/booking/availability?location=crestview&date=2026-04-15
  app.get("/api/booking/availability", async (req, res) => {
    // Allow cross-origin from any WordPress site
    res.header("Access-Control-Allow-Origin", "*");
    try {
      const locationParam = (req.query.location as string) || "";
      const date = (req.query.date as string) || "";
      const location = db.normalizeLocation(locationParam);

      const knownLocations2 = ["crestview", "niceville", "destin", "fwb", "pensacola"];
      if (!location || !knownLocations2.includes(location)) {
        res.status(400).json({ error: `Unknown location: '${locationParam}'` });
        return;
      }

      if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        res.status(400).json({ error: "Invalid date format. Use YYYY-MM-DD" });
        return;
      }

      const [capacity, onlineBookings, scheduleJobsForDay, allDetailers, dayBlockers] = await Promise.all([
        db.getLocationCapacity(location),
        db.getBookingsByDateAndLocation(location, date),
        db.getScheduleJobsByLocationAndDateRange(location, date, date),
        db.getDetailersByLocation(location),
        db.getBlockersForDate(location, date),
      ]);

            // ── Shift-aware filtering: customWorkDays overrides legacy shift1/shift2 ──
      // customWorkDays = comma-separated JS day numbers: 0=Sun,1=Mon,...,6=Sat
      const shift1Days = new Set([1, 2, 3, 4]); // Mon–Thu (legacy fallback)
      const [yyyy, mm, dd] = date.split('-').map(Number);
      const dow = new Date(yyyy, mm - 1, dd).getDay();
      // Build a set of blocked detailer names (first name and full name) for this date
      const blockedNames = new Set<string>();
      for (const b of dayBlockers) {
        const full = (b.detailerName || "").toLowerCase();
        const first = full.split(" ")[0];
        if (full) blockedNames.add(full);
        if (first) blockedNames.add(first);
      }
      const workingDetailers = allDetailers.filter((d: any) => {
        // Use customWorkDays if set, otherwise fall back to shift1/shift2
        let onShift: boolean;
        if (d.customWorkDays) {
          const customDays = d.customWorkDays.split(',').map((x: string) => parseInt(x.trim(), 10));
          onShift = customDays.includes(dow);
        } else {
          const shift = (d.shift ?? 'shift1') as 'shift1' | 'shift2';
          onShift = shift === 'shift1' ? shift1Days.has(dow) : (dow === 5 || dow === 6 || dow === 0);
        }
        if (!onShift) return false;
        // Exclude detailers who have an all-day or overlapping blocker
        const fullName = (d.fullName || "").toLowerCase();
        const firstName = fullName.split(" ")[0];
        if (blockedNames.has(fullName) || blockedNames.has(firstName)) return false;
        return true;
      });

      // If no detailers work this day, all slots are fully booked
      if (workingDetailers.length === 0) {
        const allSlotsFull = [
          "8:00am - 11:00am", "11:00am - 2:00pm", "2:00pm - 5:00pm",
          "8:00am - 12:00pm", "1:00pm - 5:00pm",
          "8:00am - 10:00am", "10:00am - 12:00pm", "12:00pm - 2:00pm",
          "2:00pm - 4:00pm", "4:00pm - 6:00pm",
        ];
        res.json({ location, date, capacity: 0, totalBookings: 0, bookedSlots: allSlotsFull, slotCounts: {}, tooSoonSlots: [] });
        return;
      }

      // All possible arrival window slots for this location
      // Includes both server-side labels AND website form labels ("8:00am - 12:00pm", "1:00pm - 5:00pm")
      const allSlots = [
        "8:00am - 11:00am", "11:00am - 2:00pm", "2:00pm - 5:00pm",
        // Website form slot labels
        "8:00am - 12:00pm", "1:00pm - 5:00pm",
        // Legacy 2-hour slots (kept for backward compat)
        "8:00am - 10:00am", "10:00am - 12:00pm", "12:00pm - 2:00pm",
        "2:00pm - 4:00pm", "4:00pm - 6:00pm",
      ];

      // Use location capacity as the effective capacity.
      // We count raw overlapping jobs (not just registered-detailer matches) so that
      // jobs assigned to anyone (Elijah, Nick, etc.) correctly consume capacity slots.
      // effectiveCapacity = min(locationCapacity, workingDetailers.length) when detailers
      // are registered; fall back to locationCapacity if no detailers are registered.
      const registeredCount = workingDetailers.length;
      const effectiveCapacity = registeredCount > 0
        ? Math.min(capacity, registeredCount)
        : capacity;

      // For each slot, count ALL overlapping jobs regardless of who is assigned.
      // A slot is fully booked when jobCount >= effectiveCapacity.
      const slotCounts: Record<string, number> = {};
      const fullyBookedSlots: string[] = [];

      // De-duplicate: a schedule_job that mirrors an online_booking shares the same
      // time window. To avoid double-counting, track online_booking IDs already counted.
      const countedOnlineIds = new Set<string>();

      for (const slot of allSlots) {
        const { startHour: sStart, endHour: sEnd } = db.parseTimeSlot(slot);

        let jobCount = 0;
        const seenIds = new Set<string>();

        // Count online bookings
        for (const b of onlineBookings) {
          if (b.startHour != null && b.endHour != null && Number(b.startHour) < sEnd && Number(b.endHour) > sStart) {
            const bid = (b as any).bookingId || (b as any).id || "";
            if (!seenIds.has(bid)) {
              seenIds.add(bid);
              jobCount++;
            }
          }
        }
        // Count schedule jobs — skip those that are mirrors of already-counted online bookings
        for (const j of scheduleJobsForDay) {
          if (j.status === "cancelled") continue;
          const jStart = Number(j.startHour ?? 0);
          const jEnd = Number(j.endHour ?? 24);
          if (jStart < sEnd && jEnd > sStart) {
            // If this job is a mirror of an online booking, skip it to avoid double-counting
            const mirrorId = (j as any).onlineBookingId || "";
            if (mirrorId && seenIds.has(mirrorId)) continue;
            const jid = (j as any).jobId || (j as any).id || "";
            if (!seenIds.has(jid)) {
              seenIds.add(jid);
              jobCount++;
            }
          }
        }

        slotCounts[slot] = jobCount;

        // Block the slot when total concurrent jobs fill all capacity
        if (jobCount >= effectiveCapacity) {
          fullyBookedSlots.push(slot);
        }
      }

      // 4-hour advance window: block any slot starting within 4 hours of now (same-day only)
      // Use Central Time (America/Chicago) so the check is correct regardless of server timezone (UTC)
      const tooSoonSlots: string[] = [];
      const nowCentral = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
      const todayCentralStr = `${nowCentral.getFullYear()}-${String(nowCentral.getMonth() + 1).padStart(2, "0")}-${String(nowCentral.getDate()).padStart(2, "0")}`;
      const isToday = date === todayCentralStr;
      if (isToday) {
        const nowHour = nowCentral.getHours() + nowCentral.getMinutes() / 60;
        const earliestAllowed = nowHour + 4;
        for (const slot of allSlots) {
          const { startHour } = db.parseTimeSlot(slot);
          if (startHour < earliestAllowed) tooSoonSlots.push(slot);
        }
      }

      const bookedSlots = Array.from(new Set([...fullyBookedSlots, ...tooSoonSlots]));

      res.json({
        location,
        date,
        capacity,
        effectiveCapacity,  // working detailers on this specific day (used by website form)
        totalBookings: onlineBookings.length + scheduleJobsForDay.filter(j => j.status !== "cancelled").length,
        bookedSlots,   // fully booked OR within 4-hour advance window
        slotCounts,    // occupied detailer count per slot
        tooSoonSlots,  // slots blocked by 4-hour rule
      });
    } catch (err) {
      console.error("[Availability error]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

   // ─── List bookings for a location (used by mobile app to sync calendar) ─────
  // URL format: GET /api/booking/list?location=crestview&from=2026-04-01
  app.get("/api/booking/list", async (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    try {
      const locationParam = (req.query.location as string) || "";
      const fromDate = (req.query.from as string) || undefined;
      const location = db.normalizeLocation(locationParam);

      const knownLocations3 = ["crestview", "niceville", "destin", "fwb", "pensacola"];
      if (!location || !knownLocations3.includes(location)) {
        res.status(400).json({ error: `Unknown location: '${locationParam}'` });
        return;
      }

      const bookings = await db.getAllBookingsForLocation(location, fromDate);
      res.json({ location, bookings });
    } catch (err) {
      console.error("[Booking list error]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Detailers for a location (used by booking forms to show team member names) ─
  // URL format: GET /api/booking/detailers?location=niceville
  app.get("/api/booking/detailers", async (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    try {
      const locationParam = (req.query.location as string) || "";
      const location = db.normalizeLocation(locationParam);
      const knownLocations4 = ["crestview", "niceville", "destin", "fwb", "pensacola"];
      if (!location || !knownLocations4.includes(location)) {
        res.status(400).json({ error: `Unknown location: '${locationParam}'` });
        return;
      }
      const detailers = await db.getDetailersByLocation(location);
      const capacity = await db.getLocationCapacity(location);
      res.json({ location, capacity, detailers });
    } catch (err) {
      console.error("[Detailers error]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Single job fetch by jobId (used by admin schedule deep-link from call log) ─
  app.get("/api/booking/job/:jobId", async (req, res) => {
    try {
      const { jobId } = req.params;
      const job = await db.getScheduleJobById(jobId);
      if (!job) return res.status(404).json({ error: "Job not found" });
      res.json(job);
    } catch (err) {
      console.error("[Job fetch error]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── Seed detailers endpoint (DISABLED 2026-07-21) ─────────────────────────
  // Ghost DET_ placeholder records have been cleaned up. This endpoint is
  // permanently disabled to prevent accidental re-seeding of fake team members.
  app.post("/api/booking/seed-detailers", (_req, res) => {
    res.status(410).json({ error: "This endpoint has been permanently disabled." });
  });

  // ─── Appointment Confirmation Click Handler ──────────────────────────────
  // GET /api/confirm/:token — customer clicks the "Confirm" button in their email
  app.get("/api/confirm/:token", async (req, res) => {
    const { token } = req.params;
    const conn = await mysql.createConnection(process.env.DATABASE_URL!);
    try {
      const [rows] = await conn.execute(
        `SELECT job_id, customer_name, date, time_slot, appt_confirmation_status FROM schedule_jobs WHERE appt_confirm_token = ? LIMIT 1`,
        [token]
      ) as [any[], any];
      if (rows.length === 0) {
        res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Link Not Found</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#fff;text-align:center;padding:20px}h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#94a3b8}</style></head><body><div><h1>🔗 Link Not Found</h1><p>This confirmation link is invalid or has expired.</p></div></body></html>`);
        return;
      }
      const job = rows[0];
      const alreadyConfirmed = job.appt_confirmation_status === 'confirmed';
      if (!alreadyConfirmed) {
        await conn.execute(
          `UPDATE schedule_jobs SET appt_confirmation_status = 'confirmed', appt_confirmed_at = NOW(), appt_confirm_method = 'email', status = 'confirmed' WHERE job_id = ?`,
          [job.job_id]
        );
        // Notify admin + sales
        try {
          const admins = await db.getAdminEmployees();
          for (const admin of admins) {
            await db.createNotification({
              notificationId: `APPT_CONFIRMED_EMAIL_${Date.now()}_${job.job_id}_${admin.employeeId}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName ?? admin.employeeId,
              notificationType: "callback_reminder",
              title: `✅ Appointment Confirmed via Email`,
              message: `${job.customer_name ?? "Customer"} confirmed their appointment on ${job.scheduled_date} at ${job.scheduled_time} by clicking the email button.`,
              createdBy: "System",
              status: "unread",
              requiresAcknowledgment: "no",
            });
          }
        } catch (notifErr) {
          console.error("[ApptConfirm] Email confirm notification error:", notifErr);
        }
      }
      const firstName = (job.customer_name ?? "").split(" ")[0] || "there";
      const statusMsg = alreadyConfirmed ? "Your appointment was already confirmed!" : "Your appointment is now confirmed!";
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Appointment Confirmed – Luxury Wash On Wheels</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px}#card{background:#1e293b;border-radius:20px;padding:40px 32px;max-width:380px;width:100%;border:1px solid #334155}#icon{font-size:64px;margin-bottom:20px}h1{font-size:1.5rem;font-weight:800;margin-bottom:8px}p{color:#94a3b8;font-size:.95rem;line-height:1.6;margin-top:8px}#badge{display:inline-flex;align-items:center;gap:6px;background:#22c55e22;color:#4ade80;padding:10px 20px;border-radius:20px;font-size:1rem;font-weight:700;margin:16px 0}#details{background:#0f172a;border-radius:12px;padding:16px;margin:16px 0;text-align:left}#details p{color:#cbd5e1;font-size:.9rem;margin-bottom:6px}#brand{margin-top:24px;font-size:.75rem;color:#475569}#brand span{color:#0a7ea4;font-weight:600}</style></head><body><div id="card"><div id="icon">🚐</div><div id="badge">✅ Confirmed</div><h1>See you soon, ${firstName}!</h1><p>${statusMsg}</p><div id="details"><p>📅 <strong>${job.date}</strong></p><p>⏰ <strong>${job.time_slot}</strong></p></div><p>We look forward to making your vehicle shine. If you need to reschedule, please call <strong>850-517-7874</strong>.</p><p id="brand" style="margin-top:28px">Powered by <span>Luxury Wash On Wheels</span></p></div></body></html>`);
    } catch (err) {
      console.error("[ApptConfirm] Confirm endpoint error:", err);
      res.status(500).send("An error occurred. Please call us at 850-517-7874.");
    } finally {
      await conn.end();
    }
  });

  // ─── Resume Token Lookup (called by WordPress booking form pre-fill script) ──
  // ─── Hosted booking form pages (served directly from app server) ─────────────
  // GET /crestview — serves the Crestview booking form with resume pre-fill support

  // ─── Loan Contract Routes ─────────────────────────────────────────────────────
  app.get("/sign-loan-contract/:loanId", async (req, res) => {
    try {
      const { loanId } = req.params;
      const { getDb } = await import('../db.js');
      const { loanContracts, loanPaymentSchedules } = await import('../../drizzle/schema.js');
      const { eq } = await import('drizzle-orm');
      const db = await getDb();
      if (!db) { res.status(500).send("Database unavailable"); return; }
      const loans = await db.select().from(loanContracts).where(eq(loanContracts.loanId, loanId)).limit(1);
      if (!loans.length) { res.status(404).send("<h2>Contract not found</h2>"); return; }
      const loan = loans[0];
      const schedule = await db.select().from(loanPaymentSchedules).where(eq(loanPaymentSchedules.loanId, loanId)).orderBy((loanPaymentSchedules as any).paymentNumber);
      const fmtDate = (d: any) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });
      const fmtCur = (n: any) => `$${Number(n).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
      const paymentAmt = Number(loan.totalRepaymentAmount) / loan.numberOfPayments;
      const interest = Number(loan.totalRepaymentAmount) - Number(loan.principalAmount);
      const isSigned = loan.status === "active" && loan.contractSignedAt;
      const scheduleRows = schedule.map((s: any) => `<tr><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${s.paymentNumber}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${fmtDate(s.dueDate)}</td><td style="padding:8px;border-bottom:1px solid #eee;text-align:center">${fmtCur(s.amountDue)}</td></tr>`).join("");
      const sigSection = isSigned
        ? `<div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:12px;padding:16px;text-align:center;color:#065f46;font-weight:700;margin-bottom:20px">✅ Electronically signed by ${loan.borrowerName} on ${fmtDate(loan.contractSignedAt!)}</div>${loan.signedContractUrl ? `<img src="${loan.signedContractUrl}" style="width:100%;border-radius:8px;margin-top:12px;border:1px solid #eee" alt="Signature"/>` : ""}`
        : `<canvas id="sigCanvas" height="200" style="border:2px dashed #ccc;border-radius:8px;width:100%;touch-action:none;cursor:crosshair"></canvas>
<button onclick="clearSig()" style="display:block;width:100%;padding:12px;margin-top:8px;border:1px solid #ddd;border-radius:12px;background:#f5f5f5;font-size:15px;cursor:pointer">Clear</button>
<button id="submitBtn" onclick="submitSig()" style="display:block;width:100%;padding:16px;margin-top:8px;border:none;border-radius:12px;background:#1a1a1a;color:#fff;font-size:16px;font-weight:700;cursor:pointer">Sign & Submit Agreement</button>
<div id="statusMsg"></div>
<script>
const canvas=document.getElementById('sigCanvas');const ctx=canvas.getContext('2d');let drawing=false;
function resize(){canvas.width=canvas.offsetWidth;canvas.height=200;ctx.strokeStyle='#1a1a1a';ctx.lineWidth=2.5;ctx.lineCap='round';}
resize();window.addEventListener('resize',resize);
function pos(e){const r=canvas.getBoundingClientRect();const t=e.touches?e.touches[0]:e;return{x:(t.clientX-r.left)*(canvas.width/r.width),y:(t.clientY-r.top)*(canvas.height/r.height)};}
canvas.addEventListener('mousedown',e=>{drawing=true;const p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);});
canvas.addEventListener('mousemove',e=>{if(!drawing)return;const p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();});
canvas.addEventListener('mouseup',()=>drawing=false);canvas.addEventListener('mouseleave',()=>drawing=false);
canvas.addEventListener('touchstart',e=>{e.preventDefault();drawing=true;const p=pos(e);ctx.beginPath();ctx.moveTo(p.x,p.y);},{passive:false});
canvas.addEventListener('touchmove',e=>{e.preventDefault();if(!drawing)return;const p=pos(e);ctx.lineTo(p.x,p.y);ctx.stroke();},{passive:false});
canvas.addEventListener('touchend',()=>drawing=false);
function clearSig(){ctx.clearRect(0,0,canvas.width,canvas.height);}
function isEmpty(){const d=ctx.getImageData(0,0,canvas.width,canvas.height).data;return !d.some(v=>v!==0);}
async function submitSig(){
  if(isEmpty()){document.getElementById('statusMsg').innerHTML='<p style="color:#dc2626;text-align:center;margin-top:8px">Please draw your signature before submitting.</p>';return;}
  document.getElementById('submitBtn').disabled=true;document.getElementById('submitBtn').textContent='Submitting...';
  const sigData=canvas.toDataURL('image/png');
  try{const r=await fetch('/api/trpc/loans.markContractSigned',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({json:{loanId:'${loanId}',signedContractUrl:sigData}})});
  const data=await r.json();
  if(data.result){document.getElementById('sig-section').innerHTML='<div style="background:#d1fae5;border-radius:12px;padding:20px;text-align:center;color:#065f46;font-weight:700">✅ Thank you! Your signature has been recorded. You will receive a confirmation email shortly.</div>';}
  else{throw new Error(data.error?.message||'Submission failed');}}
  catch(e){document.getElementById('statusMsg').innerHTML='<p style="color:#dc2626;text-align:center;margin-top:8px">Error: '+e.message+'</p>';document.getElementById('submitBtn').disabled=false;document.getElementById('submitBtn').textContent='Sign & Submit Agreement';}}
<\/script>`;
      const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Loan Agreement</title>
<style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f5f5f5;color:#1a1a1a;padding:20px}
.card{background:#fff;border-radius:16px;padding:24px;max-width:600px;margin:0 auto 20px;box-shadow:0 2px 8px rgba(0,0,0,.08)}
h2{font-size:16px;font-weight:700;margin-bottom:12px;color:#333}.label{font-size:11px;color:#888;text-transform:uppercase;letter-spacing:.5px;margin-bottom:2px}
.value{font-size:15px;font-weight:600;margin-bottom:12px}.row{display:flex;gap:16px;flex-wrap:wrap}.col{flex:1;min-width:120px}
table{width:100%;border-collapse:collapse}th{padding:8px;background:#f9f9f9;font-size:12px;text-transform:uppercase;color:#888;border-bottom:2px solid #eee}</style></head><body>
<div class="card"><div style="background:#1a1a1a;color:#fff;padding:16px 20px;border-radius:12px;margin-bottom:20px;text-align:center">
<div style="font-size:12px;opacity:.7;margin-bottom:4px">LUXURY WASH ON WHEELS</div><div style="font-size:18px;font-weight:800">Loan Agreement</div></div>
${isSigned ? `<div style="background:#d1fae5;border:1px solid #6ee7b7;border-radius:12px;padding:16px;text-align:center;color:#065f46;font-weight:700;margin-bottom:20px">✅ Signed on ${fmtDate(loan.contractSignedAt!)}</div>` : ""}
<h2>Parties</h2><div class="row"><div class="col"><div class="label">Lender</div><div class="value">${loan.borrowerName}</div></div>
<div class="col"><div class="label">Borrower</div><div class="value">Luxury Wash On Wheels LLC</div></div></div>
<div class="label">Lender Email</div><div class="value">${loan.borrowerEmail}</div>
<div class="label">Contract #</div><div class="value">${loan.loanId}</div></div>
<div class="card"><h2>Loan Summary</h2>
<div class="row"><div class="col"><div class="label">Principal</div><div class="value">${fmtCur(loan.principalAmount)}</div></div>
<div class="col"><div class="label">Interest</div><div class="value">${fmtCur(interest)}</div></div></div>
<div class="row"><div class="col"><div class="label">Total Repayment</div><div class="value">${fmtCur(loan.totalRepaymentAmount)}</div></div>
<div class="col"><div class="label">Payment Amount</div><div class="value">${fmtCur(paymentAmt)}</div></div></div>
<div class="row"><div class="col"><div class="label">Payments</div><div class="value">${loan.numberOfPayments} × ${loan.paymentFrequency}</div></div>
<div class="col"><div class="label">First Payment</div><div class="value">${schedule.length ? fmtDate((schedule[0] as any).dueDate) : "TBD"}</div></div></div></div>
<div class="card"><h2>Payment Schedule</h2><table><thead><tr><th>#</th><th>Due Date</th><th>Amount</th></tr></thead><tbody>${scheduleRows}</tbody>
<tfoot><tr><td colspan="2" style="padding:10px;font-weight:700;text-align:right">Total</td><td style="padding:10px;font-weight:700;text-align:center">${fmtCur(loan.totalRepaymentAmount)}</td></tr></tfoot></table></div>
<div class="card"><h2>Terms & Conditions</h2>
<p style="font-size:13px;line-height:1.6;color:#555;margin-bottom:10px"><strong>1. Loan Purpose.</strong> Luxury Wash On Wheels LLC agrees to repay the principal plus interest to ${loan.borrowerName} per the schedule above.</p>
<p style="font-size:13px;line-height:1.6;color:#555;margin-bottom:10px"><strong>2. Repayment.</strong> Payments are due on the dates listed. The Borrower agrees to make each payment on or before the due date.</p>
<p style="font-size:13px;line-height:1.6;color:#555;margin-bottom:10px"><strong>3. Interest.</strong> Total interest of ${fmtCur(interest)} is included in the total repayment and distributed evenly across all payments.</p>
<p style="font-size:13px;line-height:1.6;color:#555;margin-bottom:10px"><strong>4. No Late Penalties.</strong> There are no late payment penalties under this agreement.</p>
<p style="font-size:13px;line-height:1.6;color:#555;margin-bottom:10px"><strong>5. Prepayment.</strong> The Borrower may prepay any portion at any time without penalty.</p>
<p style="font-size:13px;line-height:1.6;color:#555;margin-bottom:10px"><strong>6. Governing Law.</strong> Governed by the laws of the State of Florida. Disputes resolved in Okaloosa County, Florida.</p>
<p style="font-size:13px;line-height:1.6;color:#555"><strong>7. Entire Agreement.</strong> This document constitutes the entire agreement. Modifications must be in writing and signed by both parties.</p></div>
<div class="card" id="sig-section"><h2>${isSigned ? "Signature on File" : "Electronic Signature"}</h2>
<p style="font-size:13px;color:#555;margin-bottom:16px">${isSigned ? "" : "By signing below, you confirm that you have read and agree to all terms of this loan agreement."}</p>
${sigSection}</div></body></html>`;
      res.setHeader("Content-Type", "text/html");
      res.send(html);
    } catch (err: any) {
      res.status(500).send(`<h2>Error: ${err.message}</h2>`);
    }
  });

  app.get("/api/loan/view-signed/:loanId", (req, res) => {
    res.redirect(`/sign-loan-contract/${req.params.loanId}`);
  });

  app.get("/crestview", (req, res) => {
    const formPath = path.join(process.cwd(), 'server/public/crestview-booking.html');
    if (fs.existsSync(formPath)) {
      res.sendFile(formPath);
    } else {
      res.status(404).send('Booking form not found');
    }
  });

    // GET /api/resume/:token — returns saved cart data as JSON
  app.get("/api/resume/:token", async (req, res) => {
    const { token } = req.params;
    try {
      const { getAbandonedCartByResumeToken } = await import('../db.js');
      const cart = await getAbandonedCartByResumeToken(token);
      if (!cart) {
        res.status(404).json({ error: "Token not found or expired" });
        return;
      }
      res.json({
        firstName: cart.firstName ?? "",
        lastName: cart.lastName ?? "",
        email: cart.email ?? "",
        phone: cart.phone ?? "",
        streetAddress: cart.streetAddress ?? "",
        unit: cart.unit ?? "",
        city: cart.city ?? "",
        state: cart.state ?? "",
        zipCode: cart.zipCode ?? "",
        vehicleType: cart.vehicleType ?? "",
        packageType: cart.packageType ?? "",
        location: cart.location ?? "",
      });
    } catch (err) {
      console.error("[resume] Error:", err);
      res.status(500).json({ error: "Server error" });
    }
  });

  // ─── Force-trigger abandoned cart recovery (admin tool, bypasses time checks) ─
  // GET /api/trigger-abandoned/:bookingId — immediately sends recovery email for a specific cart
  app.get("/api/trigger-abandoned/:bookingId", async (req, res) => {
    const { bookingId } = req.params;
    try {
      const { onlineBookings: obTable } = await import('../../drizzle/schema.js');
      const { eq } = await import('drizzle-orm');
      const dbConn = await db.getDb();
      if (!dbConn) { res.status(500).send("DB unavailable"); return; }
      const rows = await dbConn.select().from(obTable).where(eq(obTable.bookingId, bookingId)).limit(1);
      const row = rows[0];
      if (!row) { res.status(404).send(`Booking ${bookingId} not found`); return; }
      if (row.status !== "abandoned") {
        res.status(400).send(`Booking status is "${row.status}", not abandoned. Cannot trigger recovery.`);
        return;
      }
      const { randomBytes } = await import('crypto');
      const resumeToken = randomBytes(24).toString('hex');
      const cityConf: Record<string, { label: string; bookingUrl: string }> = {
        crestview: { label: 'Crestview', bookingUrl: 'https://luxurywashonwheels.com/crestview/mobile-detailing/' },
        niceville: { label: 'Niceville', bookingUrl: 'https://luxurywashonwheels.com/niceville/mobile-detailing/' },
        destin:    { label: 'Destin',    bookingUrl: 'https://luxurywashonwheels.com/destin/mobile-detailing/' },
        fwb:       { label: 'Fort Walton Beach', bookingUrl: 'https://luxurywashonwheels.com/fwb/mobile-detailing/' },
        pensacola: { label: 'Pensacola', bookingUrl: 'https://luxurywashonwheels.com/pensacola/mobile-detailing/' },
      };
      const city = cityConf[row.location ?? ''] ?? { label: row.location ?? 'your area', bookingUrl: 'https://luxurywashonwheels.com/book/' };
      const resumeUrl = `${city.bookingUrl}?resume=${resumeToken}`;
      const now = new Date();
      const formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: 'America/Chicago',
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
        timeZoneName: 'short',
      });
      const centralTimeStr = formatter.format(now);
      await dbConn.update(obTable)
        .set({ resumeToken, pipelineNotes: `Recovery SMS sent: ${centralTimeStr}` })
        .where(eq(obTable.bookingId, bookingId));
      let emailSent = false;
      let emailError = '';
      if (row.email) {
        try {
          const { buildAbandonedCartRecoveryEmail, sendEmail } = await import('../email.js');
          const emailContent = buildAbandonedCartRecoveryEmail({
            firstName: row.firstName ?? 'Customer',
            lastName: row.lastName ?? '',
            vehicleType: row.vehicleType ?? null,
            packageType: row.packageType ?? null,
            cityBookingUrl: resumeUrl,
            cityLabel: city.label,
          });
          emailSent = await sendEmail({
            to: row.email,
            subject: emailContent.subject,
            html: emailContent.html,
            type: 'other',
            customerName: `${row.firstName ?? ''} ${row.lastName ?? ''}`.trim(),
          });
        } catch (emailErr) {
          emailError = String(emailErr);
          console.error('[trigger-abandoned] Email error:', emailErr);
        }
      }
      const statusIcon = emailSent ? '\u2705' : '\u26a0\ufe0f';
      const sentLabel = emailSent
        ? 'Yes \u2713'
        : ('No \u2014 ' + (emailError || 'no email on file'));
      res.send(
        `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">` +
        `<title>Recovery Triggered</title><style>body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;padding:32px 16px;}` +
        `.card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,.1);}` +
        `h1{font-size:20px;font-weight:800;margin-bottom:16px;}p{margin-bottom:10px;font-size:14px;color:#374151;}` +
        `a{color:#0a7ea4;word-break:break-all;}.ok{color:#16a34a;font-weight:700;}.err{color:#dc2626;font-weight:700;}</style></head>` +
        `<body><div class="card"><h1>${statusIcon} Recovery Email Triggered</h1>` +
        `<p><strong>Booking ID:</strong> ${bookingId}</p>` +
        `<p><strong>Customer:</strong> ${row.firstName ?? ''} ${row.lastName ?? ''} &lt;${row.email ?? 'no email'}&gt;</p>` +
        `<p><strong>Location:</strong> ${city.label}</p>` +
        `<p><strong>Email sent:</strong> <span class="${emailSent ? 'ok' : 'err'}">${sentLabel}</span></p>` +
        `<p><strong>Resume URL:</strong><br><a href="${resumeUrl}">${resumeUrl}</a></p>` +
        `</div></body></html>`
      );
    } catch (err) {
      console.error('[trigger-abandoned] Error:', err);
      res.status(500).send('Error: ' + String(err));
    }
  });


  // ─── Test Emails Page ────────────────────────────────────────────────────────
  // GET /api/test-emails — shows a menu of all email types to test
  app.get("/api/test-emails", (_req, res) => {
    const baseUrl = process.env.PUBLIC_URL ?? "https://luxurywashonwheels.app";
    res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Test Panel</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;padding:32px 16px;}.card{max-width:520px;margin:0 auto;background:#fff;border-radius:16px;padding:28px;box-shadow:0 2px 8px rgba(0,0,0,.1);}h1{font-size:22px;font-weight:800;color:#111;margin-bottom:6px;}p{color:#6b7280;font-size:14px;margin-bottom:24px;}.btn{display:block;width:100%;padding:14px 20px;margin-bottom:12px;border-radius:12px;border:none;cursor:pointer;font-size:15px;font-weight:700;text-align:left;text-decoration:none;color:#fff;}.btn-blue{background:#0a7ea4;}.btn-green{background:#16a34a;}.btn-red{background:#dc2626;}.btn-purple{background:#7c3aed;}.btn-orange{background:#ea580c;}.btn-gray{background:#374151;}.badge{display:inline-block;font-size:11px;font-weight:600;padding:2px 8px;border-radius:20px;background:rgba(255,255,255,.25);margin-left:8px;vertical-align:middle;}</style></head><body><div class="card"><h1>📧 Email Test Panel</h1><p>Click any button to send a test email to <strong>adrian@luxurywashonwheels.com</strong></p><a class="btn btn-green" href="${baseUrl}/api/test-email/booking-confirmation">✅ Booking Confirmation<span class="badge">Customer gets this when they book</span></a><a class="btn btn-blue" href="${baseUrl}/api/test-email/2day-reminder">⏰ 2-Day Appointment Reminder<span class="badge">Sent 48hrs before</span></a><a class="btn btn-red" href="${baseUrl}/api/test-email/urgent-reminder">🚨 Urgent Reminder (4hr)<span class="badge">Sent if not confirmed</span></a><a class="btn btn-purple" href="${baseUrl}/api/test-email/on-the-way">🚗 Detailer On The Way<span class="badge">Sent when detailer departs</span></a><a class="btn btn-orange" href="${baseUrl}/api/test-email/admin-new-booking">📋 Admin — New Booking Alert<span class="badge">Sent to you on new booking</span></a><a class="btn btn-gray" href="${baseUrl}/api/test-email/admin-booking-change">✏️ Admin — Booking Change Alert<span class="badge">Sent to you on changes</span></a><a class="btn btn-blue" href="${baseUrl}/api/test-email/team-welcome">👋 Team Member Welcome<span class="badge">Sent when account is created</span></a><a class="btn btn-green" href="${baseUrl}/api/test-email/payment-receipt">💳 Payment Receipt<span class="badge">Sent to customer after payment</span></a></div></body></html>`);
  });

  // ─── Individual Test Email Endpoints ─────────────────────────────────────────
  app.get("/api/test-email/:type", async (req, res) => {
    try {
      const { sendEmail, buildBookingConfirmationEmail, buildUrgentConfirmationEmail, buildOnTheWayEmail, buildAdminBookingAlertEmail, buildAdminBookingChangeEmail } = await import("../email.js");
      const emailType = req.params.type;
      const baseUrl = process.env.PUBLIC_URL ?? "https://luxurywashonwheels.app";
      const confirmToken = `REAL_TEST_TOKEN_ADRIAN_2026`;
      const confirmUrl = `${baseUrl}/api/confirm/${confirmToken}`;
      const trackUrl = `${baseUrl}/api/track/TEST_TRACK_TOKEN`;
      const TO = "adrian@luxurywashonwheels.com";
      let subject = "";
      let html = "";
      let emailTypeLabel = "";

      if (emailType === "booking-confirmation") {
        emailTypeLabel = "Booking Confirmation";
        const result = buildBookingConfirmationEmail({
          customerName: "Adrian Test",
          bookingRef: "LW-TEST-001",
          packageName: "Premium Detail",
          vehicleLabel: "SUV",
          scheduledDate: "Thursday, May 21, 2026",
          scheduledTime: "10:00 AM – 1:00 PM",
          addressLabel: "123 Test St, Crestview, FL",
          addons: ["Engine Bay (+$50)"],
          total: 299,
          notes: "Please park in the driveway",
        });
        subject = result.subject;
        html = result.html;
      } else if (emailType === "2day-reminder") {
        emailTypeLabel = "9 AM Appointment Reminder";
        // Build using the real monitor function with a dynamic tomorrow date
        const { buildConfirmationReminderEmail } = await import("../apptConfirmationMonitor.js");
        // Use tomorrow's date as the test appointment date
        const tomorrowDate = new Date();
        tomorrowDate.setDate(tomorrowDate.getDate() + 1);
        const tomorrowStr = tomorrowDate.toLocaleDateString("en-US", { weekday: "long", year: "numeric", month: "long", day: "numeric" });
        const emailData = buildConfirmationReminderEmail({
          firstName: "Adrian",
          date: tomorrowStr,
          time: "10:00 AM",
          packageType: "Premium Detail",
          vehicleType: "SUV",
          address: "123 Test St",
          city: "Crestview, FL",
          confirmUrl,
          hoursAway: 24,
        });
        subject = emailData.subject;
        html = emailData.html;
      } else if (emailType === "urgent-reminder") {
        emailTypeLabel = "7 AM Day-Of Confirmation Nudge";
        // Use today's date in YYYY-MM-DD format so the hours-until calculation fires correctly
        const urgentNowCST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
        const urgentTodayISO = `${urgentNowCST.getFullYear()}-${String(urgentNowCST.getMonth()+1).padStart(2,"0")}-${String(urgentNowCST.getDate()).padStart(2,"0")}`;
        // Pick a test appointment time 3 hours from now (so it shows "in 3 hours")
        const urgentApptHour = (urgentNowCST.getHours() + 3) % 24;
        const urgentApptMeridiem = urgentApptHour >= 12 ? "PM" : "AM";
        const urgentApptHour12 = urgentApptHour > 12 ? urgentApptHour - 12 : urgentApptHour === 0 ? 12 : urgentApptHour;
        const urgentApptTimeStr = `${urgentApptHour12}:00 ${urgentApptMeridiem}`;
        const result = buildUrgentConfirmationEmail({
          firstName: "Adrian",
          date: urgentTodayISO,
          time: urgentApptTimeStr,
          vehicleType: "SUV",
          packageType: "Premium Detail",
          address: "123 Test St",
          city: "Crestview, FL",
          confirmUrl,
        });
        subject = result.subject;
        html = result.html;
      } else if (emailType === "on-the-way") {
        emailTypeLabel = "Detailer On The Way";
        const result = buildOnTheWayEmail({
          customerFirstName: "Adrian",
          detailerFirstName: "Marcus",
          trackUrl,
          phone: "850-517-7874",
        });
        subject = result.subject;
        html = result.html;
      } else if (emailType === "admin-new-booking") {
        emailTypeLabel = "Admin New Booking Alert";
        const result = buildAdminBookingAlertEmail({
          bookingRef: "LW-TEST-001",
          customerName: "Adrian Test",
          customerEmail: "adrian@luxurywashonwheels.com",
          packageName: "Premium Detail",
          vehicleLabel: "SUV",
          scheduledDate: "Thursday, May 21, 2026",
          scheduledTime: "10:00 AM – 1:00 PM",
          city: "Crestview",
          addressLabel: "123 Test St, Crestview, FL",
          total: 299,
        });
        subject = result.subject;
        html = result.html;
      } else if (emailType === "admin-booking-change") {
        emailTypeLabel = "Admin Booking Change Alert";
        const result = buildAdminBookingChangeEmail({
          bookingRef: "LW-TEST-001",
          customerName: "Adrian Test",
          customerEmail: "adrian@luxurywashonwheels.com",
          changeType: "reschedule",
          packageName: "Premium Detail",
          vehicleLabel: "SUV",
          originalDate: "Thursday, May 21, 2026",
          originalTime: "10:00 AM – 1:00 PM",
          newDate: "Saturday, May 23, 2026",
          newTime: "10:00 AM – 1:00 PM",
          city: "Crestview",
        });
        subject = result.subject;
        html = result.html;
      } else if (emailType === "team-welcome") {
        emailTypeLabel = "Team Member Welcome";
        const { buildTeamMemberWelcomeEmail } = await import("../email.js");
        const result = buildTeamMemberWelcomeEmail({
          fullName: "Adrian Morales",
          employeeId: "DETADRIAN",
          pin: "4821",
          role: "detailer",
          hireDate: new Date().toISOString().split('T')[0],
          city: "Crestview",
        });
        subject = result.subject;
        html = result.html;
      } else if (emailType === "payment-receipt") {
        emailTypeLabel = "Payment Receipt";
        const { buildPaymentReceiptEmail } = await import("../email.js");
        const result = buildPaymentReceiptEmail({
          customerName: "Adrian Morales",
          jobId: "LW-TEST-001",
          serviceDate: new Date().toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }),
          packageName: "Full Detail",
          vehicleInfo: "2022 Black Toyota Camry",
          serviceAddress: "123 Magnolia Dr, Crestview, FL 32536",
          paymentMethod: "credit_debit",
          subtotal: 149.00,
          tip: 20.00,
          total: 169.00,
          paidAt: new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', month: 'short', day: 'numeric', year: 'numeric', hour: 'numeric', minute: '2-digit', hour12: true }).format(new Date()),
          detailerName: "Caitlin",
        });
        subject = result.subject;
        html = result.html;
      } else {
        res.status(404).json({ ok: false, error: `Unknown email type: ${emailType}. Valid types: booking-confirmation, 2day-reminder, urgent-reminder, on-the-way, admin-new-booking, admin-booking-change, team-welcome, payment-receipt` });
        return;
      }

      const sent = await sendEmail({ to: TO, subject, html, type: "other", customerName: "Adrian Test", bookingRef: "LW-TEST-001" });
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Email Sent</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#f3f4f6;padding:32px 16px;display:flex;align-items:center;justify-content:center;min-height:100vh}.card{max-width:440px;width:100%;background:#fff;border-radius:16px;padding:32px;box-shadow:0 2px 8px rgba(0,0,0,.1);text-align:center}.icon{font-size:52px;margin-bottom:16px}h1{font-size:20px;font-weight:800;color:#111;margin-bottom:8px}p{color:#6b7280;font-size:14px;line-height:1.6;margin-bottom:20px}.back{display:inline-block;padding:12px 24px;background:#0a7ea4;color:#fff;border-radius:10px;text-decoration:none;font-weight:700;font-size:14px}</style></head><body><div class="card"><div class="icon">${sent ? "✅" : "❌"}</div><h1>${sent ? "Email Sent!" : "Send Failed"}</h1><p>${sent ? `<strong>${emailTypeLabel}</strong> was sent to <strong>${TO}</strong>. Check your inbox.` : "Email failed to send. Check server logs for details."}</p><a class="back" href="${baseUrl}/api/test-emails">← Back to Email Tests</a></div></body></html>`);
    } catch (err: any) {
      res.status(500).json({ ok: false, error: err.message });
    }
  });

  // ─── Public Customer Tracking Page ─────────────────────────────────────────
  // GET /track/:token — served as a standalone HTML page, no auth required
  app.get("/track/:token", async (req, res) => {
    const { token } = req.params;
    try {
      const data = await db.getTrackingTokenData(token);
      if (!data) {
        // Check if token exists but was deactivated (detailer arrived)
        const anyToken = await db.getTrackingTokenAnyStatus(token);
        if (anyToken) {
          // Token exists but is inactive or expired — detailer arrived or job finished
          const detailerName = anyToken.detailerName ?? "Your detailer";
          const customerName = anyToken.customerName ? `, ${anyToken.customerName}` : "";
          res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Detailer Arrived – Luxury Wash On Wheels</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;text-align:center;padding:32px}#card{background:#1e293b;border-radius:20px;padding:40px 32px;max-width:360px;width:100%;border:1px solid #334155}#icon{font-size:64px;margin-bottom:20px}h1{font-size:1.4rem;font-weight:700;margin-bottom:8px}p{color:#94a3b8;font-size:.95rem;line-height:1.5}#badge{display:inline-flex;align-items:center;gap:6px;background:#22c55e22;color:#4ade80;padding:8px 16px;border-radius:20px;font-size:.9rem;font-weight:600;margin:16px 0}#brand{margin-top:24px;font-size:.75rem;color:#475569}#brand span{color:#0a7ea4;font-weight:600}</style></head><body><div id="card"><div id="icon">🏁</div><div id="badge">✓ Arrived</div><h1>${detailerName} has arrived${customerName}!</h1><p>Your vehicle is in great hands. Sit back and relax while the Luxury Wash On Wheels crew works their magic.</p><p id="brand" style="margin-top:28px">Powered by <span>Luxury Wash On Wheels</span></p></div></body></html>`);
        } else {
          res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Link Expired</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#fff;text-align:center;padding:20px}h1{font-size:1.5rem;margin-bottom:.5rem}p{color:#94a3b8}</style></head><body><div><h1>🔗 Link Expired</h1><p>This tracking link has expired or is no longer valid.</p></div></body></html>`);
        }
        return;
      }
      // Serve the tracking page with embedded data
      const t = data.token;
      const detailerNameSafe = (t.detailerName ?? 'Your detailer').replace(/'/g, "\\'").replace(/</g, '&lt;');
      const customerNameSafe = (t.customerName ?? '').replace(/'/g, "\\'").replace(/</g, '&lt;');
      const customerAddrSafe = (t.customerAddress ?? '').replace(/'/g, "\\'").replace(/</g, '&lt;');
      const headerSubtitle = detailerNameSafe + ' is on the way' + (customerNameSafe ? ', ' + customerNameSafe : '') + '!';
      const pageHtml = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1">
  <title>Track Your Detailer - Luxury Wash On Wheels</title>
  <link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css"/>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    html,body{height:100%;overflow:hidden}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;background:#0a0a0a;color:#fff;display:flex;flex-direction:column;height:100%}
    #header{background:#0a0a0a;padding:14px 18px;display:flex;align-items:center;gap:12px;border-bottom:1px solid #1e293b;flex-shrink:0;z-index:1000}
    #logo{width:36px;height:36px;background:#0057FF;border-radius:10px;display:flex;align-items:center;justify-content:center;font-size:18px;flex-shrink:0}
    #header-text h1{font-size:15px;font-weight:700;color:#fff;line-height:1.2}
    #header-text p{font-size:12px;color:#94a3b8;margin-top:2px;line-height:1.3}
    #map-wrap{flex:1;position:relative;overflow:hidden}
    #map{position:absolute;inset:0}
    #bottom{background:#fff;color:#0a0a0a;padding:16px 18px 20px;flex-shrink:0;border-radius:20px 20px 0 0;box-shadow:0 -4px 24px rgba(0,0,0,0.3)}
    #status-row{display:flex;align-items:center;justify-content:space-between;margin-bottom:10px}
    #status-badge{display:inline-flex;align-items:center;gap:6px;background:#DBEAFE;color:#0057FF;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:700}
    #live-badge{display:inline-flex;align-items:center;gap:5px;background:#FEE2E2;color:#DC2626;padding:5px 10px;border-radius:20px;font-size:11px;font-weight:700;letter-spacing:.05em}
    .live-dot{width:7px;height:7px;border-radius:50%;background:#DC2626;animation:blink 1.2s infinite}
    @keyframes blink{0%,100%{opacity:1}50%{opacity:.2}}
    #eta-row{background:#EFF6FF;border-radius:10px;padding:10px 14px;display:flex;align-items:center;gap:8px;margin-bottom:10px}
    #eta-row svg{flex-shrink:0}
    #eta-label{font-size:13px;color:#374151}
    #eta-val{font-size:15px;font-weight:700;color:#0057FF;margin-left:auto}
    #dest-row{display:flex;align-items:center;gap:8px;font-size:13px;color:#6b7280}
    #dest-row svg{flex-shrink:0}
    #arrived-overlay{display:none;position:absolute;inset:0;background:rgba(0,0,0,0.7);z-index:2000;align-items:center;justify-content:center}
    #arrived-card{background:#fff;border-radius:20px;padding:32px 24px;max-width:320px;width:90%;text-align:center}
    #arrived-card h2{font-size:20px;font-weight:800;color:#0a0a0a;margin:12px 0 8px}
    #arrived-card p{font-size:14px;color:#6b7280;line-height:1.5}
    #arrived-btn{margin-top:20px;background:#0057FF;color:#fff;border:none;border-radius:50px;padding:14px 32px;font-size:15px;font-weight:700;cursor:pointer;width:100%}
    .leaflet-control-attribution{display:none!important}
    /* Hide any injected third-party badges */
    [class*="manus"],[id*="manus"],[class*="powered-by"],[class*="watermark"],[class*="badge"]{display:none!important}
    /* Aggressively hide bottom-right fixed overlays that aren't ours */
    body > div:not(#header):not(#map-wrap):not(#status-card):not(#arrived-overlay) { display:none!important; }
  </style>
</head>
<body>
  <div id="header">
    <div id="logo">🚐</div>
    <div id="header-text">
      <h1>Luxury Wash On Wheels</h1>
      <p id="header-sub"></p>
    </div>
  </div>
  <div id="map-wrap">
    <div id="map"></div>
    <div id="arrived-overlay">
      <div id="arrived-card">
        <div style="font-size:52px">✅</div>
        <h2 id="arrived-title">Detailer Has Arrived!</h2>
        <p id="arrived-sub">Your vehicle is in great hands.</p>
        <button id="arrived-btn" onclick="document.getElementById('arrived-overlay').style.display='none'">Got It</button>
      </div>
    </div>
  </div>
  <div id="bottom">
    <div id="status-row">
      <div id="status-badge">🚗 On the Way</div>
      <div id="live-badge"><span class="live-dot"></span>LIVE</div>
    </div>
    <div id="eta-row">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#0057FF" stroke-width="2"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
      <span id="eta-label">Estimated arrival:</span>
      <span id="eta-val">Calculating...</span>
    </div>
    <div id="dest-row">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#9ca3af" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>
      <span id="dest-text"></span>
    </div>
  </div>

  <script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
  <script>
    // ── Injected server data ──────────────────────────────────────────────
    var TOKEN = ${JSON.stringify(token)};
    var EXPIRES = new Date(${JSON.stringify(t.expiresAt.toISOString())});
    var DEST_LAT = ${t.customerLat != null ? JSON.stringify(String(t.customerLat)) : 'null'};
    var DEST_LNG = ${t.customerLng != null ? JSON.stringify(String(t.customerLng)) : 'null'};
    var CUSTOMER_ADDR = ${JSON.stringify(t.customerAddress ?? '')};
    var DETAILER_NAME = ${JSON.stringify(t.detailerName ?? 'Your detailer')};
    var CUSTOMER_NAME = ${JSON.stringify(t.customerName ?? '')};
    var API_BASE = window.location.origin;

    // ── Header text ───────────────────────────────────────────────────────
    document.getElementById('header-sub').textContent =
      DETAILER_NAME + ' is on the way' + (CUSTOMER_NAME ? ', ' + CUSTOMER_NAME : '') + '!';
    document.getElementById('dest-text').textContent = CUSTOMER_ADDR || 'Your location';

    // ── Map setup ─────────────────────────────────────────────────────────
    var map = L.map('map', { zoomControl: true, attributionControl: false });
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      maxZoom: 19
    }).addTo(map);

    var vanIcon = L.divIcon({
      html: '<div style="background:#fff;border-radius:50%;width:44px;height:44px;display:flex;align-items:center;justify-content:center;font-size:24px;box-shadow:0 2px 8px rgba(0,87,255,0.5);border:2px solid #0057FF">🚐</div>',
      iconSize:[44,44], iconAnchor:[22,22], className:''
    });
    var destIcon = L.divIcon({
      html: '<div style="background:#DC2626;border-radius:50% 50% 50% 0;width:32px;height:32px;transform:rotate(-45deg);display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,0.4)"><span style="transform:rotate(45deg);font-size:16px">🏠</span></div>',
      iconSize:[32,40], iconAnchor:[16,40], className:''
    });

    var vanMarker = null;
    var destMarker = null;
    var routeLine = null;
    var initialized = false;
    var arrived = false;

    // Place destination marker if coords available
    var dLat = DEST_LAT ? parseFloat(DEST_LAT) : null;
    var dLng = DEST_LNG ? parseFloat(DEST_LNG) : null;
    if (dLat && dLng && !isNaN(dLat) && !isNaN(dLng)) {
      destMarker = L.marker([dLat, dLng], { icon: destIcon }).addTo(map);
    }

    // ── OSRM route fetch ──────────────────────────────────────────────────
    async function fetchRoute(fromLat, fromLng, toLat, toLng) {
      try {
        var url = 'https://router.project-osrm.org/route/v1/driving/' +
          fromLng + ',' + fromLat + ';' + toLng + ',' + toLat +
          '?overview=full&geometries=geojson&steps=false';
        var r = await fetch(url, { signal: AbortSignal.timeout(8000) });
        if (!r.ok) return null;
        var j = await r.json();
        var route = j.routes && j.routes[0];
        if (!route) return null;
        var coords = route.geometry.coordinates.map(function(c) { return [c[1], c[0]]; });
        var durationSec = route.duration;
        return { coords: coords, durationSec: durationSec };
      } catch(e) { return null; }
    }

    function formatETA(sec) {
      if (sec < 60) return '< 1 min';
      var mins = Math.round(sec / 60);
      if (mins < 60) return mins + ' min';
      var hrs = Math.floor(mins / 60);
      var rem = mins % 60;
      return rem > 0 ? hrs + ' hr ' + rem + ' min' : hrs + ' hr';
    }

    // ── Poll for van location ─────────────────────────────────────────────
    async function poll() {
      if (arrived) return;
      if (new Date() > EXPIRES) {
        showArrived();
        return;
      }
      try {
        var r = await fetch(API_BASE + '/api/trpc/location.getByToken?input=' +
          encodeURIComponent(JSON.stringify({ json: { token: TOKEN } })));
        var j = await r.json();
        var loc = j && j.result && j.result.data && j.result.data.json;
        // getByToken returns { token, location } where location has { lat, lng }
        // tRPC wraps this as result.data.json = { token: {...}, location: {lat, lng} | null }
        if (loc && loc.token && loc.token.active === 'no') { showArrived(); return; }
        var locData = loc && loc.location;
        if (locData && locData.lat && locData.lng) {
          var lat = parseFloat(locData.lat);
          var lng = parseFloat(locData.lng);
          if (isNaN(lat) || isNaN(lng)) { setTimeout(poll, 15000); return; }

          // Place/move van marker
          if (!vanMarker) {
            vanMarker = L.marker([lat, lng], { icon: vanIcon }).addTo(map);
          } else {
            vanMarker.setLatLng([lat, lng]);
          }

          // Draw/update route
          if (dLat && dLng) {
            var routeData = await fetchRoute(lat, lng, dLat, dLng);
            if (routeData && routeData.coords.length > 1) {
              if (routeLine) map.removeLayer(routeLine);
              routeLine = L.polyline(routeData.coords, { color: '#0057FF', weight: 5, opacity: 0.9 }).addTo(map);
              document.getElementById('eta-val').textContent = formatETA(routeData.durationSec);
            }
          } else {
            document.getElementById('eta-val').textContent = 'En route';
          }

          // Fit map to show both van and destination
          if (!initialized) {
            if (destMarker && dLat && dLng) {
              map.fitBounds([[lat, lng], [dLat, dLng]], { padding: [60, 60] });
            } else {
              map.setView([lat, lng], 13);
            }
            initialized = true;
          }
        } else if (!initialized) {
          // No van location yet — center on destination or default area
          if (dLat && dLng) {
            map.setView([dLat, dLng], 13);
          } else {
            map.setView([30.4, -86.5], 11);
          }
          initialized = true;
        }
      } catch(e) { console.warn('poll error', e); }
      setTimeout(poll, 15000);
    }

    function showArrived() {
      arrived = true;
      document.getElementById('arrived-overlay').style.display = 'flex';
      document.getElementById('status-badge').innerHTML = '&#x2705; Arrived';
      document.getElementById('status-badge').style.background = '#D1FAE5';
      document.getElementById('status-badge').style.color = '#059669';
      document.getElementById('live-badge').style.display = 'none';
      document.getElementById('eta-val').textContent = 'Arrived!';
      document.getElementById('arrived-title').textContent = DETAILER_NAME + ' Has Arrived!';
      document.getElementById('arrived-sub').textContent = DETAILER_NAME + ' is at your location. Your detail is about to begin!';
    }

    poll();

    // Remove any injected third-party badges (e.g. "Made with Manus")
    function removeBadges() {
      document.querySelectorAll('body > *').forEach(function(el) {
        if (el.id === 'header' || el.id === 'map-wrap' || el.id === 'status-card' || el.id === 'arrived-overlay') return;
        var text = el.textContent || '';
        var cls = (el.className || '') + (el.id || '');
        if (text.toLowerCase().includes('manus') || cls.toLowerCase().includes('manus') || cls.toLowerCase().includes('powered') || cls.toLowerCase().includes('badge') || cls.toLowerCase().includes('watermark')) {
          el.style.display = 'none';
          el.remove();
        }
      });
    }
    removeBadges();
    var _badgeObserver = new MutationObserver(function() { removeBadges(); });
    _badgeObserver.observe(document.body, { childList: true, subtree: false });
  </script>
</body>
</html>`;
      res.setHeader("Content-Type", "text/html");
      res.send(pageHtml);
    } catch (err) {
      console.error("[Tracking page error]", err);
      res.status(500).send("Server error");
    }
  });

  // ─── Booking Detailers Endpoint (Phase B: customer selects preferred detailer) ─
  // URL: GET /api/booking/detailers?location=crestview
  app.get("/api/booking/detailers", async (req, res) => {
    res.header("Access-Control-Allow-Origin", "*");
    try {
      const locationParam = (req.query.location as string) || "";
      const location = db.normalizeLocation(locationParam);
      const knownLocations3 = ["crestview", "niceville", "destin", "fwb", "pensacola"];
      if (!location || !knownLocations3.includes(location)) {
        res.status(400).json({ error: `Unknown location: '${locationParam}'` });
        return;
      }
      const detailers = await db.getBookingFormDetailers(location);
      res.json({
        detailers: detailers.map(d => ({
          id: d.employeeId,
          name: d.fullName,
          photoUrl: d.profilePhotoUrl || null,
        })),
      });
    } catch (err) {
      console.error("[Booking detailers error]", err);
      res.status(500).json({ error: "Internal server error" });
    }
  });

  // ─── AI Receptionist Routes ──────────────────────────────────────────────────
  app.use("/api/receptionist", createReceptionistRouter());

  // ─── Phone System Routes ─────────────────────────────────────────────────────
  app.use("/api/phone", createPhoneRouter());

  // ─── Invoice Routes ──────────────────────────────────────────────────────────
  app.use("/api/invoice", createInvoiceRouter());

  // ─── VIP Program Routes ───────────────────────────────────────────────────────
  app.use("/api/vip", vipRouter);

  // ─── Tip Request Page ────────────────────────────────────────────────────────
  app.get("/tip/:token", async (req, res) => {
    const { token } = req.params;
    try {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      const [rows] = await conn.execute(`SELECT * FROM tip_requests WHERE token = ? LIMIT 1`, [token]) as [any[], any];
      await conn.end();
      if (rows.length === 0) {
        res.status(404).send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Not Found</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#fff;text-align:center;padding:20px}</style></head><body><div><h1>Link Not Found</h1><p style="color:#94a3b8">This tip link is invalid or has expired.</p></div></body></html>`);
        return;
      }
      const tip = rows[0];
      if (tip.status === 'completed') {
        res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Tip Sent</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;background:#0f172a;color:#fff;min-height:100vh;display:flex;align-items:center;justify-content:center;text-align:center;padding:32px}</style></head><body><div><div style="font-size:64px;margin-bottom:20px">&#x1F49A;</div><h1>Thank you!</h1><p style="color:#94a3b8">Your tip has already been processed. Your detailer truly appreciates your generosity!</p></div></body></html>`);
        return;
      }
      if (tip.status === 'expired' || new Date(tip.expires_at) < new Date()) {
        res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Expired</title><meta name="viewport" content="width=device-width,initial-scale=1"><style>body{font-family:-apple-system,sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#0f172a;color:#fff;text-align:center;padding:20px}</style></head><body><div><h1>Link Expired</h1><p style="color:#94a3b8">This tip link has expired. Thank you for your service!</p></div></body></html>`);
        return;
      }
      const firstName = (tip.customer_name ?? '').split(' ')[0] || 'there';
      const cardBrand = tip.card_brand ? (tip.card_brand.charAt(0).toUpperCase() + tip.card_brand.slice(1)) : 'Card';
      const serviceTotal = parseFloat(tip.service_total || '0');
      const presets = [15, 18, 20, 25];
      const presetBtns = presets.map((p: number) => {
        const amt = (serviceTotal * p / 100).toFixed(2);
        return `<button class="preset" data-pct="${p}" onclick="selectPreset(${p},${amt})"><span class="pct">${p}%</span><span class="amt">$${amt}</span></button>`;
      }).join('');
      res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Leave a Tip</title><style>*{box-sizing:border-box;margin:0;padding:0}body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}#card{background:#1e293b;border-radius:20px;padding:32px 24px;max-width:400px;width:100%;border:1px solid #334155}h1{font-size:1.4rem;font-weight:800;margin-bottom:4px;text-align:center}.sub{color:#94a3b8;font-size:.9rem;text-align:center;margin-bottom:24px}.svc{background:#0f172a;border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #334155}.svc p{color:#94a3b8;font-size:.8rem;margin-bottom:4px;text-transform:uppercase;letter-spacing:.5px}.svc .val{color:#fff;font-size:1rem;font-weight:600}.presets{display:grid;grid-template-columns:repeat(4,1fr);gap:10px;margin-bottom:16px}.preset{background:#0f172a;border:2px solid #334155;border-radius:12px;padding:12px 4px;cursor:pointer;display:flex;flex-direction:column;align-items:center;gap:4px}.preset.sel{background:#05966922;border-color:#059669}.preset .pct{color:#fff;font-size:.95rem;font-weight:700}.preset .amt{color:#94a3b8;font-size:.8rem}.preset.sel .amt{color:#4ade80}.alt-row{display:flex;gap:10px;margin-bottom:20px}.alt-btn{flex:1;background:#0f172a;border:2px solid #334155;border-radius:12px;padding:12px;cursor:pointer;color:#94a3b8;font-size:.9rem;font-weight:600;text-align:center}.alt-btn.sel{border-color:#fff;color:#fff}#cw{margin-bottom:20px;display:none}#cw label{color:#94a3b8;font-size:.8rem;display:block;margin-bottom:6px}#ci{width:100%;background:#0f172a;border:2px solid #334155;border-radius:12px;padding:14px;color:#fff;font-size:1.2rem;text-align:center;outline:none}#ci:focus{border-color:#059669}.sum{background:#0f172a;border-radius:12px;padding:16px;margin-bottom:20px;border:1px solid #334155}.sr{display:flex;justify-content:space-between;margin-bottom:8px;font-size:.9rem}.sr.tot{font-size:1.1rem;font-weight:700;border-top:1px solid #334155;padding-top:10px;margin-top:4px}.sr .lbl{color:#94a3b8}.sr .val{color:#fff}.sr.tot .val{color:#0a7ea4}#sb{width:100%;background:#059669;color:#fff;border:none;border-radius:14px;padding:16px;font-size:1rem;font-weight:700;cursor:pointer}#sb:disabled{opacity:.5;cursor:not-allowed}#skip{width:100%;background:transparent;color:#475569;border:none;padding:12px;font-size:.85rem;cursor:pointer;margin-top:8px}#res{display:none;text-align:center;padding:20px 0}#brand{margin-top:24px;font-size:.75rem;color:#475569;text-align:center}#brand span{color:#0a7ea4;font-weight:600}</style></head><body><div id="card"><div id="fv"><div style="font-size:48px;text-align:center;margin-bottom:12px">&#x1F4B0;</div><h1>Leave a Tip</h1><p class="sub">For ${tip.detailer_name ? tip.detailer_name.split(' ')[0] : 'your detailer'} &middot; ${tip.service_title || 'your service'}</p><div class="svc"><p>Hi ${firstName}! Service charged to</p><div class="val">${cardBrand} &bull;&bull;&bull;&bull; ${tip.card_last4 || '****'} &nbsp;&middot;&nbsp; $${serviceTotal.toFixed(2)}</div></div><div class="presets">${presetBtns}</div><div class="alt-row"><button class="alt-btn" id="ntb" onclick="selNoTip()">No Tip</button><button class="alt-btn" id="cb" onclick="selCustom()" style="flex:2">Custom Amount</button></div><div id="cw"><label>Custom Tip ($)</label><input id="ci" type="number" min="0" step="0.01" placeholder="0.00" oninput="onCI()"></div><div class="sum"><div class="sr"><span class="lbl">Service</span><span class="val">$${serviceTotal.toFixed(2)}</span></div><div class="sr"><span class="lbl">Tip</span><span class="val" id="td">&mdash;</span></div><div class="sr tot"><span class="lbl">Total</span><span class="val" id="totd">$${serviceTotal.toFixed(2)}</span></div></div><button id="sb" disabled onclick="submit()">Select a tip amount</button><button id="skip" onclick="skip()">No thanks, skip</button></div><div id="res"></div><p id="brand">Powered by <span>Luxury Wash On Wheels</span></p></div><script>var tok='${token}',st=parseFloat('${serviceTotal.toFixed(2)}'),sa=null,int2=false;function selectPreset(p,a){sa=parseFloat(a);int2=false;document.querySelectorAll('.preset').forEach(function(b){b.classList.toggle('sel',parseFloat(b.dataset.pct)===p);});document.getElementById('ntb').classList.remove('sel');document.getElementById('cb').classList.remove('sel');document.getElementById('cw').style.display='none';upd(sa);}function selNoTip(){sa=0;int2=true;document.querySelectorAll('.preset').forEach(function(b){b.classList.remove('sel');});document.getElementById('ntb').classList.add('sel');document.getElementById('cb').classList.remove('sel');document.getElementById('cw').style.display='none';document.getElementById('td').textContent='None';document.getElementById('totd').textContent='$'+st.toFixed(2);var b=document.getElementById('sb');b.disabled=false;b.textContent='Skip Tip';}function selCustom(){int2=false;sa=null;document.querySelectorAll('.preset').forEach(function(b){b.classList.remove('sel');});document.getElementById('ntb').classList.remove('sel');document.getElementById('cb').classList.add('sel');document.getElementById('cw').style.display='block';document.getElementById('ci').focus();document.getElementById('sb').disabled=true;document.getElementById('sb').textContent='Enter tip amount';}function onCI(){var v=parseFloat(document.getElementById('ci').value)||0;sa=v;upd(v);}function upd(t){var a=parseFloat(t)||0;document.getElementById('td').textContent=a>0?'+$'+a.toFixed(2):'None';document.getElementById('totd').textContent='$'+(st+a).toFixed(2);var b=document.getElementById('sb');b.disabled=false;b.textContent=a>0?'Leave $'+a.toFixed(2)+' Tip →':'Continue';}async function submit(){if(int2){skip();return;}var a=sa||0;var b=document.getElementById('sb');b.disabled=true;b.textContent='Processing…';try{var r=await fetch('/api/tip/'+tok+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tipAmountCents:Math.round(a*100)})});var d=await r.json();if(d.success){document.getElementById('fv').style.display='none';document.getElementById('res').style.display='block';document.getElementById('res').innerHTML='<div style="font-size:64px;margin-bottom:16px">&#x1F49A;</div><h2 style="font-size:1.4rem;font-weight:800;margin-bottom:8px">Thank you!</h2><p style="color:#94a3b8;font-size:.9rem">Your $'+a.toFixed(2)+' tip has been sent to your detailer!</p>';}else{b.disabled=false;b.textContent='Try Again';alert(d.error||'Something went wrong.');}}catch(e){b.disabled=false;b.textContent='Try Again';alert('Network error.');}}async function skip(){await fetch('/api/tip/'+tok+'/submit',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({tipAmountCents:0})});document.getElementById('fv').style.display='none';document.getElementById('res').style.display='block';document.getElementById('res').innerHTML='<div style="font-size:64px;margin-bottom:16px">&#x1F64F;</div><h2 style="font-size:1.4rem;font-weight:800;margin-bottom:8px">Thanks for choosing us!</h2><p style="color:#94a3b8;font-size:.9rem">We hope you enjoyed your service. See you next time!</p>';}</script></body></html>`);
    } catch (err) {
      console.error('[Tip page error]', err);
      res.status(500).send('An error occurred.');
    }
  });

  app.post("/api/tip/:token/submit", async (req, res) => {
    const { token } = req.params;
    const { tipAmountCents } = req.body as { tipAmountCents: number };
    try {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      const [rows] = await conn.execute(`SELECT * FROM tip_requests WHERE token = ? LIMIT 1`, [token]) as [any[], any];
      if (rows.length === 0) { await conn.end(); res.status(404).json({ success: false, error: 'Invalid link' }); return; }
      const tip = rows[0];
      if (tip.status !== 'pending') { await conn.end(); res.json({ success: true, alreadyProcessed: true }); return; }
      if (new Date(tip.expires_at) < new Date()) {
        await conn.execute(`UPDATE tip_requests SET status='expired' WHERE token=?`, [token]);
        await conn.end(); res.status(410).json({ success: false, error: 'This link has expired' }); return;
      }
      if (!tipAmountCents || tipAmountCents <= 0) {
        await conn.execute(`UPDATE tip_requests SET status='skipped', completed_at_tr=NOW() WHERE token=?`, [token]);
        await conn.end(); res.json({ success: true, skipped: true }); return;
      }
      const stripeKey = process.env.STRIPE_SK || process.env.STRIPE_SECRET_KEY;
      if (!stripeKey) { await conn.end(); res.status(500).json({ success: false, error: 'Payment not configured' }); return; }
      const StripeLib = (await import('stripe')).default;
      const stripe = new StripeLib(stripeKey, { apiVersion: '2025-03-31.basil' });
      const pi = await stripe.paymentIntents.create({
        amount: tipAmountCents,
        currency: 'usd',
        customer: tip.stripe_customer_id,
        payment_method: tip.stripe_payment_method_id,
        confirm: true,
        off_session: true,
        description: `Tip for ${tip.service_title || 'service'} - ${tip.customer_name}`,
      });
      await conn.execute(`UPDATE tip_requests SET status='completed', tip_amount_cents=?, tip_payment_intent_id=?, completed_at_tr=NOW() WHERE token=?`, [tipAmountCents, pi.id, token]);
      await conn.end();
      res.json({ success: true, paymentIntentId: pi.id });
    } catch (err: any) {
      console.error('[Tip submit error]', err);
      res.status(500).json({ success: false, error: err.message || 'Payment failed' });
    }
  });

  // ─── Google Places Autocomplete Proxy (avoids HTTP referrer restrictions on client key) ───
  app.get("/api/places/autocomplete", async (req, res) => {
    try {
      const input = req.query.input as string;
      const region = (req.query.region as string) || "us";
      const countries = (req.query.countries as string) || "country:us";
      if (!input || input.length < 3) {
        return res.json({ status: "OK", predictions: [] });
      }
      const googleKey = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_API_KEY;
      if (!googleKey) {
        return res.status(500).json({ error: "Google Maps API key not configured" });
      }
      const url = `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=${encodeURIComponent(input)}&types=address&components=${encodeURIComponent(countries)}&region=${region}&key=${googleKey}`;
      const response = await fetch(url);
      const data = await response.json();
      res.json(data);
    } catch (e: any) {
      console.error("[Places Proxy] Error:", e.message);
      res.status(500).json({ error: "Places API request failed" });
    }
  });

  // ─── Hero Media Config (swap video/image without rebuild) ───
  app.get("/api/hero-config", async (_req, res) => {
    try {
      const conn = await mysql.createConnection(process.env.DATABASE_URL!);
      const [rows] = await conn.execute(
        `SELECT config_key, config_value FROM app_config WHERE config_key IN ('hero_media_type', 'hero_media_url', 'action_media_type', 'action_media_url')`
      ) as [any[], any];
      await conn.end();
      const config: Record<string, string> = {};
      for (const row of rows) config[row.config_key] = row.config_value;
      res.json({
        hero: {
          type: config.hero_media_type || "video",
          url: config.hero_media_url || "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/fpqXAGrHvrcJIMSV.mov",
        },
        action: {
          type: config.action_media_type || "video",
          url: config.action_media_url || "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/gXquUlgUBSvKrZIH.mov",
        },
      });
    } catch (e) {
      // Fallback if table doesn't exist yet
      res.json({
        hero: { type: "video", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/fpqXAGrHvrcJIMSV.mov" },
        action: { type: "video", url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/gXquUlgUBSvKrZIH.mov" },
      });
    }
  });

  // Password reset — GET serves the web form, POST processes it
  // The email contains https://luxurywashonwheels.app/api/reset-password?token=...
  // Works in browser (web form) AND redirects to the native app if installed
  const resetPasswordPage = (token: string, error?: string, success?: boolean) => `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Reset Password – Luxury Wash On Wheels</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0a0a0a;color:#fff;min-height:100vh;display:flex;flex-direction:column;align-items:center;justify-content:center;padding:24px}
    .card{background:#1a1a1a;border:1px solid #2a2a2a;border-radius:16px;padding:32px 28px;width:100%;max-width:400px}
    .logo{font-size:20px;font-weight:700;color:#fff;margin-bottom:4px}
    .sub{font-size:13px;color:#666;margin-bottom:28px}
    h1{font-size:22px;font-weight:700;margin-bottom:8px}
    .desc{font-size:14px;color:#888;margin-bottom:24px;line-height:1.5}
    label{display:block;font-size:12px;font-weight:600;color:#aaa;text-transform:uppercase;letter-spacing:.5px;margin-bottom:6px}
    input{width:100%;background:#111;border:1px solid #333;border-radius:10px;color:#fff;font-size:16px;padding:14px 16px;margin-bottom:16px;outline:none}
    input:focus{border-color:#0a7ea4}
    button{width:100%;background:#0a7ea4;color:#fff;border:none;border-radius:10px;font-size:16px;font-weight:700;padding:15px;cursor:pointer;margin-top:4px}
    button:disabled{opacity:.5;cursor:not-allowed}
    .error{background:#3a1a1a;border:1px solid #7a2a2a;border-radius:8px;color:#f87171;font-size:14px;padding:12px 16px;margin-bottom:16px}
    .success{background:#0d2a1a;border:1px solid #166534;border-radius:8px;color:#4ade80;font-size:14px;padding:12px 16px;margin-bottom:16px;text-align:center}
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Luxury Wash On Wheels</div>
    <div class="sub">Mobile Detailing</div>
    <h1>${success ? 'Password Updated!' : 'Set Your Password'}</h1>
    <p class="desc">${success ? 'Your password has been set. You can now sign in to the Luxury Wash app.' : 'Create a password for your customer portal account.'}</p>
    ${error ? `<div class="error">${error}</div>` : ''}
    ${success ? `<div class="success">✓ Password set successfully! Open the Luxury Wash app to sign in.</div>` : `
    <form method="POST" action="/api/reset-password" id="form">
      <input type="hidden" name="token" value="${token}">
      <label>New Password</label>
      <input type="password" name="password" placeholder="At least 6 characters" required minlength="6" autocomplete="new-password">
      <label>Confirm Password</label>
      <input type="password" name="confirm" placeholder="Repeat your password" required minlength="6" autocomplete="new-password">
      <button type="submit" id="btn">Set Password</button>
    </form>
    <script>
      document.getElementById('form').addEventListener('submit',function(e){
        var p=this.password.value,c=this.confirm.value;
        if(p!==c){e.preventDefault();alert('Passwords do not match.');return;}
        document.getElementById('btn').disabled=true;
        document.getElementById('btn').textContent='Setting password...';
      });
    </script>`}
  </div>
</body>
</html>`;

  app.get("/api/reset-password", (req, res) => {
    const token = req.query.token as string | undefined;
    if (!token) return res.status(400).send(resetPasswordPage('', 'This password reset link is missing a token. Please request a new one.'));
    return res.send(resetPasswordPage(token));
  });

  app.post("/api/reset-password", express.urlencoded({ extended: false }), async (req, res) => {
    const { token, password, confirm } = req.body as { token?: string; password?: string; confirm?: string };
    if (!token) return res.status(400).send(resetPasswordPage('', 'Invalid request — missing token.'));
    if (!password || password.length < 6) return res.send(resetPasswordPage(token, 'Password must be at least 6 characters.'));
    if (password !== confirm) return res.send(resetPasswordPage(token, 'Passwords do not match.'));
    try {
      const cdb = await import('../customerDb');
      const customerId = await cdb.validatePasswordResetToken(token);
      if (!customerId) return res.send(resetPasswordPage(token, 'This link has expired or has already been used. Please request a new password reset.'));
      await cdb.setCustomerPassword(customerId, password);
      await cdb.consumePasswordResetToken(token);
      return res.send(resetPasswordPage('', undefined, true));
    } catch (err) {
      console.error('[reset-password web]', err);
      return res.send(resetPasswordPage(token, 'Something went wrong. Please try again.'));
    }
  });

  app.get("/reset-password", (req, res) => res.redirect(301, `/api/reset-password${req.url.includes('?') ? req.url.slice(req.url.indexOf('?') - 1) : ''}?${new URLSearchParams(req.query as any).toString()}`));

  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
    }),
  );

  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);

  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }

  server.listen(port, () => {
    console.log(`[api] server listening on port ${port}`);

    // Auto-configure phone system webhooks on startup if Twilio credentials are set.
    // This ensures the voice/SMS URLs always point to /api/phone/* (not the old receptionist route).
    if (process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN) {
      setTimeout(() => {
        fetch(`http://127.0.0.1:${port}/api/phone/configure-webhooks`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        })
          .then(r => r.json())
          .then((data: any) => console.log(`[Phone] Webhooks auto-configured:`, JSON.stringify(data.results ?? data.error)))
          .catch(e => console.warn(`[Phone] Webhook auto-configure failed: ${e.message}`));
      }, 2000); // small delay to ensure phone router is ready
    }

    // Keep-alive ping every 4 minutes to prevent Cloud Run cold starts
    // (Cloud Run scales to zero after ~15min of inactivity — this keeps the server warm)
    setInterval(() => {
      fetch(`http://127.0.0.1:${port}/api/health`)
        .catch(() => { /* silent — just keeping the process alive */ });
    }, 4 * 60 * 1000);

    // Process queued emails every 5 minutes (sends emails held during quiet hours)
    import("../email.js").then(({ processEmailQueue }) => {
      setInterval(() => {
        processEmailQueue().catch(e => console.error("[EmailQueue] Interval error:", e));
      }, 5 * 60 * 1000);
      // Also run once on startup to catch any emails queued before restart
      processEmailQueue().catch(e => console.error("[EmailQueue] Startup error:", e));
    });
  });
}

startServer().catch(console.error);

// Start the automated clock monitor (5PM prompt, 5:30PM auto-out, break overrun)
startClockMonitor();

// Start the callback reminder monitor (15-min pre-call notifications)
startCallbackReminderMonitor();
// Start the appointment confirmation monitor (24hr reminder + 6hr no-response alert)
startApptConfirmationMonitor();
// Start the auto-deduction monitor (morning meeting, photos, on-my-way checks)
startAutoDeductMonitor();
// Start the abandoned cart recovery monitor (30-min SMS + email + admin push)
startAbandonedCartMonitor();
// Start the Stripe reconciliation job (auto-sync unpaid jobs every 5 minutes)
startStripeReconciliationJob();
// Start the loan payment reminder scheduler (daily at 9 AM)
startPaymentReminderScheduler();

// ─── Booking SMS Confirmation ────────────────────────────────────────────────
/**
 * Sends a Twilio SMS confirmation to the customer after a successful booking.
 * Called from the booking webhook handler (non-blocking).
 */
export async function sendBookingConfirmationSms(params: {
  phone: string;
  firstName: string;
  lastName: string;
  date: string;
  time: string;
  vehicleType: string | null;
  packageType: string | null;
  streetAddress: string | null;
  city: string | null;
  finalTotal: string | null;
}): Promise<void> {
  // SMS DISABLED: A2P 10DLC campaign pending approval — re-enable by setting SMS_ENABLED=true
  if (process.env.SMS_ENABLED !== "true") {
    console.log("[SMS] Outbound SMS disabled — A2P campaign pending. Skipping booking confirmation SMS.");
    return;
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    console.warn('[Booking SMS] Twilio credentials not set — skipping confirmation SMS');
    return;
  }
  const { phone, firstName, date, time, vehicleType, packageType, streetAddress, city, finalTotal } = params;
  const addressLine = [streetAddress, city].filter(Boolean).join(', ');
  const serviceDesc = [vehicleType, packageType].filter(Boolean).join(' — ');
  const priceStr = finalTotal ? `$${parseFloat(finalTotal).toFixed(2)}` : '';
  const msg = [
    `Hi ${firstName}! Your Luxury Wash on Wheels appointment request has been received 🚐`,
    `📅 ${date}`,
    `⏰ ${time}`,
    serviceDesc ? `🚗 ${serviceDesc}` : null,
    addressLine ? `📍 ${addressLine}` : null,
    priceStr ? `💰 ${priceStr}` : null,
    `\nReply C to confirm your appointment.`,
    `Questions? Call 850-517-7874.`,
  ].filter(Boolean).join('\n');
  try {
    const toNumber = phone.startsWith('+') ? phone : `+1${phone.replace(/\D/g, '')}`;
    const body = new URLSearchParams({ To: toNumber, From: fromNumber, Body: msg });
    const response = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString('base64')}`,
        },
        body: body.toString(),
      },
    );
    if (response.ok) {
      console.log(`[Booking SMS] Confirmation sent to ${toNumber}`);
    } else {
      const text = await response.text();
      console.error(`[Booking SMS] Twilio error ${response.status}: ${text}`);
    }
  } catch (err) {
    console.error('[Booking SMS] Failed to send confirmation:', err);
  }
}

// ─── GHL SMS Trigger ─────────────────────────────────────────────────────────
/**
 * Sends a payload to the Go High Level webhook URL to trigger the automated
 * SMS confirmation to the prospect. The GHL webhook URL is stored in the
 * GHL_WEBHOOK_URL environment variable.
 */
export async function triggerGhlSms(
  callbackId: string,
  prospectFirstName: string,
  prospectPhone: string,
  scheduledAt: string,
  timezone: string,
): Promise<void> {
  const ghlWebhookUrl = process.env.GHL_WEBHOOK_URL;
  if (!ghlWebhookUrl) {
    console.warn("[GHL] GHL_WEBHOOK_URL not set — skipping SMS trigger");
    await db.updateSalesCallbackStatus(callbackId, { ghlTriggered: "no" });
    return;
  }

  // Format the scheduled time in a human-readable way for the SMS
  const dt = new Date(scheduledAt);
  const dateStr = dt.toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: timezone });
  const timeStr = dt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true, timeZone: timezone });

  const payload = {
    callback_id: callbackId,
    first_name: prospectFirstName,
    phone: prospectPhone,
    scheduled_date: dateStr,
    scheduled_time: timeStr,
    scheduled_iso: scheduledAt,
    timezone,
    sms_message: `Hi ${prospectFirstName}, great speaking with you today! I have our follow-up call scheduled for ${dateStr} at ${timeStr}. Talk to you then!`,
  };

  try {
    const response = await fetch(ghlWebhookUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const responseText = await response.text();
    await db.updateSalesCallbackStatus(callbackId, {
      ghlTriggered: response.ok ? "yes" : "failed",
      ghlTriggeredAt: new Date(),
      ghlPayload: JSON.stringify(payload),
      ghlResponse: responseText.substring(0, 500),
    });
    if (response.ok) {
      console.log(`[GHL] SMS triggered for callback ${callbackId}`);
    } else {
      console.error(`[GHL] Webhook returned ${response.status} for callback ${callbackId}: ${responseText}`);
    }
  } catch (err) {
    console.error(`[GHL] Failed to trigger SMS for callback ${callbackId}:`, err);
    await db.updateSalesCallbackStatus(callbackId, {
      ghlTriggered: "failed",
      ghlTriggeredAt: new Date(),
      ghlPayload: JSON.stringify(payload),
      ghlResponse: String(err),
    });
  }
}
