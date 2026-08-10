import { eq, and, or, desc, gte, lte, gt, lt, sql, ne, like, inArray, notInArray, isNotNull, isNull } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import {
  InsertUser, users,
  employees, type InsertEmployee,
  dailyPerformance, type InsertDailyPerformance,
  notifications, type InsertNotification,
  timeOffRequests, type InsertTimeOffRequest,
  notificationReadLog, type InsertNotificationReadLog,
  challenges, type InsertChallenge,
  quizQuestions, type InsertQuizQuestion,
  employeeProgression, type InsertEmployeeProgression,
  doorHangerEntries, type InsertDoorHangerEntry,
  doorHangerGoals, type InsertDoorHangerGoals,
  trainingModules, type InsertTrainingModule,
  trainingTools, type InsertTrainingTool,
  trainingSteps, type InsertTrainingStep,
  userTrainingProgress, type InsertUserTrainingProgress,
  teamChatMessages, type InsertTeamChatMessage,
  clockInOutRecords, type InsertClockInOutRecord,
  breakRecords, type InsertBreakRecord,
  onlineBookings, type InsertOnlineBooking,
  salesCallbacks,
  scheduleJobs, type InsertScheduleJob,
  detailerLocations, type InsertDetailerLocation,
  trackingTokens, type InsertTrackingToken,
  morningMeetingConfig, type InsertMorningMeetingConfig,
  salesPerformance, type InsertSalesPerformance,
  doorHangerEarnings, type InsertDoorHangerEarnings,
  customerAttachments,
  estimates,
  receptionistCallLogs, type InsertReceptionistCallLog,
  communityPosts, type InsertCommunityPost,
  communityComments, type InsertCommunityComment,
  communityPostLikes,
  aiKnowledgeEntries, type AiKnowledgeEntry, type InsertAiKnowledgeEntry,
  doNotServiceList,
  detailerPoints,
  pointViolations,
  trainingQuizQuestions, type InsertTrainingQuizQuestion,
  trainingQuizAttempts, type InsertTrainingQuizAttempt,
  customers as customersTable,
  customerAddresses,
  customerBookings,
  companyMeetings, type InsertCompanyMeeting,
  referralCodes, type InsertReferralCode,
  referrals, type InsertReferral,
  pointsLedger, type InsertPointsLedger,
  rewardTiers, type InsertRewardTier,
  redemptions, type InsertRedemption,
  employeeVanAssignments,
  priceBookServices, type PriceBookService,
  geocodeCache,
  meetingAttendance, type InsertMeetingAttendance,
  employeeDaysOff, type InsertEmployeeDayOff,
  standaloneInvoices, type StandaloneInvoice, type InsertStandaloneInvoice,
  invoiceLineItems, type InvoiceLineItem, type InsertInvoiceLineItem,
  addressPhotos, type AddressPhoto,
} from "../drizzle/schema";
import { ENV } from "./_core/env";
import { randomBytes } from "crypto";

// Raw MySQL connection for phone system and other direct queries
export async function getConnection(): Promise<mysql.Connection> {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

function generateId(prefix: string): string {
  return `${prefix}_${Date.now()}_${randomBytes(6).toString('hex')}`;
}

/**
 * Returns today's date as YYYY-MM-DD in CST (America/Chicago).
 * Using Intl.DateTimeFormat ensures CST is used regardless of toISOString() UTC behavior.
 */
export function todayCST(): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
}
// @ts-ignore

type DrizzleDb = ReturnType<typeof drizzle<mysql.Pool>>;
let _db: DrizzleDb | null = null;
let _pool: mysql.Pool | null = null;

function getPool(): mysql.Pool {
  if (!_pool) {
    const pool = mysql.createPool({
      uri: process.env.DATABASE_URL!,
      connectionLimit: 10,
      waitForConnections: true,
      enableKeepAlive: true,
      keepAliveInitialDelay: 30000,
    });
    // Reset pool and drizzle instance on connection loss so the next request
    // gets a fresh pool instead of reusing a dead one.
    pool.on('connection', (conn) => {
      (conn as any).on('error', (err: NodeJS.ErrnoException) => {
        if (err.code === 'PROTOCOL_CONNECTION_LOST' || err.code === 'ECONNRESET' || err.code === 'ETIMEDOUT') {
          console.warn('[Database] Connection lost — resetting pool for reconnect:', err.code);
          _db = null;
          _pool = null;
        }
      });
    });
    _pool = pool;
  }
  return _pool;
}

export async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
// @ts-ignore
// @ts-ignore
    try {
// @ts-ignore
      _db = drizzle(getPool());
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}

// ─── Users (framework) ───
export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required");
  const db = await getDb();
  if (!db) return;
  const values: InsertUser = { openId: user.openId };
  const updateSet: Record<string, unknown> = {};
  for (const f of ["name", "email", "loginMethod"] as const) {
    const v = user[f]; if (v === undefined) continue;
    values[f] = v ?? null; updateSet[f] = v ?? null;
  }
  if (user.lastSignedIn !== undefined) { values.lastSignedIn = user.lastSignedIn; updateSet.lastSignedIn = user.lastSignedIn; }
  if (user.role !== undefined) { values.role = user.role; updateSet.role = user.role; }
  else if (user.openId === ENV.ownerOpenId) { values.role = "admin"; updateSet.role = "admin"; }
  if (!values.lastSignedIn) values.lastSignedIn = new Date();
  if (Object.keys(updateSet).length === 0) updateSet.lastSignedIn = new Date();
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result.length > 0 ? result[0] : undefined;
}

// ─── Employees ───
export async function getEmployeeByLogin(identifier: string, pin: string) {
  const db = await getDb();
  if (!db) return null;
  let result = await db.select().from(employees)
    .where(and(eq(employees.employeeId, identifier), eq(employees.pin, pin), eq(employees.activeStatus, "active")))
    .limit(1);
  if (result.length === 0) {
    result = await db.select().from(employees)
      .where(and(eq(employees.email, identifier), eq(employees.pin, pin), eq(employees.activeStatus, "active")))
      .limit(1);
  }
  return result.length > 0 ? result[0] : null;
}

export async function getEmployeeById(employeeId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(employees).where(eq(employees.employeeId, employeeId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllActiveEmployees() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(employees).where(eq(employees.activeStatus, "active")).orderBy(employees.fullName);
}

export async function getAllDetailers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(employees)
    .where(and(eq(employees.role, "detailer"), eq(employees.activeStatus, "active")))
    .orderBy(employees.fullName);
}

export async function createEmployee(data: InsertEmployee) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(employees).values(data);
}

export async function updateEmployee(employeeId: string, data: { fullName?: string; email?: string | null; phoneNumber?: string | null; city?: string | null; role?: string; pin?: string; hourlyRate?: number | null; upsellBonusPct?: number | null; shiftStartHour?: number | null; shiftEndHour?: number | null; shift?: string; customWorkDays?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (data.fullName !== undefined) updateSet.fullName = data.fullName;
  if (data.email !== undefined) updateSet.email = data.email;
  if (data.phoneNumber !== undefined) updateSet.phoneNumber = data.phoneNumber;
  if (data.city !== undefined) updateSet.city = data.city;
  if (data.role !== undefined) updateSet.role = data.role;
  if (data.pin !== undefined) updateSet.pin = data.pin;
  if (data.hourlyRate !== undefined) updateSet.hourlyRate = data.hourlyRate !== null ? String(data.hourlyRate) : null;
  if (data.upsellBonusPct !== undefined) updateSet.upsellBonusPct = data.upsellBonusPct !== null ? String(data.upsellBonusPct) : null;
  if (data.shiftStartHour !== undefined) updateSet.shiftStartHour = data.shiftStartHour !== null ? String(data.shiftStartHour) : null;
  if (data.shiftEndHour !== undefined) updateSet.shiftEndHour = data.shiftEndHour !== null ? String(data.shiftEndHour) : null;
  if (data.shift !== undefined) updateSet.shift = data.shift;
  if (data.customWorkDays !== undefined) updateSet.customWorkDays = data.customWorkDays;
  if (Object.keys(updateSet).length === 0) return;
  await db.update(employees).set(updateSet).where(eq(employees.employeeId, employeeId));
}

export async function updateEmployeePin(employeeId: string, newPin: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(employees).set({ pin: newPin }).where(eq(employees.employeeId, employeeId));
}

// ─── Daily Performance ───
export async function getPerformanceByDate(employeeId: string, date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dailyPerformance)
    .where(and(eq(dailyPerformance.employeeId, employeeId), eq(dailyPerformance.date, date)));
}

export async function getPerformanceDateRange(employeeId: string, startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dailyPerformance)
    .where(and(
      eq(dailyPerformance.employeeId, employeeId),
      gte(dailyPerformance.date, startDate),
      lte(dailyPerformance.date, endDate),
    ))
    .orderBy(dailyPerformance.date);
}

export async function getAllPerformanceByDate(date: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dailyPerformance).where(eq(dailyPerformance.date, date));
}

export async function getAllPerformanceDateRange(startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dailyPerformance)
    .where(and(gte(dailyPerformance.date, startDate), lte(dailyPerformance.date, endDate)))
    .orderBy(dailyPerformance.date);
}

export async function getPerformanceHistory(employeeId: string, limit = 30) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(dailyPerformance)
    .where(eq(dailyPerformance.employeeId, employeeId))
    .orderBy(desc(dailyPerformance.date))
    .limit(limit);
}

export async function upsertPerformance(data: InsertDailyPerformance) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(dailyPerformance).values(data).onDuplicateKeyUpdate({
    set: {
      hoursWorked: data.hoursWorked,
      revenueProduced: data.revenueProduced,
      efficiencyPercent: data.efficiencyPercent,
      upsells: data.upsells,
      tips: data.tips,
      fullName: data.fullName,
      city: data.city,
      createdBy: data.createdBy,
    },
  });
}

// ─── Notifications ───
export async function getNotificationsForEmployee(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .where(eq(notifications.employeeId, employeeId))
    .orderBy(desc(notifications.createdAt));
}

export async function getNotificationById(notificationId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(notifications)
    .where(eq(notifications.notificationId, notificationId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// Types that are system-internal (sent to employees only) and must NOT appear in the admin Alerts list
const ADMIN_EXCLUDED_NOTIF_TYPES = [
  "clock_check_5pm",
  "clock_alert",
  "callback_reminder",
  "ai_booking",
  "job_transfer",
  "missed_call",
] as const;
export async function getAllNotifications() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .where(notInArray(notifications.notificationType, [...ADMIN_EXCLUDED_NOTIF_TYPES]))
    .orderBy(desc(notifications.createdAt));
}

export async function createNotification(data: InsertNotification) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(notifications).values(data);
}

export async function markNotificationRead(notificationId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notifications).set({ status: "read", readAt: new Date() })
    .where(and(eq(notifications.notificationId, notificationId), eq(notifications.status, "unread")));
}

export async function markNotificationAcknowledged(notificationId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notifications).set({ status: "acknowledged", acknowledgedAt: new Date() })
    .where(eq(notifications.notificationId, notificationId));
}

export async function markAllNotificationsRead() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(notifications)
    .set({ status: "read", readAt: new Date() })
    .where(eq(notifications.status, "unread"));
}

export async function getUnacknowledgedCriticalNotifications() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notifications)
    .where(and(
      eq(notifications.requiresAcknowledgment, "yes"),
      sql`${notifications.status} != 'acknowledged'`,
      notInArray(notifications.notificationType, [...ADMIN_EXCLUDED_NOTIF_TYPES]),
    ))
    .orderBy(desc(notifications.createdAt));
}

// ─── Time Off Requests ───
export async function getTimeOffRequestsForEmployee(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(timeOffRequests)
    .where(eq(timeOffRequests.employeeId, employeeId))
    .orderBy(desc(timeOffRequests.submittedAt));
}

export async function getAllTimeOffRequests() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(timeOffRequests).orderBy(desc(timeOffRequests.submittedAt));
}

export async function getTimeOffRequestsByStatus(status: "pending" | "approved" | "denied") {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(timeOffRequests)
    .where(eq(timeOffRequests.status, status))
    .orderBy(desc(timeOffRequests.submittedAt));
}

export async function createTimeOffRequest(data: InsertTimeOffRequest) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(timeOffRequests).values(data);
}

export async function updateTimeOffRequestStatus(
  requestId: string,
  status: "approved" | "denied",
  decidedBy: string,
  managerNote?: string,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(timeOffRequests).set({
    status,
    decidedBy,
    decidedAt: new Date(),
    managerNote: managerNote ?? null,
  }).where(eq(timeOffRequests.requestId, requestId));
}

export async function getPendingTimeOffCount() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(timeOffRequests)
    .where(eq(timeOffRequests.status, "pending"));
  return result[0]?.count ?? 0;
}

// ─── Notification Read Log ───
export async function createReadLog(data: InsertNotificationReadLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(notificationReadLog).values(data);
}

export async function getReadLogsForNotification(notificationId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(notificationReadLog)
    .where(eq(notificationReadLog.notificationId, notificationId))
    .orderBy(desc(notificationReadLog.actionTimestamp));
}

// ─── Challenges ───
export async function getAllChallenges() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(challenges).orderBy(desc(challenges.createdAt));
}

export async function getActiveChallenge() {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(challenges)
    .where(eq(challenges.isActive, "yes"))
    .orderBy(desc(challenges.createdAt))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getChallengeById(challengeId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(challenges).where(eq(challenges.challengeId, challengeId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function createChallenge(data: InsertChallenge) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(challenges).values(data);
}

export async function updateChallenge(challengeId: string, data: Partial<InsertChallenge>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(challenges).set(data).where(eq(challenges.challengeId, challengeId));
}

export async function deleteChallenge(challengeId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Delete associated questions first
  await db.delete(quizQuestions).where(eq(quizQuestions.challengeId, challengeId));
  await db.delete(challenges).where(eq(challenges.challengeId, challengeId));
}

// ─── Quiz Questions ───
export async function getAllQuizQuestions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(quizQuestions).orderBy(quizQuestions.orderIndex);
}

export async function getQuestionsForChallenge(challengeId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(quizQuestions)
    .where(eq(quizQuestions.challengeId, challengeId))
    .orderBy(quizQuestions.orderIndex);
}

export async function getQuizQuestionCount() {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(quizQuestions);
  return result[0]?.count ?? 0;
}

export async function hasAttemptedQuestion(employeeId: string, questionId: string) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select().from(employeeProgression)
    .where(and(
      eq(employeeProgression.employeeId, employeeId),
      eq(employeeProgression.questionId, questionId),
    ))
    .limit(1);
  return result.length > 0;
}

export async function getAttemptForQuestion(employeeId: string, questionId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(employeeProgression)
    .where(and(
      eq(employeeProgression.employeeId, employeeId),
      eq(employeeProgression.questionId, questionId),
    ))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function createQuizQuestion(data: InsertQuizQuestion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(quizQuestions).values(data);
}

export async function updateQuizQuestion(questionId: string, data: Partial<InsertQuizQuestion>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(quizQuestions).set(data).where(eq(quizQuestions.questionId, questionId));
}

export async function deleteQuizQuestion(questionId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(quizQuestions).where(eq(quizQuestions.questionId, questionId));
}

// ─── Employee Progression ───
export async function getEmployeeProgressionAll(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(employeeProgression)
    .where(eq(employeeProgression.employeeId, employeeId))
    .orderBy(employeeProgression.completedAt);
}

export async function getEmployeeProgressionCount(employeeId: string) {
  const db = await getDb();
  if (!db) return 0;
  const result = await db.select({ count: sql<number>`count(*)` }).from(employeeProgression)
    .where(eq(employeeProgression.employeeId, employeeId));
  return result[0]?.count ?? 0;
}

export async function hasCompletedToday(employeeId: string, todayStr: string) {
  const db = await getDb();
  if (!db) return false;
  const result = await db.select().from(employeeProgression)
    .where(and(eq(employeeProgression.employeeId, employeeId), eq(employeeProgression.completedDate, todayStr)))
    .limit(1);
  return result.length > 0;
}

export async function recordProgression(data: InsertEmployeeProgression) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(employeeProgression).values(data);
}

export async function getAttemptSummaryForQuestion(questionId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    employeeId: employeeProgression.employeeId,
    questionId: employeeProgression.questionId,
    attemptResult: employeeProgression.attemptResult,
    completedDate: employeeProgression.completedDate,
  }).from(employeeProgression)
    .where(eq(employeeProgression.questionId, questionId));
}

export async function resetEmployeeProgression(employeeId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(employeeProgression).where(eq(employeeProgression.employeeId, employeeId));
}

export async function getAllProgressionSummary() {
  const db = await getDb();
  if (!db) return [];
  const result = await db.select({
    employeeId: employeeProgression.employeeId,
    count: sql<number>`count(*)`,
    lastDate: sql<string>`max(${employeeProgression.completedDate})`,
  }).from(employeeProgression)
    .groupBy(employeeProgression.employeeId);
  return result;
}

// ─── Seed Data ───
export async function seedDemoData() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(employees).limit(1);
  if (existing.length > 0) return { message: "Data already seeded" };

  const employeeData: InsertEmployee[] = [
    { employeeId: "EMP001", fullName: "Marcus Johnson", email: "marcus@luxurywash.com", pin: "1234", role: "detailer", city: "Dallas", activeStatus: "active", hireDate: "2023-06-15", phoneNumber: "214-555-0101" },
    { employeeId: "EMP002", fullName: "Sarah Williams", email: "sarah@luxurywash.com", pin: "1234", role: "detailer", city: "Dallas", activeStatus: "active", hireDate: "2023-08-20", phoneNumber: "214-555-0102" },
    { employeeId: "EMP003", fullName: "David Martinez", email: "david@luxurywash.com", pin: "1234", role: "detailer", city: "Fort Worth", activeStatus: "active", hireDate: "2024-01-10", phoneNumber: "817-555-0103" },
    { employeeId: "EMP004", fullName: "James Thompson", email: "james@luxurywash.com", pin: "1234", role: "detailer", city: "Dallas", activeStatus: "active", hireDate: "2024-03-01", phoneNumber: "214-555-0104" },
    { employeeId: "EMP005", fullName: "Ashley Chen", email: "ashley@luxurywash.com", pin: "1234", role: "detailer", city: "Fort Worth", activeStatus: "active", hireDate: "2024-05-15", phoneNumber: "817-555-0105" },
    { employeeId: "ADM001", fullName: "Michael Rivera", email: "michael@luxurywash.com", pin: "0000", role: "admin", city: "Dallas", activeStatus: "active", hireDate: "2022-01-01", phoneNumber: "214-555-0200" },
    { employeeId: "OPS001", fullName: "Jennifer Lee", email: "jennifer@luxurywash.com", pin: "0000", role: "operations_manager", city: "Dallas", activeStatus: "active", hireDate: "2022-06-01", phoneNumber: "214-555-0201" },
    { employeeId: "DHR001", fullName: "Robert Garcia", email: "robert@luxurywash.com", pin: "5555", role: "door_hanger_rep", city: "Dallas", activeStatus: "active", hireDate: "2024-02-01", phoneNumber: "214-555-0301" },
    { employeeId: "DHR002", fullName: "Lisa Anderson", email: "lisa@luxurywash.com", pin: "5555", role: "door_hanger_rep", city: "Fort Worth", activeStatus: "active", hireDate: "2024-04-01", phoneNumber: "817-555-0302" },
  ];
  for (const emp of employeeData) {
    await db.insert(employees).values(emp);
  }

  const today = new Date();
  const dayOfWeek = today.getDay();
  const monday = new Date(today);
  monday.setDate(today.getDate() - (dayOfWeek === 0 ? 6 : dayOfWeek - 1));

  const detailerIds = ["EMP001", "EMP002", "EMP003", "EMP004", "EMP005"];
  const detailerNames = ["Marcus Johnson", "Sarah Williams", "David Martinez", "James Thompson", "Ashley Chen"];
  const cities = ["Dallas", "Dallas", "Fort Worth", "Dallas", "Fort Worth"];

  let recordCounter = 1;
  for (let d = 0; d < 7; d++) {
    const perfDate = new Date(monday);
    perfDate.setDate(monday.getDate() + d);
    if (perfDate > today) break;
    const dateStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Chicago',
      year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(perfDate);
    for (let i = 0; i < detailerIds.length; i++) {
      const baseEff = 65 + Math.random() * 30;
      const hours = 6 + Math.random() * 4;
      const revenue = 200 + Math.random() * 500;
      const bonus = (Math.random() * 150).toFixed(2);
      await db.insert(dailyPerformance).values({
        recordId: `REC${String(recordCounter++).padStart(4, "0")}`,
        date: dateStr,
        employeeId: detailerIds[i],
        fullName: detailerNames[i],
        city: cities[i],
        hoursWorked: hours.toFixed(2),
        revenueProduced: revenue.toFixed(2),
        efficiencyPercent: baseEff.toFixed(2),
        upsells: bonus,
        createdBy: "ADM001",
      });
    }
  }

  const notifData: InsertNotification[] = [
    { notificationId: "NOTIF001", employeeId: "EMP001", fullName: "Marcus Johnson", notificationType: "coaching_note", title: "Great work this week!", message: "Marcus, your efficiency has been consistently above 85% this week. Keep up the excellent work!", createdBy: "Michael Rivera", status: "unread", requiresAcknowledgment: "no" },
    { notificationId: "NOTIF002", employeeId: "EMP002", fullName: "Sarah Williams", notificationType: "qc_issue", title: "QC Issue - Interior Detail", message: "Sarah, a quality check on the BMW X5 (Job #4521) found missed spots on the rear seats. Please review the QC checklist before completing interior details.", createdBy: "Michael Rivera", status: "unread", requiresAcknowledgment: "yes" },
    { notificationId: "NOTIF003", employeeId: "EMP003", fullName: "David Martinez", notificationType: "missed_step", title: "Missed Step - Tire Dressing", message: "David, the tire dressing step was skipped on the last two vehicles today. Please ensure all steps are completed.", createdBy: "Jennifer Lee", status: "unread", requiresAcknowledgment: "yes" },
    { notificationId: "NOTIF004", employeeId: "EMP001", fullName: "Marcus Johnson", notificationType: "company_announcement", title: "New Schedule Starting Next Month", message: "Team, starting next month we will be shifting to a new scheduling system. More details to follow.", createdBy: "Michael Rivera", status: "unread", requiresAcknowledgment: "no" },
  ];
  for (const notif of notifData) {
    await db.insert(notifications).values(notif);
  }

  const timeOffData: InsertTimeOffRequest[] = [
    { requestId: "TOR001", employeeId: "EMP001", fullName: "Marcus Johnson", startDate: "2026-04-15", endDate: "2026-04-15", totalDaysRequested: 1, daysNoticeGiven: 15, reason: "Personal appointment", policyValid: "yes", policyMessage: "Meets 5-day notice requirement", status: "pending" },
    { requestId: "TOR002", employeeId: "EMP002", fullName: "Sarah Williams", startDate: "2026-04-20", endDate: "2026-04-22", totalDaysRequested: 3, daysNoticeGiven: 20, reason: "Family vacation", policyValid: "yes", policyMessage: "Meets 14-day notice requirement", status: "approved", decidedBy: "Michael Rivera", managerNote: "Approved. Enjoy your time off!" },
  ];
  for (const tor of timeOffData) {
    await db.insert(timeOffRequests).values(tor);
  }

  return { message: "Demo data seeded successfully" };
}

// ─── Door Hanger Entries ───
export async function createDoorHangerEntry(data: InsertDoorHangerEntry) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(doorHangerEntries).values(data);
}

export async function getDoorHangerEntries(employeeId: string, dateFrom?: string, dateTo?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  let conditions = [eq(doorHangerEntries.employeeId, employeeId)];
  if (dateFrom) conditions.push(gte(doorHangerEntries.date, dateFrom));
  if (dateTo) conditions.push(lte(doorHangerEntries.date, dateTo));
  
  return await db.select().from(doorHangerEntries).where(and(...conditions));
}

export async function getDoorHangerStats(dateFrom?: string, dateTo?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  let conditions = [];
  if (dateFrom) conditions.push(gte(doorHangerEntries.date, dateFrom));
  if (dateTo) conditions.push(lte(doorHangerEntries.date, dateTo));
  
  const entries = conditions.length > 0 
    ? await db.select().from(doorHangerEntries).where(and(...conditions))
    : await db.select().from(doorHangerEntries);
  
  let doorHangers = 0, businessCards = 0, yardSigns = 0, tableToppers = 0;
  for (const entry of entries) {
    if (entry.outreachType === "door_hangers") doorHangers += entry.quantityDistributed;
    else if (entry.outreachType === "business_cards") businessCards += entry.quantityDistributed;
    else if (entry.outreachType === "yard_signs") yardSigns += entry.quantityDistributed;
    else if (entry.outreachType === "table_toppers") tableToppers += entry.quantityDistributed;
  }
  
  return { doorHangers, businessCards, yardSigns, tableToppers, totalEntries: entries.length };
}

export async function deleteDoorHangerEntry(entryId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(doorHangerEntries).where(eq(doorHangerEntries.entryId, entryId));
}

export async function updateDoorHangerEntry(entryId: string, updates: { address?: string; city?: string; outreachType?: string; notes?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(doorHangerEntries)
    .set(updates as any)
    .where(eq(doorHangerEntries.entryId, entryId));
}

export async function getAllDoorHangerEntries(dateFrom?: string, dateTo?: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  let conditions: any[] = [];
  if (dateFrom) conditions.push(gte(doorHangerEntries.date, dateFrom));
  if (dateTo) conditions.push(lte(doorHangerEntries.date, dateTo));
  return conditions.length > 0
    ? await db.select().from(doorHangerEntries).where(and(...conditions)).orderBy(doorHangerEntries.createdAt)
    : await db.select().from(doorHangerEntries).orderBy(doorHangerEntries.createdAt);
}

export async function getDoorHangerGoals() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const goals = await db.select().from(doorHangerGoals).limit(1);
  if (goals.length === 0) {
    const defaultGoal: InsertDoorHangerGoals = {
      goalId: "GOALS_001",
      dailyDoorHangerGoal: 50,
      dailyBusinessCardGoal: 20,
      dailyYardSignGoal: 2,
      dailyTableTopperGoal: 5,
    };
    await db.insert(doorHangerGoals).values(defaultGoal);
    return defaultGoal;
  }
  return goals[0];
}

export async function updateDoorHangerGoals(dailyDoorHangerGoal: number, dailyBusinessCardGoal: number, dailyYardSignGoal: number, dailyTableTopperGoal: number, updatedBy: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(doorHangerGoals)
    .set({ dailyDoorHangerGoal, dailyBusinessCardGoal, dailyYardSignGoal, dailyTableTopperGoal, updatedBy })
    .where(eq(doorHangerGoals.goalId, "GOALS_001"));
}

// Seed door hanger goals and entries in seedDemoData
export async function seedDoorHangerData() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Check if goals already exist
  const existingGoals = await db.select().from(doorHangerGoals).limit(1);
  if (existingGoals.length === 0) {
    const goalsData: InsertDoorHangerGoals = {
      goalId: "GOALS_001",
      dailyDoorHangerGoal: 50,
      dailyBusinessCardGoal: 20,
      dailyYardSignGoal: 2,
      dailyTableTopperGoal: 5,
      updatedBy: "ADM001",
    };
    await db.insert(doorHangerGoals).values(goalsData);
  }
  
  // Check if entries already exist
  const existingEntries = await db.select().from(doorHangerEntries).limit(1);
  if (existingEntries.length === 0) {
    const doorHangerEntryData: InsertDoorHangerEntry[] = [
      { entryId: "DHE_001", employeeId: "DHR001", date: "2026-03-28", address: "123 Main St", city: "Dallas", outreachType: "door_hangers", quantityDistributed: 50, notes: "Residential area" },
      { entryId: "DHE_002", employeeId: "DHR001", date: "2026-03-28", address: "456 Oak Ave", city: "Dallas", outreachType: "door_hangers", quantityDistributed: 40 },
      { entryId: "DHE_003", employeeId: "DHR001", date: "2026-03-29", address: "789 Elm Dr", city: "Dallas", outreachType: "business_cards", quantityDistributed: 20, notes: "Business district" },
      { entryId: "DHE_004", employeeId: "DHR002", date: "2026-03-28", address: "321 Pine Rd", city: "Fort Worth", outreachType: "door_hangers", quantityDistributed: 60 },
      { entryId: "DHE_005", employeeId: "DHR002", date: "2026-03-29", address: "654 Maple Ln", city: "Fort Worth", outreachType: "yard_signs", quantityDistributed: 3, notes: "Placed at commercial properties" },
    ];
    for (const entry of doorHangerEntryData) {
      await db.insert(doorHangerEntries).values(entry);
    }
  }
}

// ─── Training Modules ───
export async function getAllTrainingModules() {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(trainingModules).orderBy(trainingModules.orderIndex);
}

export async function getTrainingModuleById(moduleId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(trainingModules).where(eq(trainingModules.moduleId, moduleId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

// Look up a training module by the interactiveModules.moduleKey value
// (e.g. "carpet-cleaning-mpd2vek8") — used when the URL segment is the moduleKey
export async function getTrainingModuleByKey(moduleKey: string) {
  const db = await getDb();
  if (!db) return null;
  // The training_modules table uses moduleId like "TM_CUSTOM_..."
  // The interactive_modules table uses moduleKey like "carpet-cleaning-mpd2vek8"
  // Admin-created modules store the moduleKey in interactive_modules and the
  // corresponding TM_CUSTOM_... id in training_modules.moduleId.
  // We need to join through interactive_modules to find the right training module.
  const { interactiveModules } = await import('../drizzle/schema');
  const imResult = await db.select().from(interactiveModules)
    .where(eq(interactiveModules.moduleKey, moduleKey)).limit(1);
  if (imResult.length === 0) return null;
  // For admin modules, the training_modules.moduleId is stored separately.
  // Try direct lookup by moduleKey as moduleId first (legacy modules use same key)
  const directResult = await db.select().from(trainingModules)
    .where(eq(trainingModules.moduleId, moduleKey)).limit(1);
  if (directResult.length > 0) return directResult[0];
  // For admin-created modules, find by matching the module name from interactiveModules
  const im = imResult[0];
  const byName = await db.select().from(trainingModules)
    .where(eq(trainingModules.name, im.title)).limit(1);
  return byName.length > 0 ? byName[0] : null;
}

export async function createTrainingModule(data: InsertTrainingModule) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(trainingModules).values(data);
}

export async function updateTrainingModule(moduleId: string, data: { name?: string; description?: string; icon?: string; videoUrl?: string | null; quizTitle?: string | null }) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (data.name !== undefined) updateSet.name = data.name;
  if (data.description !== undefined) updateSet.description = data.description;
  if (data.icon !== undefined) updateSet.icon = data.icon;
  if (data.videoUrl !== undefined) updateSet.videoUrl = data.videoUrl;
  if (data.quizTitle !== undefined) updateSet.quizTitle = data.quizTitle;
  if (Object.keys(updateSet).length === 0) return;
  await db.update(trainingModules).set(updateSet).where(eq(trainingModules.moduleId, moduleId));
}

export async function deleteTrainingModule(moduleId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Cascade: delete steps, quiz questions, progress, attempts
  await db.delete(trainingSteps).where(eq(trainingSteps.moduleId, moduleId));
  await db.delete(trainingQuizQuestions).where(eq(trainingQuizQuestions.moduleId, moduleId));
  await db.delete(trainingQuizAttempts).where(eq(trainingQuizAttempts.moduleId, moduleId));
  await db.delete(userTrainingProgress).where(eq(userTrainingProgress.moduleId, moduleId));
  await db.delete(trainingModules).where(eq(trainingModules.moduleId, moduleId));
}

export async function reorderTrainingModules(orderedIds: string[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(trainingModules).set({ orderIndex: i }).where(eq(trainingModules.moduleId, orderedIds[i]));
  }
}

export async function reorderTrainingSteps(orderedStepIds: string[]) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  for (let i = 0; i < orderedStepIds.length; i++) {
    await db.update(trainingSteps).set({ orderIndex: i }).where(eq(trainingSteps.stepId, orderedStepIds[i]));
  }
}

// ─── Training Tools ───
export async function getToolsForModule(moduleId: string) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(trainingTools).where(eq(trainingTools.moduleId, moduleId)).orderBy(trainingTools.orderIndex);
}

export async function createTrainingTool(data: InsertTrainingTool) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(trainingTools).values(data);
}

// ─── Training Steps ───
export async function getStepsForModule(moduleId: string) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(trainingSteps).where(eq(trainingSteps.moduleId, moduleId)).orderBy(trainingSteps.orderIndex);
}

export async function createTrainingStep(data: InsertTrainingStep) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(trainingSteps).values(data);
}

