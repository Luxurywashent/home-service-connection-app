// @ts-ignore
import "./load-env.js";
// @ts-ignore
import { db } from "../server/db";
import { moduleTools } from "../drizzle/schema";
import { like, or, sql } from "drizzle-orm";

async function main() {
  const rows = await db
    .select()
    .from(moduleTools)
    .where(
      or(
        like(sql`LOWER(${moduleTools.name})`, "%red%"),
        like(sql`LOWER(${moduleTools.name})`, "%sealant%"),
        like(sql`LOWER(${moduleTools.name})`, "%microfiber%"),
        like(sql`LOWER(${moduleTools.name})`, "%tornador%"),
        like(sql`LOWER(${moduleTools.name})`, "%tornado%")
      )
    );

  console.log("MATCHING TOOLS:");
  console.log(JSON.stringify(rows, null, 2));
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
