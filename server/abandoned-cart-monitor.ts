/**
 * Abandoned Cart Recovery Monitor
 *
 * Runs every 5 minutes. For each abandoned cart that:
 *   1. Is still in "abandoned" status (not converted to a booking)
 *   2. Was created 30+ minutes ago
 *   3. Has NOT already had a recovery message sent
 *
 * It fires:
 *   - Recovery SMS via Twilio (with city booking page link)
 *   - Recovery email (branded, with direct link back to the city booking page)
 *   - Push notification to all admin/office/operations_manager employees
 *
 * The city booking page URLs follow the pattern:
 *   https://luxurywashonwheels.com/{city}/book/
 */

import * as db from "./db";
import { sendEmail, buildAbandonedCartRecoveryEmail } from "./email";
import { getDb } from "./db";
import { employees } from "../drizzle/schema";
import { inArray } from "drizzle-orm";

// ─── City config ──────────────────────────────────────────────────────────────
const CITY_CONFIG: Record<string, { label: string; bookingUrl: string }> = {
  crestview:  { label: "Crestview",        bookingUrl: "https://luxurywashonwheels.com/crestview/mobile-detailing/" },
  niceville:  { label: "Niceville",        bookingUrl: "https://luxurywashonwheels.com/niceville/mobile-detailing/" },
  destin:     { label: "Destin",           bookingUrl: "https://luxurywashonwheels.com/destin/mobile-detailing/" },
  fwb:        { label: "Fort Walton Beach", bookingUrl: "https://luxurywashonwheels.com/fwb/mobile-detailing/" },
  pensacola:  { label: "Pensacola",        bookingUrl: "https://luxurywashonwheels.com/pensacola/mobile-detailing/" },
};

// ─── Twilio SMS helper ────────────────────────────────────────────────────────
async function sendRecoverySms(params: {
  phone: string;
  firstName: string;
  packageType: string | null;
  cityLabel: string;
  cityBookingUrl: string;
}): Promise<boolean> {
  // SMS DISABLED: A2P 10DLC campaign pending approval — re-enable by setting SMS_ENABLED=true
  if (process.env.SMS_ENABLED !== "true") {
    console.log("[SMS] Outbound SMS disabled — A2P campaign pending. Skipping recovery SMS.");
    return false;
  }
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken  = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) {
    console.warn("[AbandonedCart] Twilio not configured — skipping recovery SMS");
    return false;
  }
  const pkgHint = params.packageType
    ? `We saved your ${params.packageType} quote — `
    : "";
  const msg = `Hi ${params.firstName}! 👋 ${pkgHint}You left your booking unfinished in ${params.cityLabel}. Your spot is still open — complete it here: ${params.cityBookingUrl}\nQuestions? Call 850-517-7874 ✨`;
  const toNumber = params.phone.startsWith("+") ? params.phone : `+1${params.phone.replace(/\D/g, "")}`;
  try {
    const body = new URLSearchParams({ To: toNumber, From: fromNumber, Body: msg });
    const resp = await fetch(
      `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        },
        body: body.toString(),
      },
    );
    if (resp.ok) {
      console.log(`[AbandonedCart] Recovery SMS sent to ${toNumber}`);
      return true;
    }
    const txt = await resp.text();
    console.error(`[AbandonedCart] Twilio error ${resp.status}: ${txt}`);
    return false;
  } catch (err) {
    console.error("[AbandonedCart] SMS send error:", err);
    return false;
  }
}

// ─── Admin push notification helper ──────────────────────────────────────────
async function pushAdminNotification(params: {
  firstName: string;
  lastName: string;
  cityLabel: string;
  packageType: string | null;
}): Promise<void> {
  try {
    const drizzleDb = await getDb();
    if (!drizzleDb) return;
    const admins = await drizzleDb
      .select({ pushToken: employees.pushToken })
      .from(employees)
      .where(inArray(employees.role, ["admin", "office", "operations_manager"]));
    const tokens = admins
      .map(a => a.pushToken)
      .filter((t): t is string => !!t && (t.startsWith("ExponentPushToken[") || t.startsWith("ExpoPushToken[")));
    if (tokens.length === 0) return;
    const serviceHint = params.packageType ? ` (${params.packageType})` : "";
    const payloads = tokens.map(to => ({
      to,
      title: `🛒 Abandoned Cart — ${params.cityLabel}`,
      body: `${params.firstName} ${params.lastName} started a booking${serviceHint} but didn't finish. Recovery SMS sent.`,
      sound: "default",
      data: { screen: "admin-pipeline" },
    }));
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloads),
    });
    console.log(`[AbandonedCart] Push sent to ${tokens.length} admin(s)`);
  } catch (err) {
    console.error("[AbandonedCart] Admin push error:", err);
  }
}

