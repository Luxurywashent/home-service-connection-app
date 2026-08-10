/**
 * One-time backfill: set createdBy = 'SALES001' on all schedule_jobs
 * where created_by IS NULL.
 *
 * Run: node scripts/backfill-created-by.mjs
 */
import { createRequire } from "module";
const require = createRequire(import.meta.url);
require("./load-env.js");

import mysql from "mysql2/promise";

const url = process.env.DATABASE_URL;
if (!url) { console.error("DATABASE_URL not set"); process.exit(1); }

// Parse mysql://user:pass@host:port/db?ssl=...
const match = url.match(/^mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
if (!match) { console.error("Cannot parse DATABASE_URL"); process.exit(1); }
const [, user, password, host, port, database] = match;

const conn = await mysql.createConnection({
  host, port: Number(port), user, password, database,
  ssl: { rejectUnauthorized: true },
});

const [result] = await conn.execute(
  "UPDATE schedule_jobs SET created_by = ? WHERE created_by IS NULL",
  ["SALES001"]
);
console.log(`Updated ${result.affectedRows} job(s) — createdBy set to SALES001.`);
await conn.end();
