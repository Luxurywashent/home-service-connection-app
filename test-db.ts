import { drizzle } from "drizzle-orm/mysql2";
import { employees } from "./drizzle/schema";

const DATABASE_URL = process.env.DATABASE_URL;

async function testConnection() {
  try {
    console.log("Connecting to database...");
    const db = drizzle(DATABASE_URL!);
    
    console.log("Querying employees...");
    const result = await db.select().from(employees).limit(1);
    console.log("Connection successful!");
    console.log("Employee count:", result.length);
    process.exit(0);
  } catch (error) {
    console.error("Connection failed:", error);
    process.exit(1);
  }
}

testConnection();
