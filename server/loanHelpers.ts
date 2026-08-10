
import { InsertLoanPaymentSchedule } from "../drizzle/schema";

/**
 * Generate payment schedule based on frequency and day preferences
 */
export function generatePaymentSchedule(
  loanId: string,
  numberOfPayments: number,
  paymentAmount: number,
  startDate: Date,
  frequency: "weekly" | "biweekly" | "monthly",
  dayOfWeek?: number,
  dayOfMonth?: string
): InsertLoanPaymentSchedule[] {
  const schedule: InsertLoanPaymentSchedule[] = [];
  let currentDate = new Date(startDate);

  for (let i = 1; i <= numberOfPayments; i++) {
    // Calculate next payment date based on frequency
    if (frequency === "weekly") {
      currentDate = getNextWeeklyDate(currentDate, dayOfWeek!);
    } else if (frequency === "biweekly") {
      currentDate = getNextBiweeklyDate(currentDate, dayOfWeek!);
    } else if (frequency === "monthly") {
      currentDate = getNextMonthlyDate(currentDate, dayOfMonth!);
    }

    schedule.push({
      scheduleId: `schedule_${crypto.randomUUID()}`,
      loanId,
      paymentNumber: i,
      dueDate: currentDate,
      amountDue: String(paymentAmount),
      status: "scheduled",
    });

    // Move to next period for next iteration
    if (frequency === "weekly") {
      currentDate = new Date(currentDate.getTime() + 7 * 24 * 60 * 60 * 1000);
    } else if (frequency === "biweekly") {
      currentDate = new Date(currentDate.getTime() + 14 * 24 * 60 * 60 * 1000);
    } else if (frequency === "monthly") {
      currentDate = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
    }
  }

  return schedule;
}

/**
 * Get next weekly date with specific day of week
 * dayOfWeek: 0=Sunday, 1=Monday, ..., 6=Saturday
 */
function getNextWeeklyDate(fromDate: Date, dayOfWeek: number): Date {
  const date = new Date(fromDate);
  const currentDay = date.getDay();
  let daysToAdd = dayOfWeek - currentDay;

  if (daysToAdd <= 0) {
    daysToAdd += 7;
  }

  date.setDate(date.getDate() + daysToAdd);
  return date;
}

/**
 * Get next bi-weekly date with specific day of week
 */
function getNextBiweeklyDate(fromDate: Date, dayOfWeek: number): Date {
  const date = new Date(fromDate);
  const currentDay = date.getDay();
  let daysToAdd = dayOfWeek - currentDay;

  if (daysToAdd <= 0) {
    daysToAdd += 14;
  } else if (daysToAdd > 7) {
    daysToAdd -= 7;
  }

  date.setDate(date.getDate() + daysToAdd);
  return date;
}

/**
 * Get next monthly date with specific day preference
 * dayOfMonth can be: "1", "15", "first_thursday", "last_thursday", etc.
 */
function getNextMonthlyDate(fromDate: Date, dayOfMonth: string): Date {
  const date = new Date(fromDate);

  if (dayOfMonth === "first_thursday") {
    return getFirstThursdayOfNextMonth(date);
  } else if (dayOfMonth === "last_thursday") {
    return getLastThursdayOfNextMonth(date);
  } else {
    // Numeric day like "1", "15", etc.
    const day = parseInt(dayOfMonth, 10);
    date.setMonth(date.getMonth() + 1);
    date.setDate(Math.min(day, getDaysInMonth(date.getFullYear(), date.getMonth())));
    return date;
  }
}

/**
 * Get first Thursday of next month
 */
function getFirstThursdayOfNextMonth(fromDate: Date): Date {
  const date = new Date(fromDate.getFullYear(), fromDate.getMonth() + 1, 1);

  // Thursday is day 4
  const dayOfWeek = date.getDay();
  const daysToAdd = dayOfWeek <= 4 ? 4 - dayOfWeek : 11 - dayOfWeek;

  date.setDate(date.getDate() + daysToAdd);
  return date;
}

/**
 * Get last Thursday of next month
 */
function getLastThursdayOfNextMonth(fromDate: Date): Date {
  const date = new Date(fromDate.getFullYear(), fromDate.getMonth() + 2, 0);

  // Thursday is day 4
  const dayOfWeek = date.getDay();
  const daysToSubtract = dayOfWeek > 4 ? dayOfWeek - 4 : dayOfWeek + 3;

  date.setDate(date.getDate() - daysToSubtract);
  return date;
}

/**
 * Get number of days in a month
 */
function getDaysInMonth(year: number, month: number): number {
  return new Date(year, month + 1, 0).getDate();
}

/**
 * Calculate interest amount
 */
export function calculateInterest(principalAmount: number, totalRepaymentAmount: number): number {
  return totalRepaymentAmount - principalAmount;
}

/**
 * Calculate payment amount per payment
 */
export function calculatePaymentAmount(totalRepaymentAmount: number, numberOfPayments: number): number {
  return totalRepaymentAmount / numberOfPayments;
}

/**
 * Calculate completion percentage
 */
export function calculateCompletionPercentage(totalPaid: number, totalRepayment: number): number {
  return (totalPaid / totalRepayment) * 100;
}

/**
 * Calculate remaining balance
 */
export function calculateRemainingBalance(totalRepayment: number, totalPaid: number): number {
  return totalRepayment - totalPaid;
}
