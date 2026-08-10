/**
 * One-time script to fix efficiency records using REAL clock-in hours (not job slot hours).
 * Run: node scripts/fix-efficiency.mjs
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all unique (assigned_to, date) pairs with jobs in the last 60 days
const [jobs] = await conn.execute(
  `SELECT DISTINCT assigned_to, date FROM schedule_jobs 
   WHERE date >= DATE_SUB(CURDATE(), INTERVAL 60 DAY)
   AND status IN ('confirmed','in_progress','completed')
   AND assigned_to IS NOT NULL
   ORDER BY date DESC`
);

console.log(`Found ${jobs.length} (detailer, date) pairs to resync`);

// Get all employees for name resolution
const [employees] = await conn.execute('SELECT employee_id, full_name, city FROM employees');
const empByEmpId = {};
const empByFullName = {};
const empByFirstName = {};
for (const e of employees) {
  empByEmpId[e.employee_id.toLowerCase()] = e;
  empByFullName[e.full_name.toLowerCase()] = e;
  const firstName = e.full_name.split(' ')[0].toLowerCase();
  if (!empByFirstName[firstName]) empByFirstName[firstName] = e;
}

function resolveEmployee(assignedTo) {
  const lower = assignedTo.toLowerCase();
  if (empByEmpId[lower]) return empByEmpId[lower];
  if (empByFullName[lower]) return empByFullName[lower];
  const firstName = lower.split(' ')[0];
  if (empByFirstName[firstName]) return empByFirstName[firstName];
  return null;
}

let fixed = 0;
let skipped = 0;

// Track processed (employeeId, date) pairs to avoid duplicates
const processed = new Set();

for (const { assigned_to, date } of jobs) {
  const emp = resolveEmployee(assigned_to);
  if (!emp) {
    console.log(`  SKIP: cannot resolve employee for "${assigned_to}"`);
    skipped++;
    continue;
  }

  const key = `${emp.employee_id}__${date}`;
  if (processed.has(key)) continue;
  processed.add(key);

  const empFirstName = emp.full_name.split(' ')[0];

  // Get all jobs for this detailer on this date
  const [detJobs] = await conn.execute(
    `SELECT total_price, start_hour, end_hour, upsell_total, tips, discount_amount
     FROM schedule_jobs
     WHERE date = ?
     AND status IN ('confirmed','in_progress','completed')
     AND (assigned_to = ? OR assigned_to = ? OR assigned_to = ? OR assigned_to = ?)`,
    [date, assigned_to, emp.employee_id, emp.full_name, empFirstName]
  );

  if (detJobs.length === 0) { skipped++; continue; }

  // ALWAYS use real clock-in hours from timesheet — NEVER fall back to job slot hours.
  // If no clock-in record exists, totalHours = 0 and efficiency = 0 (no score).
  const [clockRecords] = await conn.execute(
    `SELECT total_hours, status FROM clock_in_out_records
     WHERE employee_id = ? AND date = ?`,
    [emp.employee_id, date]
  );
  // If currently clocked in (not yet clocked out), skip — live hours are computed by the app
  const isCurrentlyActive = clockRecords.some(r => r.status === 'clocked_in');
  if (isCurrentlyActive) {
    console.log(`  SKIP: ${emp.full_name} on ${date} — currently clocked in (live hours handled by app)`);
    skipped++;
    continue;
  }
  const totalHours = clockRecords
    .filter(r => r.status === 'clocked_out')
    .reduce((sum, r) => sum + parseFloat(r.total_hours ?? '0'), 0);

  // Aggregate revenue from jobs (tips are NEVER counted as revenue)
  let baseRevenue = 0, totalUpsells = 0, totalTips = 0;
  for (const j of detJobs) {
    const discount = parseFloat(j.discount_amount ?? '0');
    baseRevenue += Math.max(0, parseFloat(j.total_price ?? '0') - discount);
    totalUpsells += parseFloat(j.upsell_total ?? '0');
    totalTips += parseFloat(j.tips ?? '0');
  }
  const totalRevenue = baseRevenue + totalUpsells;
  const rawEfficiency = totalHours > 0 ? (totalRevenue / totalHours) / 100 * 100 : 0;
  const efficiency = Math.min(rawEfficiency, 999.99); // cap to DB column max (DECIMAL 5,2)
  const upsellBonus = totalUpsells * 0.4;
  const recordId = `PERF_${emp.employee_id}_${date.replace(/-/g, '')}`;

  await conn.execute(
    `INSERT INTO daily_performance 
     (record_id, date, employee_id, full_name, city, hours_worked, revenue_produced, efficiency_percent, upsells, tips, created_by)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'system')
     ON DUPLICATE KEY UPDATE
       hours_worked = VALUES(hours_worked),
       revenue_produced = VALUES(revenue_produced),
       efficiency_percent = VALUES(efficiency_percent),
       upsells = VALUES(upsells),
       tips = VALUES(tips),
       full_name = VALUES(full_name)`,
    [recordId, date, emp.employee_id, emp.full_name, emp.city ?? '',
     totalHours.toFixed(2), totalRevenue.toFixed(2), efficiency.toFixed(2),
     upsellBonus.toFixed(2), totalTips.toFixed(2)]
  );

  const hoursSource = totalHours > 0 ? `${totalHours.toFixed(2)}hrs (clock-in)` : `0hrs (no clock-in)`;
  console.log(`  FIXED: ${emp.full_name} on ${date} → ${hoursSource}, $${totalRevenue.toFixed(0)} rev, eff:${efficiency.toFixed(1)}%`);
  fixed++;
}

console.log(`\nDone. Fixed: ${fixed}, Skipped: ${skipped}`);
await conn.end();
