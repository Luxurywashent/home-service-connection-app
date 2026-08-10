/**
 * backfill-customers.mjs
 *
 * Scans every row in schedule_jobs that has a customer_email or customer_phone
 * but no customer_id yet, then runs the same find-or-create dedup logic used
 * by jobs.upsert to link or create a customer profile for each one.
 *
 * Run with:  node scripts/backfill-customers.mjs
 */

import mysql from "mysql2/promise";
import { createHash, randomBytes } from "crypto";
import { config } from "dotenv";

config({ path: new URL("../.env", import.meta.url).pathname });

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("DATABASE_URL not set");
  process.exit(1);
}

const conn = await mysql.createConnection(DATABASE_URL);

// ── Helpers ───────────────────────────────────────────────────────────────────
function generateId(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function hashPassword(str) {
  return createHash("sha256").update(`manual_${str}`).digest("hex");
}

function normalizePhone(phone) {
  if (!phone) return null;
  return phone.replace(/\D/g, "").slice(-10) || null;
}

/**
 * Find-or-create a customer by email (primary) or phone (fallback).
 * Returns the customerId of the found or newly-created customer.
 */
async function findOrCreateCustomer({ customerName, customerEmail, customerPhone }) {
  const emailNorm = customerEmail ? customerEmail.trim().toLowerCase() : null;
  const phoneNorm = normalizePhone(customerPhone);

  if (!emailNorm && !phoneNorm) return null;

  // 1. Try email match
  if (emailNorm) {
    const [rows] = await conn.execute(
      "SELECT customer_id, phone FROM customers WHERE email = ? LIMIT 1",
      [emailNorm]
    );
    if (rows.length > 0) {
      const existing = rows[0];
      // Opportunistically fill phone if missing
      if (phoneNorm && !existing.phone) {
        await conn.execute(
          "UPDATE customers SET phone = ? WHERE customer_id = ?",
          [customerPhone, existing.customer_id]
        );
      }
      return { customerId: existing.customer_id, action: "found_by_email" };
    }
  }

  // 2. Try phone match (normalised digits)
  if (phoneNorm) {
    const [allRows] = await conn.execute(
      "SELECT customer_id, email, phone FROM customers WHERE phone IS NOT NULL LIMIT 10000"
    );
    const match = allRows.find(
      (c) => c.phone && c.phone.replace(/\D/g, "").slice(-10) === phoneNorm
    );
    if (match) {
      // Opportunistically fill email if missing
      if (emailNorm && !match.email) {
        try {
          await conn.execute(
            "UPDATE customers SET email = ? WHERE customer_id = ?",
            [emailNorm, match.customer_id]
          );
        } catch { /* ignore duplicate email constraint */ }
      }
      return { customerId: match.customer_id, action: "found_by_phone" };
    }
  }

  // 3. Create new customer
  const nameParts = (customerName ?? "").trim().split(/\s+/);
  const firstName = nameParts[0] || "Customer";
  const lastName = nameParts.slice(1).join(" ") || "(Manual)";
  const emailForInsert =
    emailNorm ?? `manual_${Date.now()}_${randomBytes(4).toString("hex")}@noemail.lwow`;
  const customerId = generateId("cust");
  const placeholderHash = hashPassword(randomBytes(16).toString("hex"));

  try {
    await conn.execute(
      `INSERT INTO customers
         (customer_id, first_name, last_name, email, phone, password_hash)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [customerId, firstName, lastName, emailForInsert, customerPhone ?? null, placeholderHash]
    );
    return { customerId, action: "created" };
  } catch (e) {
    // Race / duplicate — retry lookup by email
    if (emailNorm && (e.code === "ER_DUP_ENTRY" || String(e).includes("Duplicate"))) {
      const [retry] = await conn.execute(
        "SELECT customer_id FROM customers WHERE email = ? LIMIT 1",
        [emailNorm]
      );
      if (retry.length > 0) return { customerId: retry[0].customer_id, action: "found_by_email_retry" };
    }
    console.error("  ✗ Insert failed:", e.message);
    return null;
  }
}

// ── Main backfill ─────────────────────────────────────────────────────────────
console.log("🔍  Fetching unlinked schedule jobs...");
const [jobs] = await conn.execute(
  `SELECT job_id, customer_name, customer_email, customer_phone
   FROM schedule_jobs
   WHERE customer_id IS NULL
     AND (customer_email IS NOT NULL OR customer_phone IS NOT NULL)
   ORDER BY created_at ASC`
);

console.log(`   Found ${jobs.length} job(s) without a linked customer.\n`);

let created = 0;
let linked = 0;
let skipped = 0;

for (const job of jobs) {
  const result = await findOrCreateCustomer({
    customerName: job.customer_name,
    customerEmail: job.customer_email,
    customerPhone: job.customer_phone,
  });

  if (!result) {
    console.log(`  ⚠  Skipped job ${job.job_id} — no usable identifier`);
    skipped++;
    continue;
  }

  // Link the job to the customer
  await conn.execute(
    "UPDATE schedule_jobs SET customer_id = ? WHERE job_id = ?",
    [result.customerId, job.job_id]
  );

  const label =
    result.action === "created"
      ? `✅  Created  → ${result.customerId}`
      : `🔗  Linked   → ${result.customerId} (${result.action})`;

  const name = job.customer_name || job.customer_email || job.customer_phone;
  console.log(`  ${label}  [${name}]`);

  if (result.action === "created") created++;
  else linked++;
}

console.log(`
─────────────────────────────────────────
  Backfill complete
  New customer profiles created : ${created}
  Jobs linked to existing profile: ${linked}
  Skipped (no identifier)        : ${skipped}
  Total jobs processed           : ${jobs.length}
─────────────────────────────────────────
`);

await conn.end();
