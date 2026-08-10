// Regenerate Megan Barys's missing VIP schedule_jobs (contract 150002)
// Visit 1 = $1200, visits 2-12 = $0
import mysql from "mysql2/promise";
import { upsertScheduleJob } from "../server/db";

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);

  // Get contract + visits
  const [cRows]: any = await conn.execute(
    "SELECT * FROM vip_contracts WHERE id = 150002"
  );
  const c = cRows[0];
  console.log("Contract:", c.contract_number, c.customer_name, "$" + c.total_price);

  const [visits]: any = await conn.execute(
    "SELECT * FROM vip_visits WHERE contract_id = 150002 ORDER BY visit_number"
  );
  console.log("Visits:", visits.length);

  const ADD_ONS_BY_VISIT: Record<number, string[]> = {
    1: ["Paint Sealant", "Leather Deep Clean", "Leather Condition"],
    5: ["Leather Deep Clean"],
    7: ["Paint Sealant", "Leather Condition"],
    9: ["Leather Deep Clean"],
  };

  for (const v of visits) {
    const visitNum = v.visit_number;
    const addOns = ADD_ONS_BY_VISIT[visitNum] ?? [];
    const addOnLabel = addOns.length > 0 ? ` + ${addOns.join(", ")}` : "";
    const jobId = v.schedule_job_id;
    const dateStr = typeof v.scheduled_date === "string"
      ? v.scheduled_date.split("T")[0]
      : new Date(v.scheduled_date).toISOString().split("T")[0];

    // Visit 1 = full contract total, rest = $0
    const price = visitNum === 1 ? Number(c.total_price).toFixed(2) : "0.00";

    try {
      await upsertScheduleJob({
        jobId,
        location: "niceville",
        date: dateStr,
        timeSlot: null as any,
        startHour: null as any,
        endHour: null as any,
        customerName: c.customer_name,
        customerPhone: c.customer_phone ?? null,
        customerEmail: c.customer_email ?? null,
        vehicleType: c.vehicle_description ?? null,
        packageType: "luxury",
        serviceDescription: `VIP Visit ${visitNum} of 12 — ${c.contract_number}${addOnLabel}`,
        selectedAddons: JSON.stringify(addOns),
        totalPrice: price,
        status: "pending",
        source: "manual",
        notes: `VIP Program — Contract ${c.contract_number}. Visit ${visitNum} of 12 (monthly).`,
        tags: JSON.stringify(["VIP"]),
        leadSource: "VIP Program",
      } as any);
      console.log(`  v${visitNum} (${jobId}): created at $${price} on ${dateStr}`);
    } catch (err: any) {
      console.error(`  v${visitNum}: FAILED — ${err.message}`);
    }
  }

  await conn.end();
  console.log("\nDone!");
}

main().catch((e) => { console.error("ERROR:", e.message); process.exit(1); });
