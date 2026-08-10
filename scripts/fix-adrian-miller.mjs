import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const PORTAL_CUSTOMER_ID = 'cust_1777473307334_bcc06e18'; // lilmerge4@gmail.com
const OLD_CUSTOMER_ID    = 'cust_1777256926716_08c07100'; // orphan from backfill

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// 1. Fix the name on the portal profile
const [nameUpdate] = await conn.execute(
  "UPDATE customers SET first_name = 'Adrian', last_name = 'Miller' WHERE customer_id = ?",
  [PORTAL_CUSTOMER_ID]
);
console.log('Name fixed:', nameUpdate.affectedRows, 'row(s)');

// 2. Re-link all Adrian / Miller jobs to the portal customer and stamp the email
const [emailUpdate] = await conn.execute(
  "UPDATE schedule_jobs SET customer_email = 'lilmerge4@gmail.com', customer_id = ? WHERE customer_name LIKE '%Adrian%' OR customer_name LIKE '%Miller%'",
  [PORTAL_CUSTOMER_ID]
);
console.log('Jobs re-linked:', emailUpdate.affectedRows, 'row(s)');

// 3. Check the orphan customer
const [orphanRows] = await conn.execute(
  'SELECT customer_id, first_name, last_name, email FROM customers WHERE customer_id = ?',
  [OLD_CUSTOMER_ID]
);
console.log('Orphan customer:', JSON.stringify(orphanRows));

if (orphanRows.length > 0 && (orphanRows[0].email === null || orphanRows[0].email === '')) {
  const [del] = await conn.execute('DELETE FROM customers WHERE customer_id = ?', [OLD_CUSTOMER_ID]);
  console.log('Orphan deleted:', del.affectedRows, 'row(s)');
} else {
  console.log('Orphan has email or not found — skipping delete');
}

// 4. Verify final state
const [jobs] = await conn.execute(
  "SELECT job_id, customer_name, customer_email, customer_id, date FROM schedule_jobs WHERE customer_name LIKE '%Adrian%' OR customer_name LIKE '%Miller%' ORDER BY date DESC"
);
console.log('\nVerified jobs (' + jobs.length + ' total):');
for (const j of jobs) {
  console.log(' -', j.job_id, '|', j.customer_name, '|', j.customer_email, '| customerId:', j.customer_id, '| date:', j.date);
}

// 5. Confirm portal profile
const [profile] = await conn.execute(
  'SELECT customer_id, first_name, last_name, email, phone FROM customers WHERE customer_id = ?',
  [PORTAL_CUSTOMER_ID]
);
console.log('\nPortal profile:', JSON.stringify(profile[0], null, 2));

await conn.end();
