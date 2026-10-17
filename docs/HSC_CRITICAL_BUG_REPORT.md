# HSC Critical Bug Report

Audit date: 2026-10-17. Scope: source of `repos/jobsync` and `repos/home-service-connection-app`. Production rows were not read. Nothing in this report was fixed.

A defect is **confirmed** when the source path produces the symptom without depending on an unknown production value. It is **suspected** when production data, a device timezone, or an unapplied migration would decide whether users see it. It is **not verified** when the workspace cannot see the running host or database.

## Shared root causes

These six causes explain the four reported incidents. Fix them once instead of patching each screen.

| ID | Root cause | Defects it feeds |
|---|---|---|
| RC1 | Two backends and two databases. Company data is JobSync `fs_*`. Legacy data is `schedule_jobs` / `clock_in_out_records` with no `company_id`. | Timesheets, GPS, performance, public booking leftovers |
| RC2 | Mobile Operations Overview recomputes revenue from a job list using legacy statuses. It does not call `dashboard.summary`. | Revenue $0, upsell 0%, disagreement with web |
| RC3 | Date handling mixes company timezone, hardcoded `America/Chicago`, device local time, `UTC_DATE()`, and `String(Date).slice(0, 10)`. | Revenue day filter, timesheet week, team "today" hours, payroll dates |
| RC4 | Empty or failed responses are rendered as a real zero or as a connection failure after the server may have committed. | Revenue $0 on error, clock-in false failure |
| RC5 | Company mobile never publishes `POST /api/mobile/v1/dispatch/location`, and the Operations map query is turned off for Company sessions. Web locations have no max age. | Empty map, stale pins |
| RC6 | Legacy hosts remain hardcoded (`luxwashapp-n2wveyqg.manus.space`) while EAS production points JobSync at `jobwash-veysiubh.manus.space` and the code default is `https://www.homeserviceconnected.com`. | Split brain if those hosts are not the same deployment. **Not verified** in production. |

## Revenue definitions to keep

Do not change these JobSync definitions as part of a UI fix. Mobile should display them.

Documented in `server/financeService.ts` as `FINANCE_REPORTING_DEFINITIONS`, with the exact SQL in `dashboardRouter.summary` and `paymentService.ts`.

| Term | Current JobSync meaning | Period | Includes | Excludes |
|---|---|---|---|---|
| Booked revenue | `SUM(fs_jobs.amount)` where `status <> 'cancelled'` | `scheduled_start_at` in the company timezone (`CONVERT_TZ`) | Draft and every non-cancelled status whose start falls in the period | Cancelled jobs. Not ledger income. Not payments. |
| Scheduled / open revenue | `SUM(amount)` where status is `scheduled`, `en_route`, `on_site`, or `follow_up` | Same scheduled-start scope | Open operational jobs | `completed`, `cancelled`, `draft` |
| Completed job value | `SUM(amount)` where `status = 'completed'` and `completed_at` is not null | `completed_at` in the company timezone | Completed job amount | Payments, tips, refunds. A job completed today that was scheduled earlier counts on the completion day. |
| Collected revenue | Sum of `fs_job_payments.amount` in status `paid` or `refunded`, minus succeeded `fs_job_payment_refunds`, plus paid `fs_estimate_payments` | `created_at` in the company timezone | Gross payment rows in the period, net of refunds in the period | Tips. Discounts. Tax as a separate line. Manual ledger income. |
| Outstanding balance | Per non-cancelled job, `GREATEST(amount - (gross payments - succeeded refunds + applied estimate credit), 0)`, then summed | Company-wide on `getCompanyNetPaymentProjection`. Dashboard also returns period open / past due / due today from `getDashboardPaymentProjection`. | Unpaid remainder of job amount | Cancelled jobs |
| Upsell revenue | **Not defined** on the mounted Company revenue SQL | — | `company_users.upsell_bonus_pct` exists for payroll bonus math only | Do not invent an upsell total from `fs_jobs.amount`. Legacy `schedule_jobs.upsell_total` is a different database. |

`getMobileFinanceSummary` sets `bookedRevenue` to `invoiceSummary.billedTotal`, which is the sum of **all** non-cancelled `fs_jobs.amount` for the company, not the dashboard period. That name collision is a defect. The finance definitions block already says booked revenue is job operational value, not ledger income. The mobile payload overloads the name.

`GET /api/mobile/v1/reports/summary` sums completed `amount` with no date window. That is a third "revenue" number. Operations Overview does not call it.

Taxes: price book has tax configuration. Payment totals in `paymentService.ts` do not add a separate tax line. Treat tax as **not verified** inside `fs_jobs.amount`.

