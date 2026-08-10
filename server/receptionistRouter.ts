/**
 * AI Phone Receptionist — Server Module (v3)
 *
 * Key improvements over v2:
 * - Bookings write to schedule_jobs (the real schedule) not online_bookings
 * - Single combined GPT call returns BOTH the spoken response AND structured JSON
 *   (eliminates the separate extractBookingData call — halves latency)
 * - City extracted from address via regex (handles "Crestview, FL" etc.)
 * - Duplicate customer lookup by phone before creating booking
 * - Shorter system prompt (~300 tokens vs ~800)
 * - max_tokens reduced to 200 for faster responses
 */

import { Router, Request, Response } from "express";
import * as db from "./db";
import { sendEmail, buildBookingConfirmationEmail } from "./email";

// ─── Company Knowledge Base (concise for speed) ───────────────────────────────

const SYSTEM_PROMPT = `You are the AI receptionist for Luxury Wash on Wheels, a premium mobile auto detailing company in Florida.
You speak like a high-end service advisor — professional, warm, confident, and concise. This is a phone call: keep every response SHORT (1-3 sentences). Never sound robotic.

OPENING: "Thank you for calling Luxury Wash on Wheels, this is your virtual assistant. How can I help you today?"
CLOSING: "Awesome, we look forward to taking care of your vehicle. Have a great day."

SERVICE AREAS: Pensacola, Destin, Miramar Beach, DeFuniak Springs, Laurel Hill, and all cities in between.
If outside area: politely inform them but offer to check availability anyway.
HOURS: Mon–Sat 8 AM–6 PM CST
TIME SLOTS: 8:00am-11:00am | 11:00am-2:00pm | 2:00pm-5:00pm

SERVICES & PRICING:

MAIN PACKAGES (Sedan / SUV / Lrg SUV or Van / Truck):
- Basic Detail: $175 / $200 / $250 / $225
  Exterior: door jambs, 2-bucket hand wash, bug removal, wheels (face only), tire dressing
  Interior: dash/console wipe, cupholders, windows inside/out, vacuum
- Full Detail: $275 / $325 / $350 / $325
  Exterior: door jambs, gas cap, exhaust tips, 2-bucket hand wash, tar/bug removal, wheels front & back, tire dressing, 60-day paint protectant
  Interior: door panels, plastics, leather deep clean, cupholders, windows inside/out, vacuum
- Interior Detail: $250 (all vehicle types)
  Carpet & seat shampoo (hot water extraction), all plastics, upholstery, leather deep clean, all compartments, vacuum
- Exterior Detail: $175 (all vehicle types)
  Spot-free wash, wheels/tires/wheel wells, gas cap, door jambs, bug removal, 6-month paint protectant
- Luxury Detail: $375 / $400 / $450 / $425
  Everything in Full Detail PLUS: engine bay, exhaust tips, tar removal, 6-month paint protectant, carpet/seat shampoo

RV SERVICES:
- RV Wash 20–29 ft: $275 | 30–39 ft: $330 | 40 ft+: $375
  Includes: scratch-free wash, wheel/well cleaning, awning, tire dressing, exterior windows, windshield sealant
- RV Paint Sealant Add-On: $15/ft (4–6 hr turnaround)
- RV Maintenance Quarterly: $250

ADD-ONS:
- Paint Sealant (6–9 months): $50
- Clay Bar (removes contamination/overspray): $50
- Leather Conditioner: $40
- Leather Cleaning: $30
- Ozone Treatment (odor removal): $100
- Shampoo Seats & Carpets: $75
- Shampoo Carpet Only: $50
- Shampoo Seats Only: $50
- Pet Hair Removal: $40
- Engine Bay Cleaning: $30
- Rain-X (windshield only): $10 | (all windows): $15
- One-Step Paint Enhancement (removes swirls/scratches): $250
- Overspray Removal: $600
- Additional Time: $75/hr

PERMAPLATE SERVICES:
- Loss of Gloss: $250 | Bug Staining: $250 | Paint Correction: $300
- Oxidation: $300 | Fallout Removal: $300 | Interior Staining: $300
- Hard Water Spot Removal: $350 | Tree Sap Removal: $150 | Bird Droppings: $150

MAINTENANCE PROGRAMS:
- Maintenance Program Monthly: $150/mo — hand wash, debug, rims, tire dressing, leather wipe, vacuum, windows (max 1 hr)
- VIP Program Monthly: $1,200/yr — everything in Maintenance PLUS leather wipe-down, 24-hour rain guarantee (free re-wash if rain within 24 hrs)

BOOKING FLOW:
1. Identify intent (book/reschedule/cancel/question)
2. Ask vehicle type and condition (light/moderate/heavy)
3. Use consultative approach: "Are you looking for maintenance-based, or a full deep clean inside and out?"
4. Match to package and quote price confidently: "For your vehicle, that's typically around $___." 
5. Collect in THIS ORDER: Name → Confirm phone number (you already have it from caller ID) → Email address → City/Area → Date → Offer ONLY available time slots → Address → Confirm all details
6. CRITICAL: You MUST collect a time slot before confirming. Never say "Your appointment is confirmed" until you have: name, phone confirmed, email, city, date, AND time slot.
7. Say exactly: "Your appointment is confirmed" when booking is complete

RESCHEDULING: Get name + phone, locate appointment, offer next availability.
CANCELLATION: Identify appointment, attempt save ("Would you like to reschedule instead?"), confirm if still cancelling, leave door open.

UPSELL (suggest when appropriate):
- Paint Sealant: "Since we're already there, a lot of customers add a sealant to protect the paint for 6–9 months."
- Leather Conditioner: "We can also condition the leather while we're in there to keep it from cracking."
- Ozone Treatment: "If there's any odor, our ozone treatment eliminates it completely."
- VIP Program: "We also have a VIP program that keeps your vehicle maintained year-round for $1,200."

PRICING RULES:
- NEVER guess pricing — always reference the price book above
- If customer asks "how much?", guide them first: "Pricing depends on the vehicle and level of cleaning. Most customers choose between Full Detail and Luxury Detail."
- Then narrow down and give the exact price

EDGE CASES:
- Bad weather: "We may need to adjust depending on weather, but we'll communicate with you."
- Same-day: "I can check the soonest availability — typically we can get you in as early as tomorrow morning."
- Not ready to book: "I can send you a quote and availability if you'd like."
- Outside service area: Politely inform, offer to check anyway

TIME POSITIONING: Reinforce convenience — "We come to you, so you don't have to waste time waiting at a shop."

RULES:
- NEVER offer a time slot unless the real-time schedule data below says it is available
- Extract city from address to check availability
- Keep responses under 30 words when possible
- When confirming, say exactly: "Your appointment is confirmed"
- Do NOT overwhelm with options — guide toward one recommendation`;

