import mysql from 'mysql2/promise';
import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, '../.env') });

const url = process.env.DATABASE_URL;
const match = url.match(/mysql:\/\/([^:]+):([^@]+)@([^:]+):(\d+)\/([^?]+)/);
const [, user, password, host, port, database] = match;
const conn = await mysql.createConnection({ host, port: parseInt(port), user, password, database, ssl: { rejectUnauthorized: false } });

// Check price book table
const [tables] = await conn.execute(`SHOW TABLES LIKE '%price%'`);
console.log('Price-related tables:', tables.map(r => Object.values(r)[0]));

// Check price book entries
try {
  const [pb] = await conn.execute(`SELECT * FROM price_book LIMIT 30`);
  console.log('\n=== Price Book ===');
  for (const r of pb) console.log(JSON.stringify(r));
} catch (e) {
  console.log('No price_book table:', e.message);
}

// Check what pb_mpn0yohe0qes resolves to in any config table
try {
  const [cfg] = await conn.execute(`SELECT * FROM app_config WHERE config_key LIKE '%vip%' OR config_key LIKE '%mpn%' OR config_value LIKE '%mpn%' LIMIT 20`);
  console.log('\n=== App Config VIP entries ===');
  for (const r of cfg) console.log(JSON.stringify(r));
} catch (e) {
  console.log('No app_config table');
}

// Check vip_plans or similar
try {
  const [vip] = await conn.execute(`SELECT * FROM vip_plans LIMIT 20`);
  console.log('\n=== VIP Plans ===');
  for (const r of vip) console.log(JSON.stringify(r));
} catch (e) {
  console.log('No vip_plans table');
}

await conn.end();
