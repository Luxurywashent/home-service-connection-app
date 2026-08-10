/**
 * One-time migration: recalculate all efficiency_percent values in daily_performance
 * using the correct formula: (revenue / hours) / 100 * 100
 * Target: $100/hr = 100% efficiency
 * e.g. $800 revenue / 8 hrs = $100/hr = 100% efficiency
 */
import "../scripts/load-env.js";
import { getDb } from "../server/db";
import { dailyPerformance } from "../drizzle/schema";
import { sql } from "drizzle-orm";

async function fixEfficiency() {
  const db = await getDb();
  if (!db) {
    console.error("Could not connect to database");
    process.exit(1);
  }

  const records = await db
    .select({
      id: dailyPerformance.id,
      recordId: dailyPerformance.recordId,
      fullName: dailyPerformance.fullName,
      hoursWorked: dailyPerformance.hoursWorked,
      revenueProduced: dailyPerformance.revenueProduced,
      efficiencyPercent: dailyPerformance.efficiencyPercent,
    })
    .from(dailyPerformance);

  console.log(`Found ${records.length} records to process\n`);

  let updated = 0;
  let skipped = 0;

  for (const record of records) {
    const hours = parseFloat(record.hoursWorked ?? "0");
    const revenue = parseFloat(record.revenueProduced ?? "0");

    if (hours <= 0) {
      console.log(`SKIP  ${record.fullName} | ${record.recordId} | 0 hrs`);
      skipped++;
      continue;
    }

    // Correct formula: revenue / hours / 100 * 100 = revenue / hours
    const newEfficiency = (revenue / hours) / 100 * 100;
    const oldEfficiency = parseFloat(record.efficiencyPercent ?? "0");

    console.log(
      `UPDATE ${record.fullName} | $${revenue}/${hours}hrs | ` +
      `${oldEfficiency.toFixed(2)}% → ${newEfficiency.toFixed(2)}%`
    );

    await db
      .update(dailyPerformance)
      .set({ efficiencyPercent: newEfficiency.toFixed(2) })
      .where(sql`${dailyPerformance.id} = ${record.id}`);

    updated++;
  }

  console.log(`\nDone. Updated: ${updated}, Skipped (0 hrs): ${skipped}`);
  process.exit(0);
}

fixEfficiency().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