// ─── Dynamic system prompt builder (appends DB knowledge entries) ──────────────
async function buildSystemPrompt(): Promise<string> {
  try {
    const entries = await db.getActiveAiKnowledge();
    if (!entries.length) return SYSTEM_PROMPT;
    const grouped: Record<string, string[]> = {};
    for (const e of entries) {
      if (!grouped[e.category]) grouped[e.category] = [];
      grouped[e.category].push(`${e.title}: ${e.content}`);
    }
    const knowledgeBlock = Object.entries(grouped)
      .map(([cat, items]) => `\n${cat.toUpperCase()}:\n${items.map(i => `- ${i}`).join('\n')}`)
      .join('\n');
    return `${SYSTEM_PROMPT}\n\nADDITIONAL KNOWLEDGE BASE:${knowledgeBlock}`;
  } catch {
    return SYSTEM_PROMPT;
  }
}

// ─── Types ─────────────────────────────────────────────────────────────────────

interface ConversationMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface BookingData {
  customerName: string;
  phone: string;
  email?: string;
  vehicleType: string;
  service: string;
  date: string;
  time: string;
  address: string;
  city: string;
  totalPrice: number;
}

interface CallSession {
  callSid: string;
  callerNumber: string;
  messages: ConversationMessage[];
  bookingData: Partial<BookingData>;
  availableSlots: string[];
  startedAt: Date;
  status: "active" | "completed" | "failed";
  returningCustomer: boolean;
}

// In-memory session store
const activeSessions = new Map<string, CallSession>();

// ─── Helpers ───────────────────────────────────────────────────────────────────

function isTwilioConfigured(): boolean {
  return !!(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_PHONE_NUMBER);
}

function isOpenAIConfigured(): boolean {
  return !!process.env.OPENAI_API_KEY;
}

/**
 * Extract city from a full address string.
 * Handles formats like "123 Main St, Crestview, FL 32536" or "Crestview Florida"
 */
function extractCityFromAddress(address: string): string | null {
  const CITIES = ["crestview", "niceville", "fort walton beach", "fort walton", "destin", "pensacola", "navarre", "mary esther", "shalimar", "valparaiso", "eglin", "hurlburt"];
  const lower = address.toLowerCase();
  for (const city of CITIES) {
    if (lower.includes(city)) {
      // Normalize to canonical slug
      if (city.includes("fort walton")) return "fort_walton_beach";
      return city.replace(/\s+/g, "_");
    }
  }
  // Try to extract city from "street, CITY, STATE" pattern
  const parts = address.split(",").map(p => p.trim());
  if (parts.length >= 2) {
    const cityPart = parts[parts.length - 2].toLowerCase().replace(/\s+/g, "_");
    return cityPart || null;
  }
  return null;
}

/**
 * Map loose city strings to DB location slugs.
 */
function normalizeCitySlug(city: string): string {
  const c = city.toLowerCase().trim();
  if (c.includes("crestview")) return "crestview";
  if (c.includes("niceville")) return "niceville";
  if (c.includes("fort walton") || c === "fwb" || c === "fort_walton_beach") return "fort_walton_beach";
  if (c.includes("destin")) return "destin";
  if (c.includes("pensacola")) return "pensacola";
  return c.replace(/\s+/g, "_");
}

// Canonical time slot labels
const ALL_SLOTS = ["8:00am - 11:00am", "11:00am - 2:00pm", "2:00pm - 5:00pm"];

/**
 * Check real-time availability from schedule_jobs for a given date and city.
 */
