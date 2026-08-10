// Investor Portal DB helpers
import { drizzle } from "drizzle-orm/mysql2";
import {
  investors, investorSessions, investments, investmentPayments,
  investorDocuments, investorUpdates, investorSupportRequests, investorAuditLog,
  investorInquiries,
} from "../drizzle/schema";
import { eq, desc } from "drizzle-orm";
import crypto from "crypto";

let _db: ReturnType<typeof drizzle> | null = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try { _db = drizzle(process.env.DATABASE_URL); } catch { _db = null; }
  }
  return _db;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────
export function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}
export function hashPassword(password: string): string {
  return crypto.createHash("sha256").update(password + "lw_salt_2024").digest("hex");
}
export function genToken(): string {
  return crypto.randomBytes(48).toString("hex");
}

// ─── Auth ─────────────────────────────────────────────────────────────────────
export async function getInvestorByEmail(email: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(investors).where(eq(investors.email, email.toLowerCase())).limit(1);
  return rows[0] ?? null;
}

export async function getInvestorById(investorId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(investors).where(eq(investors.investorId, investorId)).limit(1);
  return rows[0] ?? null;
}

export async function createInvestorSession(investorId: string): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const token = genToken();
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000); // 30 days
  await db.insert(investorSessions).values({ sessionToken: token, investorId, expiresAt });
  await db.update(investors).set({ lastLoginAt: new Date() }).where(eq(investors.investorId, investorId));
  return token;
}

export async function getInvestorBySession(token: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(investorSessions).where(eq(investorSessions.sessionToken, token)).limit(1);
  const session = rows[0];
  if (!session) return null;
  if (new Date(session.expiresAt) < new Date()) return null;
  return getInvestorById(session.investorId);
}

export async function deleteInvestorSession(token: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(investorSessions).where(eq(investorSessions.sessionToken, token));
}

// ─── Investors CRUD ───────────────────────────────────────────────────────────
export async function createInvestor(data: {
  firstName: string; lastName: string; email: string; phone?: string; password: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const investorId = genId("inv");
  await db.insert(investors).values({
    investorId,
    firstName: data.firstName,
    lastName: data.lastName,
    email: data.email.toLowerCase(),
    phone: data.phone,
    passwordHash: hashPassword(data.password),
    accountStatus: "active",
  });
  return investorId;
}

export async function updateInvestor(investorId: string, data: {
  firstName?: string; lastName?: string; email?: string; phone?: string;
  accountStatus?: "active" | "pending" | "suspended" | "closed"; password?: string;
}) {
  const db = await getDb();
  if (!db) return;
  const updates: Record<string, unknown> = {};
  if (data.firstName !== undefined) updates.firstName = data.firstName;
  if (data.lastName !== undefined) updates.lastName = data.lastName;
  if (data.email !== undefined) updates.email = data.email.toLowerCase();
  if (data.phone !== undefined) updates.phone = data.phone;
  if (data.accountStatus !== undefined) updates.accountStatus = data.accountStatus;
  if (data.password !== undefined) updates.passwordHash = hashPassword(data.password);
  if (Object.keys(updates).length > 0) {
    await db.update(investors).set(updates as any).where(eq(investors.investorId, investorId));
  }
}

export async function listAllInvestors() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investors).orderBy(desc(investors.createdAt));
}

// ─── Investments CRUD ─────────────────────────────────────────────────────────
export async function createInvestment(data: {
  investorId: string; investmentAmount: string; investmentDate: string;
  loanTermMonths?: number; repaymentType?: string; agreedReturnAmount?: string;
  totalRepaymentAmount?: string; totalPaymentsExpected?: number;
  status?: "pending_funding" | "active" | "repayment_in_progress" | "paid_in_full" | "delayed" | "document_pending" | "closed";
  notes?: string; adminNotes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const investmentId = genId("invst");
  await db.insert(investments).values({
    investmentId,
    investorId: data.investorId,
    investmentAmount: data.investmentAmount,
    investmentDate: data.investmentDate,
    loanTermMonths: data.loanTermMonths,
    repaymentType: data.repaymentType ?? "monthly",
    agreedReturnAmount: data.agreedReturnAmount,
    totalRepaymentAmount: data.totalRepaymentAmount,
    totalPaymentsExpected: data.totalPaymentsExpected,
    status: data.status ?? "pending_funding",
    notes: data.notes,
    adminNotes: data.adminNotes,
  });
  return investmentId;
}

export async function updateInvestment(investmentId: string, data: {
  investmentAmount?: string; investmentDate?: string; loanTermMonths?: number;
  repaymentType?: string; agreedReturnAmount?: string; totalRepaymentAmount?: string;
  totalPaymentsExpected?: number;
  status?: "pending_funding" | "active" | "repayment_in_progress" | "paid_in_full" | "delayed" | "document_pending" | "closed";
  notes?: string; adminNotes?: string;
}) {
  const db = await getDb();
  if (!db) return;
  const updates: Record<string, unknown> = {};
  const fields = ["investmentAmount","investmentDate","loanTermMonths","repaymentType","agreedReturnAmount","totalRepaymentAmount","totalPaymentsExpected","status","notes","adminNotes"] as const;
  for (const f of fields) if (data[f] !== undefined) updates[f] = data[f];
  if (Object.keys(updates).length > 0) {
    await db.update(investments).set(updates as any).where(eq(investments.investmentId, investmentId));
  }
}

export async function getInvestmentsByInvestor(investorId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investments).where(eq(investments.investorId, investorId)).orderBy(desc(investments.createdAt));
}

