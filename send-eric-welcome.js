/**
 * Send welcome email to Eric with login credentials
 */
import { sendEmail, buildTeamMemberWelcomeEmail } from './server/email.js';

const eric = {
  fullName: 'Eric Thorpe',
  employeeId: 'ERIC',
  pin: '3212',
  role: 'admin',
  hireDate: '2026-07-19',
  city: null,
  email: 'ericankason21@gmail.com',
};

async function sendWelcome() {
  try {
    console.log(`📧 Sending welcome email to ${eric.email}...`);
    
    const welcomeEmail = buildTeamMemberWelcomeEmail({
      fullName: eric.fullName,
      employeeId: eric.employeeId,
      pin: eric.pin,
      role: eric.role,
      hireDate: eric.hireDate,
      city: eric.city,
    });

    const sent = await sendEmail({
      to: eric.email,
      subject: welcomeEmail.subject,
      html: welcomeEmail.html,
      type: 'other',
      urgent: true,
      customerName: eric.fullName,
    });

    if (sent) {
      console.log(`✅ Welcome email sent successfully to ${eric.email}`);
      console.log(`\n📋 Login Details:`);
      console.log(`   Team Member ID: ${eric.employeeId}`);
      console.log(`   PIN: ${eric.pin}`);
      console.log(`   Role: ${eric.role}`);
    } else {
      console.log(`❌ Failed to send welcome email. Check Gmail credentials.`);
      process.exit(1);
    }
  } catch (err) {
    console.error('❌ Error sending welcome email:', err);
    process.exit(1);
  }
}

sendWelcome();
