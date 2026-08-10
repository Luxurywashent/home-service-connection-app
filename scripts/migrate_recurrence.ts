import "./load-env.js";
import { createConnection } from "mysql2/promise";

(async () => {
  const url = process.env.DATABASE_URL;
  if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }
  const conn = await createConnection(url);
  try {
    await conn.execute("ALTER TABLE schedule_jobs ADD COLUMN recurrence_rule TEXT");
    console.log("Added recurrence_rule ✓");
  } catch(e: any) { console.log("recurrence_rule:", e.message); }
  try {
    await conn.execute("ALTER TABLE schedule_jobs ADD COLUMN recurrence_parent_id VARCHAR(64)");
    console.log("Added recurrence_parent_id ✓");
  } catch(e: any) { console.log("recurrence_parent_id:", e.message); }
  await conn.end();
  console.log("Done");
})();