async function checkAvailability(date: string, city: string): Promise<{ text: string; availableSlots: string[] }> {
  try {
    const slug = normalizeCitySlug(city);
    const [capacity, bookings] = await Promise.all([
      db.getLocationCapacity(slug),
      db.getBookingsByDateAndLocation(slug, date),
    ]);
    const maxCap = typeof capacity === "number" ? capacity : 1;

    const slots = ALL_SLOTS.map((slot) => ({
      label: slot,
      available: Math.max(0, maxCap - bookings.filter((b: any) => b.timeSlot === slot).length),
    }));

    const available = slots.filter((s) => s.available > 0);
    if (available.length === 0) {
      return {
        text: `FULLY BOOKED in ${city} on ${date}. Do NOT offer any time slots — tell the caller we are fully booked and offer another date.`,
        availableSlots: [],
      };
    }

    const slotList = available.map((s) => s.label).join(", ");
    return {
      text: `AVAILABLE SLOTS in ${city} on ${date}: ${slotList}. ONLY offer these exact slots. Do NOT offer any other times.`,
      availableSlots: available.map((s) => s.label),
    };
  } catch (e) {
    console.error("[Receptionist] Availability check error:", e);
    return {
      text: `Schedule check unavailable. Do not offer specific times — say our team will confirm availability.`,
      availableSlots: [],
    };
  }
}

/**
 * Combined GPT call: returns spoken response + extracted booking JSON in one shot.
 * This eliminates the separate extractBookingData call, cutting latency in half.
 */
async function getAIResponseWithExtraction(
  messages: ConversationMessage[],
  currentBooking: Partial<BookingData>,
): Promise<{ response: string; booking: Partial<BookingData> }> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error("OPENAI_API_KEY not configured");

  const today = new Date().toISOString().split("T")[0];

  // Append an extraction instruction as the last system message
  const extractionInstruction: ConversationMessage = {
    role: "system",
    content: `After your spoken response, on a NEW LINE output exactly this JSON (no markdown, no explanation):
JSON:{"customerName":null,"phone":null,"email":null,"vehicleType":null,"service":null,"date":null,"time":null,"address":null,"city":null,"totalPrice":null}
Fill in any fields you now know from the conversation. Today is ${today}. Convert "today"/"tomorrow" to YYYY-MM-DD.
For vehicleType use: sedan|suv|xl_suv|truck. For time use exact slot format like "11:00am - 2:00pm".
For city: extract from address if not stated directly. Current known data: ${JSON.stringify(currentBooking)}`,
  };

  const response = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "gpt-4o-mini",
      messages: [...messages, extractionInstruction],
      max_tokens: 250,
      temperature: 0.6,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`OpenAI API error: ${response.status} — ${err}`);
  }

  const data = await response.json() as any;
  const full = data.choices?.[0]?.message?.content?.trim() ?? "";

  // Split on "JSON:" marker
  const jsonMarker = full.indexOf("JSON:");
  let spokenResponse = full;
  let booking: Partial<BookingData> = {};

  if (jsonMarker !== -1) {
    spokenResponse = full.substring(0, jsonMarker).trim();
    try {
      const jsonStr = full.substring(jsonMarker + 5).trim();
      const parsed = JSON.parse(jsonStr);
      // Only keep non-null values
      for (const [k, v] of Object.entries(parsed)) {
        if (v !== null && v !== undefined && v !== "") {
          (booking as any)[k] = v;
        }
      }
    } catch {
      // JSON parse failed — ignore, use what we have
    }
  }

  // If address is known but city isn't, try to extract city from address
  const addr = booking.address ?? currentBooking.address;
  if (addr && !booking.city && !currentBooking.city) {
    const extractedCity = extractCityFromAddress(addr);
    if (extractedCity) booking.city = extractedCity;
  }

  return { response: spokenResponse || full, booking };
}

/**
 * Send SMS confirmation to the caller after a successful booking.
 */
async function sendSmsConfirmation(phone: string, booking: BookingData): Promise<void> {
  const accountSid = process.env.TWILIO_ACCOUNT_SID;
  const authToken = process.env.TWILIO_AUTH_TOKEN;
  const fromNumber = process.env.TWILIO_PHONE_NUMBER;
  if (!accountSid || !authToken || !fromNumber) return;

  const msg = `Hi ${booking.customerName}! Your Luxury Wash on Wheels appointment is confirmed:\n📅 ${booking.date}\n⏰ ${booking.time}\n🚗 ${booking.vehicleType} — ${booking.service}\n📍 ${booking.address}\n💰 $${booking.totalPrice}\n\nQuestions? Call 850-517-7874.`;

  try {
    const toNumber = phone.startsWith("+") ? phone : `+1${phone.replace(/\D/g, "")}`;
    const body = new URLSearchParams({ To: toNumber, From: fromNumber, Body: msg });
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
      },
      body: body.toString(),
    });
  } catch (e) {
    console.error("[Receptionist] SMS send error:", e);
  }
}

/**
 * Notify the assigned detailer of their new AI-booked job.
 */
