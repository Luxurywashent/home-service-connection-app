/**
 * One-time script: Mark all chat messages and job events as read/seen
 * for all detailers in the system.
 */
import mysql from 'mysql2/promise';

const conn = await mysql.createConnection(process.env.DATABASE_URL || '');

try {
  // 1. Get all detailer employee_ids
  const [detailers] = await conn.execute(
    'SELECT employee_id, full_name FROM employees WHERE role = ?',
    ['detailer']
  );
  console.log(`Found ${detailers.length} detailers:`, detailers.map(d => d.full_name));

  const now = new Date();

  for (const detailer of detailers) {
    const eid = detailer.employee_id;

    // 2. Get all distinct channels from team_chat_messages
    const [channels] = await conn.execute(
      'SELECT DISTINCT channel FROM team_chat_messages'
    );

    // 3. Upsert chat_last_seen for every channel
    for (const { channel } of channels) {
      await conn.execute(
        `INSERT INTO chat_last_seen (employee_id, channel_key, last_seen_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)`,
        [eid, channel, now]
      );
    }

    // 4. Also upsert for DM channels involving this detailer
    const [dmChannels] = await conn.execute(
      `SELECT DISTINCT channel FROM team_chat_messages
       WHERE channel LIKE CONCAT('dm_', ?, '_%') OR channel LIKE CONCAT('dm_%_', ?, '')`,
      [eid, eid]
    );
    for (const { channel } of dmChannels) {
      await conn.execute(
        `INSERT INTO chat_last_seen (employee_id, channel_key, last_seen_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE last_seen_at = VALUES(last_seen_at)`,
        [eid, channel, now]
      );
    }

    // 5. Mark all job events as seen for this detailer
    const [jobEvents] = await conn.execute(
      'SELECT id FROM job_events WHERE created_at_je <= ?',
      [now]
    );
    for (const { id } of jobEvents) {
      await conn.execute(
        `INSERT INTO job_event_seen (job_event_id, employee_id, seen_at)
         VALUES (?, ?, ?)
         ON DUPLICATE KEY UPDATE seen_at = VALUES(seen_at)`,
        [id, eid, now]
      );
    }

    console.log(`✓ Marked all read for ${detailer.full_name} (${eid}) — ${channels.length + dmChannels.length} channels, ${jobEvents.length} job events`);
  }

  console.log('\nDone! All detailers have been marked as fully caught up.');
} finally {
  await conn.end();
}
