import { Router, Request, Response } from "express";
import mysql from "mysql2/promise";
import crypto from "crypto";
import { sendEmail } from "./email";
import { upsertScheduleJob, getDb, getAvailableDetailersForSlot } from "./db";
import { employees } from "../drizzle/schema";
import { inArray } from "drizzle-orm";

// ─── Admin push helper (Flex Pass) ───────────────────────────────────────────
async function sendFlexPassAdminPush(customerName: string, requestedDate: string, requestedTime?: string, city?: string): Promise<void> {
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
    const timeStr = requestedTime ? ` at ${requestedTime}` : "";
    const cityStr = city ? ` — ${city}` : "";
    const payloads = tokens.map(to => ({
      to,
      title: `⚡ VIP Flex Pass Request${cityStr}`,
      body: `${customerName} requested ${requestedDate}${timeStr}. Tap to review.`,
      sound: "default",
      data: { screen: "admin-vip-flex-pass" },
    }));
    await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payloads),
    });
    console.log(`[FlexPass] Push sent to ${tokens.length} admin(s)`);
  } catch (err) {
    console.error("[FlexPass] Admin push error:", err);
  }
}

function getPublicUrl(): string {
  return process.env.PUBLIC_URL ?? "https://www.luxurywashonwheels.app";
}

async function getConn() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

export const vipRouter = Router();

// ─── Add-on schedule logic ────────────────────────────────────────────────────
// Paint Sealant: visits 1, 7
// Leather Condition: visits 1, 7
// Leather Deep Clean: visits 1, 5, 9
const ADD_ONS_BY_VISIT: Record<number, string[]> = {
  1: ["Paint Sealant", "Leather Deep Clean", "Leather Condition"],
  5: ["Leather Deep Clean"],
  7: ["Paint Sealant", "Leather Condition"],
  9: ["Leather Deep Clean"],
};

function getAddOnsForVisit(visitNumber: number): string[] {
  return ADD_ONS_BY_VISIT[visitNumber] ?? [];
}

function addMonths(date: Date, months: number): Date {
  const d = new Date(date);
  d.setMonth(d.getMonth() + months);
  return d;
}

// City slug helper
function cityToSlug(city: string): string {
  const c = (city || "").toLowerCase().trim();
  if (c.includes("fort walton") || c === "fwb") return "fwb";
  if (c.includes("destin")) return "destin";
  if (c.includes("niceville")) return "niceville";
  if (c.includes("pensacola")) return "pensacola";
  if (c.includes("crestview")) return "crestview";
  return c || "crestview";
}

// Get the Nth occurrence of a weekday in a month
// week: 1=first, 2=second, 3=third, 4=fourth, 5=last
// day: 0=Sun, 1=Mon, 2=Tue, 3=Wed, 4=Thu, 5=Fri, 6=Sat
function getNthWeekdayOfMonth(year: number, month: number, week: number, day: number): Date {
  if (week === 5) {
    const lastDay = new Date(year, month + 1, 0);
    let diff = lastDay.getDay() - day;
    if (diff < 0) diff += 7;
    return new Date(year, month, lastDay.getDate() - diff);
  }
  const first = new Date(year, month, 1);
  let offset = day - first.getDay();
  if (offset < 0) offset += 7;
  return new Date(year, month, 1 + offset + (week - 1) * 7);
}

// Compute the scheduled date for visit N (0-based index)
// For biweekly: visits are every 14 days from serviceStart
// For monthly: visits are on the Nth weekday of each successive month (or same day-of-month)
function computeVisitDate(
  start: Date,
  visitIndex: number,
  scheduleWeek: number | null,
  scheduleDay: number | null,
  frequency: "monthly" | "biweekly" = "monthly"
): Date {
  if (frequency === "biweekly") {
    const d = new Date(start);
    d.setDate(d.getDate() + visitIndex * 14);
    return d;
  }
  // monthly
  const targetMonth = start.getMonth() + visitIndex;
  const actualYear = start.getFullYear() + Math.floor(targetMonth / 12);
  const actualMonth = ((targetMonth % 12) + 12) % 12;
  if (scheduleWeek !== null && scheduleDay !== null) {
    return getNthWeekdayOfMonth(actualYear, actualMonth, scheduleWeek, scheduleDay);
  }
  return addMonths(start, visitIndex);
}

function formatDate(date: Date): string {
  return date.toISOString().split("T")[0];
}

function generateContractNumber(programType: "vip" | "maintenance" | "vip_elite" = "vip"): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  const rand = Math.floor(Math.random() * 9000) + 1000;
  const prefix = programType === "maintenance" ? "MNT" : programType === "vip_elite" ? "VIP" : "VIP";
  return `${prefix}-${y}${m}${d}-${rand}`;
}

