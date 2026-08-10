import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const today = new Date().toISOString().slice(0, 10);

console.log('=== TODAY:', today, '===');

// 1. Nick's daily_performance record
const [dp] = await conn.execute(
  `SELECT full_name, employee_id, date, hours_worked, revenue_produced, efficiency_percent
   FROM daily_performance WHERE date = ? AND full_name LIKE '%ick%'`,
  [today]
);
console.log('\n--- daily_performance for Nick today ---');
console.log(JSON.stringify(dp, null, 2));

// 2. Nick's clock records today
const [clocks] = await conn.execute(
  `SELECT employee_id, full_name, date, clock_in_time, clock_out_time, total_hours, status
   FROM clock_in_out_records WHERE date = ? AND full_name LIKE '%ick%'`,
  [today]
);
console.log('\n--- clock_in_out_records for Nick today ---');
console.log(JSON.stringify(clocks, null, 2));

// 3. Nick's jobs today
const [jobs] = await conn.execute(
  `SELECT id, assigned_to, date, start_hour, end_hour, status, total_price
   FROM schedule_jobs WHERE date = ? AND assigned_to LIKE '%ick%'`,
  [today]
);
console.log('\n--- schedule_jobs for Nick today ---');
console.log(JSON.stringify(jobs, null, 2));

// 4. Nick's employee record
const [emp] = await conn.execute(
  `SELECT employee_id, full_name FROM employees WHERE full_name LIKE '%ick%' OR employee_id LIKE '%ick%'`
);
console.log('\n--- employees for Nick ---');
console.log(JSON.stringify(emp, null, 2));

// 5. ALL clock records today (to see who clocked in)
const [allClocks] = await conn.execute(
  `SELECT employee_id, full_name, date, total_hours, status
   FROM clock_in_out_records WHERE date = ?`,
  [today]
);
console.log('\n--- ALL clock_in_out_records today ---');
console.log(JSON.stringify(allClocks, null, 2));

await conn.end();
