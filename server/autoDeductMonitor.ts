/**
 * Auto-Deduction Monitor — runs every 60 seconds on the server.
 *
 * Rules:
 * 1. At 7:31 AM CST (window: 7:31–7:32):
 *    a. For each active detailer scheduled to work today (by shift):
 *       - If they DID attend the morning meeting → auto clock them in (if not already clocked in)
 *       - If they did NOT attend → deduct 1 point + issue a write_up notification
 *
 * 2. Ongoing (every 60s), check completed jobs from today (after 8 AM):
 *    a. No photos uploaded → deduct 1 point + write_up (once per job)
 *    b. No "On My Way" stamp → deduct 0.5 points + write_up (once per job)
 *
 * Deduplication: in-memory Sets reset at midnight to prevent double-firing.
 */

import * as db from "./db";
import { createNotification, todayCST, isEmployeeOffOnDate } from "./db";

// ─── In-memory deduplication sets (reset at midnight) ───────────────────────
const meetingCheckDone = new Set<string>();  // employeeId
const noPhotoDone = new Set<string>();        // jobId
const noOnMyWayDone = new Set<string>();      // jobId

function scheduleMidnightReset() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  const msUntilMidnight = midnight.getTime() - now.getTime();
  setTimeout(() => {
    meetingCheckDone.clear();
    noPhotoDone.clear();
    noOnMyWayDone.clear();
    console.log("[AutoDeductMonitor] Daily sets reset at midnight");
    scheduleMidnightReset();
  }, msUntilMidnight);
}

/** Returns the current hour and minute in CST (America/Chicago) */
function getCSTTime(): { hour: number; minute: number; totalMinutes: number } {
  const now = new Date();
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  }).formatToParts(now);
  const hour = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
  const minute = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  return { hour, minute, totalMinutes: hour * 60 + minute };
}

/** Returns the day-of-week in CST (0=Sun, 1=Mon, ..., 6=Sat) */
function getCSTDayOfWeek(): number {
  const now = new Date();
  const dateStr = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
  const [yyyy, mm, dd] = dateStr.split("-").map(Number);
  return new Date(yyyy, mm - 1, dd).getDay();
}

/** Determines if a detailer is scheduled to work on the given day-of-week */
function isScheduledToday(shift: string, dow: number): boolean {
  // shift1 = Mon(1), Tue(2), Wed(3), Thu(4)
  // shift2 = Thu(4), Fri(5), Sat(6), Sun(0)
  // Thursday is shared — both shifts work
  const shift1Days = new Set([1, 2, 3, 4]);
  const shift2Days = new Set([4, 5, 6, 0]);
  return shift === "shift2" ? shift2Days.has(dow) : shift1Days.has(dow);
}

