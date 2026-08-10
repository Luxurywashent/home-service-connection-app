const formatCurrency = (n: number) => `$${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const formatDate = (d: Date | string) => new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

export function buildLoanContractEmail(
  borrowerName: string,
  loanId: string,
  principalAmount: number,
  totalRepaymentAmount: number,
  numberOfPayments: number,
  paymentFrequency: string,
  signatureLink: string
): { subject: string; html: string } {
  const subject = `Loan Agreement - ${loanId}`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #1a1a1a; color: white; padding: 20px; border-radius: 8px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 20px; background-color: #f9f9f9; margin: 20px 0; border-radius: 8px; }
          .terms { background-color: #fff; padding: 15px; border-left: 4px solid #007bff; margin: 15px 0; }
          .term-item { margin: 10px 0; }
          .term-label { font-weight: bold; color: #007bff; }
          .cta-button { display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; text-align: center; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>Loan Agreement</h1>
            <p>Loan ID: ${loanId}</p>
          </div>

          <div class="content">
            <p>Hi ${borrowerName},</p>
            
            <p>We're excited to formalize our loan agreement. Below are the details of your loan:</p>

            <div class="terms">
              <div class="term-item">
                <span class="term-label">Principal Amount:</span> ${formatCurrency(principalAmount)}
              </div>
              <div class="term-item">
                <span class="term-label">Total Repayment:</span> ${formatCurrency(totalRepaymentAmount)}
              </div>
              <div class="term-item">
                <span class="term-label">Interest:</span> ${formatCurrency(totalRepaymentAmount - principalAmount)}
              </div>
              <div class="term-item">
                <span class="term-label">Number of Payments:</span> ${numberOfPayments}
              </div>
              <div class="term-item">
                <span class="term-label">Payment Frequency:</span> ${paymentFrequency}
              </div>
              <div class="term-item">
                <span class="term-label">Payment Amount:</span> ${formatCurrency(totalRepaymentAmount / numberOfPayments)} per ${paymentFrequency}
              </div>
            </div>

            <p>Please review the complete loan agreement and sign it below:</p>

            <div style="text-align: center;">
              <a href="${signatureLink}" class="cta-button">Review & Sign Agreement</a>
            </div>

            <p>If you have any questions about this loan agreement, please don't hesitate to reach out.</p>

            <p>Best regards,<br>Luxury Wash On Wheels</p>
          </div>

          <div class="footer">
            <p>This is an automated email. Please do not reply directly to this message.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return { subject, html };
}

export function buildPaymentReminderEmail(
  borrowerName: string,
  paymentAmount: number,
  paymentDate: Date,
  paymentNumber: number,
  totalPayments: number
): { subject: string; html: string } {
  const subject = `🎉 Great News! You're Getting Paid Tomorrow!`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; padding: 30px; border-radius: 8px; text-align: center; }
          .header h1 { margin: 0; font-size: 28px; }
          .emoji { font-size: 40px; margin: 10px 0; }
          .content { padding: 20px; background-color: #f9f9f9; margin: 20px 0; border-radius: 8px; }
          .payment-box { background-color: #fff; padding: 20px; border-left: 4px solid #22c55e; margin: 20px 0; border-radius: 5px; }
          .payment-amount { font-size: 32px; font-weight: bold; color: #22c55e; margin: 10px 0; }
          .payment-detail { margin: 8px 0; }
          .detail-label { font-weight: bold; color: #667eea; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <div class="emoji">🎉</div>
            <h1>Payment Coming Tomorrow!</h1>
            <p>You're getting paid!</p>
          </div>

          <div class="content">
            <p>Hi ${borrowerName},</p>
            
            <p>Great news! You're receiving a payment tomorrow. Here are the details:</p>

            <div class="payment-box">
              <div class="payment-amount">${formatCurrency(paymentAmount)}</div>
              
              <div class="payment-detail">
                <span class="detail-label">Payment Date:</span> ${formatDate(paymentDate)}
              </div>
              <div class="payment-detail">
                <span class="detail-label">Payment Number:</span> ${paymentNumber} of ${totalPayments}
              </div>
              <div class="payment-detail">
                <span class="detail-label">Remaining Payments:</span> ${totalPayments - paymentNumber}
              </div>
            </div>

            <p>Thank you for your partnership with Luxury Wash On Wheels! We appreciate your support and look forward to continuing our business relationship.</p>

            <p>Best regards,<br>Luxury Wash On Wheels Team 💪</p>
          </div>

          <div class="footer">
            <p>This is an automated email. Please do not reply directly to this message.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return { subject, html };
}

export function buildContractSignedEmail(
  borrowerName: string,
  loanId: string,
  contractUrl: string
): { subject: string; html: string } {
  const subject = `Your Signed Loan Agreement - ${loanId}`;

  const html = `
    <!DOCTYPE html>
    <html>
      <head>
        <style>
          body { font-family: Arial, sans-serif; line-height: 1.6; color: #333; }
          .container { max-width: 600px; margin: 0 auto; padding: 20px; }
          .header { background-color: #1a1a1a; color: white; padding: 20px; border-radius: 8px; text-align: center; }
          .header h1 { margin: 0; font-size: 24px; }
          .content { padding: 20px; background-color: #f9f9f9; margin: 20px 0; border-radius: 8px; }
          .success-box { background-color: #d4edda; border: 1px solid #c3e6cb; color: #155724; padding: 15px; border-radius: 5px; margin: 20px 0; }
          .cta-button { display: inline-block; background-color: #007bff; color: white; padding: 12px 30px; text-decoration: none; border-radius: 5px; margin: 20px 0; text-align: center; }
          .footer { text-align: center; color: #666; font-size: 12px; margin-top: 30px; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>✓ Agreement Signed</h1>
            <p>Your loan agreement has been successfully signed</p>
          </div>

          <div class="content">
            <p>Hi ${borrowerName},</p>
            
            <div class="success-box">
              <p><strong>Your loan agreement has been signed and is now active!</strong></p>
              <p>Loan ID: ${loanId}</p>
            </div>

            <p>We've attached a copy of your signed agreement for your records. You can also download it using the link below:</p>

            <div style="text-align: center;">
              <a href="${contractUrl}" class="cta-button">Download Signed Agreement</a>
            </div>

            <p>Your first payment will be due on the date specified in the agreement. We'll send you a reminder before each payment is due.</p>

            <p>Thank you for choosing Luxury Wash On Wheels!</p>

            <p>Best regards,<br>Luxury Wash On Wheels Team</p>
          </div>

          <div class="footer">
            <p>This is an automated email. Please do not reply directly to this message.</p>
          </div>
        </div>
      </body>
    </html>
  `;

  return { subject, html };
}