Refunds: succeeded refunds reduce collected revenue. They do not reduce booked revenue or completed job value, because those are `fs_jobs.amount`.

## Issue A — Mobile Operations Overview shows $0

**Symptom.** Admin → Operations Overview (`app/(tabs)/admin-dashboard.tsx`) shows `$0` for Today or This Week.

**Confirmed.** The screen never asks JobSync for booked, completed, or collected revenue.

Path:

1. `getWeekRange()` builds `start`, `end`, and `today` in `America/Chicago`, not `companies.timezone`.
2. `getJobSyncCompanyJobs(token, { start: start + "T00:00:00.000Z", end: end + "T23:59:59.999Z" })`.
3. `listJobs` filters `scheduled_start_at >= start AND scheduled_start_at < end` after `new Date(filters.start)`.
4. Each job is mapped to `date: scheduledStartAt.slice(0, 10)` (UTC calendar date), `totalPrice: amount`, `upsellTotal: 0`, `discountAmount: 0`, `assignedTo: assignedName ?? ""`.
5. The memo keeps only statuses `confirmed`, `in_progress`, and `completed`, and only rows with a non-empty `assignedTo`.
6. Day mode keeps rows whose UTC date string equals the Chicago `today`.
7. Revenue is `max(0, totalPrice + upsellTotal - discount)`.
8. On fetch failure, `canonicalWeekJobs` is set to `[]`. After loading finishes, the UI renders `$0` with no error.

Canonical job statuses are `draft`, `scheduled`, `en_route`, `on_site`, `completed`, `follow_up`, `cancelled` (`JobSyncCanonicalJobStatus`). A normal booked job is `scheduled`. It fails the status filter. Only `completed` overlaps. Unassigned jobs fail the `assignedTo` check. Web booked revenue includes both.

**Files.** `app/(tabs)/admin-dashboard.tsx` (`getWeekRange`, the `useEffect` around the jobs fetch, the `metrics` memo). `lib/jobsync-mobile-api.ts` `getJobSyncCompanyJobs`, `normalizeJobSyncMobileJob`. `jobsync/server/jobService.ts` `listJobs`. `jobsync/server/fieldServiceRouter.ts` `dashboardRouter.summary`.

**API.** `GET /api/mobile/v1/company/jobs`. Not `dashboard.summary`. Not `GET /api/mobile/v1/finance`.

**Tables.** `fs_jobs`. Payments are ignored by this screen.

**Evidence.** Status list in the filter is `['confirmed', 'in_progress', 'completed']`. Mapper sets `upsellTotal: 0`. `catch` calls `setCanonicalWeekJobs([])`. Web SQL uses `status <> 'cancelled'` and `CONVERT_TZ`.

**Same defect elsewhere.** Legacy `reporting.getSummary` uses `totalPrice - discount` and does not add `upsellTotal`, while this screen adds `upsellTotal`. Detailer home (`app/(tabs)/index.tsx`) uses yet another merge of `daily_performance` and schedule jobs. `reports/summary` is a third completed-only total.

**Suspected, not measured.** How often production jobs are `completed` versus `scheduled`, and whether `assignedName` is blank. Either condition yields $0 even before the timezone mismatch. Live API failure rate is **not verified**.

**Correction.** Operations Overview should render `dashboard.summary` (or a mobile route that returns that same payload): booked revenue, completed job value, collected, outstanding. Show the last confirmed figures with an error state when the request fails. Do not substitute zero. Stop adding a separate upsell into `amount` until upsell is a defined column.

**Risk.** Critical. Wrong money on the admin home screen. Changing the SQL definitions would also change web accounting. The safe fix is to **display** the existing web definitions.

**Tests.** Fixture company in `America/Chicago` and one in `America/New_York`. Jobs in `scheduled`, `on_site`, and `completed`. One unassigned. One payment and one refund. Assert mobile cards equal `dashboard.summary`. A forced 500 must not show `$0` as if it were revenue.

## Issue B — Clock-in connection failure

**Symptom.** Employees see a connection or timeout error while clocking in. The question is whether the shift was saved.

**Confirmed path.** Company clock UI is `components/company-clock-status.tsx`. It calls `clockInHomeServiceConnected` → `POST /api/mobile/v1/time/clock-in` → `clockInMember` in `server/timeClockService.ts`, which inserts `fs_clock_records`.

There is no user-visible string "Connection lost" in the mobile UI. The closest strings are:

- "Home Service Connected took too long to respond. Check your connection and try again." (`requestJson` abort at 20 seconds)
- "Time action did not respond. Please sign out and sign in again, then retry." (UI `Promise.race` at 12 seconds)
- "Home Service Connected authentication is unavailable." (empty non-401 body)
- "Unable to refresh your time status."

**False failure is confirmed in code.** `run()` races the POST against a 12-second timer and does **not** abort the fetch. The fetch itself dies at 20 seconds. If the server commits between 12 and 20 seconds, the UI shows the timeout error while `fs_clock_records` has the open shift. The next paint does not say "pending".

**Duplicate shift.** `clockInMember` returns 409 "You are already clocked in." when an open row exists. A unique index `uq_fs_clock_records_open_shift` is in the service and in migration `20261003_fs_clock_records_open_shift_lock.sql`. A retry after a timed-out success should hit that conflict **if the index is installed**. This audit did not inspect production DDL. Index presence is **not verified**.

The 409 message matches the UI recovery regex, which then sets local state to clocked in without waiting for `GET /time/current`. That recovery is appropriate only because the server said the shift exists. The displayed `clockInAt` can be "now" if the previous state had no timestamp.

**What is not true.** Legacy `db.clockIn` inserts a new `clock_in_out_records` row without checking for an open row. Company mode is blocked from that procedure. A user who is not in a Company session can still create duplicate legacy shifts.

**Location permission.** Company clock-in does not request GPS and does not send coordinates. Legacy clock-in requests foreground permission and still clocks in if GPS fails. Location failure is not the Company clock-in failure.

**Offline.** There is no queued clock-in. A failed request stays failed. The UI must not show "On shift" unless `GET /api/mobile/v1/time/current` returns an open entry, or the POST returned 201. The timeout path currently shows an error, which is safer than a false "On shift", but it hides a possible success. The "already clocked in" path shows "On shift" from the error text.

**Auth.** Bearer lifetime is 30 days. `requireMobileCompany` reloads `company_users`. An inactive member gets 403. Expired JWT gets 401. Those are real failures, not phantom ones. Whether production tokens are expiring early is **not verified**.

**Files.** `components/company-clock-status.tsx`, `lib/jobsync-mobile-api.ts` `requestJson` and `clockInHomeServiceConnected`, `jobsync/server/mobileOperations.ts` `clockIn`, `jobsync/server/timeClockService.ts`.

**Correction.** One timeout, and it must abort the request or the UI must reconcile with `GET /time/current` before showing failure. On timeout, show "Checking whether clock-in saved" and then either "On shift" from the server or "Clock-in did not save." Never label a local wish as clocked in. Keep the open-shift unique index. Do not write legacy `clock_in_out_records` for Company users.

**Risk.** Critical for payroll trust. Duplicate-shift risk is contained on the Company path only when the unique index exists.

**Tests.** Slow clock-in (delay 15s): UI must end on the server row, one row only. Repeat tap: one open row, 409, UI shows the existing shift. Airplane mode: error, no "On shift". Clock-in on mobile, clock-out on web, mobile shows clocked out after refresh.

## Issue C — Timesheets do not match

**Symptom.** Web timesheets look right. Mobile is missing rows or shows the wrong day.

**Confirmed.** Both Company UIs read `fs_clock_records`. They do not read the same query.

| | Web `operations.clockRecords` | Mobile `GET /api/mobile/v1/time/timesheets` |
|---|---|---|
| Who | Owner and dispatcher, **all** members in the company | Always `member_user_id = token user`, unless the caller is a manager **and** passes `memberId` |
| Week | Company timezone Monday–Sunday (`Timesheets.tsx`) | Device-local Monday–Sunday (`weekRange` in `company-timesheet-panel.tsx`) |
| Date field | `iso(row.date).slice(0, 10)` | `String(row.date).slice(0, 10)` |
| Approval | `approval_status` returned and reviewed on web | Column not selected |
| Today hours on team summary | Not this query | `UTC_DATE()` in `teamSummary`, not the company timezone |
| Edit | `updateTimesheetEntry` rewrites the shared row and resets approval to pending | No mobile edit found |

`CompanyTimesheetPanel` only sends `memberId` when a manager has picked someone. With no selection, an owner sees **only their own** punches. Web shows the team. That matches "missing on mobile" for an owner.

`String(jsDate).slice(0, 10)` is not `YYYY-MM-DD`. The JobSync pool does not set `dateStrings: true` (`server/db.ts`), so mysql2 returns `Date` objects. `res.json` would have serialized a `Date` as ISO, but the handler stringifies first. Mobile `formatDateLabel` then does `new Date(dateStr + "T12:00:00")`, which is invalid for a `Date#toString()` prefix. This is a **confirmed code defect**. It was not executed against a live driver in this audit.

