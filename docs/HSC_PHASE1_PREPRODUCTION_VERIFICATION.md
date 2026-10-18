# HSC Phase 1 pre-production verification

Checked 2026-10-18. JobSync remains the authority for Company business data. Nothing in this check was deployed. No production migration was run. No production row was written. Production approval is still required.

This environment has no database credential, no Company test account, and no physical device. Live checks that need those are **NOT VERIFIED**. They are not passes.

## Verdicts

| Item | Verdict | What was actually checked |
| --- | --- | --- |
| 1. Same production database for `www.homeserviceconnected.com` and `jobwash-veysiubh.manus.space` | **NOT VERIFIED** | Read-only HTTP and source configuration. No `SELECT DATABASE()` and no deployment binding for `DATABASE_URL`. |
| 2. Open-shift uniqueness index on `fs_clock_records` | **NOT VERIFIED** | Migration text and application collision handling. Production `SHOW INDEX` was not run. |
| 3. Isolated end-to-end Company test | **NOT VERIFIED** | Procedure is written below. It was not executed. |
| 4. Remaining Luxury Wash host references | **PASS** | Source classification. Company-session paths do not read the legacy host. Several Company features are unavailable rather than migrated. |
| 5. New dashboard and timesheet server permissions | **NOT VERIFIED** | Source gates are present on the unreleased branch. Live role and cross-company requests were not executed. Production does not serve the new dashboard route. |
| 6. Web business logic, payments, payroll, and customer records unchanged | **PASS** | Diff against `origin/main`. Those services and SQL files are not in the change. Live payment and payroll jobs were not replayed. |

## 1. Same database — NOT VERIFIED

Matching API responses are not database identity. Both hosts were probed again at 2026-10-18 00:24 UTC.

Both `https://www.homeserviceconnected.com` and `https://jobwash-veysiubh.manus.space` returned:

- `/api/health` 200 `{"ok":true,"service":"field-service-os"}`
- `/api/build-info` 200 with `revision` `"unavailable"`, `canonicalDomain` `"www.homeserviceconnected.com"`, `apiMode` `"same-origin"`
- `/api/mobile/v1/health` 200 `home-service-connection-mobile-api` `v1`
- Cloudflare `x-manus-proxy-mode: transparent/1`

`revision` is `process.env.GIT_SHA || process.env.COMMIT_SHA || "unavailable"` and `canonicalDomain` is a hardcoded string in `server/index.ts`. Identical build-info JSON means both processes use that code path. It does not name a database.

The HTML documents differ. `www` is 1,994 bytes, SHA-256 `0bf11823f47ec84546168863979f577018caf00b4558681b0f2c206911716971`. `jobwash` is 2,334 bytes, SHA-256 `6e295be0abcfeb7b80e5e904c0428c984e3195d52f0b2e99f39f6c3a552e2bdb`, and its HTML also loads a Plausible script. Both documents reference the same static files, and those file bytes match:

- `/assets/index-BmyiAvvt.js` — 3,199,361 bytes, SHA-256 `208bf892f06f45718188e55c34b4e814cdb4ef41ae09b561e532381a35416d19`
- `/assets/index-Ckiu6OFY.css` — 783,063 bytes, SHA-256 `3d939e4d037a109513e00d31f5df4cabf772c242ac1c343617a1eff7aa48e705`

That is the same frontend bundle. It is not a database check.

Source intent, also not live proof:

- `getDb()` and `getPortalDb()` in `server/db.ts` both open `process.env.DATABASE_URL` only. There is no second Company database selector.
- `TRUSTED_WEB_ORIGINS` in `server/index.ts` includes `https://www.homeserviceconnected.com`, `https://homeserviceconnected.com`, and `https://jobwash-veysiubh.manus.space`.
- `.github/workflows/jobsync-validation.yml` runs tests, typecheck, and build. It does not deploy and it does not set a production `DATABASE_URL`.
- EAS production `EXPO_PUBLIC_JOBSYNC_API_BASE_URL` is `https://jobwash-veysiubh.manus.space`. The mobile code default, when that variable is missing or the host is not allowlisted, is `https://www.homeserviceconnected.com`.

Other hosts:

- `https://homeserviceconnected.com/api/health` is 404 `Not Found` as plain text. The apex is not the JobSync API.
- `https://luxwashapp-n2wveyqg.manus.space/api/health` is a different Express app (`{"ok":true,"timestamp":...}`, `x-powered-by: Express`). Its `/api/mobile/v1/health` is 404.

