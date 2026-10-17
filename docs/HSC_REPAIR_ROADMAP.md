# HSC Repair Roadmap

Audit date: 2026-10-17. This is a plan. No repair is included in this change. Do not start it until the definitions in `HSC_CRITICAL_BUG_REPORT.md` are accepted.

Principle: Company web and Company mobile are already two doors into JobSync. Repair the doors. Do not add a third revenue service, a second timesheet table, or a realtime bus.

Each item lists a rollback: revert the commit. None of these steps require a production data backfill except where marked. Do not run those backfills without a reviewed copy of production.

## Priority 1 — Critical

### 1. Prove the mobile API host

**Change.** Record, in deployment config only, the web origin and the mobile `EXPO_PUBLIC_JOBSYNC_API_BASE_URL`, and confirm they use one `DATABASE_URL`. No code behavior change until that is known.

**Why.** EAS production sets `https://jobwash-veysiubh.manus.space`. The client default is `https://www.homeserviceconnected.com`. If those differ, every later fix can be tested against the wrong server.

**Rollback.** N/A (config check).

**Test.** `GET /api/mobile/v1/health` and web `/api/health` on both hosts. Compare build id. Do not print secrets.

### 2. Operations Overview uses dashboard definitions

**Change.** In `app/(tabs)/admin-dashboard.tsx`, stop filtering jobs into a dollar amount. Add a thin mobile route that returns the existing `dashboard.summary` payload (or call the same SQL through one shared function). Show booked revenue, completed job value, collected, and outstanding with the labels from `FINANCE_REPORTING_DEFINITIONS`. On error, keep the last success and show the error. Do not write `$0` for a failed request.

**Do not change** the SQL that defines those four numbers.

**Rollback.** Revert the screen to the job-list sum.

**Test.** Integration plan revenue rows, including the Chicago/UTC completion date and the forced HTTP 500.

### 3. Clock-in reconciliation

**Change.** In `components/company-clock-status.tsx`, remove the 12-second race that ignores the in-flight POST. Abort with the same timer as `requestJson`, then always `GET /api/mobile/v1/time/current` before showing failure or "On shift". Show Pending while the POST is in flight.

**Server.** Confirm migration `uq_fs_clock_records_open_shift` is applied on the **test** database before calling the repair done. Do not invent a second clock table.

**Rollback.** Revert the component. The unique index stays; it is the safety net.

**Test.** Slow success, double tap, offline, web clock-out then mobile refresh.

### 4. One timesheet query

**Change.** Make `GET /api/mobile/v1/time/timesheets` match web `operations.clockRecords`: company timezone week, all members for owner/dispatcher, self for technician, `approval_status` included, dates formatted as `YYYY-MM-DD` company dates. Fix `teamSummary` to use `companyLocalDate` instead of `UTC_DATE()`. Point `CompanyTimesheetPanel` at that result and at the sync `revision`.

**Rollback.** Revert the handler and the panel.

**Test.** Owner with no personal punches sees the technician's row. Web edit appears on mobile. Los Angeles company around UTC midnight.

### 5. Payment and invoice wording

**Change.** Mobile job balance and any "collected" label must use `paymentService` net figures already on the job DTO. Do not add tips or discounts into `fs_jobs.amount` in the client. Align the past-due date in `getJobInvoiceSummary` with the company-timezone predicate already used by `getDashboardPaymentProjection`. That is a definition consistency fix inside one service; call it out in the PR so accounting review sees it.

**Rollback.** Revert the past-due predicate. Client labels revert with the screen commit.

**Test.** Payment and refund rows in the integration plan. Company B cannot read the payment.

### 6. Leave tenant checks in place

**Change.** None that weaken `company_id`. While touching queries above, keep `company_id` in the `WHERE` clause. Add the regression from `HSC_INTEGRATION_TEST_PLAN.md` if it is not already in `phase5d` / payment security tests.

**Rollback.** N/A.

## Priority 2 — Operational

### 7. GPS

**Change.** After a confirmed technician clock-in, and only with permission, POST `/api/mobile/v1/dispatch/location` on an interval and stop on clock-out. Mobile map and web dispatch hide points older than 15 minutes and show the timestamp. Clock-in must succeed when GPS is denied.

**Rollback.** Stop calling the publisher. Keep the freshness filter so old points do not return.

**Test.** Issue D cases. Company isolation on `fs_technician_locations`.

### 8. Job screens speak canonical statuses

**Change.** Company schedule and dashboards display `scheduled`, `en_route`, `on_site`, `completed`, `follow_up`, `cancelled`. Remove the Operations Overview dependency on `confirmed` / `in_progress`. Route assignment through `assigned_user_id` only.

**Rollback.** Revert the labels. Do not dual-write statuses into the legacy enum.

### 9. Remove the hardcoded legacy host from Company flows

**Change.** Gate or delete `APP_API_BASE` fetches in `schedule.tsx` and `add-job-modal.tsx` when a Company session exists. Company notes and history must use JobSync job APIs.

**Rollback.** Revert the fetches.

**Test.** A Company session produces no request to `luxwashapp-n2wveyqg.manus.space`.

### 10. Payroll hours

**Change.** After timesheets match, decide explicitly whether `createPayrollPeriod` should sum `fs_clock_records.total_hours` for approved rows or keep scheduled job duration. Today it uses scheduled duration and `DATE(scheduled_start_at)` without company timezone. Do not switch the formula silently. Document the choice, then change it in one place.

**Rollback.** Keep scheduled-duration SQL.

### 11. Upsells

**Change.** None until an owner defines whether upsell is inside `fs_jobs.amount` or a new column. Mobile should show "not tracked" rather than `$0` and `0%`.

## Priority 3 — Platform

### 12. Shared contract

**Change.** One module (already mostly `paymentService`, `timeClockService`, `jobService`) exported to both the tRPC procedure and the mobile handler. Mobile stops re-summing. Add contract tests that the mobile JSON fields equal the web procedure for one fixture company.

### 13. Cache

**Change.** Operations Overview and timesheets subscribe to sync `revision`. Legacy AsyncStorage keys are unused in Company mode. No offline outbox until clock and payment reconciliation in Priority 1 is done.

### 14. Realtime

**Change.** None. Revisit only if polling after step 12 is still too slow for a named screen.

### 15. Legacy retirement

**Change.** Inventory which Company-visible screens still call `lib/trpc.ts`. Leave investor, customer self-serve, and Luxury Wash PIN mode on the legacy database until they have a company id and a migration plan. Do not drop those tables.

## Sequence

1. Host check (P1.1).
2. Revenue display (P1.2) and timesheet query (P1.4), behind tests, no SQL definition change except the past-due timezone bug in P1.5 if accounting agrees.
3. Clock reconciliation (P1.3).
4. GPS and legacy host (P2.7, P2.9).
5. Payroll formula decision (P2.10).
6. Contract tests and legacy screen inventory (P3).

## Out of scope until approved

- Production migrations, including applying the open-shift index if it is missing. Check first on a copy.
- Backfilling `schedule_jobs` or `clock_in_out_records` into `fs_*`.
- Stripe live charges, refunds, or payout changes.
- Replacing Twilio, Resend, or Forge.
- A rewrite of the Expo app or the web portal.
