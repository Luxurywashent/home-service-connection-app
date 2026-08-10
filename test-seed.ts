import { seedDemoData, seedDoorHangerData } from "./server/db";

async function testSeed() {
  try {
    console.log("Seeding demo data...");
    const result1 = await seedDemoData();
    console.log("Demo data result:", result1);
    
    console.log("Seeding door hanger data...");
    await seedDoorHangerData();
    console.log("Door hanger data seeded!");
    
    process.exit(0);
  } catch (error) {
    console.error("Seed failed:", error);
    process.exit(1);
  }
}

testSeed();