This VM has no `DATABASE_URL`, JWT, Stripe, MySQL, or TiDB variable (`matching_env_count` 0). GitHub secret names and environment names were not readable from this run. `docs/PHASE_5B1_REAL_DB_CONCURRENCY.md` records that a past environment's `DATABASE_URL` pointed at `gateway04.us-east-1.prod.aws.tidbcloud.com` and treats that host as production. That note is not a current comparison of the two public hosts. No connection string is recorded here.

A pass requires one of these, with credentials kept off the page:

- Read-only `SELECT DATABASE()` plus a non-secret server fingerprint, run through each host's own `DATABASE_URL`, and the fingerprints match.
- Or the deployment configuration that sets `DATABASE_URL` for each host, compared by hostname and schema name only.

Until that exists, do not treat the two hosts as the same production database, and do not change the EAS production URL.

## 2. Open-shift uniqueness index — NOT VERIFIED

Production presence was not checked. There is no database connection in this environment, and the migration was not applied.

The index the application expects is defined in `migrations/20261003_fs_clock_records_open_shift_lock.sql` and named in `CLOCK_RECORDS_OPEN_SHIFT_LOCK_INDEX`:

```sql
ALTER TABLE fs_clock_records
  ADD COLUMN open_shift_lock_key VARCHAR(64) GENERATED ALWAYS AS (
    CASE
      WHEN `clock_out` IS NULL AND `member_user_id` IS NOT NULL
      THEN CONCAT(`company_id`, ':', `member_user_id`)
      ELSE NULL
    END
  ) VIRTUAL;

ALTER TABLE fs_clock_records
  ADD UNIQUE KEY uq_fs_clock_records_open_shift (open_shift_lock_key);
```

What that definition protects, once it is actually present:

- At most one open shift per `(company_id, member_user_id)` when `member_user_id` is not null. The unique key is the concatenated string `companyId:memberUserId`.
- Closed shifts store `NULL` in the generated column. Unique indexes allow multiple `NULL`s, so history does not collide.
- Rows with `member_user_id` NULL also store `NULL` and are **not** covered. Legacy null-member open rows can still duplicate.
- Companies stay isolated because `company_id` is part of the key.

What it does not do by itself:

- `clockInMember` still checks `findOpenClockRecord` before insert. Two overlapping requests can both pass that read. Only the unique key turns the second insert into a duplicate-key error.
- `isOpenShiftLockCollision` maps that error to "already clocked in" only when the MySQL error text includes `uq_fs_clock_records_open_shift`. A different unique-key name would not be recognized.
- The migration header says Manus Publish does not run SQL migrations. Shipping the application branch does not create this index.

Before any later, separately approved apply, this read-only preflight must return 0 rows. If it returns rows, stop. The migration does not delete, close, or rewrite shifts.

```sql
SELECT company_id, member_user_id, COUNT(*) AS open_count
FROM fs_clock_records
WHERE clock_out IS NULL AND member_user_id IS NOT NULL
GROUP BY company_id, member_user_id
HAVING COUNT(*) > 1;
```

Confirm presence later with a read-only `SHOW INDEX FROM fs_clock_records` and the generated-column definition. Do not run the `ALTER` as part of this verification.

## 3. End-to-end test — NOT VERIFIED

No isolated test company, employee, database, or physical phone was available. None of the checks below were run. Unit tests on a fake database are listed only so they are not mistaken for this test.

Use a company and employee that contain no live customer, payment, or payroll data. Use the JobSync host whose database identity has already been proven. Do not point the test at production customers.

### Clock in on Mobile, confirm on Web

1. Sign in on Mobile as the test employee. Confirm the session is a Company session.
2. Clock in once.
3. On Web, open Company Timesheets for the same company and the company-local week. The open row must show the same employee, the same clock-in time, and no clock-out.
4. `GET /api/mobile/v1/time/current` must report clocked in with `clockInAt` set.

### Clock out and compare timesheets

1. Clock out on Mobile.
2. Web Timesheets and Mobile Timesheets, for the same company week, must show the same clock-in, clock-out, hours, and approval status.
3. A technician sees only their own rows. An owner or dispatcher with no member filter sees the company rows for that week.

### Job created on Web appears on Mobile

