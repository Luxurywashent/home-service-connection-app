import mysql from 'mysql2/promise';
import { config } from 'dotenv';
config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);
await conn.execute(`ALTER TABLE \`notifications\` MODIFY COLUMN \`notification_type\` enum('qc_issue','write_up','missed_step','coaching_note','time_off_update','company_announcement','clock_alert','clock_check_5pm','callback_reminder','job_transfer','ai_booking') NOT NULL`);
console.log('Migration applied: ai_booking enum added');
await conn.end();
