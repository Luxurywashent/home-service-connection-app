import { eq, and, desc, asc, sql, gte, lte, like } from "drizzle-orm";
import { getDb } from "./db";
import {
  financeCategories, financeTransactions, financeAssets, financeLiabilities, financeEquity, financeVendors, financeCities,
  expenseSubmissions, employees,
  type InsertFinanceCategory, type InsertFinanceTransaction, type InsertFinanceAsset,
  type InsertFinanceLiability, type InsertFinanceEquity,
} from "../drizzle/schema";
import { randomBytes } from "crypto";

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

// ─── Default Categories ────────────────────────────────────────────────────────
const DEFAULT_EXPENSE_CATS = ["Fuel", "Chemicals", "Payroll", "Marketing", "Equipment", "Maintenance", "Miscellaneous"];
const DEFAULT_INCOME_CATS = ["Detail Services", "VIP Memberships", "Fleet Accounts", "Other"];

export async function ensureDefaultCategories() {
  const db = await getDb();
  if (!db) return;
  const existing = await db.select({ name: financeCategories.name }).from(financeCategories);
  const existingNames = new Set(existing.map((c) => c.name.toLowerCase()));
  let order = existing.length;
  for (const name of DEFAULT_EXPENSE_CATS) {
    if (!existingNames.has(name.toLowerCase())) {
      await db.insert(financeCategories).values({ categoryId: genId("FCAT"), type: "expense", name, sortOrder: ++order });
    }
  }
  for (const name of DEFAULT_INCOME_CATS) {
    if (!existingNames.has(name.toLowerCase())) {
      await db.insert(financeCategories).values({ categoryId: genId("FCAT"), type: "income", name, sortOrder: ++order });
    }
  }
}

// ─── Categories ───────────────────────────────────────────────────────────────
export async function getAllFinanceCategories() {
  const db = await getDb();
  if (!db) return [];
  await ensureDefaultCategories();
  return db.select().from(financeCategories).orderBy(asc(financeCategories.type), asc(financeCategories.sortOrder), asc(financeCategories.name));
}

export async function createFinanceCategory(type: "income" | "expense", name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const categoryId = genId("FCAT");
  const maxOrder = await db.select({ m: sql<number>`MAX(sort_order)` }).from(financeCategories);
  const sortOrder = (maxOrder[0]?.m ?? 0) + 1;
  await db.insert(financeCategories).values({ categoryId, type, name, sortOrder });
  return categoryId;
}

export async function updateFinanceCategory(categoryId: string, name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(financeCategories).set({ name }).where(eq(financeCategories.categoryId, categoryId));
}

export async function deleteFinanceCategory(categoryId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(financeCategories).where(eq(financeCategories.categoryId, categoryId));
}

// ─── Transactions ─────────────────────────────────────────────────────────────
export async function getTransactions(filters: {
  type?: "income" | "expense";
  location?: string;
  cityId?: string;
  categoryId?: string;
  dateFrom?: string;
  dateTo?: string;
  missingReceiptOnly?: boolean;
  limit?: number;
  offset?: number;
}) {
  const db = await getDb();
  if (!db) return [];
  let q = db
    .select({
      txId: financeTransactions.txId,
      type: financeTransactions.type,
      amount: financeTransactions.amount,
      categoryId: financeTransactions.categoryId,
      categoryName: financeTransactions.categoryName,
      date: financeTransactions.date,
      location: financeTransactions.location,
      cityId: financeTransactions.cityId,
      jobId: financeTransactions.jobId,
      notes: financeTransactions.notes,
      hasReceipt: financeTransactions.hasReceipt,
      receiptUrl: financeTransactions.receiptUrl,
      performedBy: financeTransactions.performedBy,
      createdAt: financeTransactions.createdAt,
      cityName: financeCities.name,
    })
    .from(financeTransactions)
    .leftJoin(financeCities, eq(financeTransactions.cityId, financeCities.cityId)) as any;
  const conditions: any[] = [];
  if (filters.type) conditions.push(eq(financeTransactions.type, filters.type));
  if (filters.location) conditions.push(like(financeTransactions.location, `%${filters.location}%`));
  if (filters.cityId) conditions.push(eq(financeTransactions.cityId, filters.cityId));
  if (filters.categoryId) conditions.push(eq(financeTransactions.categoryId, filters.categoryId));
  if (filters.dateFrom) conditions.push(gte(financeTransactions.date, filters.dateFrom));
  if (filters.dateTo) conditions.push(lte(financeTransactions.date, filters.dateTo));
  if (filters.missingReceiptOnly) conditions.push(eq(financeTransactions.hasReceipt, "no"));
  if (conditions.length > 0) q = q.where(and(...conditions));
  q = q.orderBy(desc(financeTransactions.date), desc(financeTransactions.createdAt));
  if (filters.limit) q = q.limit(filters.limit);
  if (filters.offset) q = q.offset(filters.offset);
  return q;
}