1. On Web, create one job for the test company from the Price Book, assigned to the test employee, with a known start time and amount.
2. On Mobile, refresh Company jobs. The job id, customer, status, schedule, and amount must match Web.
3. Do not create that job through the legacy booking API.

### Booked and collected revenue

1. On Web, read `dashboard.summary` for Today and for This Week.
2. On Mobile, as an owner or dispatcher, read `GET /api/mobile/v1/dashboard/summary` for `period=day` and `period=week`.
3. Booked revenue and collected revenue must match Web for the same period. Completed job value and outstanding balance must match too.
4. Upsell and discount on Mobile must stay "not tracked as separate totals." A failed request must show Revenue unavailable, not `$0`.
5. Compare the two applications with each other. Do not compare either one with the old client-side job sum.

### Interrupted clock-in

1. Start Clock In and drop the network or abort the request before the response returns.
2. Do not tap Clock In again.
3. Restore the network. The phone must call `GET /api/mobile/v1/time/current` before it shows a result.
4. If the server has an open shift with `clockInAt`, the phone shows On shift with that server time.
5. If the server has no open shift, the phone stays on Clock In and shows an error.
6. If the follow-up read fails, the phone must not show On shift.
7. A second clock-in while the first request is still running must not be sent. A later clock-in against an open shift must return 409 and must not insert a second open row.

`lib/company-clock-reconcile.ts` and `tests/phase1-company-repairs.test.ts` cover the decision rules in process. They do not replace this interrupted request.

### GPS on a physical device

1. Use a technician account, clocked in, with the location disclosure accepted and foreground location permission granted.
2. Publish a point with `POST /api/mobile/v1/dispatch/location`.
3. On Web Fleet Map and Mobile Operations, the point is live only when `stale` is false and `recordedAt` is within 15 minutes.
4. A point older than 15 minutes, or a point with no timestamp, is listed as not live and is not drawn as a live van.
5. Clock out. Further publishes must be rejected until the technician clocks in again.
6. An owner or dispatcher session must not publish a location.
7. Background updates run only when background permission was already granted. The app must not prompt for background permission in this test.
8. This VM cannot run that device test.

`server/phase1.mobileRepairs.test.ts` rejects a publish with no open shift and marks a 20-minute-old point stale on a fake database. That is not a physical-device pass.

### Cross-company isolation

1. With Company A credentials, request dashboard, timesheets, jobs, and the dispatch board.
2. Repeat with Company B. No Company A customer, job, clock row, payment figure, or location may appear.
3. A Company A owner who passes Company B's `memberId` must get 404, not that member's rows.
4. A technician who passes any other `memberId` must get 403.
5. Company id must come from the bearer. A query parameter must not switch companies.

The fake-database dispatch test shows Company 22's board does not include Company 11's points. That is not this two-company test.

## 4. Luxury Wash host references — PASS

Classification is from source on the repair branches. Generated copies in `dist/index.js` and `legacy-static-export/` repeat the same source and are not a second system.

### Company functionality still pointing at the legacy host

These files still contain `https://luxwashapp-n2wveyqg.manus.space`. In a Company session they return before the legacy request, or they render an unavailable screen. They do not load legacy rows into the Company workspace. They are also not implemented on JobSync yet.

| Location | Legacy call | Company session |
| --- | --- | --- |
| `app/(tabs)/schedule.tsx` | Private notes, booking list, booking job, customer history, performance by date | Private notes render nothing. The other calls return when legacy job authority is off. Company jobs use JobSync. |
| `app/(tabs)/admin-schedule.tsx` | Private notes, booking job, customer history, `POST /api/invoice/send` | Notes render nothing. History and booking fetch return early. Invoice send tells the user Company invoice delivery is not published, and does not call the legacy URL. |
| `components/add-job-modal.tsx` | `GET /api/booking/detailers` | Company sessions load JobSync team members and return. The legacy roster fetch is the non-Company branch. |
| `app/(tabs)/admin-receptionist.tsx` | Twilio webhook text and configure call aimed at the Luxwash host | A Company session renders "Receptionist is not available in Home Service Connected yet" and does not send Company data. |
| `server/receptionistRouter.ts`, `server/invoiceRouter.ts` | Luxwash base URL on the Expo server | Legacy server only. JobSync does not proxy it. |

No Company-session feature in this review still reads Company business data from the legacy database. The features above are blocked or hidden, not switched over.

### Public customer functionality

