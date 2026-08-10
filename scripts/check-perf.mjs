import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config({ path: '.env.local' });
dotenv.config({ path: '.env' });

const conn = await mysql.createConnection(process.env.DATABASE_URL);
const today = new Date().toISOString().slice(0, 10);
const [rows] = await conn.execute(
  'SELECT full_name, revenue_produced, hours_worked, tips, upsells, efficiency_percent FROM daily_performance WHERE date = ? ORDER BY revenue_produced DESC',
  [today]
);
console.log('Today:', today);
console.log(JSON.stringify(rows, null, 2));
let totalRev = 0, totalTips = 0;
for (const r of rows) {
  totalRev += parseFloat(r.revenue_produced ?? '0');
  totalTips += parseFloat(r.tips ?? '0');
}
console.log('TOTAL revenue_produced:', totalRev.toFixed(2));
console.log('TOTAL tips:', totalTips.toFixed(2));
console.log('Rev WITHOUT tips:', (totalRev - totalTips).toFixed(2));
await conn.end();