// ─── Main recovery processor ──────────────────────────────────────────────────
function isQuietHours(): boolean {
  const nowCST = new Date(new Date().toLocaleString("en-US", { timeZone: "America/Chicago" }));
  const hour = nowCST.getHours();
  return hour >= 20 || hour < 8;
}

async function processAbandonedCarts(): Promise<void> {
  try {
    if (isQuietHours()) {
      console.log("[AbandonedCart] Quiet hours (8 PM–8 AM CST) — skipping recovery messages");
      return;
    }
    const carts = await db.getAbandonedCartsForRecovery();
    if (carts.length === 0) return;
    console.log(`[AbandonedCart] Processing ${carts.length} abandoned cart(s)...`);

    for (const cart of carts) {
      // ── Safety check: re-fetch the record to confirm it's still "abandoned" ──
      // This guards against a race where the customer completed the booking
      // between the query and now.
      const fresh = await db.getBookingById(cart.bookingId);
      if (!fresh || fresh.status !== "abandoned") {
        console.log(`[AbandonedCart] Skipping ${cart.bookingId} — status is now "${fresh?.status ?? "gone"}"`);
        continue;
      }

      const cityConf = CITY_CONFIG[cart.location] ?? {
        label: cart.location,
        bookingUrl: "https://luxurywashonwheels.com/book/",
      };

      let smsSent = false;
      let emailSent = false;

      // ── 1. Recovery SMS ──────────────────────────────────────────────────────
      if (cart.phone) {
        smsSent = await sendRecoverySms({
          phone: cart.phone,
          firstName: cart.firstName,
          packageType: cart.packageType,
          cityLabel: cityConf.label,
          cityBookingUrl: cityConf.bookingUrl,
        });
      }

      // ── 2. Recovery email ────────────────────────────────────────────────────
      if (cart.email) {
        const emailContent = buildAbandonedCartRecoveryEmail({
          firstName: cart.firstName,
          lastName: cart.lastName,
          vehicleType: cart.vehicleType,
          packageType: cart.packageType,
          cityBookingUrl: cityConf.bookingUrl,
          cityLabel: cityConf.label,
        });
        emailSent = await sendEmail({
          to: cart.email,
          subject: emailContent.subject,
          html: emailContent.html,
          type: "other",
          customerName: `${cart.firstName} ${cart.lastName}`,
        });
      }

      // ── 3. Admin push notification ───────────────────────────────────────────
      await pushAdminNotification({
        firstName: cart.firstName,
        lastName: cart.lastName,
        cityLabel: cityConf.label,
        packageType: cart.packageType,
      });

      // ── 4. Mark as recovery sent so we don't fire again ─────────────────────
      await db.markAbandonedCartRecoverySent(cart.bookingId);

      console.log(
        `[AbandonedCart] Recovery complete for ${cart.bookingId} — SMS: ${smsSent}, Email: ${emailSent}`,
      );
    }
  } catch (err) {
    console.error("[AbandonedCart] Monitor error:", err);
  }
}

// ─── Monitor startup ──────────────────────────────────────────────────────────
/**
 * Starts the abandoned cart recovery monitor.
 * Checks every 5 minutes for carts that have been sitting for 30+ minutes.
 */
export function startAbandonedCartMonitor(): void {
  console.log("[AbandonedCart] Recovery monitor started (checks every 5 min)");
  // Run once after 5 minutes, then every 5 minutes
  setTimeout(() => {
    processAbandonedCarts();
    setInterval(processAbandonedCarts, 5 * 60 * 1000);
  }, 5 * 60 * 1000);
}