export async function getInvestmentById(investmentId: string) {
  const db = await getDb();
  if (!db) return null;
  const rows = await db.select().from(investments).where(eq(investments.investmentId, investmentId)).limit(1);
  return rows[0] ?? null;
}

export async function listAllInvestments() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investments).orderBy(desc(investments.createdAt));
}

// ─── Payments CRUD ────────────────────────────────────────────────────────────
export async function createPayment(data: {
  investmentId: string; dueDate?: string; paidDate?: string;
  amountDue: string; amountPaid?: string;
  status?: "scheduled" | "pending" | "completed" | "missed" | "delayed";
  paymentMethod?: string; referenceNumber?: string; adminNotes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const paymentId = genId("pmt");
  const effectiveStatus = data.status ?? "scheduled";
  // If payment is completed but amountPaid not specified, default to amountDue
  const effectiveAmountPaid = data.amountPaid ?? (effectiveStatus === "completed" ? data.amountDue : undefined);
  await db.insert(investmentPayments).values({
    paymentId,
    investmentId: data.investmentId,
    dueDate: data.dueDate,
    paidDate: data.paidDate,
    amountDue: data.amountDue,
    amountPaid: effectiveAmountPaid,
    status: effectiveStatus,
    paymentMethod: data.paymentMethod,
    referenceNumber: data.referenceNumber,
    adminNotes: data.adminNotes,
  });
  return paymentId;
}

export async function updatePayment(paymentId: string, data: {
  dueDate?: string; paidDate?: string; amountDue?: string; amountPaid?: string;
  status?: "scheduled" | "pending" | "completed" | "missed" | "delayed";
  paymentMethod?: string; referenceNumber?: string; adminNotes?: string;
}) {
  const db = await getDb();
  if (!db) return;
  const updates: Record<string, unknown> = {};
  const fields = ["dueDate","paidDate","amountDue","amountPaid","status","paymentMethod","referenceNumber","adminNotes"] as const;
  for (const f of fields) if (data[f] !== undefined) updates[f] = data[f];
  if (Object.keys(updates).length > 0) {
    await db.update(investmentPayments).set(updates as any).where(eq(investmentPayments.paymentId, paymentId));
  }
}

export async function getPaymentsByInvestment(investmentId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investmentPayments).where(eq(investmentPayments.investmentId, investmentId)).orderBy(desc(investmentPayments.createdAt));
}

export async function getRepaymentSummary(investmentId: string) {
  const payments = await getPaymentsByInvestment(investmentId);
  const completed = payments.filter((p) => p.status === "completed");
  const amountPaid = completed.reduce((sum: number, p) => sum + parseFloat(p.amountPaid ?? "0"), 0);
  return { payments, amountPaid, completedCount: completed.length };
}

