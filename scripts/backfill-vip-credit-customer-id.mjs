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

// Find all vip_credit schedule jobs and their matching contracts
const [rows] = await conn.execute(`
  SELECT sj.id, sj.job_id, sj.customer_id as sj_customer_id, 
         vc.customer_id as vc_customer_id, vc.contract_number
  FROM schedule_jobs sj
  JOIN vip_contracts vc ON sj.job_id LIKE CONCAT('vip-credit-', vc.id, '-%')
  WHERE sj.source = 'vip_credit'
`);
console.log('VIP credit jobs found:', rows.length);
console.log(JSON.stringify(rows, null, 2));

// Update each one with the customer_id from the contract
let updated = 0;
for (const row of rows) {
  if (!row.sj_customer_id && row.vc_customer_id) {
    await conn.execute('UPDATE schedule_jobs SET customer_id = ? WHERE id = ?', [row.vc_customer_id, row.id]);
    updated++;
    console.log('Updated job', row.id, 'with customer_id', row.vc_customer_id);
  } else {
    console.log('Job', row.id, 'already has customer_id:', row.sj_customer_id, '(contract customer_id:', row.vc_customer_id, ')');
  }
}
console.log('Total updated:', updated);
await conn.end();