export async function updateTrainingStep(
  stepId: string,
  data: {
    title?: string;
    description?: string;
    imageUrl?: string | null;
    videoUrl?: string | null;
    warnings?: string | null;
    tips?: string | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (data.title !== undefined) updateSet.title = data.title;
  if (data.description !== undefined) updateSet.description = data.description;
  if (data.imageUrl !== undefined) updateSet.imageUrl = data.imageUrl;
  if (data.videoUrl !== undefined) updateSet.videoUrl = data.videoUrl;
  if (data.warnings !== undefined) updateSet.warnings = data.warnings;
  if (data.tips !== undefined) updateSet.tips = data.tips;
  if (Object.keys(updateSet).length === 0) return;
  await db.update(trainingSteps).set(updateSet).where(eq(trainingSteps.stepId, stepId));
}

// ─── User Training Progress ───
export async function getUserTrainingProgress(employeeId: string, moduleId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(userTrainingProgress)
    .where(and(eq(userTrainingProgress.employeeId, employeeId), eq(userTrainingProgress.moduleId, moduleId)))
    .limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllUserTrainingProgress(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(userTrainingProgress).where(eq(userTrainingProgress.employeeId, employeeId));
}

export async function upsertUserTrainingProgress(data: InsertUserTrainingProgress) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await getUserTrainingProgress(data.employeeId, data.moduleId);
  if (existing) {
    await db.update(userTrainingProgress)
      .set({ completedSteps: data.completedSteps, isModuleCompleted: data.isModuleCompleted, completedAt: data.completedAt, updatedAt: new Date() })
      .where(and(eq(userTrainingProgress.employeeId, data.employeeId), eq(userTrainingProgress.moduleId, data.moduleId)));
  } else {
    const progressId = generateId('TPROG');
    await db.insert(userTrainingProgress).values({ ...data, progressId });
  }
}

export async function seedTrainingData() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Clear existing training data
  await db.delete(userTrainingProgress);
  await db.delete(trainingSteps);
  await db.delete(trainingTools);
  await db.delete(trainingModules);
  
  // Import seed data
  const { trainingModulesData, trainingToolsData, trainingStepsData } = await import("./training-seed-data");
  
  // Insert modules
  for (const module of trainingModulesData) {
    await db.insert(trainingModules).values(module);
  }
  
  // Insert tools
  for (const tool of trainingToolsData) {
    await db.insert(trainingTools).values(tool);
  }
  
  // Insert steps
  for (const step of trainingStepsData) {
    await db.insert(trainingSteps).values(step);
  }
}

// ─── Challenges ───
export async function seedChallengeData() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Check if challenges already exist
  const existing = await db.select().from(challenges).limit(1);
  if (existing.length > 0) return { message: "Challenge data already seeded" };
  
  // Create a sample challenge
  const challengeData: InsertChallenge[] = [
    {
      challengeId: "CHAL001",
      title: "Weekly Efficiency Challenge",
      prizeName: "$50 Bonus",
      prizeEmoji: "🏆",
      isActive: "yes",
      expiresAt: null,
      createdBy: "ADM001",
    },
  ];
  
  for (const challenge of challengeData) {
    await db.insert(challenges).values(challenge);
  }
  
  // Create sample quiz questions for the challenge
  const quizData: InsertQuizQuestion[] = [
    {
      questionId: "Q001",
      challengeId: "CHAL001",
      questionText: "What is the first step in a proper exterior detail?",
      optionA: "Wash the car",
      optionB: "Dry the car",
      optionC: "Polish the car",
      optionD: "Wax the car",
      correctAnswer: "A",
      orderIndex: 1,
    },
    {
      questionId: "Q002",
      challengeId: "CHAL001",
      questionText: "How long should you let soap sit before rinsing?",
      optionA: "30 seconds",
      optionB: "1-2 minutes",
      optionC: "5 minutes",
      optionD: "10 minutes",
      correctAnswer: "B",
      orderIndex: 2,
    },
    {
      questionId: "Q003",
      challengeId: "CHAL001",
      questionText: "What is the recommended water temperature for washing?",
      optionA: "Cold water",
      optionB: "Warm water (80-100°F)",
      optionC: "Hot water (120°F+)",
      optionD: "Any temperature works",
      correctAnswer: "B",
      orderIndex: 3,
    },
  ];
  
  for (const question of quizData) {
    await db.insert(quizQuestions).values(question);
  }
  
  return { message: "Challenge data seeded successfully" };
}

// ─── Team Chat Messages ───
export async function createTeamChatMessage(data: InsertTeamChatMessage) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(teamChatMessages).values(data);
}

export async function getTeamChatMessages(limit: number = 50, offset: number = 0) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(teamChatMessages)
    .orderBy(desc(teamChatMessages.createdAt))
    .limit(limit)
    .offset(offset);
}

export async function getTeamChatMessagesAfter(afterDate: Date, limit: number = 50) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(teamChatMessages)
    .where(gt(teamChatMessages.createdAt, afterDate))
    .orderBy(desc(teamChatMessages.createdAt))
    .limit(limit);
}

export async function getChannelMessages(channel: string, limit: number = 60) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(teamChatMessages)
    .where(eq(teamChatMessages.channel, channel))
    .orderBy(desc(teamChatMessages.createdAt))
    .limit(limit);
}

export async function getDmMessages(employeeIdA: string, employeeIdB: string, limit: number = 60) {
  const db = await getDb();
  if (!db) return [];
  return await db.select().from(teamChatMessages)
    .where(
      and(
        eq(teamChatMessages.channel, "dm"),
        or(
          and(eq(teamChatMessages.employeeId, employeeIdA), eq(teamChatMessages.recipientId, employeeIdB)),
          and(eq(teamChatMessages.employeeId, employeeIdB), eq(teamChatMessages.recipientId, employeeIdA)),
        )
      )
    )
    .orderBy(desc(teamChatMessages.createdAt))
    .limit(limit);
}

export async function getDmConversations(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  const msgs = await db.select().from(teamChatMessages)
    .where(
      and(
        eq(teamChatMessages.channel, "dm"),
        or(
          eq(teamChatMessages.employeeId, employeeId),
          eq(teamChatMessages.recipientId, employeeId),
        )
      )
    )
    .orderBy(desc(teamChatMessages.createdAt))
    .limit(500);
  const seen = new Map<string, typeof msgs[0]>();
  for (const msg of msgs) {
    const otherId = msg.employeeId === employeeId ? msg.recipientId! : msg.employeeId;
    if (!seen.has(otherId)) seen.set(otherId, msg);
  }
  // Compute per-sender unread count using chat_last_seen
  const conversations = Array.from(seen.values());
  const unreadCounts = new Map<string, number>();
  for (const msg of conversations) {
    const otherId = msg.employeeId === employeeId ? msg.recipientId! : msg.employeeId;
    const channelKey = `dm:${otherId}`;
    const rows = await db.execute(
      sql`SELECT COUNT(*) as cnt FROM team_chat_messages tcm
          LEFT JOIN chat_last_seen cls ON cls.employee_id = ${employeeId} AND cls.channel_key = ${channelKey}
          WHERE tcm.channel = 'dm' AND tcm.employee_id = ${otherId} AND tcm.recipient_id = ${employeeId}
          AND (cls.last_seen_at IS NULL OR tcm.created_at > cls.last_seen_at)`
    ) as any;
    unreadCounts.set(otherId, Number(rows?.[0]?.[0]?.cnt ?? rows?.[0]?.cnt ?? 0));
  }
  return conversations.map(msg => {
    const otherId = msg.employeeId === employeeId ? msg.recipientId! : msg.employeeId;
    return { ...msg, unreadCount: unreadCounts.get(otherId) ?? 0 };
  });
}

export async function createQuestion(data: InsertQuizQuestion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(quizQuestions).values(data);
}


// ─── Clock In/Out Records ───
// City center coordinates used as default GPS when a detailer clocks in without a prior location
const CITY_CENTERS: Record<string, { lat: string; lng: string }> = {
  niceville:  { lat: '30.5180', lng: '-86.4860' },
  crestview:  { lat: '30.7460', lng: '-86.5710' },
  destin:     { lat: '30.3935', lng: '-86.4958' },
  fwb:        { lat: '30.4060', lng: '-86.6190' },
  pensacola:  { lat: '30.4213', lng: '-87.2169' },
};

export async function clockIn(employeeId: string, fullName: string, lat?: number, lng?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const today = todayCST();
  const recordId = generateId('CLOCK');
  const clockInTime = new Date();
  
  await db.insert(clockInOutRecords).values({
    recordId,
    employeeId,
    fullName,
    date: today,
    clockInTime,
    status: "clocked_in",
    ...(lat != null && lng != null ? { clockInLat: lat.toString(), clockInLng: lng.toString() } : {}),
  });

  // Show detailer on Fleet Map for the entire shift
  try {
    const existing = await db.select().from(detailerLocations)
      .where(eq(detailerLocations.employeeId, employeeId)).limit(1);
    const empRow = await db.select().from(employees)
      .where(eq(employees.employeeId, employeeId)).limit(1);
    const citySlug = empRow[0]?.city ? normalizeLocation(empRow[0].city) : 'niceville';
    const cityDefault = CITY_CENTERS[citySlug] || CITY_CENTERS['niceville'];
    // Keep last known position if available, otherwise use city center
    const lat = (existing[0] && existing[0].status !== 'inactive') ? existing[0].lat : cityDefault.lat;
    const lng = (existing[0] && existing[0].status !== 'inactive') ? existing[0].lng : cityDefault.lng;
    await db.insert(detailerLocations).values({
      employeeId,
      fullName,
      lat,
      lng,
      status: 'clocked_in',
    }).onDuplicateKeyUpdate({
      set: { fullName, status: 'clocked_in', lat, lng },
    });
  } catch (_) { /* non-fatal: map pin is best-effort */ }

  return { recordId, clockInTime };
}

export async function clockOut(employeeId: string, lat?: number, lng?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const today = todayCST();
  
  // Find today's clock in record
  const records = await db.select().from(clockInOutRecords)
    .where(and(eq(clockInOutRecords.employeeId, employeeId), eq(clockInOutRecords.date, today), eq(clockInOutRecords.status, "clocked_in")))
    .orderBy(desc(clockInOutRecords.clockInTime))
    .limit(1);
  
  if (records.length === 0) throw new Error("No active clock in found");
  
  const record = records[0];
  const clockOutTime = new Date();
  const clockInTime = new Date(record.clockInTime!);
  const breakDeduction = await getBreakDeductionHours(employeeId, today);
  const totalHours = Math.max(0, (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60) - breakDeduction);
  
  await db.update(clockInOutRecords)
    .set({
      clockOutTime,
      status: "clocked_out",
      totalHours: totalHours.toString(),
      ...(lat != null && lng != null ? { clockOutLat: lat.toString(), clockOutLng: lng.toString() } : {}),
    })
    .where(eq(clockInOutRecords.recordId, record.recordId));

  // Remove detailer from Fleet Map when they clock out
  try {
    await db.update(detailerLocations)
      .set({ status: 'inactive' })
      .where(eq(detailerLocations.employeeId, employeeId));
  } catch (_) { /* non-fatal */ }
  
  // Also update the daily performance with the hours.
  // If no performance record exists yet for today, create one so hours are always persisted.
  const performanceRecord = await db.select().from(dailyPerformance)
    .where(and(eq(dailyPerformance.employeeId, employeeId), eq(dailyPerformance.date, today)))
    .limit(1);
  
  if (performanceRecord.length > 0) {
    await db.update(dailyPerformance)
      .set({ hoursWorked: totalHours.toString() })
      .where(eq(dailyPerformance.recordId, performanceRecord[0].recordId));
  } else {
    // No performance record yet — create a minimal one so hours are captured
    const { nanoid } = await import("nanoid");
    const emp = await getEmployeeById(employeeId);
    await db.insert(dailyPerformance).values({
      recordId: nanoid(),
      employeeId,
      fullName: emp?.fullName ?? employeeId,
      date: today,
      hoursWorked: totalHours.toString(),
      revenueProduced: "0",
      efficiencyPercent: "0",
      upsells: "0",
      tips: "0",
    });
  }
  
  return { recordId: record.recordId, clockOutTime, totalHours };
}

export async function getTodayClockStatus(employeeId: string) {
  const db = await getDb();
  if (!db) return null;
  const today = todayCST();
  
  // Get the latest record for today (either clocked in or clocked out)
  const records = await db.select().from(clockInOutRecords)
    .where(and(eq(clockInOutRecords.employeeId, employeeId), eq(clockInOutRecords.date, today)))
    .orderBy(desc(clockInOutRecords.clockInTime))
    .limit(1);
  
  if (records.length === 0) return null;
  
  const record = records[0];
  
  // Determine status based on whether clockOutTime exists
  const status = record.clockOutTime ? "clocked_out" : "clocked_in";
  
  return {
    ...record,
    status,
  };
}

// ─── Break Records ───
export async function createBreakNotification(employeeId: string, fullName: string, breakType: "morning_15min" | "afternoon_15min" | "lunch_30min", startLat?: number, startLng?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const today = todayCST();

  // Prevent duplicate: if a record for this employee + breakType + date already exists, return it
  const existing = await db.select().from(breakRecords)
    .where(and(
      eq(breakRecords.employeeId, employeeId),
      eq(breakRecords.breakType, breakType),
      eq(breakRecords.date, today)
    ))
    .limit(1);
  if (existing.length > 0) {
    return { breakId: existing[0].breakId, breakStartTime: existing[0].breakStartTime };
  }

  const breakId = generateId('BREAK');
  const durationMinutes = breakType === "lunch_30min" ? 30 : 15;
  
  const now = new Date();
  
  await db.insert(breakRecords).values({
    breakId,
    employeeId,
    fullName,
    date: today,
    breakType,
    durationMinutes,
    status: "taken",
    breakStartTime: now,
    notificationSent: "yes",
    ...(startLat != null && startLng != null ? { breakStartLat: startLat.toString(), breakStartLng: startLng.toString() } : {}),
  });
  
  return { breakId, breakStartTime: now };
}

export async function updateBreakStatus(breakId: string, status: "pending" | "taken" | "skipped", startTime?: Date, endTime?: Date, startLat?: number, startLng?: number, endLat?: number, endLng?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  await db.update(breakRecords)
    .set({
      status,
      breakStartTime: startTime,
      breakEndTime: endTime,
      ...(startLat != null && startLng != null ? { breakStartLat: startLat.toString(), breakStartLng: startLng.toString() } : {}),
      ...(endLat != null && endLng != null ? { breakEndLat: endLat.toString(), breakEndLng: endLng.toString() } : {}),
      updatedAt: new Date()
    })
    .where(eq(breakRecords.breakId, breakId));
}

export async function getTodayBreaks(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  const today = todayCST();
  
  return await db.select().from(breakRecords)
    .where(and(eq(breakRecords.employeeId, employeeId), eq(breakRecords.date, today)))
    .orderBy(breakRecords.createdAt);
}

/** Returns total break deduction in hours for an employee on a given date (only 'taken' breaks with actual start/end times) */
async function getBreakDeductionHours(employeeId: string, date: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const breaks = await db.select().from(breakRecords)
    .where(and(
      eq(breakRecords.employeeId, employeeId),
      eq(breakRecords.date, date),
      eq(breakRecords.status, "taken")
    ));
  let deductionMs = 0;
  for (const br of breaks) {
    if (br.breakStartTime && br.breakEndTime) {
      // Use actual start/end times for precision
      deductionMs += new Date(br.breakEndTime).getTime() - new Date(br.breakStartTime).getTime();
    } else {
      // Fall back to scheduled duration if end time not recorded
      deductionMs += (br.durationMinutes ?? 0) * 60 * 1000;
    }
  }
  return deductionMs / (1000 * 60 * 60);
}

/** Re-calculates totalHours on ALL clocked-out records for a given employee/date after break or time changes */
export async function recalcClockRecordForDate(employeeId: string, date: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  // Fetch ALL clocked-out records for this employee/date (there may be multiple time slots)
  const records = await db.select().from(clockInOutRecords)
    .where(and(
      eq(clockInOutRecords.employeeId, employeeId),
      eq(clockInOutRecords.date, date),
      eq(clockInOutRecords.status, "clocked_out")
    ));
  if (records.length === 0) return; // still clocked in or no records — nothing to recalc
  // Break deduction is shared across all time slots for the day
  const breakDeduction = await getBreakDeductionHours(employeeId, date);
  // Compute raw hours per record so we can distribute break deduction proportionally
  const rawHoursPerRecord = records.map(r => {
    const ci = new Date(r.clockInTime!);
    const co = r.clockOutTime ? new Date(r.clockOutTime) : new Date();
    return Math.max(0, (co.getTime() - ci.getTime()) / (1000 * 60 * 60));
  });
  const totalRawHours = rawHoursPerRecord.reduce((s, h) => s + h, 0);
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    const rawHours = rawHoursPerRecord[i];
    // Distribute break deduction proportionally across all slots for the day
    const slotBreakDeduction = totalRawHours > 0 ? breakDeduction * (rawHours / totalRawHours) : 0;
    const totalHours = Math.max(0, rawHours - slotBreakDeduction);
    await db.update(clockInOutRecords)
      .set({ totalHours: totalHours.toString(), updatedAt: new Date() })
      .where(eq(clockInOutRecords.recordId, record.recordId));
  }
}

export async function getWeeklyClockLogs(employeeId: string, startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  
  const logs = await db.select().from(clockInOutRecords)
    .where(and(
      eq(clockInOutRecords.employeeId, employeeId),
      gte(clockInOutRecords.date, startDate),
      lte(clockInOutRecords.date, endDate)
    ))
    .orderBy(clockInOutRecords.date);
  
  // Get breaks for this week
  const breaks = await db.select().from(breakRecords)
    .where(and(
      eq(breakRecords.employeeId, employeeId),
      gte(breakRecords.date, startDate),
      lte(breakRecords.date, endDate)
    ))
    .orderBy(breakRecords.date);
  
  return { logs, breaks };
}

export async function getWeeklyHours(employeeId: string, startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return { totalHours: 0, dailyHours: [] };

  const logs = await db.select().from(clockInOutRecords)
    .where(and(
      eq(clockInOutRecords.employeeId, employeeId),
      gte(clockInOutRecords.date, startDate),
      lte(clockInOutRecords.date, endDate),
      eq(clockInOutRecords.status, "clocked_out")
    ))
    .orderBy(clockInOutRecords.date);

  // Compute live totals per day from actual clock times + breaks (avoids stale stored totalHours)
  const uniqueDates = [...new Set(logs.map(l => l.date).filter(Boolean))] as string[];
  const breakDeductionByDate: Record<string, number> = {};
  for (const date of uniqueDates) {
    breakDeductionByDate[date] = await getBreakDeductionHours(employeeId, date);
  }

  // Sum raw hours per day across all time slots
  const dailyRawMap: Record<string, number> = {};
  for (const log of logs) {
    const date = log.date!;
    if (!dailyRawMap[date]) dailyRawMap[date] = 0;
    const ci = new Date(log.clockInTime!);
    const co = log.clockOutTime ? new Date(log.clockOutTime) : new Date();
    dailyRawMap[date] += Math.max(0, (co.getTime() - ci.getTime()) / (1000 * 60 * 60));
  }
  // Subtract break deduction per day
  const dailyNetMap: Record<string, number> = {};
  for (const date of Object.keys(dailyRawMap)) {
    dailyNetMap[date] = Math.max(0, dailyRawMap[date] - (breakDeductionByDate[date] ?? 0));
  }

  const totalHours = Object.values(dailyNetMap).reduce((s, h) => s + h, 0);
  const dailyHours = Object.entries(dailyNetMap).map(([date, hours]) => ({ date, hours }));

  return { totalHours, dailyHours };
}

export async function updateClockInTime(recordId: string, clockInTime: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Fetch existing record to recalculate totalHours if clockOut already exists
  const records = await db.select().from(clockInOutRecords)
    .where(eq(clockInOutRecords.recordId, recordId));

  if (records.length === 0) throw new Error("Record not found");

  const record = records[0];
  const updateFields: Record<string, any> = { clockInTime, updatedAt: new Date() };

  if (record.clockOutTime) {
    const clockOutTime = record.clockOutTime ? new Date(record.clockOutTime) : new Date();
    const breakDeduction = await getBreakDeductionHours(record.employeeId!, record.date!);
    const totalHours = Math.max(0, (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60) - breakDeduction);
    updateFields.totalHours = totalHours.toString();
  }

  await db.update(clockInOutRecords)
    .set(updateFields)
    .where(eq(clockInOutRecords.recordId, recordId));

  return { success: true, totalHours: updateFields.totalHours ? parseFloat(updateFields.totalHours) : null };
}

export async function updateClockOutTime(recordId: string, clockOutTime: Date) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  // Get the record to recalculate hours
  const records = await db.select().from(clockInOutRecords)
    .where(eq(clockInOutRecords.recordId, recordId));
  
  if (records.length === 0) throw new Error("Record not found");
  
  const record = records[0];
  const clockInTime = new Date(record.clockInTime!);
  const breakDeduction = await getBreakDeductionHours(record.employeeId!, record.date!);
  const totalHours = Math.max(0, (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60) - breakDeduction);
  
  await db.update(clockInOutRecords)
    .set({ clockOutTime, totalHours: totalHours.toString(), updatedAt: new Date() })
    .where(eq(clockInOutRecords.recordId, recordId));
  
  return { success: true, totalHours };
}


export async function getActiveBreak(employeeId: string) {
  const db = await getDb();
  if (!db) return null;
  const today = todayCST();
  
  // Get the most recent break that is marked as "taken" but doesn't have an end time
  const breaks = await db.select().from(breakRecords)
    .where(and(
      eq(breakRecords.employeeId, employeeId),
      eq(breakRecords.date, today),
      eq(breakRecords.status, "taken")
    ))
    .orderBy(breakRecords.breakStartTime);
  
  // Find the first break without an end time
  const activeBreak = breaks.find(b => !b.breakEndTime);
  return activeBreak || null;
}

export async function endBreak(breakId: string, endLat?: number, endLng?: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const endTime = new Date();
  
  await db.update(breakRecords)
    .set({
      breakEndTime: endTime,
      ...(endLat != null && endLng != null ? { breakEndLat: endLat.toString(), breakEndLng: endLng.toString() } : {}),
      updatedAt: new Date()
    })
    .where(eq(breakRecords.breakId, breakId));
  
  return { breakId, breakEndTime: endTime };
}

// ─── Online Bookings ───

// Location config: how many simultaneous jobs each location supports
export const LOCATION_CAPACITY: Record<string, number> = {
  crestview: 2,
  niceville: 2,
  destin: 1,
  fwb: 1,
  pensacola: 1,
};

// Map from city name in employees table -> location slug
const CITY_TO_SLUG: Record<string, string> = {
  crestview: "crestview",
  niceville: "niceville",
  destin: "destin",
  "fort walton beach": "fwb",
  "fort walton": "fwb",
  fwb: "fwb",
  pensacola: "pensacola",
};

/** Returns the number of active detailers for a given location slug (live from DB). */
export async function getLocationCapacity(locationSlug: string): Promise<number> {
  try {
    const db = await getDb();
    if (!db) return LOCATION_CAPACITY[locationSlug] ?? 1;
    const cityName = locationSlug === "fwb" ? "fort walton beach" : locationSlug;
    const rows = await db
      .select({ count: sql<number>`COUNT(*)` })
      .from(employees)
      .where(and(
        eq(employees.role, "detailer"),
        eq(employees.activeStatus, "active"),
        sql`LOWER(${employees.city}) = ${cityName}`
      ));
    const count = Number(rows[0]?.count ?? 0);
    return count > 0 ? count : (LOCATION_CAPACITY[locationSlug] ?? 1);
  } catch {
    return LOCATION_CAPACITY[locationSlug] ?? 1;
  }
}

/** Returns a map of location slug -> active detailer count for all known locations. */
export async function getAllLocationCapacities(): Promise<Record<string, number>> {
  try {
    const db = await getDb();
    if (!db) return { ...LOCATION_CAPACITY };
    const rows = await db
      .select({ city: employees.city, count: sql<number>`COUNT(*)` })
      .from(employees)
      .where(and(eq(employees.role, "detailer"), eq(employees.activeStatus, "active")))
      .groupBy(employees.city);
    const result: Record<string, number> = { ...LOCATION_CAPACITY };
    for (const row of rows) {
      const slug = CITY_TO_SLUG[(row.city ?? "").toLowerCase().trim()];
      if (slug) result[slug] = Number(row.count);
    }
    return result;
  } catch {
    return { ...LOCATION_CAPACITY };
  }
}

/** Returns the list of active detailers for a given location slug. */
export async function getDetailersByLocation(locationSlug: string) {
  const db = await getDb();
  if (!db) return [];
  const cityName = locationSlug === "fwb" ? "Fort Walton Beach" : locationSlug.charAt(0).toUpperCase() + locationSlug.slice(1);
  const rows = await db
    .select({
      employeeId: employees.employeeId,
      fullName: employees.fullName,
      city: employees.city,
      shift: employeeVanAssignments.shift,
    })
    .from(employees)
    .leftJoin(employeeVanAssignments, eq(employees.employeeId, employeeVanAssignments.employeeId))
    .where(and(
      eq(employees.role, "detailer"),
      eq(employees.activeStatus, "active"),
      sql`LOWER(${employees.city}) = LOWER(${cityName})`
    ))
    .orderBy(employees.fullName);
  // Ensure shift defaults to 'shift1' if no van assignment exists
  return rows.map(r => ({ ...r, shift: r.shift ?? 'shift1' }));
}

// Normalize location slug from various input forms
export function normalizeLocation(raw: string): string {
  const s = raw.toLowerCase().trim().replace(/\s+/g, "_");
  if (s.includes("crestview")) return "crestview";
  if (s.includes("niceville")) return "niceville";
  if (s.includes("destin")) return "destin";
  if (s.includes("fort_walton") || s.includes("fwb") || s.includes("fort walton")) return "fwb";
  if (s.includes("pensacola")) return "pensacola";
  return s;
}

// Parse time slot string like "8:00am - 10:30am" into { startHour: 8, endHour: 10.5 }
export function parseTimeSlot(slot: string): { startHour: number; endHour: number } {
  // Strip any leading date prefix (e.g. "2026-05-30 -1:00pm - 3:00pm" -> "1:00pm - 3:00pm")
  const cleaned = slot.replace(/^\d{4}-\d{2}-\d{2}\s*-?\s*/i, '').trim();
  // Split on " - " or "-" between time parts, keep only tokens that contain am/pm
  // e.g. "8:00am - 11:30am" -> ["8:00am", "11:30am"]
  const allParts = cleaned.toLowerCase().split(/\s*-\s*/).map(s => s.trim()).filter(Boolean);
  const parts = allParts.filter(p => p.includes('am') || p.includes('pm'));
  const parseHour = (s: string) => {
    const isPm = s.includes("pm");
    const isAm = s.includes("am");
    const timePart = s.replace(/[^0-9:]/g, ""); // e.g. "8:30" or "8"
    const [hourStr, minStr] = timePart.split(":");
    const num = parseInt(hourStr, 10);
    const mins = minStr ? parseInt(minStr, 10) : 0;
    let h = num;
    if (isPm && num !== 12) h = num + 12;
    if (isAm && num === 12) h = 0;
    return h + (mins >= 30 ? 0.5 : 0);
  };
  return {
    startHour: parseHour(parts[0]),
    endHour: parseHour(parts[1] || parts[0]),
  };
}

export async function createOnlineBooking(data: InsertOnlineBooking) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(onlineBookings).values(data);
}

export async function getBookingsByDateAndLocation(location: string, date: string) {
  const db = await getDb();
  if (!db) return [];

  // Query BOTH online bookings AND schedule jobs so the AI sees the full picture
  const [webBookings, schedJobs] = await Promise.all([
    db.select({
      timeSlot: onlineBookings.timeSlot,
      startHour: onlineBookings.startHour,
      endHour: onlineBookings.endHour,
    }).from(onlineBookings)
      .where(and(
        sql`LOWER(${onlineBookings.location}) = LOWER(${location})`,
        eq(onlineBookings.bookingDate, date),
        ne(onlineBookings.status, "cancelled"),
      )),
    db.select({
      timeSlot: scheduleJobs.timeSlot,
      startHour: scheduleJobs.startHour,
      endHour: scheduleJobs.endHour,
    }).from(scheduleJobs)
      .where(and(
        sql`LOWER(${scheduleJobs.location}) = LOWER(${location})`,
        eq(scheduleJobs.date, date),
        ne(scheduleJobs.status, "cancelled"),
      )),
  ]);

  // Merge both result sets — includes timeSlot, startHour, and endHour
  return [
    ...webBookings.map(b => ({ timeSlot: b.timeSlot, startHour: b.startHour, endHour: b.endHour })),
    ...schedJobs.map(j => ({ timeSlot: j.timeSlot, startHour: j.startHour, endHour: j.endHour })),
  ];
}

export async function getBookingById(bookingId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(onlineBookings).where(eq(onlineBookings.bookingId, bookingId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getAllBookingsForLocation(location: string, fromDate?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [sql`LOWER(${onlineBookings.location}) = LOWER(${location})`];
  if (fromDate) conditions.push(gte(onlineBookings.bookingDate, fromDate));
  // Exclude abandoned/closed carts — they are NOT real bookings and should never appear on any calendar
  conditions.push(sql`${onlineBookings.status} NOT IN ('abandoned', 'closed')`);
  conditions.push(sql`${onlineBookings.bookingId} NOT LIKE 'ABANDONED-%'`);
  // LEFT JOIN schedule_jobs to get the authoritative status after detailer updates.
  // schedule_jobs.job_id for online bookings = 'online_' + bookingId
  const rows = await db
    .select({
      bookingId: onlineBookings.bookingId,
      location: onlineBookings.location,
      bookingDate: onlineBookings.bookingDate,
      startHour: onlineBookings.startHour,
      endHour: onlineBookings.endHour,
      firstName: onlineBookings.firstName,
      lastName: onlineBookings.lastName,
      email: onlineBookings.email,
      phone: onlineBookings.phone,
      streetAddress: onlineBookings.streetAddress,
      unit: onlineBookings.unit,
      city: onlineBookings.city,
      state: onlineBookings.state,
      zipCode: onlineBookings.zipCode,
      packageType: onlineBookings.packageType,
      vehicleType: onlineBookings.vehicleType,
      selectedAddons: onlineBookings.selectedAddons,
      totalPrice: onlineBookings.totalPrice,
      finalTotal: onlineBookings.finalTotal,
      createdAt: onlineBookings.createdAt,
      // Use schedule_jobs status if available (detailer updates write there)
      status: sql<string>`COALESCE(${scheduleJobs.status}, ${onlineBookings.status})`,
      assignedTo: sql<string | null>`COALESCE(${scheduleJobs.assignedTo}, ${onlineBookings.assignedTo})`,
    })
    .from(onlineBookings)
    .leftJoin(scheduleJobs, eq(scheduleJobs.jobId, sql`CONCAT('online_', ${onlineBookings.bookingId})`))
    .where(and(...conditions))
    .orderBy(onlineBookings.bookingDate, onlineBookings.startHour);
  return rows;
}

export async function updateBookingStatus(bookingId: string, status: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled") {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(onlineBookings).set({ status }).where(eq(onlineBookings.bookingId, bookingId));
}

// Seed the 6 real detailers for the 4 Florida locations
export async function seedDetailers() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const detailers: InsertEmployee[] = [
    { employeeId: "DET_MICHAEL", fullName: "Michael", email: "michael@luxurywashonwheels.com", pin: "1111", role: "detailer", city: "Crestview", activeStatus: "active", hireDate: "2024-01-01" },
    { employeeId: "DET_CAMERON", fullName: "Cameron", email: "cameron@luxurywashonwheels.com", pin: "2222", role: "detailer", city: "Crestview", activeStatus: "active", hireDate: "2024-01-01" },
    { employeeId: "DET_LAMONT",  fullName: "Lamont",  email: "lamont@luxurywashonwheels.com",  pin: "3333", role: "detailer", city: "Niceville", activeStatus: "active", hireDate: "2024-01-01" },
    { employeeId: "DET_CASEY",   fullName: "Casey",   email: "casey@luxurywashonwheels.com",   pin: "4444", role: "detailer", city: "Niceville", activeStatus: "active", hireDate: "2024-01-01" },
    { employeeId: "DET_GIOVANNI",fullName: "Giovanni",email: "giovanni@luxurywashonwheels.com",pin: "5555", role: "detailer", city: "Destin",    activeStatus: "active", hireDate: "2024-01-01" },
    { employeeId: "DET_GABE",    fullName: "Gabe",    email: "gabe@luxurywashonwheels.com",    pin: "6666", role: "detailer", city: "Fort Walton Beach", activeStatus: "active", hireDate: "2024-01-01" },
  ];

  const results: string[] = [];
  for (const det of detailers) {
    const existing = await db.select().from(employees).where(eq(employees.employeeId, det.employeeId)).limit(1);
    if (existing.length === 0) {
      await db.insert(employees).values(det);
      results.push(`Created: ${det.fullName}`);
    } else {
      results.push(`Already exists: ${det.fullName}`);
    }
  }
  return { results };
}

export async function deactivateEmployee(employeeId: string) {
  const db = await getDb();
  if (!db) return;
  await db.update(employees).set({ activeStatus: "inactive" }).where(eq(employees.employeeId, employeeId));
}

// ─── Clock Monitor Helpers ────────────────────────────────────────────────────
/** Returns all clock records where status = 'clocked_in' for today */
export async function getAllActiveClockedIn() {
  const db = await getDb();
  if (!db) return [];
  const today = todayCST();
  return db.select().from(clockInOutRecords)
    .where(and(eq(clockInOutRecords.date, today), eq(clockInOutRecords.status, "clocked_in")));
}

/** Returns all break records for today that are 'taken' but have no breakEndTime */
export async function getAllActiveBreaks() {
  const db = await getDb();
  if (!db) return [];
  const today = todayCST();
  const breaks = await db.select().from(breakRecords)
    .where(and(eq(breakRecords.date, today), eq(breakRecords.status, "taken")));
  return breaks.filter(b => !b.breakEndTime);
}

/** Returns all admin/owner/ops employees to notify */
export async function getAdminEmployees() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(employees)
    .where(and(
      inArray(employees.role, ["admin", "operations_manager"]),
      eq(employees.activeStatus, "active")
    ));
}

/** Auto clock out a specific employee by recordId */
export async function autoClockOut(recordId: string, reason: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const clockOutTime = new Date();
  const records = await db.select().from(clockInOutRecords)
    .where(eq(clockInOutRecords.recordId, recordId)).limit(1);
  if (records.length === 0) throw new Error("Record not found");
  const record = records[0];
  const clockInTime = new Date(record.clockInTime!);
  const breakDeduction = await getBreakDeductionHours(record.employeeId!, record.date!);
  const totalHours = Math.max(0, (clockOutTime.getTime() - clockInTime.getTime()) / (1000 * 60 * 60) - breakDeduction);
  await db.update(clockInOutRecords)
    .set({ clockOutTime, status: "clocked_out", totalHours: totalHours.toString() })
    .where(eq(clockInOutRecords.recordId, recordId));
  console.log(`[ClockMonitor] Auto clocked out ${record.fullName} (${reason})`);
  return { recordId, clockOutTime, totalHours, fullName: record.fullName, employeeId: record.employeeId };
}

/** Auto end a break for a specific breakId */
export async function autoEndBreak(breakId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const endTime = new Date();
  const breaks = await db.select().from(breakRecords)
    .where(eq(breakRecords.breakId, breakId)).limit(1);
  if (breaks.length === 0) throw new Error("Break not found");
  const br = breaks[0];
  await db.update(breakRecords)
    .set({ breakEndTime: endTime, updatedAt: new Date() })
    .where(eq(breakRecords.breakId, breakId));
  console.log(`[ClockMonitor] Auto ended break for ${br.fullName} (${br.breakType})`);
  return { breakId, breakEndTime: endTime, fullName: br.fullName, employeeId: br.employeeId, breakType: br.breakType };
}

// ─── Sales Callbacks ─────────────────────────────────────────────────────────
export async function createSalesCallback(data: import("../drizzle/schema").InsertSalesCallback) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(salesCallbacks).values(data);
}