// ─── Create contract ──────────────────────────────────────────────────────────
vipRouter.post("/create", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const {
      customerName, customerEmail, customerPhone, customerAddress,
      vehicleDescription, city, startDate, serviceStartDate, totalPrice, repName, notes,
      scheduleWeek, scheduleDay, frequency, programType,
      autoCreateJobs, creditCount,
    } = req.body;
    // autoCreateJobs defaults to true for backwards compatibility
    const shouldCreateJobs = autoCreateJobs !== false && autoCreateJobs !== "false";

    if (!customerName || !startDate || !totalPrice) {
      return res.status(400).json({ success: false, error: "Missing required fields" });
    }
    if (!customerEmail) {
      return res.status(400).json({ success: false, error: "Customer email is required to link this contract to their app account" });
    }

    const progType: "vip" | "maintenance" | "vip_elite" = programType === "maintenance" ? "maintenance" : programType === "vip_elite" ? "vip_elite" : "vip";
    const contractNumber = generateContractNumber(progType);
    const signatureToken = crypto.randomBytes(48).toString("hex");
    const start = new Date(startDate);
    // service_start_date: when recurring jobs begin (may differ from contract signed/start date)
    const serviceStart = serviceStartDate ? new Date(serviceStartDate) : start;
    const swNum: number | null = (scheduleWeek !== undefined && scheduleWeek !== null && scheduleWeek !== "") ? Number(scheduleWeek) : null;
    const sdNum: number | null = (scheduleDay !== undefined && scheduleDay !== null && scheduleDay !== "") ? Number(scheduleDay) : null;
    const freq: "monthly" | "biweekly" = frequency === "biweekly" ? "biweekly" : "monthly";

    // For biweekly: 26 visits (every 2 weeks = ~1 year) + 1 renewal
    // For monthly: 12 visits + 1 renewal
    // For VIP Elite: use creditCount if provided (6 or 12)
    const visitCount = (progType === 'vip_elite' && creditCount && [6, 12].includes(Number(creditCount)))
      ? Number(creditCount)
      : freq === "biweekly" ? 26 : 12;

    // Compute all visit dates + 1 renewal — based on serviceStart
    const visitDates: Date[] = [];
    for (let i = 0; i < visitCount + 1; i++) {
      visitDates.push(computeVisitDate(serviceStart, i, swNum, sdNum, freq));
    }
    // end_date = date of last service visit
    const end = visitDates[visitCount - 1];
    const renewalDate = visitDates[visitCount];
    const citySlug = cityToSlug(city ?? "");

    // Insert contract
    const [contractResult]: any = await db.execute(
      `INSERT INTO vip_contracts (contract_number, customer_name, customer_email, customer_phone, customer_address, vehicle_description, city, start_date, service_start_date, end_date, total_price, rep_name, notes, signature_token, status, schedule_week, schedule_day, frequency, program_type)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending_signature', ?, ?, ?, ?)`,
      [contractNumber, customerName, customerEmail ?? null, customerPhone ?? null,
       customerAddress ?? null, vehicleDescription ?? null, city ?? null,
       formatDate(start), formatDate(serviceStart), formatDate(end), totalPrice,
       repName ?? "Luxury Wash On Wheels", notes ?? null, signatureToken, swNum, sdNum, freq, progType]
    );
    const contractId = contractResult.insertId;

    // Auto-generate visits + corresponding schedule_jobs (only when autoCreateJobs is true)
    if (!shouldCreateJobs) {
      // Credit system mode: create vip_visits rows with NULL dates so the customer portal
      // shows them as redeemable credits. No schedule_jobs are created yet — those are
      // created when the customer redeems a credit and books a date.
      // Luxury/Basic split: 12 credits = 2 Luxury + 10 Basic; 6 credits = 1 Luxury + 5 Basic
      const luxuryCount = visitCount === 6 ? 1 : 2;
      for (let i = 1; i <= visitCount; i++) {
        const visitLabel = progType === "vip_elite" && i <= luxuryCount ? "Luxury Detail" : progType === "vip_elite" ? "Basic Detail" : "";
        await db.execute(
          `INSERT INTO vip_visits (contract_id, visit_number, scheduled_date, add_ons, status, notes)
           VALUES (?, ?, NULL, '[]', 'scheduled', ?)`,
          [contractId, i, visitLabel || null]
        );
      }
      await conn.end();
      return res.json({
        success: true,
        contractId,
        contractNumber,
        signatureToken,
        signatureUrl: `${getPublicUrl()}/api/vip/sign/${signatureToken}`,
        visitDates: visitDates.slice(0, visitCount).map(formatDate),
        renewalDate: formatDate(renewalDate),
        jobsCreated: false,
        creditsCreated: visitCount,
      });
    }

    for (let i = 1; i <= visitCount; i++) {
      const visitDate = visitDates[i - 1];
      // VIP gets rotating premium add-ons; Maintenance and VIP Elite get no rotating add-ons
      const addOns = progType === "vip" ? getAddOnsForVisit(i) : [];
      const jobId = `vip-${contractId}-v${i}-${Date.now()}`;
      await db.execute(
        `INSERT INTO vip_visits (contract_id, visit_number, scheduled_date, add_ons, status, schedule_job_id)
         VALUES (?, ?, ?, ?, 'scheduled', ?)`,
        [contractId, i, formatDate(visitDate), JSON.stringify(addOns), jobId]
      );
      try {
        const addOnLabel = addOns.length > 0 ? ` + ${addOns.join(", ")}` : "";
        await upsertScheduleJob({
          jobId,
          location: citySlug,
          date: formatDate(visitDate),
          timeSlot: null as any,
          startHour: null as any,
          endHour: null as any,
          customerName,
          customerPhone: customerPhone ?? null,
          customerEmail: customerEmail ?? null,
          vehicleType: vehicleDescription ?? null,
          packageType: "luxury",
          serviceDescription: progType === "maintenance"
            ? `Maintenance Visit ${i} of ${visitCount} — ${contractNumber}`
            : progType === "vip_elite"
            ? `VIP Elite Credit ${i} of ${visitCount} — ${contractNumber}`
            : `VIP Visit ${i} of ${visitCount} — ${contractNumber}${addOnLabel}`,
          selectedAddons: JSON.stringify(addOns),
          // Visit 1 charges the full contract total; all subsequent visits are $0 (pre-paid for the year)
          totalPrice: i === 1 ? Number(totalPrice).toFixed(2) : "0.00",
          status: "pending",
          source: "manual",
          notes: progType === "maintenance"
            ? `Maintenance Program — Contract ${contractNumber}. Visit ${i} of ${visitCount} (${freq}).`
            : `VIP Program — Contract ${contractNumber}. Visit ${i} of ${visitCount} (${freq}).`,
          tags: JSON.stringify([progType === "maintenance" ? "Maintenance" : progType === "vip_elite" ? "VIP Elite" : "VIP"]),
          leadSource: progType === "maintenance" ? "Maintenance Program" : progType === "vip_elite" ? "VIP Elite Program" : "VIP Program",
        } as any);
      } catch (jobErr: any) {
        console.error(`[VIP] schedule_job for visit ${i} failed:`, jobErr.message);
      }
    }

    // Renewal appointment — schedule_job only (internal team reminder, NOT a customer visit)
    const renewalJobId = `vip-${contractId}-renewal-${Date.now()}`;
    try {
      await upsertScheduleJob({
        jobId: renewalJobId,
        location: citySlug,
        date: formatDate(renewalDate),
        timeSlot: null as any,
        startHour: null as any,
        endHour: null as any,
        customerName,
        customerPhone: customerPhone ?? null,
        customerEmail: customerEmail ?? null,
        vehicleType: vehicleDescription ?? null,
        packageType: "luxury",
          serviceDescription: progType === "maintenance"
          ? `MAINTENANCE RENEWAL — ${contractNumber} — Discuss next contract`
          : progType === "vip_elite"
          ? `VIP ELITE RENEWAL — ${contractNumber} — Discuss next 12-month contract`
          : `VIP RENEWAL — ${contractNumber} — Discuss next 12-month contract`,
        selectedAddons: "[]",
        totalPrice: "0",
        status: "pending",
        source: "manual",
        notes: progType === "maintenance"
          ? `Maintenance Renewal appointment for contract ${contractNumber}.`
          : `VIP Renewal appointment for contract ${contractNumber}.`,
        tags: JSON.stringify([progType === "maintenance" ? "Maintenance" : "VIP", "Renewal"]),
        leadSource: progType === "maintenance" ? "Maintenance Program" : "VIP Program",
      } as any);
    } catch (jobErr: any) {
      console.error("[VIP] renewal schedule_job failed:", jobErr.message);
    }

    return res.json({
      success: true,
      contractId,
      contractNumber,
      signatureToken,
      signatureUrl: `${getPublicUrl()}/api/vip/sign/${signatureToken}`,
      visitDates: visitDates.slice(0, visitCount).map(formatDate),
      renewalDate: formatDate(renewalDate),
    });
  } catch (err: any) {
    console.error("[VIP] create error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── List contracts ───────────────────────────────────────────────────────────
vipRouter.get("/list", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    
    const { city, status, programType } = req.query;
    let where = "WHERE 1=1";
    const params: any[] = [];
    if (city) { where += " AND city = ?"; params.push(city); }
    if (status) { where += " AND status = ?"; params.push(status); }
    if (programType) { where += " AND program_type = ?"; params.push(programType); }
    const [rows]: any = await db.execute(
      `SELECT id, contract_number, customer_name, customer_email, customer_phone,
              vehicle_description, city, start_date, service_start_date, end_date, total_price, status,
              signed_at, rep_name, renewal_notified, created_at, program_type
       FROM vip_contracts ${where} ORDER BY created_at DESC`,
      params
    );
    return res.json({ success: true, contracts: rows });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Get single contract with visits ─────────────────────────────────────────
vipRouter.get("/contract/:id", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    
    const [contracts]: any = await db.execute(
      "SELECT * FROM vip_contracts WHERE id = ?", [req.params.id]
    );
    if (!contracts.length) return res.status(404).json({ success: false, error: "Not found" });
    const contract = contracts[0];
    const [visits]: any = await db.execute(
      "SELECT * FROM vip_visits WHERE contract_id = ? ORDER BY visit_number ASC",
      [contract.id]
    );
    contract.visits = visits.map((v: any) => ({
      ...v,
      add_ons: typeof v.add_ons === "string" ? JSON.parse(v.add_ons) : (v.add_ons ?? []),
    }));
    return res.json({ success: true, contract });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Get contract by token (for customer portal) ──────────────────────────────
vipRouter.get("/by-token/:token", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    
    const [contracts]: any = await db.execute(
      "SELECT * FROM vip_contracts WHERE signature_token = ? AND status NOT IN ('cancelled')", [req.params.token]
    );
    if (!contracts.length) return res.status(404).json({ success: false, error: "Not found" });
    const contract = contracts[0];
    const [visits]: any = await db.execute(
      "SELECT * FROM vip_visits WHERE contract_id = ? ORDER BY visit_number ASC",
      [contract.id]
    );
    contract.visits = visits.map((v: any) => ({
      ...v,
      add_ons: typeof v.add_ons === "string" ? JSON.parse(v.add_ons) : (v.add_ons ?? []),
    }));
    // Don't expose signature data to customer
    delete contract.client_signature_data;
    return res.json({ success: true, contract });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Get contract by customer email (for customer portal) ───────────────────────
vipRouter.get("/by-email/:email", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const email = decodeURIComponent(req.params.email).toLowerCase().trim();
    // Optional last name for stricter matching (prevents shared-email false positives)
    const lastName = req.query.lastName ? String(req.query.lastName).toLowerCase().trim() : null;
    // Find ALL active/pending contracts for this email
    const [contracts]: any = await db.execute(
      `SELECT * FROM vip_contracts
       WHERE LOWER(TRIM(customer_email)) = ?
         AND status IN ('active', 'pending_signature')
       ORDER BY created_at DESC`,
      [email]
    );
    if (!contracts.length) return res.json({ success: true, contract: null, contracts: [] });

    // Helper: enrich visits with linked schedule_job data (time_slot, status)
    async function enrichVisits(contractId: number) {
      const [visits]: any = await db.execute(
        `SELECT v.*, sj.time_slot AS sj_time_slot, sj.status AS sj_status, sj.date AS sj_date
         FROM vip_visits v
         LEFT JOIN schedule_jobs sj ON sj.job_id = v.schedule_job_id
         WHERE v.contract_id = ?
         ORDER BY v.visit_number ASC`,
        [contractId]
      );
      return visits.map((v: any) => ({
        ...v,
        add_ons: typeof v.add_ons === "string" ? JSON.parse(v.add_ons) : (v.add_ons ?? []),
        // Use the linked schedule_job's date/time if available (admin may have updated it)
        scheduled_date: v.sj_date ?? v.scheduled_date,
        scheduled_time: v.sj_time_slot ?? v.scheduled_time ?? null,
        // Auto-derive completion: if the linked schedule_job is completed, treat visit as completed
        status: (v.status === "completed" || v.sj_status === "completed") ? "completed" : v.status,
        completed_at: v.completed_at ?? (v.sj_status === "completed" ? new Date().toISOString() : null),
      }));
    }

    // If a last name was provided, filter to contracts where the customer name contains it
    let primaryContracts = contracts;
    if (lastName) {
      const matched = contracts.filter((c: any) =>
        c.customer_name && c.customer_name.toLowerCase().includes(lastName)
      );
      if (matched.length) primaryContracts = matched;
    }

    // Enrich all contracts with visit data
    const enrichedContracts = await Promise.all(
      primaryContracts.map(async (c: any) => {
        const enriched = { ...c };
        enriched.visits = await enrichVisits(c.id);
        delete enriched.client_signature_data;
        // Compute credits_remaining: total visits - (completed + redeemed/pending) visits
        // A credit is "used" as soon as it has been booked (has a scheduled_date), not just when completed.
        const totalV = (c.frequency === 'biweekly') ? 26 : 12;
        const nonReplacement = enriched.visits.filter((v: any) => !v.is_replacement);
        const completedV = nonReplacement.filter((v: any) => v.status === 'completed').length;
        // Count visits that have been redeemed (have a scheduled_date set) but not yet completed
        const redeemedV = nonReplacement.filter((v: any) => v.status !== 'completed' && v.status !== 'cancelled' && v.scheduled_date).length;
        const usedV = completedV + redeemedV;
        enriched.credits_remaining = Math.max(totalV - usedV, 0);
        enriched.total_visits = totalV;
        enriched.completed_visits = completedV;
        enriched.redeemed_visits = redeemedV;
        // Per-type counts for VIP Elite (luxury vs basic)
        const luxuryTotal = Number(totalV) === 12 ? 2 : (Number(totalV) === 6 ? 1 : 2);
        const basicTotal = totalV - luxuryTotal;
        const luxuryUsed = nonReplacement.filter((v: any) => {
          const isLux = (v.service_type === 'luxury' || (v.notes && v.notes.includes('Luxury Detail')));
          return isLux && (v.status === 'completed' || (v.status !== 'cancelled' && v.scheduled_date));
        }).length;
        const basicUsed = nonReplacement.filter((v: any) => {
          const isBasic = (v.service_type === 'basic' || (v.notes && v.notes.includes('Basic Detail')));
          return isBasic && (v.status === 'completed' || (v.status !== 'cancelled' && v.scheduled_date));
        }).length;
        enriched.luxury_total = luxuryTotal;
        enriched.basic_total = basicTotal;
        enriched.luxury_remaining = Math.max(luxuryTotal - luxuryUsed, 0);
        enriched.basic_remaining = Math.max(basicTotal - basicUsed, 0);
        return enriched;
      })
    );

    // For backward compat: return first contract as `contract`, all as `contracts`
    return res.json({ success: true, contract: enrichedContracts[0], contracts: enrichedContracts });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Send signature request ───────────────────────────────────────────────────
vipRouter.post("/send-signature", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const { contractId, method } = req.body; // method: 'email' | 'sms'
    
    const [contracts]: any = await db.execute(
      "SELECT * FROM vip_contracts WHERE id = ?", [contractId]
    );
    if (!contracts.length) return res.status(404).json({ success: false, error: "Not found" });
    const contract = contracts[0];
    const signUrl = `${getPublicUrl()}/api/vip/sign/${contract.signature_token}`;

    if (method === "email" && contract.customer_email) {
      await sendEmail({
        to: contract.customer_email,
        subject: `Your Luxury Wash On Wheels VIP Contract — ${contract.contract_number}`,
        type: "booking_confirmation",
        urgent: true,
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#1a1a2e">Your VIP Service Agreement is Ready to Sign</h2>
            <p>Hi ${contract.customer_name},</p>
            <p>Your 12-month VIP Mobile Detailing Service Agreement with <strong>Luxury Wash On Wheels</strong> is ready for your review and signature.</p>
            <p><strong>Contract #:</strong> ${contract.contract_number}<br>
            <strong>Vehicle:</strong> ${contract.vehicle_description || "—"}<br>
            <strong>Start Date:</strong> ${contract.start_date}<br>
            <strong>Total:</strong> $${Number(contract.total_price).toFixed(2)}</p>
            <p style="margin:24px 0">
              <a href="${signUrl}" style="background:#1a1a2e;color:#fff;padding:14px 28px;border-radius:8px;text-decoration:none;font-weight:bold">Review & Sign Contract</a>
            </p>
            <p style="color:#666;font-size:13px">This link is unique to you. Please do not share it.</p>
            <p style="color:#666;font-size:13px">Questions? Call us at 850-517-7874 or email Office@luxurywashonwheels.com</p>
          </div>
        `,
      });
    } else if (method === "sms" && contract.customer_phone) {
      // Use existing Twilio pattern
      const twilioSid = process.env.TWILIO_ACCOUNT_SID;
      const twilioToken = process.env.TWILIO_AUTH_TOKEN;
      const twilioFrom = process.env.TWILIO_PHONE_NUMBER;
      if (twilioSid && twilioToken && twilioFrom) {
        const body = `Hi ${contract.customer_name}! Your Luxury Wash On Wheels VIP contract (${contract.contract_number}) is ready to sign: ${signUrl}`;
        const encoded = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
        await fetch(`https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`, {
          method: "POST",
          headers: { "Authorization": `Basic ${encoded}`, "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({ From: twilioFrom, To: contract.customer_phone, Body: body }).toString(),
        });
      }
    }

    return res.json({ success: true, signatureUrl: signUrl });
  } catch (err: any) {
    console.error("[VIP] send-signature error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Signature page (customer-facing HTML) ────────────────────────────────────
vipRouter.get("/sign/:token", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    if (!db) return res.status(500).send("<h2>Service unavailable</h2>");
    const [contracts]: any = await db.execute(
      "SELECT * FROM vip_contracts WHERE signature_token = ?", [req.params.token]
    );
    if (!contracts.length) return res.status(404).send("<h2>Contract not found or link expired.</h2>");
    const c = contracts[0];

    if (c.status === "active" || c.signed_at) {
      return res.send(`<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Already Signed</title>
        <style>body{font-family:sans-serif;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0;background:#f5f5f5}
        .card{background:#fff;border-radius:16px;padding:40px;text-align:center;max-width:400px;box-shadow:0 4px 24px rgba(0,0,0,.1)}
        .check{font-size:64px;margin-bottom:16px}.title{font-size:22px;font-weight:700;color:#1a1a2e;margin-bottom:8px}
        .sub{color:#666;font-size:15px}</style></head>
        <body><div class="card"><div class="check">✅</div>
        <div class="title">Contract Already Signed</div>
        <div class="sub">Thank you, ${c.customer_name}! Your VIP contract #${c.contract_number} was signed on ${new Date(c.signed_at).toLocaleDateString()}.</div>
        </div></body></html>`);
    }

    const [visits]: any = await db.execute(
      "SELECT * FROM vip_visits WHERE contract_id = ? ORDER BY visit_number ASC", [c.id]
    );

    const visitRows = visits.map((v: any) => {
      const addOns: string[] = typeof v.add_ons === "string" ? JSON.parse(v.add_ons) : (v.add_ons ?? []);
      const addOnBadges = addOns.map((a: string) => `<span style="background:#e8f4fd;color:#1a6fa8;padding:2px 8px;border-radius:12px;font-size:12px;margin-right:4px">${a}</span>`).join("");
      return `<tr style="border-bottom:1px solid #eee">
        <td style="padding:8px 12px;font-weight:600">Visit ${v.visit_number}</td>
        <td style="padding:8px 12px;color:#555">${v.scheduled_date || "TBD"}</td>
        <td style="padding:8px 12px">${addOnBadges || '<span style="color:#999">Base service only</span>'}</td>
      </tr>`;
    }).join("");

    res.send(`<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>VIP Contract — Luxury Wash On Wheels</title>
  <style>
    *{box-sizing:border-box}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;margin:0;padding:0;background:#f5f5f5;color:#1a1a2e}
    .header{background:#1a1a2e;color:#fff;padding:20px 24px;text-align:center}
    .header h1{margin:0;font-size:20px;font-weight:700}
    .header p{margin:4px 0 0;font-size:14px;opacity:.8}
    .container{max-width:700px;margin:0 auto;padding:24px 16px}
    .card{background:#fff;border-radius:12px;padding:24px;margin-bottom:20px;box-shadow:0 2px 12px rgba(0,0,0,.06)}
    h2{font-size:16px;font-weight:700;margin:0 0 12px;color:#1a1a2e;border-bottom:2px solid #1a1a2e;padding-bottom:8px}
    .info-row{display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid #f0f0f0;font-size:14px}
    .info-row:last-child{border-bottom:none}
    .info-label{color:#666;font-weight:500}
    .info-value{font-weight:600;text-align:right}
    ul{margin:8px 0;padding-left:20px}
    ul li{margin-bottom:6px;font-size:14px;line-height:1.5}
    table{width:100%;border-collapse:collapse;font-size:13px}
    th{background:#f8f8f8;padding:8px 12px;text-align:left;font-size:12px;color:#666;text-transform:uppercase;letter-spacing:.5px}
    .sig-section{margin-top:8px}
    .sig-label{font-size:13px;font-weight:600;margin-bottom:8px;color:#1a1a2e}
    canvas{border:2px solid #ddd;border-radius:8px;width:100%;max-width:500px;height:160px;display:block;touch-action:none;background:#fafafa;cursor:crosshair}
    .btn{display:block;width:100%;padding:16px;border-radius:12px;font-size:16px;font-weight:700;border:none;cursor:pointer;margin-top:12px}
    .btn-clear{background:#f0f0f0;color:#333}
    .btn-sign{background:#1a1a2e;color:#fff}
    .btn-sign:disabled{background:#999;cursor:not-allowed}
    .success-card{text-align:center;padding:40px 24px}
    .success-icon{font-size:64px;margin-bottom:16px}
    .success-title{font-size:22px;font-weight:700;margin-bottom:8px}
    .success-sub{color:#666;font-size:15px}
    p{font-size:14px;line-height:1.6;color:#333}
    .policy-section{margin-bottom:16px}
    .policy-section h3{font-size:14px;font-weight:700;margin:0 0 6px;color:#1a1a2e}
  </style>
</head>
<body>
  <div class="header">
    <h1>🚗 Luxury Wash On Wheels</h1>
    <p>${c.program_type === 'vip_elite' ? 'VIP Elite Mobile Detailing Service Agreement' : c.program_type === 'maintenance' ? 'Maintenance Program Service Agreement' : 'VIP Mobile Detailing Service Agreement'}</p>
  </div>
  <div class="container" id="contract-view">

    <div class="card">
      <h2>Agreement Details</h2>
      <div class="info-row"><span class="info-label">Contract #</span><span class="info-value">${c.contract_number}</span></div>
      <div class="info-row"><span class="info-label">Date</span><span class="info-value">${new Date(c.created_at).toLocaleDateString()}</span></div>
      <div class="info-row"><span class="info-label">Client</span><span class="info-value">${c.customer_name}</span></div>
      <div class="info-row"><span class="info-label">Vehicle</span><span class="info-value">${c.vehicle_description || "—"}</span></div>
      <div class="info-row"><span class="info-label">Address</span><span class="info-value" style="max-width:60%;text-align:right">${c.customer_address || "—"}</span></div>
      <div class="info-row"><span class="info-label">Service Provider</span><span class="info-value">Luxury Wash On Wheels</span></div>
      <div class="info-row"><span class="info-label">Phone</span><span class="info-value">850-517-7874</span></div>
    </div>

    <div class="card">
      <h2>1. Services Provided</h2>
      ${c.program_type === 'vip_elite' ? `
      <p>Luxury Wash On Wheels agrees to provide professional mobile detailing services for a total of <strong>12 detail credits</strong> over 12 months. The client may schedule each visit at their convenience through the customer portal.</p>
      <p><strong>Credit Breakdown:</strong></p>
      <ul>
        <li><strong>2 Luxury Details</strong> &mdash; Full premium service (use anytime)</li>
        <li><strong>10 Basic Details</strong> &mdash; Standard full detail service (use anytime)</li>
      </ul>
      <p><strong>With every visit, the client's vehicle will receive:</strong></p>
      <ul>
        <li>Hand wash / debug front end &amp; mirrors</li>
        <li>Clean gas cap</li>
        <li>Remove surface spots</li>
        <li>Clean door and trunk jambs &amp; clean front rims</li>
        <li>Clean wheels &amp; wheel wells</li>
        <li>Dress tires</li>
        <li>Wipe down leather</li>
        <li>Vacuum interior</li>
        <li>Wipe down dash, console, and door panels</li>
        <li>Clean windows (inside &amp; out)</li>
      </ul>
      <p><strong>Maximum Time on Job:</strong> 1 hour per visit. Add-ons may be requested manually per visit.</p>
      ` : `
      <p>Luxury Wash On Wheels agrees to provide professional mobile detailing services once per month for a total of 12 visits over 12 months.</p>
      <p><strong>With every visit, the client's vehicle will receive:</strong></p>
      <ul>
        <li>Hand wash / debug front end &amp; mirrors</li>
        <li>Clean gas cap</li>
        <li>Remove surface spots</li>
        <li>Clean door and trunk jambs &amp; clean front rims</li>
        <li>Clean wheels &amp; wheel wells</li>
        <li>Dress tires</li>
        <li>Wipe down leather</li>
        <li>Vacuum interior</li>
        <li>Wipe down dash, console, and door panels</li>
        <li>Clean windows (inside &amp; out)</li>
      </ul>
      <p><strong>Maximum Time on Job:</strong> 1 hour</p>
      <p><strong>Add-ons Included:</strong></p>
      <ul>
        <li>2 Paint Sealants (Visits 1 &amp; 7)</li>
        <li>3 Leather Deep Cleans (Visits 1, 5 &amp; 9)</li>
        <li>2 Leather Conditions (Visits 1 &amp; 7)</li>
        <li>Shampoo when needed</li>
      </ul>
      `}
    </div>

    <div class="card">
      <h2>2. Service Schedule</h2>
      ${c.program_type === 'vip_elite'
        ? `<p>The client receives <strong>12 detail credits</strong> valid for <strong>12 months</strong> from: <strong>${c.start_date}</strong>. Credits may be scheduled at the client's convenience through the customer portal, subject to availability.</p>`
        : `<p>Detailing services will be provided <strong>once per month</strong> for a duration of <strong>12 months</strong>, starting from: <strong>${c.start_date}</strong></p>`
      }
      <table>
        <thead><tr><th>Visit</th><th>Date</th><th>Add-Ons</th></tr></thead>
        <tbody>${visitRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>3. Payment Terms</h2>
      <ul>
        <li>Total amount due for 12 months of service: <strong>$${Number(c.total_price).toFixed(2)}</strong></li>
        <li><strong>Full payment is due upfront</strong> upon signing this agreement.</li>
        <li>Payments are non-refundable except under the termination terms outlined below.</li>
      </ul>
    </div>

    <div class="card">
      <h2>4. Cancellation &amp; Rescheduling Policy</h2>
      <p>Clients may cancel or reschedule an appointment <strong>at least 12 hours before the scheduled time</strong>.</p>
      <ul>
        <li>Cancellations or no-shows within 12 hours of the appointment will result in <strong>forfeiture of that visit</strong>, with no refund or makeup.</li>
      </ul>
    </div>

    <div class="card">
      <h2>5. Early Termination</h2>
      ${c.program_type === 'maintenance' ? `
      <p>The Maintenance Program operates on a month-to-month basis. Client may cancel at any time by:</p>
      <ul>
        <li>Providing <strong>7 days written notice</strong> before the next scheduled service date.</li>
        <li>Failure to provide 7 days notice will result in <strong>one additional month's charge</strong> being applied before the agreement is terminated.</li>
      </ul>
      <p>Luxury Wash On Wheels also reserves the right to cancel the agreement due to client misconduct or vehicle safety concerns.</p>
      ` : `
      <p>Client may terminate this agreement early by:</p>
      <ul>
        <li>Submitting a <strong>30-day written notice</strong>, and</li>
        <li>Paying a <strong>50% penalty of remaining services</strong> at time of cancellation.</li>
      </ul>
      <p>Luxury Wash On Wheels also reserves the right to cancel the agreement due to client misconduct or vehicle safety concerns.</p>
      `}
    </div>

    <div class="card">
      <h2>6. Liability &amp; Limitations</h2>
      <p>Luxury Wash On Wheels is not liable for:</p>
      <ul>
        <li>Pre-existing vehicle damage</li>
        <li>Delays caused by weather or unsafe work environments</li>
      </ul>
      <p>The client agrees to provide access to the vehicle and ensure it is safe and legally parked during service.</p>
    </div>

    <div class="card">
      <h2>7. Entire Agreement</h2>
      <p>This document represents the full agreement between both parties. Amendments must be made in writing and signed by both parties.</p>
    </div>

    <div class="card">
      <h2>Client Signature</h2>
      <p style="color:#666;font-size:13px">By signing below, you agree to all terms and conditions of this ${c.program_type === 'vip_elite' ? 'VIP Elite Service Agreement' : c.program_type === 'maintenance' ? 'Maintenance Program Service Agreement' : 'VIP Service Agreement'}.</p>
      <div class="sig-section">
        <div class="sig-label">Sign here (use your finger or stylus):</div>
        <canvas id="sig-canvas" width="600" height="160"></canvas>
        <button class="btn btn-clear" onclick="clearSig()">Clear Signature</button>
        <button class="btn btn-sign" id="sign-btn" onclick="submitSignature()" disabled>Sign &amp; Submit Contract</button>
        <p id="error-msg" style="color:#e53e3e;font-size:13px;display:none"></p>
      </div>
    </div>

  </div>

  <div id="success-view" style="display:none" class="container">
    <div class="card success-card">
      <div class="success-icon">✅</div>
      <div class="success-title">Contract Signed!</div>
      <div class="success-sub">Thank you, ${c.customer_name}! Your ${c.program_type === 'vip_elite' ? 'VIP Elite' : c.program_type === 'maintenance' ? 'Maintenance Program' : 'VIP'} contract has been signed and saved. You'll receive a confirmation shortly.</div>
    </div>
  </div>

  <script>
    const canvas = document.getElementById('sig-canvas');
    const ctx = canvas.getContext('2d');
    let drawing = false;
    let hasSig = false;

    function getPos(e) {
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      const src = e.touches ? e.touches[0] : e;
      return { x: (src.clientX - rect.left) * scaleX, y: (src.clientY - rect.top) * scaleY };
    }

    canvas.addEventListener('mousedown', e => { drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); });
    canvas.addEventListener('mousemove', e => { if (!drawing) return; const p = getPos(e); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1a2e'; ctx.lineTo(p.x, p.y); ctx.stroke(); hasSig = true; document.getElementById('sign-btn').disabled = false; });
    canvas.addEventListener('mouseup', () => drawing = false);
    canvas.addEventListener('touchstart', e => { e.preventDefault(); drawing = true; const p = getPos(e); ctx.beginPath(); ctx.moveTo(p.x, p.y); }, { passive: false });
    canvas.addEventListener('touchmove', e => { e.preventDefault(); if (!drawing) return; const p = getPos(e); ctx.lineWidth = 2.5; ctx.lineCap = 'round'; ctx.strokeStyle = '#1a1a2e'; ctx.lineTo(p.x, p.y); ctx.stroke(); hasSig = true; document.getElementById('sign-btn').disabled = false; }, { passive: false });
    canvas.addEventListener('touchend', () => drawing = false);

    function clearSig() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      hasSig = false;
      document.getElementById('sign-btn').disabled = true;
    }

    async function submitSignature() {
      if (!hasSig) return;
      const btn = document.getElementById('sign-btn');
      btn.disabled = true;
      btn.textContent = 'Submitting...';
      const sigData = canvas.toDataURL('image/png');
      try {
        const res = await fetch('/api/vip/submit-signature', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ token: '${c.signature_token}', signatureData: sigData }),
        });
        const data = await res.json();
        if (data.success) {
          document.getElementById('contract-view').style.display = 'none';
          document.getElementById('success-view').style.display = 'block';
        } else {
          document.getElementById('error-msg').textContent = data.error || 'Failed to submit. Please try again.';
          document.getElementById('error-msg').style.display = 'block';
          btn.disabled = false;
          btn.textContent = 'Sign & Submit Contract';
        }
      } catch {
        document.getElementById('error-msg').textContent = 'Network error. Please try again.';
        document.getElementById('error-msg').style.display = 'block';
        btn.disabled = false;
        btn.textContent = 'Sign & Submit Contract';
      }
    }
  </script>
</body>
</html>`);
  } catch (err: any) {
    res.status(500).send("<h2>Error loading contract</h2>");
  }
});

// ─── Submit signature ─────────────────────────────────────────────────────────
vipRouter.post("/submit-signature", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const { token, signatureData } = req.body;
    if (!token || !signatureData) return res.status(400).json({ success: false, error: "Missing fields" });
    
    const [contracts]: any = await db.execute(
      "SELECT * FROM vip_contracts WHERE signature_token = ?", [token]
    );
    if (!contracts.length) return res.status(404).json({ success: false, error: "Contract not found" });
    const c = contracts[0];
    if (c.signed_at) return res.json({ success: true, alreadySigned: true });

    await db.execute(
      "UPDATE vip_contracts SET status='active', signed_at=NOW(), client_signature_data=? WHERE id=?",
      [signatureData, c.id]
    );

    // Send confirmation email
    if (c.customer_email) {
      await sendEmail({
        to: c.customer_email,
        subject: `VIP Contract Signed — ${c.contract_number}`,
        html: `<div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#1a1a2e">✅ Your VIP Contract is Active!</h2>
          <p>Hi ${c.customer_name},</p>
          <p>Your VIP Service Agreement <strong>${c.contract_number}</strong> has been signed and is now active.</p>
          <p><strong>Service starts:</strong> ${c.start_date}<br>
          <strong>Contract ends:</strong> ${c.end_date}<br>
          <strong>Total paid:</strong> $${Number(c.total_price).toFixed(2)}</p>
          <p>We look forward to serving you every month! Questions? Call 850-517-7874 or email Office@luxurywashonwheels.com</p>
        </div>`,
      }).catch(() => {});
    }

    // Push notification to all admins/office/ops when contract is signed
    try {
      const drizzleDb = await getDb();
      if (drizzleDb) {
        const admins = await drizzleDb
          .select({ pushToken: employees.pushToken })
          .from(employees)
          .where(inArray(employees.role, ['admin', 'operations_manager', 'office']));
        const tokens = admins
          .map((a: { pushToken: string | null }) => a.pushToken)
          .filter((t): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
        if (tokens.length > 0) {
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(tokens.map(to => ({
              to,
              title: '\u270d\ufe0f VIP Contract Signed',
              body: `${c.customer_name} just signed contract ${c.contract_number}`,
              sound: 'default',
              data: { screen: 'admin-vip', contractId: c.id },
            }))),
          }).catch(() => {});
        }
      }
    } catch (_) { /* non-fatal */ }
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── View signed contract (admin) ────────────────────────────────────────────
// Returns full contract HTML with signature image embedded — for admin viewing
vipRouter.get("/view-signed/:id", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const [contracts]: any = await db.execute(
      "SELECT * FROM vip_contracts WHERE id = ?", [req.params.id]
    );
    if (!contracts.length) return res.status(404).send("<h2>Contract not found.</h2>");
    const c = contracts[0];
    if (!c.signed_at) return res.status(400).send("<h2>This contract has not been signed yet.</h2>");
    const [visits]: any = await db.execute(
      "SELECT * FROM vip_visits WHERE contract_id = ? ORDER BY visit_number ASC", [c.id]
    );
    const visitRows = visits.map((v: any) => {
      const d = v.scheduled_date ? new Date(v.scheduled_date).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }) : "TBD";
      const icon = v.status === "completed" ? "✅" : v.status === "missed" ? "❌" : "📅";
      return `<tr><td style="padding:6px 12px;border-bottom:1px solid #eee;color:#555">${icon} Visit ${v.visit_number}</td><td style="padding:6px 12px;border-bottom:1px solid #eee">${d}</td><td style="padding:6px 12px;border-bottom:1px solid #eee;text-transform:capitalize;color:${v.status==="completed"?"#16a34a":v.status==="missed"?"#dc2626":"#555"}">${v.status}</td></tr>`;
    }).join("");
    const signedDate = new Date(c.signed_at).toLocaleString("en-US", { month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Chicago" });
    const sigImg = c.client_signature_data ? `<img src="${c.client_signature_data}" style="max-width:300px;border:1px solid #ddd;border-radius:8px;background:#fff;padding:8px" alt="Signature" />` : "<em style=\"color:#999\">Signature data not available</em>";
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Signed Contract — ${c.contract_number}</title>
<style>
  body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f5f5f5;margin:0;padding:20px;color:#1a1a2e}
  .container{max-width:700px;margin:0 auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.1)}
  .header{background:#1a1a2e;color:#fff;padding:24px 32px;display:flex;justify-content:space-between;align-items:center}
  .header h1{margin:0;font-size:20px;font-weight:700}
  .badge{background:#16a34a;color:#fff;padding:6px 14px;border-radius:20px;font-size:13px;font-weight:700}
  .body{padding:32px}
  .section{margin-bottom:28px}
  .section-title{font-size:11px;font-weight:700;color:#999;text-transform:uppercase;letter-spacing:1px;margin-bottom:12px}
  .info-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}
  .info-item label{font-size:11px;color:#999;display:block;margin-bottom:2px}
  .info-item span{font-size:15px;font-weight:600;color:#1a1a2e}
  table{width:100%;border-collapse:collapse;font-size:14px}
  .sig-box{background:#f9fafb;border:2px solid #16a34a;border-radius:12px;padding:24px;text-align:center}
  .sig-date{font-size:13px;color:#555;margin-top:12px}
  .admin-banner{background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:10px 16px;margin-bottom:20px;font-size:13px;color:#92400e;text-align:center}
  @media print{.admin-banner{display:none}}
</style></head>
<body>
<div class="container">
  <div class="header">
    <div>
      <h1>VIP Service Agreement</h1>
      <div style="font-size:13px;opacity:0.7;margin-top:4px">${c.contract_number}</div>
    </div>
    <div class="badge">✅ SIGNED</div>
  </div>
  <div class="body">
    <div class="admin-banner">🔒 Admin View — This is the signed copy of the contract. Signed on ${signedDate} CT.</div>
    <div class="section">
      <div class="section-title">Customer Information</div>
      <div class="info-grid">
        <div class="info-item"><label>Name</label><span>${c.customer_name}</span></div>
        <div class="info-item"><label>Email</label><span>${c.customer_email ?? "—"}</span></div>
        <div class="info-item"><label>Phone</label><span>${c.customer_phone ?? "—"}</span></div>
        <div class="info-item"><label>Vehicle</label><span>${c.vehicle_description ?? "—"}</span></div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Contract Terms</div>
      <div class="info-grid">
        <div class="info-item"><label>Contract Date</label><span>${new Date(c.start_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}</span></div>
        <div class="info-item"><label>End Date</label><span>${new Date(c.end_date).toLocaleDateString("en-US",{month:"short",day:"numeric",year:"numeric",timeZone:"UTC"})}</span></div>
        <div class="info-item"><label>Total Value</label><span>$${Number(c.total_price).toFixed(2)}</span></div>
        <div class="info-item"><label>Program</label><span style="text-transform:capitalize">${c.program_type ?? "VIP"}</span></div>
      </div>
    </div>
    <div class="section">
      <div class="section-title">Visit Schedule (${visits.length} visits)</div>
      <table><thead><tr><th style="text-align:left;padding:6px 12px;background:#f5f5f5;font-size:12px;color:#555">Visit</th><th style="text-align:left;padding:6px 12px;background:#f5f5f5;font-size:12px;color:#555">Date</th><th style="text-align:left;padding:6px 12px;background:#f5f5f5;font-size:12px;color:#555">Status</th></tr></thead><tbody>${visitRows}</tbody></table>
    </div>
    <div class="section">
      <div class="section-title">Electronic Signature</div>
      <div class="sig-box">
        ${sigImg}
        <div class="sig-date">Signed by ${c.customer_name} on ${signedDate} CT</div>
      </div>
    </div>
  </div>
</div>
</body></html>`;
    res.setHeader("Content-Type", "text/html");
    return res.send(html);
  } catch (err: any) {
    return res.status(500).send(`<h2>Error: ${err.message}</h2>`);
  }
});

// ─── Update visit status ──────────────────────────────────────────────────────
// When a visit is marked "missed", a replacement appointment is auto-created
// one month after the latest scheduled visit, using the same week/day preferences.
vipRouter.post("/visit/update", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const { visitId, status, jobId, scheduledDate, scheduledTime, notes } = req.body;

    const fields: string[] = [];
    const params: any[] = [];
    if (status) { fields.push("status=?"); params.push(status); }
    if (jobId !== undefined) { fields.push("job_id=?"); params.push(jobId); }
    if (scheduledDate !== undefined) { fields.push("scheduled_date=?"); params.push(scheduledDate); }
    if (scheduledTime !== undefined) { fields.push("scheduled_time=?"); params.push(scheduledTime); }
    if (notes !== undefined) { fields.push("notes=?"); params.push(notes); }
    if (status === "completed") { fields.push("completed_at=NOW()"); }
    if (!fields.length) return res.json({ success: true });
    params.push(visitId);
    await db.execute(`UPDATE vip_visits SET ${fields.join(",")} WHERE id=?`, params);

    // ── Auto-create replacement when a visit is marked missed ─────────────────
    let replacementVisit: any = null;
    if (status === "missed") {
      try {
        // Load the missed visit + its contract details
        const [visitRows]: any = await db.execute(
          `SELECT v.*, c.contract_number, c.customer_name, c.customer_phone, c.customer_email,
                  c.vehicle_description, c.city, c.total_price, c.service_start_date,
                  c.schedule_week, c.schedule_day
           FROM vip_visits v
           JOIN vip_contracts c ON c.id = v.contract_id
           WHERE v.id = ?`,
          [visitId]
        );
        if (visitRows.length) {
          const v = visitRows[0];
          const contractId = v.contract_id;
          const contractNumber = v.contract_number;
          const citySlug = cityToSlug(v.city ?? "");
          const swNum: number | null = v.schedule_week != null ? Number(v.schedule_week) : null;
          const sdNum: number | null = v.schedule_day != null ? Number(v.schedule_day) : null;

          // Find the latest scheduled_date among all visits for this contract
          const [latestRows]: any = await db.execute(
            `SELECT MAX(scheduled_date) AS latest_date FROM vip_visits WHERE contract_id = ?`,
            [contractId]
          );
          const latestDateRaw = latestRows[0]?.latest_date;
          const latestDate = latestDateRaw ? new Date(latestDateRaw) : new Date(v.scheduled_date);

          // Schedule replacement one month after the latest visit date
          const replacementBase = addMonths(latestDate, 1);
          const replacementDate = computeVisitDate(replacementBase, 0, swNum, sdNum);
          const replacementDateStr = formatDate(replacementDate);

          // Next visit number = max existing + 1 (for ordering)
          const [maxNumRows]: any = await db.execute(
            `SELECT MAX(visit_number) AS max_num FROM vip_visits WHERE contract_id = ?`,
            [contractId]
          );
          const nextVisitNumber = (maxNumRows[0]?.max_num ?? 0) + 1;

          // Carry over the same add-ons as the missed visit
          const addOns: string[] = v.add_ons
            ? (typeof v.add_ons === "string" ? JSON.parse(v.add_ons) : v.add_ons)
            : [];

          const replacementJobId = `vip-${contractId}-replacement-${visitId}-${Date.now()}`;

          // Insert replacement visit row
          const [insertResult]: any = await db.execute(
            `INSERT INTO vip_visits
               (contract_id, visit_number, scheduled_date, add_ons, status, schedule_job_id, notes, is_replacement, replaced_visit_id)
             VALUES (?, ?, ?, ?, 'scheduled', ?, ?, 1, ?)`,
            [
              contractId,
              nextVisitNumber,
              replacementDateStr,
              JSON.stringify(addOns),
              replacementJobId,
              `Replacement for missed Visit ${v.visit_number}`,
              visitId,
            ]
          );
          const replacementVisitId = insertResult.insertId;

          // Create schedule_job so it appears on the admin calendar
          try {
            const addOnLabel = addOns.length > 0 ? ` + ${addOns.join(", ")}` : "";
            await upsertScheduleJob({
              jobId: replacementJobId,
              location: citySlug,
              date: replacementDateStr,
              timeSlot: null as any,
              startHour: null as any,
              endHour: null as any,
              customerName: v.customer_name,
              customerPhone: v.customer_phone ?? null,
              customerEmail: v.customer_email ?? null,
              vehicleType: v.vehicle_description ?? null,
              packageType: "luxury",
              serviceDescription: `VIP Replacement (was Visit ${v.visit_number}) — ${contractNumber}${addOnLabel}`,
              selectedAddons: JSON.stringify(addOns),
              totalPrice: (Number(v.total_price) / 12).toFixed(2),
              status: "pending",
              source: "manual",
              notes: `VIP Replacement — Contract ${contractNumber}. Replaces missed Visit ${v.visit_number}.`,
              tags: JSON.stringify(["VIP", "Replacement"]),
              leadSource: "VIP Program",
            } as any);
          } catch (jobErr: any) {
            console.error(`[VIP] replacement schedule_job failed:`, jobErr.message);
          }

          // Extend contract end_date if replacement pushes it out
          const [contractRows]: any = await db.execute(
            `SELECT end_date FROM vip_contracts WHERE id = ?`, [contractId]
          );
          const currentEndDate = contractRows[0]?.end_date ? new Date(contractRows[0].end_date) : null;
          if (!currentEndDate || replacementDate > currentEndDate) {
            await db.execute(
              `UPDATE vip_contracts SET end_date = ? WHERE id = ?`,
              [replacementDateStr, contractId]
            );
          }

          replacementVisit = {
            id: replacementVisitId,
            visitNumber: nextVisitNumber,
            scheduledDate: replacementDateStr,
            addOns,
            status: "scheduled",
            isReplacement: true,
            replacedVisitId: visitId,
            notes: `Replacement for missed Visit ${v.visit_number}`,
          };
          console.log(`[VIP] Replacement visit created for missed visit ${visitId} → ${replacementDateStr}`);
        }
      } catch (replErr: any) {
        console.error("[VIP] replacement visit creation failed:", replErr.message);
      }
    }

    return res.json({ success: true, replacementVisit });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Customer: Request a credit booking ─────────────────────────────────────
// ─── Live Credit Booking ─────────────────────────────────────────────────────
// Customer books a credit directly with a real date/time. Creates a schedule_job
// immediately and marks the visit as 'booked' (pending admin confirmation).
vipRouter.post("/book-credit-live", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const { contractId, serviceType, scheduledDate, scheduledTime, notes, serviceAddress, vehicleId, vehicleLabel } = req.body;
    if (!contractId || !serviceType || !scheduledDate || !scheduledTime) {
      return res.status(400).json({ success: false, error: "contractId, serviceType, scheduledDate, scheduledTime required" });
    }
    if (!['luxury', 'basic'].includes(serviceType)) {
      return res.status(400).json({ success: false, error: "serviceType must be 'luxury' or 'basic'" });
    }

    // Load contract
    const [contractRows]: any = await db.execute(
      "SELECT * FROM vip_contracts WHERE id = ? AND status IN ('active','pending_signature')",
      [contractId]
    );
    if (!contractRows.length) return res.status(404).json({ success: false, error: "Contract not found" });
    const contract = contractRows[0];

    // Find the first unbooked visit of the requested service type
    const serviceLabel = serviceType === 'luxury' ? 'Luxury Detail' : 'Basic Detail';
    const [visitRows]: any = await db.execute(
      `SELECT * FROM vip_visits
       WHERE contract_id = ?
         AND (service_type = ? OR notes = ?)
         AND status = 'scheduled'
         AND (scheduled_date IS NULL OR scheduled_date = '')
       ORDER BY visit_number ASC
       LIMIT 1`,
      [contractId, serviceType, serviceLabel]
    );
    if (!visitRows.length) {
      return res.status(400).json({ success: false, error: `No remaining ${serviceLabel} credits available` });
    }
    const visit = visitRows[0];

    // Build a unique job ID
    const jobId = `vip-credit-${contractId}-v${visit.visit_number}-${Date.now()}`;
    const citySlug = cityToSlug(contract.city ?? '');
    const packageType = serviceType === 'luxury' ? 'luxury' : 'basic';
    const packageName = serviceType === 'luxury' ? 'Luxury Detail' : 'Basic Detail';

    // Parse startHour/endHour from scheduledTime (e.g. "8:00 AM – 10:00 AM" → 8, 10)
    function parseTimeSlotHours(timeStr: string): { startHour: number; endHour: number } | null {
      // Handles both "–" (en dash) and "-" (hyphen) separators
      const parts = timeStr.split(/\s*[–-]\s*/);
      if (parts.length < 2) return null;
      function parseHour(s: string): number {
        const m = s.trim().match(/(\d+)(?::(\d+))?\s*(AM|PM)/i);
        if (!m) return 0;
        let h = parseInt(m[1], 10);
        const isPM = m[3].toUpperCase() === 'PM';
        if (isPM && h !== 12) h += 12;
        if (!isPM && h === 12) h = 0;
        return h;
      }
      return { startHour: parseHour(parts[0]), endHour: parseHour(parts[1]) };
    }
    const parsedHours = parseTimeSlotHours(scheduledTime);
    const startHour = parsedHours?.startHour ?? null;
    const endHour = parsedHours?.endHour ?? null;

    // Auto-assign an available detailer for this slot
    let assignedTo: string | null = null;
    let assignedDetailerToken: string | null = null;
    if (startHour !== null && endHour !== null) {
      try {
        const availableDetailers = await getAvailableDetailersForSlot(scheduledDate, startHour, endHour, citySlug);
        if (availableDetailers.length > 0) {
          const detailer = availableDetailers[0];
          assignedTo = detailer.fullName;
          assignedDetailerToken = detailer.pushToken ?? null;
          console.log(`[VIP] book-credit-live auto-assigned to ${assignedTo} (${detailer.employeeId})`);
        } else {
          console.log('[VIP] book-credit-live no available detailers for slot — job will be unassigned');
        }
      } catch (assignErr: any) {
        console.error('[VIP] book-credit-live auto-assign failed:', assignErr.message);
      }
    }

    // Create the schedule_job so it appears on the admin calendar immediately
    try {
      await upsertScheduleJob({
        jobId,
        location: citySlug,
        date: scheduledDate,
        timeSlot: scheduledTime,
        startHour: startHour as any,
        endHour: endHour as any,
        assignedTo: assignedTo ?? undefined,
        customerName: contract.customer_name,
        customerPhone: contract.customer_phone ?? null,
        customerEmail: contract.customer_email ?? null,
        customerId: contract.customer_id ?? null,
        vehicleType: contract.vehicle_description ?? null,
        vehicleId: vehicleId ?? null,
        vehicleLabel: vehicleLabel ?? null,
        packageType,
        serviceDescription: `VIP ${packageName} — ${contract.contract_number} (Visit ${visit.visit_number})`,
        selectedAddons: '[]',
        totalPrice: '0.00',
        status: 'pending',
        source: 'vip_credit',
        notes: `VIP Credit Booking — Contract ${contract.contract_number}, Visit ${visit.visit_number}${serviceAddress ? ` | Address: ${serviceAddress}` : ''}${notes ? ' — ' + notes : ''}`.trim(),
        tags: JSON.stringify(['VIP', 'Credit']),
        leadSource: 'VIP Program',
        addressLabel: serviceAddress ?? contract.customer_address ?? null,
      } as any);
    } catch (jobErr: any) {
      console.error('[VIP] book-credit-live schedule_job failed:', jobErr.message);
    }

    // Update the visit: set date, time, job_id, service_type, and mark as 'booked'
    await db.execute(
      `UPDATE vip_visits SET
         scheduled_date = ?,
         scheduled_time = ?,
         schedule_job_id = ?,
         service_type = ?,
         notes = ?,
         status = 'scheduled'
       WHERE id = ?`,
      [scheduledDate, scheduledTime, jobId, serviceType,
       `${serviceLabel}${serviceAddress ? ' @ ' + serviceAddress : ''}${notes ? ' — ' + notes : ''}`,
       visit.id]
    );

    // Notify admin
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || 'Office@luxurywashonwheels.com';
    await sendEmail({
      to: adminEmail,
      subject: `VIP Credit Booked — ${contract.customer_name} (${contract.contract_number})`,
      type: 'booking_confirmation',
      urgent: true,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0057FF">VIP Credit Booking Confirmed</h2>
          <p><strong>${contract.customer_name}</strong> has booked a VIP credit appointment.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">Contract</td><td style="padding:8px;font-weight:bold">${contract.contract_number}</td></tr>
            <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Service</td><td style="padding:8px;font-weight:bold;color:#D97706">${packageName}</td></tr>
            <tr><td style="padding:8px;color:#666">Date</td><td style="padding:8px;font-weight:bold;color:#0057FF">${scheduledDate}</td></tr>
            <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Time</td><td style="padding:8px">${scheduledTime}</td></tr>
            <tr><td style="padding:8px;color:#666">Vehicle</td><td style="padding:8px">${contract.vehicle_description ?? '—'}</td></tr>
            <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">City</td><td style="padding:8px">${contract.city ?? '—'}</td></tr>
            <tr><td style="padding:8px;color:#666">Customer Phone</td><td style="padding:8px">${contract.customer_phone ?? '—'}</td></tr>
            <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Customer Email</td><td style="padding:8px">${contract.customer_email ?? '—'}</td></tr>
          </table>
        </div>
      `,
    }).catch((e: any) => console.error('[VIP] book-credit-live admin email failed:', e.message));

    // Push notification to admin/office/ops_manager
    try {
      const drizzleDb = await getDb();
      if (drizzleDb) {
        const { inArray: inArr } = await import('drizzle-orm');
        const adminRows = await drizzleDb
          .select({ pushToken: employees.pushToken })
          .from(employees)
          .where(inArr(employees.role, ['admin', 'office', 'operations_manager']));
        const adminTokens = adminRows
          .map(r => r.pushToken)
          .filter((t): t is string => !!t && (t.startsWith('ExponentPushToken[') || t.startsWith('ExpoPushToken[')));
        if (adminTokens.length > 0) {
          const assignedStr = assignedTo ? ` → Assigned to ${assignedTo}` : ' → Unassigned';
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(adminTokens.map(to => ({
              to,
              title: '⭐ VIP Credit Booking',
              body: `${contract.customer_name} booked ${packageName} on ${scheduledDate} at ${scheduledTime}${assignedStr}`,
              sound: 'default',
              priority: 'high',
              data: { type: 'vip_credit_booking', jobId, contractId, screen: 'admin-schedule' },
            }))),
          });
          console.log(`[VIP] book-credit-live push sent to ${adminTokens.length} admin(s)`);
        }

        // Push notification to assigned detailer
        if (assignedDetailerToken && (assignedDetailerToken.startsWith('ExponentPushToken[') || assignedDetailerToken.startsWith('ExpoPushToken['))) {
          await fetch('https://exp.host/--/api/v2/push/send', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify([{
              to: assignedDetailerToken,
              title: '📋 New VIP Job Assigned',
              body: `${contract.customer_name} — ${packageName} on ${scheduledDate} at ${scheduledTime}`,
              sound: 'default',
              data: { type: 'vip_credit_booking', jobId, contractId },
            }]),
          });
          console.log(`[VIP] book-credit-live push sent to assigned detailer`);
        }
      }
    } catch (pushErr: any) {
      console.error('[VIP] book-credit-live push notification failed:', pushErr.message);
    }

    // Confirmation to customer
    if (contract.customer_email) {
      await sendEmail({
        to: contract.customer_email,
        subject: `Your VIP ${packageName} is booked — ${contract.contract_number}`,
        type: 'booking_confirmation',
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#0057FF">Your VIP Appointment is Booked!</h2>
            <p>Hi ${contract.customer_name},</p>
            <p>Your <strong>${packageName}</strong> has been scheduled.</p>
            <p><strong>Date:</strong> ${scheduledDate}<br><strong>Time:</strong> ${scheduledTime}</p>
            <p>Our team will be there on time. If you need to reschedule, call us at <strong>850-517-7874</strong>.</p>
            <p style="color:#666;font-size:13px">Contract: ${contract.contract_number}</p>
          </div>
        `,
      }).catch((e: any) => console.error('[VIP] book-credit-live customer email failed:', e.message));
    }

    await conn.end();
    return res.json({ success: true, jobId, visitId: visit.id });
  } catch (err: any) {
    console.error('[VIP] book-credit-live error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Customer uses one of their remaining visit credits to request a specific date/time.
// This does NOT consume the credit — it just requests a booking. Admin schedules it.
vipRouter.post("/request-credit-booking", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const { contractId, visitId, requestedDate, requestedTime, notes } = req.body;
    if (!contractId || !visitId) return res.status(400).json({ success: false, error: "contractId and visitId required" });

    // Load contract + visit
    const [contractRows]: any = await db.execute(
      "SELECT * FROM vip_contracts WHERE id = ? AND status IN ('active','pending_signature')",
      [contractId]
    );
    if (!contractRows.length) return res.status(404).json({ success: false, error: "Contract not found" });
    const contract = contractRows[0];

    const [visitRows]: any = await db.execute(
      "SELECT * FROM vip_visits WHERE id = ? AND contract_id = ?",
      [visitId, contractId]
    );
    if (!visitRows.length) return res.status(404).json({ success: false, error: "Visit not found" });
    const visit = visitRows[0];

    // Update the visit with the requested date/time and a 'requested' note
    const requestNote = `Customer requested: ${requestedDate ?? 'TBD'}${requestedTime ? ' at ' + requestedTime : ''}${notes ? ' — ' + notes : ''}`;
    await db.execute(
      `UPDATE vip_visits SET
         scheduled_date = COALESCE(?, scheduled_date),
         scheduled_time = COALESCE(?, scheduled_time),
         notes = ?
       WHERE id = ?`,
      [requestedDate ?? null, requestedTime ?? null, requestNote, visitId]
    );

    // Notify admin
    const adminEmail = process.env.ADMIN_NOTIFY_EMAIL || "Office@luxurywashonwheels.com";
    const visitLabel = visit.is_replacement ? `Replacement Visit ${visit.visit_number}` : `Visit ${visit.visit_number}`;
    await sendEmail({
      to: adminEmail,
      subject: `VIP Credit Booking Request — ${contract.customer_name} (${contract.contract_number})`,
      type: "booking_confirmation",
      urgent: true,
      html: `
        <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
          <h2 style="color:#0057FF">VIP Credit Booking Request</h2>
          <p><strong>${contract.customer_name}</strong> has requested to schedule <strong>${visitLabel}</strong> of their VIP contract.</p>
          <table style="width:100%;border-collapse:collapse;margin:16px 0">
            <tr><td style="padding:8px;color:#666">Contract</td><td style="padding:8px;font-weight:bold">${contract.contract_number}</td></tr>
            <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Vehicle</td><td style="padding:8px">${contract.vehicle_description ?? '—'}</td></tr>
            <tr><td style="padding:8px;color:#666">Requested Date</td><td style="padding:8px;font-weight:bold;color:#0057FF">${requestedDate ?? 'No date specified'}</td></tr>
            <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Requested Time</td><td style="padding:8px">${requestedTime ?? 'Flexible'}</td></tr>
            <tr><td style="padding:8px;color:#666">Visit</td><td style="padding:8px">${visitLabel}</td></tr>
            <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Customer Notes</td><td style="padding:8px">${notes ?? '—'}</td></tr>
            <tr><td style="padding:8px;color:#666">Customer Phone</td><td style="padding:8px">${contract.customer_phone ?? '—'}</td></tr>
            <tr style="background:#f9f9f9"><td style="padding:8px;color:#666">Customer Email</td><td style="padding:8px">${contract.customer_email ?? '—'}</td></tr>
          </table>
          <p style="color:#666;font-size:13px">Please confirm this appointment with the customer and add it to the schedule.</p>
        </div>
      `,
    }).catch((e: any) => console.error('[VIP] credit booking admin email failed:', e.message));

    // Also send confirmation to customer
    if (contract.customer_email) {
      await sendEmail({
        to: contract.customer_email,
        subject: `We received your VIP visit request — ${contract.contract_number}`,
        type: "booking_confirmation",
        html: `
          <div style="font-family:sans-serif;max-width:600px;margin:0 auto">
            <h2 style="color:#0057FF">Your VIP Visit Request Was Received</h2>
            <p>Hi ${contract.customer_name},</p>
            <p>We received your request to schedule <strong>${visitLabel}</strong> of your VIP contract.</p>
            <p><strong>Requested Date:</strong> ${requestedDate ?? 'No date specified'}<br>
            <strong>Requested Time:</strong> ${requestedTime ?? 'Flexible'}</p>
            <p>Our team will reach out to confirm your appointment. If you need to reach us sooner, call <strong>850-517-7874</strong>.</p>
            <p style="color:#666;font-size:13px">Contract: ${contract.contract_number}</p>
          </div>
        `,
      }).catch((e: any) => console.error('[VIP] credit booking customer email failed:', e.message));
    }

    await conn.end();
    return res.json({ success: true });
  } catch (err: any) {
    console.error('[VIP] request-credit-booking error:', err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Cancel contract ──────────────────────────────────────────────────────────
vipRouter.post("/cancel", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const { contractId } = req.body;
    
    // 1. Mark contract as cancelled
    await db.execute("UPDATE vip_contracts SET status='cancelled' WHERE id=?", [contractId]);
    // 2. Cancel all future/pending vip_visits for this contract
    await db.execute(
      "UPDATE vip_visits SET status='cancelled' WHERE contract_id=? AND status IN ('scheduled','pending')",
      [contractId]
    );
    // 3. Cancel all future schedule_jobs linked to this contract
    //    Job IDs follow the pattern: vip-{contractId}-v{n}-... and vip-{contractId}-renewal-...
    const today = new Date().toISOString().slice(0, 10);
    await db.execute(
      `UPDATE schedule_jobs SET status='cancelled'
       WHERE job_id LIKE ? AND status NOT IN ('completed','cancelled') AND (date >= ? OR date IS NULL)`,
      [`vip-${contractId}-%`, today]
    );
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Permanently delete a cancelled contract ─────────────────────────────────
vipRouter.post("/delete", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const { contractId } = req.body;
    if (!contractId) { await conn.end(); return res.status(400).json({ success: false, error: "contractId required" }); }
    const [rows]: any = await db.execute("SELECT status FROM vip_contracts WHERE id=?", [contractId]);
    if (!rows.length) { await conn.end(); return res.status(404).json({ success: false, error: "Contract not found" }); }
    if (rows[0].status !== "cancelled") { await conn.end(); return res.status(400).json({ success: false, error: "Only cancelled contracts can be deleted" }); }
    await db.execute("DELETE FROM vip_visits WHERE contract_id=?", [contractId]);
    await db.execute("DELETE FROM schedule_jobs WHERE job_id LIKE ?", [`vip-${contractId}-%`]);
    await db.execute("DELETE FROM vip_contracts WHERE id=?", [contractId]);
    await conn.end();
    return res.json({ success: true });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Backfill credits for existing VIP Elite contracts ────────────────────────
// Creates vip_visits rows for VIP Elite contracts that were created in credit-system mode
// but didn't get their visit rows (bug fix for contracts created before the fix).
vipRouter.post("/backfill-credits", async (req, res) => {
  try {
    const conn = await getConn();
    const db = conn;
    const { contractId } = req.body;

    // Get the contract
    const [contracts]: any = await db.execute(
      "SELECT * FROM vip_contracts WHERE id = ? AND program_type = 'vip_elite'",
      [contractId]
    );
    if (!contracts.length) return res.status(404).json({ success: false, error: "VIP Elite contract not found" });
    const contract = contracts[0];

    // Check if visits already exist
    const [existingVisits]: any = await db.execute(
      "SELECT COUNT(*) as cnt FROM vip_visits WHERE contract_id = ?",
      [contractId]
    );
    if (existingVisits[0].cnt > 0) {
      return res.json({ success: true, message: "Credits already exist", creditsCreated: 0 });
    }

    // Create 12 credit rows with NULL dates
    const visitCount = contract.frequency === "biweekly" ? 26 : 12;
    for (let i = 1; i <= visitCount; i++) {
      const visitLabel = i <= 2 ? "Luxury Detail" : "Basic Detail";
      await db.execute(
        `INSERT INTO vip_visits (contract_id, visit_number, scheduled_date, add_ons, status, notes)
         VALUES (?, ?, NULL, '[]', 'scheduled', ?)`,
        [contractId, i, visitLabel]
      );
    }

    await conn.end();
    return res.json({ success: true, creditsCreated: visitCount });
  } catch (err: any) {
    return res.status(500).json({ success: false, error: err.message });
  }
});

// ─── Flex Pass Priority Scheduling Request ───────────────────────────────────
vipRouter.post("/request-flex-pass", async (req, res) => {
  try {
    const { contractId, customerName, customerEmail, requestedDate, requestedTime, city, notes } = req.body;
    if (!contractId || !requestedDate) {
      return res.status(400).json({ success: false, error: "Contract ID and requested date are required" });
    }

    // Verify contract exists and is active
    const conn = await getConn();
    const [rows]: any = await conn.execute(
      `SELECT id, contract_number, status, program_type FROM vip_contracts WHERE id = ?`,
      [contractId]
    );
    if (!rows.length || rows[0].status !== 'active') {
      await conn.end();
      return res.status(400).json({ success: false, error: "Contract not found or not active" });
    }
    const contract = rows[0];
    await conn.end();

    // Send email notification to admin
    const { sendEmail } = await import("./email.js");
    const adminEmail = process.env.ADMIN_EMAIL || "admin@luxurywashonwheels.com";
    const timeStr = requestedTime ? ` at ${requestedTime}` : "";
    const cityStr = city ? ` in ${city}` : "";

    await sendEmail({
      to: adminEmail,
      subject: `⚡ VIP Flex Pass Request — ${customerName}`,
      html: `
        <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">
          <div style="background: linear-gradient(135deg, #D97706, #B45309); padding: 24px; border-radius: 12px 12px 0 0;">
            <h1 style="color: #fff; margin: 0; font-size: 22px;">⚡ VIP Flex Pass Request</h1>
            <p style="color: rgba(255,255,255,0.85); margin: 8px 0 0; font-size: 14px;">Priority Scheduling — VIP Elite Member</p>
          </div>
          <div style="background: #fff; padding: 24px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px;">
            <table style="width: 100%; border-collapse: collapse;">
              <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Customer</td><td style="padding: 8px 0; font-weight: 700; color: #1F2937;">${customerName}</td></tr>
              <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Email</td><td style="padding: 8px 0; color: #1F2937;">${customerEmail || "N/A"}</td></tr>
              <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Contract</td><td style="padding: 8px 0; color: #1F2937;">#${contract.contract_number}</td></tr>
              <tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Requested Date</td><td style="padding: 8px 0; font-weight: 700; color: #D97706;">${requestedDate}${timeStr}</td></tr>
              ${city ? `<tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">City</td><td style="padding: 8px 0; color: #1F2937;">${city}</td></tr>` : ""}
              ${notes ? `<tr><td style="padding: 8px 0; color: #6B7280; font-size: 13px;">Notes</td><td style="padding: 8px 0; color: #1F2937;">${notes}</td></tr>` : ""}
            </table>
            <div style="margin-top: 20px; padding: 12px; background: #FEF3C7; border-radius: 8px; border: 1px solid #F59E0B;">
              <p style="margin: 0; font-size: 13px; color: #92400E; font-weight: 600;">
                ⚡ This is a VIP Elite priority request. Please accommodate if possible and confirm with the customer.
              </p>
            </div>
          </div>
        </div>
      `,
    }).catch(() => {});

    // Also send confirmation to customer
    if (customerEmail) {
      await sendEmail({
        to: customerEmail,
        subject: `⚡ Flex Pass Request Received — Luxury Wash On Wheels`,
        html: `
          <div style="font-family: -apple-system, BlinkMacSystemFont, sans-serif; max-width: 600px; margin: 0 auto;">
            <div style="background: linear-gradient(135deg, #D97706, #B45309); padding: 24px; border-radius: 12px 12px 0 0;">
              <h1 style="color: #fff; margin: 0; font-size: 22px;">⚡ Flex Pass Request Received</h1>
            </div>
            <div style="background: #fff; padding: 24px; border: 1px solid #E5E7EB; border-top: none; border-radius: 0 0 12px 12px;">
              <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                Hi ${customerName.split(" ")[0]},
              </p>
              <p style="color: #374151; font-size: 15px; line-height: 1.6;">
                We've received your VIP Flex Pass request for <strong>${requestedDate}${timeStr}${cityStr}</strong>.
                As a VIP Elite member, you receive priority scheduling — our team will confirm your slot shortly.
              </p>
              <p style="color: #6B7280; font-size: 13px; margin-top: 20px;">
                — Luxury Wash On Wheels Team
              </p>
            </div>
          </div>
        `,
      }).catch(() => {});
    }

    // Save request to DB
    const conn2 = await getConn();
    let newRequestId: number | null = null;
    try {
      const [insertResult]: any = await conn2.execute(
        `INSERT INTO flex_pass_requests (contract_id, contract_number, customer_name, customer_email, requested_date, requested_time, city, notes, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
        [contractId, contract.contract_number, customerName || null, customerEmail || null, requestedDate, requestedTime || null, city || null, notes || null]
      );
      newRequestId = insertResult.insertId;
    } catch (dbErr) {
      console.error("[FlexPass] DB insert error:", dbErr);
    } finally {
      await conn2.end();
    }
    // Send push notification to admins
    sendFlexPassAdminPush(customerName, requestedDate, requestedTime, city).catch(() => {});
    return res.json({ success: true, message: "Flex Pass request sent successfully", requestId: newRequestId });
  } catch (err: any) {
    console.error("[Flex Pass] Error:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});