// ─── Rule 1: Morning Meeting Check (7:31–7:32 AM CST) ───────────────────────
async function runMorningMeetingCheck() {
  const today = todayCST();
  const dow = getCSTDayOfWeek();

  try {
    // Confirm morning meeting is enabled
    const meetingConfig = await db.getMorningMeetingConfig();
    if (!meetingConfig || meetingConfig.enabled !== "yes") return;

    // Get all active detailers
    const allDetailers = await db.getAllDetailers();
    if (allDetailers.length === 0) return;

    for (const detailer of allDetailers) {
      if (meetingCheckDone.has(detailer.employeeId)) continue;

      // Check if this detailer is scheduled to work today
      const shift = (detailer.shift ?? "shift1") as string;
      if (!isScheduledToday(shift, dow)) continue;

      // Skip if team member is marked off today
      const isOff = await isEmployeeOffOnDate(detailer.employeeId, today);
      if (isOff) {
        console.log(`[AutoDeductMonitor] Skipping ${detailer.fullName} — marked off today`);
        meetingCheckDone.add(detailer.employeeId);
        continue;
      }

      meetingCheckDone.add(detailer.employeeId);

      const attended = await db.didEmployeeAttendMeeting(detailer.employeeId, today);

      if (attended) {
        // Auto clock-in if not already clocked in
        try {
          const clockStatus = await db.getTodayClockStatus(detailer.employeeId);
          const alreadyClockedIn = clockStatus && !clockStatus.clockOutTime;
          if (!alreadyClockedIn) {
            await db.clockIn(detailer.employeeId, detailer.fullName);
            console.log(`[AutoDeductMonitor] Auto clocked in ${detailer.fullName} (attended morning meeting)`);
          }
        } catch (err) {
          console.error(`[AutoDeductMonitor] Auto clock-in failed for ${detailer.fullName}:`, err);
        }
      } else {
        // Deduct 1 point + issue write-up
        try {
          const notifId = `WRITEUP-MEETING-${Date.now()}-${detailer.employeeId.slice(-6)}`;
          await db.issueViolation({
            employeeId: detailer.employeeId,
            employeeName: detailer.fullName,
            violationType: "missed_morning_meeting",
            pointsDeducted: 1,
            notes: `Missed morning meeting on ${today}. Auto-deducted by system at 7:31 AM.`,
            issuedBy: "System",
            writeUpNotifId: notifId,
          });
          await createNotification({
            notificationId: notifId,
            employeeId: detailer.employeeId,
            fullName: detailer.fullName,
            notificationType: "write_up",
            title: "Missed Morning Meeting",
            message: `You missed the morning meeting on ${today}. 1 accountability point has been deducted. Make sure to join the meeting each day you are scheduled to work.`,
            createdBy: "System",
            requiresAcknowledgment: "yes",
            status: "unread",
          });
          console.log(`[AutoDeductMonitor] Deducted 1pt from ${detailer.fullName} — missed morning meeting on ${today}`);
        } catch (err) {
          console.error(`[AutoDeductMonitor] Write-up failed for ${detailer.fullName}:`, err);
        }
      }
    }
  } catch (err) {
    console.error("[AutoDeductMonitor] Morning meeting check error:", err);
  }
}

// ─── Rule 2a: No Before/After Photos (completed jobs) ───────────────────────
async function runNoPhotosCheck() {
  const today = todayCST();
  try {
    const jobs = await db.getAllScheduleJobsByDateRange(today, today);
    const completedJobs = jobs.filter(j => j.status === "completed");

    for (const job of completedJobs) {
      if (!job.assignedTo) continue;
      if (noPhotoDone.has(job.jobId)) continue;

      // Check if photos were uploaded
      const photoUrls: string[] = (() => {
        try { return JSON.parse(job.photoUrls ?? "[]"); } catch { return []; }
      })();

      if (photoUrls.length > 0) continue;

      noPhotoDone.add(job.jobId);

      try {
        const allDetailers = await db.getAllDetailers();
        // assignedTo may be employeeId or fullName
        const detailer = allDetailers.find(
          d => d.employeeId === job.assignedTo || d.fullName === job.assignedTo
        );
        if (!detailer) continue;

        const notifId = `WRITEUP-PHOTO-${Date.now()}-${job.jobId.slice(-6)}`;
        await db.issueViolation({
          employeeId: detailer.employeeId,
          employeeName: detailer.fullName,
          violationType: "no_before_after_photos",
          pointsDeducted: 1,
          notes: `No before/after photos uploaded for job ${job.jobId} (${job.customerName ?? "customer"}) on ${today}. Auto-deducted by system.`,
          issuedBy: "System",
          writeUpNotifId: notifId,
        });
        await createNotification({
          notificationId: notifId,
          employeeId: detailer.employeeId,
          fullName: detailer.fullName,
          notificationType: "write_up",
          title: "Missing Before/After Photos",
          message: `No photos were uploaded for your completed job on ${today} (${job.customerName ?? "customer"}). 1 accountability point has been deducted. Always upload before and after photos for every job.`,
          createdBy: "System",
          requiresAcknowledgment: "yes",
          status: "unread",
        });
        console.log(`[AutoDeductMonitor] Deducted 1pt from ${detailer.fullName} — no photos on job ${job.jobId}`);
      } catch (err) {
        console.error(`[AutoDeductMonitor] No-photo deduction failed for job ${job.jobId}:`, err);
      }
    }
  } catch (err) {
    console.error("[AutoDeductMonitor] No-photos check error:", err);
  }
}

