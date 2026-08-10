import "./load-env.js";
import { getDb } from "../server/db";
import { moduleTools } from "../drizzle/schema";
import { sql } from "drizzle-orm";

const patches = [
  {
    name: "Air Compressor",
    url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/WBfGYvtAvqUlcTvs.jpg",
  },
  {
    name: "Ozone",
    url: "https://files.manuscdn.com/user_upload_by_module/session_file/310519663471903126/cKXgkBIvOYSvmWFd.jpg",
  },
];

async function main() {
  const db = await getDb();
  if (!db) { console.error("DB not available"); process.exit(1); }

  for (const patch of patches) {
    const result = await db.update(moduleTools)
      .set({ photoUrl: patch.url })
      .where(sql`LOWER(${moduleTools.name}) = LOWER(${patch.name})`);
    console.log(`✅ Patched all "${patch.name}" records`);
  }

  // Final check — any tools still without photos?
  const allTools = await db.select().from(moduleTools);
  const missing = allTools.filter(t => !t.photoUrl);
  if (missing.length === 0) {
    console.log("\n🎉 All tools now have photos!");
  } else {
    console.log(`\n⚠️  ${missing.length} tools still missing photos:`);
    missing.forEach(t => console.log(`   - "${t.name}" [${t.category}] (module: ${t.moduleKey})`));
  }

  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
