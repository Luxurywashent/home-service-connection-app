# HSC Integration Test Plan

Audit date: 2026-10-17. This is the plan. These tests were **not run**. Do not run them against live customer payments, production invoices, or production payroll.

Use a disposable JobSync company (Company A), a second disposable company (Company B), one owner, one dispatcher, and one technician in each. Use Stripe test mode. Use the same `DATABASE_URL` the web and the mobile `EXPO_PUBLIC_JOBSYNC_API_BASE_URL` actually use. If those hosts differ, the test is invalid until that is explained.

Existing automated coverage to run first, still on the fake or local test database only:

| Suite | What it already locks |
|---|---|
| `repos/jobsync` `server/phase5d.dashboardEod.test.ts` | Dashboard booked and completed values, company split, timezone |
| `server/phase4b.paymentService.test.ts` through `phase4e.revenueWorkflow.test.ts` | Payments, refunds, job-as-invoice |
| `server/phase5e2.clockConcurrency.test.ts` | One open shift |
| `server/phase5a.mobileLiveRole.test.ts` | Mobile role is the live database role |
| `server/mobileOperations.contract.test.ts`, `phase1.mobileCanonicalJobs.test.ts` | Mobile job DTO |
| `repos/home-service-connection-app` `tests/jobsync-mobile-api.test.ts`, `tests/m2-company-timekeeping.test.ts` | Client normalizers and the legacy timekeeping block |

Add the cases below. They are missing: the Operations Overview formula, the clock timeout reconciliation, the timesheet query parity, and the GPS publisher.

## Shared steps for each feature

1. Create or update the record on web.
2. Read it back with the JobSync service or a `company_id`-scoped SQL check on the **test** database.
3. Open the same record on mobile against that same API origin.
4. Compare values, ids, status, and timezone day.
5. Change it on mobile within that role's rights.
6. Confirm web shows the change after its normal refetch, without a manual database edit.
7. Drop the network mid-request.
8. Restore the network and confirm one record, not two.
9. Repeat a read as Company B and as a technician who should not see it.
10. Confirm primary keys did not duplicate.

## Matrix

| Case | Direction | Pass | Fail today (from source) |
|---|---|---|---|
| Clock-in on mobile | Mobile → web timesheet | One `fs_clock_records` row, company business date, visible to the owner on web | UI can show failure if the handler is slower than 12s. Row may still exist. |
| Clock-out on web | Web → mobile `GET /time/current` | Mobile leaves "On shift" after refresh | Should pass if mobile refetches. Not executed. |
| Timesheet edit on web | Web → mobile | Hours match, approval returns to pending and is visible | Mobile omits `approval_status`. Owner mobile list is self-only. Date string may not be `YYYY-MM-DD`. |
| Payment on mobile | Mobile → web invoice and dashboard collected | `fs_job_payments` row, balance drops, dashboard collected includes it, Operations Overview does not pretend the job amount is "collected" | Operations Overview ignores payments. Idempotent retry **not verified**. |
| Payment on web | Web → mobile job balance | Mobile job `balance` and `paymentStatus` match | Job list DTO includes those fields. Screen not executed. |
| Job completed on mobile | Mobile → web dashboard | `completed_at` set, completed job value moves, booked definition unchanged | Mobile dashboard status filter only treats `completed` as revenue and still uses the wrong day. |
| Job rescheduled on web | Web → mobile calendar | Same `scheduled_start_at` instant, company-local day label matches | Mobile week bounds are Chicago dates stuffed into `Z`, or device-local on timesheets. |
| Upsell | Both dashboards | No number until product defines upsell separately from `fs_jobs.amount` | Mobile shows $0 upsell because the mapper writes 0. Web has no upsell sum. |
| Failed network | Either | Error visible, no success badge, no second row | Clock timeout does not reconcile. Schedule cache fails silently. |
| Dashboard API failure | Mobile | Previous total or an error. Not a fresh $0. | `catch` clears jobs and renders `$0`. |
| Offline retry of payment, job, shift | Mobile | One row | Shift has a server lock **if** the unique index is migrated. Payment idempotency client wiring not verified. Job create retry not verified. |
| Company B read of Company A job, timesheet, payment, GPS | API | 404 or empty, never the row | Source predicates say so. Not re-run. |
| Technician calls payroll or team finance | Mobile | 403 | `requireManager` / owner check on those routes. Not re-run. |
| GPS freshness | Technician mobile → web | Point appears only while clocked in and newer than the window | No publisher. Web shows the latest point forever. |
| Legacy host | Company schedule | No request to `luxwashapp-n2wveyqg.manus.space` | Those fetches are still in `schedule.tsx`. |

## Fixture shape (test data only)

- Company A timezone `America/Chicago`. Company B timezone `America/New_York`.
- One job scheduled today, status `scheduled`, assigned, amount 100.
- One job status `on_site`, amount 80.
- One completed yesterday, `completed_at` today in Chicago and still yesterday in UTC, amount 50. This is the timezone trap.
- One unassigned scheduled job, amount 70.
- One paid payment of 40 and one succeeded refund of 10 on the completed job.
- One open clock row and one closed clock row for the technician. None for the owner.
- One `fs_technician_locations` point 2 hours old and one 2 minutes old.

Expected dashboard, using current web SQL, not a new formula:

- Booked includes the non-cancelled amounts whose **scheduled** company-local day is in range.
- Completed job value includes the job whose **completed_at** company-local day is in range.
- Collected is payments minus refunds plus estimate credits whose **created_at** is in range.
- Outstanding follows `getCompanyNetPaymentProjection`, not the mobile sum.
- Upsell is not asserted as a dollar total until a column exists.

## Network interruption

Use a proxy or the device airplane toggle. Do not point the test at production.

1. Start clock-in. Black-hole the response after the server has inserted. Restore. Expect one open row and a confirmed "On shift" only after `GET /time/current`.
2. Start a payment with a fixed idempotency key. Drop the response. Retry with the same key. Expect one `fs_job_payments` row.
3. Kill the jobs request for Operations Overview. Expect an error banner and no replacement of the last good total with $0.

## Exit criteria

Ship a repair only when the matching row in this plan passes on the test company in both directions, Company B still gets nothing, and the legacy Manus host receives no Company request.
