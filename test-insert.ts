import { getDb, createDoorHangerEntry } from "./server/db";

async function test() {
  try {
    const testEntry = {
      entryId: "TEST_" + Date.now(),
      employeeId: "DHR001",
      date: "2026-04-03",
      address: "123 Main St",
      city: "Downtown",
      outreachType: "door_hangers" as const,
      quantityDistributed: 5,
      notes: "Test entry",
      photoUrls: undefined
    };
    
    console.log("Attempting to insert:", testEntry);
    await createDoorHangerEntry(testEntry);
    console.log("Insert successful!");
  } catch (error) {
    console.error("Insert failed:", error instanceof Error ? error.message : error);
  }
  process.exit(0);
}

test();
