import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Get a real step ID to test with
const [steps] = await conn.query('SELECT step_id, title, vehicle_image_url FROM interactive_module_steps LIMIT 3');
console.log('\n=== existing steps ===');
console.log(JSON.stringify(steps, null, 2));

if (steps.length > 0) {
  const stepId = steps[0].step_id;
  const testUrl = 'https://d1234.cloudfront.net/uploads/step-photo.jpg';
  
  // Simulate what updateInteractiveStep does
  try {
    await conn.query(
      'UPDATE interactive_module_steps SET vehicle_image_url = ? WHERE step_id = ?',
      [testUrl, stepId]
    );
    console.log('\n✅ UPDATE with vehicleImageUrl succeeded for step:', stepId);
    
    // Revert
    await conn.query(
      'UPDATE interactive_module_steps SET vehicle_image_url = ? WHERE step_id = ?',
      [steps[0].vehicle_image_url ?? null, stepId]
    );
    console.log('✅ Reverted successfully');
  } catch (e) {
    console.log('\n❌ UPDATE failed:', e.message);
  }
}

// Also test the tRPC endpoint via HTTP
try {
  const resp = await fetch('http://127.0.0.1:3000/api/trpc/training.updateInteractiveStep', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      json: {
        stepId: steps[0]?.step_id ?? 'nonexistent',
        vehicleImageUrl: 'https://example.com/test.jpg'
      }
    })
  });
  const json = await resp.json();
  console.log('\n=== tRPC response ===');
  console.log(JSON.stringify(json, null, 2));
} catch (e) {
  console.log('\n❌ tRPC call failed:', e.message);
}

await conn.end();
