import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// Load env
require('./load-env.js');

const mysql = require('mysql2/promise');
const nodemailer = require('nodemailer');

const API_BASE = process.env.EXPO_PUBLIC_API_BASE_URL || 'https://luxwashapp-n2wveyqg.manus.space';

async function main() {
  const conn = await mysql.createConnection(process.env.DATABASE_URL);
  
  const [rows] = await conn.execute(
    `SELECT id, contract_number, customer_name, customer_email, vehicle_description, signature_token, program_type, status 
     FROM vip_contracts 
     WHERE contract_number IN ('VIP-20260707-8763', 'VIP-20260707-8247')`
  );
  
  console.log(`Found ${rows.length} contracts`);
  
  const transporter = nodemailer.createTransport({
    service: 'gmail',
    auth: {
      user: process.env.GMAIL_USER,
      pass: process.env.GMAIL_APP_PASSWORD,
    },
  });

  for (const contract of rows) {
    const signUrl = `${API_BASE}/api/vip/sign/${contract.signature_token}`;
    console.log(`\nSending to ${contract.customer_email} for contract ${contract.contract_number} (${contract.vehicle_description})`);
    console.log(`Sign URL: ${signUrl}`);
    
    const html = `
<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f5f5;">
  <div style="background: white; border-radius: 12px; padding: 32px; box-shadow: 0 2px 8px rgba(0,0,0,0.1);">
    <div style="text-align: center; margin-bottom: 24px;">
      <h1 style="color: #1a1a1a; font-size: 24px; margin: 0;">⭐ VIP Service Contract</h1>
      <p style="color: #666; margin: 8px 0 0;">Luxury Wash On Wheels</p>
    </div>
    
    <p style="color: #333; font-size: 16px;">Hi ${contract.customer_name},</p>
    
    <p style="color: #333; font-size: 15px; line-height: 1.6;">
      Your VIP Service Contract for your <strong>${contract.vehicle_description}</strong> is ready for your signature. 
      Please review and sign your contract using the button below.
    </p>
    
    <div style="background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 20px 0;">
      <p style="margin: 0; color: #555; font-size: 14px;"><strong>Contract #:</strong> ${contract.contract_number}</p>
      <p style="margin: 8px 0 0; color: #555; font-size: 14px;"><strong>Vehicle:</strong> ${contract.vehicle_description}</p>
    </div>
    
    <div style="text-align: center; margin: 32px 0;">
      <a href="${signUrl}" 
         style="background: #0a7ea4; color: white; padding: 16px 32px; border-radius: 8px; text-decoration: none; font-size: 16px; font-weight: bold; display: inline-block;">
        ✍️ Sign My Contract
      </a>
    </div>
    
    <p style="color: #888; font-size: 13px; text-align: center; margin-top: 24px;">
      If the button doesn't work, copy and paste this link into your browser:<br>
      <a href="${signUrl}" style="color: #0a7ea4; word-break: break-all;">${signUrl}</a>
    </p>
    
    <hr style="border: none; border-top: 1px solid #eee; margin: 24px 0;">
    <p style="color: #aaa; font-size: 12px; text-align: center; margin: 0;">
      Luxury Wash On Wheels · Questions? Reply to this email or call us.
    </p>
  </div>
</body>
</html>`;

    try {
      const info = await transporter.sendMail({
        from: `"Luxury Wash On Wheels" <${process.env.GMAIL_USER}>`,
        to: contract.customer_email,
        subject: `⭐ Your VIP Contract is Ready to Sign — ${contract.contract_number}`,
        html,
      });
      console.log(`✅ Email sent! Message ID: ${info.messageId}`);
    } catch (err) {
      console.error(`❌ Failed to send email: ${err.message}`);
    }
  }
  
  await conn.end();
  console.log('\nDone!');
}

main().catch(e => {
  console.error('Fatal error:', e.message);
  process.exit(1);
});
