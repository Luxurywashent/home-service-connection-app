import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ── 1. Merge Adrian Miller: keep Gmail (portal account), absorb Yahoo ──────────
const KEEP_ID   = 'cust_1777473307334_bcc06e18'; // lilmerge4@gmail.com (portal login)
const MERGE_ID  = 'cust_1777256926716_08c07100'; // lilmerge4@yahoo.com (backfill duplicate)

// Re-link any jobs still pointing to the Yahoo profile → Gmail profile
const [jobsRelinked] = await conn.execute(
  'UPDATE schedule_jobs SET customer_id = ? WHERE customer_id = ?',
  [KEEP_ID, MERGE_ID]
);
console.log('Jobs re-linked from Yahoo → Gmail profile:', jobsRelinked.affectedRows);

// Re-link any customer_bookings pointing to the Yahoo profile
const [bookingsRelinked] = await conn.execute(
  'UPDATE customer_bookings SET customer_id = ? WHERE customer_id = ?',
  [KEEP_ID, MERGE_ID]
).catch(() => [{ affectedRows: 0 }]);
console.log('Bookings re-linked:', bookingsRelinked.affectedRows);

// Delete the Yahoo duplicate
const [deleted] = await conn.execute('DELETE FROM customers WHERE customer_id = ?', [MERGE_ID]);
console.log('Yahoo duplicate deleted:', deleted.affectedRows);

// ── 2. Fix "Ace miller" / "Ace Miller" job names → "Adrian Miller" ─────────────
const [nameFixed] = await conn.execute(
  "UPDATE schedule_jobs SET customer_name = 'Adrian Miller' WHERE customer_name LIKE '%Ace%miller%' OR customer_name LIKE '%Ace%Miller%'",
);
console.log('Job names fixed (Ace → Adrian):', nameFixed.affectedRows);

// ── 3. Scan for other duplicate customers (same phone last-10 or same email) ───
const [allCustomers] = await conn.execute(
  'SELECT customer_id, first_name, last_name, email, phone FROM customers ORDER BY created_at ASC'
);

const byPhone = {};
const byEmail = {};
const duplicates = [];

for (const c of allCustomers) {
  const normPhone = c.phone ? c.phone.replace(/\D/g, '').slice(-10) : null;
  const normEmail = c.email ? c.email.toLowerCase().trim() : null;

  if (normPhone && normPhone.length === 10) {
    if (byPhone[normPhone]) {
      duplicates.push({ reason: 'phone', keep: byPhone[normPhone], merge: c });
    } else {
      byPhone[normPhone] = c;
    }
  }
  if (normEmail) {
    if (byEmail[normEmail]) {
      duplicates.push({ reason: 'email', keep: byEmail[normEmail], merge: c });
    } else {
      byEmail[normEmail] = c;
    }
  }
}

if (duplicates.length === 0) {
  console.log('\nNo other duplicate customers found.');
} else {
  console.log(`\nFound ${duplicates.length} duplicate(s):`);
  for (const d of duplicates) {
    console.log(`  [${d.reason}] KEEP: ${d.keep.first_name} ${d.keep.last_name} (${d.keep.email}) | MERGE: ${d.merge.first_name} ${d.merge.last_name} (${d.merge.email})`);

    // Re-link jobs and bookings from duplicate → keeper
    const [jr] = await conn.execute(
      'UPDATE schedule_jobs SET customer_id = ? WHERE customer_id = ?',
      [d.keep.customer_id, d.merge.customer_id]
    );
    const [br] = await conn.execute(
      'UPDATE customer_bookings SET customer_id = ? WHERE customer_id = ?',
      [d.keep.customer_id, d.merge.customer_id]
    ).catch(() => [{ affectedRows: 0 }]);
    const [dr] = await conn.execute(
      'DELETE FROM customers WHERE customer_id = ?',
      [d.merge.customer_id]
    );
    console.log(`    → jobs re-linked: ${jr.affectedRows}, bookings: ${br.affectedRows}, deleted: ${dr.affectedRows}`);
  }
}

// ── 4. Final verification ──────────────────────────────────────────────────────
const [adrianRows] = await conn.execute(
  "SELECT customer_id, first_name, last_name, email, phone FROM customers WHERE first_name LIKE '%Adrian%'"
);
console.log('\nFinal Adrian profiles:', JSON.stringify(adrianRows, null, 2));

const [aceJobs] = await conn.execute(
  "SELECT job_id, customer_name FROM schedule_jobs WHERE customer_name LIKE '%Ace%'"
);
console.log('Remaining Ace jobs:', aceJobs.length);

const [totalCustomers] = await conn.execute('SELECT COUNT(*) as cnt FROM customers');
console.log('Total customers remaining:', totalCustomers[0].cnt);

await conn.end();