// ─── Rule 2b: No "On My Way" Stamp (completed jobs) ─────────────────────────
async function runNoOnMyWayCheck() {
  const today = todayCST();
  try {
    const jobs = await db.getAllScheduleJobsByDateRange(today, today);
    const completedJobs = jobs.filter(j => j.status === "completed");

    for (const job of completedJobs) {
      if (!job.assignedTo) continue;
      if (noOnMyWayDone.has(job.jobId)) continue;

      // If onMyWayAt is set, skip
      if (job.onMyWayAt) continue;

      noOnMyWayDone.add(job.jobId);

      try {
        const allDetailers = await db.getAllDetailers();
        const detailer = allDetailers.find(
          d => d.employeeId === job.assignedTo || d.fullName === job.assignedTo
        );
        if (!detailer) continue;

        const notifId = `WRITEUP-OMW-${Date.now()}-${job.jobId.slice(-6)}`;
        await db.issueViolation({
          employeeId: detailer.employeeId,
          employeeName: detailer.fullName,
          violationType: "no_late_arrival_notice",
          pointsDeducted: 0.5,
          notes: `"On My Way" was never tapped for job ${job.jobId} (${job.customerName ?? "customer"}) on ${today}. Auto-deducted by system.`,
          issuedBy: "System",
          writeUpNotifId: notifId,
        });
        await createNotification({
          notificationId: notifId,
          employeeId: detailer.employeeId,
          fullName: detailer.fullName,
          notificationType: "write_up",
          title: "Missing On My Way Check-In",
          message: `You did not tap "On My Way" before your job on ${today} (${job.customerName ?? "customer"}). 0.5 accountability points have been deducted. Always tap "On My Way" when heading to a job.`,
          createdBy: "System",
          requiresAcknowledgment: "yes",
          status: "unread",
        });
        console.log(`[AutoDeductMonitor] Deducted 0.5pt from ${detailer.fullName} — no On My Way on job ${job.jobId}`);
      } catch (err) {
        console.error(`[AutoDeductMonitor] No-on-my-way deduction failed for job ${job.jobId}:`, err);
      }
    }
  } catch (err) {
    console.error("[AutoDeductMonitor] No-on-my-way check error:", err);
  }
}

// ─── Main monitor loop ───────────────────────────────────────────────────────
export async function runAutoDeductMonitor() {
  const { totalMinutes } = getCSTTime();

  // Rule 1: Morning meeting check fires at 7:31–7:32 AM CST (451–452 minutes)
  if (totalMinutes >= 451 && totalMinutes < 453) {
    await runMorningMeetingCheck();
  }

  // Rules 2a & 2b: Check completed jobs throughout the day (after 8 AM)
  if (totalMinutes >= 480) {
    await runNoPhotosCheck();
    await runNoOnMyWayCheck();
  }
}

export function startAutoDeductMonitor() {
  // PAUSED: Auto-deduction monitor is temporarily disabled while rules are being reviewed.
  // To re-enable, remove this early return and restore the lines below.
  console.log("[AutoDeductMonitor] PAUSED — auto-deductions are disabled");
  return;

  // scheduleMidnightReset();
  // runAutoDeductMonitor().catch(console.error);
  // setInterval(() => runAutoDeductMonitor().catch(console.error), 60 * 1000);
  // console.log("[AutoDeductMonitor] Started — checking every 60 seconds");
}
