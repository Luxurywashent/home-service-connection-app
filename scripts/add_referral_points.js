/**
 * add_referral_points.js
 * Adds 1500 referral points to Ashley Ludlow (ashleyblake90@gmail.com)
 * by inserting an "earn" entry into the points_ledger table.
 */
const mysql = require('mysql2/promise');
require('dotenv').config({ path: '/home/ubuntu/team-luxury-wash/.env' });

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);

  // 1. Find the customer
  const [customers] = await conn.execute(
    "SELECT customer_id, first_name, last_name, email FROM customers WHERE email = ?",
    ['ashleyblake90@gmail.com']
  );

  if (customers.length === 0) {
    console.log('ERROR: No customer found with email ashleyblake90@gmail.com');
    await conn.end();
    return;
  }

  const customer = customers[0];
  console.log(`Found customer: ${customer.first_name} ${customer.last_name} (${customer.customer_id})`);

  // 2. Check current points balance
  const [earnRows] = await conn.execute(
    "SELECT COALESCE(SUM(points_ledger_val), 0) AS total FROM points_ledger WHERE customer_id_ledger = ? AND type_ledger = 'earn'",
    [customer.customer_id]
  );
  const [redeemRows] = await conn.execute(
    "SELECT COALESCE(SUM(points_ledger_val), 0) AS total FROM points_ledger WHERE customer_id_ledger = ? AND type_ledger = 'redeem'",
    [customer.customer_id]
  );
  const earned = Number(earnRows[0].total);
  const redeemed = Number(redeemRows[0].total);
  const currentBalance = earned - redeemed;
  console.log(`Current points balance: ${currentBalance} (earned: ${earned}, redeemed: ${redeemed})`);

  // 3. Insert 1500 earn entry
  const ledgerId = `ldg_${Date.now()}_referral_ashley`;
  await conn.execute(
    `INSERT INTO points_ledger (ledger_id, customer_id_ledger, type_ledger, points_ledger_val, description_ledger, created_at_ledger)
     VALUES (?, ?, 'earn', 1500, 'Referral bonus — manually awarded by admin', NOW())`,
    [ledgerId, customer.customer_id]
  );
  console.log(`\nInserted 1500 referral points (ledger_id: ${ledgerId})`);
  console.log(`New balance: ${currentBalance + 1500}`);

  await conn.end();
}

main().catch(console.error);
