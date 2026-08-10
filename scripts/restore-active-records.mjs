/**
 * Restore daily_performance records for employees who are currently clocked in.
 * The previous fix-nick-record run incorrectly zeroed Caitlin and Sean because
 * their clock records show total_hours=0 (they're still clocked in, not clocked out yet).
 * This script re-syncs their revenue from schedule_jobs and sets hours from clock records.
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const today = new Date().toISOString().slice(0, 10);

console.log('=== Restoring active detailer records for:', today, '===\n');

// Get all employees currently clocked in today
const [activeClocks] = await conn.execute(
  `SELECT employee_id, full_name, clock_in_time, total_hours, status
   FROM clock_in_out_records WHERE date = ? AND status = 'clocked_in'`,
  [today]
);

console.log(`Found ${activeClocks.length} employees currently clocked in:`);
for (const c of activeClocks) {
  console.log(`  ${c.full_name} (${c.employee_id}) - clocked in at ${c.clock_in_time}`);
}

// Get all employees for name resolution
const [employees] = await conn.execute('SELECT employee_id, full_name FROM employees');
const empByEmpId = {};
for (const e of employees) {
  empByEmpId[e.employee_id.toLowerCase()] = e;
}

let restored = 0;
for (const clock of activeClocks) {
  const emp = empByEmpId[clock.employee_id.toLowerCase()];
  if (!emp) {
    console.log(`\n  SKIP: Cannot find employee record for ${clock.employee_id}`);
    continue;
  }

  const empFirstName = emp.full_name.split(' ')[0];

  // Get revenue from schedule_jobs (same source as Dashboard)
  const [jobs] = await conn.execute(
    `SELECT total_price, upsell_total, tips, discount_amount, custom_price
     FROM schedule_jobs
     WHERE date = ?
     AND status IN ('confirmed','in_progress','completed')
     AND (assigned_to = ? OR assigned_to = ? OR assigned_to = ?)`,
    [today, emp.employee_id, emp.full_name, empFirstName]
  );

  let baseRevenue = 0, totalUpsells = 0, totalTips = 0;
  for (const j of jobs) {
    const price = parseFloat(j.custom_price ?? j.total_price ?? '0');
    const discount = parseFloat(j.discount_amount ?? '0');
    baseRevenue += Math.max(0, price - discount);
    totalUpsells += parseFloat(j.upsell_total ?? '0');
    totalTips += parseFloat(j.tips ?? '0');
  }
  const totalRevenue = baseRevenue + totalUpsells;

  // For currently active employees, compute live hours from clock_in_time
  const clockInTime = new Date(clock.clock_in_time);
  const now = new Date();
  const liveHours = (now - clockInTime) / (1000 * 60 * 60);
  
  // Efficiency is computed live in the app — store 0 in DB for active employees
  // The app adds live hours on top when displaying
  const rawEff = liveHours > 0 ? (totalRevenue / liveHours) / 100 * 100 : 0;
  const efficiency = Math.min(rawEff, 999.99);

  // Check if record exists
  const [existing] = await conn.execute(
    `SELECT record_id FROM daily_performance WHERE employee_id = ? AND date = ?`,
    [emp.employee_id, today]
  );

  if (existing.length > 0) {
    await conn.execute(
      `UPDATE daily_performance 
       SET hours_worked = ?, revenue_produced = ?, efficiency_percent = ?, tips = ?
       WHERE employee_id = ? AND date = ?`,
      [liveHours.toFixed(2), totalRevenue.toFixed(2), efficiency.toFixed(2), totalTips.toFixed(2), emp.employee_id, today]
    );
  } else {
    const recordId = `PERF_${emp.employee_id}_${today.replace(/-/g, '')}`;
    await conn.execute(
      `INSERT INTO daily_performance 
       (record_id, date, employee_id, full_name, city, hours_worked, revenue_produced, efficiency_percent, upsells, tips, created_by)
       VALUES (?, ?, ?, ?, '', ?, ?, ?, 0, ?, 'system')`,
      [recordId, today, emp.employee_id, emp.full_name, liveHours.toFixed(2), totalRevenue.toFixed(2), efficiency.toFixed(2), totalTips.toFixed(2)]
    );
  }

  console.log(`\n  RESTORED: ${emp.full_name} → ${liveHours.toFixed(2)} hrs (live), $${totalRevenue.toFixed(0)} rev, ${efficiency.toFixed(1)}%`);
  restored++;
}

console.log(`\nDone. Restored ${restored} records.`);
await conn.end();
