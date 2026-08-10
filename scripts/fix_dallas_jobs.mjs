// Script: Zero out all Dallas Dinkins $150 jobs from July 27 onward
// Preserves the July 27 $1,200 pb_luxury job
import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const url = process.env.DATABASE_URL;
if (!url) { console.error('No DATABASE_URL'); process.exit(1); }

// Parse mysql://user:pass@host:port/db
const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!match) { console.error('Cannot parse DATABASE_URL:', url); process.exit(1); }
const [, user, password, host, port, database] = match;

const conn = await mysql.createConnection({ host, port: parseInt(port), user, password, database, ssl: { rejectUnauthorized: false } });

// First: show all Dallas jobs from July 27 onward
const [rows] = await conn.execute(
  `SELECT job_id, date, package_type, total_price, payment_method, payment_total, status
   FROM schedule_jobs
   WHERE customer_name LIKE '%Dallas%'
     AND date >= '2026-07-27'
   ORDER BY date ASC, CAST(total_price AS DECIMAL) DESC`
);

console.log('\n=== Dallas Dinkins jobs from Jul 27 onward ===');
for (const r of rows) {
  console.log(`${r.date} | ${r.package_type} | $${r.total_price} | payment: ${r.payment_method || 'none'} $${r.payment_total || 0} | ${r.job_id}`);
}

// Identify jobs to zero out: total_price = 150, date >= 2026-07-27
// EXCLUDE the $1,200 job (pb_luxury on Jul 27)
const toZero = rows.filter(r => parseFloat(r.total_price) === 150);
console.log(`\n=== Jobs to zero out (${toZero.length} total) ===`);
for (const r of toZero) {
  console.log(`  ${r.date} | ${r.package_type} | $${r.total_price} | ${r.job_id}`);
}

const keep = rows.filter(r => parseFloat(r.total_price) !== 150);
console.log(`\n=== Jobs to KEEP unchanged (${keep.length} total) ===`);
for (const r of keep) {
  console.log(`  ${r.date} | ${r.package_type} | $${r.total_price} | ${r.job_id}`);
}

// Confirm before updating
if (toZero.length === 0) {
  console.log('\nNo $150 jobs found to zero out.');
  await conn.end();
  process.exit(0);
}

// Zero out: set total_price = 0, payment_method = 'vip_prepaid', payment_total = 0
const ids = toZero.map(r => r.job_id);
const placeholders = ids.map(() => '?').join(',');
const [result] = await conn.execute(
  `UPDATE schedule_jobs 
   SET total_price = '0', 
       custom_price = '0',
       payment_method = 'vip_prepaid',
       payment_total = '0'
   WHERE job_id IN (${placeholders})`,
  ids
);

console.log(`\n✅ Updated ${result.affectedRows} jobs to $0.00 (VIP prepaid)`);

// Verify
const [verify] = await conn.execute(
  `SELECT job_id, date, package_type, total_price, payment_method, payment_total
   FROM schedule_jobs
   WHERE job_id IN (${placeholders})`,
  ids
);
console.log('\n=== Verification ===');
for (const r of verify) {
  console.log(`  ${r.date} | ${r.package_type} | $${r.total_price} | ${r.payment_method} | ${r.job_id}`);
}

await conn.end();
