import { getDb } from './server/db';
import { scheduleJobs } from './drizzle/schema';
import { desc } from 'drizzle-orm';

async function main() {
  const db = await getDb();
  if (!db) { console.log('no db connection'); return; }
  const rows = await db.select({
    jobId: scheduleJobs.jobId,
    location: scheduleJobs.location,
    date: scheduleJobs.date,
    customerName: scheduleJobs.customerName,
    source: scheduleJobs.source,
    assignedTo: scheduleJobs.assignedTo,
    status: scheduleJobs.status,
  }).from(scheduleJobs).orderBy(desc(scheduleJobs.date)).limit(20);
  console.log('Recent jobs:', JSON.stringify(rows, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
