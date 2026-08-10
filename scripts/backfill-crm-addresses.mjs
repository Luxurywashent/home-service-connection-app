/**
 * Address Backfill Script
 * Adds missing addresses for all imported CRM customers.
 * Handles Address_1 through Address_6, allows blank zips.
 * Skips addresses already present (by street match).
 *
 * Run: node scripts/backfill-crm-addresses.mjs
 */

import { createRequire } from "module";
import { readFileSync } from "fs";
import { createHash, randomBytes } from "crypto";
import mysql2 from "mysql2/promise";

const require = createRequire(import.meta.url);
require("./load-env.js");

const DATABASE_URL = process.env.DATABASE_URL;
if (!DATABASE_URL) { console.error("❌ DATABASE_URL not set"); process.exit(1); }

function generateId(prefix) {
  return `${prefix}_${Date.now()}_${randomBytes(4).toString("hex")}`;
}

function normalizePhone(raw) {
  if (!raw) return null;
  const digits = raw.replace(/\D/g, "");
  if (digits.length === 10) return digits;
  if (digits.length === 11 && digits.startsWith("1")) return digits.slice(1);
  return digits.length >= 7 ? digits : null;
}

// Simple CSV parser (handles quoted fields with embedded commas/newlines)
function parseCSV(raw) {
  const lines = [];
  let current = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < raw.length; i++) {
    const ch = raw[i];
    const next = raw[i + 1];
    if (inQuotes) {
      if (ch === '"' && next === '"') { field += '"'; i++; }
      else if (ch === '"') { inQuotes = false; }
      else { field += ch; }
    } else {
      if (ch === '"') { inQuotes = true; }
      else if (ch === ',') { current.push(field); field = ""; }
      else if (ch === '\n') { current.push(field); field = ""; lines.push(current); current = []; }
      else if (ch === '\r') { /* skip */ }
      else { field += ch; }
    }
  }
  if (field || current.length > 0) { current.push(field); lines.push(current); }
  if (lines.length === 0) return [];
  const headers = lines[0].map(h => h.trim());
  return lines.slice(1).filter(l => l.some(f => f.trim())).map(line => {
    const obj = {};
    headers.forEach((h, i) => { obj[h] = (line[i] ?? "").trim(); });
    return obj;
  });
}

async function main() {
  const csvPath = "/home/ubuntu/upload/crm_export/LuxuryWashOnWheelsCrestview_customer_export.csv";
  const raw = readFileSync(csvPath, "utf-8");
  const rows = parseCSV(raw);
  console.log(`📂 Loaded ${rows.length} rows from CSV`);

  const url = new URL(DATABASE_URL);
  const conn = await mysql2.createConnection({
    host: url.hostname, port: parseInt(url.port || "3306"),
    user: url.username, password: url.password,
    database: url.pathname.replace(/^\//, ""),
    ssl: { rejectUnauthorized: false },
  });
  console.log("✅ Connected to database");

  // Load all customers keyed by email and phone for fast lookup
  const [customerRows] = await conn.execute("SELECT customer_id, email, phone FROM customers");
  const byEmail = new Map();
  const byPhone = new Map();
  for (const c of customerRows) {
    byEmail.set(c.email.toLowerCase(), c.customer_id);
    if (c.phone) byPhone.set(c.phone, c.customer_id);
  }
  console.log(`📊 Loaded ${customerRows.length} customers for matching`);

  // Load existing addresses to avoid duplicates (keyed by customer_id + normalized street)
  const [addrRows] = await conn.execute("SELECT customer_id, street FROM customer_addresses");
  const existingAddrs = new Set(addrRows.map(a => `${a.customer_id}::${a.street.toLowerCase().trim()}`));
  console.log(`📊 Loaded ${addrRows.length} existing addresses`);

  // Address slots in the CSV
  const addrSlots = [1, 2, 3, 4, 5, 6];

  let added = 0;
  let skipped = 0;
  let noMatch = 0;
  let errors = 0;

  for (const row of rows) {
    // Find the customer in DB
    const email = (row["Email"] || "").trim().toLowerCase();
    const phone = normalizePhone(row["Mobile Number"]) || normalizePhone(row["Home Number"]);

    let customerId = null;
    if (email) customerId = byEmail.get(email);
    if (!customerId && phone) customerId = byPhone.get(phone);

    // Try placeholder email
    if (!customerId && phone) customerId = byEmail.get(`noemail_${phone}@import.lwow`);

    if (!customerId) {
      noMatch++;
      continue;
    }

    // Process each address slot
    for (const slot of addrSlots) {
      const street = (row[`Address_${slot} Street Line 1`] || "").trim();
      if (!street) continue;

      const streetKey = `${customerId}::${street.toLowerCase()}`;
      if (existingAddrs.has(streetKey)) {
        skipped++;
        continue;
      }

      const city = (row[`Address_${slot} City`] || "").trim();
      const state = (row[`Address_${slot} State`] || "FL").trim();
      const zip = (row[`Address_${slot} Postal Code`] || "").trim();
      const unit = (row[`Address_${slot} Street Line 2`] || "").trim() || null;
      const label = slot === 1 ? "Home" : `Address ${slot}`;
      const isDefault = slot === 1 ? 1 : 0;

      try {
        const addressId = generateId("addr");
        await conn.execute(
          `INSERT INTO customer_addresses 
            (address_id, customer_id, label, street, unit, city, state, zip, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NOW(), NOW())`,
          [addressId, customerId, label, street, unit, city || "", state, zip || "", isDefault]
        );
        existingAddrs.add(streetKey);
        added++;
      } catch (err) {
        errors++;
        if (errors <= 5) console.error(`  ⚠️  Error for ${row["First Name"]} ${row["Last Name"]} addr${slot}: ${err.message}`);
      }
    }

    if ((added + skipped) % 1000 === 0 && (added + skipped) > 0) {
      console.log(`  ↳ Processed ${added + skipped} address slots...`);
    }
  }

  await conn.end();

  console.log("\n✅ Address backfill complete!");
  console.log(`   Addresses added:   ${added}`);
  console.log(`   Already existed:   ${skipped}`);
  console.log(`   No customer match: ${noMatch}`);
  console.log(`   Errors:            ${errors}`);
}

main().catch(err => { console.error("Fatal:", err); process.exit(1); });
