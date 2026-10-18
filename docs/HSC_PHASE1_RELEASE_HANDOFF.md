# HSC Phase 1 release handoff

Prepared 2026-10-18 for Manus. This document is the checkout and release record. Do not merge JobSync PR #55. Do not deploy Web or Mobile. Do not modify production data. Do not run database migrations. Do not create another environment. Wait for explicit production approval.

Earlier notes named Mobile application tree `6bdf54183cc4cd2181863a32103d3523b98fb753`. That SHA is still the same application code. The SHA to check out now is below, because the Company customer tests were updated after it.

## Exact commits

| Role | SHA |
| --- | --- |
| Backend runtime code | `bd6c211a6ba02a2155c7fda46529071dca1e519e` |
| Backend commit that adds the isolated authorization tests | `f7fdab14ac5e609c3dd5525b3b7b5b3aa0ab6299` |
| Backend branch tip before this handoff file | `611ffefc79b41b5724d73964854736bcc53609c9` |
| Mobile application code | `7843659652fa3a0d72b3ed1e1ed1ffac317fc6fe` |
| Mobile commit to build, including the customer test fix | `34c93f677223a118f827f43b114f3a20320f60c2` |

`git diff bd6c211a6ba02a2155c7fda46529071dca1e519e f7fdab14ac5e609c3dd5525b3b7b5b3aa0ab6299` is documentation, `server/phase1.mobileAuthz.isolation.test.ts`, and `vitest.config.ts`. `git diff f7fdab14ac5e609c3dd5525b3b7b5b3aa0ab6299 611ffefc79b41b5724d73964854736bcc53609c9` is `docs/HSC_PHASE1_MOBILE_SOURCE_RECONCILIATION.md` only.

`git diff 7843659652fa3a0d72b3ed1e1ed1ffac317fc6fe 34c93f677223a118f827f43b114f3a20320f60c2 -- ':!docs'` is `tests/m3a-company-financial-containment.test.ts` only.

The commit that adds this file is documentation only. Publish and build the SHAs in the table. A later documentation commit on the same branch does not change the server bundle or the Mobile application code.

Repositories and branches:

- Backend: `https://github.com/Luxurywashent/jobsync`, branch `cursor/hsc-phase1-repairs-3e4f`, draft PR #55 against `main`.
- Mobile: `https://github.com/Luxurywashent/home-service-connection-app`, branch `cursor/hsc-phase1-repairs-3e4f`, draft PR #23 against `main`.

Mobile `main` at `2ee34d40f593d08e979bbe8dffd94cfb85ced364` has no `dashboard/summary` or `dispatch/location` calls. `/home/ubuntu/mobile-hsc` is not present on this machine.

## Customer tests

The Company customer implementation is already correct. Company sessions go through `CompanyFinancialGate`. When the mounted screen is `company` and a session token exists, the gate renders `CompanyCustomersPanel`, which calls `getJobSyncCompanyCustomers` (`GET /api/mobile/v1/customers`).

`app/(tabs)/admin-customers.tsx` does not call `trpc.customers.listAll`. The function named `LegacyAdminCustomersScreen` also calls `getJobSyncCompanyCustomers` and returns when there is no session token. That screen behavior is on `main` in `1bd7f529daca5b59f43455e3bca8a6ab72465bfe`. The m3a assertions were still expecting `trpc.customers.listAll` from `223b7302bb41b06b6fe4d68ba473c35a58affd1c`. Those two assertions were updated. The legacy customer call was not restored.

`app/(sales)/customers.tsx` still has `trpc.customers.listAll` inside `LegacySalesCustomersScreen`. The same gate does not mount that function for a Company session.

## Changed files

### JobSync versus `origin/main` at `611ffefc79b41b5724d73964854736bcc53609c9`

