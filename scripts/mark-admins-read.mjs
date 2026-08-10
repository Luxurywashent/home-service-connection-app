import mysql from 'mysql2/promise';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
require('./load-env.js');

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get all admin/ops/office employee IDs
const [admins] = await conn.execute(
  "SELECT id, full_name, role FROM employees WHERE role IN ('admin', 'operations_manager', 'office') AND active_status = 1"
);
console.log(`Found ${admins.length} admin/ops/office employees:`, admins.map(a => `${a.full_name} (${a.role})`).join(', '));

if (admins.length === 0) {
  console.log('No admins found.');
  await conn.end();
  process.exit(0);
}

const adminIds = admins.map(a => a.id);

// Get the latest message timestamp across all channels
const [latestMsg] = await conn.execute(
  'SELECT MAX(created_at) as latest FROM team_chat_messages'
);
const latestTime = latestMsg[0].latest || new Date();
console.log('Latest message time:', latestTime);

// Get all distinct channels
const [channels] = await conn.execute(
  'SELECT DISTINCT channel FROM team_chat_messages'
);
console.log('Channels:', channels.map(c => c.channel).join(', '));

// Upsert chat_last_seen for each admin x each channel
let chatUpdated = 0;
for (const admin of admins) {
  for (const { channel } of channels) {
    await conn.execute(
      `INSERT INTO chat_last_seen (employee_id, channel_key, last_seen_at)
       VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)`,
      [admin.id, channel, latestTime]
    );
    chatUpdated++;
  }
}
console.log(`Marked ${chatUpdated} channel/admin combinations as read.`);

// Mark all job events as seen for admins
const [jobEvents] = await conn.execute(
  'SELECT id FROM job_events ORDER BY created_at_je DESC LIMIT 200'
);
console.log(`Found ${jobEvents.length} job events to mark as seen.`);

let jobEventsSeen = 0;
for (const admin of admins) {
  for (const event of jobEvents) {
    await conn.execute(
      `INSERT IGNORE INTO job_event_seen (employee_id, job_event_id)
       VALUES (?, ?)`,
      [admin.id, event.id]
    );
    jobEventsSeen++;
  }
}
console.log(`Marked ${jobEventsSeen} job event/admin combinations as seen.`);

await conn.end();
console.log('Done! All admins are now fully caught up.');
