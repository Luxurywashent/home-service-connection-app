/**
 * Invoice Router
 * Handles sending invoices to customers via email or SMS, and serves the
 * customer-facing payment page where they can pay by card.
 */
import { Router, Request, Response } from "express";
import mysql from "mysql2/promise";
import crypto from "crypto";
import { sendEmail } from "./email";
import { ENV } from "./_core/env";
import { resolvePackageNameAsync } from "./db";

function getPublicUrl(): string {
  return process.env.PUBLIC_URL ?? "https://www.luxurywashonwheels.app";
}

async function getConnection() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

/** Generate a cryptographically random token */
function generateToken(): string {
  return crypto.randomBytes(32).toString("hex");
}

/** Send an SMS via Twilio */
async function sendSms(to: string, body: string): Promise<void> {
  // SMS DISABLED: A2P 10DLC campaign pending approval — re-enable by setting SMS_ENABLED=true
  if (process.env.SMS_ENABLED !== "true") {
    console.log("[SMS] Outbound SMS disabled — A2P campaign pending. Skipping to:", to);
    return;
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    console.warn("[Invoice] Twilio not configured — skipping SMS");
    return;
  }
  const toNumber = to.startsWith("+") ? to : `+1${to.replace(/\D/g, "")}`;
  const params = new URLSearchParams({ To: toNumber, From: fromNumber, Body: body });
  const response = await fetch(
    `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: params.toString(),
    }
  );
  if (!response.ok) {
    const err = await response.text();
    console.error("[Invoice] Twilio SMS error:", err);
  }
}

/** Build the invoice email HTML */
function buildInvoiceEmail(params: {
  firstName: string;
  lastName: string;
  serviceTitle: string;
  vehicleLabel: string;
  date: string;
  totalDue: number;
  paymentUrl: string;
  businessName: string;
}): { subject: string; html: string } {
  const { firstName, serviceTitle, vehicleLabel, date, totalDue, paymentUrl, businessName } = params;
  const subject = `Your Invoice from ${businessName} — $${totalDue.toFixed(2)} Due`;
  const html = `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice from ${businessName}</title>
</head>
<body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; margin: 0; padding: 20px;">
  <div style="max-width: 560px; margin: 0 auto; background: #fff; border-radius: 12px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
    <!-- Header -->
    <div style="background: #0a7ea4; padding: 28px 32px; text-align: center;">
      <h1 style="color: #fff; margin: 0; font-size: 22px; font-weight: 700;">🚗 ${businessName}</h1>
      <p style="color: rgba(255,255,255,0.85); margin: 6px 0 0; font-size: 14px;">Invoice &amp; Payment Request</p>
    </div>
    <!-- Body -->
    <div style="padding: 28px 32px;">
      <p style="color: #333; font-size: 16px; margin: 0 0 20px;">Hi ${firstName},</p>
      <p style="color: #555; font-size: 15px; margin: 0 0 24px; line-height: 1.5;">
        Thank you for choosing ${businessName}! Your invoice is ready. Please review the details below and click <strong>Pay Now</strong> to complete your payment.
      </p>
      <!-- Invoice Details -->
      <div style="background: #f9fafb; border: 1px solid #e5e7eb; border-radius: 10px; padding: 20px; margin-bottom: 24px;">
        <table style="width: 100%; border-collapse: collapse;">
          <tr>
            <td style="color: #888; font-size: 13px; padding: 4px 0;">Service</td>
            <td style="color: #111; font-size: 13px; font-weight: 600; text-align: right;">${serviceTitle}</td>
          </tr>
          <tr>
            <td style="color: #888; font-size: 13px; padding: 4px 0;">Vehicle</td>
            <td style="color: #111; font-size: 13px; text-align: right;">${vehicleLabel}</td>
          </tr>
          <tr>
            <td style="color: #888; font-size: 13px; padding: 4px 0;">Date</td>
            <td style="color: #111; font-size: 13px; text-align: right;">${date}</td>
          </tr>
          <tr>
            <td colspan="2" style="border-top: 1px solid #e5e7eb; padding-top: 12px; margin-top: 8px;"></td>
          </tr>
          <tr>
            <td style="color: #111; font-size: 16px; font-weight: 700; padding: 4px 0;">Amount Due</td>
            <td style="color: #0a7ea4; font-size: 20px; font-weight: 800; text-align: right;">$${totalDue.toFixed(2)}</td>
          </tr>
        </table>
      </div>
      <!-- Pay Button -->
      <div style="text-align: center; margin-bottom: 24px;">
        <a href="${paymentUrl}" style="display: inline-block; background: #0a7ea4; color: #fff; text-decoration: none; padding: 14px 40px; border-radius: 50px; font-size: 16px; font-weight: 700; letter-spacing: 0.3px;">
          💳 Pay Now — $${totalDue.toFixed(2)}
        </a>
      </div>
      <p style="color: #888; font-size: 12px; text-align: center; margin: 0;">
        This link is secure and unique to your invoice. Questions? Call us at 850-517-7874.
      </p>
    </div>
    <!-- Footer -->
    <div style="background: #f9fafb; border-top: 1px solid #e5e7eb; padding: 16px 32px; text-align: center;">
      <p style="color: #aaa; font-size: 12px; margin: 0;">${businessName} · Serving NW Florida</p>
    </div>
  </div>
</body>
</html>`;
  return { subject, html };
}

/** Customer-facing invoice payment page HTML */
function buildPaymentPage(params: {
  firstName: string;
  lastName: string;
  serviceTitle: string;
  vehicleLabel: string;
  date: string;
  totalDue: number;
  token: string;
  isPaid: boolean;
  stripePublishableKey: string;
  businessName: string;
}): string {
  const { firstName, lastName, serviceTitle, vehicleLabel, date, totalDue, token, isPaid, stripePublishableKey, businessName } = params;

  if (isPaid) {
    return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Invoice Paid — ${businessName}</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; display: flex; align-items: center; justify-content: center; padding: 20px; }
    .card { background: #fff; border-radius: 16px; padding: 40px 32px; max-width: 480px; width: 100%; text-align: center; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .icon { font-size: 64px; margin-bottom: 16px; }
    h1 { font-size: 24px; color: #111; margin-bottom: 8px; }
    p { color: #666; font-size: 15px; line-height: 1.5; }
    .badge { display: inline-block; background: #dcfce7; color: #16a34a; border-radius: 20px; padding: 6px 16px; font-size: 13px; font-weight: 600; margin-top: 16px; }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">✅</div>
    <h1>Payment Received!</h1>
    <p>Thank you, ${firstName}! Your payment for <strong>${serviceTitle}</strong> has been received. We look forward to seeing you!</p>
    <div class="badge">Paid in Full</div>
    <p style="margin-top: 24px; font-size: 13px; color: #aaa;">${businessName} · 850-517-7874</p>
  </div>
</body>
</html>`;
  }

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Pay Invoice — ${businessName}</title>
  <script src="https://js.stripe.com/v3/"></script>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; min-height: 100vh; padding: 20px; }
    .container { max-width: 480px; margin: 0 auto; }
    .header { background: #0a7ea4; border-radius: 16px 16px 0 0; padding: 24px; text-align: center; color: #fff; }
    .header h1 { font-size: 20px; font-weight: 700; }
    .header p { font-size: 13px; opacity: 0.8; margin-top: 4px; }
    .card { background: #fff; padding: 24px; box-shadow: 0 4px 20px rgba(0,0,0,0.08); }
    .card:last-child { border-radius: 0 0 16px 16px; }
    .row { display: flex; justify-content: space-between; align-items: center; padding: 8px 0; border-bottom: 1px solid #f0f0f0; }
    .row:last-child { border-bottom: none; }
    .label { color: #888; font-size: 14px; }
    .value { color: #111; font-size: 14px; font-weight: 500; }
    .total-row { padding: 12px 0 0; }
    .total-label { color: #111; font-size: 16px; font-weight: 700; }
    .total-value { color: #0a7ea4; font-size: 22px; font-weight: 800; }
    .section-title { font-size: 11px; font-weight: 700; color: #aaa; letter-spacing: 0.8px; text-transform: uppercase; margin: 20px 0 12px; }
    #card-element { border: 1.5px solid #e5e7eb; border-radius: 10px; padding: 14px; background: #fafafa; transition: border-color 0.2s; }
    #card-element.StripeElement--focus { border-color: #0a7ea4; }
    #card-errors { color: #ef4444; font-size: 13px; margin-top: 8px; min-height: 20px; }
    .pay-btn { width: 100%; background: #0a7ea4; color: #fff; border: none; border-radius: 50px; padding: 16px; font-size: 16px; font-weight: 700; cursor: pointer; margin-top: 16px; transition: opacity 0.2s; }
    .pay-btn:hover { opacity: 0.9; }
    .pay-btn:disabled { opacity: 0.5; cursor: not-allowed; }
    .spinner { display: none; }
    .pay-btn.loading .spinner { display: inline; }
    .pay-btn.loading .btn-text { display: none; }
    .secure-note { text-align: center; color: #aaa; font-size: 12px; margin-top: 12px; }
    .success-screen { display: none; text-align: center; padding: 40px 24px; }
    .success-screen.show { display: block; }
    .payment-form.hide { display: none; }
    .tip-section { margin-bottom: 20px; }
    .tip-label { font-size: 11px; font-weight: 700; color: #aaa; letter-spacing: 0.8px; text-transform: uppercase; margin-bottom: 10px; }
    .tip-btns { display: flex; gap: 8px; flex-wrap: wrap; }
    .tip-btn { flex: 1; min-width: 60px; border: 1.5px solid #e5e7eb; border-radius: 10px; padding: 10px 4px; background: #fafafa; font-size: 14px; font-weight: 600; color: #555; cursor: pointer; text-align: center; transition: all 0.15s; }
    .tip-btn.active { border-color: #0a7ea4; background: #e6f4fa; color: #0a7ea4; }
    .tip-custom-wrap { margin-top: 10px; display: none; }
    .tip-custom-wrap.show { display: block; }
    .tip-custom-input { width: 100%; border: 1.5px solid #e5e7eb; border-radius: 10px; padding: 12px 14px; font-size: 16px; color: #111; background: #fafafa; outline: none; }
    .tip-custom-input:focus { border-color: #0a7ea4; }
    .tip-summary { font-size: 13px; color: #0a7ea4; font-weight: 600; margin-top: 8px; min-height: 18px; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <h1>🚗 ${businessName}</h1>
      <p>Invoice Payment</p>
    </div>
    <div class="card">
      <p style="color: #555; font-size: 15px;">Hi <strong>${firstName} ${lastName}</strong>, your invoice is ready.</p>
      <div style="margin-top: 16px;">
        <div class="row"><span class="label">Service</span><span class="value">${serviceTitle}</span></div>
        <div class="row"><span class="label">Vehicle</span><span class="value">${vehicleLabel}</span></div>
        <div class="row"><span class="label">Date</span><span class="value">${date}</span></div>
        <div class="row total-row"><span class="total-label">Amount Due</span><span class="total-value">$${totalDue.toFixed(2)}</span></div>
      </div>
    </div>
    <div class="card payment-form" id="payment-form-card">
      <!-- Tip Section -->
      <div class="tip-section">
        <p class="tip-label">Add a Tip (Optional)</p>
        <div class="tip-btns">
          <button class="tip-btn" id="tip-none" onclick="selectTip('none')">No Tip</button>
          <button class="tip-btn" id="tip-15" onclick="selectTip('15')">15%</button>
          <button class="tip-btn" id="tip-20" onclick="selectTip('20')">20%</button>
          <button class="tip-btn" id="tip-25" onclick="selectTip('25')">25%</button>
          <button class="tip-btn" id="tip-custom" onclick="selectTip('custom')">Custom</button>
        </div>
        <div class="tip-custom-wrap" id="tip-custom-wrap">
          <input class="tip-custom-input" id="tip-custom-input" type="number" min="0" step="1" placeholder="Enter tip amount ($)" oninput="updateCustomTip()" />
        </div>
        <div class="tip-summary" id="tip-summary"></div>
      </div>
      <p class="section-title">Card Details</p>
      <div id="card-element"></div>
      <div id="card-errors"></div>
      <button class="pay-btn" id="pay-btn" onclick="handlePay()">
        <span class="btn-text" id="pay-btn-text">💳 Pay $${totalDue.toFixed(2)}</span>
        <span class="spinner">Processing…</span>
      </button>
      <p class="secure-note">🔒 Secured by Stripe · Your card info is never stored</p>
    </div>
    <div class="success-screen" id="success-screen">
      <div style="font-size: 64px; margin-bottom: 16px;">✅</div>
      <h2 style="color: #111; font-size: 22px; margin-bottom: 8px;">Payment Successful!</h2>
      <p style="color: #666; font-size: 15px;">Thank you, ${firstName}! We look forward to seeing you.</p>
      <p style="color: #aaa; font-size: 13px; margin-top: 16px;">${businessName} · 850-517-7874</p>
    </div>
  </div>
  <script>
    const stripe = Stripe('${stripePublishableKey}');
    const elements = stripe.elements();
    const cardElement = elements.create('card', {
      style: {
        base: { fontSize: '16px', color: '#111', '::placeholder': { color: '#aaa' } },
        invalid: { color: '#ef4444' }
      }
    });
    cardElement.mount('#card-element');
    cardElement.on('change', (e) => {
      document.getElementById('card-errors').textContent = e.error ? e.error.message : '';
    });

    const BASE_TOTAL = ${totalDue};
    let tipAmount = 0;
    let tipMode = 'none';

    function selectTip(mode) {
      tipMode = mode;
      ['none','15','20','25','custom'].forEach(id => {
        const el = document.getElementById('tip-' + id);
        if (el) el.classList.toggle('active', id === mode);
      });
      const customWrap = document.getElementById('tip-custom-wrap');
      if (mode === 'custom') {
        customWrap.classList.add('show');
        updateCustomTip();
      } else {
        customWrap.classList.remove('show');
        if (mode === 'none') { tipAmount = 0; }
        else { tipAmount = Math.round(BASE_TOTAL * parseInt(mode) / 100 * 100) / 100; }
        updateSummary();
      }
    }

    function updateCustomTip() {
      const val = parseFloat(document.getElementById('tip-custom-input').value) || 0;
      tipAmount = Math.round(val * 100) / 100;
      updateSummary();
    }

    function updateSummary() {
      const total = Math.round((BASE_TOTAL + tipAmount) * 100) / 100;
      const summaryEl = document.getElementById('tip-summary');
      const btnText = document.getElementById('pay-btn-text');
      if (tipAmount > 0) {
        summaryEl.textContent = 'Tip: $' + tipAmount.toFixed(2) + ' · Total: $' + total.toFixed(2);
        btnText.textContent = '💳 Pay $' + total.toFixed(2);
      } else {
        summaryEl.textContent = '';
        btnText.textContent = '💳 Pay $' + BASE_TOTAL.toFixed(2);
      }
    }

    async function handlePay() {
      const btn = document.getElementById('pay-btn');
      btn.disabled = true;
      btn.classList.add('loading');
      document.getElementById('card-errors').textContent = '';
      try {
        // 1. Create payment intent
        const apiBase = 'https://luxwashapp-n2wveyqg.manus.space';
        const resp = await fetch(apiBase + '/api/invoice/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '${token}', tipAmount })
        });
        const { clientSecret, error: intentError } = await resp.json();
        if (intentError) throw new Error(intentError);

        // 2. Confirm card payment
        const { error, paymentIntent } = await stripe.confirmCardPayment(clientSecret, {
          payment_method: { card: cardElement }
        });
        if (error) throw new Error(error.message);

        // 3. Mark as paid
        await fetch(apiBase + '/api/invoice/mark-paid', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '${token}', paymentIntentId: paymentIntent.id, tipAmount })
        });

        // 4. Show success
        document.getElementById('payment-form-card').classList.add('hide');
        document.getElementById('success-screen').classList.add('show');
      } catch (err) {
        document.getElementById('card-errors').textContent = err.message || 'Payment failed. Please try again.';
        btn.disabled = false;
        btn.classList.remove('loading');
      }
    }
  </script>
</body>
</html>`;
}

export function createInvoiceRouter(): Router {
  const router = Router();

  /** Resolve a pb_* package ID to a human-readable service name */
  function resolveServiceTitle(packageType: string | null | undefined): string {
    if (!packageType) return "Detail Service";
    const map: Record<string, string> = {
      pb_basic: "Basic Detail",
      pb_full: "Full Detail",
      pb_luxury: "Luxury Detail",
      pb_interior: "Interior Detail",
      pb_exterior: "Exterior Detail",
      pb_vip: "VIP Detail",
      pb_express: "Express Detail",
      pb_premium: "Premium Detail",
      interior: "Interior Detail",
      exterior: "Exterior Detail",
      luxury: "Luxury Detail",
      full: "Full Detail",
      basic: "Basic Detail",
      vip: "VIP Detail",
    };
    const key = packageType.toLowerCase().replace(/[^a-z_]/g, "");
    return map[key] ?? map[packageType] ?? packageType;
  }

  /** POST /api/invoice/send — Admin sends invoice to customer */
  router.post("/send", async (req: Request, res: Response) => {
    const { jobId, method, discountAmount: discountOverride, depositAmount: depositOverride, remainingOnly, previouslyPaid, overrideEmail, overridePhone } = req.body as { jobId: string; method: "email" | "sms"; discountAmount?: number; depositAmount?: number; remainingOnly?: boolean; previouslyPaid?: number; overrideEmail?: string; overridePhone?: string };
    if (!jobId || !method) {
      return res.status(400).json({ error: "jobId and method are required" });
    }
    const conn = await getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT job_id, customer_name, customer_phone, customer_email, package_type,
                vehicle_type, vehicle_make, vehicle_model, vehicle_year, vehicle_color,
                date, time_slot, total_price, upsell_total, tips, tax_amount, discount_amount, deposit_amount,
                invoice_token, invoice_paid_at
         FROM schedule_jobs WHERE job_id = ? LIMIT 1`,
        [jobId]
      ) as [any[], any];

      if (!rows.length) return res.status(404).json({ error: "Job not found" });
      const job = rows[0];

      if (job.invoice_paid_at) {
        return res.status(400).json({ error: "Invoice already paid" });
      }

      // Generate or reuse token
      let token = job.invoice_token;
      if (!token) {
        token = generateToken();
        await conn.execute(
          "UPDATE schedule_jobs SET invoice_token = ? WHERE job_id = ?",
          [token, jobId]
        );
      }

      // Mark sent
      await conn.execute(
        "UPDATE schedule_jobs SET invoice_sent_at = NOW() WHERE job_id = ?",
        [jobId]
      );

      const publicUrl = getPublicUrl();
      const paymentUrl = `${publicUrl}/api/invoice/pay/${token}`;

      const nameParts = (job.customer_name ?? "").split(" ");
      const firstName = nameParts[0] ?? "Customer";
      const lastName = nameParts.slice(1).join(" ") ?? "";

      const vehicleParts = [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean);
      const vehicleLabel = vehicleParts.length ? vehicleParts.join(" ") : (job.vehicle_type ?? "Vehicle");

      // Use app-provided overrides if present (more up-to-date than DB when discount was just set)
      const base = parseFloat(job.total_price ?? "0");
      const upsells = parseFloat(job.upsell_total ?? "0");
      const tax = parseFloat(job.tax_amount ?? "0");
      const discount = discountOverride != null ? discountOverride : parseFloat(job.discount_amount ?? "0");
      const deposit = depositOverride != null ? depositOverride : parseFloat(job.deposit_amount ?? "0");
      const fullTotal = Math.max(0, base + upsells + tax - discount - deposit);
      // If remainingOnly, the customer already paid `previouslyPaid` and owes the rest
      const totalDue = remainingOnly && previouslyPaid != null
        ? Math.max(0, fullTotal - previouslyPaid)
        : fullTotal;

      // If app sent overrides, persist discount/deposit to DB so the payment page uses the same amount.
      // NOTE: total_price is the raw service price and must NOT be modified here.
      if (discountOverride != null || depositOverride != null) {
        const updates: string[] = [];
        const vals: any[] = [];
        if (discountOverride != null) { updates.push("discount_amount = ?"); vals.push(discountOverride.toFixed(2)); }
        if (depositOverride != null) { updates.push("deposit_amount = ?"); vals.push(depositOverride.toFixed(2)); }
        vals.push(jobId);
        await conn.execute(`UPDATE schedule_jobs SET ${updates.join(", ")} WHERE job_id = ?`, vals);
      }

      const serviceTitle = await resolvePackageNameAsync(job.package_type);
      const businessName = "Luxury Wash On Wheels";

      if (method === "email") {
        const email = (overrideEmail && overrideEmail.trim()) ? overrideEmail.trim() : job.customer_email;
        if (!email) return res.status(400).json({ error: "Customer has no email on file" });
        const { subject, html } = buildInvoiceEmail({
          firstName, lastName, serviceTitle,
          vehicleLabel, date: job.date ?? "", totalDue, paymentUrl, businessName,
        });
        await sendEmail({ to: email, subject, html, type: "other", customerName: job.customer_name ?? "" });
        return res.json({ success: true, paymentUrl });
      } else {
        const phone = (overridePhone && overridePhone.trim()) ? overridePhone.trim() : job.customer_phone;
        if (!phone) return res.status(400).json({ error: "Customer has no phone on file" });
        const smsBody = `Hi ${firstName}! Your invoice from ${businessName} is ready — $${totalDue.toFixed(2)} due for ${serviceTitle}. Pay here: ${paymentUrl}`;
        await sendSms(phone, smsBody);
        return res.json({ success: true, paymentUrl });
      }
    } catch (err: any) {
      console.error("[Invoice] Send error:", err);
      return res.status(500).json({ error: err.message ?? "Failed to send invoice" });
    } finally {
      await conn.end();
    }
  });

  /** GET /api/invoice/pay/:token — Customer-facing payment page */
  router.get("/pay/:token", async (req: Request, res: Response) => {
    const { token } = req.params;
    const conn = await getConnection();
    try {
      const [rows] = await conn.execute(
        `SELECT job_id, customer_name, package_type, vehicle_type, vehicle_make, vehicle_model, vehicle_year,
                date, total_price, upsell_total, tax_amount, discount_amount, deposit_amount, invoice_paid_at
         FROM schedule_jobs WHERE invoice_token = ? LIMIT 1`,
        [token]
      ) as [any[], any];

      if (!rows.length) {
        return res.status(404).send("<h1>Invoice not found</h1><p>This link may be invalid or expired.</p>");
      }

      const job = rows[0];
      const nameParts = (job.customer_name ?? "").split(" ");
      const firstName = nameParts[0] ?? "Customer";
      const lastName = nameParts.slice(1).join(" ") ?? "";
      const vehicleParts = [job.vehicle_year, job.vehicle_make, job.vehicle_model].filter(Boolean);
      const vehicleLabel = vehicleParts.length ? vehicleParts.join(" ") : (job.vehicle_type ?? "Vehicle");
      const base = parseFloat(job.total_price ?? "0");
      const upsells = parseFloat(job.upsell_total ?? "0");
      const tax = parseFloat(job.tax_amount ?? "0");
      const discount = parseFloat(job.discount_amount ?? "0");
      const deposit = parseFloat(job.deposit_amount ?? "0");
      const totalDue = Math.max(0, base + upsells + tax - discount - deposit);

      const stripePublishableKey = process.env.STRIPE_PUBLISHABLE_KEY || "pk_live_OMLuyAywkJGP1UdNixgrxAGm";
      const html = buildPaymentPage({
        firstName, lastName,
        serviceTitle: job.package_type ?? "Detail Service",
        vehicleLabel, date: job.date ?? "",
        totalDue, token,
        isPaid: !!job.invoice_paid_at,
        stripePublishableKey,
        businessName: "Luxury Wash On Wheels",
      });
      res.setHeader("Content-Type", "text/html");
      return res.send(html);
    } catch (err: any) {
      console.error("[Invoice] Pay page error:", err);
      return res.status(500).send("<h1>Error loading invoice</h1>");
    } finally {
      await conn.end();
    }
  });

  /** POST /api/invoice/create-payment-intent — Called from the customer payment page */
  router.post("/create-payment-intent", async (req: Request, res: Response) => {
    const { token, tipAmount: tipRaw } = req.body as { token: string; tipAmount?: number };
    if (!token) return res.status(400).json({ error: "Token required" });
    const tipAmount = Math.max(0, parseFloat(String(tipRaw ?? 0)) || 0);

    const conn = await getConnection();
    try {
      const [rows] = await conn.execute(
        "SELECT job_id, customer_name, package_type, total_price, upsell_total, tax_amount, discount_amount, deposit_amount, invoice_paid_at FROM schedule_jobs WHERE invoice_token = ? LIMIT 1",
        [token]
      ) as [any[], any];

      if (!rows.length) return res.status(404).json({ error: "Invoice not found" });
      const job = rows[0];
      if (job.invoice_paid_at) return res.status(400).json({ error: "Invoice already paid" });

      const base = parseFloat(job.total_price ?? "0");
      const upsells = parseFloat(job.upsell_total ?? "0");
      const tax = parseFloat(job.tax_amount ?? "0");
      const discount = parseFloat(job.discount_amount ?? "0");
      const deposit = parseFloat(job.deposit_amount ?? "0");
      const totalDue = Math.max(0, base + upsells + tax - discount - deposit);
      const amountCents = Math.round((totalDue + tipAmount) * 100);

      const stripeSecretKey = process.env.STRIPE_SECRET_KEY || process.env.STRIPE_SK || "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";
      if (!stripeSecretKey) return res.status(500).json({ error: "Stripe not configured" });

      const params = new URLSearchParams({
        amount: String(amountCents),
        currency: "usd",
        description: `${job.package_type ?? "Detail"} — ${job.customer_name ?? ""}`,
        "metadata[job_id]": job.job_id,
        "metadata[invoice_token]": token,
      });
      const piResp = await fetch("https://api.stripe.com/v1/payment_intents", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${stripeSecretKey}`,
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: params.toString(),
      });
      const pi = await piResp.json() as any;
      if (!piResp.ok) return res.status(500).json({ error: pi.error?.message ?? "Stripe error" });

      return res.json({ clientSecret: pi.client_secret });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    } finally {
      await conn.end();
    }
  });

  /** POST /api/invoice/mark-paid — Called from the customer payment page after success */
  router.post("/mark-paid", async (req: Request, res: Response) => {
    const { token, paymentIntentId, tipAmount: tipRaw } = req.body as { token: string; paymentIntentId: string; tipAmount?: number };
    const tipAmount = Math.max(0, parseFloat(String(tipRaw ?? 0)) || 0);
    if (!token) return res.status(400).json({ error: "Token required" });
    const conn = await getConnection();
    try {
      // First fetch the job to get the total amount
      const [preRows] = await conn.execute(
        `SELECT total_price, upsell_total, tax_amount, discount_amount, deposit_amount FROM schedule_jobs WHERE invoice_token = ? LIMIT 1`,
        [token]
      ) as [any[], any];
      const preJob = preRows[0] ?? {};
      const preBase = parseFloat(preJob.total_price ?? "0");
      const preUpsells = parseFloat(preJob.upsell_total ?? "0");
      const preTax = parseFloat(preJob.tax_amount ?? "0");
      const preDiscount = parseFloat(preJob.discount_amount ?? "0");
      const preDeposit = parseFloat(preJob.deposit_amount ?? "0");
      const invoiceTotal = Math.max(0, preBase + preUpsells + preTax - preDiscount - preDeposit);

      const totalWithTip = Math.round((invoiceTotal + tipAmount) * 100) / 100;
      await conn.execute(
        `UPDATE schedule_jobs SET 
          invoice_paid_at = NOW(),
          invoice_payment_intent_id = ?,
          payment_method = 'card',
          payment_status = 'paid',
          paid_at = NOW(),
          payment_intent_id = ?,
          payment_total = ?,
          payment_subtotal = ?,
          payment_tip = ?,
          tips = ?,
          payment_paid_at = NOW(),
          paymentPaidAt = NOW(),
          status = 'completed'
        WHERE invoice_token = ?`,
        [paymentIntentId ?? null, paymentIntentId ?? null, totalWithTip, invoiceTotal, tipAmount, tipAmount, token]
      );

      // Send customer receipt email
      try {
        const [custRows] = await conn.execute(
          `SELECT customer_name, customer_email, package_type, total_price, upsell_total, tax_amount, discount_amount, deposit_amount, date, assigned_to, location, vehicle_type, vehicle_color
           FROM schedule_jobs WHERE invoice_token = ? LIMIT 1`,
          [token]
        ) as [any[], any];
        if (custRows.length > 0) {
          const cj = custRows[0];
          const custEmail = cj.customer_email;
          if (custEmail) {
            const cBase = parseFloat(cj.total_price ?? '0');
            const cUpsells = parseFloat(cj.upsell_total ?? '0');
            const cTax = parseFloat(cj.tax_amount ?? '0');
            const cDiscount = parseFloat(cj.discount_amount ?? '0');
            const cDeposit = parseFloat(cj.deposit_amount ?? '0');
            const cTotal = Math.max(0, cBase + cUpsells + cTax - cDiscount - cDeposit);
            const cTotalWithTip = Math.round((cTotal + tipAmount) * 100) / 100;
            const serviceTitle = await resolvePackageNameAsync(cj.package_type);
            const paidAtFormatted = new Intl.DateTimeFormat('en-US', {
              timeZone: 'America/Chicago',
              month: 'short', day: 'numeric', year: 'numeric',
              hour: 'numeric', minute: '2-digit', hour12: true,
            }).format(new Date());
            const { buildPaymentReceiptEmail } = await import('./email.js');
            const { subject: rSubject, html: rHtml } = buildPaymentReceiptEmail({
              customerName: cj.customer_name ?? 'Valued Customer',
              jobId: '',
              serviceDate: cj.date ?? '',
              packageName: serviceTitle,
              vehicleInfo: [cj.vehicle_type, cj.vehicle_color].filter(Boolean).join(' ') || 'Vehicle',
              serviceAddress: cj.location ?? '',
              paymentMethod: 'card',
              subtotal: cTotal,
              tip: tipAmount,
              total: cTotalWithTip,
              paidAt: paidAtFormatted,
              detailerName: cj.assigned_to ?? undefined,
            });
            await sendEmail({ to: custEmail, subject: rSubject, html: rHtml, type: 'other', urgent: true, customerName: cj.customer_name ?? '' });
          }
        }
      } catch (custReceiptErr) {
        console.warn('[Invoice] Customer receipt email failed:', custReceiptErr);
      }

      // Send admin payment confirmation email
      try {
        const [jobRows] = await conn.execute(
          `SELECT customer_name, package_type, total_price, upsell_total, tax_amount, discount_amount, deposit_amount, date, assigned_to
           FROM schedule_jobs WHERE invoice_token = ? LIMIT 1`,
          [token]
        ) as [any[], any];
        if (jobRows.length > 0) {
          const j = jobRows[0];
          const base = parseFloat(j.total_price ?? "0");
          const upsells = parseFloat(j.upsell_total ?? "0");
          const tax = parseFloat(j.tax_amount ?? "0");
          const discount = parseFloat(j.discount_amount ?? "0");
          const deposit = parseFloat(j.deposit_amount ?? "0");
          const amountPaid = Math.max(0, base + upsells + tax - discount - deposit);
          const serviceTitle = await resolvePackageNameAsync(j.package_type);
          const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || "admin@luxurywashonwheels.com";
          if (adminEmail) {
            const adminSubject = `✅ Payment Received — ${j.customer_name} · $${amountPaid.toFixed(2)}`;
            const adminHtml = `
<!DOCTYPE html><html><body style="font-family:-apple-system,sans-serif;background:#f5f5f5;margin:0;padding:20px;">
<div style="max-width:520px;margin:0 auto;background:#fff;border-radius:12px;overflow:hidden;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
  <div style="background:#16a34a;padding:20px 28px;">
    <h2 style="color:#fff;margin:0;font-size:18px;">&#x2705; Payment Received</h2>
    <p style="color:rgba(255,255,255,0.85);margin:4px 0 0;font-size:13px;">Luxury Wash On Wheels</p>
  </div>
  <div style="padding:24px 28px;">
    <table style="width:100%;border-collapse:collapse;">
      <tr><td style="color:#888;font-size:13px;padding:5px 0;">Customer</td><td style="color:#111;font-size:13px;font-weight:600;text-align:right;">${j.customer_name ?? ""}</td></tr>
      <tr><td style="color:#888;font-size:13px;padding:5px 0;">Service</td><td style="color:#111;font-size:13px;text-align:right;">${serviceTitle}</td></tr>
      <tr><td style="color:#888;font-size:13px;padding:5px 0;">Date</td><td style="color:#111;font-size:13px;text-align:right;">${j.date ?? ""}</td></tr>
      <tr><td style="color:#888;font-size:13px;padding:5px 0;">Detailer</td><td style="color:#111;font-size:13px;text-align:right;">${j.assigned_to ?? ""}</td></tr>
      <tr><td style="color:#888;font-size:13px;padding:5px 0;">Method</td><td style="color:#111;font-size:13px;text-align:right;">Card (Invoice Link)</td></tr>
      ${discount > 0 ? `<tr><td style="color:#888;font-size:13px;padding:5px 0;">Discount</td><td style="color:#ef4444;font-size:13px;text-align:right;">-$${discount.toFixed(2)}</td></tr>` : ""}
      <tr style="border-top:1px solid #e5e7eb;"><td style="color:#111;font-size:16px;font-weight:700;padding:10px 0 5px;">Amount Paid</td><td style="color:#16a34a;font-size:20px;font-weight:800;text-align:right;">$${amountPaid.toFixed(2)}</td></tr>
    </table>
  </div>
</div>
</body></html>`;
            await sendEmail({ to: adminEmail, subject: adminSubject, html: adminHtml, type: "other", customerName: j.customer_name ?? "" });
          }
        }
      } catch (emailErr) {
        console.warn("[Invoice] Admin notification email failed:", emailErr);
      }

      return res.json({ success: true });
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    } finally {
      await conn.end();
    }
  });

  /**
   * POST /api/invoice/stripe-webhook
   * Stripe webhook: handles payment_intent.succeeded server-side.
   * This ensures payment is recorded even if the customer closes the browser
   * before the confirmation page loads (which triggers /mark-paid from the client).
   *
   * Setup in Stripe Dashboard → Webhooks:
   *   URL: https://luxurywashonwheels.app/api/invoice/stripe-webhook
   *   Events: payment_intent.succeeded
   */
  router.post("/stripe-webhook", async (req: Request, res: Response) => {
    try {
      const payload = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
      const event = payload;

      if (event?.type !== 'payment_intent.succeeded') {
        return res.json({ received: true, skipped: true });
      }

      const pi = event?.data?.object;
      if (!pi) return res.status(400).json({ error: 'No payment intent in event' });

      const invoiceToken = pi?.metadata?.invoice_token;
      const jobId = pi?.metadata?.job_id;

      if (!invoiceToken && !jobId) {
        // Not an invoice or job payment — ignore
        return res.json({ received: true, skipped: true });
      }

      const conn = await getConnection();
      try {
        // Check if already marked paid to avoid double-processing
        const whereClause = invoiceToken ? 'invoice_token = ?' : 'job_id = ?';
        const whereParam = invoiceToken ?? jobId;
        const [checkRows] = await conn.execute(
          `SELECT job_id, payment_paid_at, invoice_paid_at FROM schedule_jobs WHERE ${whereClause} LIMIT 1`,
          [whereParam]
        ) as [any[], any];
        const existingJob = checkRows[0];

        if (!existingJob) {
          console.log(`[Invoice Webhook] No job found for invoice_token=${invoiceToken} job_id=${jobId}`);
          return res.json({ received: true, skipped: true });
        }

        if (existingJob.payment_paid_at || existingJob.invoice_paid_at) {
          console.log(`[Invoice Webhook] Job ${existingJob.job_id} already marked paid — skipping`);
          return res.json({ received: true, alreadyPaid: true });
        }

        // Calculate amounts from Stripe PI
        const amountTotal = Math.round((pi.amount ?? 0)) / 100;
        const tipAmount = pi.metadata?.tip_amount ? parseFloat(pi.metadata.tip_amount) : 0;
        const amountSubtotal = Math.max(0, amountTotal - tipAmount);
        const paymentIntentId = pi.id;

        await conn.execute(
          `UPDATE schedule_jobs SET
            invoice_paid_at = NOW(),
            invoice_payment_intent_id = ?,
            payment_method = 'card',
            payment_status = 'paid',
            payment_intent_id = ?,
            payment_total = ?,
            payment_subtotal = ?,
            payment_tip = ?,
            tips = ?,
            payment_paid_at = NOW(),
            status = 'completed'
          WHERE ${whereClause}`,
          [paymentIntentId, paymentIntentId, amountTotal, amountSubtotal, tipAmount, tipAmount, whereParam]
        );

        console.log(`[Invoice Webhook] ✅ Marked job ${existingJob.job_id} as paid via webhook (PI: ${paymentIntentId}, $${amountTotal})`);
        return res.json({ received: true, marked: true, jobId: existingJob.job_id });
      } finally {
        await conn.end();
      }
    } catch (err: any) {
      console.error('[Invoice Webhook] Error processing webhook:', err);
      return res.status(500).json({ error: err.message });
    }
  });

  /** GET /api/invoice/status/:jobId — Check invoice status for admin */
  router.get("/status/:jobId", async (req: Request, res: Response) => {
    const { jobId } = req.params;
    const conn = await getConnection();
    try {
      const [rows] = await conn.execute(
        "SELECT invoice_token, invoice_sent_at, invoice_paid_at, invoice_payment_intent_id FROM schedule_jobs WHERE job_id = ? LIMIT 1",
        [jobId]
      ) as [any[], any];
      if (!rows.length) return res.status(404).json({ error: "Job not found" });
      return res.json(rows[0]);
    } catch (err: any) {
      return res.status(500).json({ error: err.message });
    } finally {
      await conn.end();
    }
  });

  return router;
}
