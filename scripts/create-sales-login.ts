/**
 * One-time script: creates a Sales team member login in the database.
 * Run with: npx tsx scripts/create-sales-login.ts
 */
import "./load-env.js";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { employees } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection);

  const salesMember = {
    employeeId: "SALES001",
    fullName: "Sales Rep",
    email: "sales@luxurywashonwheels.com",
    pin: "7777",
    role: "sales" as const,
    city: "Crestview",
    activeStatus: "active" as const,
    hireDate: "2026-04-07",
    phoneNumber: "",
  };

  // Check if already exists
  const existing = await db
    .select()
    .from(employees)
    .where(eq(employees.employeeId, salesMember.employeeId));

  if (existing.length > 0) {
    // Update role to sales in case it was created with wrong role
    await db
      .update(employees)
      .set({ role: "sales", pin: salesMember.pin, activeStatus: "active" })
      .where(eq(employees.employeeId, salesMember.employeeId));
    console.log("✅ Updated existing SALES001 to role=sales, pin=7777");
  } else {
    await db.insert(employees).values(salesMember);
    console.log("✅ Created SALES001 — Sales Rep, PIN: 7777");
  }

  await connection.end();
}

main().catch((err) => {
  console.error("❌ Error:", err);
  process.exit(1);
});
