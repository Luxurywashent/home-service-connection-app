import { drizzle } from "drizzle-orm/mysql2";
import { employees } from "./drizzle/schema";

const DATABASE_URL = process.env.DATABASE_URL;

async function verify() {
  try {
    const db = drizzle(DATABASE_URL!);
    const result = await db.select().from(employees);
    console.log(`Total employees: ${result.length}`);
    result.forEach(emp => {
      console.log(`- ${emp.employeeId}: ${emp.fullName} (${emp.role})`);
    });
    process.exit(0);
  } catch (error) {
    console.error("Error:", error);
    process.exit(1);
  }
}

verify();
