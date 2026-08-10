# VIP Credit System — Implementation Notes

## Current State (as of Jul 6, 2026)

### Database Schema
- `vip_contracts`: No `credits_remaining` column yet. Has `total_price`, `status`, `frequency`, `program_type`.
- `vip_visits`: Has `status` enum: scheduled/completed/missed/cancelled. Has `is_replacement`, `schedule_job_id`.
- Credits are implicitly = total_visits - completed_visits (computed, not stored).

### Server (vipRouter.ts)
- `GET /by-email/:email` — returns all active contracts with enriched visits. This is what the customer portal uses.
- `POST /update-visit` (line ~755) — updates visit status. When `status=completed`, sets `completed_at=NOW()`.
- `POST /cancel` — cancels contract + all future visits.
- No `use-credit` or `book-with-credit` endpoint exists yet.

### Customer Portal (app/(customer)/vip.tsx)
- Shows `remainingCount = totalVisits - completedCount` as a chip.
- No credit balance card, no "use a credit to book" button.
- Has `MyScheduleSection` which shows upcoming appointments and allows reschedule/cancel.

## Design for Credit System

### What a "credit" is:
- 1 credit = 1 unused VIP visit slot
- Credits remaining = total visits (12 or 26) - completed visits
- Credits are consumed when a visit is marked completed
- Credits are NOT consumed by scheduling — only by completion

### New server endpoints needed:
1. `POST /api/vip/use-credit` — customer requests to use a credit to book a specific visit
   - Input: contractId, visitId (the unscheduled visit to book), requestedDate, requestedTime
   - Action: Updates vip_visit with requested date/time, sets status to 'scheduled', notifies admin
   - Does NOT decrement a counter — credits are computed from visits

2. `GET /api/vip/by-email/:email` — already returns visits, just need to add computed `credits_remaining` to response

### UI changes needed in vip.tsx:
1. **Credit Balance Card** — prominent card showing "X visits remaining" with visual credit dots/coins
2. **"Use a Credit" button** — on each unscheduled visit, allow customer to request a date/time
3. **Request booking modal** — date picker + time preference + notes → sends request to admin
4. **Credit history** — show completed visits as "used credits"

### Auto-decrement on completion:
- Already handled implicitly: `completedCount` is computed from `vip_visits.status = 'completed'`
- When admin marks a schedule_job complete → vip_visit status syncs to completed → credits_remaining decreases
- The `enrichVisits` function in by-email already auto-derives completion from schedule_job status

## Files to Edit
1. `/home/ubuntu/team-luxury-wash/server/vipRouter.ts` — add `use-credit` booking request endpoint
2. `/home/ubuntu/team-luxury-wash/app/(customer)/vip.tsx` — add credit balance card + booking request UI
3. `/home/ubuntu/team-luxury-wash/server/email.ts` — add credit booking request notification email (admin)
