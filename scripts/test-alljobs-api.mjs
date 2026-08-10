import mysql from 'mysql2/promise';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// Load .env manually
const envPath = resolve(process.cwd(), '.env');
try {
  const envContent = readFileSync(envPath, 'utf8');
  for (const line of envContent.split('\n')) {
    const match = line.match(/^([^#=]+)=(.*)$/);
    if (match) {
      process.env[match[1].trim()] = match[2].trim().replace(/^["']|["']$/g, '');
    }
  }
} catch {}

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get the most recent session for the test customer
const [sessions] = await conn.execute(`
  SELECT session_token, customer_id, expires_at
  FROM customer_sessions
  WHERE customer_id = 'cust_1783979531041_66146be2'
  ORDER BY created_at DESC
  LIMIT 1
`);
console.log('Sessions:', JSON.stringify(sessions, null, 2));

if (sessions.length > 0) {
  const token = sessions[0].session_token;
  console.log('\nTesting allJobs API with token:', token.substring(0, 20) + '...');
  
  const url = `http://127.0.0.1:3000/api/trpc/customer.allJobs?input=${encodeURIComponent(JSON.stringify({ json: { token } }))}`;
  const response = await fetch(url);
  const data = await response.json();
  
  if (data.result?.data?.json) {
    const jobs = data.result.data.json;
    console.log('\nTotal jobs returned:', jobs.length);
    const vipCreditJobs = jobs.filter(j => j.packageName?.includes('VIP') || j.packageName?.includes('Basic'));
    console.log('VIP/Basic jobs:', JSON.stringify(vipCreditJobs, null, 2));
    
    // Check if any job has source = schedule (vip_credit gets mapped to schedule)
    const scheduleJobs = jobs.filter(j => j.source === 'schedule');
    console.log('\nSchedule source jobs count:', scheduleJobs.length);
    if (scheduleJobs.length > 0) {
      console.log('Schedule jobs:', JSON.stringify(scheduleJobs.map(j => ({ id: j.id, packageName: j.packageName, date: j.date, status: j.status })), null, 2));
    }
  } else {
    console.log('API response:', JSON.stringify(data, null, 2));
  }
}

await conn.end();
