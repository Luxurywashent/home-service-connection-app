import { eq, desc, and } from "drizzle-orm";
import { getDb } from "./db";
import { bankStatements, bankTransactions, financeTransactions } from "../drizzle/schema";
import { invokeLLM } from "./_core/llm";
import { storagePut } from "./storage";

function genId(prefix: string) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

// ─── Upload & Parse ────────────────────────────────────────────────────────────

export async function uploadAndParseStatement(params: {
  base64Data: string;
  fileName: string;
  mimeType: string;
  cityId?: string;
  uploadedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const statementId = genId("stmt");

  // Upload file to S3
  const buffer = Buffer.from(params.base64Data, "base64");
  const fileKey = `bank-statements/${statementId}-${params.fileName}`;
  const { url: fileUrl } = await storagePut(fileKey, buffer, params.mimeType);

  // Create statement record
  await db.insert(bankStatements).values({
    statementId,
    cityId: params.cityId ?? null,
    fileName: params.fileName,
    fileUrl,
    status: "processing",
    uploadedBy: params.uploadedBy,
  });

  // Parse with AI
  try {
    const isPdf = params.mimeType === "application/pdf";
    const messages: any[] = [
      {
        role: "system",
        content: `You are a bank statement parser. Extract ALL transactions from the bank statement.
Return a JSON object with this exact structure:
{
  "bankName": "string or null",
  "accountLast4": "last 4 digits or null",
  "periodFrom": "YYYY-MM-DD or null",
  "periodTo": "YYYY-MM-DD or null",
  "transactions": [
    {
      "date": "YYYY-MM-DD",
      "description": "transaction description",
      "amount": 123.45,
      "type": "debit or credit",
      "category": "best guess category like Food, Fuel, Supplies, Software, etc.",
      "balance": 1234.56 or null
    }
  ]
}
Rules:
- type "debit" = money leaving account (expense)
- type "credit" = money entering account (income/deposit)
- amount is always positive
- date format must be YYYY-MM-DD
- Extract every single transaction, do not skip any`,
      },
    ];

    if (isPdf) {
      messages.push({
        role: "user",
        content: [
          { type: "text", text: "Parse all transactions from this bank statement PDF:" },
          { type: "file_url", file_url: { url: fileUrl, mime_type: "application/pdf" } },
        ],
      });
    } else {
      // CSV or text — send as text content
      const textContent = buffer.toString("utf8");
      messages.push({
        role: "user",
        content: `Parse all transactions from this bank statement:\n\n${textContent}`,
      });
    }

    const response = await invokeLLM({
      messages,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0].message.content;
    const parsed = JSON.parse(typeof raw === "string" ? raw : JSON.stringify(raw));

    const txs = parsed.transactions ?? [];

    // Save bank transactions
    const insertedIds: string[] = [];
    for (const tx of txs) {
      const bankTxId = genId("btx");
      await db.insert(bankTransactions).values({
        bankTxId,
        statementId,
        date: tx.date ?? new Date().toISOString().slice(0, 10),
        description: tx.description ?? "Unknown",
        amount: String(Math.abs(tx.amount ?? 0)),
        type: tx.type === "credit" ? "credit" : "debit",
        category: tx.category ?? null,
        balance: tx.balance != null ? String(tx.balance) : null,
        status: "unmatched",
        financeEntryCreated: 0,
      });
      insertedIds.push(bankTxId);
    }

    // Update statement record
    await db.update(bankStatements)
      .set({
        status: "completed",
        bankName: parsed.bankName ?? null,
        accountLast4: parsed.accountLast4 ?? null,
        periodFrom: parsed.periodFrom ?? null,
        periodTo: parsed.periodTo ?? null,
        txCount: txs.length,
      })
      .where(eq(bankStatements.statementId, statementId));

    return { statementId, txCount: txs.length, bankName: parsed.bankName };
  } catch (err: any) {
    await db.update(bankStatements)
      .set({ status: "failed", errorMsg: err.message ?? "Parse error" })
      .where(eq(bankStatements.statementId, statementId));
    throw err;
  }
}

// ─── Query ─────────────────────────────────────────────────────────────────────

export async function getStatements(cityId?: string) {
  const db = await getDb();
  if (!db) return [];
  const conditions = cityId ? [eq(bankStatements.cityId, cityId)] : [];
  return db.select().from(bankStatements)
    .where(conditions.length ? and(...conditions) : undefined)
    .orderBy(desc(bankStatements.createdAt))
    .limit(50);
}

export async function getBankTransactions(statementId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bankTransactions)
    .where(eq(bankTransactions.statementId, statementId))
    .orderBy(desc(bankTransactions.date));
}

export async function getUnmatchedBankTxs(statementId: string) {
  const db = await getDb();
  if (!db) return [];
  return db.select().from(bankTransactions)
    .where(and(
      eq(bankTransactions.statementId, statementId),
      eq(bankTransactions.status, "unmatched"),
    ))
    .orderBy(desc(bankTransactions.date));
}

// ─── Reconciliation ────────────────────────────────────────────────────────────

export async function matchBankTx(params: {
  bankTxId: string;
  financeTxId: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bankTransactions)
    .set({ status: "matched", matchedTxId: params.financeTxId })
    .where(eq(bankTransactions.bankTxId, params.bankTxId));
}

export async function unmatchBankTx(bankTxId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bankTransactions)
    .set({ status: "unmatched", matchedTxId: null })
    .where(eq(bankTransactions.bankTxId, bankTxId));
}

export async function ignoreBankTx(bankTxId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.update(bankTransactions)
    .set({ status: "ignored" })
    .where(eq(bankTransactions.bankTxId, bankTxId));
}

export async function importBankTxToFinance(params: {
  bankTxId: string;
  cityId?: string;
  performedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const [btx] = await db.select().from(bankTransactions)
    .where(eq(bankTransactions.bankTxId, params.bankTxId));
  if (!btx) throw new Error("Bank transaction not found");

  const txId = genId("tx");
  await db.insert(financeTransactions).values({
    txId,
    type: btx.type === "credit" ? "income" : "expense",
    amount: btx.amount,
    categoryId: "bank_import",
    categoryName: btx.category ?? "Uncategorized",
    date: btx.date,
    location: "",
    cityId: params.cityId ?? null,
    jobId: null,
    van: null,
    notes: `Imported from bank statement: ${btx.description}`,
    hasReceipt: "no",
    performedBy: params.performedBy,
  });

  await db.update(bankTransactions)
    .set({ status: "matched", financeEntryCreated: 1, financeEntryTxId: txId, matchedTxId: txId })
    .where(eq(bankTransactions.bankTxId, params.bankTxId));

  return txId;
}

export async function bulkImportStatement(params: {
  statementId: string;
  cityId?: string;
  performedBy: string;
}) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");

  const unmatched = await getUnmatchedBankTxs(params.statementId);
  let imported = 0;
  for (const btx of unmatched) {
    await importBankTxToFinance({ bankTxId: btx.bankTxId, cityId: params.cityId, performedBy: params.performedBy });
    imported++;
  }

  await db.update(bankStatements)
    .set({ importedCount: imported })
    .where(eq(bankStatements.statementId, params.statementId));

  return imported;
}

export async function deleteStatement(statementId: string) {
  const db = await getDb();
  if (!db) throw new Error("Database not available");
  await db.delete(bankTransactions).where(eq(bankTransactions.statementId, statementId));
  await db.delete(bankStatements).where(eq(bankStatements.statementId, statementId));
}
