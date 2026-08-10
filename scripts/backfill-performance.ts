/**
 * Backfill script: sync daily_performance records from all existing schedule_jobs.
 * Run once with: npx tsx scripts/backfill-performance.ts
 */
import "../scripts/load-env.js";
import { syncPerformanceFromJobs, getAllActiveEmployees } from "../server/db";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { scheduleJobs } from "../drizzle/schema";
import { ne } from "drizzle-orm";

async function main() {
  const connection = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(connection);

  // Get all unique (assignedTo, date) pairs from non-cancelled jobs
  const jobs = await db.select({
    assignedTo: scheduleJobs.assignedTo,
    date: scheduleJobs.date,
  }).from(scheduleJobs).where(ne(scheduleJobs.status, "cancelled"));

  const pairs = new Map<string, { assignedTo: string; date: string }>();
  for (const job of jobs) {
    if (!job.assignedTo || !job.date) continue;
    const key = `${job.assignedTo}::${job.date}`;
    if (!pairs.has(key)) {
      pairs.set(key, { assignedTo: job.assignedTo, date: job.date });
    }
  }

  console.log(`Found ${pairs.size} unique (assignedTo, date) pairs to backfill.`);

  let success = 0;
  let skipped = 0;
  for (const { assignedTo, date } of pairs.values()) {
    try {
      await syncPerformanceFromJobs(assignedTo, date);
      console.log(`  ✓ Synced ${assignedTo} on ${date}`);
      success++;
    } catch (e) {
      console.error(`  ✗ Failed ${assignedTo} on ${date}:`, e);
      skipped++;
    }
  }

  console.log(`\nBackfill complete: ${success} synced, ${skipped} failed.`);
  await connection.end();
}

main().catch(console.error);
