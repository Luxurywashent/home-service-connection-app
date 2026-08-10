import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { 
  employees, 
  dailyPerformance, 
  notifications, 
  timeOffRequests,
  notificationReadLog,
  challenges,
  quizQuestions,
  employeeProgression,
  doorHangerEntries,
  doorHangerGoals
} from "../drizzle/schema";

const DATABASE_URL = process.env.DATABASE_URL;

async function resetDatabase() {
  if (!DATABASE_URL) {
    console.error("DATABASE_URL not set");
    process.exit(1);
  }

  try {
    const db = drizzle(DATABASE_URL);
    
    console.log("Clearing all tables...");
    
    // Clear in order of dependencies
    await db.delete(notificationReadLog);
    await db.delete(doorHangerEntries);
    await db.delete(doorHangerGoals);
    await db.delete(employeeProgression);
    await db.delete(quizQuestions);
    await db.delete(challenges);
    await db.delete(timeOffRequests);
    await db.delete(notifications);
    await db.delete(dailyPerformance);
    await db.delete(employees);
    
    console.log("✓ All tables cleared successfully");
    process.exit(0);
  } catch (error) {
    console.error("Error resetting database:", error);
    process.exit(1);
  }
}

resetDatabase();
