import { getDb } from "../server/db";
import { employeeProgression } from "../drizzle/schema";

async function clearQuizAttempts() {
  const db = await getDb();
  if (!db) {
    console.error("Failed to connect to database");
    process.exit(1);
  }

  try {
    console.log("Clearing all quiz attempts...");
    await db.delete(employeeProgression);
    console.log("✓ Cleared all quiz attempts");
    console.log("\n✅ Quiz attempts cleared successfully!");
    console.log("Employees can now take the challenge fresh.");
  } catch (error) {
    console.error("Error clearing quiz attempts:", error);
    process.exit(1);
  }
}

clearQuizAttempts();