Web manual edits are on the same table, so they **will** show on mobile after a refetch **for that member and that date window**. They will not show in the owner's unfiltered mobile list, and the approval flag will not show.

Legacy timesheets (`clock_in_out_records`) are a different table. Company mode is blocked from writing them. If someone compares a legacy PIN user to a Company user, the rows will never match. That is RC1, not a filter bug.

**Pagination.** Mobile limits 365 rows. Web clock records limit 500. A very large week could truncate. Unlikely for one company week. Not the main bug.

**Permissions.** Web clock records are owner/dispatcher only. A technician on web may not see the team page. Mobile technicians see themselves. That part is consistent.

**Correction.** One timesheet query: company id, company-timezone week, optional member filter that defaults to "team" for managers and "self" for technicians. Return `approval_status`. Format dates with the company calendar date, never `String(date).slice(0, 10)`. Point team "today" at `companyLocalDate`. After web edits, the existing sync revision is enough if the query matches.

**Risk.** Critical. Payroll disputes and missed punches.

**Tests.** Owner creates no personal punches; two technicians punch; mobile owner list equals web. Edit hours on web; mobile shows the new hours and pending approval. Company timezone `America/Los_Angeles` around UTC midnight; both apps show the same business date. Device timezone set differently from the company; week still follows the company.

## Issue D — No active employee locations

**Confirmed.**

1. `publishTechnicianLocation` inserts `fs_technician_locations` and rejects non-technicians (`dispatchService.ts`).
2. `POST /api/mobile/v1/dispatch/location` calls that function (`mobileOperations.ts` `updateLocation`).
3. The Expo repo has **no** caller of `/dispatch/location`. Company clock does not start a location watch.
4. `admin-dashboard.tsx` calls `trpc.location.getActive` with `enabled: !jobSyncSession`. Company sessions never load legacy vans, and nothing loads JobSync locations instead. The map section then shows no team.
5. Legacy GPS (`header-clock-status.tsx`, `schedule.tsx`) writes `detailer_locations` through legacy tRPC. Those rows are not `fs_technician_locations`.
6. Web dispatch returns the latest point per user with **no** maximum age (`getDispatchBoard`). A week-old coordinate looks current.

**Suspected.** Background geofence posts from `lib/geofence-task.ts` use `EXPO_PUBLIC_API_URL` and a `/trpc/geofence.logEvent` path, while the legacy server mounts tRPC at `/api/trpc`. That is a legacy geofence bug, not the Company map. Not executed.

**Correction.** Technician Company clock-in starts a publisher to `POST /api/mobile/v1/dispatch/location` only after permission is granted. Clock-in itself must still succeed without GPS. Readers (web board and mobile map) hide points older than a documented window (proposal: 15 minutes) and label the timestamp. Do not copy legacy `detailer_locations` into the Company table without a company id.

**Risk.** High operationally. Not a payment defect. Stale coordinates are a safety and privacy defect if shown as live.

**Tests.** Technician clocks in, permission granted: web map shows a point newer than the window. Permission denied: clock-in still succeeds, map shows no point, not an old one. Owner session cannot publish. Company A does not see Company B points.

## Other confirmed defects (not the four headlines)

| Defect | Why it matters | Priority |
|---|---|---|
| Payroll hours are scheduled job duration, not `fs_clock_records.total_hours`, and `DATE(scheduled_start_at)` ignores company timezone (`createPayrollPeriod`) | Timesheet approval does not feed the paycheck draft | P1, after timesheet reads match |
| `getJobInvoiceSummary` past-due uses `CURRENT_DATE` instead of company timezone | Outstanding "past due" can move a day away from the dashboard | P1 |
| Hardcoded `APP_API_BASE` in `schedule.tsx` and `add-job-modal.tsx` | Company screens can still read the legacy host for notes, history, and booking availability | P2 |
| Break is a single pair of columns | A second break replaces the first | P2 |
| EAS JobSync host vs code default vs web origin | May be one deployment or three. **Not verified** | P1 to confirm before any client change |

## What was not verified

- Production `DATABASE_URL`, applied migrations, and the open-shift unique index.
- Whether `https://www.homeserviceconnected.com` and `https://jobwash-veysiubh.manus.space` serve the same build and database.
- Live clock-in latency, so the 12-second race is proven in code and **suspected** in production until timed.
- Real job status mix behind the $0 screen.
- Stripe, Twilio, and Resend credentials. They are absent from this workspace.
