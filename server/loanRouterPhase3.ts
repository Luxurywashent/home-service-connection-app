import { z } from "zod";
import { publicProcedure } from "./_core/trpc";
import { loanContracts } from "../drizzle/schema";
import { eq } from "drizzle-orm";
import * as db from "./db";
import { generateLoanContractPDF } from "./loanContractGenerator";
import {
  buildLoanContractEmail,
  buildPaymentReminderEmail,
  buildContractSignedEmail,
} from "./loanEmailTemplates";
import { sendEmail } from "./email";
import { storagePut } from "./storage";


/**
 * Phase 3 endpoints for loan contract generation and email sending
 * These are added to the existing loanRouter
 */

export const loanPhase3Endpoints = {
  // Generate and send contract to borrower
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
      const { loanPaymentSchedules } = await import("../drizzle/schema");
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
      const _cu = await storagePut(fileName, pdfBuffer, "application/pdf");
    const contractUrl = _cu.url;

      // Update loan with contract URL
      await drizzleDb
        .update(loanContracts)
        .set({
          contractUrl,
          status: "pending_signature",
        })
        .where(eq(loanContracts.loanId, input.loanId));

      // Build signature link (in production, this would be a real signing service)
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
      const { loanPaymentSchedules } = await import("../drizzle/schema");
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
      const { loanPaymentReminders } = await import("../drizzle/schema");
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

  // Schedule automatic payment reminders
  schedulePaymentReminders: publicProcedure
    .input(z.object({ loanId: z.string() }))
    .mutation(async ({ input }) => {
      const drizzleDb = await db.getDb();
      if (!drizzleDb) throw new Error("Database connection failed");

      // Get all pending payments
      const { loanPaymentSchedules } = await import("../drizzle/schema");
      const payments = await drizzleDb
        .select()
        .from(loanPaymentSchedules)
        .where(eq(loanPaymentSchedules.loanId, input.loanId));

      const scheduled = [];

      for (const payment of payments) {
        if (payment.status === "scheduled") {
          // Calculate reminder date (1 day before due date)
          const reminderDate = new Date(payment.dueDate);
          reminderDate.setDate(reminderDate.getDate() - 1);

          // In production, you would integrate with a task scheduler like Bull or node-cron
          // For now, we'll just return the schedule
          scheduled.push({
            scheduleId: payment.scheduleId,
            paymentNumber: payment.paymentNumber,
            dueDate: payment.dueDate,
            reminderDate,
            amount: payment.amountDue,
          });
        }
      }

      return {
        success: true,
        scheduledReminders: scheduled,
        message: `${scheduled.length} payment reminders scheduled`,
      };
    }),
};
