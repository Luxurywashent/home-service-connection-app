/**
 * Phone System Router
 * Handles Twilio webhooks for inbound SMS and voice calls.
 * - Inbound SMS: stores message, marks conversation as unread
 * - Inbound Voice: simultaneous ring all active employees (TwiML)
 * - Call status callback: logs which employee answered, duration
 * - AI Receptionist: routes to AI when enabled per line
 */
import { Router } from "express";
import mysql from "mysql2/promise";
import { createNotification, getAdminEmployees } from "./db";
import { notifyOwner } from "./_core/notification";

function getDb() {
  return mysql.createConnection(process.env.DATABASE_URL!);
}

/** Normalize a phone number to E.164 format for comparison */
function normalizeNumber(num: string): string {
  const digits = num.replace(/\D/g, "");
  if (digits.length === 10) return `+1${digits}`;
  if (digits.length === 11 && digits.startsWith("1")) return `+${digits}`;
  return `+${digits}`;
}

/** Find the phone_line record by the Twilio number that received the message/call */
async function findLineByNumber(conn: mysql.Connection, twilioNumber: string) {
  const normalized = normalizeNumber(twilioNumber);
  const [rows] = await conn.execute(
    "SELECT * FROM phone_lines WHERE phone_number = ? AND is_active = 1 LIMIT 1",
    [normalized]
  ) as [any[], any];
  return rows[0] ?? null;
}

/** Get active admin/office/sales/ops employees with phone numbers for simultaneous ring.
 *  Detailers and door_hanger_reps are excluded — calls only ring management & sales. */
interface EmployeeNumber { employeeId: string; phoneNumber: string; }
async function getActiveEmployees(conn: mysql.Connection): Promise<EmployeeNumber[]> {
  const [rows] = await conn.execute(
    "SELECT employee_id, phone_number FROM employees WHERE active_status = 'active' AND role IN ('admin','office','operations_manager','sales') AND phone_number IS NOT NULL AND phone_number != ''"
  ) as [any[], any];
  return rows
    .map((r: any) => ({ employeeId: r.employee_id, phoneNumber: normalizeNumber(r.phone_number) }))
    .filter((e: EmployeeNumber) => Boolean(e.phoneNumber));
}

