import dotenv from 'dotenv';
import mysql from 'mysql2/promise';
import { createReadStream, writeFileSync } from 'fs';
import { join } from 'path';

dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// ─── Test 1: Portal message notification insert ───────────────────────────────
console.log('\n=== TEST 1: Portal message notification insert ===');
const [admins] = await conn.execute(
  "SELECT employee_id, full_name FROM employees WHERE role IN ('admin','office','operations_manager') LIMIT 3"
);

if (!admins.length) {
  console.log('❌ No admin employees found — cannot test');
} else {
  let allPassed = true;
  for (const admin of admins) {
    const testNotifId = `TEST_PORTAL_MSG_${Date.now()}_${admin.employee_id}`;
    try {
      await conn.execute(
        `INSERT INTO notifications (notification_id, employee_id, full_name, notification_type, title, message, created_by, status, requires_acknowledgment)
         VALUES (?, ?, ?, 'missed_call', ?, ?, 'Customer Portal', 'unread', 'no')`,
        [testNotifId, admin.employee_id, admin.full_name || admin.employee_id, `💬 New message from Test Customer`, 'Test portal message body']
      );
      console.log(`✅ PASS: Notification insert succeeded for ${admin.employee_id}`);
      await conn.execute('DELETE FROM notifications WHERE notification_id = ?', [testNotifId]);
    } catch (e) {
      console.log(`❌ FAIL: Notification insert failed for ${admin.employee_id}: ${e.message}`);
      allPassed = false;
    }
  }
  if (allPassed) console.log('✅ TEST 1 PASSED: All admin notification inserts work correctly');
}

// ─── Test 2: /api/upload endpoint ────────────────────────────────────────────
console.log('\n=== TEST 2: /api/upload endpoint ===');
const apiBase = process.env.EXPO_PUBLIC_API_BASE_URL || 'http://127.0.0.1:3000';

// Create a tiny test JPEG (1x1 pixel)
const tinyJpeg = Buffer.from(
  '/9j/4AAQSkZJRgABAQEASABIAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAABAAEDASIAAhEBAxEB/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/xAAUAQEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AJQAB/9k=',
  'base64'
);
const testImagePath = '/tmp/test-step-photo.jpg';
writeFileSync(testImagePath, tinyJpeg);

try {
  // Use FormData via fetch (Node 18+)
  const { FormData, File } = await import('node:buffer').then(() => globalThis).catch(() => ({}));
  
  // Fallback: use raw multipart/form-data with manual boundary
  const boundary = '----TestBoundary' + Date.now();
  const body = Buffer.concat([
    Buffer.from(`--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="test-step-photo.jpg"\r\nContent-Type: image/jpeg\r\n\r\n`),
    tinyJpeg,
    Buffer.from(`\r\n--${boundary}--\r\n`)
  ]);

  const response = await fetch(`${apiBase}/api/upload`, {
    method: 'POST',
    headers: {
      'Content-Type': `multipart/form-data; boundary=${boundary}`,
      'Content-Length': String(body.length),
    },
    body,
  });

  const text = await response.text();
  let json;
  try { json = JSON.parse(text); } catch { json = { raw: text }; }

  if (response.ok && json.url) {
    console.log(`✅ PASS: Upload endpoint returned URL: ${json.url}`);
    console.log('✅ TEST 2 PASSED: /api/upload works correctly');
  } else {
    console.log(`❌ FAIL: Upload returned status ${response.status}: ${text}`);
  }
} catch (e) {
  console.log(`❌ FAIL: Upload request failed: ${e.message}`);
}

await conn.end();
console.log('\n=== Tests complete ===');
