# HSC Phase 1 repair report

Pre-production verification of these repairs is in `docs/HSC_PHASE1_PREPRODUCTION_VERIFICATION.md`. That document is the release gate. These repairs are not approved for production.

Development-only repairs. Production API configuration was not changed. No production migration was applied. Payments and payroll calculations were not changed. The legacy database and its code were not removed.

## Step 1 — Production architecture

Checked read-only on 2026-10-17. These responses identify the application contract. They do not prove which database each host uses.

| Host | What it serves |
| --- | --- |
| `https://www.homeserviceconnected.com` | JobSync. `/api/health` returns `{"ok":true,"service":"field-service-os"}`. `/api/build-info` names `field-service-os`, canonical domain `www.homeserviceconnected.com`, `apiMode` same-origin. `/api/mobile/v1/health` returns `home-service-connection-mobile-api` v1. |
| `https://jobwash-veysiubh.manus.space` | The same JobSync health, build-info, and mobile health JSON. Same application contract. Not proof of one database. |
| `https://homeserviceconnected.com` (apex) | `/api/health` returns 404 `Not Found` as text. This is not the JobSync API. |
| `https://luxwashapp-n2wveyqg.manus.space` | A different Express app. `/api/health` returns `{"ok":true,"timestamp":...}` and `x-powered-by: Express`. `/api/mobile/v1/health` is 404. |

EAS production `EXPO_PUBLIC_JOBSYNC_API_BASE_URL` is `https://jobwash-veysiubh.manus.space`. The mobile code default, used when that variable is missing or the host is not allowlisted, is `https://www.homeserviceconnected.com`. The Luxwash host is rejected by `resolveJobSyncBaseUrl` and falls back to www.

Company Mobile network path for these repairs:

- Dashboard: `GET /api/mobile/v1/dashboard/summary`
- Clock: `POST /api/mobile/v1/time/clock-in` and `clock-out`, then `GET /api/mobile/v1/time/current`
- Timesheets: `GET /api/mobile/v1/time/timesheets`
- Location publish: `POST /api/mobile/v1/dispatch/location`
- Operations map: `GET /api/mobile/v1/dispatch/board`

Legacy hosts still hardcoded, and left in place:

- Mobile source `APP_API_BASE` in `app/(tabs)/schedule.tsx`, `app/(tabs)/admin-schedule.tsx`, `app/(tabs)/admin-receptionist.tsx`, and `components/add-job-modal.tsx`
- Legacy server `PUBLIC_URL` fallback `https://www.luxurywashonwheels.app` in the Expo server routers
- JobSync web leftovers in `InvoicePage.tsx`, `ConfirmPage.tsx`, `TrackPage.tsx`, and `client/src/lib/doorHangerPhotos.ts`
- Legacy employee screens still call the Expo app's own tRPC API when there is no Company session

Screens that were on legacy or client-computed Company data and are now on JobSync for a Company session:

- Operations Overview revenue and team map
- Company clock status
- Company timesheet panel and the Company hours query on the home tab
- Company technician location publishing

Screens that still depend on legacy data when a Company session is absent, or for features outside this phase: schedule notes and booking helpers that call `APP_API_BASE`, receptionist, legacy employee clock and geofence, legacy reporting, and the JobSync web public invoice/confirm/track pages above.

Credential access still required before any production claim:

- A read-only production `DATABASE_URL` for each API host, or a read-only `SHOW INDEX FROM fs_clock_records` and `SELECT DATABASE()` on each host. This environment has no database, JWT, or Stripe credentials (`matching_env_count` 0). The open-shift unique index was not checked in production.
- Do not change the EAS production URL until www and jobwash are confirmed to be the same database.

## Step 2 — Mobile revenue dashboard

Root cause: Operations Overview summed client-side job rows, forced upsell and discount to 0, used a Chicago week against UTC date slices, and turned a failed fetch into an empty list that rendered as `$0`.

Files:

- `server/mobileOperations.ts` — `GET /api/mobile/v1/dashboard/summary` calls the existing `dashboard.summary` procedure. The accounting SQL was not copied or edited.
- `server/mobileCompanyDashboard.ts` — response projection. Upsell and discount are `null` with definitions, because JobSync does not store those dollar totals.
- `lib/jobsync-mobile-api.ts` — normalizer throws when booked or collected revenue is missing.
- `app/(tabs)/admin-dashboard.tsx` — Booked and Collected are separate. Loading, error, retry, and last-successful stale states.

What changes on screen: a Company owner or dispatcher sees booked revenue, collected revenue, completed job value, and company-wide outstanding balance for Today or This Week, in the company timezone. A failed request shows "Revenue unavailable" and Retry. It does not show `$0`. Upsells and discounts say they are not tracked as separate totals. Technicians receive 403 because web `dashboard.summary` is limited to owners and dispatchers.

Tests: projector unit test; mobile normalizer rejects an empty body and accepts a real zero booked value next to a non-zero collected value. Passing. Live Mobile → Web comparison was not run (no database).

Database changes: none.

Rollback: revert the mobile dashboard client and the `dashboard/summary` route.

## Step 3 — Employee clock-in

Root cause: the clock button raced the request at 12 seconds while the fetch itself aborts at 20 seconds. The losing race did not cancel the request, so the server could commit a shift while the phone showed a failure. A 409 "already clocked in" was then shown as On shift with a fabricated clock-in time.

Files:

