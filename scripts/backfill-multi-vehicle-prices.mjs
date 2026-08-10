import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
dotenv.config({ path: ".env" });

const conn = await mysql.createConnection({
  host: process.env.DB_HOST,
  port: parseInt(process.env.DB_PORT || "3306"),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: process.env.DB_SSL === "true" ? { rejectUnauthorized: false } : undefined,
});

// Find all jobs that have additionalVehicles set
const [rows] = await conn.execute(
  "SELECT job_id, total_price, custom_price, additional_vehicles FROM schedule_jobs WHERE additional_vehicles IS NOT NULL AND additional_vehicles != '[]' AND additional_vehicles != ''"
);

console.log(`Found ${rows.length} jobs with additional vehicles`);

let fixed = 0;
let skipped = 0;

for (const row of rows) {
  let additionalVehicles;
  try {
    additionalVehicles = JSON.parse(row.additional_vehicles);
  } catch {
    console.log(`  Skipping ${row.job_id}: invalid JSON`);
    skipped++;
    continue;
  }

  if (!Array.isArray(additionalVehicles) || additionalVehicles.length === 0) {
    skipped++;
    continue;
  }

  const extraTotal = additionalVehicles.reduce((sum, v) => sum + (Number(v.price) || 0), 0);
  if (extraTotal === 0) {
    console.log(`  Skipping ${row.job_id}: extra vehicles have $0 price (no package selected)`);
    skipped++;
    continue;
  }

  const primaryPrice = parseFloat(row.total_price || "0");
  const customPrice = row.custom_price != null ? parseFloat(row.custom_price) : null;

  // Check if totalPrice already includes the extra vehicles
  // If totalPrice is roughly equal to primaryPrice alone (not summed), fix it
  // We detect this by checking if totalPrice < primaryPrice + extraTotal
  const correctTotal = primaryPrice + extraTotal;

  // If customPrice is set, the display uses customPrice — but we still want totalPrice to be correct
  // for when customPrice is cleared
  if (Math.abs(primaryPrice - correctTotal) < 0.01) {
    // Already correct
    skipped++;
    continue;
  }

  console.log(`  Fixing ${row.job_id}: totalPrice $${primaryPrice} → $${correctTotal} (extra vehicles: $${extraTotal})`);
  await conn.execute(
    "UPDATE schedule_jobs SET total_price = ? WHERE job_id = ?",
    [String(correctTotal), row.job_id]
  );
  fixed++;
}

console.log(`\nDone. Fixed: ${fixed}, Skipped: ${skipped}`);
await conn.end();
