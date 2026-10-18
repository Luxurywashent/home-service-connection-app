# HSC Phase 1 Mobile source reconciliation

Checked 2026-10-18. No deploy, merge, migration, or production data change was made. The open-shift index evidence stands: `uq_fs_clock_records_open_shift` exists and the duplicate-open preflight returned zero groups.

## Conclusion

The Mobile repairs are already implemented. They are not in JobSync PR #55. They are in a separate repository and branch. `/home/ubuntu/mobile-hsc` is not present on this machine, so Manus's workspace bytes could not be diffed here. `origin/main` of the Mobile repository has no calls to the three new endpoints. A Mobile workspace taken from `main`, or from any tree other than the repair branch below, will not consume them.

## 1. Mobile source that contains the repairs

| | |
| --- | --- |
| Repository | `https://github.com/Luxurywashent/home-service-connection-app` |
| Branch | `cursor/hsc-phase1-repairs-3e4f` |
| Code SHA | `7843659652fa3a0d72b3ed1e1ed1ffac317fc6fe` |
| Last application SHA | `6bdf54183cc4cd2181863a32103d3523b98fb753` |

`7843659` is the commit that adds the dashboard, timesheet, clock reconcile, and GPS client. `6bdf541` is the last commit that still has the same application files. Commits after `7843659` are documentation only. `git diff 7843659 6bdf541` changes four markdown files and no application code. The working tree has no uncommitted application edits.

JobSync PR #55 is `https://github.com/Luxurywashent/jobsync`, branch `cursor/hsc-phase1-repairs-3e4f`, tip `f7fdab14ac5e609c3dd5525b3b7b5b3aa0ab6299`. That pull request is the API. It does not contain the Expo app.

## 2. Comparison with `/home/ubuntu/mobile-hsc`

The path does not exist on this machine. There is no other Mobile git checkout besides `/agent/repos/home-service-connection-app`. Manus's finding matches a workspace that does not have commit `7843659`. `origin/main` (`2ee34d40f593d08e979bbe8dffd94cfb85ced364`) contains zero matches for `dashboard/summary` or `dispatch/location`.

## 3. Endpoint calls in the repair SHA

All three are constants in `lib/jobsync-mobile-api.ts` and are used by the Company screens:

- `GET /api/mobile/v1/dashboard/summary` — `getJobSyncCompanyDashboardSummary`, called from `app/(tabs)/admin-dashboard.tsx` when a Company session exists.
- `GET /api/mobile/v1/time/timesheets` — `getHomeServiceConnectedTimesheetPage` from `components/company-timesheet-panel.tsx`, and `getHomeServiceConnectedTimesheets` from `app/(tabs)/index.tsx` with `today` or `weekOffset`.
- `POST /api/mobile/v1/dispatch/location` — `publishJobSyncCompanyLocation` from `components/company-location-publisher.tsx`.

## 4. Missing, uncommitted, or separate

The repairs are committed and pushed on the Mobile branch. They are absent from Mobile `main`. They are absent from the JobSync repository. They are not sitting in an uncommitted worktree.

## 5. JobSync is the Company authority for these features

Company dashboard, clock, timesheets, and location publish use the JobSync bearer and `/api/mobile/v1`. Legacy tRPC queries on the Operations Overview are disabled when `jobSyncSession` is set. Clock-in for a Company session uses `clockInHomeServiceConnected` and then `reconcileClockAction` against `GET /api/mobile/v1/time/current`. The request timeout is `COMPANY_TIME_REQUEST_TIMEOUT_MS` (20 seconds).

## 6. Revenue screen

For a Company session, Operations Overview renders `companySummary.bookedRevenue` and `companySummary.collected` from `dashboard/summary`. A failed load shows "Revenue unavailable" and Retry. Upsell and discount copy says they are not tracked as separate totals. The client sum of `totalPrice + upsellTotal - discount` remains only in the `else` branch, and `dashboardJobs` is left undefined when a Company session exists, so that formula is not used for Company revenue.

The separate Finance tab still calls `GET /api/mobile/v1/finance` through `CompanyFinancePanel`. That screen was not part of this repair. It is a JobSync endpoint, not the Luxwash host, and it is not the Operations Overview calculation.

## 7. Clock, timesheets, and GPS contracts

- Clock: `POST /api/mobile/v1/time/clock-in` and `clock-out`, then `GET /api/mobile/v1/time/current`, with one in-flight action and no automatic retry.
- Timesheets: company week via `weekOffset`, approval fields, and manager team scope through the timesheet page helper.
- GPS: publish only under the Company location policy, to `POST /api/mobile/v1/dispatch/location`. The Operations map reads `GET /api/mobile/v1/dispatch/board` and hides stale points.

## 8. Checks run

- `pnpm exec tsc --noEmit` — exit 0.
- `tests/phase1-company-repairs.test.ts` — 5 passed.
- `tests/m2-company-timekeeping.test.ts` — 15 passed.
- `tests/m1-company-authority.test.ts` — 10 passed.
- `tests/jobsync-mobile-api.test.ts` — 28 passed.

58 tests passed. No new test records were created.

## 9. What Manus must receive

Check out branch `cursor/hsc-phase1-repairs-3e4f`. The application files below are the tree at `6bdf54183cc4cd2181863a32103d3523b98fb753`. Do not copy `main`.

Application and test files that differ from `origin/main` and must be in the Mobile workspace:

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
- `tests/phase1-company-repairs.test.ts`

Documentation on the same SHA is optional for runtime and included in the commit: `docs/HSC_PHASE1_REPAIR_REPORT.md`, `docs/HSC_PHASE1_PREPRODUCTION_VERIFICATION.md`, `docs/HSC_PHASE1_BLOCKER_RESOLUTION.md`, `docs/HSC_PHASE2_LEGACY_MIGRATION_PLAN.md`, and this file.

## 10. Coordinated release plan

Do not deploy until there is an explicit approval.

1. Point the Manus Mobile workspace at `6bdf54183cc4cd2181863a32103d3523b98fb753` and confirm the three endpoint strings exist before another Mobile review.
2. Keep JobSync PR #55 unmerged until that same approval. Its API tip is `f7fdab14ac5e609c3dd5525b3b7b5b3aa0ab6299`.
3. Publish the JobSync API before any Mobile build that calls `GET /api/mobile/v1/dashboard/summary`. Production currently returns 404 for that path. A Mobile build shipped first shows Revenue unavailable.
4. Do not run a migration. The open-shift unique index is already present, and the duplicate-open preflight returned zero groups.
5. Leave the EAS production JobSync URL unchanged.
6. After approval, publish the API, then build Mobile from branch `cursor/hsc-phase1-repairs-3e4f` at or after `6bdf541`. Confirm `dashboard/summary` is no longer 404 before considering the Mobile rollout complete.

Waiting for approval.