export async function getSalesCallbackById(callbackId: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(salesCallbacks).where(eq(salesCallbacks.callbackId, callbackId)).limit(1);
  return result.length > 0 ? result[0] : null;
}

export async function getSalesCallbacksByEmployee(assignedTo: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(salesCallbacks)
    .where(eq(salesCallbacks.assignedTo, assignedTo))
    .orderBy(desc(salesCallbacks.scheduledAt));
}

export async function getAllSalesCallbacks() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(salesCallbacks).orderBy(desc(salesCallbacks.scheduledAt));
}

export async function updateSalesCallbackStatus(
  callbackId: string,
  data: {
    status?: "scheduled" | "completed" | "missed" | "cancelled" | "rescheduled";
    completedAt?: Date | null;
    outcome?: string | null;
    assignedTo?: string;
    assignedToName?: string;
    scheduledAt?: Date;
    notes?: string | null;
    ghlTriggered?: "yes" | "no" | "failed";
    ghlTriggeredAt?: Date | null;
    ghlPayload?: string | null;
    ghlResponse?: string | null;
    reminderSent?: "yes" | "no";
    reminderSentAt?: Date | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(data)) {
    if (v !== undefined) updateSet[k] = v;
  }
  if (Object.keys(updateSet).length === 0) return;
  await db.update(salesCallbacks).set(updateSet as any).where(eq(salesCallbacks.callbackId, callbackId));
}

/** Returns all callbacks scheduled within the next N minutes that haven't had a reminder sent yet */
export async function getUpcomingCallbacksForReminder(withinMinutes: number) {
  const db = await getDb();
  if (!db) return [];
  const now = new Date();
  const cutoff = new Date(now.getTime() + withinMinutes * 60 * 1000);
  return db.select().from(salesCallbacks)
    .where(and(
      eq(salesCallbacks.status, "scheduled"),
      eq(salesCallbacks.reminderSent, "no"),
      gte(salesCallbacks.scheduledAt, now),
      lte(salesCallbacks.scheduledAt, cutoff),
    ));
}

/** Get all sales team members */
export async function getAllSalesReps() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(employees)
    .where(and(eq(employees.role, "sales"), eq(employees.activeStatus, "active")))
    .orderBy(employees.fullName);
}

// ─── Schedule Jobs ─────────────────────────────────────────────────────────────
/** Upsert a job — insert or update by jobId */
export async function upsertScheduleJob(data: InsertScheduleJob) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(scheduleJobs).values(data).onDuplicateKeyUpdate({
    set: {
      location: data.location,
      date: data.date,
      timeSlot: data.timeSlot,
      startHour: data.startHour,
      endHour: data.endHour,
      customerId: data.customerId,
      customerName: data.customerName,
      customerPhone: data.customerPhone,
      customerEmail: data.customerEmail,
      vehicleType: data.vehicleType,
      vehicleColor: data.vehicleColor,
      vehicleYear: data.vehicleYear,
      vehicleMake: data.vehicleMake,
      vehicleModel: data.vehicleModel,
      packageType: data.packageType,
      serviceDescription: data.serviceDescription,
      selectedAddons: data.selectedAddons,
      addonQtys: data.addonQtys,
      totalPrice: data.totalPrice,
      tips: data.tips,
      upsellTotal: data.upsellTotal,
      assignedTo: data.assignedTo,
      status: data.status,
      notes: data.notes,
      privateNotes: data.privateNotes,
      tags: data.tags,
      leadSource: data.leadSource,
      taxAmount: data.taxAmount,
      discountCode: data.discountCode,
      discountAmount: data.discountAmount,
      additionalVehicles: data.additionalVehicles,
      recommendedServices: data.recommendedServices,
      apptConfirmToken: data.apptConfirmToken,
      customPrice: data.customPrice,
    },
  });
}
/** Update job metadata: tags, privateNotes, taxAmount */
export async function updateJobMeta(
  jobId: string,
  meta: {
    tags?: string | null;
    privateNotes?: string | null;
    taxAmount?: string | null;
    discountCode?: string | null;
    discountAmount?: string | null;
    depositAmount?: string | null;
    notes?: string | null;
    customerAddress?: string | null;
  }
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (meta.tags !== undefined) updateSet.tags = meta.tags;
  if (meta.privateNotes !== undefined) updateSet.privateNotes = meta.privateNotes;
  if (meta.taxAmount !== undefined) updateSet.taxAmount = meta.taxAmount;
  if (meta.discountCode !== undefined) updateSet.discountCode = meta.discountCode;
  if (meta.discountAmount !== undefined) updateSet.discountAmount = meta.discountAmount;
  if (meta.depositAmount !== undefined) updateSet.depositAmount = meta.depositAmount;
  if (meta.notes !== undefined) updateSet.notes = meta.notes;
  if (meta.customerAddress !== undefined) updateSet.customerAddress = meta.customerAddress;
  if (Object.keys(updateSet).length === 0) return;
  // NOTE: totalPrice is the raw service price and is NOT modified here.
  // Discounts are stored separately in discountAmount and subtracted at display/revenue time.
  await db.update(scheduleJobs).set(updateSet as any).where(eq(scheduleJobs.jobId, jobId));
}

/** Get all completed jobs for a customer by phone or email (customer history) */
export async function getCustomerHistory(
  phone?: string | null,
  email?: string | null,
  excludeJobId?: string,
) {
  const db = await getDb();
  if (!db) return [];
  if (!phone && !email) return [];
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const phoneConditions: any[] = [];
  if (phone) phoneConditions.push(eq(scheduleJobs.customerPhone, phone));
  if (email) phoneConditions.push(eq(scheduleJobs.customerEmail, email));
  const rows = await db.select().from(scheduleJobs)
    .where(and(
      or(...phoneConditions),
      lte(scheduleJobs.date, today),
      ne(scheduleJobs.status, "cancelled"),
    ))
    .orderBy(desc(scheduleJobs.date))
    .limit(3);
  return excludeJobId ? rows.filter(r => r.jobId !== excludeJobId) : rows;
}

/** Get all jobs for a given location */
export async function getScheduleJobsByLocation(location: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduleJobs)
    .where(sql`LOWER(${scheduleJobs.location}) = LOWER(${location})`)
    .orderBy(scheduleJobs.date, scheduleJobs.startHour);
}

/** Get a single schedule job by its jobId */
export async function getScheduleJobById(jobId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(scheduleJobs)
    .where(eq(scheduleJobs.jobId, jobId))
    .limit(1);
  return rows[0] ?? null;
}

/** Get all jobs for a given location and date range */
export async function getScheduleJobsByLocationAndDateRange(
  location: string,
  startDate: string,
  endDate: string,
  assignedTo?: string, // if provided, only return jobs for this detailer
) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    sql`LOWER(${scheduleJobs.location}) = LOWER(${location})`,
    gte(scheduleJobs.date, startDate),
    lte(scheduleJobs.date, endDate),
    // Exclude cancelled jobs — they should not appear on any calendar
    sql`COALESCE(${scheduleJobs.status}, 'confirmed') != 'cancelled'`,
  ];
  if (assignedTo) {
    // STRICT matching: match by exact employeeId OR exact first name (case-insensitive)
    // This prevents cross-detailer job leakage from fuzzy LIKE matching.
    // Build a set of exact values this employee could be stored as:
    // 1. Their employeeId (e.g. "DETTORY", "DET_CASEY", "JOSEPH")
    // 2. Their full name (e.g. "Tory Smith")
    // 3. Their first name only (e.g. "Tory") — legacy jobs used first name
    const empRow = await db.select({ fullName: employees.fullName })
      .from(employees)
      .where(eq(employees.employeeId, assignedTo))
      .limit(1);
    const exactMatches: string[] = [assignedTo]; // always match employeeId
    if (empRow.length > 0) {
      const fullName = empRow[0].fullName;
      const firstName = fullName.split(' ')[0];
      if (fullName && !exactMatches.includes(fullName)) exactMatches.push(fullName);
      if (firstName && !exactMatches.includes(firstName)) exactMatches.push(firstName);
      // Also add lowercase variants for case-insensitive exact match
      if (firstName.toLowerCase() !== firstName && !exactMatches.includes(firstName.toLowerCase())) exactMatches.push(firstName.toLowerCase());
      // Add UPPER variant (some legacy data stored as "JOSEPH" vs "Joseph")
      if (firstName.toUpperCase() !== firstName && !exactMatches.includes(firstName.toUpperCase())) exactMatches.push(firstName.toUpperCase());
    }
    // Use exact IN() match — no more fuzzy LIKE that can match substrings of other names
    const assignedToCondition = sql`${scheduleJobs.assignedTo} IN (${sql.join(exactMatches.map(v => sql`${v}`), sql`, `)})`;
    conditions.push(assignedToCondition);
  }
  // LEFT JOIN online_bookings so we can fall back to the online booking's address
  // when customerAddress is missing on the schedule job (older mirrored jobs)
  const { onlineBookings } = await import('../drizzle/schema');
  const rows = await db
    .select({
      jobId: scheduleJobs.jobId,
      location: scheduleJobs.location,
      date: scheduleJobs.date,
      timeSlot: scheduleJobs.timeSlot,
      startHour: scheduleJobs.startHour,
      endHour: scheduleJobs.endHour,
      customerId: scheduleJobs.customerId,
      customerName: scheduleJobs.customerName,
      customerPhone: scheduleJobs.customerPhone,
      customerEmail: scheduleJobs.customerEmail,
      vehicleType: scheduleJobs.vehicleType,
      vehicleColor: scheduleJobs.vehicleColor,
      vehicleYear: scheduleJobs.vehicleYear,
      vehicleMake: scheduleJobs.vehicleMake,
      vehicleModel: scheduleJobs.vehicleModel,
      packageType: scheduleJobs.packageType,
      serviceDescription: scheduleJobs.serviceDescription,
      selectedAddons: scheduleJobs.selectedAddons,
      addonQtys: scheduleJobs.addonQtys,
      totalPrice: scheduleJobs.totalPrice,
      tips: scheduleJobs.tips,
      upsellTotal: scheduleJobs.upsellTotal,
      upsellIds: scheduleJobs.upsellIds,
      upsellQtys: scheduleJobs.upsellQtys,
      assignedTo: scheduleJobs.assignedTo,
      status: scheduleJobs.status,
      source: scheduleJobs.source,
      onlineBookingId: scheduleJobs.onlineBookingId,
      notes: scheduleJobs.notes,
      privateNotes: scheduleJobs.privateNotes,
      tags: scheduleJobs.tags,
      leadSource: scheduleJobs.leadSource,
      taxAmount: scheduleJobs.taxAmount,
      discountCode: scheduleJobs.discountCode,
      discountAmount: scheduleJobs.discountAmount,
      depositAmount: scheduleJobs.depositAmount,
      additionalVehicles: scheduleJobs.additionalVehicles,
      photoUrls: scheduleJobs.photoUrls,
      videoUrls: scheduleJobs.videoUrls,
      recommendedServices: scheduleJobs.recommendedServices,
      createdBy: scheduleJobs.createdBy,
      isNewCustomer: scheduleJobs.isNewCustomer,
      onMyWayAt: scheduleJobs.onMyWayAt,
      arrivedAt: scheduleJobs.arrivedAt,
      finishedAt: scheduleJobs.finishedAt,
      createdAt: scheduleJobs.createdAt,
      updatedAt: scheduleJobs.updatedAt,
      // Payment record
      paymentMethod: scheduleJobs.paymentMethod,
      paymentIntentId: scheduleJobs.paymentIntentId,
      paymentSubtotal: scheduleJobs.paymentSubtotal,
      paymentTip: scheduleJobs.paymentTip,
      paymentTotal: scheduleJobs.paymentTotal,
      paymentPaidAt: scheduleJobs.paymentPaidAt,
      paymentSignatureUrl: scheduleJobs.paymentSignatureUrl,
      paymentReferenceNote: scheduleJobs.paymentReferenceNote,
      // Appointment confirmation
      apptConfirmationStatus: scheduleJobs.apptConfirmationStatus,
      apptReminderSent: scheduleJobs.apptReminderSent,
      apptConfirmedAt: scheduleJobs.apptConfirmedAt,
      apptConfirmMethod: scheduleJobs.apptConfirmMethod,
      customPrice: scheduleJobs.customPrice, // per-booking price override (admin only)
      // Coalesce: prefer stored customerAddress, fall back to online booking address parts
      customerAddress: sql<string>`COALESCE(
        NULLIF(${scheduleJobs.customerAddress}, ''),
        CASE
          WHEN ${onlineBookings.streetAddress} IS NOT NULL
          THEN CONCAT_WS(', ',
            ${onlineBookings.streetAddress},
            ${onlineBookings.city},
            ${onlineBookings.state},
            ${onlineBookings.zipCode}
          )
          ELSE NULL
        END
      )`,
    })
    .from(scheduleJobs)
    .leftJoin(onlineBookings, eq(scheduleJobs.onlineBookingId, onlineBookings.bookingId))
    .where(and(...conditions))
    .orderBy(scheduleJobs.date, scheduleJobs.startHour);
  // Correct totalPrice for multi-vehicle jobs where additionalVehicles prices
  // were not included in the stored totalPrice (legacy bug)
  return rows.map((row) => {
    if (!row.additionalVehicles || row.customPrice != null) return row;
    let extras: Array<{ price?: number | string }> = [];
    try { extras = JSON.parse(row.additionalVehicles as string); } catch { return row; }
    if (!Array.isArray(extras) || extras.length === 0) return row;
    const extraTotal = extras.reduce((s, v) => s + (Number(v.price) || 0), 0);
    if (extraTotal === 0) return row;
    const storedTotal = parseFloat(String(row.totalPrice ?? 0));
    // If storedTotal is less than extraTotal alone, it clearly doesn't include extras
    // Use a threshold: if storedTotal < extraTotal * 0.9, it's missing the extras
    if (storedTotal < extraTotal * 0.9) {
      return { ...row, totalPrice: String(storedTotal + extraTotal) };
    }
    return row;
  });
}

/**
 * Get the detailer in a city with the fewest jobs on a given date who is also
 * available (no conflicting job) in the requested time window.
 * Falls back to least-loaded if no one is fully free.
 */
export async function getLeastLoadedDetailer(
  location: string,
  date: string,
  startHour?: number,
  endHour?: number,
): Promise<string | null> {
  const allDetailers = await getDetailersByLocation(location);
  if (allDetailers.length === 0) return null;

  // Filter to detailers who actually work on this day-of-week (shift-aware)
  // shift1 = Mon–Thu ONLY | shift2 = Fri–Sun ONLY (no Thursday overlap)
  const shift1Days = new Set([1, 2, 3, 4]); // Mon–Thu
  const [yyyy, mm, dd] = date.split('-').map(Number);
  const dow = new Date(yyyy, mm - 1, dd).getDay();
  const detailers = allDetailers.filter((d: any) => {
    const shift = (d.shift ?? 'shift1') as 'shift1' | 'shift2';
    if (shift === 'shift1') return shift1Days.has(dow); // Mon–Thu
    return dow === 5 || dow === 6 || dow === 0; // Fri–Sun only for shift2
  });
  // Fall back to all detailers if none match (shouldn't happen in practice)
  const pool0 = detailers.length > 0 ? detailers : allDetailers;
  if (pool0.length === 1) return pool0[0].employeeId;
  const db = await getDb();
  if (!db) return pool0[0].employeeId;
  // Get all jobs for this location on this date
  const dayJobs = await db
    .select({ assignedTo: scheduleJobs.assignedTo, startHour: scheduleJobs.startHour, endHour: scheduleJobs.endHour })
    .from(scheduleJobs)
    .where(and(sql`LOWER(${scheduleJobs.location}) = LOWER(${location})`, eq(scheduleJobs.date, date)));
  // Count jobs and check time conflicts per detailer
  const countMap: Record<string, number> = {};
  const conflictSet = new Set<string>();
  for (const job of dayJobs) {
    if (!job.assignedTo) continue;
    countMap[job.assignedTo] = (countMap[job.assignedTo] ?? 0) + 1;
    // Check time overlap if startHour/endHour provided
    if (startHour !== undefined && endHour !== undefined && job.startHour != null && job.endHour != null) {
      const jS = parseFloat(String(job.startHour)); const jE = parseFloat(String(job.endHour));
      if (jS < endHour && jE > startHour) {
        conflictSet.add(job.assignedTo);
      }
    }
  }
  // First try: available detailers (no time conflict), pick least loaded
  const available = detailers.filter((d) => !conflictSet.has(d.employeeId));
  const pool = available.length > 0 ? available : detailers; // fall back to all if everyone conflicts
  let minCount = Infinity;
  let picked = pool[0].employeeId;
  for (const d of pool) {
    const c = countMap[d.employeeId] ?? 0;
    if (c < minCount) { minCount = c; picked = d.employeeId; }
  }
  return picked;
}

/** Get all jobs across all locations for a date range (admin view) */
export async function getAllScheduleJobsByDateRange(startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  const { onlineBookings } = await import('../drizzle/schema');
  const rows = await db
    .select({
      jobId: scheduleJobs.jobId,
      location: scheduleJobs.location,
      date: scheduleJobs.date,
      timeSlot: scheduleJobs.timeSlot,
      startHour: scheduleJobs.startHour,
      endHour: scheduleJobs.endHour,
      customerId: scheduleJobs.customerId,
      customerName: scheduleJobs.customerName,
      customerPhone: scheduleJobs.customerPhone,
      customerEmail: scheduleJobs.customerEmail,
      vehicleType: scheduleJobs.vehicleType,
      vehicleColor: scheduleJobs.vehicleColor,
      vehicleYear: scheduleJobs.vehicleYear,
      vehicleMake: scheduleJobs.vehicleMake,
      vehicleModel: scheduleJobs.vehicleModel,
      packageType: scheduleJobs.packageType,
      serviceDescription: scheduleJobs.serviceDescription,
      selectedAddons: scheduleJobs.selectedAddons,
      addonQtys: scheduleJobs.addonQtys,
      totalPrice: scheduleJobs.totalPrice,
      tips: scheduleJobs.tips,
      upsellTotal: scheduleJobs.upsellTotal,
      upsellIds: scheduleJobs.upsellIds,
      upsellQtys: scheduleJobs.upsellQtys,
      assignedTo: scheduleJobs.assignedTo,
      status: scheduleJobs.status,
      source: scheduleJobs.source,
      onlineBookingId: scheduleJobs.onlineBookingId,
      notes: scheduleJobs.notes,
      privateNotes: scheduleJobs.privateNotes,
      tags: scheduleJobs.tags,
      leadSource: scheduleJobs.leadSource,
      taxAmount: scheduleJobs.taxAmount,
      discountCode: scheduleJobs.discountCode,
      discountAmount: scheduleJobs.discountAmount,
      depositAmount: scheduleJobs.depositAmount,
      additionalVehicles: scheduleJobs.additionalVehicles,
      photoUrls: scheduleJobs.photoUrls,
      videoUrls: scheduleJobs.videoUrls,
      recommendedServices: scheduleJobs.recommendedServices,
      createdBy: scheduleJobs.createdBy,
      isNewCustomer: scheduleJobs.isNewCustomer,
      createdAt: scheduleJobs.createdAt,
      updatedAt: scheduleJobs.updatedAt,
      onMyWayAt: scheduleJobs.onMyWayAt,
      arrivedAt: scheduleJobs.arrivedAt,
      finishedAt: scheduleJobs.finishedAt,
      customerAddress: sql<string>`COALESCE(
        NULLIF(${scheduleJobs.customerAddress}, ''),
        CASE
          WHEN ${onlineBookings.streetAddress} IS NOT NULL
          THEN CONCAT_WS(', ',
            ${onlineBookings.streetAddress},
            ${onlineBookings.city},
            ${onlineBookings.state},
            ${onlineBookings.zipCode}
          )
          ELSE NULL
        END
      )`,
    })
    .from(scheduleJobs)
    .leftJoin(onlineBookings, eq(scheduleJobs.onlineBookingId, onlineBookings.bookingId))
    .where(and(
      gte(scheduleJobs.date, startDate),
      lte(scheduleJobs.date, endDate),
    ))
    .orderBy(scheduleJobs.date, scheduleJobs.startHour);
  return rows;
}

/** Get all jobs booked/created by a specific sales rep, newest first */
export async function getJobsBookedByRep(createdBy: string, limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduleJobs)
    .where(eq(scheduleJobs.createdBy, createdBy))
    .orderBy(sql`${scheduleJobs.date} DESC, ${scheduleJobs.startHour} DESC`)
    .limit(limit);
}

/** Cancel a job — marks scheduleJobs row as 'cancelled' and marks the linked customerBookings row
 * as 'cancelled' too. The job stays visible in history with a Cancelled badge.
 * Handles both numeric schedule job IDs and portal_ prefixed booking refs. */
export async function cancelScheduleJob(jobId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Handle portal_ prefix: the job exists only in customer_bookings, not schedule_jobs
  if (jobId.startsWith('portal_')) {
    const bookingRef = jobId.replace(/^portal_/, '');
    await db.update(customerBookings)
      .set({ status: 'cancelled' })
      .where(eq(customerBookings.bookingRef, bookingRef));
    return;
  }

  // Mark the schedule job as cancelled
  await db.update(scheduleJobs)
    .set({ status: 'cancelled' })
    .where(eq(scheduleJobs.jobId, jobId));
  // Also mark the linked customer portal booking as cancelled (if any)
  const [job] = await db.select({ onlineBookingId: scheduleJobs.onlineBookingId })
    .from(scheduleJobs)
    .where(eq(scheduleJobs.jobId, jobId))
    .limit(1);
  if (job?.onlineBookingId) {
    await db.update(customerBookings)
      .set({ status: 'cancelled' })
      .where(eq(customerBookings.bookingRef, job.onlineBookingId));
  }
  // Also cancel the linked online_bookings row so it disappears from admin/detailer sync
  const onlineBookingId = job?.onlineBookingId ?? (jobId.startsWith('online_') ? jobId.replace(/^online_/, '') : null);
  if (onlineBookingId) {
    await db.update(onlineBookings)
      .set({ status: 'cancelled' })
      .where(eq(onlineBookings.bookingId, onlineBookingId));
  }
}

/** Hard-delete a job — completely removes the scheduleJobs row AND the linked customerBookings row.
 * The job will no longer appear anywhere: admin schedule, detailer schedule, or customer portal.
 * Handles both numeric schedule job IDs and portal_ prefixed booking refs. */
export async function deleteScheduleJob(jobId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  // Find the linked portal booking before deleting (works for both portal_ prefixed and regular job IDs)
  const [job] = await db.select({ onlineBookingId: scheduleJobs.onlineBookingId })
    .from(scheduleJobs)
    .where(eq(scheduleJobs.jobId, jobId))
    .limit(1);
  // Hard-delete the schedule job row
  await db.delete(scheduleJobs).where(eq(scheduleJobs.jobId, jobId));
  // Determine the booking ref: either from the linked schedule_job or from the portal_ prefix
  const bookingRef = job?.onlineBookingId ?? (jobId.startsWith('portal_') ? jobId.replace(/^portal_/, '') : null);
  // Hard-delete the linked customer portal booking so it disappears from the customer app
  if (bookingRef) {
    await db.delete(customerBookings)
      .where(eq(customerBookings.bookingRef, bookingRef));
  }
  // Also delete the linked online_bookings row so it doesn't reappear on admin/detailer sync
  // For online-mirrored jobs, jobId = 'online_' + bookingId
  const onlineBookingId = job?.onlineBookingId ?? (jobId.startsWith('online_') ? jobId.replace(/^online_/, '') : null);
  if (onlineBookingId) {
    await db.delete(onlineBookings)
      .where(eq(onlineBookings.bookingId, onlineBookingId));
  }
}
/** Delete recurring series instances by recurrenceParentId.
 * - mode "all": deletes all non-completed instances in the series
 * - mode "future": deletes non-completed instances with date >= fromDate
 * Completed jobs are never deleted to preserve customer history.
 */
export async function deleteRecurringSeries(
  recurrenceParentId: string,
  mode: "all" | "future",
  fromDate?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const conditions: any[] = [
    eq(scheduleJobs.recurrenceParentId, recurrenceParentId),
    ne(scheduleJobs.status, "completed"),
  ];
  if (mode === "future" && fromDate) {
    conditions.push(gte(scheduleJobs.date, fromDate));
  }
  await db.delete(scheduleJobs).where(and(...conditions));
}

/**
 * Cancel recurring series instances by setting status to 'cancelled' (preserves history).
 * - mode "all": cancels all non-completed instances in the series
 * - mode "future": cancels non-completed instances with date >= fromDate
 * - mode "single": cancels a single job by jobId
 * Completed jobs are never cancelled.
 */
export async function cancelRecurringSeries(
  recurrenceParentId: string,
  mode: "all" | "future" | "single",
  fromDate?: string,
  jobId?: string
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  if (mode === "single" && jobId) {
    await db.update(scheduleJobs)
      .set({ status: "cancelled" })
      .where(and(
        eq(scheduleJobs.jobId, jobId),
        ne(scheduleJobs.status, "completed")
      ));
    return;
  }
  const conditions: any[] = [
    eq(scheduleJobs.recurrenceParentId, recurrenceParentId),
    ne(scheduleJobs.status, "completed"),
  ];
  if (mode === "future" && fromDate) {
    conditions.push(gte(scheduleJobs.date, fromDate));
  }
  await db.update(scheduleJobs).set({ status: "cancelled" }).where(and(...conditions));
}

/** Get all jobs in a recurring series by recurrenceParentId */
export async function getJobsByRecurrenceParent(recurrenceParentId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(scheduleJobs)
    .where(eq(scheduleJobs.recurrenceParentId, recurrenceParentId));
}

/**
 * Sync a detailer's daily_performance record from all their completed/in-progress jobs on a given date.
 * Called automatically whenever a job status changes.
 * - Hours = sum of (endHour - startHour) for each job
 * - Revenue = sum of totalPrice for each job
 * - Efficiency = (revenue / (hours * 100)) * 100  (target: $100/hr)
 * - Upsells = sum of upsellTotal
 * - Tips = sum of tips
 */
export async function syncPerformanceFromJobs(assignedTo: string, date: string): Promise<void> {
  const dbConn = await getDb();
  if (!dbConn) return;

  // Resolve employee record — assignedTo may be an employeeId (DET_XXX) or a name
  let emp: { employeeId: string; fullName: string; city: string | null } | null = null;
  if (assignedTo.startsWith('DET_') || assignedTo.startsWith('ADM_') || assignedTo.startsWith('EMP_')) {
    emp = await getEmployeeById(assignedTo);
  }
  if (!emp) {
    // Try to find by exact full name (case-insensitive)
    const all = await getAllActiveEmployees();
    emp = all.find(e => e.fullName.toLowerCase() === assignedTo.toLowerCase()) ?? null;
    if (!emp) {
      // Try to find by first name only (handles cases like assignedTo="Sean" matching "Sean Moyer")
      const firstName = assignedTo.split(' ')[0].toLowerCase();
      emp = all.find(e => e.fullName.toLowerCase().startsWith(firstName + ' ') || e.fullName.toLowerCase() === firstName) ?? null;
    }
    if (!emp) {
      // Try to find by employeeId (handles cases like assignedTo="DETCAITLIN" passed as a name)
      emp = all.find(e => e.employeeId.toLowerCase() === assignedTo.toLowerCase()) ?? null;
    }
  }
  if (!emp) return; // Unknown detailer — skip

  // Extract first name for matching jobs stored with just a first name (e.g. "Caitlin" instead of "DETCAITLIN")
  const empFirstName = emp.fullName.split(' ')[0];

  // Get all non-cancelled jobs for this detailer on this date
  // Match by: original assignedTo value, employeeId, full name, or first name
  const jobs = await dbConn.select().from(scheduleJobs)
    .where(and(
      or(
        eq(scheduleJobs.assignedTo, assignedTo),
        eq(scheduleJobs.assignedTo, emp.employeeId),
        eq(scheduleJobs.assignedTo, emp.fullName),
        eq(scheduleJobs.assignedTo, empFirstName),
      ),
      eq(scheduleJobs.date, date),
      inArray(scheduleJobs.status, ['confirmed', 'in_progress', 'completed']),
    ));

  if (jobs.length === 0) return;

  // ALWAYS use actual clock-in/clock-out hours from the timesheet.
  // Job slot hours (startHour/endHour) are NEVER used for efficiency — they are just scheduled windows.
  // If a detailer has no clock-in record for this date, hours_worked = 0 and efficiency = 0.
  const clockRecords = await dbConn.select()
    .from(clockInOutRecords)
    .where(and(
      eq(clockInOutRecords.employeeId, emp.employeeId),
      eq(clockInOutRecords.date, date),
      eq(clockInOutRecords.status, 'clocked_out'),
    ));
  const totalHours = clockRecords.reduce((sum, r) => sum + parseFloat((r.totalHours as string | null) ?? '0'), 0);

  // Revenue = (base package price - discount) + upsell add-ons (tips are NEVER counted as revenue)
  // Only count completed jobs for revenue — confirmed/in_progress jobs haven't been earned yet
  let baseRevenue = 0;
  let totalUpsells = 0;
  let totalTips = 0;
  for (const job of jobs) {
    const discount = parseFloat((job.discountAmount as string | null) ?? '0');
    // Count revenue from all active jobs (confirmed/in_progress/completed) — they are booked revenue
    baseRevenue += Math.max(0, parseFloat(job.totalPrice ?? '0') - discount);
    totalUpsells += parseFloat((job.upsellTotal as string | null) ?? '0');
    totalTips += parseFloat((job.tips as string | null) ?? '0');
  }

  // Revenue = package price + upsells (tips excluded)
  const totalRevenue = baseRevenue + totalUpsells;
  // Efficiency: target is $100/hr = 100%. Formula: (revenue / hours) / 100 * 100 = revenue / hours
  // e.g. $800 revenue / 8 hrs = $100/hr = 100% efficiency
  const rawEfficiency = totalHours > 0 ? (totalRevenue / totalHours) / 100 * 100 : 0;
  const efficiency = Math.min(rawEfficiency, 999.99); // cap to DB column max (DECIMAL 5,2)
  // Upsell bonus = 40% of total upsell amount (detailer earns 40% of every upsell they sell)
  // daily_performance.upsells stores the BONUS amount (40%), not the full upsell revenue
  const upsellBonus = totalUpsells * 0.4;

  const { nanoid } = await import('nanoid');
  await upsertPerformance({
    recordId: `PERF_${emp.employeeId}_${date.replace(/-/g, '')}`,
    date,
    employeeId: emp.employeeId,
    fullName: emp.fullName,
    city: emp.city ?? '',
    hoursWorked: totalHours.toFixed(2),
    revenueProduced: totalRevenue.toFixed(2),
    efficiencyPercent: efficiency.toFixed(2),
    upsells: upsellBonus.toFixed(2),
    tips: totalTips.toFixed(2),
    createdBy: 'system',
  });
}

