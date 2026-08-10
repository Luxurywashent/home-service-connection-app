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

// Check the VIP credit schedule job
const [jobs] = await conn.execute(`
  SELECT id, job_id, customer_id, customer_name, customer_email, customer_phone, 
         date, time_slot, package_type, source, status, service_description
  FROM schedule_jobs 
  WHERE source = 'vip_credit'
`);
console.log('VIP credit schedule jobs:');
console.log(JSON.stringify(jobs, null, 2));

// Check the corresponding contract
const [contracts] = await conn.execute(`
  SELECT id, contract_number, customer_id, customer_name, customer_email, customer_phone
  FROM vip_contracts
  WHERE id = 480001
`);
console.log('\nVIP contract:');
console.log(JSON.stringify(contracts, null, 2));

// Check if there's a customer with matching email
if (jobs.length > 0 && jobs[0].customer_email) {
  const [customers] = await conn.execute(`
    SELECT customer_id, first_name, last_name, email, phone
    FROM customers
    WHERE email = ?
  `, [jobs[0].customer_email]);
  console.log('\nMatching customer by email:', JSON.stringify(customers, null, 2));
}

await conn.end();