| Location | Classification |
| --- | --- |
| Live `/invoice/:token` | `PublicInvoicePage` uses JobSync `publicRevenue`. It does not use the Luxwash host. |
| Live `/confirm/:token` | `PublicAppointmentPage`. It does not contain the Luxwash host. |
| Live `/track/:token` | `SourcePublicFlowPreview`. It does not contain the Luxwash host. |
| `client/src/pages/InvoicePage.tsx`, `ConfirmPage.tsx`, `TrackPage.tsx` | Unmounted leftovers. Each hardcodes the Luxwash API base. `FieldServiceApp` does not route them. |
| `client/src/lib/doorHangerPhotos.ts` | Unimported helper. Relative photo paths would be prefixed with the Luxwash host. Nothing in `client/src` calls it. |
| `client/src/pages/EstimatePublicPage.tsx` | Unmounted page with Luxury Wash brand contact text. The routed estimate page is `PublicEstimatePage`. |
| `wordpress-booking-integration/` | Public booking webhook and availability for Luxury Wash location slugs, aimed at the Luxwash host. |
| `docs/abandoned-cart-resume-snippet.js` | Public resume snippet aimed at `https://www.luxurywashonwheels.app/api`. |

### Intentionally separate integration

The Expo server and its scripts still brand password reset, email, phone, and appointment links with `luxurywashonwheels.app`, and some scripts default to the Luxwash API. That server has its own schema and is the legacy employee product. `resolveJobSyncBaseUrl` rejects the Luxwash host and falls back to `www.homeserviceconnected.com`. Tests still require the `APP_API_BASE` constant to remain in `schedule.tsx`, so those constants were not deleted.

Legacy employee mode, with no Company session, still depends on that Expo server for schedule, notes, bookings, history, performance, invoices, and receptionist. That is the separate product, not the Company workspace.

## 5. Dashboard and timesheet permissions — NOT VERIFIED

The live role matrix and a second company were not available, so this item is not a pass. The unreleased handlers do contain server-side gates. Production does not yet run the new dashboard route.

Unreleased `GET /api/mobile/v1/dashboard/summary` in `server/mobileOperations.ts`:

- `requireMobileCompany` requires a bearer, requires `accountType` `company`, and loads `company_users` joined to `companies` where `cu.id`, `cu.company_id`, `cu.is_active = 1`, and `c.workspace_status = 'active'`.
- The company id comes from the token. The handler does not read a company id from the query.
- The role used for the check is the live `company_users.role`, not the role frozen in the token.
- Owner and dispatcher continue. Any other role receives 403 `Company revenue is available to owners and dispatchers.` before `dashboard.summary` runs.
- The tRPC caller then runs `tenantProcedure`, which requires a session, blocks technicians, calls `assertCompanyUser`, and requires the live role to match the session role.

Unreleased `GET /api/mobile/v1/time/timesheets`:

- Same `requireMobileCompany` gate. Every query includes `company_id = ?` from the token.
- `timesheetMemberScope`: a technician is always their own id; a technician who passes `memberId` gets 403. An owner or dispatcher with no `memberId` sees the company. An owner or dispatcher who passes another `memberId` must find an active `company_users` row in that same company, or the handler returns 404.

`server/phase1.mobileRepairs.test.ts` asserts the technician, owner, and dispatcher scope decisions as pure functions. It does not perform an HTTP call with two real companies.

Production, both hosts, 2026-10-18 00:24 UTC:

- `GET /api/mobile/v1/dashboard/summary` with no token, and with `Authorization: Bearer invalid`, returns 404 `Unknown mobile API endpoint.` The new route is not deployed. A 404 is not an authorization pass.
- `GET /api/mobile/v1/time/timesheets` with no token returns 401 `Bearer token required.`
- The same path with `Authorization: Bearer invalid` returns 400 `A valid mobile API request is required.` and no rows. `jwtVerify` failures are not `MobileAuthError`, so `operationalError` uses that generic 400. The response does not include timesheet records. This is the deployed route, not proof of the new team scope.

## 6. Existing Web logic unchanged — PASS

JobSync `origin/main...HEAD` before this verification document is commit `bd6c211`. The diff is eight files:

- `client/src/pages/FieldServiceApp.tsx`
- `server/dispatchService.ts`
- `server/mobileClockDate.ts`
- `server/mobileCompanyDashboard.ts`
- `server/mobileOperations.ts`
- `server/mobileTimesheetRange.ts`
- `server/phase1.mobileRepairs.test.ts`
- `vitest.config.ts`