/**
 * Re-sync all performance records for a date range by re-aggregating from actual job data.
 * Used by admin to backfill/correct records that were written with 0 efficiency due to name mismatch bugs.
 */
export async function resyncPerformanceForDateRange(startDate: string, endDate: string): Promise<number> {
  const dbConn = await getDb();
  if (!dbConn) return 0;

  // Get all unique (assignedTo, date) pairs within the range that have jobs
  const jobs = await dbConn.select({
    assignedTo: scheduleJobs.assignedTo,
    date: scheduleJobs.date,
  }).from(scheduleJobs)
    .where(and(
      gte(scheduleJobs.date, startDate),
      lte(scheduleJobs.date, endDate),
      inArray(scheduleJobs.status, ['confirmed', 'in_progress', 'completed']),
    ));

  // Deduplicate (assignedTo, date) pairs
  const pairs = new Map<string, { assignedTo: string; date: string }>();
  for (const j of jobs) {
    if (j.assignedTo && j.date) {
      const key = `${j.assignedTo}__${j.date}`;
      pairs.set(key, { assignedTo: j.assignedTo, date: j.date });
    }
  }

  let count = 0;
  for (const { assignedTo, date } of pairs.values()) {
    try {
      await syncPerformanceFromJobs(assignedTo, date);
      count++;
    } catch {
      // Skip failures silently
    }
  }
  return count;
}

/** Update job status */
export async function updateScheduleJobStatus(
  jobId: string,
  status: "pending" | "confirmed" | "in_progress" | "completed" | "cancelled",
  tips?: number,
  upsellTotal?: number,
  totalPrice?: number,
  upsellIds?: string[],
  upsellQtys?: Record<string, number>,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = { status };
  if (tips !== undefined) updateSet.tips = tips.toFixed(2);
  if (upsellTotal !== undefined) updateSet.upsellTotal = upsellTotal.toFixed(2);
  if (totalPrice !== undefined) updateSet.totalPrice = totalPrice.toFixed(2);
  if (upsellIds !== undefined) updateSet.upsellIds = JSON.stringify(upsellIds);
  if (upsellQtys !== undefined) updateSet.upsellQtys = JSON.stringify(upsellQtys);
  await db.update(scheduleJobs).set(updateSet as any).where(eq(scheduleJobs.jobId, jobId));

  // Auto-sync performance after any status change
  try {
    const job = await getScheduleJobById(jobId);
    if (job?.assignedTo && job.date) {
      await syncPerformanceFromJobs(job.assignedTo, job.date);
    }
    // Auto-transfer revenue to Finance when job is completed
    if (status === "completed" && job) {
      const { autoTransferJobRevenue } = await import("./financeDb");
      await autoTransferJobRevenue({
        jobId: job.jobId,
        location: job.location,
        totalPrice: job.totalPrice,
        discountAmount: job.discountAmount ?? "0",
        tips: tips !== undefined ? tips : job.tips,
        date: job.date,
        performedBy: job.assignedTo ?? "system",
      });
    }
  } catch (e) {
    // Non-fatal — don't break the status update if sync fails
    console.error('[syncPerformance] Failed to sync after status update:', e);
  }
}

/** Reassign a job to a different detailer */
export async function reassignScheduleJob(jobId: string, newAssignedTo: string | null) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // null or empty string = unassign (set to null in DB so it shows in Unassigned lane)
  await db.update(scheduleJobs).set({ assignedTo: newAssignedTo || null }).where(eq(scheduleJobs.jobId, jobId));
}

/** Save payment record for a job after admin collects payment */
export async function saveJobPayment(jobId: string, payment: {
  paymentMethod?: string | null;
  paymentIntentId?: string | null;
  paymentSubtotal?: string | null;
  paymentTip?: string | null;
  paymentTotal?: string | null;
  paymentPaidAt?: string | null;
  paymentSignatureUrl?: string | null;
  paymentReferenceNote?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(scheduleJobs).set(payment as any).where(eq(scheduleJobs.jobId, jobId));
}

/** Get completed jobs for a detailer in a date range (for dashboard revenue) */
export async function getCompletedJobsForDetailer(assignedTo: string, startDate: string, endDate: string) {
  const db = await getDb();
  if (!db) return [];
  // STRICT matching: build exact match set from employee record
  // This prevents cross-detailer job leakage from fuzzy LIKE matching.
  const empRow = await db.select({ fullName: employees.fullName })
    .from(employees)
    .where(eq(employees.employeeId, assignedTo))
    .limit(1);
  const exactMatches: string[] = [assignedTo];
  if (empRow.length > 0) {
    const fullName = empRow[0].fullName;
    const firstName = fullName.split(' ')[0];
    if (fullName && !exactMatches.includes(fullName)) exactMatches.push(fullName);
    if (firstName && !exactMatches.includes(firstName)) exactMatches.push(firstName);
    if (firstName.toLowerCase() !== firstName && !exactMatches.includes(firstName.toLowerCase())) exactMatches.push(firstName.toLowerCase());
    if (firstName.toUpperCase() !== firstName && !exactMatches.includes(firstName.toUpperCase())) exactMatches.push(firstName.toUpperCase());
  }
  return db.select().from(scheduleJobs)
    .where(and(
      sql`${scheduleJobs.assignedTo} IN (${sql.join(exactMatches.map(v => sql`${v}`), sql`, `)})`,
      inArray(scheduleJobs.status, ["pending", "confirmed", "in_progress", "completed"]),
      gte(scheduleJobs.date, startDate),
      lte(scheduleJobs.date, endDate),
    ))
    .orderBy(scheduleJobs.date);
}

// ─── Detailer Live Locations ──────────────────────────────────────────────────

/** Upsert a detailer's current GPS location (called every ~30s while on the way) */
export async function upsertDetailerLocation(data: InsertDetailerLocation): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.insert(detailerLocations).values(data).onDuplicateKeyUpdate({
    set: {
      lat: data.lat,
      lng: data.lng,
      jobId: data.jobId ?? null,
      fullName: data.fullName ?? null,
      customerAddress: data.customerAddress ?? null,
      status: data.status ?? "on_my_way",
    },
  });
}

/** Mark a detailer as inactive (arrived or clocked out) */
export async function deactivateDetailerLocation(employeeId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(detailerLocations)
    .set({ status: "inactive" })
    .where(eq(detailerLocations.employeeId, employeeId));
}

/** Get all active detailer locations (clocked_in + on_my_way) — admin Fleet Map.
 * Only returns detailers who have an OPEN clock record today (clocked_in, not yet clocked_out).
 * This prevents stale location pins from previous sessions showing on the map.
 */
export async function getActiveDetailerLocations() {
  const db = await getDb();
  if (!db) return [];

  const today = new Date().toISOString().split('T')[0];

  // Find employees who have an open clock-in today (status = 'clocked_in' in clock records)
  const openClockRows = await db
    .select({ employeeId: clockInOutRecords.employeeId })
    .from(clockInOutRecords)
    .where(and(
      eq(clockInOutRecords.date, today),
      eq(clockInOutRecords.status, 'clocked_in'),
    ));

  if (!openClockRows.length) return [];

  const activeEmployeeIds = openClockRows.map((r) => r.employeeId);

  // Only show detailer-role employees as van pins — never admins, owners, or managers
  const detailerRoles = ['detailer'] as const;
  const detailerEmployees = await db
    .select({ employeeId: employees.employeeId })
    .from(employees)
    .where(and(
      inArray(employees.employeeId, activeEmployeeIds),
      inArray(employees.role, detailerRoles),
    ));

  if (!detailerEmployees.length) return [];

  const detailerIds = detailerEmployees.map((e) => e.employeeId);

  // Return location rows for all clocked-in detailers — show on map regardless of job status
  // (clocked_in, on_my_way, arrived, started, finished — all should appear while clocked in)
  return db.select().from(detailerLocations)
    .where(inArray(detailerLocations.employeeId, detailerIds));
}

// ─── Tracking Tokens ──────────────────────────────────────────────────────────

function generateTrackingToken(): string {
  return randomBytes(12).toString("hex"); // 24-char hex token
}

/** Create a new 30-minute tracking token for a job */
export async function createTrackingToken(data: Omit<InsertTrackingToken, "token" | "expiresAt" | "active">): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const token = generateTrackingToken();
  const expiresAt = new Date(Date.now() + 30 * 60 * 1000); // 30 minutes
  await db.insert(trackingTokens).values({ ...data, token, expiresAt, active: "yes" });
  return token;
}

/** Deactivate all tracking tokens for a job (called when detailer arrives) */
export async function deactivateTrackingTokensForJob(jobId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await db.update(trackingTokens)
    .set({ active: "no" })
    .where(eq(trackingTokens.jobId, jobId));
}

/** Get a valid (active + not expired) tracking token with the detailer's current location */
export async function getTrackingTokenData(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(trackingTokens)
    .where(and(
      eq(trackingTokens.token, token),
      eq(trackingTokens.active, "yes"),
    ))
    .limit(1);
  if (!rows.length) return null;
  const t = rows[0];
  if (new Date() > t.expiresAt) return null; // expired
  // Fetch the detailer's current location
  const locRows = await db.select().from(detailerLocations)
    .where(eq(detailerLocations.employeeId, t.employeeId))
    .limit(1);
  const loc = locRows[0] ?? null;
  return { token: t, location: loc };
}

/** Get a tracking token regardless of active status — used to show "arrived" page */
export async function getTrackingTokenAnyStatus(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(trackingTokens)
    .where(eq(trackingTokens.token, token))
    .limit(1);
  return rows[0] ?? null;
}
/** Get active tracking data by jobId — used by customer tracking screen.
 * jobId may be bookingRef (e.g. LW-1234) or portal_LW-1234 — we try both. */
export async function getActiveTokenDataByJobId(jobId: string) {
  const db = await getDb();
  if (!db) return null;
  // Build candidate jobIds: raw value + portal_ prefix variant
  const candidates = [jobId];
  if (!jobId.startsWith('portal_')) candidates.push(`portal_${jobId}`);
  else candidates.push(jobId.replace(/^portal_/, ''));
  // Find the most recently created active token for any candidate jobId
  const rows = await db.select().from(trackingTokens)
    .where(and(
      inArray(trackingTokens.jobId, candidates),
      eq(trackingTokens.active, 'yes'),
    ))
    .orderBy(desc(trackingTokens.createdAt))
    .limit(1);
  if (!rows.length) {
    // Token may be expired/inactive — check if one exists at all (arrived state)
    const anyRows = await db.select().from(trackingTokens)
      .where(inArray(trackingTokens.jobId, candidates))
      .orderBy(desc(trackingTokens.createdAt))
      .limit(1);
    if (!anyRows.length) return null;
    return { token: anyRows[0], location: null, arrived: true };
  }
  const t = rows[0];
  const expired = new Date() > t.expiresAt;
  // Fetch detailer's current location
  const locRows = await db.select().from(detailerLocations)
    .where(eq(detailerLocations.employeeId, t.employeeId))
    .limit(1);
  const loc = locRows[0] ?? null;
  const arrived = expired || loc?.status === 'arrived';
  return { token: t, location: arrived ? null : loc, arrived };
}


// ─── Private Notes (per-author) ───────────────────────────────────────────────

export interface PrivateNote {
  id: string;
  authorId: string;
  authorName: string;
  text: string;
  createdAt: string; // ISO string
  updatedAt: string; // ISO string
}

function parsePrivateNotes(raw: string | null | undefined): PrivateNote[] {
  if (!raw) return [];
  try { return JSON.parse(raw) as PrivateNote[]; } catch { return []; }
}

