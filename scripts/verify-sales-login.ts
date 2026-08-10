import "./load-env.js";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { employees } from "../drizzle/schema";
import { eq } from "drizzle-orm";

async function verify() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection);
  const result = await db.select().from(employees).where(eq(employees.employeeId, "SALES001"));
  if (result.length > 0) {
    const emp = result[0];
    console.log(`✅ SALES001 found: ${emp.fullName}, role=${emp.role}, pin=${emp.pin}, status=${emp.activeStatus}`);
  } else {
    console.log("❌ SALES001 not found");
  }
  await connection.end();
}

verify().catch(console.error);
