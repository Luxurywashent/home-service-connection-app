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

const customerId = 'cust_1783979531041_66146be2';
const normEmail = 'adrian@luxurywashonwheels.com';
const normPhone = '8503333333'; // last 10 digits of 85033333333

console.log('Testing allJobs query for customer:', customerId);
console.log('Email:', normEmail);
console.log('Phone (last 10):', normPhone);

// Simulate the allJobs query
const [rows] = await conn.execute(`
  SELECT id, job_id, customer_id, customer_name, customer_email, customer_phone,
         date, time_slot, package_type, source, status, service_description
  FROM schedule_jobs
  WHERE customer_id = ?
     OR customer_email = ?
     OR customer_phone LIKE ?
`, [customerId, normEmail, `%${normPhone}`]);

console.log('\nSchedule jobs matching customer:', rows.length);
console.log(JSON.stringify(rows, null, 2));

// Also check the filter conditions
console.log('\n--- Filter analysis ---');
for (const j of rows) {
  const status = (j.status ?? '').toLowerCase();
  const svcDesc = (j.service_description ?? '').toLowerCase();
  const src = (j.source ?? '').toLowerCase();
  const hasDate = !!j.date;
  
  const isCancelled = status === 'cancelled' || status === 'deleted';
  const isVipInterest = svcDesc.includes('vip program interest') || svcDesc.includes('vip landing');
  const isVipLanding = src === 'vip-landing' || src === 'vip_landing';
  const noDate = !hasDate;
  
  console.log(`Job ${j.id} (${j.source}): cancelled=${isCancelled}, vipInterest=${isVipInterest}, vipLanding=${isVipLanding}, noDate=${noDate}`);
  console.log(`  -> PASSES FILTER: ${!isCancelled && !isVipInterest && !isVipLanding && !noDate}`);
}

await conn.end();