/** Add a new private note to a job */
export async function addPrivateNote(
  jobId: string,
  note: { authorId: string; authorName: string; text: string },
): Promise<PrivateNote> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ privateNotes: scheduleJobs.privateNotes })
    .from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  const notes = parsePrivateNotes(rows[0]?.privateNotes);
  const now = new Date().toISOString();
  const newNote: PrivateNote = {
    id: `note_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
    authorId: note.authorId,
    authorName: note.authorName,
    text: note.text,
    createdAt: now,
    updatedAt: now,
  };
  notes.push(newNote);
  await db.update(scheduleJobs).set({ privateNotes: JSON.stringify(notes) } as any)
    .where(eq(scheduleJobs.jobId, jobId));
  return newNote;
}

/** Edit an existing private note — only the author may edit */
export async function editPrivateNote(
  jobId: string,
  noteId: string,
  requesterId: string,
  newText: string,
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ privateNotes: scheduleJobs.privateNotes })
    .from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  const notes = parsePrivateNotes(rows[0]?.privateNotes);
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return { success: false, error: "Note not found" };
  if (notes[idx].authorId !== requesterId) return { success: false, error: "Not authorized" };
  notes[idx].text = newText;
  notes[idx].updatedAt = new Date().toISOString();
  await db.update(scheduleJobs).set({ privateNotes: JSON.stringify(notes) } as any)
    .where(eq(scheduleJobs.jobId, jobId));
  return { success: true };
}

/** Delete a private note — author or admin may delete */
export async function deletePrivateNote(
  jobId: string,
  noteId: string,
  requesterId: string,
  requesterRole: string,
): Promise<{ success: boolean; error?: string }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ privateNotes: scheduleJobs.privateNotes })
    .from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  const notes = parsePrivateNotes(rows[0]?.privateNotes);
  const idx = notes.findIndex((n) => n.id === noteId);
  if (idx === -1) return { success: false, error: "Note not found" };
  const isAdmin = ["admin", "office", "operations_manager"].includes(requesterRole);
  if (notes[idx].authorId !== requesterId && !isAdmin) return { success: false, error: "Not authorized" };
  notes.splice(idx, 1);
  await db.update(scheduleJobs).set({ privateNotes: JSON.stringify(notes) } as any)
    .where(eq(scheduleJobs.jobId, jobId));
  return { success: true };
}

/** Get private notes for a job */
export async function getPrivateNotes(jobId: string): Promise<PrivateNote[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ privateNotes: scheduleJobs.privateNotes })
    .from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  return parsePrivateNotes(rows[0]?.privateNotes);
}

// ─── Job Photos ───────────────────────────────────────────────────────────────

/** Append a photo URL to a job's photo_urls array */
export async function addJobPhotoUrl(jobId: string, url: string): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ photoUrls: scheduleJobs.photoUrls })
    .from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  if (rows.length === 0) {
    console.error(`[addJobPhotoUrl] Job not found in DB: jobId=${jobId}`);
    throw new Error(`Job not found: ${jobId}`);
  }
  let urls: string[] = [];
  try { urls = JSON.parse(rows[0]?.photoUrls ?? "[]"); } catch { urls = []; }
  urls.push(url);
  const result = await db.update(scheduleJobs).set({ photoUrls: JSON.stringify(urls) } as any)
    .where(eq(scheduleJobs.jobId, jobId));
  console.log(`[addJobPhotoUrl] Updated jobId=${jobId}, total photos=${urls.length}`);
  return urls;
}

/** Remove a photo URL from a job's photo_urls array */
export async function removeJobPhotoUrl(jobId: string, url: string): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ photoUrls: scheduleJobs.photoUrls })
    .from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  let urls: string[] = [];
  try { urls = JSON.parse(rows[0]?.photoUrls ?? "[]"); } catch { urls = []; }
  urls = urls.filter((u) => u !== url);
  await db.update(scheduleJobs).set({ photoUrls: JSON.stringify(urls) } as any)
    .where(eq(scheduleJobs.jobId, jobId));
  return urls;
}

/** Add a video URL to a job's video_urls array */
export async function addJobVideoUrl(jobId: string, url: string): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ videoUrls: scheduleJobs.videoUrls })
    .from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  let urls: string[] = [];
  try { urls = JSON.parse(rows[0]?.videoUrls ?? "[]"); } catch { urls = []; }
  urls.push(url);
  await db.update(scheduleJobs).set({ videoUrls: JSON.stringify(urls) } as any)
    .where(eq(scheduleJobs.jobId, jobId));
  return urls;
}

/** Remove a video URL from a job's video_urls array */
export async function removeJobVideoUrl(jobId: string, url: string): Promise<string[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const rows = await db.select({ videoUrls: scheduleJobs.videoUrls })
    .from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  let urls: string[] = [];
  try { urls = JSON.parse(rows[0]?.videoUrls ?? "[]"); } catch { urls = []; }
  urls = urls.filter((u) => u !== url);
  await db.update(scheduleJobs).set({ videoUrls: JSON.stringify(urls) } as any)
    .where(eq(scheduleJobs.jobId, jobId));
  return urls;
}

/** Get all photo URLs for a job */
export async function getJobPhotoUrls(jobId: string): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select({ photoUrls: scheduleJobs.photoUrls })
    .from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  try { return JSON.parse(rows[0]?.photoUrls ?? "[]"); } catch { return []; }
}

// ─── Morning Meeting Config ───

export async function getMorningMeetingConfig() {
  const db = await getDb();
  if (!db) return null;
  const config = await db.select().from(morningMeetingConfig).limit(1);
  return config[0] || null;
}

export async function upsertMorningMeetingConfig(data: { zoomLink: string; meetingTime?: string; enabled?: "yes" | "no"; updatedBy?: string }) {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select().from(morningMeetingConfig).limit(1);
  if (existing.length > 0) {
    const updateData: any = { zoomLink: data.zoomLink };
    if (data.meetingTime) updateData.meetingTime = data.meetingTime;
    if (data.enabled) updateData.enabled = data.enabled;
    if (data.updatedBy) updateData.updatedBy = data.updatedBy;
    await db.update(morningMeetingConfig).set(updateData).where(eq(morningMeetingConfig.id, existing[0].id));
  } else {
    await db.insert(morningMeetingConfig).values({
      zoomLink: data.zoomLink,
      meetingTime: data.meetingTime || "07:30",
      enabled: (data.enabled || "yes") as "yes" | "no",
      updatedBy: data.updatedBy,
    });
  }
}


// ─── Sales Performance ────────────────────────────────────────────────────────

/** Upsert daily sales performance for a rep — called whenever they book a job */
export async function upsertSalesPerformance(data: {
  employeeId: string;
  fullName: string;
  date: string; // YYYY-MM-DD
  jobsBookedDelta: number;
  revenueDelta: number;
  lastJobId?: string;
}) {
  const db = await getDb();
  if (!db) return;
  const existing = await db
    .select()
    .from(salesPerformance)
    .where(and(eq(salesPerformance.employeeId, data.employeeId), eq(salesPerformance.date, data.date)))
    .limit(1);

  if (existing.length > 0) {
    const row = existing[0];
    await db
      .update(salesPerformance)
      .set({
        jobsBooked: (row.jobsBooked ?? 0) + data.jobsBookedDelta,
        revenueScheduled: String(
          parseFloat(String(row.revenueScheduled ?? "0")) + data.revenueDelta
        ),
        lastJobId: data.lastJobId ?? row.lastJobId,
      })
      .where(eq(salesPerformance.id, row.id));
  } else {
    await db.insert(salesPerformance).values({
      recordId: generateId("sp"),
      employeeId: data.employeeId,
      fullName: data.fullName,
      date: data.date,
      jobsBooked: data.jobsBookedDelta,
      revenueScheduled: String(data.revenueDelta),
      lastJobId: data.lastJobId,
    });
  }
}

/** Get sales performance for a rep — today, this week, all time */
export async function getSalesPerformance(employeeId: string) {
  const db = await getDb();
  if (!db) return { today: { jobsBooked: 0, revenueScheduled: 0 }, week: { jobsBooked: 0, revenueScheduled: 0 }, allTime: { jobsBooked: 0, revenueScheduled: 0 } };
  const today = todayCST();

  // Week start (Sunday) in CST
  const now = new Date();
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: "America/Chicago", weekday: "short" }).format(now);
  const daysMap: Record<string, number> = { Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6 };
  const daysBack = daysMap[dayOfWeek] ?? 0;
  const weekStart = new Date(now);
  weekStart.setDate(weekStart.getDate() - daysBack);
  const weekStartStr = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Chicago" }).format(weekStart);

  const rows = await db
    .select()
    .from(salesPerformance)
    .where(eq(salesPerformance.employeeId, employeeId));

  const todayRow = rows.find((r) => r.date === today);
  const weekRows = rows.filter((r) => r.date >= weekStartStr);

  const sum = (arr: typeof rows) => arr.reduce(
    (acc, r) => ({
      jobsBooked: acc.jobsBooked + (r.jobsBooked ?? 0),
      revenueScheduled: acc.revenueScheduled + parseFloat(String(r.revenueScheduled ?? "0")),
    }),
    { jobsBooked: 0, revenueScheduled: 0 }
  );

  return {
    today: todayRow ? { jobsBooked: todayRow.jobsBooked ?? 0, revenueScheduled: parseFloat(String(todayRow.revenueScheduled ?? "0")) } : { jobsBooked: 0, revenueScheduled: 0 },
    week: sum(weekRows),
    allTime: sum(rows),
  };
}

/** Get all sales reps performance for admin leaderboard */
export async function getAllSalesPerformance(date?: string) {
  const db = await getDb();
  if (!db) return [];
  const targetDate = date ?? todayCST();
  return db
    .select()
    .from(salesPerformance)
    .where(eq(salesPerformance.date, targetDate))
    .orderBy(desc(salesPerformance.revenueScheduled));
}


// ─── Door Hanger Earnings ───
/**
 * Get the week start date (Monday) for a given date
 */
function getWeekStartDate(date: string): string {
  const d = new Date(date + 'T00:00:00Z');
  const day = d.getUTCDay();
  const diff = d.getUTCDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
  const monday = new Date(d.setUTCDate(diff));
  return monday.toISOString().split('T')[0];
}

export async function getWeeklyDoorHangerEarnings(employeeId: string) {
  const db = await getDb();
  if (!db) return null;
  
  const today = todayCST();
  const weekStart = getWeekStartDate(today);
  
  const result = await db.select().from(doorHangerEarnings)
    .where(and(
      eq(doorHangerEarnings.employeeId, employeeId),
      eq(doorHangerEarnings.weekStartDate, weekStart)
    ))
    .limit(1);
  
  return result.length > 0 ? result[0] : null;
}

export async function upsertDoorHangerEarnings(employeeId: string, fullName: string, photoCount: number) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  
  const today = todayCST();
  const weekStart = getWeekStartDate(today);
  const totalEarnings = (photoCount * 0.25).toFixed(2);
  const recordId = `DHE_EARN_${weekStart}_${employeeId}`;
  
  const existing = await db.select().from(doorHangerEarnings)
    .where(and(
      eq(doorHangerEarnings.employeeId, employeeId),
      eq(doorHangerEarnings.weekStartDate, weekStart)
    ))
    .limit(1);
  
  if (existing.length > 0) {
    await db.update(doorHangerEarnings)
      .set({ photoCount, totalEarnings })
      .where(eq(doorHangerEarnings.recordId, existing[0].recordId));
  } else {
    await db.insert(doorHangerEarnings).values({
      recordId,
      employeeId,
      fullName,
      weekStartDate: weekStart,
      photoCount,
      totalEarnings,
    });
  }
}

/**
 * Calculate city availability for next 7 days
 * Returns: { city: string, percentBooked: number, jobCount: number, totalMinutes: number }[]
 * Percentage = (total booked minutes) / (7 hours * 7 days = 420 minutes per city)
 */
export async function getCityAvailabilityForNextWeek() {
  const db = await getDb();
  if (!db) return [];
  
  const today = todayCST();
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = nextWeek.toISOString().split('T')[0];
  
  // Get all jobs for next 7 days
  const jobs = await db.select().from(scheduleJobs)
    .where(and(
      gte(scheduleJobs.date, today),
      lte(scheduleJobs.date, nextWeekStr)
    ));
  
  // Group by city and calculate booked time
  const cityStats: Record<string, { jobCount: number; totalMinutes: number }> = {};
  
  for (const job of jobs) {
    if (!job.location) continue;
    
    if (!cityStats[job.location]) {
      cityStats[job.location] = { jobCount: 0, totalMinutes: 0 };
    }
    
    cityStats[job.location].jobCount++;
    
    // Calculate duration in minutes
    if (job.startHour !== null && job.endHour !== null) {
      const duration = (Number(job.endHour) - Number(job.startHour)) * 60;
      cityStats[job.location].totalMinutes += duration;
    }
  }
  
  // Convert to percentage (7 hours * 7 days = 420 minutes max per city)
  const maxMinutes = 7 * 60 * 7; // 2940 minutes
  
  const availability = Object.entries(cityStats).map(([city, stats]) => ({
    city,
    percentBooked: Math.round((stats.totalMinutes / maxMinutes) * 100),
    jobCount: stats.jobCount,
    totalMinutes: stats.totalMinutes,
  }));
  
  return availability.sort((a, b) => a.percentBooked - b.percentBooked);
}

/**
 * Get the suggested city with the lowest booking percentage
 * Uses actual job addresses and nearby neighbors
 * Avoids neighborhoods completed in last 30 days
 */
export async function getSuggestedCityForDoorHangers() {
  const db = await getDb();
  if (!db) return null;
  
  const availability = await getCityAvailabilityForNextWeek();
  
  if (availability.length === 0) return null;
  
  const suggestedCity = availability[0];
  const todayStr = todayCST();
  const nextWeek = new Date();
  nextWeek.setDate(nextWeek.getDate() + 7);
  const nextWeekStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(nextWeek);
  
  // Get neighborhoods already completed in last 30 days
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const thirtyDaysAgoStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(thirtyDaysAgo);
  
  const completedNeighborhoods = await db.select({ address: doorHangerEntries.address })
    .from(doorHangerEntries)
    .where(and(
      gte(doorHangerEntries.date, thirtyDaysAgoStr),
      lte(doorHangerEntries.date, todayStr)
    ));
  
  const completedAddresses = new Set(completedNeighborhoods.map(n => n.address));
  
  // Try to find today's job first, then fall back to this week
  let jobToUse = null;
  
  // Look for today's job
  const todayJob = await db.select().from(scheduleJobs)
    .where(and(
      eq(scheduleJobs.date, todayStr),
      eq(scheduleJobs.location, suggestedCity.city)
    ))
    .limit(1);
  
  if (todayJob.length > 0) {
    jobToUse = todayJob[0];
  } else {
    // Fall back to any job this week
    const weekJob = await db.select().from(scheduleJobs)
      .where(and(
        gte(scheduleJobs.date, todayStr),
        lte(scheduleJobs.date, nextWeekStr),
        eq(scheduleJobs.location, suggestedCity.city)
      ))
      .limit(1);
    
    if (weekJob.length > 0) {
      jobToUse = weekJob[0];
    }
  }
  
  // Fallback residential addresses for common service cities
  const cityFallbackAddresses: Record<string, string> = {
    'destin': '4400 Legendary Dr, Destin, FL 32541',
    'niceville': '1000 John Sims Pkwy E, Niceville, FL 32578',
    'crestview': '198 N Main St, Crestview, FL 32536',
    'fwb': '130 Miracle Strip Pkwy SW, Fort Walton Beach, FL 32548',
    'fort walton beach': '130 Miracle Strip Pkwy SW, Fort Walton Beach, FL 32548',
    'fort walton': '130 Miracle Strip Pkwy SW, Fort Walton Beach, FL 32548',
    'mary esther': '1 Miracle Strip Pkwy, Mary Esther, FL 32569',
    'shalimar': '1 Eglin Pkwy NE, Shalimar, FL 32579',
    'valparaiso': '461 Valparaiso Pkwy, Valparaiso, FL 32580',
    'navarre': '8649 Navarre Pkwy, Navarre, FL 32566',
    'gulf breeze': '913 Gulf Breeze Pkwy, Gulf Breeze, FL 32561',
    'pensacola': '400 S Palafox St, Pensacola, FL 32502',
    'miramar beach': '10001 Emerald Coast Pkwy W, Miramar Beach, FL 32550',
    'santa rosa beach': '3250 E County Hwy 30A, Santa Rosa Beach, FL 32459',
  };

  let startingAddress: string | null = null;

  // First: try to find a real street address from online bookings for this city
  const cityKey = suggestedCity.city.toLowerCase().trim();
  const onlineBookingAddr = await db.select({
    streetAddress: onlineBookings.streetAddress,
    city: onlineBookings.city,
    state: onlineBookings.state,
    zipCode: onlineBookings.zipCode,
  })
    .from(onlineBookings)
    .where(and(
      eq(onlineBookings.location, cityKey),
      gte(onlineBookings.bookingDate, todayStr),
      lte(onlineBookings.bookingDate, nextWeekStr)
    ))
    .limit(10);

  // Find a booking address not in completed set
  for (const booking of onlineBookingAddr) {
    if (booking.streetAddress) {
      const fullAddr = [booking.streetAddress, booking.city, booking.state, booking.zipCode].filter(Boolean).join(', ');
      if (!completedAddresses.has(fullAddr)) {
        startingAddress = fullAddr;
        break;
      }
    }
  }

  // Second: try recent past bookings in that city (last 30 days)
  if (!startingAddress) {
    const pastBookings = await db.select({
      streetAddress: onlineBookings.streetAddress,
      city: onlineBookings.city,
      state: onlineBookings.state,
      zipCode: onlineBookings.zipCode,
    })
      .from(onlineBookings)
      .where(and(
        eq(onlineBookings.location, cityKey),
        gte(onlineBookings.bookingDate, thirtyDaysAgoStr)
      ))
      .limit(20);

    for (const booking of pastBookings) {
      if (booking.streetAddress) {
        const fullAddr = [booking.streetAddress, booking.city, booking.state, booking.zipCode].filter(Boolean).join(', ');
        if (!completedAddresses.has(fullAddr)) {
          startingAddress = fullAddr;
          break;
        }
      }
    }
  }

  // Third: use city fallback address
  if (!startingAddress) {
    startingAddress = cityFallbackAddresses[cityKey] || `${suggestedCity.city}, FL`;
  }

  return {
    ...suggestedCity,
    startingAddress,
  };
}

// ─── Team Member Deactivation & Job Reassignment ─────────────────────────────

export async function getDeactivatedEmployees() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(employees)
    .where(eq(employees.activeStatus, "inactive"))
    .orderBy(employees.fullName);
}

export async function reactivateEmployee(employeeId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(employees).set({ activeStatus: "active" }).where(eq(employees.employeeId, employeeId));
}

export async function getActiveJobsForEmployee(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  const today = todayCST();
  // Get employee name first
  const emp = await db.select({ fullName: employees.fullName }).from(employees)
    .where(eq(employees.employeeId, employeeId)).limit(1);
  const empName = emp[0]?.fullName ?? employeeId;
  // Find jobs assigned to this employee (by employeeId or fullName) that are upcoming/active
  const jobs = await db.select().from(scheduleJobs)
    .where(and(
      gte(scheduleJobs.date, today),
      ne(scheduleJobs.status, "cancelled"),
      ne(scheduleJobs.status, "completed")
    ));
  // Filter by assignedTo matching employeeId or name
  return jobs.filter(j =>
    j.assignedTo === employeeId ||
    j.assignedTo === empName ||
    (j.assignedTo && j.assignedTo.toLowerCase().includes(empName.toLowerCase()))
  );
}

export async function reassignJob(jobId: string, toEmployeeId: string, toEmployeeName: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(scheduleJobs)
    .set({ assignedTo: toEmployeeName })
    .where(eq(scheduleJobs.jobId, jobId));
}

export async function unassignJob(jobId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(scheduleJobs)
    .set({ assignedTo: null })
    .where(eq(scheduleJobs.jobId, jobId));
}

export async function getUnassignedJobs(city?: string) {
  const db = await getDb();
  if (!db) return [];
  const today = todayCST();
  const conditions = [
    isNull(scheduleJobs.assignedTo),
    gte(scheduleJobs.date, today),
    ne(scheduleJobs.status, "cancelled"),
    ne(scheduleJobs.status, "completed"),
  ];
  if (city) conditions.push(eq(scheduleJobs.location, city));
  return db.select().from(scheduleJobs)
    .where(and(...conditions))
    .orderBy(scheduleJobs.date, scheduleJobs.startHour);
}

export async function getAvailableDetailersForSlot(date: string, startHour: number, endHour: number, city: string) {
  const db = await getDb();
  if (!db) return [];

  // Normalize city to both slug and display name
  const SLOT_SLUG_TO_LABEL: Record<string, string> = { fwb: 'Fort Walton Beach', crestview: 'Crestview', niceville: 'Niceville', destin: 'Destin', pensacola: 'Pensacola' };
  const SLOT_LABEL_TO_SLUG: Record<string, string> = { 'fort walton beach': 'fwb', 'crestview': 'crestview', 'niceville': 'niceville', 'destin': 'destin', 'pensacola': 'pensacola' };
  const cityLowerSlot = city.toLowerCase().trim();
  const citySlugSlot = SLOT_LABEL_TO_SLUG[cityLowerSlot] ?? cityLowerSlot;
  const cityLabelSlot = SLOT_SLUG_TO_LABEL[citySlugSlot] ?? city;
  // Determine day-of-week (0=Sun,1=Mon,2=Tue,3=Wed,4=Thu,5=Fri,6=Sat)
  const [yyyy, mm, dd] = date.split('-').map(Number);
  const dow = new Date(yyyy, mm - 1, dd).getDay();
  // shift1 = Mon–Thu ONLY | shift2 = Fri–Sun ONLY (no Thursday overlap)
  const shift1Days = new Set([1, 2, 3, 4]); // Mon–Thu

  // Get all active detailers in this city — match both slug and display name
  const allDetailers = await db.select().from(employees)
    .where(and(
      eq(employees.role, "detailer"),
      eq(employees.activeStatus, "active"),
      or(
        sql`LOWER(${employees.city}) = LOWER(${citySlugSlot})`,
        sql`LOWER(${employees.city}) = LOWER(${cityLabelSlot})`
      )
    ));

  // Load shift assignments for these detailers
  const shiftMap: Record<string, 'shift1' | 'shift2'> = {};
  if (allDetailers.length > 0) {
    const ids = allDetailers.map(d => d.employeeId);
    const safeIds = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
    const rows = await db.execute(sql`SELECT employee_id, shift FROM employee_van_assignments WHERE employee_id IN (${sql.raw(safeIds)})`);
    for (const row of (rows[0] as unknown as any[])) {
      shiftMap[row.employee_id] = (row.shift ?? 'shift1') as 'shift1' | 'shift2';
    }
  }

  // Filter by shift schedule for this day-of-week
  // shift1 = Mon(1)–Thu(4) ONLY — no overlap on Thursday
  // shift2 = Fri(5)–Sun(0,6) ONLY — Thursday is shift1 only
  const bookableDetailers = allDetailers.filter(detailer => {
    const shift = shiftMap[detailer.employeeId] ?? 'shift1';
    if (shift === 'shift1') return shift1Days.has(dow); // Mon–Thu
    return dow === 5 || dow === 6 || dow === 0; // Fri–Sun only for shift2
  });

  if (bookableDetailers.length === 0) return [];

  // Get jobs on that date/city to find conflicts — match both slug and display name
  const existingJobs = await db.select({
    assignedTo: scheduleJobs.assignedTo,
    startHour: scheduleJobs.startHour,
    endHour: scheduleJobs.endHour,
  }).from(scheduleJobs)
    .where(and(
      eq(scheduleJobs.date, date),
      or(
        sql`LOWER(${scheduleJobs.location}) = LOWER(${citySlugSlot})`,
        sql`LOWER(${scheduleJobs.location}) = LOWER(${cityLabelSlot})`
      ),
      ne(scheduleJobs.status, "cancelled")
    ));

  // Get schedule blockers for this date/city (match both slug and full label)
  const { scheduleBlockers } = await import('../drizzle/schema');
  const blockers = await db.select({
    detailerName: scheduleBlockers.detailerName,
    startHour: scheduleBlockers.startHour,
    endHour: scheduleBlockers.endHour,
    allDay: scheduleBlockers.allDay,
  }).from(scheduleBlockers)
    .where(and(
      sql`DATE(${scheduleBlockers.date}) = ${date}`,
      or(eq(scheduleBlockers.city, cityLabelSlot), eq(scheduleBlockers.city, citySlugSlot))
    ));

  // Filter out detailers who have a conflicting job OR an active blocker
  return bookableDetailers.filter(detailer => {
    // Check job conflicts
    const conflicts = existingJobs.filter(job => {
      if (!job.assignedTo) return false;
      const isAssigned = job.assignedTo === detailer.fullName || job.assignedTo === detailer.employeeId;
      if (!isAssigned) return false;
      const jStart = parseFloat(String(job.startHour ?? 0));
      const jEnd = parseFloat(String(job.endHour ?? 24));
      return startHour < jEnd && endHour > jStart;
    });
    if (conflicts.length > 0) return false;

    // Check blocker conflicts (all-day or overlapping partial-day)
    const blockerConflicts = blockers.filter(b => {
      const isBlocked = b.detailerName === detailer.fullName || b.detailerName === detailer.employeeId;
      if (!isBlocked) return false;
      if (b.allDay) return true; // all-day blocker covers the entire day
      const bStart = parseFloat(String(b.startHour ?? 0));
      const bEnd = parseFloat(String(b.endHour ?? 24));
      return startHour < bEnd && endHour > bStart;
    });
    return blockerConflicts.length === 0;
  });
}

/**
 * Returns an array of date strings (YYYY-MM-DD) in the next `daysAhead` days
 * where at least one detailer in the given city is scheduled to work
 * (i.e., their shift covers that day-of-week).
 * Dates where ALL detailers are fully booked are also excluded.
 */
// Map admin schedule slugs to display names for DB lookups that store display names
const CITY_SLUG_TO_LABEL: Record<string, string> = {
  fwb: 'Fort Walton Beach',
  crestview: 'Crestview',
  niceville: 'Niceville',
  destin: 'Destin',
  pensacola: 'Pensacola',
};
const CITY_LABEL_TO_SLUG: Record<string, string> = {
  'fort walton beach': 'fwb',
  'crestview': 'crestview',
  'niceville': 'niceville',
  'destin': 'destin',
  'pensacola': 'pensacola',
};

export async function getAvailableDates(city: string, daysAhead = 90): Promise<string[]> {
  const db = await getDb();
  if (!db) return [];

  // shift1 = Mon–Thu ONLY | shift2 = Fri–Sun ONLY (no Thursday overlap)
  const shift1Days = new Set([1, 2, 3, 4]); // Mon–Thu

  // Normalize city to both slug and display name for flexible DB matching
  const cityLower = city.toLowerCase().trim();
  const citySlug = CITY_LABEL_TO_SLUG[cityLower] ?? cityLower;
  const cityLabel = CITY_SLUG_TO_LABEL[citySlug] ?? city;

  // Get all active detailers in this city — match both slug and display name
  const allDetailers = await db.select().from(employees)
    .where(and(
      eq(employees.role, 'detailer'),
      eq(employees.activeStatus, 'active'),
      or(
        sql`LOWER(${employees.city}) = LOWER(${citySlug})`,
        sql`LOWER(${employees.city}) = LOWER(${cityLabel})`
      )
    ));

  if (allDetailers.length === 0) return [];

  // Load shift assignments
  const shiftMap: Record<string, 'shift1' | 'shift2'> = {};
  const ids = allDetailers.map(d => d.employeeId);
  const safeIds = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
  const rows = await db.execute(sql`SELECT employee_id, shift FROM employee_van_assignments WHERE employee_id IN (${sql.raw(safeIds)})`);
  for (const row of (rows[0] as unknown as any[])) {
    shiftMap[row.employee_id] = (row.shift ?? 'shift1') as 'shift1' | 'shift2';
  }

  // Build list of dates to check (starting today — same-day allowed with 2-hour lead time)
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Current hour in CST (America/Chicago) for same-day lead-time check
  const nowCST = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Chicago',
    hour: 'numeric',
    minute: 'numeric',
    hour12: false,
  }).formatToParts(new Date());
  const cstHour = parseInt(nowCST.find(p => p.type === 'hour')?.value ?? '0', 10);
  const cstMinute = parseInt(nowCST.find(p => p.type === 'minute')?.value ?? '0', 10);
  const nowCSTDecimal = cstHour + cstMinute / 60; // e.g. 10.5 = 10:30 AM

  // Today's date string in CST for same-day comparison
  const todayCSTStr = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Chicago',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date()); // returns YYYY-MM-DD

  const datesToCheck: string[] = [];
  for (let i = 0; i <= daysAhead; i++) {
    const d = new Date(today);
    d.setDate(today.getDate() + i);
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    datesToCheck.push(`${yyyy}-${mm}-${dd}`);
  }

  // For each date, check if at least one detailer is scheduled
  const availableDates: string[] = [];
  for (const dateStr of datesToCheck) {
    const [yyyy, mm, dd] = dateStr.split('-').map(Number);
    const dow = new Date(yyyy, mm - 1, dd).getDay();

    // Which detailers work this day?
    // shift1 = Mon–Thu ONLY | shift2 = Fri–Sun ONLY (no Thursday overlap)
    const workingDetailers = allDetailers.filter(detailer => {
      const shift = shiftMap[detailer.employeeId] ?? 'shift1';
      if (shift === 'shift1') return shift1Days.has(dow); // Mon–Thu
      return dow === 5 || dow === 6 || dow === 0; // Fri–Sun only for shift2
    });

    if (workingDetailers.length === 0) continue;

    // Check if at least one working detailer has an open slot (any standard slot)
    const standardSlots = [
      { startHour: 8, endHour: 10 },
      { startHour: 10, endHour: 12 },
      { startHour: 13, endHour: 15 },
      { startHour: 15, endHour: 17 },
    ];

    // Get all jobs that day in this city — match both slug and display name
    const existingJobs = await db.select({
      assignedTo: scheduleJobs.assignedTo,
      startHour: scheduleJobs.startHour,
      endHour: scheduleJobs.endHour,
    }).from(scheduleJobs)
      .where(and(
        eq(scheduleJobs.date, dateStr),
        or(
          sql`LOWER(${scheduleJobs.location}) = LOWER(${citySlug})`,
          sql`LOWER(${scheduleJobs.location}) = LOWER(${cityLabel})`
        ),
        ne(scheduleJobs.status, 'cancelled')
      ));

    // Get schedule blockers for this date/city (match both slug and full label)
    const normalizedCityDates = cityLabel;
    const { scheduleBlockers } = await import('../drizzle/schema');
    const dayBlockers = await db.select({
      detailerName: scheduleBlockers.detailerName,
      startHour: scheduleBlockers.startHour,
      endHour: scheduleBlockers.endHour,
      allDay: scheduleBlockers.allDay,
    }).from(scheduleBlockers)
      .where(and(
        sql`DATE(${scheduleBlockers.date}) = ${dateStr}`,
        or(eq(scheduleBlockers.city, normalizedCityDates), eq(scheduleBlockers.city, city))
      ));

    // For today only: skip slots that start within 2 hours of now (CST)
    const isToday = dateStr === todayCSTStr;

    let hasOpenSlot = false;
    for (const slot of standardSlots) {
      // 2-hour lead time: if today, the slot must start at least 2 hours from now
      if (isToday && slot.startHour < nowCSTDecimal + 2) continue;

      const freeDetailers = workingDetailers.filter(detailer => {
        // Check job conflicts
        const conflicts = existingJobs.filter(job => {
          if (!job.assignedTo) return false;
          const isAssigned = job.assignedTo === detailer.fullName || job.assignedTo === detailer.employeeId;
          if (!isAssigned) return false;
          const jStart = parseFloat(String(job.startHour ?? 0));
          const jEnd = parseFloat(String(job.endHour ?? 24));
          return slot.startHour < jEnd && slot.endHour > jStart;
        });
        if (conflicts.length > 0) return false;
        // Check blocker conflicts
        const blockerConflicts = dayBlockers.filter(b => {
          const isBlocked = b.detailerName === detailer.fullName || b.detailerName === detailer.employeeId;
          if (!isBlocked) return false;
          if (b.allDay) return true;
          const bStart = parseFloat(String(b.startHour ?? 0));
          const bEnd = parseFloat(String(b.endHour ?? 24));
          return slot.startHour < bEnd && slot.endHour > bStart;
        });
        return blockerConflicts.length === 0;
      });
      if (freeDetailers.length > 0) { hasOpenSlot = true; break; }
    }

    if (hasOpenSlot) availableDates.push(dateStr);
  }

  return availableDates;
}

export async function sendJobTransferNotification(toEmployeeId: string, toEmployeeName: string, jobId: string) {
  const db = await getDb();
  if (!db) return;
  // Get job details
  const jobs = await db.select().from(scheduleJobs).where(eq(scheduleJobs.jobId, jobId)).limit(1);
  const job = jobs[0];
  if (!job) return;
  const dateStr = job.date ? new Date(job.date + 'T12:00:00').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' }) : job.date;
  await createNotification({
    notificationId: `JOB_TRANSFER_${Date.now()}_${toEmployeeId}`,
    employeeId: toEmployeeId,
    fullName: toEmployeeName,
    notificationType: "job_transfer",
    title: "New Job Assigned to You",
    message: `A job has been transferred to you: ${job.customerName ?? 'Customer'} on ${dateStr} at ${job.timeSlot ?? 'TBD'} in ${job.location}. ${job.vehicleYear ?? ''} ${job.vehicleMake ?? ''} ${job.vehicleModel ?? ''} — ${await resolvePackageNameAsync(job.packageType)}.`,
    createdBy: "System",
    requiresAcknowledgment: "yes",
  });
}


// ─── Customers ────────────────────────────────────────────────────────────────

/**
 * Get all unique customers from scheduleJobs + onlineBookings.
 * Deduplicates by phone number (preferred) or email, then name.
 * Returns sorted by lifetime value descending.
 */
export async function getAllCustomers(search?: string) {
  const db = await getDb();
  if (!db) return [];

  // Pull ALL non-cancelled schedule jobs — used to discover customers and track service dates
  const jobs = await db
    .select({
      customerName: scheduleJobs.customerName,
      customerPhone: scheduleJobs.customerPhone,
      customerEmail: scheduleJobs.customerEmail,
      customerAddress: scheduleJobs.customerAddress,
      location: scheduleJobs.location,
      totalPrice: scheduleJobs.totalPrice,
      status: scheduleJobs.status,
      date: scheduleJobs.date,
      jobId: scheduleJobs.jobId,
      onlineBookingId: scheduleJobs.onlineBookingId,
    })
    .from(scheduleJobs)
    .where(and(isNotNull(scheduleJobs.customerName), ne(scheduleJobs.status, 'cancelled')));

  // Build a set of online booking IDs that already have a schedule job so we don't double-count
  const scheduledBookingIds = new Set(jobs.map(j => j.onlineBookingId).filter(Boolean) as string[]);

  // Pull ALL non-cancelled online bookings — used to discover customers and track service dates
  // Exclude any booking that was already converted to a schedule job (to avoid double-counting)
  const bookings = await db
    .select({
      firstName: onlineBookings.firstName,
      lastName: onlineBookings.lastName,
      phone: onlineBookings.phone,
      email: onlineBookings.email,
      streetAddress: onlineBookings.streetAddress,
      city: onlineBookings.city,
      state: onlineBookings.state,
      zipCode: onlineBookings.zipCode,
      totalPrice: onlineBookings.totalPrice,
      finalTotal: onlineBookings.finalTotal,
      status: onlineBookings.status,
      bookingDate: onlineBookings.bookingDate,
      bookingId: onlineBookings.bookingId,
    })
    .from(onlineBookings)
    .where(ne(onlineBookings.status, 'cancelled'));

  // Filter out online bookings that were already converted to schedule jobs
  const uniqueBookings = bookings.filter(b => !scheduledBookingIds.has(b.bookingId));

  // Build a customer map keyed by phone (normalized) or email or name
  type CustomerRecord = {
    customerId: string;
    fullName: string;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    lifetimeValue: number;
    jobCount: number;
    lastServiceDate: string | null;
    firstServiceDate: string | null;
    source: 'online' | 'manual' | 'both';
    isVip: boolean;
    vipStatus: string | null; // 'active' | 'pending_signature' | 'expired' | null
    vipContractCount: number;
  };

  const customerMap = new Map<string, CustomerRecord>();

  const normalizePhone = (p: string | null | undefined) =>
    p ? p.replace(/\D/g, '').slice(-10) : null;

  const getKey = (phone: string | null, email: string | null, name: string) => {
    const np = normalizePhone(phone);
    if (np && np.length === 10) return `phone:${np}`;
    if (email) return `email:${email.toLowerCase()}`;
    return `name:${name.toLowerCase().trim()}`;
  };

  // Process online bookings first (they have full address info)
  // Only process bookings that were NOT already converted to schedule jobs (no double-counting)
  for (const b of uniqueBookings) {
    const fullName = `${b.firstName} ${b.lastName}`.trim();
    const key = getKey(b.phone, b.email, fullName);
    const price = parseFloat(String(b.finalTotal ?? b.totalPrice ?? '0')) || 0;
    const existing = customerMap.get(key);
    const addr = b.streetAddress ? `${b.streetAddress}${b.city ? `, ${b.city}` : ''}${b.state ? `, ${b.state}` : ''}${b.zipCode ? ` ${b.zipCode}` : ''}` : null;

    if (existing) {
      existing.lifetimeValue += price;
      existing.jobCount += 1;
      if (b.bookingDate && (!existing.lastServiceDate || b.bookingDate > existing.lastServiceDate)) {
        existing.lastServiceDate = b.bookingDate;
      }
      if (b.bookingDate && (!existing.firstServiceDate || b.bookingDate < existing.firstServiceDate)) {
        existing.firstServiceDate = b.bookingDate;
      }
      if (!existing.address && addr) existing.address = addr;
      if (!existing.city && b.city) existing.city = b.city;
      existing.source = 'both';
    } else {
      customerMap.set(key, {
        customerId: key,
        fullName,
        phone: b.phone ?? null,
        email: b.email ?? null,
        address: addr,
        city: b.city ?? null,
        lifetimeValue: price,
        jobCount: 1,
        lastServiceDate: b.bookingDate ?? null,
        firstServiceDate: b.bookingDate ?? null,
        source: 'online',
        isVip: false,
        vipStatus: null,
        vipContractCount: 0,
      });
    }
  }

  // Process manual schedule jobs — all non-cancelled jobs count toward jobCount and LTV
  for (const j of jobs) {
    if (!j.customerName) continue;
    const key = getKey(j.customerPhone, j.customerEmail, j.customerName);
    const price = parseFloat(String(j.totalPrice ?? '0')) || 0;
    const existing = customerMap.get(key);

    if (existing) {
      existing.lifetimeValue += price;
      existing.jobCount += 1;
      if (j.date && (!existing.lastServiceDate || j.date > existing.lastServiceDate)) {
        existing.lastServiceDate = j.date;
      }
      if (j.date && (!existing.firstServiceDate || j.date < existing.firstServiceDate)) {
        existing.firstServiceDate = j.date;
      }
      if (!existing.phone && j.customerPhone) existing.phone = j.customerPhone;
      if (!existing.email && j.customerEmail) existing.email = j.customerEmail;
      if (!existing.address && j.customerAddress) existing.address = j.customerAddress;
      if (existing.source === 'online') existing.source = 'both';
    } else {
      customerMap.set(key, {
        customerId: key,
        fullName: j.customerName,
        phone: j.customerPhone ?? null,
        email: j.customerEmail ?? null,
        address: j.customerAddress ?? null,
        city: j.location ?? null,
        lifetimeValue: price,
        jobCount: 1,
        lastServiceDate: j.date ?? null,
        firstServiceDate: j.date ?? null,
        source: 'manual',
        isVip: false,
        vipStatus: null,
        vipContractCount: 0,
      });
    }
  }

  // ── Also include portal-registered customers (from the customers table) ──────
  // These are users who signed up via the customer portal but may not have a schedule job yet.
  // Also join their default address so imported CRM customers show their address.
  const portalCustomers = await db.select({
    customerId: customersTable.customerId,
    firstName: customersTable.firstName,
    lastName: customersTable.lastName,
    email: customersTable.email,
    phone: customersTable.phone,
    street: customerAddresses.street,
    unit: customerAddresses.unit,
    city: customerAddresses.city,
    state: customerAddresses.state,
    zip: customerAddresses.zip,
  })
  .from(customersTable)
  .leftJoin(customerAddresses, and(
    eq(customerAddresses.customerId, customersTable.customerId),
    eq(customerAddresses.isDefault, 1)
  ));

  for (const pc of portalCustomers) {
    const fullName = `${pc.firstName ?? ''} ${pc.lastName ?? ''}`.trim();
    const key = getKey(pc.phone, pc.email, fullName);
    // Build address string from joined address row
    const addrParts = [pc.street, pc.city, pc.state, pc.zip].filter(Boolean);
    const addrStr = addrParts.length > 0 ? addrParts.join(', ') : null;
    const cityStr = pc.city ?? null;
    if (!customerMap.has(key)) {
      // Portal customer with no jobs yet — add with 0 LTV
      customerMap.set(key, {
        customerId: pc.customerId,
        fullName,
        phone: pc.phone ?? null,
        email: pc.email ?? null,
        address: addrStr,
        city: cityStr,
        lifetimeValue: 0,
        jobCount: 0,
        lastServiceDate: null,
        firstServiceDate: null,
        source: 'online',
        isVip: false,
        vipStatus: null,
        vipContractCount: 0,
      });
    } else {
      // Already in map from jobs — enrich with portal email/phone/address if missing
      const existing = customerMap.get(key)!;
      if (!existing.email && pc.email) existing.email = pc.email;
      if (!existing.phone && pc.phone) existing.phone = pc.phone;
      if (!existing.address && addrStr) existing.address = addrStr;
      if (!existing.city && cityStr) existing.city = cityStr;
    }
  }

  // ── Enrich customers with VIP/Maintenance contract data ────────────────────
  // Match contracts to customers by email ONLY (authoritative link).
  // A customer may have multiple contracts (e.g. renewal or second vehicle).
  try {
    const conn = await getConnection();
    const [vipRows]: any = await conn.execute(
      `SELECT id, contract_number, customer_name, customer_email, status, end_date, program_type
       FROM vip_contracts ORDER BY created_at DESC`
    );
    await conn.end();
    // Group contracts by normalized email only
    const vipByEmail = new Map<string, any[]>();
    for (const v of vipRows as any[]) {
      if (v.customer_email) {
        const em = v.customer_email.toLowerCase().trim();
        if (!vipByEmail.has(em)) vipByEmail.set(em, []);
        vipByEmail.get(em)!.push(v);
      }
    }
    // Determine best status: active > pending_signature > expired
    const statusPriority = (s: string) => s === 'active' ? 3 : s === 'pending_signature' ? 2 : s === 'signed' ? 3 : 1;
    for (const c of customerMap.values()) {
      const em = c.email ? c.email.toLowerCase().trim() : null;
      const contracts = em && vipByEmail.has(em) ? vipByEmail.get(em)! : [];
      if (contracts.length > 0) {
        c.isVip = true;
        c.vipContractCount = contracts.length;
        // Pick the highest-priority status among all contracts
        const best = contracts.reduce((a: any, b: any) => statusPriority(a.status) >= statusPriority(b.status) ? a : b);
        c.vipStatus = best.status === 'signed' ? 'active' : best.status;
      }
    }
  } catch (vipErr) {
    // VIP enrichment is non-critical — don't fail the whole request
    console.warn('[getAllCustomers] VIP lookup failed:', vipErr);
  }

  let customers = Array.from(customerMap.values());

  // Apply search filter
  // Split multi-word queries so each word must match at least one field (AND logic).
  // e.g. "Adam S" matches customers whose name contains both "adam" and "s".
  if (search && search.trim()) {
    const rawQ = search.toLowerCase().trim();
    const words = rawQ.split(/\s+/).filter(Boolean);
    const phoneDigits = rawQ.replace(/\D/g, '');
    customers = customers.filter(c => {
      const nameLower = c.fullName.toLowerCase();
      const phoneLower = (c.phone ?? '').replace(/\D/g, '');
      const emailLower = (c.email ?? '').toLowerCase();
      const addrLower = (c.address ?? '').toLowerCase();
      // Phone number search: if query looks like digits, match against phone
      if (phoneDigits.length >= 4 && phoneLower.includes(phoneDigits)) return true;
      // Email match
      if (emailLower.includes(rawQ)) return true;
      // Name/address search: every word in the query must appear in name, email, or address
      return words.every(word =>
        nameLower.includes(word) ||
        emailLower.includes(word) ||
        addrLower.includes(word)
      );
    });
  }

  // Sort by lifetime value desc
  customers.sort((a, b) => b.lifetimeValue - a.lifetimeValue);

  return customers;
}

/**
 * Get all jobs for a specific customer (matched by phone or email or name).
 */
export async function getCustomerJobs(phone: string | null, email: string | null, name: string, customerId?: string | null) {
  const db = await getDb();
  if (!db) return { scheduleJobsList: [], onlineBookingsList: [] };

  const normalizePhone = (p: string | null | undefined) =>
    p ? p.replace(/\D/g, '').slice(-10) : null;

  const np = normalizePhone(phone);

  // Query schedule jobs — match by phone/email/name OR by customer_id if provided
  const allJobs = await db.select().from(scheduleJobs).where(isNotNull(scheduleJobs.customerName));
  const matchedJobs = allJobs.filter(j => {
    if (customerId && j.customerId === customerId) return true;
    if (np && normalizePhone(j.customerPhone) === np) return true;
    if (email && j.customerEmail?.toLowerCase() === email.toLowerCase()) return true;
    if (j.customerName?.toLowerCase().trim() === name.toLowerCase().trim()) return true;
    return false;
  });

  // Query online bookings (legacy WordPress/webhook bookings) — match by phone/email/name
  const allBookings = await db.select().from(onlineBookings);
  const matchedBookings = allBookings.filter(b => {
    const bPhone = normalizePhone(b.phone);
    if (np && bPhone === np) return true;
    if (email && b.email?.toLowerCase() === email.toLowerCase()) return true;
    const bName = `${b.firstName} ${b.lastName}`.toLowerCase().trim();
    if (bName === name.toLowerCase().trim()) return true;
    return false;
  });

  // Query customer portal bookings (from customer app) — match by customerId if provided
  let portalBookings: any[] = [];
  if (customerId) {
    const portalRows = await db.select().from(customerBookings).where(eq(customerBookings.customerId, customerId));
    portalBookings = portalRows.map(b => ({
      bookingId: b.bookingRef,
      bookingDate: b.scheduledDate,
      timeSlot: b.scheduledTime,
      packageType: b.packageName,
      vehicleType: b.vehicleLabel ?? "",
      totalPrice: String(b.total ?? "0"),
      finalTotal: String(b.total ?? "0"),
      status: b.status,
      streetAddress: b.addressLabel ?? "",
      city: b.city ?? "",
      state: "",
      source: "portal" as const,
    }));
  }

  // Merge online bookings with portal bookings (deduplicate by bookingId)
  const allOnlineAndPortal = [...matchedBookings, ...portalBookings];
  const deduped = allOnlineAndPortal.filter((b, idx, arr) =>
    arr.findIndex(x => x.bookingId === b.bookingId) === idx
  );

  // Build dedup sets from portal bookings so we can suppress mirrored schedule_jobs
  const portalRefs = new Set<string>(
    portalBookings.map((b: any) => b.bookingId).filter(Boolean)
  );
  const portalDateTimeKeys = new Set<string>(
    portalBookings.map((b: any) => `${b.bookingDate ?? ''}|${b.timeSlot ?? ''}|${(b.packageType ?? '').toLowerCase().trim()}`)
  );

  // Filter out schedule_jobs that are mirrors of portal bookings
  const filteredScheduleJobs = matchedJobs.filter((j: any) => {
    // If the schedule job's jobId is portal_<ref>, it's a mirror — suppress it
    const jid = (j.jobId ?? '') as string;
    const oid = (j.onlineBookingId ?? '') as string;
    const refFromJobId = jid.startsWith('portal_') ? jid.replace(/^portal_/, '') : null;
    if (refFromJobId && portalRefs.has(refFromJobId)) return false;
    if (oid && portalRefs.has(oid)) return false;
    // Fallback: same date + time + package as a portal booking → suppress
    const key = `${j.date ?? ''}|${j.timeSlot ?? ''}|${(j.packageType ?? j.serviceDescription ?? '').toLowerCase().trim()}`;
    if (portalDateTimeKeys.has(key)) return false;
    return true;
  });

  return {
    scheduleJobsList: filteredScheduleJobs.sort((a, b) => (b.date ?? '').localeCompare(a.date ?? '')),
    onlineBookingsList: deduped.sort((a: any, b: any) =>
      (b.bookingDate ?? '').localeCompare(a.bookingDate ?? '')
    ),
  };
}


// ─── Customer Attachments ─────────────────────────────────────────────────────

function normPhone(p: string | null | undefined): string {
  return (p ?? '').replace(/\D/g, '');
}

export async function getCustomerAttachments(
  customerName: string,
  customerPhone: string | null,
  customerEmail: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  const all = await db.select().from(customerAttachments);
  const np = customerPhone ? normPhone(customerPhone) : null;
  return all.filter(a => {
    if (np && a.customerPhone && normPhone(a.customerPhone) === np) return true;
    if (customerEmail && a.customerEmail?.toLowerCase() === customerEmail.toLowerCase()) return true;
    if (a.customerName.toLowerCase().trim() === customerName.toLowerCase().trim()) return true;
    return false;
  }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function createCustomerAttachment(data: {
  attachmentId: string;
  customerName: string;
  customerPhone: string | null;
  customerEmail: string | null;
  fileName: string;
  fileUrl: string;
  fileKey: string | null;
  mimeType: string | null;
  fileSizeBytes: number | null;
  caption: string | null;
  uploadedBy: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(customerAttachments).values(data);
  return { success: true as const };
}

export async function deleteCustomerAttachment(attachmentId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(customerAttachments).where(eq(customerAttachments.attachmentId, attachmentId));
  return { success: true as const };
}

// ─── Estimates ────────────────────────────────────────────────────────────────

export async function getAllEstimates(search?: string, status?: string) {
  const db = await getDb();
  if (!db) return [];
  let all = await db.select().from(estimates);
  if (status) all = all.filter(e => e.status === status);
  if (search) {
    const q = search.toLowerCase();
    all = all.filter(e =>
      e.customerName.toLowerCase().includes(q) ||
      (e.customerPhone ?? '').toLowerCase().includes(q) ||
      (e.customerEmail ?? '').toLowerCase().includes(q)
    );
  }
  return all.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getCustomerEstimates(
  customerName: string,
  customerPhone: string | null,
  customerEmail: string | null,
) {
  const db = await getDb();
  if (!db) return [];
  const all = await db.select().from(estimates);
  const np = customerPhone ? normPhone(customerPhone) : null;
  return all.filter(e => {
    if (np && e.customerPhone && normPhone(e.customerPhone) === np) return true;
    if (customerEmail && e.customerEmail?.toLowerCase() === customerEmail.toLowerCase()) return true;
    if (e.customerName.toLowerCase().trim() === customerName.toLowerCase().trim()) return true;
    return false;
  }).sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
}

export async function getEstimateById(estimateId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(estimates).where(eq(estimates.estimateId, estimateId));
  return rows[0] ?? null;
}

export async function createEstimate(data: {
  estimateId: string;
  estimateNumber?: number;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  vehicleYear?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleColor?: string | null;
  lineItems: Array<{ description: string; qty: number; unitPrice: number; total: number }>;
  subtotal: number;
  taxRate?: number;
  taxAmount?: number;
  discountAmount?: number;
  total: number;
  notes?: string | null;
  internalNotes?: string | null;
  validUntil?: string | null;
  createdBy?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const count = await db.select().from(estimates);
  const nextNum = (data.estimateNumber ?? count.length) + 1;
  await db.insert(estimates).values({
    estimateId: data.estimateId,
    estimateNumber: nextNum,
    customerName: data.customerName,
    customerPhone: data.customerPhone ?? null,
    customerEmail: data.customerEmail ?? null,
    customerAddress: data.customerAddress ?? null,
    vehicleYear: data.vehicleYear ?? null,
    vehicleMake: data.vehicleMake ?? null,
    vehicleModel: data.vehicleModel ?? null,
    vehicleColor: data.vehicleColor ?? null,
    lineItems: JSON.stringify(data.lineItems),
    subtotal: String(data.subtotal),
    taxRate: String(data.taxRate ?? 0),
    taxAmount: String(data.taxAmount ?? 0),
    discountAmount: String(data.discountAmount ?? 0),
    total: String(data.total),
    notes: data.notes ?? null,
    internalNotes: data.internalNotes ?? null,
    validUntil: data.validUntil ?? null,
    createdBy: data.createdBy ?? null,
    status: 'draft',
  });
  return { success: true as const, estimateNumber: nextNum };
}

export async function updateEstimate(data: {
  estimateId: string;
  customerName?: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  customerAddress?: string | null;
  vehicleYear?: string | null;
  vehicleMake?: string | null;
  vehicleModel?: string | null;
  vehicleColor?: string | null;
  lineItems?: Array<{ description: string; qty: number; unitPrice: number; total: number }>;
  subtotal?: number;
  taxRate?: number;
  taxAmount?: number;
  discountAmount?: number;
  total?: number;
  notes?: string | null;
  internalNotes?: string | null;
  validUntil?: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { estimateId, lineItems, subtotal, taxRate, taxAmount, discountAmount, total, ...rest } = data;
  const updateData: Record<string, unknown> = { ...rest };
  if (lineItems !== undefined) updateData.lineItems = JSON.stringify(lineItems);
  if (subtotal !== undefined) updateData.subtotal = String(subtotal);
  if (taxRate !== undefined) updateData.taxRate = String(taxRate);
  if (taxAmount !== undefined) updateData.taxAmount = String(taxAmount);
  if (discountAmount !== undefined) updateData.discountAmount = String(discountAmount);
  if (total !== undefined) updateData.total = String(total);
  await db.update(estimates).set(updateData).where(eq(estimates.estimateId, estimateId));
  return { success: true as const };
}

export async function updateEstimateStatus(estimateId: string, status: 'draft' | 'sent' | 'viewed' | 'accepted' | 'declined' | 'expired') {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(estimates).set({ status }).where(eq(estimates.estimateId, estimateId));
  return { success: true as const };
}

export async function markEstimateSent(estimateId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(estimates).set({ status: 'sent', sentAt: new Date() }).where(eq(estimates.estimateId, estimateId));
  return { success: true as const };
}

export async function deleteEstimate(estimateId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(estimates).where(eq(estimates.estimateId, estimateId));
  return { success: true as const };
}

// ─── AI Receptionist Call Logs ───
export async function createReceptionistCallLog(data: InsertReceptionistCallLog) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(receptionistCallLogs).values(data);
}

export async function getReceptionistCallLogs(limit = 50) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(receptionistCallLogs)
    .orderBy(desc(receptionistCallLogs.createdAt))
    .limit(limit);
}

export async function updateReceptionistCallLog(
  callId: string,
  updates: Partial<{
    outcome: "booked" | "inquiry" | "no_booking" | "failed";
    bookingId: string | null;
    summary: string | null;
    transcript: string | null;
    recordingUrl: string | null;
    callerName: string | null;
    durationSeconds: number | null;
  }>
) {
  const db = await getDb();
  if (!db) return;
  await db.update(receptionistCallLogs)
    .set(updates)
    .where(eq(receptionistCallLogs.callId, callId));
}

// ─── Community Posts ──────────────────────────────────────────────────────────
export async function listCommunityPosts(category?: string, limit = 50) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(communityPosts)
    .orderBy(desc(communityPosts.isPinned), desc(communityPosts.createdAt))
    .limit(limit);
  if (category && category !== "All") {
    return rows.filter((r) => r.category === category);
  }
  return rows;
}

export async function createCommunityPost(data: InsertCommunityPost) {
  const db = await getDb();
  if (!db) return;
  await db.insert(communityPosts).values(data);
}

export async function deleteCommunityPost(postId: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(communityComments).where(eq(communityComments.postId, postId));
  await db.delete(communityPostLikes).where(eq(communityPostLikes.postId, postId));
  await db.delete(communityPosts).where(eq(communityPosts.postId, postId));
}

export async function pinCommunityPost(postId: string, isPinned: boolean) {
  const db = await getDb();
  if (!db) return;
  await db.update(communityPosts).set({ isPinned: isPinned ? 1 : 0 }).where(eq(communityPosts.postId, postId));
}

export async function likeCommunityPost(postId: string, employeeId: string, liked: boolean) {
  const db = await getDb();
  if (!db) return;
  if (liked) {
    // Insert like (ignore duplicate)
    try {
      await db.insert(communityPostLikes).values({ postId, employeeId });
    } catch { /* already liked */ }
    await db.update(communityPosts)
      .set({ likeCount: sql`like_count + 1` })
      .where(eq(communityPosts.postId, postId));
  } else {
    await db.delete(communityPostLikes)
      .where(and(eq(communityPostLikes.postId, postId), eq(communityPostLikes.employeeId, employeeId)));
    await db.update(communityPosts)
      .set({ likeCount: sql`GREATEST(like_count - 1, 0)` })
      .where(eq(communityPosts.postId, postId));
  }
}

export async function getCommunityPostLikesByEmployee(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(communityPostLikes)
    .where(eq(communityPostLikes.employeeId, employeeId));
  return rows.map((r) => r.postId);
}

export async function listCommunityComments(postId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(communityComments)
    .where(eq(communityComments.postId, postId))
    .orderBy(communityComments.createdAt);
}

export async function createCommunityComment(data: InsertCommunityComment) {
  const db = await getDb();
  if (!db) return;
  await db.insert(communityComments).values(data);
  // Increment comment count on the post
  await db.update(communityPosts)
    .set({ commentCount: sql`comment_count + 1` })
    .where(eq(communityPosts.postId, data.postId));
}

export async function deleteCommunityComment(commentId: string, postId: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(communityComments).where(eq(communityComments.commentId, commentId));
  await db.update(communityPosts)
    .set({ commentCount: sql`GREATEST(comment_count - 1, 0)` })
    .where(eq(communityPosts.postId, postId));
}

// ─── Phase B: Preferred Detailer — booking-form detailer list ─────────────────
/**
 * Returns detailers visible on the customer booking form for a given location.
 * Only returns active detailers with showOnBookingForm = 1.
 */
export async function getBookingFormDetailers(locationSlug: string) {
  const db = await getDb();
  if (!db) return [];
  const cityName = locationSlug === "fwb" ? "Fort Walton Beach" : locationSlug.charAt(0).toUpperCase() + locationSlug.slice(1);
  return db
    .select({
      employeeId: employees.employeeId,
      fullName: employees.fullName,
      profilePhotoUrl: employees.profilePhotoUrl,
    })
    .from(employees)
    .where(and(
      eq(employees.role, "detailer"),
      eq(employees.activeStatus, "active"),
      eq(employees.showOnBookingForm, 1),
      sql`LOWER(${employees.city}) = LOWER(${cityName})`
    ))
    .orderBy(employees.fullName);
}

// ─── Phase C: Pipeline — list and update online bookings ──────────────────────
/**
 * Returns online bookings for a date range, optionally filtered by location.
 * Used by the admin pipeline screen.
 */
export async function getPipelineBookings(params: {
  startDate: string;
  endDate: string;
  location?: string;
}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [
    gte(onlineBookings.bookingDate, params.startDate) as any,
    lte(onlineBookings.bookingDate, params.endDate) as any,
  ];
  if (params.location) {
    conditions.push(eq(onlineBookings.location, params.location) as any);
  }
  const rows = await db
    .select()
    .from(onlineBookings)
    .where(and(...conditions))
    .orderBy(onlineBookings.bookingDate, onlineBookings.startHour);

  // ── Step 1: Build a set of identities that have an active/confirmed booking.
  // If a person has a confirmed/pending/active record, their abandoned records
  // should be suppressed so they don't appear as "Abandoned Cart" in the pipeline.
  const ACTIVE_STATUSES = new Set(["confirmed", "pending", "en_route", "in_progress", "completed", "follow_up_sent"]);
  const activeIdentities = new Set<string>();
  for (const row of rows) {
    if (ACTIVE_STATUSES.has(row.status ?? '')) {
      const normPhone = row.phone ? row.phone.replace(/\D/g, '').slice(-10) : '';
      const normEmail = row.email ? row.email.toLowerCase().trim() : '';
      if (normPhone) activeIdentities.add(`phone:${normPhone}`);
      if (normEmail) activeIdentities.add(`email:${normEmail}`);
    }
  }

  // ── Step 2: Deduplicate: for each (status, normalised phone/email key) keep only the
  // most-recently-created record so the same person doesn't appear twice in
  // the same pipeline stage. Also skip abandoned records for people who already booked.
  const seen = new Map<string, (typeof rows)[number]>();
  for (const row of rows) {
    const normPhone = row.phone ? row.phone.replace(/\D/g, '').slice(-10) : '';
    const normEmail = row.email ? row.email.toLowerCase().trim() : '';

    // Suppress abandoned records when the same person has an active booking
    if (row.status === 'abandoned') {
      const hasActiveBooking =
        (normPhone && activeIdentities.has(`phone:${normPhone}`)) ||
        (normEmail && activeIdentities.has(`email:${normEmail}`));
      if (hasActiveBooking) continue; // skip — they already booked
    }

    // Build a dedup key: status + best available identifier
    const identity = normPhone || normEmail || row.bookingId;
    const key = `${row.status}::${identity}`;
    const existing = seen.get(key);
    if (!existing) {
      seen.set(key, row);
    } else {
      // Keep the newer record (higher bookingId lexicographically, or later bookingDate)
      const existingTs = existing.bookingId ?? '';
      const rowTs = row.bookingId ?? '';
      if (rowTs > existingTs) seen.set(key, row);
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    const dateCmp = (a.bookingDate ?? '').localeCompare(b.bookingDate ?? '');
    if (dateCmp !== 0) return dateCmp;
    return Number(a.startHour ?? 0) - Number(b.startHour ?? 0);
  });
}

/**
 * Returns all leads (bookingDate = 'TBD') — Maintenance, Ceramic Coating, and other non-scheduled inquiries.
 */
export async function getLeads(params: { location?: string } = {}) {
  const db = await getDb();
  if (!db) return [];
  const conditions: ReturnType<typeof eq>[] = [
    eq(onlineBookings.bookingDate, 'TBD') as any,
  ];
  if (params.location) {
    conditions.push(eq(onlineBookings.location, params.location) as any);
  }
  return db
    .select()
    .from(onlineBookings)
    .where(and(...conditions))
    .orderBy((onlineBookings as any).createdAt ?? onlineBookings.bookingId);
}

/**
 * Updates the pipeline stage (status) and optional notes for a booking.
 */
export async function updateBookingPipelineStage(
  bookingId: string,
  status: "abandoned" | "pending" | "confirmed" | "en_route" | "in_progress" | "completed" | "follow_up_sent" | "closed" | "cancelled",
  pipelineNotes?: string,
) {
  const db = await getDb();
  if (!db) return;
  const updateData: Record<string, unknown> = { status };
  if (pipelineNotes !== undefined) updateData.pipelineNotes = pipelineNotes;
  await (db.update(onlineBookings) as any).set(updateData).where(eq(onlineBookings.bookingId, bookingId));
}

/**
 * Creates an abandoned cart entry in online_bookings.
 * Called when the customer reaches the pricing/package step in the booking form.
 * Returns the bookingId so the client can promote it to confirmed later.
 */
export async function createAbandonedCart(params: {
  firstName: string;
  lastName: string;
  email: string;
  phone: string;
  location: string;
  vehicleType?: string;
  packageName?: string;
  bookingDate?: string;
  totalPrice?: string;
}): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const bookingId = `ABANDONED-${Date.now()}-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  const today = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date());
  await (db.insert(onlineBookings) as any).values({
    bookingId,
    firstName: params.firstName,
    lastName: params.lastName,
    email: params.email,
    phone: params.phone,
    location: params.location,
    vehicleType: params.vehicleType ?? null,
    packageType: params.packageName ?? null,
    bookingDate: params.bookingDate ?? today,
    totalPrice: params.totalPrice ?? null,
    timeSlot: "",
    startHour: 0,
    endHour: 0,
    streetAddress: "",
    city: "",
    state: "",
    zipCode: "",
    status: "abandoned",
    sourceUrl: "in-app-customer-portal",
  });
  return bookingId;
}