- `components/company-clock-status.tsx` — one in-flight action, same 20 second request timeout, then `GET /time/current` before success or failure is shown.
- `lib/company-clock-reconcile.ts` — clock-in is confirmed only when the server reports an open shift with a clock-in time. Clock-out is confirmed only when the server reports no open shift. A failed follow-up read does not show On shift.
- `server/timeClockService.ts` was not changed. It still inserts `fs_clock_records` and maps the open-shift unique-index collision to the already-clocked-in conflict.

What changes on screen: Clock In stays disabled until the server shift is read back. A timeout that actually clocked the employee in shows On shift with the server time. A timeout that did not clock them in shows an error and stays on Clock In. The button does not send a second clock-in while the first request is still running.

Tests: reconcile cases for timeout-plus-open-shift, timeout-plus-no-shift, and an unreadable server. Passing. Existing clock concurrency tests passed. Production uniqueness index: not verified. The migration `migrations/20261003_fs_clock_records_open_shift_lock.sql` exists and was not applied.

Database changes: none in this phase. If production does not already have `uq_fs_clock_records_open_shift`, duplicate open shifts can still be inserted by overlapping requests. Confirm with a read-only `SHOW INDEX` before relying on the database lock.

Rollback: revert the clock component and reconcile helper. Server clock SQL is unchanged.

## Step 4 — Timesheets

Root cause: mobile timesheets always filtered to the caller unless a manager passed `memberId`, formatted `DATE` values with `String(date).slice(0, 10)`, used the device Monday–Sunday week, omitted approval fields, and counted "today" hours with `UTC_DATE()`.

Files:

- `server/mobileOperations.ts` — managers with no `memberId` see the company team. Technicians stay on their own rows. `weekOffset` uses the company timezone Monday–Sunday week. `today=1` uses the company-local date. Dates go through `clockRecordCalendarDate`. Approval status, review time, and reviewer note are returned. Team summary "today" uses the company-local date.
- `server/mobileClockDate.ts`, `server/mobileTimesheetRange.ts`
- `components/company-timesheet-panel.tsx` — sends `weekOffset`, defaults managers to Team, shows approval text.
- `app/(tabs)/index.tsx` — Company hours for Today and This Week use the company date and company week.
- Payroll SQL in `createPayrollPeriod` was not edited.

What changes on screen: the timesheet week label comes from the server week and company timezone. Managers can view the team, themselves, or one teammate. Each row shows approval status. The same `fs_clock_records` rows are what Web Timesheets read.

Tests: company week of 2026-10-17 is 2026-10-12 through 2026-10-18; manager scope and technician isolation; Date serialization. Passing. Live Web edit → Mobile refresh was not run (no database).

Database changes: none.

Rollback: revert the timesheet route and the two mobile screens. Web timesheet SQL was not changed.

## Step 5 — Company location tracking

Root cause: nothing in the Company app called `POST /api/mobile/v1/dispatch/location`. The Operations map disabled `location.getActive` for a JobSync session. Dispatch returned the latest point with no age, and the web fleet map labeled every point live.

Files:

- `server/dispatchService.ts` — a technician location is stored only when that technician has an open `fs_clock_records` shift. Each point includes `stale` and `ageSeconds`. A point older than 15 minutes is stale.
- `components/company-location-publisher.tsx` — technicians who are clocked in, have accepted the location disclosure, and have foreground permission publish about every 2 minutes while the app is active. Background updates start only when the OS has already granted background permission. Owners and dispatchers do not publish.
- `app/(tabs)/admin-dashboard.tsx` and `client/src/pages/FieldServiceApp.tsx` — live markers are fresh points only. Stale points are listed as not live.

What changes on screen: a clocked-in technician shares location with JobSync. Operations Overview and the web Fleet Map plot fresh points and label older ones as not live, with the last update time.

Tests: publish rejected before clock-in; publish stored on the technician's company only; a 20-minute-old point is stale and does not appear on another company's board; client policy blocks owners, clocked-out technicians, and missing disclosure. Passing. Foreground and background behavior on a physical device was not run in this environment.

Database changes: none. `fs_technician_locations` is the existing table.

Rollback: revert the publisher, the dispatch freshness fields, and the map filters. Existing location rows are left as they are.

## Step 6 — Tests

Passing in this environment:

- JobSync: `server/phase1.mobileRepairs.test.ts`, `server/dispatchService.test.ts`, `server/mobileOperations.contract.test.ts`, `server/phase5d.dashboardEod.test.ts`, `server/phase5e2.clockConcurrency.test.ts`
- JobSync `tsc --noEmit`
- Mobile: `tests/phase1-company-repairs.test.ts`, `tests/m2-company-timekeeping.test.ts`, `tests/m1-company-authority.test.ts`, `tests/jobsync-mobile-api.test.ts`
- Mobile `tsc --noEmit`

Not run, and not counted as passing:

- Mobile → JobSync → Web and Web → JobSync → Mobile against isolated development data. This environment has no JobSync database and no test accounts.
- Production `SHOW INDEX FROM fs_clock_records`
- Physical-device foreground and background location
- A browser walkthrough of the Fleet Map. That page needs a Company session, Google Maps, and dispatch data.

Cross-company isolation is covered in the dispatch fake database: a location written for company 11 is absent from company 22's board. Authorization is covered by the owner/dispatcher revenue route and the technician-only publisher.

## Step 7 — Remaining work before production

Do not deploy this branch to production until:

1. Read-only checks show whether www and jobwash use the same database.
2. Read-only `SHOW INDEX` confirms `uq_fs_clock_records_open_shift`, or a separately approved migration is applied after the preflight duplicate query returns no rows.
3. Isolated development accounts prove clock-in, timesheets, revenue, and location in both directions, including a forced timeout and a second tap.
4. You approve the production release. This phase stops before that approval.