- `client/src/pages/FieldServiceApp.tsx`
- `server/dispatchService.ts`
- `server/mobileClockDate.ts`
- `server/mobileCompanyDashboard.ts`
- `server/mobileOperations.ts`
- `server/mobileTimesheetRange.ts`
- `server/phase1.mobileAuthz.isolation.test.ts`
- `server/phase1.mobileRepairs.test.ts`
- `vitest.config.ts`
- `docs/HSC_PHASE1_BLOCKER_RESOLUTION.md`
- `docs/HSC_PHASE1_MOBILE_SOURCE_RECONCILIATION.md`
- `docs/HSC_PHASE1_PREPRODUCTION_VERIFICATION.md`
- `docs/HSC_PHASE2_LEGACY_MIGRATION_PLAN.md`

This handoff adds `docs/HSC_PHASE1_RELEASE_HANDOFF.md` after that tip.

No `eas.json`, `.env`, payment file, payroll file, or `.sql` migration is in the JobSync diff. `docs/HSC_PHASE2_LEGACY_MIGRATION_PLAN.md` is a written plan. `createPayrollPeriod` is unchanged. The code diff contains no `DATABASE_URL` change.

### Mobile versus `origin/main` at `34c93f677223a118f827f43b114f3a20320f60c2`

- `app/(tabs)/admin-dashboard.tsx`
- `app/(tabs)/index.tsx`
- `components/company-clock-status.tsx`
- `components/company-location-publisher.tsx`
- `components/company-timesheet-panel.tsx`
- `components/header-clock-status.tsx`
- `lib/company-clock-reconcile.ts`
- `lib/company-location-policy.ts`
- `lib/jobsync-mobile-api.ts`
- `tests/m2-company-timekeeping.test.ts`
- `tests/m3a-company-financial-containment.test.ts`
- `tests/phase1-company-repairs.test.ts`
- `docs/HSC_PHASE1_BLOCKER_RESOLUTION.md`
- `docs/HSC_PHASE1_MOBILE_SOURCE_RECONCILIATION.md`
- `docs/HSC_PHASE1_PREPRODUCTION_VERIFICATION.md`
- `docs/HSC_PHASE1_REPAIR_REPORT.md`
- `docs/HSC_PHASE2_LEGACY_MIGRATION_PLAN.md`

This handoff adds `docs/HSC_PHASE1_RELEASE_HANDOFF.md` after that tip.

No `eas.json`, `app.json`, `.env`, or `.sql` migration is in the Mobile diff. `package.json` and the lockfile are unchanged versus `main`.

`migrations/20261003_fs_clock_records_open_shift_lock.sql` exists in JobSync history and is not part of either branch diff. It was not applied by this work. The production index `uq_fs_clock_records_open_shift` is already present, and the duplicate-open preflight returned zero groups.

## Test and build results

### JobSync GitHub check — PASS

Check: `Company contracts, type check, and build`.
Run: `39085129135`.
Head: `611ffefc79b41b5724d73964854736bcc53609c9`.
Completed: 2026-10-18T01:07:24Z.
Result: 67 test files passed, 1068 tests passed, 49 skipped. Server build completed (`dist/index.js`).

The handoff commit does not change server or client code. After it was pushed, run `39086181095` on `8ba849e2eab174cfc46e799b28ee4e4a7ba1ab09` also passed: 67 files, 1068 tests passed, 49 skipped, and the server build completed.

### Mobile local suite — PASS

Command: `pnpm exec vitest run` in `home-service-connection-app`.
Started: 2026-10-18T01:18:03Z. Duration: 4.44s.
Result: 30 test files passed, 1 skipped (`tests/auth.logout.test.ts`, `describe.skip`). 405 tests passed, 1 skipped.
`pnpm exec tsc --noEmit` exited 0 after the customer assertion edit.

Import noise from the skipped `auth.logout` file (OAuth and mysql2, because `DATABASE_URL` is unset in this shell) is not a failing test.

### Mobile GitHub check — FAIL

Check: `SDK, TypeScript, Company contracts, and iOS bundle`.
Run: `39085128569`.
Head: `d7e9ce2f1418838369473dbe29451ae5a69de0ed`.
Completed: 2026-10-18T01:04:48Z.
Failed step: `npx expo install --check`, exit code 1, before vitest and before `pnpm check`.

Reported drift:

- `@expo/metro-runtime@57.0.16` expected `~57.0.17`
- `expo@57.0.27` expected `~57.0.30`
- `expo-asset@57.0.19` expected `~57.0.20`
- `expo-constants@57.0.21` expected `~57.0.22`
- `expo-linking@57.0.12` expected `~57.0.13`
- `expo-location@57.0.20` expected `~57.0.21`
- `expo-notifications@57.0.22` expected `~57.0.23`
- `expo-router@57.0.25` expected `~57.0.28`
- `expo-splash-screen@57.0.9` expected `~57.0.10`

This branch does not change those package versions. The same `Verify Expo SDK alignment` step failed on `7843659`, `bac1ecf`, `6bdf541`, and `d7e9ce2`. The last successful run of this workflow was `fix/asc-app-id-submit` at `d0b291a66e842bf66d9a431031d43692f6bcd771` on 2026-10-11. Expo packages were not bumped in this task. Run `39086180818` on Mobile tip `e6e2faf9beeba9d235974b1b4f799c9c6b570eaf` failed at the same step, with the same nine packages.

## Deployment order

Do not perform these steps until production approval is explicit.

1. Publish the JobSync API from branch `cursor/hsc-phase1-repairs-3e4f` at `611ffefc79b41b5724d73964854736bcc53609c9` or a later documentation-only commit. Runtime code is `bd6c211a6ba02a2155c7fda46529071dca1e519e`.
2. Confirm `GET /api/mobile/v1/dashboard/summary` is no longer 404 on the host Mobile will call. A missing bearer should be 401. A 404 means the previous API is still published.
3. Build Mobile from `34c93f677223a118f827f43b114f3a20320f60c2` or a later documentation-only commit. Do not build Mobile `main`.
4. Leave EAS `EXPO_PUBLIC_JOBSYNC_API_BASE_URL` at `https://jobwash-veysiubh.manus.space`.
5. Do not run the open-shift migration. Do not change payment, payroll, or customer SQL.

Production `GET /api/mobile/v1/dashboard/summary` returned 404 `Unknown mobile API endpoint` on both `www.homeserviceconnected.com` and `jobwash-veysiubh.manus.space` on 2026-10-18, before this API is published. Publishing Mobile first leaves Operations Overview on "Revenue unavailable".

## Rollback

No database rollback is required. This work did not apply a migration and did not write production rows.

- JobSync: revert `bd6c211a6ba02a2155c7fda46529071dca1e519e` and every commit after it on this branch, then publish the previous API build. Closing PR #55 without publishing it leaves production on the current API.
- Mobile: revert `7843659652fa3a0d72b3ed1e1ed1ffac317fc6fe` and every commit after it, including `34c93f677223a118f827f43b114f3a20320f60c2`. Do not change the EAS production URL as the rollback.
- If the new API is removed while a Mobile build from this branch is installed, `dashboard/summary` returns 404 and Operations Overview shows "Revenue unavailable". Roll the Mobile build back in the same window.

## Remaining release blockers

- Explicit production approval has not been given. PR #55 stays unmerged.
- Whether `www.homeserviceconnected.com` and `jobwash-veysiubh.manus.space` use the same database is NOT VERIFIED. Matching public health JSON is not that proof. `DATABASE_URL` was not readable here.
- The GitHub Mobile check is FAIL on Expo patch drift, as recorded above. Local TypeScript and the full vitest suite passed.
- An isolated live Web-to-Mobile pass, including physical GPS, was not run.
- `dashboard/summary` stays 404 in production until the API is published.
- Phase 2 is still open: Company notes, receptionist, invoice send, customer history, and employee performance. The plan is in `docs/HSC_PHASE2_LEGACY_MIGRATION_PLAN.md`. Those legacy calls were not removed.
- `createPayrollPeriod` still sums scheduled job times, not clock hours. That was left unchanged on purpose.
- The Company Finance tab still calls `GET /api/mobile/v1/finance`. It was not part of this repair.

The open-shift index is not a blocker. `uq_fs_clock_records_open_shift` exists, and the duplicate-open preflight returned zero groups.