/**
 * Updates vehicle/package info on an existing abandoned cart record.
 * Called when the customer advances past Step 2 (vehicle/package selection)
 * before they have entered contact info.
 */
export async function updateAbandonedCartVehicle(
  bookingId: string,
  vehicleType: string,
  packageType: string,
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await (db.update(onlineBookings) as any)
    .set({ vehicleType, packageType })
    .where(eq(onlineBookings.bookingId, bookingId));
}

/**
 * Promotes an abandoned cart to confirmed status once the customer completes the booking.
 * Updates the record with full booking details.
 */
export async function promoteAbandonedCart(
  abandonedBookingId: string,
  updates: {
    packageType?: string;
    timeSlot?: string;
    startHour?: number;
    endHour?: number;
    totalPrice?: string;
    bookingDate?: string;
    preferredDetailerId?: string;
    preferredDetailerName?: string;
    assignedTo?: string;
  },
): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await (db.update(onlineBookings) as any)
    .set({ ...updates, status: "confirmed" })
    .where(eq(onlineBookings.bookingId, abandonedBookingId));
}

// ─── AI Knowledge Base ─────────────────────────────────────────────────────────
export async function getAiKnowledgeEntries(): Promise<AiKnowledgeEntry[]> {
  const db = await getDb();
  if (!db) return [];
  return await (db.select() as any).from(aiKnowledgeEntries).orderBy(aiKnowledgeEntries.category, aiKnowledgeEntries.orderIndex);
}

export async function getActiveAiKnowledge(): Promise<AiKnowledgeEntry[]> {
  const db = await getDb();
  if (!db) return [];
  return await (db.select() as any).from(aiKnowledgeEntries)
    .where(eq(aiKnowledgeEntries.isActive, 1))
    .orderBy(aiKnowledgeEntries.category, aiKnowledgeEntries.orderIndex);
}

export async function createAiKnowledgeEntry(data: InsertAiKnowledgeEntry): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await (db.insert(aiKnowledgeEntries) as any).values(data);
}

export async function updateAiKnowledgeEntry(entryId: string, data: Partial<InsertAiKnowledgeEntry>): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await (db.update(aiKnowledgeEntries) as any).set(data).where(eq(aiKnowledgeEntries.entryId, entryId));
}

export async function deleteAiKnowledgeEntry(entryId: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  await (db.delete(aiKnowledgeEntries) as any).where(eq(aiKnowledgeEntries.entryId, entryId));
}


// ─── Customer Payment Methods (saved cards) ───────────────────────────────────

export async function getCustomerPaymentMethods(customerKey: string) {
  const db = await getDb();
  if (!db) return [];
  const { customerPaymentMethods } = await import("../drizzle/schema.js");
  return db.select().from(customerPaymentMethods)
    .where(eq(customerPaymentMethods.customerKey, customerKey))
    .orderBy(customerPaymentMethods.createdAt);
}

export async function saveCustomerPaymentMethod(data: {
  methodId: string;
  customerKey: string;
  customerName: string;
  customerPhone?: string | null;
  customerEmail?: string | null;
  stripeCustomerId: string;
  stripePaymentMethodId: string;
  cardBrand?: string | null;
  cardLast4?: string | null;
  cardExpMonth?: number | null;
  cardExpYear?: number | null;
  isDefault?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { customerPaymentMethods } = await import("../drizzle/schema.js");
  await db.insert(customerPaymentMethods).values(data);
}

export async function deleteCustomerPaymentMethod(methodId: string) {
  const db = await getDb();
  if (!db) return;
  const { customerPaymentMethods } = await import("../drizzle/schema.js");
  await db.delete(customerPaymentMethods).where(eq(customerPaymentMethods.methodId, methodId));
}

export async function setDefaultPaymentMethod(customerKey: string, methodId: string) {
  const db = await getDb();
  if (!db) return;
  const { customerPaymentMethods } = await import("../drizzle/schema.js");
  // Clear all defaults for this customer
  await (db.update(customerPaymentMethods) as any)
    .set({ isDefault: 0 })
    .where(eq(customerPaymentMethods.customerKey, customerKey));
  // Set the new default
  await (db.update(customerPaymentMethods) as any)
    .set({ isDefault: 1 })
    .where(eq(customerPaymentMethods.methodId, methodId));
}

// ─── Do Not Service List ───
export async function addToDoNotServiceList(data: {
  customerKey: string;
  fullName?: string;
  phone?: string | null;
  email?: string | null;
  reason?: string;
  addedBy?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(doNotServiceList).values({
    customerKey: data.customerKey,
    fullName: data.fullName ?? null,
    phone: data.phone ?? null,
    email: data.email ?? null,
    reason: data.reason ?? null,
    addedBy: data.addedBy ?? null,
  }).onDuplicateKeyUpdate({
    set: {
      fullName: data.fullName ?? null,
      reason: data.reason ?? null,
      addedBy: data.addedBy ?? null,
    },
  });
  return { success: true };
}

export async function removeFromDoNotServiceList(customerKey: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(doNotServiceList).where(eq(doNotServiceList.customerKey, customerKey));
  return { success: true };
}

export async function isOnDoNotServiceList(customerKey: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: doNotServiceList.id })
    .from(doNotServiceList)
    .where(eq(doNotServiceList.customerKey, customerKey))
    .limit(1);
  return rows.length > 0;
}

export async function getDoNotServiceList() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(doNotServiceList).orderBy(desc(doNotServiceList.createdAt));
}

// ─── Admin: Delete Customer (removes all jobs and bookings for a customer key) ───
export async function deleteCustomerByKey(customerKey: string, phone: string | null, email: string | null, name: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const normalizePhone = (p: string | null | undefined) =>
    p ? p.replace(/\D/g, '').slice(-10) : null;
  const np = normalizePhone(phone);
  // Delete matching schedule jobs
  if (np) {
    await db.delete(scheduleJobs).where(
      sql`REGEXP_REPLACE(${scheduleJobs.customerPhone}, '[^0-9]', '') LIKE ${`%${np}`}`
    );
  } else if (email) {
    await db.delete(scheduleJobs).where(eq(scheduleJobs.customerEmail, email));
  } else {
    await db.delete(scheduleJobs).where(eq(scheduleJobs.customerName, name));
  }
  // Delete matching online bookings
  if (np) {
    await db.delete(onlineBookings).where(
      sql`REGEXP_REPLACE(${onlineBookings.phone}, '[^0-9]', '') LIKE ${`%${np}`}`
    );
  } else if (email) {
    await db.delete(onlineBookings).where(eq(onlineBookings.email, email));
  } else {
    await db.delete(onlineBookings).where(
      sql`CONCAT(${onlineBookings.firstName}, ' ', ${onlineBookings.lastName}) = ${name}`
    );
  }
  return { success: true };
}

// ─── Detailer Points (Accountability System) ───

/** Get the current Monday's date string (YYYY-MM-DD) */
function getCurrentWeekStart(): string {
  const now = new Date();
  const day = now.getDay(); // 0=Sun, 1=Mon...
  const diff = (day === 0 ? -6 : 1 - day); // days back to Monday
  const monday = new Date(now);
  monday.setDate(now.getDate() + diff);
  return monday.toISOString().split("T")[0];
}

/**
 * Get or initialise the points record for a detailer.
 * If the record is from a previous week, it resets to 10.
 */
export async function getOrInitDetailerPoints(employeeId: string): Promise<{ currentPoints: number; weekStartDate: string; bonusEligible: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const currentWeek = getCurrentWeekStart();
  const [row] = await db.select().from(detailerPoints).where(eq(detailerPoints.employeeId, employeeId)).limit(1);

  if (!row) {
    // First time — insert fresh record
    await db.insert(detailerPoints).values({
      employeeId,
      currentPoints: "10.0",
      weekStartDate: currentWeek,
      bonusEligible: 1,
    });
    return { currentPoints: 10, weekStartDate: currentWeek, bonusEligible: true };
  }

  // If it's a new week, reset to 10
  if (row.weekStartDate !== currentWeek) {
    await db.update(detailerPoints)
      .set({ currentPoints: "10.0", weekStartDate: currentWeek, bonusEligible: 1 })
      .where(eq(detailerPoints.employeeId, employeeId));
    return { currentPoints: 10, weekStartDate: currentWeek, bonusEligible: true };
  }

  const pts = parseFloat(String(row.currentPoints));
  return { currentPoints: pts, weekStartDate: row.weekStartDate, bonusEligible: row.bonusEligible === 1 };
}

/** Get points for all active detailers (for admin view) */
export async function getAllDetailerPoints(): Promise<Array<{ employeeId: string; currentPoints: number; weekStartDate: string; bonusEligible: boolean }>> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const currentWeek = getCurrentWeekStart();
  const rows = await db.select().from(detailerPoints);
  return rows.map(r => ({
    employeeId: r.employeeId,
    currentPoints: r.weekStartDate === currentWeek ? parseFloat(String(r.currentPoints)) : 10,
    weekStartDate: r.weekStartDate === currentWeek ? r.weekStartDate : currentWeek,
    bonusEligible: r.weekStartDate === currentWeek ? r.bonusEligible === 1 : true,
  }));
}

/** Issue a violation — deduct points and log the event */
export async function issueViolation(data: {
  employeeId: string;
  employeeName: string;
  violationType: "missed_morning_meeting" | "no_before_after_photos" | "no_late_arrival_notice" | "vehicle_damage" | "qc_issue" | "forgot_clock_in_out" | "other";
  pointsDeducted: number;
  notes?: string;
  issuedBy: string;
  writeUpNotifId?: string;
}): Promise<{ newPoints: number; bonusEligible: boolean }> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const currentWeek = getCurrentWeekStart();

  // Ensure record exists and is current week
  const current = await getOrInitDetailerPoints(data.employeeId);
  const newPoints = Math.max(0, current.currentPoints - data.pointsDeducted);
  const bonusEligible = newPoints >= 7 ? 1 : 0;

  // Update points balance
  await db.update(detailerPoints)
    .set({ currentPoints: String(newPoints.toFixed(1)), bonusEligible })
    .where(eq(detailerPoints.employeeId, data.employeeId));

  // Log the violation
  const violationId = `VIO_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
  await db.insert(pointViolations).values({
    violationId,
    employeeId: data.employeeId,
    employeeName: data.employeeName,
    violationType: data.violationType,
    pointsDeducted: String(data.pointsDeducted.toFixed(1)),
    notes: data.notes ?? null,
    weekStartDate: currentWeek,
    issuedBy: data.issuedBy,
    writeUpNotifId: data.writeUpNotifId ?? null,
  });

  return { newPoints, bonusEligible: bonusEligible === 1 };
}

/** Get violation history for a detailer (current week by default) */
export async function getViolationsForEmployee(employeeId: string, weekStartDate?: string): Promise<typeof pointViolations.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const week = weekStartDate ?? getCurrentWeekStart();
  return db.select().from(pointViolations)
    .where(and(eq(pointViolations.employeeId, employeeId), eq(pointViolations.weekStartDate, week)))
    .orderBy(desc(pointViolations.issuedAt));
}

/** Get all violations for a given week (admin view) */
export async function getAllViolationsForWeek(weekStartDate?: string): Promise<typeof pointViolations.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const week = weekStartDate ?? getCurrentWeekStart();
  return db.select().from(pointViolations)
    .where(eq(pointViolations.weekStartDate, week))
    .orderBy(desc(pointViolations.issuedAt));
}

/** Get all violations within a date range (by issuedAt timestamp) — for admin period filter */
export async function getViolationsByDateRange(startDate: string, endDate: string): Promise<typeof pointViolations.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // startDate/endDate are YYYY-MM-DD; include full end day by using < next day
  const start = new Date(startDate + "T00:00:00.000Z");
  const end = new Date(endDate + "T23:59:59.999Z");
  return db.select().from(pointViolations)
    .where(and(gte(pointViolations.issuedAt, start), lte(pointViolations.issuedAt, end)))
    .orderBy(desc(pointViolations.issuedAt));
}

/** Get write-up notifications for a detailer (all time, most recent first) */
export async function getWriteUpsForEmployee(employeeId: string): Promise<typeof notifications.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(notifications)
    .where(and(eq(notifications.employeeId, employeeId), eq(notifications.notificationType, "write_up")))
    .orderBy(desc(notifications.createdAt));
}

/** Get all write-up notifications across all detailers (admin view) */
export async function getAllWriteUps(): Promise<typeof notifications.$inferSelect[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(notifications)
    .where(eq(notifications.notificationType, "write_up"))
    .orderBy(desc(notifications.createdAt));
}

/** Manually adjust points (admin override — add or subtract) */
export async function adjustDetailerPoints(employeeId: string, adjustment: number, issuedBy: string, notes?: string): Promise<{ newPoints: number; bonusEligible: boolean }> {
  const current = await getOrInitDetailerPoints(employeeId);
  const newPoints = Math.min(10, Math.max(0, current.currentPoints + adjustment));
  const bonusEligible = newPoints >= 7 ? 1 : 0;
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(detailerPoints)
    .set({ currentPoints: String(newPoints.toFixed(1)), bonusEligible })
    .where(eq(detailerPoints.employeeId, employeeId));
  return { newPoints, bonusEligible: bonusEligible === 1 };
}

// ─── Training Quiz Questions ────────────────────────────────────────────────────
export async function getQuizQuestionsForModule(moduleId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trainingQuizQuestions)
    .where(eq(trainingQuizQuestions.moduleId, moduleId))
    .orderBy(trainingQuizQuestions.orderIndex);
}

export async function createTrainingQuizQuestion(data: InsertTrainingQuizQuestion) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(trainingQuizQuestions).values(data);
}

export async function updateTrainingQuizQuestion(questionId: string, data: {
  questionText?: string;
  optionA?: string;
  optionB?: string;
  optionC?: string;
  optionD?: string;
  correctAnswer?: "A" | "B" | "C" | "D";
  orderIndex?: number;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (data.questionText !== undefined) updateSet.questionText = data.questionText;
  if (data.optionA !== undefined) updateSet.optionA = data.optionA;
  if (data.optionB !== undefined) updateSet.optionB = data.optionB;
  if (data.optionC !== undefined) updateSet.optionC = data.optionC;
  if (data.optionD !== undefined) updateSet.optionD = data.optionD;
  if (data.correctAnswer !== undefined) updateSet.correctAnswer = data.correctAnswer;
  if (data.orderIndex !== undefined) updateSet.orderIndex = data.orderIndex;
  if (Object.keys(updateSet).length === 0) return;
  await db.update(trainingQuizQuestions).set(updateSet).where(eq(trainingQuizQuestions.questionId, questionId));
}

export async function deleteTrainingQuizQuestion(questionId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(trainingQuizQuestions).where(eq(trainingQuizQuestions.questionId, questionId));
}

// ─── Training Quiz Attempts ─────────────────────────────────────────────────────
export async function submitQuizAttempt(data: InsertTrainingQuizAttempt) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(trainingQuizAttempts).values(data);
  // If passed, mark module as completed
  if (data.passed === "yes") {
    await upsertUserTrainingProgress({
      progressId: `TPROG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      employeeId: data.employeeId,
      moduleId: data.moduleId,
      isModuleCompleted: "yes",
      completedAt: new Date(),
      startedAt: new Date(),
    });
  }
}

export async function getQuizAttemptsForEmployee(employeeId: string, moduleId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(trainingQuizAttempts)
    .where(and(
      eq(trainingQuizAttempts.employeeId, employeeId),
      eq(trainingQuizAttempts.moduleId, moduleId)
    ))
    .orderBy(desc(trainingQuizAttempts.attemptedAt));
}

export async function getBestQuizAttempt(employeeId: string, moduleId: string) {
  const db = await getDb();
  if (!db) return null;
  const attempts = await db.select().from(trainingQuizAttempts)
    .where(and(
      eq(trainingQuizAttempts.employeeId, employeeId),
      eq(trainingQuizAttempts.moduleId, moduleId)
    ))
    .orderBy(desc(trainingQuizAttempts.score))
    .limit(1);
  return attempts.length > 0 ? attempts[0] : null;
}

export async function getAllEmployeesTrainingProgress() {
  const db = await getDb();
  if (!db) return [];

  // Fetch all 48 active interactive modules from the DB (the source of truth)
  const { interactiveModules } = await import('../drizzle/schema');
  const activeModules = await db.select({
    moduleKey: interactiveModules.moduleKey,
    title: interactiveModules.title,
  }).from(interactiveModules)
    .where(eq(interactiveModules.isActive, 1));

  // Build module list from active DB modules only (the source of truth).
  // Legacy TM_ hardcoded IDs are no longer counted — all modules live in the DB.
  const moduleList: { id: string; name: string }[] = activeModules.map(m => ({
    id: m.moduleKey,
    name: (m.title as string) || m.moduleKey,
  }));
  const totalModules = moduleList.length;
  const validModuleIds = new Set(moduleList.map(m => m.id));

  // Get all detailers
  const detailers = await db.select().from(employees)
    .where(and(eq(employees.role, "detailer"), eq(employees.activeStatus, "active")));
  // Get all progress records
  const progress = await db.select().from(userTrainingProgress);
  // Get all quiz attempts
  const attempts = await db.select().from(trainingQuizAttempts);
  // Get all quiz modules (training_modules table — these have quiz questions)
  const quizMods = await db.select().from(trainingModules);

  return detailers.map(emp => {
    const empProgress = progress.filter(p => p.employeeId === emp.employeeId);
    const empAttempts = attempts.filter(a => a.employeeId === emp.employeeId);
    // Count completions against all valid module IDs
    const completedModules = empProgress.filter(
      p => p.isModuleCompleted === "yes" && validModuleIds.has(p.moduleId)
    ).length;
    const progressPercent = totalModules > 0 ? Math.round((completedModules / totalModules) * 100) : 0;
    const hasReached50 = progressPercent >= 50;

    // Build per-quiz scores from training_modules
    const quizScores = quizMods.map(qm => {
      const qAttempts = empAttempts.filter(a => a.moduleId === qm.moduleId);
      const best = qAttempts.sort((a, b) => b.score - a.score)[0];
      return {
        moduleId: qm.moduleId,
        quizTitle: (qm.quizTitle as string) || (qm.name as string) || qm.moduleId,
        bestScore: best ? Math.round((best.score / best.totalQuestions) * 100) : null,
        attempts: qAttempts.length,
        passed: best ? best.passed === "yes" : false,
      };
    });

    return {
      employeeId: emp.employeeId,
      fullName: emp.fullName,
      city: emp.city,
      completedModules,
      totalModules,
      progressPercent,
      hasReached50,
      quizScores,
      moduleProgress: moduleList.map(({ id: moduleId, name: moduleName }) => {
        const prog = empProgress.find(p => p.moduleId === moduleId);
        const bestAttempt = empAttempts
          .filter(a => a.moduleId === moduleId)
          .sort((a, b) => b.score - a.score)[0];
        return {
          moduleId,
          moduleName,
          isCompleted: prog?.isModuleCompleted === "yes",
          completedAt: prog?.completedAt,
          bestScore: bestAttempt ? Math.round((bestAttempt.score / bestAttempt.totalQuestions) * 100) : null,
          attempts: empAttempts.filter(a => a.moduleId === moduleId).length,
        };
      }),
    };
  });
}

export async function getAllQuizAttemptsForEmployee(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  const attempts = await db.select().from(trainingQuizAttempts)
    .where(eq(trainingQuizAttempts.employeeId, employeeId))
    .orderBy(desc(trainingQuizAttempts.attemptedAt));
  const modules = await db.select().from(trainingModules);
  return attempts.map(a => {
    const mod = modules.find(m => m.moduleId === a.moduleId);
    return { ...a, moduleName: (mod?.name as string) ?? a.moduleId };
  });
}

export async function resetEmployeeModuleProgress(employeeId: string, moduleId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(userTrainingProgress)
    .where(and(
      eq(userTrainingProgress.employeeId, employeeId),
      eq(userTrainingProgress.moduleId, moduleId)
    ));
  await db.delete(trainingQuizAttempts)
    .where(and(
      eq(trainingQuizAttempts.employeeId, employeeId),
      eq(trainingQuizAttempts.moduleId, moduleId)
    ));
}

