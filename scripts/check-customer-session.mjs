import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually
const envPath = resolve(process.cwd(), '.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check customers with this email
const [customers] = await conn.execute(`
  SELECT customer_id, first_name, last_name, email, phone
  FROM customers
  WHERE email = 'adrian@luxurywashonwheels.com'
`);
console.log('Customers with email adrian@luxurywashonwheels.com:');
console.log(JSON.stringify(customers, null, 2));

// Check customer sessions
for (const c of customers) {
  const [sessions] = await conn.execute(`
    SELECT token, customer_id, created_at, expires_at
    FROM customer_sessions
    WHERE customer_id = ?
    ORDER BY created_at DESC
    LIMIT 3
  `, [c.customer_id]);
  console.log(`\nSessions for ${c.customer_id}:`);
  console.log(JSON.stringify(sessions, null, 2));
}

// Also check the allJobs query for the test customer
const testCustomerId = 'cust_1783979531041_66146be2';
const [scheduleJobs] = await conn.execute(`
  SELECT id, job_id, customer_id, customer_email, date, source, status, package_type
  FROM schedule_jobs
  WHERE customer_id = ? OR customer_email = 'adrian@luxurywashonwheels.com'
  ORDER BY date DESC
  LIMIT 10
`, [testCustomerId]);
console.log('\nSchedule jobs for test customer:');
console.log(JSON.stringify(scheduleJobs, null, 2));

await conn.end();
