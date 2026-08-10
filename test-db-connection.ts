import { getDb } from "./server/db";

async function test() {
  try {
    const db = await getDb();
    if (!db) {
      console.log("Database connection failed");
      return;
    }
    console.log("Database connected successfully");
  } catch (error) {
    console.error("Error:", error);
  }
}

test();
