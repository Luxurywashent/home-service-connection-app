/**
 * CRM Customer Import Script
 * Imports contacts from LuxuryWashOnWheelsCrestview_customer_export.csv
 * into the customers + customer_addresses tables.
 *
 * Run: node scripts/import-crm-customers.mjs
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { createHash, randomBytes } from "crypto";
import mysql2 from "mysql2/promise";

const require = createRequire(import.meta.url);
require("./load-env.js");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) {
  console.error("❌ DATABASE_URL not set");
  process.exit(1);
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function hashPassword(password) {
  return createHash("sha256").update(password + "lwow_salt_2026").digest("hex");
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

function parseMoney(raw) {
  if (!raw) return null;
  const n = parseFloat(raw.replace(/[$,]/g, ""));
  return isNaN(n) ? null : n;
}

function parseDate(raw) {
  if (!raw || !raw.trim()) return null;
  try {
    const d = new Date(raw.trim());
    return isNaN(d.getTime()) ? null : d;
  } catch {
    return null;
  }
}

// ── Simple CSV Parser (handles quoted fields with commas/newlines) ───────────
function parseCSV(raw) {
  const lines = [];
  let current = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];

    if (inQuotes) {
      if (ch === '"' && next === '"') {
        field += '"';
        i++;
      } else if (ch === '"') {
        inQuotes = false;
      } else {
        field += ch;
      }
    } else {
      if (ch === '"') {
        inQuotes = true;
      } else if (ch === ',') {
        current.push(field);
        field = "";
      } else if (ch === '\n') {
        current.push(field);
        field = "";
        lines.push(current);
        current = [];
      } else if (ch === '\r') {
        // skip
      } else {
        field += ch;
      }
    }
  }
  // last field/line
  if (field || current.length > 0) {
    current.push(field);
    lines.push(current);
  }

  if (lines.length === 0) return [];
  const headers = lines[0].map(h => h.trim());
  return lines.slice(1).filter(l => l.some(f => f.trim())).map(line => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (line[i] ?? "").trim(); });
    return obj;
  });
}

// ── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  const csvPath = "/home/ubuntu/upload/crm_export/LuxuryWashOnWheelsCrestview_customer_export.csv";
  const raw = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(raw);

  console.log(`📂 Loaded ${rows.length} rows from CSV`);

  // Parse DATABASE_URL: mysql://user:pass@host:port/dbname
  const url = new URL(DATABASE_URL);
  const conn = await mysql2.createConnection({
    host: url.hostname,
    port: parseInt(url.port || "3306"),
    user: url.username,
    password: url.password,
    database: url.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
    multipleStatements: false,
  });

  console.log("✅ Connected to database");

  // Load existing emails and phones to avoid duplicates
  const [existingRows] = await conn.execute("SELECT email, phone FROM customers");
  const existingEmails = new Set(existingRows.map(r => r.email.toLowerCase()));
  const existingPhones = new Set(existingRows.map(r => r.phone).filter(Boolean));
  console.log(`📊 Existing customers: ${existingEmails.size}`);

  let imported = 0;
  let skipped = 0;
  let addressesAdded = 0;
  const errors = [];

  for (const row of rows) {
    try {
      const firstName = (row["First Name"] || "").trim();
      const lastName = (row["Last Name"] || "").trim();
      const fullName = `${firstName} ${lastName}`.trim();
      if (!fullName || fullName === "") {
        skipped++;
        continue;
      }

      // Phone: prefer mobile, fall back to home
      const phone = normalizePhone(row["Mobile Number"]) || normalizePhone(row["Home Number"]) || null;

      // Email: use real email or generate placeholder
      let email = (row["Email"] || "").trim().toLowerCase();
      if (!email) {
        if (phone) {
          email = `noemail_${phone}@import.lwow`;
        } else {
          // Use name-based placeholder
          const slug = fullName.toLowerCase().replace(/[^a-z0-9]/g, "_").slice(0, 40);
          email = `noemail_${slug}_${randomBytes(3).toString("hex")}@import.lwow`;
        }
      }

      // Skip if email already exists
      if (existingEmails.has(email)) {
        skipped++;
        continue;
      }

      // Skip if phone already exists (avoid duplicates for no-email contacts)
      if (phone && existingPhones.has(phone)) {
        skipped++;
        continue;
      }

      const doNotService = (row["Do Not Service"] || "").trim().toLowerCase() === "true" ? 1 : 0;
      const tags = (row["Tags"] || "").trim();
      const notes = (row["Notes"] || "").trim();
      const crmId = (row["ID"] || "").trim();
      const lifetimeValue = parseMoney(row["Lifetime value"]);
      const lastServiceDate = parseDate(row["Last service date"]);
      const createdAt = parseDate(row["Customer created at"]) || new Date();

      // Build notes field combining CRM notes + tags
      const noteParts = [];
      if (tags) noteParts.push(`Tags: ${tags}`);
      if (notes) noteParts.push(notes);
      if (crmId) noteParts.push(`CRM ID: ${crmId}`);
      const combinedNotes = noteParts.join(" | ") || null;

      const customerId = generateId("cust");
      // Use a placeholder password hash — these users will need to reset password to log in
      const passwordHash = hashPassword(`import_${customerId}`);

      // Insert customer
      await conn.execute(
        `INSERT INTO customers 
          (customer_id, first_name, last_name, email, phone, password_hash, 
           do_not_service, do_not_service_reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`,
        [
          customerId,
          firstName || fullName,
          lastName || "",
          email,
          phone,
          passwordHash,
          doNotService,
          doNotService ? (combinedNotes || "Imported from CRM as Do Not Service") : null,
          createdAt,
        ]
      );

      existingEmails.add(email);
      if (phone) existingPhones.add(phone);
      imported++;

      // Insert primary address if available
      const street = (row["Address_1 Street Line 1"] || "").trim();
      const city = (row["Address_1 City"] || "").trim();
      const state = (row["Address_1 State"] || "").trim();
      const zip = (row["Address_1 Postal Code"] || "").trim();

      if (street && city) {
        const addressId = generateId("addr");
        await conn.execute(
          `INSERT INTO customer_addresses 
            (address_id, customer_id, label, street, unit, city, state, zip, is_default, created_at, updated_at)
           VALUES (?, ?, 'Home', ?, ?, ?, ?, ?, 1, NOW(), NOW())`,
          [
            addressId,
            customerId,
            street,
            (row["Address_1 Street Line 2"] || "").trim() || null,
            city,
            state || "FL",
            zip || null,
          ]
        );
        addressesAdded++;
      }

      // Progress log every 500
      if (imported % 500 === 0) {
        console.log(`  ↳ Imported ${imported} so far...`);
      }
    } catch (err) {
      errors.push({ name: `${row["First Name"]} ${row["Last Name"]}`, error: err.message });
      if (errors.length <= 5) {
        console.error(`  ⚠️  Error on ${row["First Name"]} ${row["Last Name"]}: ${err.message}`);
      }
    }
  }

  await conn.end();

  console.log("\n✅ Import complete!");
  console.log(`   Imported:        ${imported} customers`);
  console.log(`   Addresses added: ${addressesAdded}`);
  console.log(`   Skipped (dupes): ${skipped}`);
  console.log(`   Errors:          ${errors.length}`);
  if (errors.length > 5) {
    console.log(`   (First 5 errors shown above)`);
  }
}

main().catch(err => {
  console.error("Fatal error:", err);
  process.exit(1);
});
