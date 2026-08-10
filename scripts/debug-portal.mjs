import mysql from 'mysql2/promise';
import * as dotenv from 'dotenv';
dotenv.config();

const conn = await mysql.createConnection(process.env.DATABASE_URL);

// Check if the customer exists in customers table
const [custs] = await conn.query(
  "SELECT id, customer_id, first_name, last_name, email FROM customers WHERE customer_id = 'cust_1777691854927_ad341273'"
);
console.log('\n=== customer lookup ===');
console.log(JSON.stringify(custs, null, 2));

// Try INNER JOIN (current query)
const [innerJoin] = await conn.query(`
  SELECT pm.customer_id, c.first_name, c.last_name, COUNT(*) as msg_count
  FROM portal_messages pm
  INNER JOIN customers c ON pm.customer_id = c.customer_id
  GROUP BY pm.customer_id, c.first_name, c.last_name
`);
console.log('\n=== INNER JOIN result ===');
console.log(JSON.stringify(innerJoin, null, 2));

// Try LEFT JOIN (shows all messages even without matching customer)
const [leftJoin] = await conn.query(`
  SELECT pm.customer_id, c.first_name, c.last_name, COUNT(*) as msg_count
  FROM portal_messages pm
  LEFT JOIN customers c ON pm.customer_id = c.customer_id
  GROUP BY pm.customer_id, c.first_name, c.last_name
`);
console.log('\n=== LEFT JOIN result ===');
console.log(JSON.stringify(leftJoin, null, 2));

// Check unread count
const [unread] = await conn.query(
  "SELECT COUNT(*) as unread FROM portal_messages WHERE is_read = 0 AND direction = 'inbound'"
);
console.log('\n=== unread count ===');
console.log(JSON.stringify(unread, null, 2));

await conn.end();
