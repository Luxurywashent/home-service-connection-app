/**
 * AI Router — exposes LLM-powered endpoints for:
 * - parseBooking: extract structured job data from plain-English text
 * - businessCoach: analyze performance data and return actionable insights
 * - optimizeRoute: order today's jobs for a location to minimize drive time
 */
import { z } from "zod";
import { publicProcedure, router } from "./_core/trpc";
import { invokeLLM } from "./_core/llm";
import * as db from "./db";

export const aiRouter = router({
  // ── Parse a natural-language booking request into structured fields ──────
  parseBooking: publicProcedure
    .input(z.object({ text: z.string().min(1), preferredDay: z.string().optional() }))
    .mutation(async ({ input }) => {
      // ── Service catalog for price auto-population ──────────────────────────
      const PACKAGES = [
        { id: "basic", title: "Basic Detail", basePrice: { sedan: 200, suv: 225, xl_suv_van: 250, truck: 225 } },
        { id: "full", title: "Full Detail", basePrice: { sedan: 300, suv: 325, xl_suv_van: 375, truck: 325 } },
        { id: "luxury", title: "Luxury Detail", basePrice: { sedan: 400, suv: 450, xl_suv_van: 500, truck: 450 } },
        { id: "interior", title: "Interior Detail", basePrice: { sedan: 250, suv: 275, xl_suv_van: 325, truck: 275 } },
        { id: "exterior", title: "Exterior Detail", basePrice: { sedan: 200, suv: 225, xl_suv_van: 250, truck: 225 } },
      ];
      const ADDONS: Record<string, number> = {
        "rain_x": 10, "paint_sealant": 50, "clay_bar": 50, "leather_conditioning": 40,
        "leather_cleaning": 30, "ozone": 100, "shampoo_seats_carpets": 75,
        "pet_hair_removal": 40, "one_step_paint": 250, "shampoo_seats_only": 50,
        "engine_bay": 30, "deep_interior": 75, "shampoo_carpet_only": 50,
      };

      // ── Fetch active detailers for auto-assignment ─────────────────────────
      const allDetailers = await db.getAllDetailers();

      const result = await invokeLLM({
        messages: [
          {
            role: "system",
            content: `You are a booking assistant for Luxury Wash On Wheels, a mobile car detailing company.
Extract booking details from the user's message and return ONLY valid JSON with these fields:
{
  "customerName": string,
  "phone": string or null,
  "email": string or null,
  "address": string or null,
  "city": string or null,
  "vehicleType": "sedan" | "suv" | "xl_suv_van" | "truck" | null,
  "serviceType": "basic" | "full" | "luxury" | "interior" | "exterior" | null,
  "addons": comma-separated addon IDs from [rain_x, paint_sealant, clay_bar, leather_conditioning, leather_cleaning, ozone, shampoo_seats_carpets, pet_hair_removal, one_step_paint, shampoo_seats_only, engine_bay, deep_interior, shampoo_carpet_only] or null,
  "detailerName": string or null,
  "preferredDay": string or null,
  "preferredTime": string or null,
  "notes": string or null
}
Map service descriptions: basic detail→basic, full detail→full, luxury detail→luxury, interior detail→interior, exterior detail→exterior.
Map vehicle: car/coupe→sedan, SUV/crossover→suv, van/large SUV→xl_suv_van, truck/pickup→truck.
If a field is not mentioned, set it to null. Return ONLY the JSON object.`,
          },
          { role: "user", content: input.text },
        ],
        responseFormat: { type: "json_object" },
      });

      let parsed: Record<string, string | null> = {};
      try {
        const text = typeof result.choices?.[0]?.message?.content === "string" ? result.choices[0].message.content : JSON.stringify(result.choices?.[0]?.message?.content ?? "");
        parsed = JSON.parse(text);
      } catch {
        parsed = { raw: typeof result.choices?.[0]?.message?.content === "string" ? result.choices[0].message.content : "" };
      }

      // ── Auto-assign detailer if none named ────────────────────────────────
      if (!parsed.detailerName && allDetailers.length > 0) {
        // Pick the first active detailer that matches the city, or just the first one
        const cityMatch = parsed.city
          ? allDetailers.find((d: any) => d.city?.toLowerCase().includes((parsed.city ?? "").toLowerCase()))
          : null;
        const assigned = cityMatch ?? allDetailers[0];
        parsed.detailerName = assigned.fullName;
        parsed.detailerId = assigned.employeeId;
        parsed.autoAssigned = "true";
      }

      // ── Auto-populate price from service + vehicle ────────────────────────
      const DURATIONS: Record<string, number> = {
        basic: 2, full: 3, luxury: 4, interior: 2, exterior: 2,
      };
      const pkg = PACKAGES.find((p) => p.id === parsed.serviceType);
      if (pkg) {
        const vehicle = (parsed.vehicleType ?? "sedan") as keyof typeof pkg.basePrice;
        const base = pkg.basePrice[vehicle] ?? pkg.basePrice.sedan;
        let addonTotal = 0;
        if (parsed.addons) {
          parsed.addons.split(",").map((a: string) => a.trim()).forEach((addonId: string) => {
            addonTotal += ADDONS[addonId] ?? 0;
          });
        }
        parsed.price = String(base + addonTotal);
        parsed.basePrice = String(base);
        parsed.addonTotal = String(addonTotal);
        // Auto-populate duration and end time
        const durationHours = DURATIONS[parsed.serviceType ?? ""] ?? 2;
        parsed.durationHours = String(durationHours);
        // If a preferred time was parsed, calculate end time
        if (parsed.preferredTime) {
          const startMatch = parsed.preferredTime.match(/(\d+)/);
          if (startMatch) {
            const startHour = parseInt(startMatch[1], 10);
            parsed.startHour = String(startHour);
            parsed.endHour = String(startHour + durationHours);
          }
        } else {
          // Default to 9 AM start
          parsed.startHour = "9";
          parsed.endHour = String(9 + durationHours);
        }
      }

      return parsed;
    }),

  // ── Business Coach: deep performance analysis with per-detailer metrics ─────────
  businessCoach: publicProcedure
    .input(z.object({
      location: z.string().optional(), // "all" or a specific city
      period: z.string().optional(),   // "this_week" | "last_30_days" | "all_time"
    }))
    .mutation(async ({ input }) => {
      // ── Date range calculation ──────────────────────────────────────────────
      const today = new Date();
      const todayStr = today.toISOString().split("T")[0];
      const weekAgo = new Date(today); weekAgo.setDate(today.getDate() - 7);
      const monthAgo = new Date(today); monthAgo.setDate(today.getDate() - 30);

      let fromDate = weekAgo.toISOString().split("T")[0];
      if (input.period === "last_30_days") fromDate = monthAgo.toISOString().split("T")[0];
      if (input.period === "all_time") fromDate = "2020-01-01";

      const locationLabel = (!input.location || input.location === "all") ? "all locations" : input.location;
      const isAllLocations = !input.location || input.location === "all";

      // ── Fetch all detailers with hourly rates ──────────────────────────────
      const allDetailers = await db.getAllDetailers().catch(() => []) as any[];
      const activeDetailers = isAllLocations
        ? allDetailers
        : allDetailers.filter((e: any) => e.city?.toLowerCase().includes(input.location!.toLowerCase()));
      const activeDetailerCount = activeDetailers.length;

      // ── Fetch schedule jobs (primary data source) ──────────────────────────
      const schedJobs = await db.getAllScheduleJobsByDateRange(fromDate, todayStr).catch(() => []) as any[];
      const filteredJobs = isAllLocations
        ? schedJobs
        : schedJobs.filter((j: any) => j.location?.toLowerCase().includes(input.location!.toLowerCase()));
      const completedJobs = filteredJobs.filter((j: any) => ['confirmed','in_progress','completed'].includes(j.status));

      // ── Aggregate totals ───────────────────────────────────────────────────
      const effectiveJobs = completedJobs.length;
      const effectiveRevenue = completedJobs.reduce((s: number, j: any) => s + Math.max(0, Number(j.totalPrice ?? 0) - Number(j.discountAmount ?? 0)), 0);
      const effectiveUpsells = completedJobs.reduce((s: number, j: any) => s + Number(j.upsellTotal ?? 0), 0);
      const totalTips = completedJobs.reduce((s: number, j: any) => s + Number(j.tips ?? 0), 0);
      const effectiveAvgPerJob = effectiveJobs > 0 ? (effectiveRevenue / effectiveJobs).toFixed(2) : "0";
      const upsellRate = effectiveRevenue > 0 ? ((effectiveUpsells / effectiveRevenue) * 100).toFixed(1) : "0";

      // ── Per-detailer breakdown ─────────────────────────────────────────────
      const detailerMap: Record<string, { name: string; jobs: number; revenue: number; upsells: number; tips: number; addresses: Set<string>; dates: Set<string>; hourlyRate: number }> = {};
      for (const d of activeDetailers) {
        detailerMap[d.fullName.toLowerCase()] = {
          name: d.fullName,
          jobs: 0, revenue: 0, upsells: 0, tips: 0,
          addresses: new Set(), dates: new Set(),
          hourlyRate: Number(d.hourlyRate ?? 17),
        };
      }
      for (const j of completedJobs) {
        const assigned = (j.assignedTo ?? "").toLowerCase();
        if (detailerMap[assigned]) {
          detailerMap[assigned].jobs++;
          detailerMap[assigned].revenue += Math.max(0, Number(j.totalPrice ?? 0) - Number(j.discountAmount ?? 0));
          detailerMap[assigned].upsells += Number(j.upsellTotal ?? 0);
          detailerMap[assigned].tips += Number(j.tips ?? 0);
          if (j.customerAddress) detailerMap[assigned].addresses.add(j.customerAddress);
          if (j.date) detailerMap[assigned].dates.add(j.date);
        }
      }

      const detailerBreakdown = Object.values(detailerMap).map(d => ({
        name: d.name,
        jobs: d.jobs,
        revenue: d.revenue,
        avgPerJob: d.jobs > 0 ? (d.revenue / d.jobs).toFixed(2) : "0",
        upsells: d.upsells,
        upsellRate: d.revenue > 0 ? ((d.upsells / d.revenue) * 100).toFixed(1) : "0",
        tips: d.tips,
        uniqueAddresses: d.addresses.size,
        daysWorked: d.dates.size,
        avgJobsPerDay: d.dates.size > 0 ? (d.jobs / d.dates.size).toFixed(1) : "0",
        avgStopsPerDay: d.dates.size > 0 ? (d.addresses.size / d.dates.size).toFixed(1) : "0",
        hourlyRate: d.hourlyRate,
      }));

      // ── Schedule density analysis ──────────────────────────────────────────
      const jobsByDate: Record<string, number> = {};
      const revenueByDate: Record<string, number> = {};
      for (const j of completedJobs) {
        if (j.date) {
          jobsByDate[j.date] = (jobsByDate[j.date] || 0) + 1;
          revenueByDate[j.date] = (revenueByDate[j.date] || 0) + Math.max(0, Number(j.totalPrice ?? 0) - Number(j.discountAmount ?? 0));
        }
      }
      const workDays = Object.keys(jobsByDate).length;
      const avgJobsPerDay = workDays > 0 ? (effectiveJobs / workDays).toFixed(1) : "0";
      const avgRevenuePerDay = workDays > 0 ? (effectiveRevenue / workDays).toFixed(2) : "0";
      const peakDay = Object.entries(jobsByDate).sort((a, b) => b[1] - a[1])[0];
      const slowestDay = Object.entries(jobsByDate).sort((a, b) => a[1] - b[1])[0];

      // ── Service type breakdown ─────────────────────────────────────────────
      const serviceBreakdown: Record<string, { count: number; revenue: number }> = {};
      for (const j of completedJobs) {
        const pkg = j.packageType || "Unknown";
        if (!serviceBreakdown[pkg]) serviceBreakdown[pkg] = { count: 0, revenue: 0 };
        serviceBreakdown[pkg].count++;
        serviceBreakdown[pkg].revenue += Math.max(0, Number(j.totalPrice ?? 0) - Number(j.discountAmount ?? 0));
      }
      const serviceLines = Object.entries(serviceBreakdown)
        .sort((a, b) => b[1].revenue - a[1].revenue)
        .map(([name, data]) => `${name}: ${data.count} jobs, $${data.revenue.toFixed(0)} revenue, $${data.count > 0 ? (data.revenue / data.count).toFixed(0) : 0} avg`);

      // ── Payroll / labor cost estimation ────────────────────────────────────
      // Fetch timesheet data for all active detailers
      let totalClockHours = 0;
      let totalLaborCost = 0;
      const detailerHours: { name: string; hours: number; cost: number }[] = [];
      for (const d of activeDetailers) {
        try {
          const weeklyData = await db.getWeeklyHours(d.employeeId, fromDate, todayStr);
          const hours = Number(weeklyData.totalHours ?? 0);
          const rate = Number(d.hourlyRate ?? 17);
          const cost = hours * rate;
          totalClockHours += hours;
          totalLaborCost += cost;
          detailerHours.push({ name: d.fullName, hours, cost });
        } catch { /* skip if no timesheet data */ }
      }
      const laborCostRatio = effectiveRevenue > 0 ? ((totalLaborCost / effectiveRevenue) * 100).toFixed(1) : "0";
      const revenuePerLaborHour = totalClockHours > 0 ? (effectiveRevenue / totalClockHours).toFixed(2) : "0";

      // ── Drive time proxy (unique stops per day per detailer) ───────────────
      const driveTimeNotes = detailerBreakdown
        .filter(d => d.jobs > 0)
        .map(d => `${d.name}: ${d.uniqueAddresses} unique stops over ${d.daysWorked} days (avg ${d.avgStopsPerDay} stops/day)`);

      // ── Cancelled/no-show analysis ─────────────────────────────────────────
      const cancelledJobs = filteredJobs.filter((j: any) => j.status === 'cancelled').length;
      const cancelRate = filteredJobs.length > 0 ? ((cancelledJobs / filteredJobs.length) * 100).toFixed(1) : "0";

      // ── Build the comprehensive prompt ─────────────────────────────────────
      const prompt = `You are an elite business operations coach for Luxury Wash On Wheels, a premium mobile car detailing company in the Florida Panhandle (Crestview, Niceville, Destin, Fort Walton Beach, Pensacola). Your job is to provide DEEP, SPECIFIC, ACTIONABLE analysis — not generic advice. Name specific detailers. Use exact dollar amounts. Identify the #1 bottleneck holding back revenue growth.

═══ PERIOD: ${input.period === 'this_week' ? 'This Week' : input.period === 'last_30_days' ? 'Last 30 Days' : 'All Time'} | LOCATION: ${locationLabel} ═══

── AGGREGATE METRICS ──
• Total completed jobs: ${effectiveJobs}
• Total revenue: $${effectiveRevenue.toFixed(2)}
• Average job ticket: $${effectiveAvgPerJob}
• Total upsell revenue: $${effectiveUpsells.toFixed(2)} (${upsellRate}% of revenue)
• Total tips collected: $${totalTips.toFixed(2)}
• Active detailers: ${activeDetailerCount}
• Working days in period: ${workDays}
• Average jobs/day: ${avgJobsPerDay}
• Average revenue/day: $${avgRevenuePerDay}
• Cancellation rate: ${cancelRate}% (${cancelledJobs} cancelled out of ${filteredJobs.length} total)
${peakDay ? `• Busiest day: ${peakDay[0]} (${peakDay[1]} jobs)` : ''}
${slowestDay ? `• Slowest day: ${slowestDay[0]} (${slowestDay[1]} jobs)` : ''}

── PER-DETAILER PERFORMANCE ──
${detailerBreakdown.filter(d => d.jobs > 0).map(d => `• ${d.name}: ${d.jobs} jobs, $${d.revenue.toFixed(0)} revenue, $${d.avgPerJob} avg ticket, $${d.upsells.toFixed(0)} upsells (${d.upsellRate}%), $${d.tips.toFixed(0)} tips, ${d.daysWorked} days worked, ${d.avgJobsPerDay} jobs/day`).join('\n')}
${detailerBreakdown.filter(d => d.jobs === 0).map(d => `• ${d.name}: 0 jobs (on payroll but no completed work this period)`).join('\n')}

── DRIVE TIME / ROUTE EFFICIENCY ──
${driveTimeNotes.length > 0 ? driveTimeNotes.join('\n') : 'No address data available'}
(More stops/day = more windshield time = less productive time. Target: 2-3 stops max per detailer per day for full details.)

── SERVICE MIX BREAKDOWN ──
${serviceLines.length > 0 ? serviceLines.join('\n') : 'No service data available'}
(Higher-ticket services like Luxury Detail and Full Detail should be pushed. Basic Details drag down avg ticket.)

── PAYROLL & LABOR COST ──
• Total clock hours (all detailers): ${totalClockHours.toFixed(1)}h
• Total labor cost (wages only): $${totalLaborCost.toFixed(2)}
• Labor cost as % of revenue: ${laborCostRatio}%
• Revenue per labor hour: $${revenuePerLaborHour}
${detailerHours.filter(d => d.hours > 0).map(d => `• ${d.name}: ${d.hours.toFixed(1)}h clocked, $${d.cost.toFixed(2)} labor cost`).join('\n')}
(Target: labor cost should be 25-35% of revenue. Revenue/hour target: $100+/hr.)

── UPSELL DEEP DIVE ──
${detailerBreakdown.filter(d => d.jobs > 0).map(d => `• ${d.name}: $${d.upsells.toFixed(0)} in upsells across ${d.jobs} jobs = $${d.jobs > 0 ? (d.upsells / d.jobs).toFixed(0) : 0}/job avg upsell`).join('\n')}
(Target: every job should have at least $30-50 in upsells. Rain-X, paint sealant, leather conditioning are easy adds.)

═══ ANALYSIS REQUIREMENTS ═══
Return ONLY valid JSON. Provide 6-8 insights minimum. Each insight MUST:
1. Reference SPECIFIC detailer names and exact dollar amounts from the data above
2. Calculate the DOLLAR IMPACT of the problem or opportunity (e.g., "If Casey matched Lamont's upsell rate, that's an extra $X/week")
3. Give ONE specific, immediately actionable recommendation (not vague advice like "improve upsells" — say exactly what to do)

Categories to cover (at minimum):
- SCHEDULE DENSITY: Are detailers booked enough? Gaps between jobs? Days with too few jobs?
- DRIVE TIME: Too many stops spread across town? Geographic clustering opportunities?
- AVERAGE JOB SIZE: Who's selling premium packages vs basic? Opportunity to upsell to higher tiers?
- UPSELL PERFORMANCE: Who's crushing it, who's leaving money on the table? Dollar opportunity?
- PAYROLL EFFICIENCY: Revenue per labor hour, labor cost ratio, anyone overstaffed?
- REVENUE GROWTH: What's the #1 lever to pull to grow revenue 20% next month?

JSON structure:
{
  "score": <number 0-100 — be honest, don't inflate>,
  "scoreLabel": <"Excellent" (85+) | "Good" (70-84) | "Needs Attention" (50-69) | "Critical" (<50)>,
  "summary": <3-4 sentence executive summary identifying the single biggest opportunity and biggest risk>,
  "insights": [
    {
      "category": <"SCHEDULE DENSITY" | "DRIVE TIME" | "AVERAGE JOB SIZE" | "UPSELLS" | "PAYROLL" | "REVENUE" | "TEAM" | "CANCELLATIONS">,
      "emoji": <single emoji>,
      "severity": <"Critical" | "Warning" | "Positive">,
      "title": <punchy 5-8 word title>,
      "detail": <3-5 sentences with SPECIFIC numbers, names, and dollar amounts from the data>,
      "recommendation": <one concrete, specific action with expected dollar impact>
    }
  ]
}`;

      let structured: any = null;
      const sysMsg = "You are an elite mobile detailing business operations analyst. You provide brutally honest, data-driven analysis with specific dollar amounts, named team members, and actionable recommendations. Never give generic advice. Always quantify the opportunity cost. Return ONLY a raw JSON object \u2014 no markdown fences, no backticks, no text before or after the JSON.";
      try {
        const result = await invokeLLM({
          model: "gemini-3.1-pro-preview",
          messages: [
            { role: "system", content: sysMsg },
            { role: "user", content: prompt },
          ],
          thinking: { budget_tokens: 8192 },
        });
        const raw = typeof result.choices?.[0]?.message?.content === "string" ? result.choices[0].message.content : JSON.stringify(result.choices?.[0]?.message?.content ?? "");
        console.log("[AI Coach] LLM response length:", raw.length);
        if (raw.length > 10) {
          // Strip any markdown fences if present
          const cleaned = raw.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
          structured = JSON.parse(cleaned);
        }
      } catch (llmErr: any) {
        console.error("[AI Coach] Primary LLM call failed:", llmErr.message);
      }
      // Fallback: try gemini-3-flash-preview if primary failed
      if (!structured || !structured.score) {
        try {
          console.log("[AI Coach] Retrying with gemini-3-flash-preview...");
          const fallbackResult = await invokeLLM({
            model: "gemini-3-flash-preview",
            messages: [
              { role: "system", content: sysMsg },
              { role: "user", content: prompt },
            ],
            thinking: { budget_tokens: 4096 },
          });
          const raw2 = typeof fallbackResult.choices?.[0]?.message?.content === "string" ? fallbackResult.choices[0].message.content : JSON.stringify(fallbackResult.choices?.[0]?.message?.content ?? "");
          console.log("[AI Coach] Fallback response length:", raw2.length);
          if (raw2.length > 10) {
            const cleaned2 = raw2.replace(/^```json\s*/i, '').replace(/^```\s*/i, '').replace(/```\s*$/i, '').trim();
            structured = JSON.parse(cleaned2);
          }
        } catch (fallbackErr: any) {
          console.error("[AI Coach] Fallback LLM also failed:", fallbackErr.message);
        }
      }
      if (!structured || !structured.score) {
        structured = { score: 50, scoreLabel: "Needs Attention", summary: "Analysis could not be completed. Please try again.", insights: [] };
      }

      // Ensure backward compatibility with admin-html.ts (overallScore alias)
      return {
        ...structured,
        overallScore: structured.score,
        stats: {
          totalJobs: effectiveJobs,
          totalRevenue: effectiveRevenue,
          totalHours: totalClockHours,
          totalUpsells: effectiveUpsells,
          avgPerJob: effectiveAvgPerJob,
          upsellRate,
          location: locationLabel,
          activeDetailerCount,
          totalTips,
          totalLaborCost,
          laborCostRatio,
          revenuePerLaborHour,
          cancelRate,
          workDays,
          avgJobsPerDay,
        },
      };
    }),

  // ── Route Optimizer: order today's jobs for minimum drive time ───────────
  optimizeRoute: publicProcedure
    .input(z.object({
      location: z.string(),
      date: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const targetDate = input.date || new Date().toISOString().split("T")[0];
      // Get jobs for this location and date from online bookings
      const bookings = await db.getBookingsByDateAndLocation(
        db.normalizeLocation(input.location),
        targetDate
      );

      if (bookings.length === 0) {
        return { route: null, message: `No bookings found for ${input.location} on ${targetDate}.` };
      }

      const jobList = bookings.map((b: any, i: number) => ({
        index: i + 1,
        customer: `${b.firstName} ${b.lastName}`,
        address: `${b.streetAddress || ""} ${b.city || ""} ${b.state || ""}`.trim(),
        time: b.timeSlot,
        service: b.packageType || "Detail",
      }));

      const prompt = `You are a route optimizer for Luxury Wash On Wheels in ${input.location}, Florida.

Today's jobs (${targetDate}):
${jobList.map(j => `${j.index}. ${j.customer} — ${j.address} — ${j.time} — ${j.service}`).join("\n")}

Suggest the optimal driving order to minimize total drive time. Consider:
- Start from ${input.location} city center
- Group nearby addresses together
- Respect scheduled time slots where possible
- Account for job duration (standard detail ~2-3 hours, full detail ~4-5 hours)

Return:
1. The recommended job order with estimated drive time between stops
2. Total estimated drive time
3. Any scheduling conflicts or tips for the day`;

      const result = await invokeLLM({
        messages: [
          { role: "system", content: "You are a logistics expert for a mobile car detailing company. Provide practical, specific routing advice." },
          { role: "user", content: prompt },
        ],
      });

      const text = typeof result.choices?.[0]?.message?.content === "string" ? result.choices[0].message.content : JSON.stringify(result.choices?.[0]?.message?.content ?? "");
      return { route: text, jobCount: bookings.length, location: input.location, date: targetDate };
    }),

  // ── Create Job from Quick Book: persist parsed booking as a schedule job ────
  createJobFromQuickBook: publicProcedure
    .input(z.object({
      customerName: z.string(),
      phone: z.string().nullable().optional(),
      email: z.string().nullable().optional(),
      address: z.string().nullable().optional(),
      city: z.string().nullable().optional(),
      location: z.string(),           // city slug e.g. "crestview"
      vehicleType: z.string().nullable().optional(),
      serviceType: z.string().nullable().optional(),
      addons: z.string().nullable().optional(),
      detailerName: z.string().nullable().optional(),
      date: z.string(),               // YYYY-MM-DD (required — user must pick)
      startHour: z.number(),          // 0-23
      endHour: z.number(),            // 0-23
      price: z.string().nullable().optional(),
      notes: z.string().nullable().optional(),
      createdBy: z.string().optional(),
    }))
    .mutation(async ({ input }) => {
      const jobId = `qb-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      const startH = input.startHour;
      const endH = input.endHour;
      const formatHour = (h: number) => {
        const period = h >= 12 ? "pm" : "am";
        const hour = h > 12 ? h - 12 : h === 0 ? 12 : h;
        return `${hour}:00${period}`;
      };
      const timeSlot = `${formatHour(startH)} - ${formatHour(endH)}`;
      const job = {
        jobId,
        location: input.location,
        date: input.date,
        timeSlot,
        startHour: String(startH),
        endHour: String(endH),
        customerName: input.customerName,
        customerPhone: input.phone ?? undefined,
        customerEmail: input.email ?? undefined,
        vehicleType: input.vehicleType ?? undefined,
        packageType: input.serviceType ?? undefined,
        selectedAddons: input.addons ?? undefined,
        totalPrice: input.price ?? undefined,
        assignedTo: input.detailerName ?? undefined,
        notes: (input.address ? `Address: ${input.address}\n` : "") + (input.notes ?? ""),
        status: "confirmed" as const,
        source: "manual" as const,
        leadSource: "Admin — Quick Book",
        createdBy: input.createdBy ?? "admin",
      };
      await db.upsertScheduleJob(job);
      return { jobId, date: input.date, location: input.location, timeSlot };
    }),

  // ── Transcribe Voice: convert audio recording to text using Whisper ───────
  transcribeVoice: publicProcedure
    .input(z.object({
      audioBase64: z.string(),
      mimeType: z.string().default("audio/m4a"),
    }))
    .mutation(async ({ input }) => {
      const { storagePut } = await import("./storage");
      const { transcribeAudio } = await import("./_core/voiceTranscription");
      const buffer = Buffer.from(input.audioBase64, "base64");
      const ext = input.mimeType.includes("webm") ? "webm" : input.mimeType.includes("wav") ? "wav" : "m4a";
      const key = `voice-transcriptions/${Date.now()}.${ext}`;
      const { url } = await storagePut(key, buffer, input.mimeType);
      const result = await transcribeAudio({
        audioUrl: url,
        language: "en",
        prompt: "Booking details for a car detailing service: customer name, phone, email, service type, vehicle type, address, city, preferred day.",
      });
      return { text: (result as any).text ?? "" };
    }),
});
