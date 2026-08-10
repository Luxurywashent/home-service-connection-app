/**
 * Fix Nick's stale daily_performance record.
 * Nick has no jobs and no clock-in today, but has a stale record with 4.0 hrs from a previous backfill.
 * This script zeros out any daily_performance record where:
 *   - hours_worked > 0
 *   - BUT no clock_in_out_records exist for that employee on that date
 * Run: node scripts/fix-nick-record.mjs
 */
import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const today = new Date().toISOString().slice(0, 10);

console.log('=== Fixing stale efficiency records for:', today, '===\n');

// Get all daily_performance records for today with hours > 0
const [perfRecords] = await conn.execute(
  `SELECT employee_id, full_name, hours_worked, revenue_produced, efficiency_percent
   FROM daily_performance WHERE date = ? AND hours_worked > 0`,
  [today]
);

console.log(`Found ${perfRecords.length} records with hours > 0 today:`);
for (const r of perfRecords) {
  console.log(`  ${r.full_name} (${r.employee_id}): ${r.hours_worked} hrs, $${r.revenue_produced}, ${r.efficiency_percent}%`);
}

let fixed = 0;
for (const r of perfRecords) {
  // Check if this employee has a clock record today
  const [clockRecords] = await conn.execute(
    `SELECT total_hours, status FROM clock_in_out_records
     WHERE employee_id = ? AND date = ?`,
    [r.employee_id, today]
  );

  const completedClockHours = clockRecords
    .filter(c => c.status === 'clocked_out')
    .reduce((sum, c) => sum + parseFloat(c.total_hours ?? '0'), 0);
  const hasAnyClockRecord = clockRecords.length > 0;
  const isCurrentlyActive = clockRecords.some(c => c.status === 'clocked_in');

  if (!hasAnyClockRecord) {
    // No clock record at all — zero out the record
    console.log(`\n  FIXING: ${r.full_name} has no clock-in today but has ${r.hours_worked} hrs in DB. Zeroing out.`);
    await conn.execute(
      `UPDATE daily_performance 
       SET hours_worked = 0, efficiency_percent = 0
       WHERE employee_id = ? AND date = ?`,
      [r.employee_id, today]
    );
    console.log(`  DONE: ${r.full_name} → 0 hrs, 0% efficiency`);
    fixed++;
  } else if (isCurrentlyActive) {
    // Currently clocked in — live hours computed by the app, skip DB update
    console.log(`\n  SKIP: ${r.full_name} is currently clocked in (live hours handled by app)`);
  } else if (Math.abs(completedClockHours - parseFloat(r.hours_worked)) > 0.1) {
    // Clock record exists (completed) but hours don't match — update to real clock hours
    const rawEff = completedClockHours > 0 ? (parseFloat(r.revenue_produced) / completedClockHours) / 100 * 100 : 0;
    const efficiency = Math.min(rawEff, 999.99);
    console.log(`\n  FIXING: ${r.full_name} clock hours=${completedClockHours.toFixed(2)} but DB has ${r.hours_worked}. Correcting.`);
    await conn.execute(
      `UPDATE daily_performance 
       SET hours_worked = ?, efficiency_percent = ?
       WHERE employee_id = ? AND date = ?`,
      [completedClockHours.toFixed(2), efficiency.toFixed(2), r.employee_id, today]
    );
    console.log(`  DONE: ${r.full_name} → ${completedClockHours.toFixed(2)} hrs, ${efficiency.toFixed(1)}%`);
    fixed++;
  } else {
    console.log(`\n  OK: ${r.full_name} — clock hours match DB (${completedClockHours.toFixed(2)} hrs)`);
  }
}

console.log(`\nDone. Fixed ${fixed} records.`);
await conn.end();