async function notifyDetailerOfBooking(
  detailerEmployeeId: string,
  booking: Partial<BookingData>,
  bookingId: string,
): Promise<void> {
  try {
    const detailer = await db.getEmployeeById(detailerEmployeeId);
    if (!detailer) return;
    await db.createNotification({
      notificationId: `AIBOOK_DET_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
      employeeId: detailerEmployeeId,
      fullName: detailer.fullName ?? detailerEmployeeId,
      notificationType: "ai_booking" as any,
      title: "New Job Booked for You",
      createdBy: "ai_receptionist",
      status: "unread",
      requiresAcknowledgment: "no",
      message: `AI Receptionist booked a job for you: ${booking.customerName ?? "Customer"} — ${booking.service ?? "Detail Service"} on ${booking.date ?? "TBD"} at ${booking.time ?? "TBD"} in ${booking.city ?? "TBD"}. Address: ${booking.address ?? "N/A"}. Booking ID: ${bookingId}`,
    });
  } catch (e) {
    console.error("[Receptionist] Detailer notification error:", e);
  }
}

/**
 * Notify all admin employees of a new AI booking.
 */
async function notifyAdminsOfBooking(booking: Partial<BookingData>, bookingId: string): Promise<void> {
  try {
    const admins = await db.getAdminEmployees();
    await Promise.all(
      admins.map((admin: any) =>
        db.createNotification({
          notificationId: `AIBOOK_${Date.now()}_${Math.random().toString(36).substr(2, 4)}`,
          employeeId: admin.employeeId,
          fullName: admin.fullName ?? admin.employeeId,
          notificationType: "ai_booking" as any,
          title: "New AI Phone Booking",
          createdBy: "ai_receptionist",
          status: "unread",
          requiresAcknowledgment: "no",
          message: `${booking.customerName ?? "Customer"} booked ${booking.service ?? "a detail"} for ${booking.date ?? "TBD"} at ${booking.time ?? "TBD"} in ${booking.city ?? "TBD"}. Address: ${booking.address ?? "N/A"}. Booking ID: ${bookingId}`,
        }),
      ),
    );
  } catch (e) {
    console.error("[Receptionist] Admin notification error:", e);
  }
}

/**
 * Create the booking in schedule_jobs (the real schedule).
 */
async function createBookingFromCall(
  callSid: string,
  bookingData: BookingData,
): Promise<{ success: boolean; bookingId?: string; error?: string }> {
  try {
    const bookingId = `PHONE_${Date.now()}_${Math.random().toString(36).substr(2, 6).toUpperCase()}`;

    // Map service name to package key
    const packageMap: Record<string, string> = {
      "basic wash": "basic_wash",
      "interior detail": "interior_detail",
      "full detail": "full_detail",
      "premium detail": "premium_detail",
    };
    const packageKey = packageMap[bookingData.service?.toLowerCase()] ?? "full_detail";

    // Parse time slot to start/end hours
    const timeSlot = bookingData.time ?? "8:00am - 11:00am";
    const startMatch = timeSlot.match(/(\d+)(?::(\d+))?\s*(am|pm)?/i);
    let startHour = 8;
    if (startMatch) {
      startHour = parseInt(startMatch[1]);
      const ampm = startMatch[3]?.toLowerCase();
      if (ampm === "pm" && startHour !== 12) startHour += 12;
      if (ampm === "am" && startHour === 12) startHour = 0;
    }
    const endHour = startHour + 3;

    // Normalize city to DB slug
    const locationSlug = normalizeCitySlug(bookingData.city ?? "crestview");

    // Auto-assign the least-loaded detailer for this city/date/time
    let assignedTo: string | null = null;
    try {
      assignedTo = await db.getLeastLoadedDetailer(locationSlug, bookingData.date, startHour, endHour);
      console.log(`[Receptionist] Auto-assigned to: ${assignedTo ?? "none"}`);
    } catch (e) {
      console.error("[Receptionist] Auto-assign error:", e);
    }

    console.log(`[Receptionist] Creating schedule job: ${bookingId} | ${locationSlug} | ${bookingData.date} | ${timeSlot} | assigned: ${assignedTo ?? "unassigned"}`);

    // Write directly to schedule_jobs so it appears on the admin schedule
    await db.upsertScheduleJob({
      jobId: bookingId,
      location: locationSlug,
      date: bookingData.date,
      timeSlot,
      startHour: String(startHour),
      endHour: String(endHour),
      customerName: bookingData.customerName,
      customerPhone: bookingData.phone ?? null,
      customerEmail: bookingData.email ?? null,
      vehicleType: bookingData.vehicleType ?? "sedan",
      vehicleColor: null,
      vehicleYear: null,
      vehicleMake: null,
      vehicleModel: null,
      packageType: packageKey,
      serviceDescription: bookingData.service,
      selectedAddons: null,
      totalPrice: bookingData.totalPrice?.toString() ?? null,
      tips: "0",
      upsellTotal: "0",
      assignedTo: assignedTo,
      status: "confirmed",
      source: "online",
      onlineBookingId: null,
      notes: `Booked via AI phone receptionist. Call SID: ${callSid}. Address: ${bookingData.address ?? "N/A"}`,
      privateNotes: null,
      tags: JSON.stringify(["phone-booking", "ai-receptionist"]),
      leadSource: "AI Receptionist",
      taxAmount: "0",
      discountCode: null,
      discountAmount: "0",
      depositAmount: "0",
      additionalVehicles: null,
      photoUrls: null,
      recommendedServices: null,
      createdBy: "ai_receptionist",
    });

    // Log the call
    const session = activeSessions.get(callSid);
    const durationSecs = session ? Math.round((Date.now() - session.startedAt.getTime()) / 1000) : null;
    await logCall({
      callSid,
      callerNumber: bookingData.phone ?? "unknown",
      outcome: "booked",
      bookingId,
      summary: `${bookingData.customerName} booked ${bookingData.service} for ${bookingData.date} at ${bookingData.time} in ${bookingData.city}`,
      transcript: session ? buildTranscript(session.messages) : undefined,
      callerName: bookingData.customerName,
      durationSeconds: durationSecs ?? undefined,
    });

    // Fire SMS + email + admin notification + detailer notification in parallel (non-blocking)
    Promise.all([
      bookingData.phone ? sendSmsConfirmation(bookingData.phone, bookingData) : Promise.resolve(),
      bookingData.email ? (async () => {
        const { subject, html } = buildBookingConfirmationEmail({
          customerName: bookingData.customerName,
          bookingRef: bookingId,
          packageName: bookingData.service,
          vehicleLabel: bookingData.vehicleType,
          scheduledDate: bookingData.date,
          scheduledTime: bookingData.time,
          addressLabel: bookingData.address,
          total: bookingData.totalPrice ?? 0,
        });
        await sendEmail({ to: bookingData.email!, subject, html, urgent: true });
        console.log(`[Receptionist] Confirmation email sent to ${bookingData.email}`);
      })() : Promise.resolve(),
      notifyAdminsOfBooking(bookingData, bookingId),
      assignedTo ? notifyDetailerOfBooking(assignedTo, bookingData, bookingId) : Promise.resolve(),
    ]).catch(e => console.error("[Receptionist] Post-booking notifications error:", e));

    console.log(`[Receptionist] Booking created successfully: ${bookingId}`);
    return { success: true, bookingId };
  } catch (e: any) {
    console.error("[Receptionist] Booking creation error:", e);
    return { success: false, error: e.message };
  }
}

/**
 * Log a completed call to the database.
 */
async function logCall(data: {
  callSid: string;
  callerNumber: string;
  outcome: "booked" | "inquiry" | "no_booking" | "failed";
  bookingId?: string;
  summary?: string;
  transcript?: string;
  recordingUrl?: string;
  callerName?: string;
  durationSeconds?: number;
}) {
  try {
    await db.createReceptionistCallLog({
      callId: `CALL_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`,
      callSid: data.callSid,
      callerNumber: data.callerNumber,
      outcome: data.outcome,
      bookingId: data.bookingId ?? null,
      summary: data.summary ?? null,
      transcript: data.transcript ?? null,
      recordingUrl: data.recordingUrl ?? null,
      callerName: data.callerName ?? null,
      durationSeconds: data.durationSeconds ?? null,
    });
  } catch (e) {
    console.error("[Receptionist] Failed to log call:", e);
  }
}

function buildTranscript(messages: ConversationMessage[]): string {
  return messages
    .filter(m => m.role === "user" || m.role === "assistant")
    .map(m => `${m.role === "user" ? "Caller" : "AI Receptionist"}: ${m.content}`)
    .join("\n");
}

function twimlGather(sayText: string, callSid: string, baseUrl: string = ""): string {
  const escaped = sayText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  const base = baseUrl.replace(/\/$/, "");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">${escaped}</Say>
  <Gather input="speech" action="${base}/api/receptionist/respond?callSid=${callSid}" method="POST" speechTimeout="auto" timeout="10" actionOnEmptyResult="true" language="en-US" record="record-from-ringing" recordingStatusCallback="${base}/api/receptionist/recording-callback" recordingStatusCallbackMethod="POST">
  </Gather>
</Response>`;
}

function twimlHangup(sayText: string): string {
  const escaped = sayText
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="Polly.Joanna" language="en-US">${escaped}</Say>
  <Hangup/>
</Response>`;
}

// ─── Express Router ────────────────────────────────────────────────────────────

export function createReceptionistRouter(): Router {
  const router = Router();

  /** GET /api/receptionist/status */
  router.get("/status", (_req: Request, res: Response) => {
    res.json({
      twilioConfigured: isTwilioConfigured(),
      openAIConfigured: isOpenAIConfigured(),
      activeCalls: activeSessions.size,
      phoneNumber: process.env.TWILIO_PHONE_NUMBER ?? null,
      ready: isTwilioConfigured() && isOpenAIConfigured(),
    });
  });

  /** GET /api/receptionist/calls */
  router.get("/calls", async (_req: Request, res: Response) => {
    try {
      const calls = await db.getReceptionistCallLogs(50);
      res.json({ success: true, calls });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** POST /api/receptionist/configure-webhook */
  router.post("/configure-webhook", async (req: Request, res: Response) => {
    const { webhookBaseUrl } = req.body ?? {};
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const phoneNumber = process.env.TWILIO_PHONE_NUMBER;

    if (!accountSid || !authToken || !phoneNumber) {
      return res.status(400).json({ success: false, error: "Twilio not configured" });
    }

    const baseUrl = webhookBaseUrl
      ?? (req.headers["x-forwarded-host"] ? `https://${req.headers["x-forwarded-host"]}` : `${req.protocol}://${req.headers.host}`);

    const callWebhookUrl = `${baseUrl}/api/receptionist/call`;
    const statusCallbackUrl = `${baseUrl}/api/receptionist/status-callback`;

    try {
      // Look up the phone number SID
      const listRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(phoneNumber)}`,
        {
          headers: {
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          },
        },
      );
      const listData = await listRes.json() as any;
      const numberSid = listData?.incoming_phone_numbers?.[0]?.sid;

      if (!numberSid) {
        return res.status(404).json({ success: false, error: `Phone number ${phoneNumber} not found in Twilio account` });
      }

      // Update the webhook URL
      const updateBody = new URLSearchParams({
        VoiceUrl: callWebhookUrl,
        VoiceMethod: "POST",
        StatusCallback: statusCallbackUrl,
        StatusCallbackMethod: "POST",
      });

      const updateRes = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${numberSid}.json`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/x-www-form-urlencoded",
            Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
          },
          body: updateBody.toString(),
        },
      );

      if (!updateRes.ok) {
        const err = await updateRes.text();
        return res.status(500).json({ success: false, error: `Twilio update failed: ${err}` });
      }

      res.json({ success: true, webhookUrl: callWebhookUrl, message: "Twilio webhook configured successfully" });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** POST /api/receptionist/call — Twilio inbound call webhook */
  router.post("/call", async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/xml");
    // Always use the production server URL for Twilio callbacks
    const callBaseUrl = "https://luxwashapp-n2wveyqg.manus.space";

    if (!isOpenAIConfigured()) {
      return res.send(twimlHangup(
        "Thank you for calling Luxury Wash on Wheels. Our booking system is temporarily unavailable. Please call back shortly or visit our website. Goodbye!"
      ));
    }

    const callSid = req.body?.CallSid ?? `LOCAL_${Date.now()}`;
    const callerNumber = req.body?.From ?? "unknown";

    // Check if this is a returning customer
    let returningCustomer = false;
    let returningName = "";
    try {
      const normalizedPhone = callerNumber.replace(/\D/g, "").slice(-10);
      const history = await db.getCustomerHistory(`+1${normalizedPhone}`, null);
      if (history.length > 0) {
        returningCustomer = true;
        returningName = (history[0] as any).customerName ?? "";
      }
    } catch {
      // Non-blocking
    }

    // Format caller number for display (e.g. +18505551234 → (850) 555-1234)
    const isRealNumber = callerNumber && callerNumber !== "unknown" && !callerNumber.startsWith("LOCAL");
    const formattedCallerNumber = isRealNumber
      ? callerNumber.replace(/^\+1(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") || callerNumber
      : null;

    // Pre-fill phone from caller ID — inject as system context so AI confirms rather than asks
    const callerIdMessages: ConversationMessage[] = [];
    if (formattedCallerNumber) {
      callerIdMessages.push({
        role: "system",
        content: `CALLER ID: The caller's phone number is ${formattedCallerNumber}. You already have their phone number — do NOT ask for it. Instead, when you reach the phone step, say: "I have your number as ${formattedCallerNumber} — is that the best number to reach you?" If they confirm, use it. If they give a different number, update it.`,
      });
    }

    const session: CallSession = {
      callSid,
      callerNumber,
      messages: [{ role: "system", content: await buildSystemPrompt() }, ...callerIdMessages],
      bookingData: returningCustomer && returningName
        ? { customerName: returningName, phone: callerNumber }
        : formattedCallerNumber ? { phone: callerNumber } : {},
      availableSlots: [],
      startedAt: new Date(),
      status: "active",
      returningCustomer,
    };
    activeSessions.set(callSid, session);

    const greeting = returningCustomer && returningName
      ? `Welcome back, ${returningName.split(" ")[0]}! Thank you for calling Luxury Wash on Wheels. How can I help you today?`
      : "Thank you for calling Luxury Wash on Wheels! I'm your AI receptionist. How can I help you today?";

    return res.send(twimlGather(greeting, callSid, callBaseUrl));
  });

  /** POST /api/receptionist/respond — Twilio speech result webhook */
  router.post("/respond", async (req: Request, res: Response) => {
    res.setHeader("Content-Type", "text/xml");
    // Always use the production server URL for Twilio callbacks
    const respondBaseUrl = "https://luxwashapp-n2wveyqg.manus.space";

    const callSid = (req.query.callSid as string) ?? req.body?.CallSid;
    const speechResult = (req.body?.SpeechResult ?? "").trim();

    if (!callSid) {
      return res.send(twimlHangup("I'm sorry, I had trouble connecting. Please call back. Goodbye!"));
    }

    // No speech detected — re-prompt
    if (!speechResult) {
      const session = activeSessions.get(callSid);
      const reprompt = session?.messages.length
        ? "I'm sorry, I didn't catch that. Could you please repeat?"
        : "Hello! Thank you for calling Luxury Wash on Wheels. How can I help you today?";
      return res.send(twimlGather(reprompt, callSid, respondBaseUrl));
    }

    const session = activeSessions.get(callSid);
    if (!session) {
      return res.send(twimlHangup("I'm sorry, your session expired. Please call back. Goodbye!"));
    }

    session.messages.push({ role: "user", content: speechResult });

    try {
      // ── Step 1: Get AI response + extract booking data in ONE call ──
      const { response: aiText, booking: extracted } = await getAIResponseWithExtraction(
        session.messages,
        session.bookingData,
      );

      // Merge extracted fields into session (only overwrite non-null)
      for (const [k, v] of Object.entries(extracted)) {
        if (v !== null && v !== undefined) {
          (session.bookingData as any)[k] = v;
        }
      }

      // ── Step 2: If we now know city + date, inject real availability ──
      const city = session.bookingData.city;
      const date = session.bookingData.date;

      if (city && date) {
        const avail = await checkAvailability(date, city);
        session.availableSlots = avail.availableSlots;

        // Remove stale availability messages and add fresh one
        const filtered = session.messages.filter(
          m => !(m.role === "system" && m.content.startsWith("[SCHEDULE]")),
        );
        session.messages.length = 0;
        session.messages.push(...filtered);
        session.messages.push({
          role: "system",
          content: `[SCHEDULE for ${city} on ${date}] ${avail.text}`,
        });
      }

      // ── Step 3: Validate chosen slot ──
      const chosenSlot = session.bookingData.time;
      if (chosenSlot && session.availableSlots.length > 0) {
        const normalize = (s: string) => s.toLowerCase().replace(/[\s:]/g, "");
        const slotOk = session.availableSlots.some(s => normalize(s) === normalize(chosenSlot));
        if (!slotOk) {
          session.messages.push({
            role: "system",
            content: `[SLOT CONFLICT] "${chosenSlot}" is NOT available. Available: ${session.availableSlots.join(", ")}. Apologize and re-offer only available slots.`,
          });
          // Clear the invalid time from booking data
          delete session.bookingData.time;
        }
      }

      session.messages.push({ role: "assistant", content: aiText });

      // ── Step 4: Check if AI just confirmed the booking ──
      const aiLower = aiText.toLowerCase();
      const aiConfirmed = aiLower.includes("appointment is confirmed")
        || aiLower.includes("booking is confirmed")
        || aiLower.includes("you're all set")
        || aiLower.includes("we'll see you")
        || aiLower.includes("look forward to taking care")
        || aiLower.includes("look forward to seeing you")
        || aiLower.includes("you're booked")
        || aiLower.includes("you are booked")
        || aiLower.includes("all set for")
        || aiLower.includes("confirmed for");

      const hasRequiredFields = !!(
        session.bookingData.customerName &&
        session.bookingData.date &&
        session.bookingData.time &&
        session.bookingData.city
      );

      if (aiConfirmed && hasRequiredFields) {
        // Final availability re-check to prevent race conditions
        const finalCity = session.bookingData.city!;
        const finalDate = session.bookingData.date!;
        const finalSlot = session.bookingData.time!;
        const finalAvail = await checkAvailability(finalDate, finalCity);
        const normalize = (s: string) => s.toLowerCase().replace(/[\s:]/g, "");
        const slotStillOpen = finalAvail.availableSlots.length === 0
          ? true // If we can't check, proceed
          : finalAvail.availableSlots.some(s => normalize(s) === normalize(finalSlot));

        if (!slotStillOpen) {
          const apology = `I'm so sorry — that slot was just taken. Available times for ${finalCity} on ${finalDate}: ${finalAvail.availableSlots.join(", ")}. Which works for you?`;
          session.messages.push({ role: "assistant", content: apology });
          delete session.bookingData.time;
          return res.send(twimlGather(apology, callSid, respondBaseUrl));
        }

        const result = await createBookingFromCall(callSid, session.bookingData as BookingData);
        if (result.success) {
          session.status = "completed";
          activeSessions.delete(callSid);
          return res.send(twimlHangup(aiText));
        } else {
          console.error("[Receptionist] Booking DB write failed:", result.error);
          // Don't hang up — continue conversation
        }
      }

      // ── Step 5: Check for caller hangup intent ──
      const lowerSpeech = speechResult.toLowerCase();
      const hangupKeywords = ["goodbye", "bye", "that's all", "no thank you", "no thanks", "nothing else", "hang up"];
      if (hangupKeywords.some(k => lowerSpeech.includes(k))) {
        const durationSecs = Math.round((Date.now() - session.startedAt.getTime()) / 1000);
        await logCall({
          callSid,
          callerNumber: session.callerNumber,
          outcome: "inquiry",
          summary: `Caller inquiry — no booking made.`,
          transcript: buildTranscript(session.messages),
          callerName: session.bookingData.customerName,
          durationSeconds: durationSecs,
        });
        session.status = "completed";
        activeSessions.delete(callSid);
        return res.send(twimlHangup(aiText));
      }

      return res.send(twimlGather(aiText, callSid, respondBaseUrl));
    } catch (e: any) {
      console.error("[Receptionist] AI response error:", e);
      return res.send(twimlGather("I'm sorry, I had a brief issue. Could you please repeat that?", callSid, respondBaseUrl));
    }
  });

  /** POST /api/receptionist/recording-callback */
  router.post("/recording-callback", async (req: Request, res: Response) => {
    const callSid = req.body?.CallSid;
    const recordingUrl = req.body?.RecordingUrl;

    if (callSid && recordingUrl) {
      try {
        const playbackUrl = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
        await db.updateReceptionistCallLog(callSid, { recordingUrl: playbackUrl });
        console.log(`[Receptionist] Recording saved for call ${callSid}: ${playbackUrl}`);
      } catch (e) {
        console.error("[Receptionist] Failed to save recording URL:", e);
      }
    }
    res.status(200).send("OK");
  });

  /** POST /api/receptionist/status-callback */
  router.post("/status-callback", async (req: Request, res: Response) => {
    const callSid = req.body?.CallSid;
    const callStatus = req.body?.CallStatus;

    if (callSid && (callStatus === "completed" || callStatus === "failed" || callStatus === "no-answer")) {
      const session = activeSessions.get(callSid);
      if (session && session.status === "active") {
        const durationSecs = Math.round((Date.now() - session.startedAt.getTime()) / 1000);
        const bd = session.bookingData;

        // If we have enough data to create a booking but no time slot, auto-assign first available slot
        const hasPartialBooking = !!(bd.customerName && bd.city && bd.date && bd.service);
        if (hasPartialBooking && !bd.time) {
          try {
            const avail = await checkAvailability(bd.date!, bd.city!);
            const firstSlot = avail.availableSlots[0] ?? "8:00am - 11:00am";
            bd.time = firstSlot;
            console.log(`[Receptionist] Call ended mid-flow — saving partial booking with auto-slot: ${firstSlot}`);
            const result = await createBookingFromCall(callSid, bd as BookingData);
            if (result.success) {
              console.log(`[Receptionist] Partial booking saved: ${result.bookingId}`);
              await logCall({
                callSid,
                callerNumber: session.callerNumber,
                outcome: "booked",
                bookingId: result.bookingId,
                summary: `Partial booking saved (call ended before time confirmed). Auto-assigned slot: ${firstSlot}`,
                transcript: buildTranscript(session.messages),
                callerName: bd.customerName,
                durationSeconds: durationSecs,
              });
              activeSessions.delete(callSid);
              res.status(200).send("OK");
              return;
            }
          } catch (e) {
            console.error("[Receptionist] Partial booking save error:", e);
          }
        }

        await logCall({
          callSid,
          callerNumber: session.callerNumber,
          outcome: "no_booking",
          summary: `Call ended with status: ${callStatus}`,
          transcript: buildTranscript(session.messages),
          callerName: session.bookingData.customerName,
          durationSeconds: durationSecs,
        });
        activeSessions.delete(callSid);
      }
    }
    res.status(200).send("OK");
  });

  /** POST /api/receptionist/test — stateless test with conversation history support */
  router.post("/test", async (req: Request, res: Response) => {
    const { message, history } = req.body ?? {};
    if (!message) return res.status(400).json({ error: "message required" });

    try {
      const systemPrompt = await buildSystemPrompt();
      // Build messages array: system + history + new user message
      const historyMsgs: { role: string; content: string }[] = Array.isArray(history) ? history : [];
      const messages: { role: string; content: string }[] = [
        { role: "system", content: systemPrompt },
        ...historyMsgs,
        { role: "user", content: message },
      ];
      const { response: aiText, booking: extracted } = await getAIResponseWithExtraction(messages as ConversationMessage[], {});
      const updatedMessages = [...messages, { role: "assistant", content: aiText }];
      res.json({ success: true, response: aiText, messages: updatedMessages, extractedData: extracted });
    } catch (e: any) {
      res.status(500).json({ success: false, error: e.message });
    }
  });

  /** POST /api/receptionist/test-call — simulate a call for testing */
  router.post("/test-call", async (req: Request, res: Response) => {
    const { message } = req.body ?? {};
    if (!message) return res.status(400).json({ error: "message required" });

    const testCallSid = `TEST_${Date.now()}`;
    const session: CallSession = {
      callSid: testCallSid,
      callerNumber: "+15550000000",
      messages: [{ role: "system", content: await buildSystemPrompt() }],
      bookingData: {},
      availableSlots: [],
      startedAt: new Date(),
      status: "active",
      returningCustomer: false,
    };
    activeSessions.set(testCallSid, session);
    session.messages.push({ role: "user", content: message });

    try {
      const { response: aiText, booking: extracted } = await getAIResponseWithExtraction(session.messages, {});
      for (const [k, v] of Object.entries(extracted)) {
        if (v !== null && v !== undefined) (session.bookingData as any)[k] = v;
      }
      session.messages.push({ role: "assistant", content: aiText });
      activeSessions.delete(testCallSid);
      res.json({ success: true, response: aiText, extractedData: extracted });
    } catch (e: any) {
      activeSessions.delete(testCallSid);
      res.status(500).json({ success: false, error: e.message });
    }
  });

  return router;
}