export async function createTransaction(data: {
  type: "income" | "expense";
  categoryId: string;
  categoryName: string;
  amount: string;
  date: string;
  location: string;
  cityId?: string;
  van?: string;
  notes?: string;
  receiptUrl?: string;
  performedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const txId = genId("FTX");
  const hasReceipt = data.receiptUrl ? "yes" : "no";
  const receiptUploadedAt = data.receiptUrl ? new Date() : null;
  await db.insert(financeTransactions).values({
    txId, type: data.type, categoryId: data.categoryId, categoryName: data.categoryName,
    amount: data.amount, date: data.date, location: data.location,
    cityId: data.cityId ?? null, jobId: null,
    van: data.van ?? null, notes: data.notes ?? null,
    receiptUrl: data.receiptUrl ?? null,
    receiptUploadedAt: receiptUploadedAt as any,
    hasReceipt: hasReceipt as "yes" | "no",
    performedBy: data.performedBy,
    editHistory: null,
  });
  return txId;
}

export async function updateTransaction(txId: string, data: {
  categoryId?: string; categoryName?: string; amount?: string;
  date?: string; location?: string; van?: string; notes?: string;
  receiptUrl?: string; performedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const existing = await db.select().from(financeTransactions).where(eq(financeTransactions.txId, txId)).limit(1);
  if (!existing[0]) throw new Error("Transaction not found");
  const prev = existing[0];
  const history = JSON.parse(prev.editHistory ?? "[]");
  history.push({ editedBy: data.performedBy, editedAt: new Date().toISOString(), before: { ...prev } });
  const set: Record<string, unknown> = { editHistory: JSON.stringify(history) };
  if (data.categoryId !== undefined) set.categoryId = data.categoryId;
  if (data.categoryName !== undefined) set.categoryName = data.categoryName;
  if (data.amount !== undefined) set.amount = data.amount;
  if (data.date !== undefined) set.date = data.date;
  if (data.location !== undefined) set.location = data.location;
  if (data.van !== undefined) set.van = data.van;
  if (data.notes !== undefined) set.notes = data.notes;
  if (data.receiptUrl !== undefined) {
    set.receiptUrl = data.receiptUrl;
    set.hasReceipt = data.receiptUrl ? "yes" : "no";
    set.receiptUploadedAt = data.receiptUrl ? new Date() : null;
  }
  await db.update(financeTransactions).set(set).where(eq(financeTransactions.txId, txId));
}

export async function deleteTransaction(txId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(financeTransactions).where(eq(financeTransactions.txId, txId));
}

// ─── Reporting ────────────────────────────────────────────────────────────────
export async function getSummary(dateFrom: string, dateTo: string, cityId?: string) {
  const db = await getDb();
  if (!db) return { totalIncome: 0, totalExpenses: 0, netProfit: 0, profitMargin: 0 };
  const conditions: any[] = [gte(financeTransactions.date, dateFrom), lte(financeTransactions.date, dateTo)];
  if (cityId) conditions.push(eq(financeTransactions.cityId, cityId));
  const rows = await db.select({
    type: financeTransactions.type,
    total: sql<string>`SUM(amount)`,
  }).from(financeTransactions)
    .where(and(...conditions))
    .groupBy(financeTransactions.type);
  let totalIncome = 0, totalExpenses = 0;
  for (const r of rows) {
    if (r.type === "income") totalIncome = parseFloat(r.total ?? "0");
    else totalExpenses = parseFloat(r.total ?? "0");
  }
  const netProfit = totalIncome - totalExpenses;
  const profitMargin = totalIncome > 0 ? (netProfit / totalIncome) * 100 : 0;
  return { totalIncome, totalExpenses, netProfit, profitMargin };
}

export async function getByLocation(dateFrom: string, dateTo: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select({
    location: financeTransactions.location,
    type: financeTransactions.type,
    total: sql<string>`SUM(amount)`,
  }).from(financeTransactions)
    .where(and(gte(financeTransactions.date, dateFrom), lte(financeTransactions.date, dateTo)))
    .groupBy(financeTransactions.location, financeTransactions.type)
    .orderBy(asc(financeTransactions.location));
}

export async function getByCategory(dateFrom: string, dateTo: string, type?: "income" | "expense", cityId?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions: any[] = [gte(financeTransactions.date, dateFrom), lte(financeTransactions.date, dateTo)];
  if (type) conditions.push(eq(financeTransactions.type, type));
  if (cityId) conditions.push(eq(financeTransactions.cityId, cityId));
  return db.select({
    categoryName: financeTransactions.categoryName,
    type: financeTransactions.type,
    total: sql<string>`SUM(amount)`,
    count: sql<number>`COUNT(*)`,
  }).from(financeTransactions)
    .where(and(...conditions))
    .groupBy(financeTransactions.categoryName, financeTransactions.type)
    .orderBy(desc(sql`SUM(amount)`));
}

export async function getMissingReceipts(cityId?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = [
    eq(financeTransactions.type, "expense"),
    eq(financeTransactions.hasReceipt, "no"),
    ...(cityId ? [eq(financeTransactions.cityId, cityId)] : []),
  ];
  return db.select().from(financeTransactions)
    .where(and(...conditions))
    .orderBy(desc(financeTransactions.date));
}

// ─── Assets ───────────────────────────────────────────────────────────────────
export async function getAllAssets() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(financeAssets).orderBy(asc(financeAssets.assetType), asc(financeAssets.name));
}

export async function createAsset(data: { assetType: "current" | "fixed"; name: string; value: string; location?: string; dateAdded: string; notes?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const assetId = genId("FASSET");
  await db.insert(financeAssets).values({ assetId, ...data, location: data.location ?? null, notes: data.notes ?? null });
  return assetId;
}

export async function updateAsset(assetId: string, data: Partial<{ name: string; value: string; location: string; dateAdded: string; notes: string }>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(financeAssets).set(data as any).where(eq(financeAssets.assetId, assetId));
}

export async function deleteAsset(assetId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(financeAssets).where(eq(financeAssets.assetId, assetId));
}

// ─── Liabilities ──────────────────────────────────────────────────────────────
export async function getAllLiabilities() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(financeLiabilities).orderBy(asc(financeLiabilities.liabilityType), asc(financeLiabilities.name));
}

export async function createLiability(data: { liabilityType: "loan" | "credit_card" | "equipment_financing" | "other"; name: string; balance: string; monthlyPayment?: string; interestRate?: string; dueDate?: string; notes?: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const liabilityId = genId("FLIAB");
  await db.insert(financeLiabilities).values({ liabilityId, ...data, monthlyPayment: data.monthlyPayment ?? null, interestRate: data.interestRate ?? null, dueDate: data.dueDate ?? null, notes: data.notes ?? null });
  return liabilityId;
}

export async function updateLiability(liabilityId: string, data: Partial<{ name: string; balance: string; monthlyPayment: string; interestRate: string; dueDate: string; notes: string }>) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(financeLiabilities).set(data as any).where(eq(financeLiabilities.liabilityId, liabilityId));
}

export async function deleteLiability(liabilityId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(financeLiabilities).where(eq(financeLiabilities.liabilityId, liabilityId));
}

// ─── Equity ───────────────────────────────────────────────────────────────────
export async function getAllEquity() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(financeEquity).orderBy(desc(financeEquity.date));
}