Counts in that diff: `paymentService` 0, `financeService` 0, `customerService` 0, `fs_customers` 0, `stripe` 0, `payroll` 0, `createPayrollPeriod` 0, `CREATE TABLE` 0, `ALTER TABLE` 0.

`fieldServiceRouter.ts` was not edited, so the dashboard SQL, timesheet SQL, and payroll period SQL are the same text as `origin/main`. `paymentService.ts`, `financeService.ts`, and `customerService.ts` were not edited.

The only Web UI change is Fleet Map freshness. Live markers require `stale !== true`, a `recordedAt` timestamp, and an age of 15 minutes or less. Older points are listed as not live. `LegacyPaymentsPage` appears in the diff only as the following function in the same file. Its payment behavior was not edited.

The mobile repair diff does not change the Expo server's payment, payroll, or customer routers. Company Operations Overview no longer sums job rows on the client. The legacy employee dashboard path remains for sessions that are not Company sessions.

This pass is a source-diff result. Production payment, payroll, and customer jobs were not replayed.

## Release checklist

Do not start until production approval is explicit.

1. Prove database identity for `www.homeserviceconnected.com` and `jobwash-veysiubh.manus.space` with a read-only fingerprint or the deployment `DATABASE_URL` binding. Record hostname and schema name only.
2. Leave the EAS production JobSync URL unchanged until step 1 passes. It is currently `https://jobwash-veysiubh.manus.space`.
3. Read-only `SHOW INDEX FROM fs_clock_records` and the generated column `open_shift_lock_key`.
4. If the unique key is missing, run the preflight duplicate query. Zero rows is required before any later `ALTER`. If rows exist, stop. Do not close or delete shifts from this checklist.
5. Create an isolated test company and employee. Run every procedure in section 3, including a physical device for GPS.
6. Deploy the JobSync API before any mobile build that calls `GET /api/mobile/v1/dashboard/summary`. Production currently returns 404 for that path. A mobile build shipped first will show Revenue unavailable.
7. Confirm Web dashboard booked and collected figures match Mobile for the test company, for day and week.
8. Confirm a technician receives 403 on the dashboard route and cannot read another member's timesheet. Confirm Company B's token cannot read Company A's rows.
9. Do not change payment code, payroll calculation, customer records, or the dashboard SQL in the same release.
10. Leave Luxwash constants in place until private notes, receptionist, Company invoice delivery, customer history, and legacy performance have their own JobSync contracts and tests.
11. After deploy, repeat the anonymous probes: dashboard route must no longer be 404, and timesheets without a bearer must stay 401.

## Rollback

No production migration has been applied, so there is no database rollback in this release.

- JobSync application: revert `bd6c211` and the verification commit on `cursor/hsc-phase1-repairs-3e4f`. Fleet Map returns to drawing every reported location. The mobile dashboard route disappears again.
- Mobile application: revert `7843659` and the verification commit on `cursor/hsc-phase1-repairs-3e4f`. Do not change the EAS production URL as part of rollback.
- If a mobile build is already in users' hands and the API route is reverted, Operations Overview shows Revenue unavailable and Retry. It does not show `$0` for a failed request. Roll back that mobile build or restore the API route.
- If a future approved change adds `uq_fs_clock_records_open_shift`, rollback is dropping that unique key and the generated column. That drop must not delete `fs_clock_records` rows. Do not run it now.
- Do not roll back by editing payment, payroll, or customer tables.

## Remaining blockers

1. The two public JobSync hosts are not proven to use one database.
2. Production presence of `uq_fs_clock_records_open_shift` is unknown. Without it, overlapping clock-ins can insert two open shifts.
3. The isolated Mobile and Web test, the interrupted clock-in against a real server, and physical-device GPS were not run.
4. Live owner, dispatcher, technician, and cross-company requests against the new routes were not run.
5. `GET /api/mobile/v1/dashboard/summary` is not on production. That is expected before approval. It is a blocker for shipping the mobile dashboard.
6. Company private notes, receptionist, invoice delivery from the admin schedule, customer history, and daily performance have no JobSync replacement. They are hidden or blocked in Company mode.
7. Payroll still sums scheduled job times. It was left unchanged on purpose and is not part of this release.
8. Explicit production approval has not been given.

Stop here. Do not deploy.