export async function markScrollComplete(employeeId: string, moduleId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await upsertUserTrainingProgress({
    progressId: `TPROG_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
    employeeId,
    moduleId,
    isModuleCompleted: "yes",
    completedAt: new Date(),
    startedAt: new Date(),
  });
}

export async function seedTrainingModulesV2() {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check if v2 modules already exist
  const existing = await db.select().from(trainingModules)
    .where(eq(trainingModules.moduleId, "TM_WELCOME"));
  if (existing.length > 0) return { message: "Training v2 data already seeded" };

  // Clear old training data
  await db.delete(trainingQuizAttempts);
  await db.delete(trainingQuizQuestions);
  await db.delete(userTrainingProgress);
  await db.delete(trainingSteps);
  await db.delete(trainingTools);
  await db.delete(trainingModules);

  const { trainingV2Modules, trainingV2Steps, trainingV2Questions } = await import("./training-v2-seed");
  for (const m of trainingV2Modules) await db.insert(trainingModules).values(m);
  for (const s of trainingV2Steps) await db.insert(trainingSteps).values(s);
  for (const q of trainingV2Questions) await db.insert(trainingQuizQuestions).values(q);
  return { message: "Training v2 data seeded successfully", modules: trainingV2Modules.length };
}

// ─── Geofence Zones ───────────────────────────────────────────────────────────
export async function listGeofenceZones() {
  const db = await getDb();
  if (!db) return [];
  const { geofenceZones } = await import("../drizzle/schema");
  return db.select().from(geofenceZones).orderBy(desc(geofenceZones.createdAt));
}

export async function createGeofenceZone(data: {
  zoneId: string; name: string; address: string;
  latitude: number; longitude: number; radiusMeters?: number; createdBy?: string;
}) {
  const db = await getDb();
  if (!db) return;
  const { geofenceZones } = await import("../drizzle/schema");
  await db.insert(geofenceZones).values({
    zoneId: data.zoneId, name: data.name, address: data.address,
    latitude: data.latitude, longitude: data.longitude,
    radiusMeters: data.radiusMeters ?? 402,
    isActive: 1,
    createdBy: data.createdBy ?? null,
  });
}

export async function toggleGeofenceZone(zoneId: string, isActive: number) {
  const db = await getDb();
  if (!db) return;
  const { geofenceZones } = await import("../drizzle/schema");
  await db.update(geofenceZones).set({ isActive }).where(eq(geofenceZones.zoneId, zoneId));
}

export async function deleteGeofenceZone(zoneId: string) {
  const db = await getDb();
  if (!db) return;
  const { geofenceZones } = await import("../drizzle/schema");
  await db.delete(geofenceZones).where(eq(geofenceZones.zoneId, zoneId));
}

export async function logGeofenceEvent(data: {
  eventId: string; employeeId: string; fullName?: string;
  zoneId: string; zoneName?: string; eventType: "enter" | "exit";
  latitude?: number; longitude?: number;
}) {
  const db = await getDb();
  if (!db) return;
  const { geofenceEvents } = await import("../drizzle/schema");
  await db.insert(geofenceEvents).values({
    eventId: data.eventId, employeeId: data.employeeId,
    fullName: data.fullName ?? null, zoneId: data.zoneId,
    zoneName: data.zoneName ?? null, eventType: data.eventType,
    latitude: data.latitude ?? null, longitude: data.longitude ?? null,
  });
}

export async function listGeofenceEvents(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  const { geofenceEvents } = await import("../drizzle/schema");
  return db.select().from(geofenceEvents).orderBy(desc(geofenceEvents.createdAt)).limit(limit);
}

// ─── EOD Checklists ───────────────────────────────────────────────────────────
export async function getOrCreateEodChecklist(employeeId: string, fullName?: string) {
  const db = await getDb();
  if (!db) return null;
  const { eodChecklists, eodChecklistItems } = await import("../drizzle/schema");
  const today = todayCST(); // Use CDT/CST timezone — prevents checklist rolling over at 7 PM CDT (UTC midnight)
  const existing = await db.select().from(eodChecklists)
    .where(and(eq(eodChecklists.employeeId, employeeId), eq(eodChecklists.date, today)))
    .limit(1);
  let checklist = existing[0];
  if (!checklist) {
    const checklistId = `EOD-${employeeId}-${today}`;
    await db.insert(eodChecklists).values({
      checklistId, employeeId, fullName: fullName ?? null, date: today, status: "pending",
    });
    checklist = (await db.select().from(eodChecklists).where(eq(eodChecklists.checklistId, checklistId)).limit(1))[0];
  }
  const items = await db.select().from(eodChecklistItems)
    .where(eq(eodChecklistItems.checklistId, checklist.checklistId));
  return { checklist, items };
}

export async function submitEodChecklistStep(
  checklistId: string,
  stepKey: "trash_removed" | "chemicals_stocked" | "towels_stocked",
  photoUrl: string,
) {
  const db = await getDb();
  if (!db) return;
  const { eodChecklistItems } = await import("../drizzle/schema");
  const itemId = `EODI-${checklistId}-${stepKey}`;
// @ts-ignore
// @ts-ignore
  const existing = await db.select().from(eodChecklistItems)
// @ts-ignore
    .where(and(eq(eodChecklistItems.checklistId, checklistId), eq(eodChecklistItems.stepKey, stepKey)))
    .limit(1);
  if (existing[0]) {
    await db.update(eodChecklistItems)
      .set({ photoUrl, completedAt: new Date() })
      .where(eq(eodChecklistItems.itemId, existing[0].itemId));
// @ts-ignore
// @ts-ignore
  } else {
// @ts-ignore
    await db.insert(eodChecklistItems).values({
      itemId, checklistId, stepKey, photoUrl, completedAt: new Date(),
    });
  }
}

export async function submitEodChecklist(checklistId: string) {
  const db = await getDb();
  if (!db) return;
  const { eodChecklists } = await import("../drizzle/schema");
  await db.update(eodChecklists)
    .set({ status: "submitted", submittedAt: new Date() })
    .where(eq(eodChecklists.checklistId, checklistId));
}

export async function listEodChecklistsByDate(date: string) {
  const db = await getDb();
  if (!db) return [];
  const { eodChecklists, eodChecklistItems } = await import("../drizzle/schema");
  const lists = await db.select().from(eodChecklists).where(eq(eodChecklists.date, date));
  const result = [];
  for (const cl of lists) {
    const items = await db.select().from(eodChecklistItems).where(eq(eodChecklistItems.checklistId, cl.checklistId));
    result.push({ checklist: cl, items });
  }
  return result;
}

export async function reviewEodChecklist(data: {
  checklistId: string; status: "approved" | "violated";
  reviewedBy: string; reviewNote?: string;
}) {
  const db = await getDb();
  if (!db) return;
  const { eodChecklists } = await import("../drizzle/schema");
  await db.update(eodChecklists)
    .set({
      status: data.status, reviewedBy: data.reviewedBy,
      reviewedAt: new Date(), reviewNote: data.reviewNote ?? null,
    })
    .where(eq(eodChecklists.checklistId, data.checklistId));
}

// ─── Promotions ───────────────────────────────────────────────────────────────
export async function listPromotions() {
  const db = await getDb();
  if (!db) return [];
  const { promotions } = await import("../drizzle/schema");
  return db.select().from(promotions).orderBy(desc(promotions.createdAt));
}

export async function getActivePromotions() {
  const db = await getDb();
  if (!db) return [];
  const { promotions } = await import("../drizzle/schema");
  const today = new Date().toISOString().split("T")[0];
  const all = await db.select().from(promotions)
    .where(eq(promotions.isActive, 1))
    .orderBy(desc(promotions.createdAt));
  return all.filter(p => {
    if (p.startDate && p.startDate > today) return false;
    if (p.endDate && p.endDate < today) return false;
    return true;
  });
}

export async function createPromotion(data: {
  title: string; description?: string;
  discountType: "percent" | "fixed" | "none";
  discountValue?: number; promoCode?: string;
  bgColor?: string; emoji?: string;
  startDate?: string; endDate?: string;
  createdBy?: string;
}) {
  const db = await getDb();
  if (!db) return null;
  const { promotions } = await import("../drizzle/schema");
  const promoId = generateId("promo");
  await db.insert(promotions).values({
    promoId,
    title: data.title,
    description: data.description ?? null,
    discountType: data.discountType,
    discountValue: data.discountValue ? String(data.discountValue) : "0",
    promoCode: data.promoCode ?? null,
    bgColor: data.bgColor ?? "#0057FF",
    emoji: data.emoji ?? "🎉",
    startDate: data.startDate ?? null,
    endDate: data.endDate ?? null,
    isActive: 1,
    createdBy: data.createdBy ?? null,
  });
  return promoId;
}

export async function updatePromotion(promoId: string, data: {
  title?: string; description?: string;
  discountType?: "percent" | "fixed" | "none";
  discountValue?: number; promoCode?: string;
  bgColor?: string; emoji?: string;
  startDate?: string; endDate?: string;
  isActive?: boolean;
}) {
  const db = await getDb();
  if (!db) return;
  const { promotions } = await import("../drizzle/schema");
  const updateSet: Record<string, any> = {};
  if (data.title !== undefined) updateSet.title = data.title;
  if (data.description !== undefined) updateSet.description = data.description;
  if (data.discountType !== undefined) updateSet.discountType = data.discountType;
  if (data.discountValue !== undefined) updateSet.discountValue = String(data.discountValue);
  if (data.promoCode !== undefined) updateSet.promoCode = data.promoCode;
  if (data.bgColor !== undefined) updateSet.bgColor = data.bgColor;
  if (data.emoji !== undefined) updateSet.emoji = data.emoji;
  if (data.startDate !== undefined) updateSet.startDate = data.startDate;
  if (data.endDate !== undefined) updateSet.endDate = data.endDate;
  if (data.isActive !== undefined) updateSet.isActive = data.isActive ? 1 : 0;
  if (Object.keys(updateSet).length === 0) return;
  await db.update(promotions).set(updateSet).where(eq(promotions.promoId, promoId));
}

export async function deletePromotion(promoId: string) {
  const db = await getDb();
  if (!db) return;
  const { promotions } = await import("../drizzle/schema");
  await db.delete(promotions).where(eq(promotions.promoId, promoId));
}

// ─── Subsidiary Cities ─────────────────────────────────────────────────────────
export async function getSubsidiaryCities(locationId?: string): Promise<{ id: string; locationId: string; name: string; createdAt: string }[]> {
  const conn = await getConnection();
  try {
    const [rows] = await conn.execute(
      locationId
        ? `SELECT id, location_id as locationId, name, created_at as createdAt FROM subsidiary_cities WHERE location_id = ? ORDER BY name ASC`
        : `SELECT id, location_id as locationId, name, created_at as createdAt FROM subsidiary_cities ORDER BY name ASC`,
      locationId ? [locationId] : []
    );
    return rows as any[];
  } finally {
    await conn.end();
  }
}

export async function addSubsidiaryCity(locationId: string, name: string): Promise<string> {
  const conn = await getConnection();
  try {
    const id = require('crypto').randomUUID();
    await conn.execute(
      `INSERT INTO subsidiary_cities (id, location_id, name) VALUES (?, ?, ?)`,
      [id, locationId, name.trim()]
    );
    return id;
  } finally {
    await conn.end();
  }
}

export async function removeSubsidiaryCity(id: string): Promise<void> {
  const conn = await getConnection();
  try {
    await conn.execute(`DELETE FROM subsidiary_cities WHERE id = ?`, [id]);
  } finally {
    await conn.end();
  }
}

export async function getAllSubsidiaryCitiesGrouped(): Promise<Record<string, string[]>> {
  const rows = await getSubsidiaryCities();
  const grouped: Record<string, string[]> = {};
  for (const row of rows) {
    if (!grouped[row.locationId]) grouped[row.locationId] = [];
    grouped[row.locationId].push(row.name);
  }
  return grouped;
}

// ─── Ops Dashboard: Today's clock-in/out summary ─────────────────────────────
export async function getTodayClockSummary(): Promise<{
  recordId: string;
  employeeId: string;
  fullName: string;
  clockInTime: string | null;
  clockOutTime: string | null;
  status: string;
}[]> {
  const db = await getDb();
  if (!db) return [];
  const today = new Date().toISOString().slice(0, 10);
  const records = await db.select().from(clockInOutRecords)
    .where(eq(clockInOutRecords.date, today))
    .orderBy(desc(clockInOutRecords.clockInTime));
  return records.map((r) => ({
    recordId: r.recordId,
    employeeId: r.employeeId,
    fullName: r.fullName,
    clockInTime: r.clockInTime ? new Date(r.clockInTime).toISOString() : null,
    clockOutTime: r.clockOutTime ? new Date(r.clockOutTime).toISOString() : null,
    status: r.status,
  }));
}

// ─── Company Meetings ─────────────────────────────────────────────────────────
export async function getUpcomingCompanyMeetings() {
  const db = await getDb();
  if (!db) return [];
  const today = todayCST();
  return db.select().from(companyMeetings)
    .where(and(
      gte(companyMeetings.meetingDate, today),
      ne(companyMeetings.status, "cancelled")
    ))
    .orderBy(companyMeetings.meetingDate);
}

export async function getAllCompanyMeetings() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(companyMeetings)
    .orderBy(desc(companyMeetings.meetingDate));
}

export async function createCompanyMeeting(data: InsertCompanyMeeting) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.insert(companyMeetings).values(data);
}

export async function updateCompanyMeeting(meetingId: string, data: Partial<InsertCompanyMeeting>) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(companyMeetings).set(data).where(eq(companyMeetings.meetingId, meetingId));
}

export async function deleteCompanyMeeting(meetingId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(companyMeetings).where(eq(companyMeetings.meetingId, meetingId));
}

export async function getImminentCompanyMeeting() {
  const db = await getDb();
  if (!db) return null;
  // Get current date and time in CST
  const now = new Date();
  const cstParts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Chicago",
    year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", hour12: false,
  }).formatToParts(now);
  const get = (type: string) => cstParts.find((p) => p.type === type)?.value ?? "00";
  const todayStr = `${get("year")}-${get("month")}-${get("day")}`;
  const currentHour = parseInt(get("hour"), 10);
  const currentMinute = parseInt(get("minute"), 10);
  const currentTotalMinutes = currentHour * 60 + currentMinute;

  const meetings = await db.select().from(companyMeetings)
    .where(and(
      eq(companyMeetings.meetingDate, todayStr),
      ne(companyMeetings.status, "cancelled")
    ));

  for (const meeting of meetings) {
    const [mHour, mMinute] = meeting.meetingTime.split(":").map(Number);
    const meetingTotalMinutes = mHour * 60 + mMinute;
    // Show banner from 30 min before until 1 min after start
    const windowStart = meetingTotalMinutes - 30;
    const windowEnd = meetingTotalMinutes + 1;
    if (currentTotalMinutes >= windowStart && currentTotalMinutes < windowEnd) {
      return meeting;
    }
  }
  return null;
}

/** Returns which days of a given week have at least one on-shift detailer in the city.
 *  Used by the customer booking calendar to grey out days with no coverage.
 *  @param weekStartDate - Monday of the week as YYYY-MM-DD
 *  @param city - city name to filter detailers
 *  @returns Record<string, boolean> keyed by YYYY-MM-DD date strings for Mon–Sun of that week
 */
export async function getShiftCoverageForWeek(weekStartDate: string, city: string): Promise<Record<string, boolean>> {
  const db = await getDb();
  if (!db) return {};

  // Get all active detailers in this city (case-insensitive match)
  const allDetailers = await db.select({ employeeId: employees.employeeId })
    .from(employees)
    .where(and(
      eq(employees.role, "detailer"),
      eq(employees.activeStatus, "active"),
      sql`LOWER(${employees.city}) = LOWER(${city})`
    ));

  if (allDetailers.length === 0) {
    // No detailers at all — all days unavailable
    const result: Record<string, boolean> = {};
    const [y, m, d] = weekStartDate.split('-').map(Number);
    for (let i = 0; i < 7; i++) {
      const date = new Date(y, m - 1, d + i);
      const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
      result[key] = false;
    }
    return result;
  }

  // Load shift assignments
  const ids = allDetailers.map(d => d.employeeId);
  const safeIds = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(',');
  const rows = await db.execute(sql`SELECT employee_id, shift FROM employee_van_assignments WHERE employee_id IN (${sql.raw(safeIds)})`);
  const shiftMap: Record<string, 'shift1' | 'shift2'> = {};
  for (const row of (rows[0] as unknown as any[])) {
    shiftMap[row.employee_id] = (row.shift ?? 'shift1') as 'shift1' | 'shift2';
  }

  // shift1 = Mon–Thu ONLY | shift2 = Fri–Sun ONLY (no Thursday overlap)
  const shift1Days = new Set([1, 2, 3, 4]); // Mon–Thu

  const hasShift1 = allDetailers.some(d => (shiftMap[d.employeeId] ?? 'shift1') === 'shift1');
  const hasShift2 = allDetailers.some(d => shiftMap[d.employeeId] === 'shift2');

  const result: Record<string, boolean> = {};
  const [y, m, d] = weekStartDate.split('-').map(Number);
  for (let i = 0; i < 7; i++) {
    const date = new Date(y, m - 1, d + i);
    const dow = date.getDay();
    const key = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    // Mon–Thu: only shift1 | Fri–Sun: only shift2
    if (shift1Days.has(dow)) {
      result[key] = hasShift1; // Mon–Thu: shift1 only
    } else {
      result[key] = hasShift2; // Fri–Sun: shift2 only
    }
  }
  return result;
}


// ─── Referral Program ─────────────────────────────────────────────────────────

/** Get or create a referral code for a customer */
export async function getOrCreateReferralCode(customerId: string, firstName?: string | null): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(referralCodes)
    .where(eq(referralCodes.customerId, customerId)).limit(1);
  if (existing.length > 0) return existing[0].code;
  // Generate code: LWOWJOH1A2B (3-char name + 4 hex) or LWOW1A2B3C (6 hex)
  const namePart = firstName ? firstName.replace(/[^a-zA-Z]/g, '').toUpperCase().slice(0, 3) : null;
  const suffix = randomBytes(2).toString('hex').toUpperCase();
  const code = namePart ? `LWOW${namePart}${suffix}` : `LWOW${randomBytes(3).toString('hex').toUpperCase()}`;
  const data: InsertReferralCode = { customerId, code };
  await db.insert(referralCodes).values(data);
  return code;
}

/** Look up a customer by referral code */
export async function getCustomerByReferralCode(code: string) {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select().from(referralCodes)
    .where(eq(referralCodes.code, code.toUpperCase())).limit(1);
  return result.length > 0 ? result[0] : null;
}

/** Get a customer's Expo push token by their customerId */
export async function getCustomerPushToken(customerId: string): Promise<string | null> {
  const db = await getDb();
  if (!db) return null;
  const result = await db.select({ pushToken: customersTable.pushToken })
    .from(customersTable)
    .where(eq(customersTable.customerId, customerId))
    .limit(1);
  return result.length > 0 ? (result[0].pushToken ?? null) : null;
}
/** Create a pending referral when a friend signs up via referral link */
export async function createReferral(referrerId: string, friendId: string, friendEmail: string): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Check if this friend was already referred by this referrer
  const existing = await db.select().from(referrals)
    .where(and(eq(referrals.referrerId, referrerId), eq(referrals.friendId, friendId))).limit(1);
  if (existing.length > 0) return existing[0].referralId;
  const referralId = generateId('ref');
  const data: InsertReferral = { referralId, referrerId, friendId, friendEmail, status: 'pending', pointsAwarded: 0 };
  await db.insert(referrals).values(data);
  return referralId;
}

/** Mark a referral as completed and award 500 points to the referrer */
export async function completeReferral(referralId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const existing = await db.select().from(referrals)
    .where(eq(referrals.referralId, referralId)).limit(1);
  if (!existing.length || existing[0].status === 'rewarded') return;
  const referral = existing[0];
  const POINTS = 500;
  // Update referral status
  await db.update(referrals).set({
    status: 'rewarded',
    pointsAwarded: POINTS,
    completedAt: new Date(),
  }).where(eq(referrals.referralId, referralId));
  // Add points to ledger
  const expiresAt = new Date();
  expiresAt.setFullYear(expiresAt.getFullYear() + 1);
  const ledgerData: InsertPointsLedger = {
    ledgerId: generateId('ldg'),
    customerId: referral.referrerId,
    type: 'earn',
    points: POINTS,
    description: 'Referral bonus — friend completed first service',
    referralId,
    expiresAt,
  };
  await db.insert(pointsLedger).values(ledgerData);
}

/** Get a customer's current non-expired point balance */
export async function getCustomerPointBalance(customerId: string): Promise<number> {
  const db = await getDb();
  if (!db) return 0;
  const now = new Date();
  // Sum all earn rows that haven't expired + all redeem/expire rows
  const rows = await db.select().from(pointsLedger)
    .where(eq(pointsLedger.customerId, customerId));
  let balance = 0;
  for (const row of rows) {
    if (row.type === 'earn') {
      // Only count if not yet expired
      if (!row.expiresAt || row.expiresAt > now) {
        balance += row.points;
      }
    } else {
      // redeem or expire — always negative
      balance += row.points;
    }
  }
  return Math.max(0, balance);
}

/** Get a customer's full points history */
export async function getCustomerPointsHistory(customerId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(pointsLedger)
    .where(eq(pointsLedger.customerId, customerId))
    .orderBy(desc(pointsLedger.createdAt));
}

/** Get all referrals made by a customer */
export async function getCustomerReferrals(customerId: string) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(referrals)
    .where(eq(referrals.referrerId, customerId))
    .orderBy(desc(referrals.createdAt));
  // Enrich with friend's name from customers table when available
  const enriched = await Promise.all(rows.map(async (r) => {
    if (r.friendId) {
      const friend = await db.select({ firstName: customersTable.firstName, lastName: customersTable.lastName })
        .from(customersTable).where(eq(customersTable.customerId, r.friendId)).limit(1);
      if (friend.length > 0) {
        return { ...r, friendName: `${friend[0].firstName} ${friend[0].lastName}`.trim() };
      }
    }
    return { ...r, friendName: null };
  }));
  return enriched;
}

// ─── Reward Tiers (admin-configurable) ───────────────────────────────────────

export async function getAllRewardTiers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rewardTiers).orderBy(rewardTiers.sortOrder, rewardTiers.pointCost);
}

export async function getActiveRewardTiers() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(rewardTiers)
    .where(eq(rewardTiers.isActive, 'yes'))
    .orderBy(rewardTiers.sortOrder, rewardTiers.pointCost);
}

export async function createRewardTier(data: { name: string; description?: string; pointCost: number; sortOrder?: number }): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const tierId = generateId('tier');
  const tierData: InsertRewardTier = {
    tierId,
    name: data.name,
    description: data.description,
    pointCost: data.pointCost,
    sortOrder: data.sortOrder ?? 0,
    isActive: 'yes',
  };
  await db.insert(rewardTiers).values(tierData);
  return tierId;
}

export async function updateRewardTier(tierId: string, data: { name?: string; description?: string; pointCost?: number; isActive?: 'yes' | 'no'; sortOrder?: number }): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const updateSet: Record<string, unknown> = {};
  if (data.name !== undefined) updateSet.name = data.name;
  if (data.description !== undefined) updateSet.description = data.description;
  if (data.pointCost !== undefined) updateSet.pointCost = data.pointCost;
  if (data.isActive !== undefined) updateSet.isActive = data.isActive;
  if (data.sortOrder !== undefined) updateSet.sortOrder = data.sortOrder;
  if (Object.keys(updateSet).length === 0) return;
  await db.update(rewardTiers).set(updateSet).where(eq(rewardTiers.tierId, tierId));
}

export async function deleteRewardTier(tierId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(rewardTiers).where(eq(rewardTiers.tierId, tierId));
}

// ─── Redemptions ─────────────────────────────────────────────────────────────

export async function redeemPoints(customerId: string, tierId: string): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Get tier
  const tierRows = await db.select().from(rewardTiers).where(eq(rewardTiers.tierId, tierId)).limit(1);
  if (!tierRows.length) throw new Error("Reward tier not found");
  const tier = tierRows[0];
  if (tier.isActive !== 'yes') throw new Error("This reward is no longer available");
  // Check balance
  const balance = await getCustomerPointBalance(customerId);
  if (balance < tier.pointCost) throw new Error(`Insufficient points. You have ${balance} pts, need ${tier.pointCost} pts`);
  // Create redemption record
  const redemptionId = generateId('rdm');
  const redemptionData: InsertRedemption = {
    redemptionId,
    customerId,
    tierId,
    tierName: tier.name,
    pointsSpent: tier.pointCost,
    status: 'pending',
  };
  await db.insert(redemptions).values(redemptionData);
  // Deduct from ledger
  const ledgerData: InsertPointsLedger = {
    ledgerId: generateId('ldg'),
    customerId,
    type: 'redeem',
    points: -tier.pointCost,
    description: `Redeemed: ${tier.name}`,
    redemptionId,
  };
  await db.insert(pointsLedger).values(ledgerData);
  return redemptionId;
}

export async function getCustomerRedemptions(customerId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(redemptions)
    .where(eq(redemptions.customerId, customerId))
    .orderBy(desc(redemptions.createdAt));
}

export async function getAllPendingRedemptions() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(redemptions)
    .where(eq(redemptions.status, 'pending'))
    .orderBy(desc(redemptions.createdAt));
}

export async function applyRedemption(redemptionId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(redemptions).set({ status: 'applied', appliedAt: new Date() })
    .where(eq(redemptions.redemptionId, redemptionId));
}
/** Detailer fulfills a pending redemption — stamps who fulfilled it and marks as applied */
export async function fulfillRedemption(
  redemptionId: string,
  fulfilledBy: string,
  fulfilledByEmployeeId: string
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(redemptions).set({
    status: 'applied',
    appliedAt: new Date(),
    fulfilledBy,
    fulfilledByEmployeeId,
  }).where(eq(redemptions.redemptionId, redemptionId));
}
/** Get all pending redemptions for a specific customer (for detailer job card badge) */
export async function getPendingRedemptionsForCustomer(customerId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(redemptions)
    .where(and(eq(redemptions.customerId, customerId), eq(redemptions.status, 'pending')))
    .orderBy(desc(redemptions.createdAt));
}

/** Stamp on_my_way_at or arrived_at on a schedule job */
export async function stampJobTimestamp(
  jobId: string,
  field: "onMyWayAt" | "arrivedAt" | "finishedAt",
  timestamp: Date,
) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(scheduleJobs).set({ [field]: timestamp } as any).where(eq(scheduleJobs.jobId, jobId));
}

// ─── Price Book CRUD ──────────────────────────────────────────────────────────
export async function listPriceBookServices(): Promise<PriceBookService[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(priceBookServices)
    .where(eq(priceBookServices.isActive, "yes"))
    .orderBy(priceBookServices.sortOrder, priceBookServices.createdAt);
}

export async function listAllPriceBookServices(): Promise<PriceBookService[]> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  return db.select().from(priceBookServices)
    .orderBy(priceBookServices.sortOrder, priceBookServices.createdAt);
}

export async function togglePriceBookServiceActive(serviceId: string, isActive: boolean): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(priceBookServices)
    .set({ isActive: isActive ? "yes" : "no" })
    .where(eq(priceBookServices.serviceId, serviceId));
}

export async function upsertPriceBookService(data: {
  serviceId: string;
  name: string;
  emoji: string;
  description?: string;
  features?: string[];
  vehiclePrices: { sedan: number; suv: number; xl_suv_van: number; truck: number; rv_20_29?: number; rv_30_39?: number; rv_40_plus?: number };
  sortOrder?: number;
  imageUrl?: string;
}): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const row = {
    serviceId: data.serviceId,
    name: data.name,
    emoji: data.emoji || "🚗",
    description: data.description ?? null,
    features: data.features ? JSON.stringify(data.features) : null,
    vehiclePrices: JSON.stringify(data.vehiclePrices),
    imageUrl: data.imageUrl ?? null,
    sortOrder: data.sortOrder ?? 0,
    isActive: "yes" as const,
  };
  await db.insert(priceBookServices).values(row)
    .onDuplicateKeyUpdate({ set: {
      name: row.name,
      emoji: row.emoji,
      description: row.description,
      features: row.features,
      vehiclePrices: row.vehiclePrices,
      imageUrl: row.imageUrl,
      sortOrder: row.sortOrder,
    }});
}

export async function upsertPriceBookServiceImage(serviceId: string, imageUrl: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(priceBookServices)
    .set({ imageUrl })
    .where(eq(priceBookServices.serviceId, serviceId));
}

export async function deletePriceBookService(serviceId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Soft-delete: mark inactive
  await db.update(priceBookServices)
    .set({ isActive: "no" })
    .where(eq(priceBookServices.serviceId, serviceId));
}

export async function reorderPriceBookServices(orderedIds: string[]): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  // Update sortOrder for each serviceId based on its position in the array
  for (let i = 0; i < orderedIds.length; i++) {
    await db.update(priceBookServices)
      .set({ sortOrder: i })
      .where(eq(priceBookServices.serviceId, orderedIds[i]));
  }
}

// ─── Customer Map Locations ───────────────────────────────────────────────────
// Returns geocoded lat/lng for all unique customer addresses.
// Uses a geocode_cache table to avoid re-hitting Nominatim on every request.
export async function getCustomerMapLocations(): Promise<Array<{
  customerId: string;
  fullName: string;
  address: string;
  city: string | null;
  lat: number;
  lng: number;
  jobCount: number;
  lifetimeValue: number;
}>> {
  const db = await getDb();
  if (!db) return [];

  // Pull all unique customer addresses from online bookings
  const bookingRows = await db.select({
    firstName: onlineBookings.firstName,
    lastName: onlineBookings.lastName,
    phone: onlineBookings.phone,
    email: onlineBookings.email,
    streetAddress: onlineBookings.streetAddress,
    city: onlineBookings.city,
    state: onlineBookings.state,
    zipCode: onlineBookings.zipCode,
    totalPrice: onlineBookings.totalPrice,
    finalTotal: onlineBookings.finalTotal,
  }).from(onlineBookings)
    .where(and(ne(onlineBookings.status, 'cancelled'), isNotNull(onlineBookings.streetAddress)));

  // Pull all unique customer addresses from schedule jobs
  const jobRows = await db.select({
    customerName: scheduleJobs.customerName,
    customerPhone: scheduleJobs.customerPhone,
    customerEmail: scheduleJobs.customerEmail,
    customerAddress: scheduleJobs.customerAddress,
    location: scheduleJobs.location,
    totalPrice: scheduleJobs.totalPrice,
  }).from(scheduleJobs)
    .where(and(
      ne(scheduleJobs.status, 'cancelled'),
      isNotNull(scheduleJobs.customerAddress),
      ne(scheduleJobs.customerAddress, ''),
    ));

  // Build a map of address → customer info
  type Entry = {
    customerId: string;
    fullName: string;
    address: string;
    city: string | null;
    jobCount: number;
    lifetimeValue: number;
  };
  const normalizePhone = (p: string | null | undefined) =>
    p ? p.replace(/\D/g, '').slice(-10) : null;
  const getKey = (phone: string | null | undefined, email: string | null | undefined, name: string) => {
    const np = normalizePhone(phone);
    if (np && np.length === 10) return `phone:${np}`;
    if (email) return `email:${email.toLowerCase()}`;
    return `name:${name.toLowerCase().trim()}`;
  };

  const customerMap = new Map<string, Entry>();

  for (const b of bookingRows) {
    const fullName = `${b.firstName} ${b.lastName}`.trim();
    const key = getKey(b.phone, b.email, fullName);
    const addr = b.streetAddress
      ? `${b.streetAddress}${b.city ? `, ${b.city}` : ''}${b.state ? `, ${b.state}` : ''}${b.zipCode ? ` ${b.zipCode}` : ''}`
      : null;
    if (!addr) continue;
    const price = parseFloat(String(b.finalTotal ?? b.totalPrice ?? '0')) || 0;
    const existing = customerMap.get(key);
    if (existing) {
      existing.jobCount += 1;
      existing.lifetimeValue += price;
      if (!existing.address) existing.address = addr;
    } else {
      customerMap.set(key, { customerId: key, fullName, address: addr, city: b.city ?? null, jobCount: 1, lifetimeValue: price });
    }
  }

  for (const j of jobRows) {
    if (!j.customerName || !j.customerAddress) continue;
    const key = getKey(j.customerPhone, j.customerEmail, j.customerName);
    const price = parseFloat(String(j.totalPrice ?? '0')) || 0;
    const existing = customerMap.get(key);
    if (existing) {
      existing.jobCount += 1;
      existing.lifetimeValue += price;
      if (!existing.address) existing.address = j.customerAddress;
    } else {
      customerMap.set(key, {
        customerId: key,
        fullName: j.customerName,
        address: j.customerAddress,
        city: j.location ?? null,
        jobCount: 1,
        lifetimeValue: price,
      });
    }
  }

  // ── Also pull addresses from the customers/customer_addresses tables (CRM imports) ──
  const crmRows = await db.select({
    customerId: customersTable.customerId,
    firstName: customersTable.firstName,
    lastName: customersTable.lastName,
    phone: customersTable.phone,
    email: customersTable.email,
    street: customerAddresses.street,
    city: customerAddresses.city,
    state: customerAddresses.state,
    zip: customerAddresses.zip,
  })
  .from(customersTable)
  .innerJoin(customerAddresses, and(
    eq(customerAddresses.customerId, customersTable.customerId),
    eq(customerAddresses.isDefault, 1),
    isNotNull(customerAddresses.street),
    ne(customerAddresses.street, ''),
  ));

  for (const c of crmRows) {
    const fullName = `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim();
    const key = getKey(c.phone, c.email, fullName);
    const addrParts = [c.street, c.city, c.state, c.zip].filter(Boolean);
    const addr = addrParts.join(', ');
    if (!addr) continue;
    if (!customerMap.has(key)) {
      customerMap.set(key, {
        customerId: c.customerId,
        fullName,
        address: addr,
        city: c.city ?? null,
        jobCount: 0,
        lifetimeValue: 0,
      });
    } else {
      const existing = customerMap.get(key)!;
      if (!existing.address) existing.address = addr;
    }
  }

  const entries = Array.from(customerMap.values()).filter(e => e.address);

  // Geocode addresses using cache
  // Strategy: always return all cached results immediately; geocode up to 50 new
  // addresses per call (at ~1 req/sec) so the map fills in progressively on each Refresh.
  const results: Array<Entry & { lat: number; lng: number }> = [];
  const crypto = await import('crypto');

  // Pre-compute hashes for all entries
  const entryHashes = entries.map(entry => ({
    entry,
    hash: crypto.createHash('md5').update(entry.address.toLowerCase().trim()).digest('hex'),
  }));

  // Bulk-fetch all cached hashes in chunked queries (500 at a time) to avoid MySQL IN() limits
  const allHashes = entryHashes.map(e => e.hash);
  const CHUNK_SIZE = 500;
  const cachedRows: Array<{ addressHash: string; lat: string; lng: string; address: string }> = [];
  for (let i = 0; i < allHashes.length; i += CHUNK_SIZE) {
    const chunk = allHashes.slice(i, i + CHUNK_SIZE);
    if (chunk.length === 0) continue;
    const rows = await db.select().from(geocodeCache)
      .where(sql`${geocodeCache.addressHash} IN (${sql.join(chunk.map(h => sql`${h}`), sql`, `)})`);
    cachedRows.push(...rows);
  }
  const cacheMap = new Map(cachedRows.map(r => [r.addressHash, r]));

  const toGeocode: typeof entryHashes = [];
  for (const { entry, hash } of entryHashes) {
    const cached = cacheMap.get(hash);
    if (cached) {
      results.push({ ...entry, lat: parseFloat(String(cached.lat)), lng: parseFloat(String(cached.lng)) });
    } else {
      toGeocode.push({ entry, hash });
    }
  }

  // Geocode up to 50 new addresses per call (progressive fill)
  const BATCH_LIMIT = 50;
  for (const { entry, hash } of toGeocode.slice(0, BATCH_LIMIT)) {
    try {
      const encoded = encodeURIComponent(entry.address);
      const geoRes = await fetch(
        `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=1`,
        { headers: { 'User-Agent': 'LuxuryWashOnWheels/1.0' }, signal: AbortSignal.timeout(5000) }
      );
      if (geoRes.ok) {
        const geoJson = await geoRes.json() as Array<{ lat: string; lon: string }>;
        if (geoJson.length > 0) {
          const lat = parseFloat(geoJson[0].lat);
          const lng = parseFloat(geoJson[0].lon);
          await db.insert(geocodeCache).values({
            addressHash: hash,
            address: entry.address,
            lat: String(lat),
            lng: String(lng),
          }).onDuplicateKeyUpdate({ set: { lat: String(lat), lng: String(lng) } });
          results.push({ ...entry, lat, lng });
        }
      }
    } catch {
      // Skip addresses that fail to geocode
    }
    // Respect Nominatim rate limit (1 req/sec)
    await new Promise(r => setTimeout(r, 1100));
  }

  return results;
}

// ─── Meeting Attendance ────────────────────────────────────────────────────────

/** Record that an employee attended the morning meeting for today */
export async function recordMeetingAttendance(employeeId: string, fullName: string, meetingDate: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const attendanceId = `ATT_${Date.now()}_${randomBytes(4).toString('hex')}`;
  // Use INSERT IGNORE to avoid duplicate errors if called twice
  await db.insert(meetingAttendance).values({
    attendanceId,
    employeeId,
    fullName,
    meetingDate,
  }).onDuplicateKeyUpdate({ set: { fullName } });
}

/** Get all attendance records for a specific meeting date */
export async function getMeetingAttendanceForDate(meetingDate: string): Promise<typeof meetingAttendance.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(meetingAttendance)
    .where(eq(meetingAttendance.meetingDate, meetingDate));
}