export async function createEquity(data: { description: string; amount: string; date: string; notes?: string; performedBy: string }) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const equityId = genId("FEQTY");
  await db.insert(financeEquity).values({ equityId, ...data, notes: data.notes ?? null });
  return equityId;
}

export async function deleteEquity(equityId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(financeEquity).where(eq(financeEquity.equityId, equityId));
}

// ─── Balance Sheet ────────────────────────────────────────────────────────────
export async function getBalanceSheet() {
  const db = await getDb();
  if (!db) return null;
  const assets = await getAllAssets();
  const liabilities = await getAllLiabilities();
  const equityContributions = await getAllEquity();
  // Retained earnings = all-time income - all-time expenses
  const rows = await db.select({
    type: financeTransactions.type,
    total: sql<string>`SUM(amount)`,
  }).from(financeTransactions).groupBy(financeTransactions.type);
  let totalIncome = 0, totalExpenses = 0;
  for (const r of rows) {
    if (r.type === "income") totalIncome = parseFloat(r.total ?? "0");
    else totalExpenses = parseFloat(r.total ?? "0");
  }
  const retainedEarnings = totalIncome - totalExpenses;
  const totalOwnerContributions = equityContributions.reduce((s, e) => s + parseFloat(e.amount as string), 0);
  const totalEquity = totalOwnerContributions + retainedEarnings;
  const totalAssets = assets.reduce((s, a) => s + parseFloat(a.value as string), 0);
  const totalLiabilities = liabilities.reduce((s, l) => s + parseFloat(l.balance as string), 0);
  const isBalanced = Math.abs(totalAssets - (totalLiabilities + totalEquity)) < 0.01;
  return {
    assets, liabilities, equityContributions,
    totalAssets, totalLiabilities, totalEquity,
    totalOwnerContributions, retainedEarnings,
    isBalanced, difference: totalAssets - (totalLiabilities + totalEquity),
  };
}

