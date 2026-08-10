/**
 * fix_billy_payments.js
 * 
 * 1. Shows all of Billy's current investment payments
 * 2. Updates the second payment's due_date from 2026-06-11 to 2026-06-22
 * 3. Inserts a new $2,500 payment for 2026-07-03
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '/home/ubuntu/team-luxury-wash/.env' });

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  console.log('=== Current Billy Brown payments ===');
  const [pmts] = await conn.execute(
    'SELECT id, payment_id, due_date, paid_date, amount_due, amount_paid, status FROM investment_payments WHERE investment_id = ? ORDER BY due_date ASC, id ASC',
    ['invst_1782440058977_skjx8w']
  );
  console.log(JSON.stringify(pmts, null, 2));
  
  // Find the second payment (the one we need to change to June 22)
  // Based on the data, id=30002 is the second payment with due_date 2026-06-12
  // The user wants to change it to 2026-06-22
  const secondPayment = pmts.find(p => p.id === 30002);
  if (secondPayment) {
    console.log('\n=== Updating payment id=30002 due_date to 2026-06-22 ===');
    await conn.execute(
      'UPDATE investment_payments SET due_date = ?, paid_date = ?, updated_at = NOW() WHERE id = ?',
      ['2026-06-22', '2026-06-22', 30002]
    );
    console.log('Updated!');
  } else {
    console.log('WARNING: Could not find payment id=30002');
  }
  
  // Check if a July 3 payment already exists
  const [existing] = await conn.execute(
    'SELECT id FROM investment_payments WHERE investment_id = ? AND due_date = ?',
    ['invst_1782440058977_skjx8w', '2026-07-03']
  );
  
  if (existing.length > 0) {
    console.log('\nJuly 3 payment already exists, skipping insert.');
  } else {
    // Insert new $2,500 payment for July 3
    const paymentId = `pmt_${Date.now()}_july3`;
    console.log('\n=== Inserting new $2,500 payment for 2026-07-03 ===');
    await conn.execute(
      `INSERT INTO investment_payments 
       (payment_id, investment_id, due_date, paid_date, amount_due, amount_paid, status, created_at, updated_at)
       VALUES (?, ?, '2026-07-03', '2026-07-03', 2500.00, 2500.00, 'completed', NOW(), NOW())`,
      [paymentId, 'invst_1782440058977_skjx8w']
    );
    console.log(`Inserted payment ${paymentId}`);
  }
  
  console.log('\n=== Updated Billy Brown payments ===');
  const [updated] = await conn.execute(
    'SELECT id, payment_id, due_date, paid_date, amount_due, amount_paid, status FROM investment_payments WHERE investment_id = ? ORDER BY due_date ASC, id ASC',
    ['invst_1782440058977_skjx8w']
  );
  console.log(JSON.stringify(updated, null, 2));
  
  await conn.end();
}

main().catch(console.error);
