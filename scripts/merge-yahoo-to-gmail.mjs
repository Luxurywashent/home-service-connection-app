import mysql from "mysql2/promise";
import dotenv from "dotenv";
dotenv.config({ path: ".env" });

const pool = mysql.createPool({ uri: process.env.DATABASE_URL, multipleStatements: true });

const YAHOO_EMAIL = "lilmerge4@yahoo.com";
const GMAIL_EMAIL = "lilmerge4@gmail.com";

async function run() {
  const conn = await pool.getConnection();
  try {
    // Find both profiles
    const [[yahoo]] = await conn.query("SELECT * FROM customers WHERE email = ?", [YAHOO_EMAIL]);
    const [[gmail]] = await conn.query("SELECT * FROM customers WHERE email = ?", [GMAIL_EMAIL]);

    if (!yahoo) { console.log("Yahoo profile not found — nothing to merge."); return; }
    if (!gmail) { console.log("Gmail profile not found — cannot merge."); return; }

    console.log(`Yahoo ID: ${yahoo.customer_id}`);
    console.log(`Gmail ID: ${gmail.customer_id}`);

    // 1. Transfer customer_portal_bookings
    const [bookingResult] = await conn.query(
      "UPDATE customer_portal_bookings SET customer_id = ? WHERE customer_id = ?",
      [gmail.customer_id, yahoo.customer_id]
    );
    console.log(`Transferred ${bookingResult.affectedRows} portal bookings`);

    // 2. Transfer customer_vehicles
    const [vehicleResult] = await conn.query(
      "UPDATE customer_vehicles SET customer_id = ? WHERE customer_id = ?",
      [gmail.customer_id, yahoo.customer_id]
    );
    console.log(`Transferred ${vehicleResult.affectedRows} vehicles`);

    // 3. Transfer customer_addresses
    const [addressResult] = await conn.query(
      "UPDATE customer_addresses SET customer_id = ? WHERE customer_id = ?",
      [gmail.customer_id, yahoo.customer_id]
    );
    console.log(`Transferred ${addressResult.affectedRows} addresses`);

    // 4. Transfer schedule_jobs linked to Yahoo customer_id
    const [jobResult] = await conn.query(
      "UPDATE schedule_jobs SET customer_id = ?, customer_email = ? WHERE customer_id = ?",
      [gmail.customer_id, GMAIL_EMAIL, yahoo.customer_id]
    );
    console.log(`Transferred ${jobResult.affectedRows} schedule jobs`);

    // 5. Update any schedule_jobs that have the Yahoo email but no customer_id link
    const [emailJobResult] = await conn.query(
      "UPDATE schedule_jobs SET customer_id = ?, customer_email = ? WHERE customer_email = ? AND (customer_id IS NULL OR customer_id != ?)",
      [gmail.customer_id, GMAIL_EMAIL, YAHOO_EMAIL, gmail.customer_id]
    );
    console.log(`Updated ${emailJobResult.affectedRows} additional jobs by email`);

    // 6. Delete the Yahoo profile
    const [deleteResult] = await conn.query(
      "DELETE FROM customers WHERE customer_id = ?",
      [yahoo.customer_id]
    );
    console.log(`Deleted Yahoo profile: ${deleteResult.affectedRows} row(s)`);

    console.log("\n✅ Merge complete. All data now under lilmerge4@gmail.com");
  } finally {
    conn.release();
    await pool.end();
  }
}

run().catch(e => { console.error("Error:", e.message); process.exit(1); });
