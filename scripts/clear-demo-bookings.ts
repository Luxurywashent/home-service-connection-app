import { getDb } from "../server/db";
import { onlineBookings } from "../drizzle/schema";

async function main() {
  const db = await getDb();
  if (!db) {
    console.log("No database connection");
    return;
  }

  // Check what's in the table first
  const all = await db.select().from(onlineBookings);
  console.log("Total bookings in DB:", all.length);

  const bySource: Record<string, number> = {};
  const byLocation: Record<string, number> = {};
  for (const b of all) {
    const src = (b as any).source || "unknown";
    const loc = b.location || "unknown";
    bySource[src] = (bySource[src] || 0) + 1;
    byLocation[loc] = (byLocation[loc] || 0) + 1;
  }
  console.log("By source:", JSON.stringify(bySource, null, 2));
  console.log("By location:", JSON.stringify(byLocation, null, 2));

  // Show sample records
  console.log("\nSample records:");
  for (const b of all.slice(0, 5)) {
    console.log(`  ${b.bookingId} | ${b.firstName} ${b.lastName} | ${b.location} | ${(b as any).selectedDate} | source: ${(b as any).source}`);
  }

  // Delete ALL bookings (user confirmed to remove all demo data)
  console.log("\nDeleting all bookings...");
  await db.delete(onlineBookings);
  
  const remaining = await db.select().from(onlineBookings);
  console.log("Bookings remaining after delete:", remaining.length);
  console.log("Done!");
}

main().catch(console.error);