export function createPhoneRouter(): Router {
  const router = Router();

  // ─── Inbound SMS ──────────────────────────────────────────────────────────────
  // Twilio sends POST to /api/phone/sms when a message arrives on any line
  router.post("/sms", async (req, res) => {
    const { From, To, Body, MessageSid, MediaUrl0 } = req.body;
    console.log(`[Phone] Inbound SMS from ${From} to ${To}: ${Body?.substring(0, 80)}`);

    const conn = await getDb();
    try {
      const line = await findLineByNumber(conn, To);
      const lineId = line?.id ?? null;

      await conn.execute(
        `INSERT INTO sms_messages (line_id, twilio_message_sid, direction, from_number, to_number, body, media_url, status, is_read)
         VALUES (?, ?, 'inbound', ?, ?, ?, ?, 'received', 0)`,
        [lineId, MessageSid ?? null, normalizeNumber(From), normalizeNumber(To), Body ?? "", MediaUrl0 ?? null]
      );

            // ── Appointment Confirmation: detect "C", "CONFIRM", or "CONFIRMED" reply ──
      const bodyTrimmed = (Body ?? "").trim().toUpperCase();
      if (bodyTrimmed === "C" || bodyTrimmed === "CONFIRM" || bodyTrimmed === "CONFIRMED") {
        const normalizedFrom = normalizeNumber(From);
        const [jobs] = await conn.execute(
          `SELECT job_id, customer_name, date, time_slot
           FROM schedule_jobs
           WHERE customer_phone = ?
             AND appt_confirmation_status = 'pending'
             AND status NOT IN ('cancelled','completed')
           ORDER BY date ASC, time_slot ASC
           LIMIT 1`,
          [normalizedFrom]
        ) as [any[], any];
        if (jobs.length > 0) {
          const job = jobs[0];
          await conn.execute(
            `UPDATE schedule_jobs SET appt_confirmation_status = 'confirmed', appt_confirmed_at = NOW(), appt_confirm_method = 'sms', status = 'confirmed' WHERE job_id = ?`,
            [job.job_id]
          );
          console.log(`[ApptConfirm] Job ${job.job_id} confirmed via SMS from ${normalizedFrom}`);

          // Auto-reply to customer
          const accountSid = process.env.TWILIO_ACCOUNT_SID;
          const authToken = process.env.TWILIO_AUTH_TOKEN;
          const fromNumber = process.env.TWILIO_PHONE_NUMBER;
          if (accountSid && authToken && fromNumber) {
            const replyBody = `✅ Confirmed! We have you down for ${job.date} at ${job.time_slot}. See you then! — Luxury Wash On Wheels`;
            const params = new URLSearchParams({ To: normalizedFrom, From: fromNumber, Body: replyBody });
            fetch(`https://api.twilio.com/2010-04-01/Accounts/${accountSid}/Messages.json`, {
              method: "POST",
              headers: {
                "Content-Type": "application/x-www-form-urlencoded",
                Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
              },
              body: params.toString(),
            }).catch(e => console.error("[ApptConfirm] Auto-reply failed:", e));
          }

          // Notify admin + sales
          try {
            const admins = await getAdminEmployees();
            for (const admin of admins) {
              await createNotification({
                notificationId: `APPT_CONFIRMED_SMS_${Date.now()}_${job.job_id}_${admin.employeeId}`,
                employeeId: admin.employeeId,
                fullName: admin.fullName ?? admin.employeeId,
                notificationType: "callback_reminder",
                title: `✅ Appointment Confirmed via Text`,
                message: `${job.customer_name ?? "Customer"} confirmed their appointment on ${job.date} at ${job.time_slot} by replying C.`,
                createdBy: "System",
                status: "unread",
                requiresAcknowledgment: "no",
              });
            }
          } catch (notifErr) {
            console.error("[ApptConfirm] Notification error:", notifErr);
          }
        }
      }

      // If AI receptionist is enabled for this line, handle via AI
      if (line?.ai_receptionist_enabled) {
        // AI SMS response is handled by the existing receptionist router
        // Just acknowledge for now — full AI SMS handled separately
        res.set("Content-Type", "text/xml");
        res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
        return;
      }

      // Empty TwiML response — message is stored, team sees it in app
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    } catch (err) {
      console.error("[Phone] SMS webhook error:", err);
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?><Response></Response>`);
    } finally {
      await conn.end();
    }
  });

  // ─── Inbound Voice Call ───────────────────────────────────────────────────────
  // Twilio sends POST to /api/phone/voice when a call arrives on any line
  router.post("/voice", async (req, res) => {
    const { From, To, CallSid } = req.body;
    console.log(`[Phone] Inbound call from ${From} to ${To} (${CallSid})`);

    const conn = await getDb();
    try {
      const line = await findLineByNumber(conn, To);
      const lineId = line?.id ?? null;

      // Log the call immediately
      await conn.execute(
        `INSERT INTO call_logs (line_id, twilio_call_sid, direction, from_number, to_number, status, ai_handled)
         VALUES (?, ?, 'inbound', ?, ?, 'ringing', ?)`,
        [lineId, CallSid, normalizeNumber(From), normalizeNumber(To), line?.ai_receptionist_enabled ? 1 : 0]
      );

      // If AI receptionist is enabled, forward to AI handler
      if (line?.ai_receptionist_enabled) {
        const publicUrl = "https://luxurywashonwheels.app";
        res.set("Content-Type", "text/xml");
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Redirect method="POST">${publicUrl}/api/receptionist/call</Redirect>
</Response>`);
        return;
      }

      // Simultaneous ring all active employees
      const activeEmployees = await getActiveEmployees(conn);

      if (activeEmployees.length === 0) {
        // No employees available — play voicemail prompt
        res.set("Content-Type", "text/xml");
        res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">Thank you for calling Luxury Wash On Wheels. We are unable to take your call right now. Please leave a message after the tone.</Say>
  <Record maxLength="120" transcribe="true" />
</Response>`);
        return;
      }

      // Build <Dial> with simultaneous ring to all employees
      const publicUrl = "https://luxurywashonwheels.app";
      const numberTags = activeEmployees
        .map(emp => `    <Number statusCallbackEvent="answered" statusCallback="${publicUrl}/api/phone/dial-answered?employeeId=${encodeURIComponent(emp.employeeId)}&amp;callSid=${encodeURIComponent(CallSid)}">${emp.phoneNumber}</Number>`)
        .join("\n");
      const twiml = `<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Dial callerId="${normalizeNumber(To)}" timeout="30" record="record-from-answer" recordingStatusCallback="${publicUrl}/api/phone/recording-status">
${numberTags}
  </Dial>
  <Say voice="alice">We missed your call. Please call back or send us a text and we will get back to you shortly.</Say>
</Response>`;

      res.set("Content-Type", "text/xml");
      res.send(twiml);
    } catch (err) {
      console.error("[Phone] Voice webhook error:", err);
      res.set("Content-Type", "text/xml");
      res.send(`<?xml version="1.0" encoding="UTF-8"?>
<Response>
  <Say voice="alice">We are experiencing technical difficulties. Please try again later.</Say>
</Response>`);
    } finally {
      await conn.end();
    }
  });

  // ─── Call Status Callback ─────────────────────────────────────────────────────
  // Twilio sends POST when call status changes (answered, completed, no-answer, etc.)
  router.post("/call-status", async (req, res) => {
    const { CallSid, CallStatus, CallDuration, From } = req.body;
    console.log(`[Phone] Call status: ${CallSid} → ${CallStatus} (${CallDuration}s)`);

    const conn = await getDb();
    try {
      // Update call log with final status and duration
      await conn.execute(
        `UPDATE call_logs SET status = ?, duration_seconds = ? WHERE twilio_call_sid = ?`,
        [CallStatus ?? "unknown", parseInt(CallDuration ?? "0") || 0, CallSid]
      );

      // Send in-app + push notification to all admins when a call goes unanswered
      if (CallStatus === "no-answer" || CallStatus === "busy") {
        const callerNum = From ?? "Unknown";
        const formatted = callerNum.replace(/\D/g, "").replace(/^1?(\d{3})(\d{3})(\d{4})$/, "($1) $2-$3") || callerNum;
        const notifTitle = CallStatus === "no-answer" ? "📵 Missed Call" : "🔴 Busy — Missed Call";
        const notifMsg = `Missed call from ${formatted}. Tap Call Log to call back.`;
        try {
          const admins = await getAdminEmployees();
          for (const admin of admins) {
            await createNotification({
              notificationId: `MISSED_CALL_${CallSid}_${admin.employeeId}`,
              employeeId: admin.employeeId,
              fullName: admin.fullName ?? admin.employeeId,
              notificationType: "missed_call",
              title: notifTitle,
              message: notifMsg,
              createdBy: "System",
              status: "unread",
              requiresAcknowledgment: "no",
            });
          }
        } catch (notifErr) {
          console.error("[Phone] Failed to create missed call notification:", notifErr);
        }
        notifyOwner({ title: notifTitle, content: notifMsg }).catch(() => {});
        console.log(`[Phone] Missed call notification sent for ${CallSid}`);
      }
    } catch (err) {
      console.error("[Phone] Call status callback error:", err);
    } finally {
      await conn.end();
    }
    res.sendStatus(204);
  });

  // ─── Dial Answered Callback ──────────────────────────────────────────────────
  // Twilio POSTs here when a specific employee's leg is answered
  router.post("/dial-answered", async (req, res) => {
    const employeeId = (req.query.employeeId as string) || req.body.employeeId;
    const callSid = (req.query.callSid as string) || req.body.callSid || req.body.CallSid;
    const callStatus = req.body.CallStatus ?? "";
    console.log(`[Phone] Dial answered: employeeId=${employeeId} callSid=${callSid} status=${callStatus}`);
    if (employeeId && callSid && callStatus === "answered") {
      const conn = await getDb();
      try {
        await conn.execute(
          `UPDATE call_logs SET answered_by_employee_id = ? WHERE twilio_call_sid = ?`,
          [employeeId, callSid]
        );
      } catch (err) {
        console.error("[Phone] Dial answered error:", err);
      } finally {
        await conn.end();
      }
    }
    res.sendStatus(204);
  });

  // ─── Recording Status Callback ────────────────────────────────────────────────
  router.post("/recording-status", async (req, res) => {
    const { CallSid, RecordingUrl, RecordingStatus } = req.body;
    if (RecordingStatus === "completed" && RecordingUrl) {
      const conn = await getDb();
      try {
        await conn.execute(
          `UPDATE call_logs SET recording_url = ? WHERE twilio_call_sid = ?`,
          [RecordingUrl, CallSid]
        );
      } catch (err) {
        console.error("[Phone] Recording status error:", err);
      } finally {
        await conn.end();
      }
    }
    res.sendStatus(204);
  });

  // ─── Configure Webhooks ───────────────────────────────────────────────────────
  // Admin calls this to auto-configure all Twilio phone numbers with webhook URLs
  router.post("/configure-webhooks", async (req, res) => {
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    const publicUrl = "https://luxurywashonwheels.app";

    if (!accountSid || !authToken) {
      return res.status(400).json({ error: "TWILIO_ACCOUNT_SID and TWILIO_AUTH_TOKEN not configured" });
    }

    const conn = await getDb();
    try {
      const [lines] = await conn.execute("SELECT * FROM phone_lines WHERE is_active = 1") as [any[], any];
      const results: any[] = [];

      for (const line of lines) {
        if (!line.twilio_sid) {
          results.push({ line: line.line_name, status: "skipped", reason: "no twilio_sid" });
          continue;
        }

        // Update the phone number's voice and SMS webhook URLs
        const formData = new URLSearchParams({
          VoiceUrl: `${publicUrl}/api/phone/voice`,
          VoiceMethod: "POST",
          StatusCallback: `${publicUrl}/api/phone/call-status`,
          StatusCallbackMethod: "POST",
          SmsUrl: `${publicUrl}/api/phone/sms`,
          SmsMethod: "POST",
        });

        const response = await fetch(
          `https://api.twilio.com/2010-04-01/Accounts/${accountSid}/IncomingPhoneNumbers/${line.twilio_sid}.json`,
          {
            method: "POST",
            headers: {
              Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: formData.toString(),
          }
        );

        if (response.ok) {
          results.push({ line: line.line_name, number: line.phone_number, status: "configured" });
        } else {
          const err = await response.text();
          results.push({ line: line.line_name, number: line.phone_number, status: "error", detail: err });
        }
      }

      res.json({ results });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    } finally {
      await conn.end();
    }
  });

  // ─── Recording Proxy ─────────────────────────────────────────────────────────
  // Proxies Twilio recording audio to the client with Basic Auth (recordings require auth)
  router.get("/recording-proxy", async (req, res) => {
    const recordingUrl = req.query.url as string;
    if (!recordingUrl || !recordingUrl.includes("twilio.com")) {
      return res.status(400).json({ error: "Invalid recording URL" });
    }
    const accountSid = process.env.TWILIO_ACCOUNT_SID;
    const authToken = process.env.TWILIO_AUTH_TOKEN;
    if (!accountSid || !authToken) {
      return res.status(500).json({ error: "Twilio credentials not configured" });
    }
    try {
      // Append .mp3 if not already present
      const mp3Url = recordingUrl.endsWith(".mp3") ? recordingUrl : `${recordingUrl}.mp3`;
      const response = await fetch(mp3Url, {
        headers: {
          Authorization: `Basic ${Buffer.from(`${accountSid}:${authToken}`).toString("base64")}`,
        },
      });
      if (!response.ok) {
        return res.status(response.status).json({ error: "Failed to fetch recording" });
      }
      res.set("Content-Type", "audio/mpeg");
      res.set("Cache-Control", "private, max-age=3600");
      const buffer = await response.arrayBuffer();
      res.send(Buffer.from(buffer));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  return router;
}