// ─── Vendors ──────────────────────────────────────────────────────────────────
export async function getAllVendors() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(financeVendors).orderBy(asc(financeVendors.name));
}

export async function createVendor(data: {
  name: string; category?: string; phone?: string; email?: string;
  website?: string; loginEmail?: string; loginPassword?: string; notes?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("No DB");
  const vendorId = genId("VND");
  await db.insert(financeVendors).values({ vendorId, ...data });
  return { vendorId };
}

export async function updateVendor(vendorId: string, data: Partial<{
  name: string; category: string; phone: string; email: string;
  website: string; loginEmail: string; loginPassword: string; notes: string;
}>) {
  const db = await getDb();
  if (!db) throw new Error("No DB");
  await db.update(financeVendors).set(data).where(eq(financeVendors.vendorId, vendorId));
  return { ok: true };
}

export async function deleteVendor(vendorId: string) {
  const db = await getDb();
  if (!db) throw new Error("No DB");
  await db.delete(financeVendors).where(eq(financeVendors.vendorId, vendorId));
  return { ok: true };
}

// ─── Finance Cities ───────────────────────────────────────────────────────────

export async function getAllFinanceCities() {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(financeCities).orderBy(asc(financeCities.sortOrder), asc(financeCities.name));
}

export async function createFinanceCity(name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  const cityId = genId("FCITY");
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
  const maxOrder = await db.select({ m: sql<number>`MAX(sort_order)` }).from(financeCities);
  const sortOrder = (maxOrder[0]?.m ?? 0) + 1;
  await db.insert(financeCities).values({ cityId, name, slug, sortOrder });
  return cityId;
}

export async function updateFinanceCity(cityId: string, name: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(financeCities).set({ name }).where(eq(financeCities.cityId, cityId));
}

export async function deleteFinanceCity(cityId: string) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.delete(financeCities).where(eq(financeCities.cityId, cityId));
}

