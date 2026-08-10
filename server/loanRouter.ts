import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { loanContracts, loanPaymentSchedules, loanPayments, loanPaymentReminders } from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";

import * as db from "./db";
import { generatePaymentSchedule } from "./loanHelpers";
import { generateLoanContractPDF } from "./loanContractGenerator";
import { buildLoanContractEmail, buildPaymentReminderEmail, buildContractSignedEmail } from "./loanEmailTemplates";
import { sendEmail } from "./email";
import { storagePut } from "./storage";

export const loanRouter = router({
  // Create a new loan contract
  createLoan: publicProcedure
    .input(
      z.object({
        borrowerName: z.string().min(1),
        borrowerEmail: z.string().email(),
        borrowerPhone: z.string().optional(),
        principalAmount: z.number().positive(),
        totalRepaymentAmount: z.number().positive(),
        numberOfPayments: z.number().int().positive(),
        paymentFrequency: z.enum(["weekly", "biweekly", "monthly"]),
        paymentDayOfWeek: z.number().int().min(0).max(6).optional(),
        paymentDayOfMonth: z.string().optional(),
        startDate: z.date(),
      })
    )
    .mutation(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      const loanId = `loan_${crypto.randomUUID()}`;

      // Validate that total repayment > principal
      if (input.totalRepaymentAmount <= input.principalAmount) {
        throw new Error("Total repayment must be greater than principal amount");
      }

      // Validate payment day based on frequency
      if (input.paymentFrequency === "weekly" || input.paymentFrequency === "biweekly") {
        if (input.paymentDayOfWeek === undefined) {
          throw new Error("Payment day of week is required for weekly/biweekly payments");
        }
      } else if (input.paymentFrequency === "monthly") {
        if (!input.paymentDayOfMonth) {
          throw new Error("Payment day of month is required for monthly payments");
        }
      }

      // Create loan contract
// @ts-ignore
      await drizzleDb.insert(loanContracts).values({
// @ts-ignore
        loanId,
        borrowerName: input.borrowerName,
        borrowerEmail: input.borrowerEmail,
        borrowerPhone: input.borrowerPhone,
        principalAmount: input.principalAmount,
        totalRepaymentAmount: input.totalRepaymentAmount,
        numberOfPayments: input.numberOfPayments,
        paymentFrequency: input.paymentFrequency,
        paymentDayOfWeek: input.paymentDayOfWeek != null ? String(input.paymentDayOfWeek) : null,
        paymentDayOfMonth: input.paymentDayOfMonth != null ? String(input.paymentDayOfMonth) : null,
        startDate: input.startDate,
        status: "draft",
      });

      // Generate payment schedule
      const schedule = generatePaymentSchedule(
        loanId,
        input.numberOfPayments,
        input.totalRepaymentAmount / input.numberOfPayments,
        input.startDate,
        input.paymentFrequency,
        input.paymentDayOfWeek,
        input.paymentDayOfMonth
      );

      // Insert payment schedules
      for (const payment of schedule) {
        await drizzleDb.insert(loanPaymentSchedules).values(payment);
      }

      return { loanId, status: "draft" };
    }),

  // Get loan details with schedule and payments
  getLoanDetail: publicProcedure
    .input(z.object({ loanId: z.string() }))
    .query(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      const contract = await drizzleDb
        .select()
        .from(loanContracts)
        .where(eq(loanContracts.loanId, input.loanId))
        .limit(1);

      if (!contract.length) throw new Error("Loan not found");

      const schedule = await drizzleDb
        .select()
        .from(loanPaymentSchedules)
        .where(eq(loanPaymentSchedules.loanId, input.loanId))
        .orderBy(loanPaymentSchedules.paymentNumber);

      const payments = await drizzleDb
        .select()
        .from(loanPayments)
        .where(eq(loanPayments.loanId, input.loanId))
        .orderBy(desc(loanPayments.createdAt));

      const totalPaid = payments.reduce((sum, p) => sum + Number(p.amountPaid), 0);
      const totalRepayment = Number(contract[0].totalRepaymentAmount);
      const completionPercentage = (totalPaid / totalRepayment) * 100;
      const remainingBalance = Number(totalRepayment) - Number(totalPaid);

      const nextPayment = schedule.find((s) => s.status !== "completed");

      return {
        contract: contract[0],
        schedule,
        payments,
        nextPayment,
        totalPaid,
        remainingBalance,
        completionPercentage,
      };
    }),

  // List all loans
  adminListLoans: publicProcedure
    .input(
      z.object({
        status: z.string().optional(),
        search: z.string().optional(),
      })
    )
    .query(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      let query = drizzleDb.select().from(loanContracts);

// @ts-ignore
      if (input.status) {
// @ts-ignore
        query = query.where(eq(loanContracts.status, input.status as any));
      }

      const loans = await query.orderBy(desc(loanContracts.createdAt));

      if (input.search) {
        return loans.filter(
          (loan) =>
            loan.borrowerName.toLowerCase().includes(input.search!.toLowerCase()) ||
            loan.borrowerEmail.toLowerCase().includes(input.search!.toLowerCase())
        );
      }

      return loans;
    }),

  // Record a payment
  recordPayment: publicProcedure
    .input(
      z.object({
        loanId: z.string(),
        scheduleId: z.string(),
        amountPaid: z.number().positive(),
        paidDate: z.date(),
        paymentMethod: z.string().optional(),
        notes: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      const paymentId = `payment_${crypto.randomUUID()}`;

      // Get schedule to find payment number
      const schedule = await drizzleDb
        .select()
        .from(loanPaymentSchedules)
        .where(eq(loanPaymentSchedules.scheduleId, input.scheduleId))
        .limit(1);

      if (!schedule.length) throw new Error("Schedule not found");

// @ts-ignore
      // Record payment
      await drizzleDb.insert(loanPayments).values({
        paymentId,
        loanId: input.loanId,
        scheduleId: input.scheduleId,
        paymentNumber: schedule[0].paymentNumber,
        amountPaid: input.amountPaid,
        paidDate: input.paidDate,
        paymentMethod: input.paymentMethod,
        notes: input.notes,
        recordedBy: "admin",
      });

      // Update schedule status to completed
      await drizzleDb
        .update(loanPaymentSchedules)
        .set({ status: "completed" })
        .where(eq(loanPaymentSchedules.scheduleId, input.scheduleId));

      return { paymentId, status: "recorded" };
    }),

  // Get payment schedule
  getPaymentSchedule: publicProcedure
    .input(z.object({ loanId: z.string() }))
    .query(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      return await drizzleDb
        .select()
        .from(loanPaymentSchedules)
        .where(eq(loanPaymentSchedules.loanId, input.loanId))
        .orderBy(loanPaymentSchedules.paymentNumber);
    }),

  // Update loan terms (recalculates schedule)
  updateLoanTerms: publicProcedure
    .input(
      z.object({
        loanId: z.string(),
        totalRepaymentAmount: z.number().positive().optional(),
        numberOfPayments: z.number().int().positive().optional(),
        paymentFrequency: z.enum(["weekly", "biweekly", "monthly"]).optional(),
        paymentDayOfWeek: z.number().int().min(0).max(6).optional(),
        paymentDayOfMonth: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      // Get current contract
      const contract = await drizzleDb
        .select()
        .from(loanContracts)
        .where(eq(loanContracts.loanId, input.loanId))
        .limit(1);

      if (!contract.length) throw new Error("Loan not found");

      const current = contract[0];

      // Check if any payments have been made
      const payments = await drizzleDb
        .select()
        .from(loanPayments)
        .where(eq(loanPayments.loanId, input.loanId));

      if (payments.length > 0) {
        throw new Error("Cannot edit loan after first payment has been made");
      }

      const totalRepayment = input.totalRepaymentAmount ?? current.totalRepaymentAmount;
      const numberOfPayments = input.numberOfPayments ?? current.numberOfPayments;
      const paymentFrequency = input.paymentFrequency ?? current.paymentFrequency;
      const paymentDayOfWeek = input.paymentDayOfWeek ?? current.paymentDayOfWeek;
      const paymentDayOfMonth = input.paymentDayOfMonth ?? current.paymentDayOfMonth;

      // Update contract
      await drizzleDb
        .update(loanContracts)
// @ts-ignore
        .set({
// @ts-ignore
          totalRepaymentAmount: totalRepayment,
          numberOfPayments,
          paymentFrequency,
          paymentDayOfWeek,
          paymentDayOfMonth,
        })
        .where(eq(loanContracts.loanId, input.loanId));

      // Delete old schedule
      await drizzleDb
        .delete(loanPaymentSchedules)
        .where(eq(loanPaymentSchedules.loanId, input.loanId));

      // Generate new schedule
      const schedule = generatePaymentSchedule(
        input.loanId,
// @ts-ignore
        numberOfPayments,
        Number(totalRepayment) / Number(numberOfPayments),
        current.startDate,
// @ts-ignore
        paymentFrequency,
// @ts-ignore
        paymentDayOfWeek,
        (paymentDayOfMonth ?? undefined) as number | undefined
      );

      // Insert new schedules
      for (const payment of schedule) {
        await drizzleDb.insert(loanPaymentSchedules).values(payment);
      }

      return { status: "updated" };
    }),

  // Update loan status
  updateLoanStatus: publicProcedure
    .input(
      z.object({
        loanId: z.string(),
        status: z.enum(["draft", "pending_signature", "active", "completed", "cancelled"]),
      })
    )
    .mutation(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      await drizzleDb
        .update(loanContracts)
        .set({ status: input.status })
        .where(eq(loanContracts.loanId, input.loanId));

      return { status: "updated" };
    }),

  // Phase 3: Generate and send contract to borrower
  sendContractForSignature: publicProcedure
    .input(z.object({ loanId: z.string() }))
    .mutation(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      // Get loan details
      const loan = await drizzleDb
        .select()
        .from(loanContracts)
        .where(eq(loanContracts.loanId, input.loanId))
        .limit(1);

      if (!loan.length) throw new Error("Loan not found");

      const loanData = loan[0];

      // Get payment schedule
      const schedule = await drizzleDb
        .select()
        .from(loanPaymentSchedules)
        .where(eq(loanPaymentSchedules.loanId, input.loanId))
        .orderBy(loanPaymentSchedules.paymentNumber);

      // Generate PDF
      const pdfBuffer = await generateLoanContractPDF({
        loanId: loanData.loanId,
        borrowerName: loanData.borrowerName,
        borrowerEmail: loanData.borrowerEmail,
        borrowerPhone: loanData.borrowerPhone || undefined,
        principalAmount: Number(loanData.principalAmount),
        totalRepaymentAmount: Number(loanData.totalRepaymentAmount),
        numberOfPayments: loanData.numberOfPayments,
        paymentFrequency: loanData.paymentFrequency,
        paymentAmount: Number(loanData.totalRepaymentAmount) / loanData.numberOfPayments,
        interest: Number(loanData.totalRepaymentAmount) - Number(loanData.principalAmount),
        startDate: loanData.startDate,
        schedule: schedule.map((s) => ({
          paymentNumber: s.paymentNumber,
          dueDate: s.dueDate,
          amountDue: Number(s.amountDue),
        })),
      });

      // Upload PDF to storage
      const fileName = `loan-contract-${loanData.loanId}-${Date.now()}.pdf`;
      const _contractUpload = await storagePut(fileName, pdfBuffer, "application/pdf");
    const contractUrl = _contractUpload.url;

      // Update loan with contract URL
      await drizzleDb
        .update(loanContracts)
        .set({
          contractUrl,
          status: "pending_signature",
        })
        .where(eq(loanContracts.loanId, input.loanId));

      // Build signature link
      const signatureLink = `${process.env.VITE_APP_URL || "https://luxurywashonwheels.app"}/sign-loan/${input.loanId}`;

      // Send email with contract
      const { subject, html } = buildLoanContractEmail(
        loanData.borrowerName,
        loanData.loanId,
        Number(loanData.principalAmount),
        Number(loanData.totalRepaymentAmount),
        loanData.numberOfPayments,
        loanData.paymentFrequency,
        signatureLink
      );

      await sendEmail({
        to: loanData.borrowerEmail,
        subject,
        html,
      });

      return {
        success: true,
        contractUrl,
        message: "Contract sent for signature",
      };
    }),

  // Send payment reminder (day before payment due)
  sendPaymentReminder: publicProcedure
    .input(
      z.object({
        loanId: z.string(),
        scheduleId: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      // Get loan
      const loan = await drizzleDb
        .select()
        .from(loanContracts)
        .where(eq(loanContracts.loanId, input.loanId))
        .limit(1);

      if (!loan.length) throw new Error("Loan not found");

      const loanData = loan[0];

      // Get payment schedule
      const payment = await drizzleDb
        .select()
        .from(loanPaymentSchedules)
        .where(eq(loanPaymentSchedules.scheduleId, input.scheduleId))
        .limit(1);

      if (!payment.length) throw new Error("Payment schedule not found");

      const paymentData = payment[0];

      // Send celebratory payment reminder
      const { subject, html } = buildPaymentReminderEmail(
        loanData.borrowerName,
        Number(paymentData.amountDue),
        paymentData.dueDate,
        paymentData.paymentNumber,
        loanData.numberOfPayments
      );

      await sendEmail({
        to: loanData.borrowerEmail,
        subject,
        html,
      });

      // Log reminder sent
      await drizzleDb.insert(loanPaymentReminders).values({
        reminderId: `reminder_${crypto.randomUUID()}`,
        loanId: input.loanId,
        scheduleId: input.scheduleId,
        reminderType: "payment_due",
        sentAt: new Date(),
      });

      return {
        success: true,
        message: "Payment reminder sent",
      };
    }),

  // Mark contract as signed
  markContractSigned: publicProcedure
    .input(
      z.object({
        loanId: z.string(),
        signedContractUrl: z.string(),
      })
    )
    .mutation(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      // Get loan
      const loan = await drizzleDb
        .select()
        .from(loanContracts)
        .where(eq(loanContracts.loanId, input.loanId))
        .limit(1);

      if (!loan.length) throw new Error("Loan not found");

      const loanData = loan[0];

      // Update loan status
      await drizzleDb
        .update(loanContracts)
        .set({
          status: "active",
          signedContractUrl: input.signedContractUrl,
          contractSignedAt: new Date(),
        })
        .where(eq(loanContracts.loanId, input.loanId));

      // Send signed contract copy to borrower
      const { subject, html } = buildContractSignedEmail(
        loanData.borrowerName,
        loanData.loanId,
        input.signedContractUrl
      );

      await sendEmail({
        to: loanData.borrowerEmail,
        subject,
        html,
      });

      return {
        success: true,
        message: "Contract marked as signed and copy sent to borrower",
      };
    }),
});