/** Check if a specific employee attended the meeting on a given date */
export async function didEmployeeAttendMeeting(employeeId: string, meetingDate: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: meetingAttendance.id })
    .from(meetingAttendance)
    .where(and(
      eq(meetingAttendance.employeeId, employeeId),
      eq(meetingAttendance.meetingDate, meetingDate),
    ))
    .limit(1);
  return rows.length > 0;
}

// ─── Employee Days Off ─────────────────────────────────────────────────────────

/** Assign a day off to a team member */
export async function assignDayOff(data: {
  employeeId: string;
  fullName: string;
  offDate: string; // YYYY-MM-DD
  reason?: "pto" | "sick" | "personal" | "other";
  notes?: string;
  assignedBy?: string;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const dayOffId = `DAYOFF_${Date.now()}_${randomBytes(4).toString('hex')}`;
  await db.insert(employeeDaysOff).values({
    dayOffId,
    employeeId: data.employeeId,
    fullName: data.fullName,
    offDate: data.offDate,
    reason: data.reason ?? "pto",
    notes: data.notes,
    assignedBy: data.assignedBy,
  });
  return dayOffId;
}

/** Remove a day off record by its ID */
export async function removeDayOff(dayOffId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(employeeDaysOff).where(eq(employeeDaysOff.dayOffId, dayOffId));
}

/** Get all days off for a specific employee */
export async function getDaysOffForEmployee(employeeId: string): Promise<typeof employeeDaysOff.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(employeeDaysOff)
    .where(eq(employeeDaysOff.employeeId, employeeId))
    .orderBy(employeeDaysOff.offDate);
}

/** Get all days off for a specific date (all team members off that day) */
export async function getDaysOffForDate(offDate: string): Promise<typeof employeeDaysOff.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(employeeDaysOff)
    .where(eq(employeeDaysOff.offDate, offDate))
    .orderBy(employeeDaysOff.fullName);
}

/** Get all upcoming days off (today and future) */
export async function getUpcomingDaysOff(): Promise<typeof employeeDaysOff.$inferSelect[]> {
  const db = await getDb();
  if (!db) return [];
  const today = todayCST();
  return db.select().from(employeeDaysOff)
    .where(gte(employeeDaysOff.offDate, today))
    .orderBy(employeeDaysOff.offDate, employeeDaysOff.fullName);
}

/** Check if a specific employee is off on a given date */
export async function isEmployeeOffOnDate(employeeId: string, offDate: string): Promise<boolean> {
  const db = await getDb();
  if (!db) return false;
  const rows = await db.select({ id: employeeDaysOff.id })
    .from(employeeDaysOff)
    .where(and(
      eq(employeeDaysOff.employeeId, employeeId),
      eq(employeeDaysOff.offDate, offDate),
    ))
    .limit(1);
  return rows.length > 0;
}

/**
 * Returns abandoned cart records that are still in "abandoned" status and
 * were created more than 30 minutes ago but less than 24 hours ago,
 * AND have not yet had a recovery message sent (recoverySmsSent is not set).
 * Used by the 30-minute recovery job.
 */
export async function getAbandonedCartsForRecovery(): Promise<Array<{
  bookingId: string;
  firstName: string;
  lastName: string;
  email: string | null;
  phone: string | null;
  location: string;
  vehicleType: string | null;
  packageType: string | null;
  streetAddress: string | null;
  unit: string | null;
  city: string | null;
  state: string | null;
  zipCode: string | null;
  createdAt: Date;
  pipelineNotes: string | null;
  resumeToken: string | null;
}>> {
  const db = await getDb();
  if (!db) return [];
  // Fetch records that are still "abandoned" and were created 30+ minutes ago
  // We use a raw SQL window to avoid needing a separate recoverySmsSent column —
  // instead we store a marker in pipelineNotes after sending.
  const cutoffMs = 30 * 60 * 1000; // 30 minutes
  const maxAgeMs = 24 * 60 * 60 * 1000; // 24 hours — don't retry after a day
  const now = new Date();
  const cutoffTime = new Date(now.getTime() - cutoffMs);
  const maxAgeTime = new Date(now.getTime() - maxAgeMs);
  const results = await (db.select({
    bookingId: onlineBookings.bookingId,
    firstName: onlineBookings.firstName,
    lastName: onlineBookings.lastName,
    email: onlineBookings.email,
    phone: onlineBookings.phone,
    location: onlineBookings.location,
    vehicleType: onlineBookings.vehicleType,
    packageType: onlineBookings.packageType,
    streetAddress: onlineBookings.streetAddress,
    unit: onlineBookings.unit,
    city: onlineBookings.city,
    state: onlineBookings.state,
    zipCode: onlineBookings.zipCode,
    createdAt: onlineBookings.createdAt,
    pipelineNotes: onlineBookings.pipelineNotes,
    resumeToken: onlineBookings.resumeToken,
  }) as any)
    .from(onlineBookings)
    .where(
      and(
        eq(onlineBookings.status, "abandoned"),
        lte(onlineBookings.createdAt, cutoffTime),
        gte(onlineBookings.createdAt, maxAgeTime),
      )
    )
    .orderBy(onlineBookings.createdAt);
  // Filter out any that already had recovery sent (marked in pipelineNotes)
  const notYetRecovered = results.filter((r: any) => !r.pipelineNotes?.includes("[recovery_sent]"));
  if (notYetRecovered.length === 0) return [];

  // Filter out customers who already have an active booking (same phone or email)
  // so we don't send recovery messages to people who already booked
  const phones = notYetRecovered.map((r: any) => r.phone?.replace(/\D/g, '').slice(-10)).filter(Boolean);
  const emails = notYetRecovered.map((r: any) => r.email?.toLowerCase().trim()).filter(Boolean);
  const activeBookings = await (db.select({
    phone: onlineBookings.phone,
    email: onlineBookings.email,
  }) as any)
    .from(onlineBookings)
    .where(
      and(
        sql`${onlineBookings.status} IN ('confirmed','pending','en_route','in_progress','completed','follow_up_sent')`,
      )
    );
  const activePhones = new Set<string>(activeBookings.map((b: any) => b.phone?.replace(/\D/g, '').slice(-10)).filter(Boolean));
  const activeEmails = new Set<string>(activeBookings.map((b: any) => b.email?.toLowerCase().trim()).filter(Boolean));

  // Also check customer_bookings (portal app bookings) by email via customers join
  const portalActiveBookings = emails.length > 0
    ? await (db.select({
        email: customersTable.email,
        phone: customersTable.phone,
      }) as any)
        .from(customerBookings)
        .leftJoin(customersTable, eq(customerBookings.customerId, customersTable.customerId))
        .where(
          and(
            sql`${customerBookings.status} IN ('pending','confirmed','en_route','arrived','in_progress','completed')`,
          )
        )
    : [];
  const portalActiveEmails = new Set<string>(portalActiveBookings.map((b: any) => b.email?.toLowerCase().trim()).filter(Boolean));
  const portalActivePhones = new Set<string>(portalActiveBookings.map((b: any) => b.phone?.replace(/\D/g, '').slice(-10)).filter(Boolean));

  return notYetRecovered.filter((r: any) => {
    const normPhone = r.phone?.replace(/\D/g, '').slice(-10) ?? '';
    const normEmail = r.email?.toLowerCase().trim() ?? '';
    const alreadyBooked =
      (normPhone && (activePhones.has(normPhone) || portalActivePhones.has(normPhone))) ||
      (normEmail && (activeEmails.has(normEmail) || portalActiveEmails.has(normEmail)));
    return !alreadyBooked;
  });
}

/**
 * Marks an abandoned cart as having had the recovery message sent.
 * Appends a marker to pipelineNotes so we don't send twice.
 */
export async function markAbandonedCartRecoverySent(bookingId: string, resumeToken?: string): Promise<void> {
  const db = await getDb();
  if (!db) return;
  const existing = await getBookingById(bookingId);
  const notes = existing?.pipelineNotes ?? "";
  const updated = notes ? `${notes}\n[recovery_sent] ${new Date().toISOString()}` : `[recovery_sent] ${new Date().toISOString()}`;
  const updateData: Record<string, unknown> = { pipelineNotes: updated };
  if (resumeToken) updateData.resumeToken = resumeToken;
  await (db.update(onlineBookings) as any)
    .set(updateData)
    .where(eq(onlineBookings.bookingId, bookingId));
}

/**
 * Look up an abandoned cart by its resume token.
 * Returns the cart data for pre-filling the booking form.
 */
export async function getAbandonedCartByResumeToken(token: string) {
  const db = await getDb();
  if (!db) return null;
  const results = await (db.select({
    bookingId: onlineBookings.bookingId,
    firstName: onlineBookings.firstName,
    lastName: onlineBookings.lastName,
    email: onlineBookings.email,
    phone: onlineBookings.phone,
    location: onlineBookings.location,
    vehicleType: onlineBookings.vehicleType,
    packageType: onlineBookings.packageType,
    streetAddress: onlineBookings.streetAddress,
    unit: onlineBookings.unit,
    city: onlineBookings.city,
    state: onlineBookings.state,
    zipCode: onlineBookings.zipCode,
    status: onlineBookings.status,
  }) as any)
    .from(onlineBookings)
    .where(eq(onlineBookings.resumeToken, token))
    .limit(1);
  return results.length > 0 ? results[0] : null;
}

/**
 * Returns abandoned cart conversion stats for the Pipeline screen.
 * Compares this week vs last week.
 */
/** Get the list of recovered abandoned cart customers (status converted) */
export async function getRecoveredCustomers(limit = 50): Promise<Array<{
  bookingId: string;
  firstName: string;
  lastName: string;
  phone: string | null;
  email: string | null;
  recoveredAt: Date | null;
  packageType: string | null;
  totalPrice: string | null;
}>> {
  const db = await getDb();
  if (!db) return [];
  const isConverted = ["confirmed", "en_route", "in_progress", "completed", "follow_up_sent"];
  const rows = await (db.select({
    bookingId: onlineBookings.bookingId,
    firstName: onlineBookings.firstName,
    lastName: onlineBookings.lastName,
    phone: onlineBookings.phone,
    email: onlineBookings.email,
    updatedAt: onlineBookings.updatedAt,
    packageType: onlineBookings.packageType,
    totalPrice: onlineBookings.totalPrice,
  }) as any)
    .from(onlineBookings)
    .where(and(
      sql`${onlineBookings.bookingId} LIKE 'ABANDONED-%'`,
      inArray(onlineBookings.status as any, isConverted)
    ))
    .orderBy(sql`${onlineBookings.updatedAt} DESC`)
    .limit(limit);
  return rows.map((r: any) => ({
    bookingId: r.bookingId,
    firstName: r.firstName ?? '',
    lastName: r.lastName ?? '',
    phone: r.phone ?? null,
    email: r.email ?? null,
    recoveredAt: r.updatedAt ?? null,
    packageType: r.packageType ?? null,
    totalPrice: r.totalPrice ?? null,
  }));
}

export async function getAbandonedCartConversionStats(): Promise<{
  today: { total: number; converted: number; rate: number };
  thisWeek: { total: number; converted: number; rate: number };
  thisMonth: { total: number; converted: number; rate: number };
  lastWeek: { total: number; converted: number; rate: number };
  allTime: { total: number; converted: number; rate: number };
}> {
  const db = await getDb();
  const empty = { total: 0, converted: 0, rate: 0 };
  if (!db) return { today: empty, thisWeek: empty, thisMonth: empty, lastWeek: empty, allTime: empty };

  const now = new Date();
  // Today boundaries (CST)
  const todayStart = new Date(now); todayStart.setHours(0,0,0,0);
  // Week boundaries (Monday-based)
  const dayOfWeek = now.getDay(); // 0=Sun
  const daysToMon = (dayOfWeek + 6) % 7;
  const thisMonday = new Date(now); thisMonday.setDate(now.getDate() - daysToMon); thisMonday.setHours(0,0,0,0);
  const lastMonday = new Date(thisMonday); lastMonday.setDate(thisMonday.getDate() - 7);
  const lastSunday = new Date(thisMonday); lastSunday.setDate(thisMonday.getDate() - 1); lastSunday.setHours(23,59,59,999);
  // Month boundaries
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);

  // All abandoned carts (ever created with bookingId starting with ABANDONED-)
  const allRows = await (db.select({
    bookingId: onlineBookings.bookingId,
    status: onlineBookings.status,
    createdAt: onlineBookings.createdAt,
  }) as any)
    .from(onlineBookings)
    .where(sql`${onlineBookings.bookingId} LIKE 'ABANDONED-%'`);

  const isConverted = (status: string) =>
    ["confirmed", "en_route", "in_progress", "completed", "follow_up_sent"].includes(status);

  const todayRows = allRows.filter((r: any) => r.createdAt >= todayStart);
  const thisWeekRows = allRows.filter((r: any) => r.createdAt >= thisMonday);
  const thisMonthRows = allRows.filter((r: any) => r.createdAt >= monthStart);
  const lastWeekRows = allRows.filter((r: any) => r.createdAt >= lastMonday && r.createdAt <= lastSunday);

  const calcRate = (rows: any[]) => {
    const total = rows.length;
    const converted = rows.filter((r: any) => isConverted(r.status)).length;
    return { total, converted, rate: total > 0 ? Math.round((converted / total) * 100) : 0 };
  };

  return {
    today: calcRate(todayRows),
    thisWeek: calcRate(thisWeekRows),
    thisMonth: calcRate(thisMonthRows),
    lastWeek: calcRate(lastWeekRows),
    allTime: calcRate(allRows),
  };
}

// ─── Shared Package Name Resolver ────────────────────────────────────────────
/**
 * Resolve a packageType / serviceId string to a human-readable service name.
 * Checks the static legacy map first, then falls back to a DB lookup for
 * dynamic `pb_` IDs (e.g. "pb_mpn0yohe0qes" → "VIP").
 */
export async function resolvePackageNameAsync(packageType: string | null | undefined): Promise<string> {
  if (!packageType) return "Detail Service";
  const staticMap: Record<string, string> = {
    pb_basic: "Basic Detail",
    pb_full: "Full Detail",
    pb_luxury: "Luxury Detail",
    pb_interior: "Interior Detail",
    pb_exterior: "Exterior Detail",
    pb_vip: "VIP",
    pb_express: "Express Detail",
    pb_premium: "Premium Detail",
    pb_rv_wash: "RV Wash",
    pb_rv_maintenance: "RV Maintenance",
    pb_rv_paint_sealant: "RV Paint Sealant",
    // Dynamic pricebook IDs — add new ones here when created
    pb_mpn0yohe0qes: "VIP",
    pb_mpssufsvme94: "Maintenance Program",
    pb_mpws9prd5cu1: "VIP Renewal",
    interior: "Interior Detail",
    exterior: "Exterior Detail",
    luxury: "Luxury Detail",
    full: "Full Detail",
    basic: "Basic Detail",
    vip: "VIP",
    full_detail: "Full Detail",
    basic_detail: "Basic Detail",
    interior_detail: "Interior Detail",
    exterior_detail: "Exterior Detail",
    luxury_detail: "Luxury Detail",
  };
  const key = packageType.toLowerCase().replace(/[^a-z0-9_]/g, "");
  if (staticMap[key]) return staticMap[key];
  if (staticMap[packageType]) return staticMap[packageType];
  // Dynamic pb_ ID — look up in price_book_services table
  if (packageType.startsWith("pb_")) {
    try {
      const dbInst = await getDb();
      if (dbInst) {
        const rows = await dbInst.select({ name: priceBookServices.name })
          .from(priceBookServices)
          .where(eq(priceBookServices.serviceId, packageType))
          .limit(1);
        if (rows.length > 0 && rows[0].name) return rows[0].name;
      }
    } catch { /* fallback */ }
  }
  return packageType;
}

// ─── Admin Timesheet Helpers ──────────────────────────────────────────────────

/** Admin: insert a new clock record (time slot) for any employee on any date */
export async function adminAddClockRecord(data: {
  employeeId: string;
  fullName: string;
  date: string; // YYYY-MM-DD
  clockInTime: Date;
  clockOutTime?: Date;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { nanoid } = await import("nanoid");
  const recordId = `CLOCK_ADM_${nanoid(10)}`;
  let totalHours: string | undefined;
  if (data.clockOutTime) {
    const hrs = (data.clockOutTime.getTime() - data.clockInTime.getTime()) / (1000 * 60 * 60);
    totalHours = hrs.toFixed(2);
  }
  await db.insert(clockInOutRecords).values({
    recordId,
    employeeId: data.employeeId,
    fullName: data.fullName,
    date: data.date,
    clockInTime: data.clockInTime,
    clockOutTime: data.clockOutTime ?? null,
    totalHours: totalHours ?? "0",
    status: data.clockOutTime ? "clocked_out" : "clocked_in",
  });
  return { recordId };
}

/** Admin: delete a clock record by recordId */
export async function adminDeleteClockRecord(recordId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(clockInOutRecords).where(eq(clockInOutRecords.recordId, recordId));
}

/** Admin: add a break record for any employee on any date */
export async function adminAddBreak(data: {
  employeeId: string;
  fullName: string;
  date: string; // YYYY-MM-DD
  breakType: "morning_15min" | "afternoon_15min" | "lunch_30min";
  breakStartTime?: Date;
  breakEndTime?: Date;
  status: "pending" | "taken" | "skipped";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const { nanoid } = await import("nanoid");
  const breakId = `BREAK_ADM_${nanoid(10)}`;
  const durationMinutes = data.breakType === "lunch_30min" ? 30 : 15;
  await db.insert(breakRecords).values({
    breakId,
    employeeId: data.employeeId,
    fullName: data.fullName,
    date: data.date,
    breakType: data.breakType,
    durationMinutes,
    status: data.status,
    breakStartTime: data.breakStartTime ?? null,
    breakEndTime: data.breakEndTime ?? null,
    notificationSent: "no",
  });
  return { breakId };
}

/** Admin: update break times and/or status */
export async function adminUpdateBreak(breakId: string, updates: {
  breakStartTime?: Date;
  breakEndTime?: Date;
  status?: "pending" | "taken" | "skipped";
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (updates.breakStartTime !== undefined) set.breakStartTime = updates.breakStartTime;
  if (updates.breakEndTime !== undefined) set.breakEndTime = updates.breakEndTime;
  if (updates.status !== undefined) set.status = updates.status;
  await db.update(breakRecords).set(set as any).where(eq(breakRecords.breakId, breakId));
}

/** Admin: delete a break record */
export async function adminDeleteBreak(breakId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(breakRecords).where(eq(breakRecords.breakId, breakId));
}

/** Get all schedule blockers for a specific date and city (accepts slug or full label) */
export async function getBlockersForDate(citySlugOrLabel: string, date: string): Promise<{ detailerName: string; startHour: number; endHour: number; allDay: boolean }[]> {
  const db = await getDb();
  if (!db) return [];
  const CITY_SLUG_TO_LABEL: Record<string, string> = {
    fwb: 'Fort Walton Beach',
    crestview: 'Crestview',
    niceville: 'Niceville',
    destin: 'Destin',
    pensacola: 'Pensacola',
  };
  const normalizedCity = CITY_SLUG_TO_LABEL[citySlugOrLabel.toLowerCase()] ?? citySlugOrLabel;
  const { scheduleBlockers } = await import('../drizzle/schema');
  const rows = await db.select({
    detailerName: scheduleBlockers.detailerName,
    startHour: scheduleBlockers.startHour,
    endHour: scheduleBlockers.endHour,
    allDay: scheduleBlockers.allDay,
  }).from(scheduleBlockers)
    .where(and(
      sql`DATE(${scheduleBlockers.date}) = ${date}`,
      or(
        eq(scheduleBlockers.city, normalizedCity),
        eq(scheduleBlockers.city, citySlugOrLabel)
      )
    ));
  return rows.map(r => ({
    detailerName: r.detailerName ?? '',
    startHour: parseFloat(String(r.startHour ?? 0)),
    endHour: parseFloat(String(r.endHour ?? 24)),
    allDay: Boolean(r.allDay),
  }));
}

/** Admin: update customer contact info across all tables (scheduleJobs, onlineBookings, customerAttachments, estimates) */
export async function updateCustomerContactInfo(params: {
  /** The original identifier used to find the customer's records */
  phone: string | null;
  email: string | null;
  name: string;
  /** New values to set */
  newName: string;
  newPhone: string | null;
  newEmail: string | null;
  newAddress: string | null;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const { phone, email, name, newName, newPhone, newEmail, newAddress } = params;

  // Build a WHERE condition that matches by phone OR email OR name
  const buildWhere = (nameCol: any, phoneCol: any, emailCol: any) => {
    const conditions: any[] = [];
    if (phone) conditions.push(eq(phoneCol, phone));
    if (email) conditions.push(eq(emailCol, email));
    if (!phone && !email && name) conditions.push(eq(nameCol, name));
    if (conditions.length === 0) return eq(nameCol, name);
    const { or } = require('drizzle-orm');
    return conditions.length === 1 ? conditions[0] : or(...conditions);
  };

  const { scheduleJobs, onlineBookings, customerAttachments, estimates } = await import('../drizzle/schema');

  // Build match conditions for each table
  const jobsWhere = (() => {
    const conds: any[] = [];
    if (phone) conds.push(eq(scheduleJobs.customerPhone, phone));
    if (email) conds.push(eq(scheduleJobs.customerEmail, email));
    if (!phone && !email) conds.push(eq(scheduleJobs.customerName, name));
    return conds.length === 1 ? conds[0] : or(...conds);
  })();

  // online_bookings uses phone/email columns (not customerPhone/customerEmail)
  const bookingsWhere = (() => {
    const conds: any[] = [];
    if (phone) conds.push(eq(onlineBookings.phone, phone));
    if (email) conds.push(eq(onlineBookings.email, email));
    // online_bookings has no customerName column — fall back to email if nothing else
    if (conds.length === 0) return eq(onlineBookings.email, email ?? '');
    return conds.length === 1 ? conds[0] : or(...conds);
  })();

  const attachmentsWhere = (() => {
    const conds: any[] = [];
    if (phone) conds.push(eq(customerAttachments.customerPhone, phone));
    if (email) conds.push(eq(customerAttachments.customerEmail, email));
    if (!phone && !email) conds.push(eq(customerAttachments.customerName, name));
    return conds.length === 1 ? conds[0] : or(...conds);
  })();

  const estimatesWhere = (() => {
    const conds: any[] = [];
    if (phone) conds.push(eq(estimates.customerPhone, phone));
    if (email) conds.push(eq(estimates.customerEmail, email));
    if (!phone && !email) conds.push(eq(estimates.customerName, name));
    return conds.length === 1 ? conds[0] : or(...conds);
  })();

  const jobsSet: any = { customerName: newName };
  if (newPhone !== undefined) jobsSet.customerPhone = newPhone;
  if (newEmail !== undefined) jobsSet.customerEmail = newEmail;
  if (newAddress !== undefined) jobsSet.customerAddress = newAddress;

  // online_bookings uses firstName/lastName/phone/email — not customerName/customerPhone/customerEmail
  const nameParts = newName.trim().split(/\s+/);
  const newFirstName = nameParts[0] ?? '';
  const newLastName = nameParts.slice(1).join(' ') || '';
  const bookingsSet: any = { firstName: newFirstName, lastName: newLastName };
  if (newPhone !== undefined) bookingsSet.phone = newPhone;
  if (newEmail !== undefined) bookingsSet.email = newEmail;

  const attachmentsSet: any = { customerName: newName };
  if (newPhone !== undefined) attachmentsSet.customerPhone = newPhone;
  if (newEmail !== undefined) attachmentsSet.customerEmail = newEmail;

  const estimatesSet: any = { customerName: newName };
  if (newPhone !== undefined) estimatesSet.customerPhone = newPhone;
  if (newEmail !== undefined) estimatesSet.customerEmail = newEmail;
  if (newAddress !== undefined) estimatesSet.customerAddress = newAddress;

  // Also update the customers portal table so name/phone/email changes are reflected in the app
  const { customers: customersTable } = await import('../drizzle/schema');
  const customerPortalUpdates: any[] = [];
  const customersSet: any = { firstName: newFirstName, lastName: newLastName };
  if (newPhone !== undefined && newPhone !== null) customersSet.phone = newPhone;
  // IMPORTANT: also sync the email so portal login works after an admin email update
  if (newEmail !== undefined && newEmail !== null) customersSet.email = newEmail;
  if (email) {
    customerPortalUpdates.push(
      db.update(customersTable).set(customersSet).where(eq(customersTable.email, email))
    );
  } else if (phone) {
    customerPortalUpdates.push(
      db.update(customersTable).set(customersSet).where(eq(customersTable.phone, phone))
    );
  }

  await Promise.all([
    db.update(scheduleJobs).set(jobsSet).where(jobsWhere),
    db.update(onlineBookings).set(bookingsSet).where(bookingsWhere),
    db.update(customerAttachments).set(attachmentsSet).where(attachmentsWhere),
    db.update(estimates).set(estimatesSet).where(estimatesWhere),
    ...customerPortalUpdates,
  ]);

  return { success: true };
}

// ─── Standalone Invoices ──────────────────────────────────────────────────────
function siId() { return `INV-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`; }
function liId() { return `LI-${Date.now()}-${Math.random().toString(36).slice(2, 7).toUpperCase()}`; }

/** Generate the next invoice number (INV-YYYYMMDD-NNN) */
async function nextInvoiceNumber(): Promise<string> {
  const db = await getDb();
  if (!db) return `INV-${Date.now()}`;
  const today = new Date().toISOString().slice(0, 10).replace(/-/g, "");
  const rows = await db.select({ n: standaloneInvoices.invoiceNumber })
    .from(standaloneInvoices)
    .where(like(standaloneInvoices.invoiceNumber, `INV-${today}-%`));
  const seq = (rows.length + 1).toString().padStart(3, "0");
  return `INV-${today}-${seq}`;
}

export async function createStandaloneInvoice(data: {
  customerName: string;
  customerEmail?: string;
  customerPhone?: string;
  notes?: string;
  taxRate?: number;
  discountAmount?: number;
  dueDate?: string;
  createdBy?: string;
  lineItems: { description: string; quantity: number; unitPrice: number }[];
}): Promise<StandaloneInvoice> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const invoiceId = siId();
  const invoiceNumber = await nextInvoiceNumber();
  const taxRate = data.taxRate ?? 0;
  const discountAmount = data.discountAmount ?? 0;
  const subtotal = data.lineItems.reduce((s, li) => s + li.quantity * li.unitPrice, 0);
  const taxAmount = subtotal * (taxRate / 100);
  const totalAmount = Math.max(0, subtotal + taxAmount - discountAmount);

  await db.insert(standaloneInvoices).values({
    invoiceId,
    invoiceNumber,
    customerName: data.customerName,
    customerEmail: data.customerEmail ?? null,
    customerPhone: data.customerPhone ?? null,
    notes: data.notes ?? null,
    subtotal: subtotal.toFixed(2) as any,
    taxRate: taxRate.toFixed(2) as any,
    taxAmount: taxAmount.toFixed(2) as any,
    discountAmount: discountAmount.toFixed(2) as any,
    totalAmount: totalAmount.toFixed(2) as any,
    amountPaid: "0" as any,
    status: "draft",
    dueDate: data.dueDate ?? null,
    createdBy: data.createdBy ?? null,
  });

  // Insert line items
  for (let i = 0; i < data.lineItems.length; i++) {
    const li = data.lineItems[i];
    await db.insert(invoiceLineItems).values({
      lineId: liId(),
      invoiceId,
      description: li.description,
      quantity: li.quantity.toFixed(2) as any,
      unitPrice: li.unitPrice.toFixed(2) as any,
      lineTotal: (li.quantity * li.unitPrice).toFixed(2) as any,
      sortOrder: i,
    });
  }

  const [created] = await db.select().from(standaloneInvoices).where(eq(standaloneInvoices.invoiceId, invoiceId));
  return created;
}

export async function getAllStandaloneInvoices(search?: string): Promise<(StandaloneInvoice & { lineItems: InvoiceLineItem[] })[]> {
  const db = await getDb();
  if (!db) return [];
  let query = db.select().from(standaloneInvoices).$dynamic();
  if (search) {
    query = query.where(like(standaloneInvoices.customerName, `%${search}%`));
  }
  const invoices = await query.orderBy(desc(standaloneInvoices.createdAt));
  const result: (StandaloneInvoice & { lineItems: InvoiceLineItem[] })[] = [];
  for (const inv of invoices) {
    const lines = await db.select().from(invoiceLineItems)
      .where(eq(invoiceLineItems.invoiceId, inv.invoiceId))
      .orderBy(invoiceLineItems.sortOrder);
    result.push({ ...inv, lineItems: lines });
  }
  return result;
}

export async function getStandaloneInvoiceById(invoiceId: string): Promise<(StandaloneInvoice & { lineItems: InvoiceLineItem[] }) | null> {
  const db = await getDb();
  if (!db) return null;
  const [inv] = await db.select().from(standaloneInvoices).where(eq(standaloneInvoices.invoiceId, invoiceId));
  if (!inv) return null;
  const lines = await db.select().from(invoiceLineItems)
    .where(eq(invoiceLineItems.invoiceId, invoiceId))
    .orderBy(invoiceLineItems.sortOrder);
  return { ...inv, lineItems: lines };
}

export async function updateStandaloneInvoiceStatus(
  invoiceId: string,
  status: "draft" | "sent" | "paid" | "partial" | "void",
  extra?: { sentAt?: Date; paidAt?: Date; amountPaid?: number; paymentMethod?: string; paymentNote?: string }
): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  const upd: Partial<InsertStandaloneInvoice> = { status };
  if (extra?.sentAt) upd.sentAt = extra.sentAt;
  if (extra?.paidAt) upd.paidAt = extra.paidAt;
  if (extra?.amountPaid != null) upd.amountPaid = extra.amountPaid.toFixed(2) as any;
  if (extra?.paymentMethod) upd.paymentMethod = extra.paymentMethod;
  if (extra?.paymentNote) upd.paymentNote = extra.paymentNote;
  await db.update(standaloneInvoices).set(upd).where(eq(standaloneInvoices.invoiceId, invoiceId));
}

export async function deleteStandaloneInvoice(invoiceId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(invoiceLineItems).where(eq(invoiceLineItems.invoiceId, invoiceId));
  await db.delete(standaloneInvoices).where(eq(standaloneInvoices.invoiceId, invoiceId));
}

// ── Address Location Photos ──────────────────────────────────────────────────

export async function getAddressPhotosByKey(addressKey: string): Promise<AddressPhoto[]> {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(addressPhotos).where(eq(addressPhotos.addressKey, addressKey)).orderBy(addressPhotos.createdAt);
}

export async function addAddressPhoto(data: {
  addressKey: string;
  photoUrl: string;
  caption?: string;
  uploadedBy?: string;
  uploadedByRole?: string;
}): Promise<{ success: boolean; error?: string; photos?: AddressPhoto[] }> {
  const db = await getDb();
  if (!db) return { success: false, error: "Database not available" };
  const existing = await db.select().from(addressPhotos).where(eq(addressPhotos.addressKey, data.addressKey));
  if (existing.length >= 2) return { success: false, error: "Maximum 2 photos per address." };
  const photoId = `AP-${randomBytes(6).toString("hex").toUpperCase()}`;
  await db.insert(addressPhotos).values({ photoId, ...data });
  const updated = await db.select().from(addressPhotos).where(eq(addressPhotos.addressKey, data.addressKey)).orderBy(addressPhotos.createdAt);
  return { success: true, photos: updated };
}

export async function deleteAddressPhoto(photoId: string): Promise<void> {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(addressPhotos).where(eq(addressPhotos.photoId, photoId));
}