// ─── Auto-transfer: create finance income record when a job is completed ──────
export async function autoTransferJobRevenue(job: {
  jobId: string;
  location: string;   // city slug from schedule_jobs
  totalPrice: string | number | null;
  discountAmount: string | number | null;
  tips: string | number | null;
  date: string;       // YYYY-MM-DD
  performedBy: string;
}) {
  const db = await getDb();
  if (!db) return;
  // Skip if no revenue
  // Net revenue = totalPrice - discount + tips
  const rawPrice = parseFloat(String(job.totalPrice ?? "0"));
  const discount = parseFloat(String(job.discountAmount ?? "0"));
  const tips = parseFloat(String(job.tips ?? "0"));
  const total = Math.max(0, rawPrice - discount) + tips;
  if (total <= 0) return;
  // Avoid duplicate: check if a transaction with this jobId already exists
  const existing = await db.select({ id: financeTransactions.id })
    .from(financeTransactions)
    .where(eq(financeTransactions.jobId, job.jobId))
    .limit(1);
  if (existing.length > 0) return; // already transferred

  // Find matching city by slug
  const cities = await db.select().from(financeCities).where(eq(financeCities.slug, job.location)).limit(1);
  const cityId = cities[0]?.cityId ?? null;

  // Find or use "Detail Services" income category
  const cats = await db.select().from(financeCategories)
    .where(and(eq(financeCategories.type, "income"), like(financeCategories.name, "%Detail%")))
    .limit(1);
  let categoryId: string;
  let categoryName: string;
  if (cats[0]) {
    categoryId = cats[0].categoryId;
    categoryName = cats[0].name;
  } else {
    // Fallback: first income category
    const allIncome = await db.select().from(financeCategories).where(eq(financeCategories.type, "income")).limit(1);
    if (allIncome[0]) {
      categoryId = allIncome[0].categoryId;
      categoryName = allIncome[0].name;
    } else {
      categoryId = genId("FCAT");
      categoryName = "Detail Services";
      await db.insert(financeCategories).values({ categoryId, type: "income", name: categoryName, sortOrder: 1 });
    }
  }

  const txId = genId("FTX");
  await db.insert(financeTransactions).values({
    txId,
    type: "income",
    categoryId,
    categoryName,
    amount: total.toFixed(2),
    date: job.date,
    location: job.location,
    cityId,
    jobId: job.jobId,
    van: null,
    notes: discount > 0 ? `Auto-transferred from completed job (discount: -$${discount.toFixed(2)})` : `Auto-transferred from completed job`,
    receiptUrl: null,
    receiptUploadedAt: null,
    hasReceipt: "no",
    performedBy: job.performedBy,
    editHistory: null,
  } as any);
}

