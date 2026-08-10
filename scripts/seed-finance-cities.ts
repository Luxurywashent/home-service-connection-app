// Seed default finance cities if they don't already exist
import "./load-env.js";
import { drizzle } from "drizzle-orm/mysql2";
import mysql from "mysql2/promise";
import { financeCities } from "../drizzle/schema";
import { randomBytes } from "crypto";

const CITIES = [
  { name: "Destin",    slug: "destin",    sortOrder: 1 },
  { name: "FWB",       slug: "fwb",       sortOrder: 2 },
  { name: "Niceville", slug: "niceville", sortOrder: 3 },
  { name: "Crestview", slug: "crestview", sortOrder: 4 },
  { name: "Pensacola", slug: "pensacola", sortOrder: 5 },
];

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL!);
  const db = drizzle(conn);

  const existing = await db.select({ slug: financeCities.slug }).from(financeCities);
  const existingSlugs = new Set(existing.map((r) => r.slug));

  let added = 0;
  for (const city of CITIES) {
    if (!existingSlugs.has(city.slug)) {
      const cityId = `FCITY_${Date.now()}_${randomBytes(4).toString("hex")}`;
      await db.insert(financeCities).values({ cityId, name: city.name, slug: city.slug, sortOrder: city.sortOrder });
      console.log(`✅ Added: ${city.name}`);
      added++;
    } else {
      console.log(`⏭  Already exists: ${city.name}`);
    }
  }

  console.log(`\nDone. ${added} cities added.`);
  await conn.end();
}

main().catch((e) => { console.error(e); process.exit(1); });