// ─── Documents ────────────────────────────────────────────────────────────────
export async function createDocument(data: {
  investorId: string; investmentId?: string; documentTitle: string;
  documentType: "agreement" | "promissory_note" | "receipt" | "statement" | "tax_document" | "company_update" | "other";
  fileKey: string; fileUrl?: string; uploadedBy?: string;
  visibilityStatus?: "visible" | "hidden";
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const documentId = genId("doc");
  await db.insert(investorDocuments).values({
    documentId,
    investorId: data.investorId,
    investmentId: data.investmentId,
    documentTitle: data.documentTitle,
    documentType: data.documentType,
    fileKey: data.fileKey,
    fileUrl: data.fileUrl,
    uploadedBy: data.uploadedBy,
    visibilityStatus: data.visibilityStatus ?? "visible",
  });
  return documentId;
}

export async function getDocumentsByInvestor(investorId: string, includeHidden = false) {
  const db = await getDb();
  if (!db) return [];
  const rows = await db.select().from(investorDocuments)
    .where(eq(investorDocuments.investorId, investorId))
    .orderBy(desc(investorDocuments.uploadedAt));
  return includeHidden ? rows : rows.filter((d) => d.visibilityStatus === "visible");
}

export async function updateDocumentVisibility(documentId: string, visibilityStatus: "visible" | "hidden") {
  const db = await getDb();
  if (!db) return;
  await db.update(investorDocuments).set({ visibilityStatus }).where(eq(investorDocuments.documentId, documentId));
}

export async function deleteDocument(documentId: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(investorDocuments).where(eq(investorDocuments.documentId, documentId));
}

// ─── Investor Updates ─────────────────────────────────────────────────────────
export async function createInvestorUpdate(data: {
  title: string; body: string;
  category?: "business_progress" | "fleet_expansion" | "revenue_milestone" | "repayment_update" | "important_notice" | "general";
  createdBy?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const updateId = genId("upd");
  await db.insert(investorUpdates).values({
    updateId,
    title: data.title,
    body: data.body,
    category: data.category ?? "general",
    visibility: "all_investors",
    publishedAt: new Date(),
    createdBy: data.createdBy,
  });
  return updateId;
}

export async function listInvestorUpdates() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investorUpdates).orderBy(desc(investorUpdates.publishedAt));
}

export async function listAllInvestorUpdates() {
  return listInvestorUpdates();
}

export async function deleteInvestorUpdate(updateId: string) {
  const db = await getDb();
  if (!db) return;
  await db.delete(investorUpdates).where(eq(investorUpdates.updateId, updateId));
}

// ─── Support Requests ─────────────────────────────────────────────────────────
export async function createSupportRequest(data: {
  investorId: string; subject: string; messageBody: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const requestId = genId("sup");
  await db.insert(investorSupportRequests).values({
    requestId,
    investorId: data.investorId,
    subject: data.subject,
    messageBody: data.messageBody,
    status: "open",
  });
  return requestId;
}

export async function getSupportRequestsByInvestor(investorId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investorSupportRequests)
    .where(eq(investorSupportRequests.investorId, investorId))
    .orderBy(desc(investorSupportRequests.createdAt));
}

export async function listAllSupportRequests() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investorSupportRequests).orderBy(desc(investorSupportRequests.createdAt));
}

export async function respondToSupportRequest(requestId: string, data: {
  adminResponse: string; respondedBy: string;
  status?: "open" | "in_review" | "resolved";
}) {
  const db = await getDb();
  if (!db) return;
  await db.update(investorSupportRequests).set({
    adminResponse: data.adminResponse,
    respondedBy: data.respondedBy,
    respondedAt: new Date(),
    status: data.status ?? "resolved",
  }).where(eq(investorSupportRequests.requestId, requestId));
}


// ─── Audit Log ────────────────────────────────────────────────────────────────
export async function addAuditLog(data: {
  actorId: string; actorName?: string; actionType: string;
  recordType: string; recordId?: string; metadata?: Record<string, unknown>;
}) {
  const db = await getDb();
  if (!db) return;
  await db.insert(investorAuditLog).values({
    actorId: data.actorId,
    actorName: data.actorName,
    actionType: data.actionType,
    recordType: data.recordType,
    recordId: data.recordId,
    metadata: data.metadata ? JSON.stringify(data.metadata) : undefined,
  });
}

export async function getAuditLog(limit = 100) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investorAuditLog).orderBy(desc(investorAuditLog.createdAt)).limit(limit);
}

// ─── Investor Inquiries (Lead Capture) ───────────────────────────────────────
export async function createInvestorInquiry(data: {
  fullName: string; email: string; phone?: string;
  investmentInterest?: string; message?: string;
}): Promise<string> {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const inquiryId = genId("inq");
  await db.insert(investorInquiries).values({
    inquiryId,
    fullName: data.fullName,
    email: data.email.toLowerCase(),
    phone: data.phone ?? null,
    investmentInterest: data.investmentInterest ?? null,
    message: data.message ?? null,
  });
  return inquiryId;
}

export async function listAllInvestorInquiries() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(investorInquiries).orderBy(desc(investorInquiries.createdAt));
}

export async function updateInvestorInquiryStatus(
  inquiryId: string,
  data: { status?: string; adminNotes?: string }
) {
  const db = await getDb();
  if (!db) return;
  const updates: Record<string, unknown> = {};
  if (data.status) updates.status = data.status;
  if (data.adminNotes !== undefined) updates.adminNotes = data.adminNotes;
  if (Object.keys(updates).length > 0) {
    await db.update(investorInquiries).set(updates).where(eq(investorInquiries.inquiryId, inquiryId));
  }
}