// ─── Expense Submissions ──────────────────────────────────────────────────────
export async function submitExpense(data: {
  employeeId: string;
  fullName: string;
  amount: number;
  category: "fuel" | "supplies" | "equipment" | "car_wash" | "food" | "other";
  note?: string;
  receiptUrl?: string;
  jobId?: string;
  cityId?: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  // If no cityId provided, look it up from the employee's city
  let resolvedCityId = data.cityId ?? null;
  if (!resolvedCityId) {
    const emp = await db.select({ city: employees.city }).from(employees)
      .where(eq(employees.employeeId, data.employeeId)).limit(1);
    const empCity = emp[0]?.city;
    if (empCity) {
      const citySlug = empCity.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");
      const cityRows = await db.select({ cityId: financeCities.cityId }).from(financeCities)
        .where(eq(financeCities.slug, citySlug)).limit(1);
      // Also try matching by name
      if (!cityRows[0]) {
        const cityByName = await db.select({ cityId: financeCities.cityId }).from(financeCities)
          .where(eq(financeCities.name, empCity)).limit(1);
        resolvedCityId = cityByName[0]?.cityId ?? null;
      } else {
        resolvedCityId = cityRows[0]?.cityId ?? null;
      }
    }
  }
  const expenseId = genId("EXP");
  await db.insert(expenseSubmissions).values({
    expenseId,
    employeeId: data.employeeId,
    fullName: data.fullName,
    amount: data.amount.toFixed(2),
    category: data.category,
    note: data.note ?? null,
    receiptUrl: data.receiptUrl ?? null,
    jobId: data.jobId ?? null,
    cityId: resolvedCityId,
    status: "pending",
    adminNote: null,
    reviewedBy: null,
    reviewedAt: null,
  } as any);
  return { expenseId };
}

export async function getExpensesForEmployee(employeeId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(expenseSubmissions)
    .where(eq(expenseSubmissions.employeeId, employeeId))
    .orderBy(desc(expenseSubmissions.submittedAt));
}

export async function getAllExpenseSubmissions(status?: "pending" | "approved" | "rejected", cityName?: string) {
  const db = await getDb();
  if (!db) return [];
  // Join with employees to get their city for filtering
  const rows = await db
    .select({
      expenseId: expenseSubmissions.expenseId,
      employeeId: expenseSubmissions.employeeId,
      fullName: expenseSubmissions.fullName,
      amount: expenseSubmissions.amount,
      category: expenseSubmissions.category,
      note: expenseSubmissions.note,
      receiptUrl: expenseSubmissions.receiptUrl,
      jobId: expenseSubmissions.jobId,
      status: expenseSubmissions.status,
      adminNote: expenseSubmissions.adminNote,
      reviewedBy: expenseSubmissions.reviewedBy,
      reviewedAt: expenseSubmissions.reviewedAt,
      submittedAt: expenseSubmissions.submittedAt,
      employeeCity: employees.city,
    })
    .from(expenseSubmissions)
    .leftJoin(employees, eq(expenseSubmissions.employeeId, employees.employeeId))
    .orderBy(desc(expenseSubmissions.submittedAt));

  let filtered = rows;
  if (status) filtered = filtered.filter((r) => r.status === status);
  if (cityName) filtered = filtered.filter((r) => (r.employeeCity ?? "").toLowerCase() === cityName.toLowerCase());
  return filtered;
}

// Returns pending expense totals grouped by city name (for Finance Dashboard display)
export async function getPendingExpenseSummary(cityId?: string) {
  const db = await getDb();
  if (!db) return { totalPending: 0, pendingCount: 0, byCity: [] as { cityName: string; total: number; count: number }[] };

  // Get all pending expenses with their employee city info
  const rows = await db
    .select({
      amount: expenseSubmissions.amount,
      cityId: expenseSubmissions.cityId,
      employeeCity: employees.city,
    })
    .from(expenseSubmissions)
    .leftJoin(employees, eq(expenseSubmissions.employeeId, employees.employeeId))
    .where(eq(expenseSubmissions.status, "pending"));

  // If filtering by cityId, only include expenses where cityId matches OR employee city matches
  let filtered = rows;
  if (cityId) {
    // Get the city name for this cityId
    const cityRows = await db.select({ name: financeCities.name, slug: financeCities.slug })
      .from(financeCities).where(eq(financeCities.cityId, cityId)).limit(1);
    const cityName = cityRows[0]?.name ?? "";
    const citySlug = cityRows[0]?.slug ?? "";
    filtered = rows.filter((r) => {
      if (r.cityId === cityId) return true;
      const empCity = (r.employeeCity ?? "").toLowerCase();
      return empCity === cityName.toLowerCase() || empCity === citySlug.toLowerCase();
    });
  }

  const totalPending = filtered.reduce((s, r) => s + parseFloat(r.amount ?? "0"), 0);
  const pendingCount = filtered.length;

  // Group by resolved city name
  const byCityMap: Record<string, { total: number; count: number }> = {};
  for (const r of filtered) {
    const resolvedCityName = r.employeeCity ?? "Unknown Location";
    if (!byCityMap[resolvedCityName]) byCityMap[resolvedCityName] = { total: 0, count: 0 };
    byCityMap[resolvedCityName].total += parseFloat(r.amount ?? "0");
    byCityMap[resolvedCityName].count += 1;
  }
  const byCity = Object.entries(byCityMap).map(([cityName, d]) => ({ cityName, ...d }));
  byCity.sort((a, b) => b.total - a.total);

  return { totalPending, pendingCount, byCity };
}

export async function reviewExpense(expenseId: string, data: {
  status: "approved" | "rejected";
  adminNote?: string;
  reviewedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("DB unavailable");
  await db.update(expenseSubmissions)
    .set({
      status: data.status,
      adminNote: data.adminNote ?? null,
      reviewedBy: data.reviewedBy,
      reviewedAt: new Date(),
    })
    .where(eq(expenseSubmissions.expenseId, expenseId));

  // When approved, auto-create a finance_transaction so it appears in the Finance tab
  if (data.status === "approved") {
    try {
      const rows = await db.select().from(expenseSubmissions)
        .where(eq(expenseSubmissions.expenseId, expenseId)).limit(1);
      const exp = rows[0];
      if (exp) {
        // Map expense category to finance category name
        const catMap: Record<string, string> = {
          fuel: "Fuel",
          supplies: "Chemicals",
          equipment: "Equipment",
          car_wash: "Maintenance",
          food: "Miscellaneous",
          other: "Miscellaneous",
        };
        const targetCatName = catMap[exp.category] ?? "Miscellaneous";
        // Find matching finance expense category
        const cats = await db.select().from(financeCategories)
          .where(and(eq(financeCategories.type, "expense"), like(financeCategories.name, `%${targetCatName}%`)))
          .limit(1);
        const fallbackCats = cats.length === 0
          ? await db.select().from(financeCategories).where(eq(financeCategories.type, "expense")).limit(1)
          : cats;
        const cat = fallbackCats[0];
        if (cat) {
          // Resolve city name for location field
          // Priority: (1) cityId on the expense, (2) employee's city from employees table
          let cityName = "";
          let resolvedCityId: string | null = exp.cityId as string | null ?? null;

          if (resolvedCityId) {
            const cityRows = await db.select({ name: financeCities.name }).from(financeCities)
              .where(eq(financeCities.cityId, resolvedCityId)).limit(1);
            cityName = cityRows[0]?.name ?? "";
          }

          // Fallback: look up the employee's city and match it to a finance city
          if (!cityName && exp.employeeId) {
            const empRows = await db.select({ city: employees.city }).from(employees)
              .where(eq(employees.employeeId, exp.employeeId)).limit(1);
            const empCity = empRows[0]?.city ?? "";
            if (empCity) {
              const cityRows = await db.select({ cityId: financeCities.cityId, name: financeCities.name })
                .from(financeCities)
                .where(like(financeCities.name, `%${empCity}%`))
                .limit(1);
              if (cityRows[0]) {
                cityName = cityRows[0].name;
                resolvedCityId = cityRows[0].cityId;
              } else {
                cityName = empCity;
              }
            }
          }

          // Use the expense's submittedAt date so it appears in the correct reporting period
          const expenseDate = exp.submittedAt instanceof Date
            ? exp.submittedAt.toISOString().slice(0, 10)
            : String(exp.submittedAt ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);

          const txId = genId("FTX");
          await db.insert(financeTransactions).values({
            txId,
            type: "expense",
            categoryId: cat.categoryId,
            categoryName: cat.name,
            amount: exp.amount,
            date: expenseDate,
            location: cityName,
            cityId: resolvedCityId,
            jobId: exp.jobId ?? null,
            van: null,
            notes: `${exp.fullName}: ${exp.note ?? exp.category} (Team Expense #${expenseId})`,
            receiptUrl: exp.receiptUrl ?? null,
            receiptUploadedAt: exp.receiptUrl ? new Date() : null,
            hasReceipt: exp.receiptUrl ? "yes" : "no",
            performedBy: data.reviewedBy,
            editHistory: null,
          } as any);
        }
      }
    } catch (e) {
      console.error("[reviewExpense] Failed to auto-create finance transaction:", e);
    }
  }

  return { success: true };
}
