import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const url = process.env.DATABASE_URL;
const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
const [, user, password, host, port, database] = match;
const conn = await mysql.createConnection({ host, port: parseInt(port), user, password, database, ssl: { rejectUnauthorized: false } });

// Show current state
const [rows] = await conn.execute(
  `SELECT job_id, date, package_type, total_price, status FROM schedule_jobs
   WHERE customer_name LIKE '%Chase%Griffiths%'
   ORDER BY date DESC`
);
console.log('=== Chase Griffiths jobs ===');
for (const r of rows) console.log(`${r.date} | ${r.package_type} | $${r.total_price} | ${r.status} | ${r.job_id}`);

// Update all pb_mpn0yohe0qes to pb_mpn0yohe0qes_vip (VIP package)
// Actually, looking at the pattern: pb_mpn0yohe0qes is the VIP monthly package ID
// The display name comes from the price book. Let's check what VIP package ID is used
// Based on Dallas Dinkins' jobs, VIP monthly jobs use package_type like 'pb_mpn0yohe0qes' 
// but the display should show "VIP" - this is a display issue in the app, not a data issue.
// The fix is to check what package ID the app uses for VIP and update accordingly.

// Let's see what package IDs are used for VIP jobs that DO display correctly
const [vipRows] = await conn.execute(
  `SELECT DISTINCT package_type FROM schedule_jobs WHERE package_type LIKE '%vip%' OR package_type LIKE '%luxury%' LIMIT 20`
);
console.log('\n=== VIP/Luxury package types in DB ===');
for (const r of vipRows) console.log(r.package_type);

await conn.end();
