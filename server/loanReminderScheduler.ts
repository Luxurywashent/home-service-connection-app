import { CronJob } from "cron";
import * as db from "./db";
import { loanPaymentSchedules, loanContracts } from "../drizzle/schema";
import { eq, and, lte, gte } from "drizzle-orm";
/**
 * Automatic payment reminder scheduler
 * Runs daily at 9 AM to check for payments due tomorrow
 * Sends celebratory email notifications to borrowers
 */

let reminderJob: CronJob | null = null;

export async function startPaymentReminderScheduler() {
  if (reminderJob) {
    console.log("[PaymentReminder] Scheduler already running");
    return;
  }

  // Run every day at 9 AM
  reminderJob = new CronJob("0 9 * * *", async () => {
    console.log("[PaymentReminder] Checking for payments due tomorrow...");
    try {
      await sendPaymentReminders();
    } catch (error) {
      console.error("[PaymentReminder] Error:", error);
    }
  });

  reminderJob.start();
  console.log("[PaymentReminder] Scheduler started (9 AM daily)");
}

export async function stopPaymentReminderScheduler() {
  if (reminderJob) {
    reminderJob.stop();
    reminderJob = null;
    console.log("[PaymentReminder] Scheduler stopped");
  }
}

async function sendPaymentReminders() {
  const drizzleDb = await db.getDb();
  if (!drizzleDb) {
    console.error("[PaymentReminder] Database connection failed");
    return;
  }

  // Get tomorrow's date
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(0, 0, 0, 0);

  const tomorrowEnd = new Date(tomorrow);
  tomorrowEnd.setHours(23, 59, 59, 999);

  try {
    // Find all payments due tomorrow that haven't had reminders sent
    const paymentsToRemind = await drizzleDb
      .select()
      .from(loanPaymentSchedules)
      .where(
        and(
          gte(loanPaymentSchedules.dueDate, tomorrow),
          lte(loanPaymentSchedules.dueDate, tomorrowEnd),
          eq(loanPaymentSchedules.status, "scheduled")
        )
      );

    console.log(`[PaymentReminder] Found ${paymentsToRemind.length} payments due tomorrow`);

    for (const payment of paymentsToRemind) {
      try {
        // Get loan details
        const loan = await drizzleDb
          .select()
          .from(loanContracts)
          .where(eq(loanContracts.loanId, payment.loanId))
          .limit(1);

        if (!loan.length) {
          console.warn(`[PaymentReminder] Loan not found: ${payment.loanId}`);
          continue;
        }

        const loanData = loan[0];

        // Send reminder email
        const { sendEmail } = await import("./email");
        const { buildPaymentReminderEmail } = await import("./loanEmailTemplates");

        const { subject, html } = buildPaymentReminderEmail(
          loanData.borrowerName,
          Number(payment.amountDue),
          payment.dueDate,
          payment.paymentNumber,
          loanData.numberOfPayments
        );

        await sendEmail({
          to: loanData.borrowerEmail,
          subject,
          html,
        });

        // Update reminder sent timestamp
        await drizzleDb
          .update(loanPaymentSchedules)
          .set({
            reminderSentAt: new Date(),
          })
          .where(eq(loanPaymentSchedules.scheduleId, payment.scheduleId));

        console.log(
          `[PaymentReminder] Sent reminder for ${loanData.borrowerName} - Payment ${payment.paymentNumber} of ${loanData.numberOfPayments}`
        );
      } catch (error) {
        console.error(
          `[PaymentReminder] Error processing payment ${payment.scheduleId}:`,
          error
        );
      }
    }

    console.log("[PaymentReminder] Reminder check completed");
  } catch (error) {
    console.error("[PaymentReminder] Error fetching payments:", error);
  }
}

// Manual trigger for testing
export async function triggerPaymentRemindersNow() {
  console.log("[PaymentReminder] Manual trigger initiated");
  await sendPaymentReminders();
}
