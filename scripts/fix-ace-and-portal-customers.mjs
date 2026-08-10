import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ── 1. Fix "Ace miller" → "Adrian Miller" in online_bookings ──────────────────
const [nameFixed] = await conn.execute(
  "UPDATE online_bookings SET first_name = 'Adrian', last_name = 'Miller' WHERE first_name = 'Ace' AND last_name = 'miller'"
);
console.log('Online booking name fixed (Ace → Adrian):', nameFixed.affectedRows);

// Also fix any "Adrian miller" (lowercase) → "Adrian Miller"
const [caseFixed] = await conn.execute(
  "UPDATE online_bookings SET last_name = 'Miller' WHERE first_name = 'Adrian' AND last_name = 'miller'"
);
console.log('Online booking case fixed (miller → Miller):', caseFixed.affectedRows);

// Also fix the billing@luxurywashonwheels.com email on the online booking to use the portal email
// (so the customer list deduplicates correctly by phone)
// No email change needed — dedup is by phone (8503980888) which already matches

// ── 2. Verify final state ─────────────────────────────────────────────────────
const [check] = await conn.execute(
  "SELECT booking_id, first_name, last_name, email, phone FROM online_bookings WHERE phone LIKE '%3980888%'"
);
console.log('\nOnline bookings for 398-0888:');
check.forEach(r => console.log(' -', r.booking_id, r.first_name, r.last_name, r.email, r.phone));

await conn.end();
console.log('\nDone.');
