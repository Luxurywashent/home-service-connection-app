# HSC code fixes: implementation and acceptance gates

Code work is implemented in both existing repositories, with **29 explicit dispositions** below. This is a development handoff, not a claim that 29 defects are closed or that the live product changed. **Launch remains NOT READY.**

Historical QA is unchanged: **197 groups; 123 PASS, 34 FAIL, 40 BLOCKED, 0 NOT TESTED**. No original checklist, retained fixture or evidence was overwritten. IDs are preserved exactly; there is no DEF-012 in this approved set.

## Branches and source evidence

Both repositories use `fix/hsc-29-defects-20261023`, stacked on the existing `fix/shared-mobile-profile-issues` work. The original pending branches/PRs were not overwritten, closed, merged or superseded.

| Repository | Runtime source validated | Preserved base | Draft PR |
|---|---|---|---|
| `Luxurywashent/jobsync` | `a3a65938535a4bcb903d82ea13521d94ec03dd5c` | `4d135f0e930c0d2ea587e728519630da48bf9bcb` | [58](https://github.com/Luxurywashent/jobsync/pull/58) — draft, unmerged |
| `Luxurywashent/home-service-connection-app` | `b6c0fd2986da26bf9cce7e7d935b24614dea295f` | `cb14e25cc3d55c75b96a7ac0b8ac9485f325eb1c` | [26](https://github.com/Luxurywashent/home-service-connection-app/pull/26) — draft, unmerged |

These source references, branch/PR references, safety boundaries and exact target context apply to **every entry** below; the listed paths identify the defect-specific changes or preserved provenance. The final runtime hashes may normalize only unpublished agent author metadata; authorship-commit-map.json records the original tested hashes and proves identical source-tree IDs. Documentation-only commits may follow without altering tested code.

## Actual validation

All new QA cases use synthetic in-memory Company fixtures, mocked transport, pure functions or explicitly identified source-contract assertions. Existing payment/reconciliation tests use fake providers and synthetic records; they do not move money or send messages. Live/real-DB opt-ins were not enabled. The default app suite now keeps public external weather/geocoding checks opt-in as well.

Commands: `pnpm exec vitest run --maxWorkers=2 --minWorkers=1`; `pnpm check`; backend `pnpm build`; app `pnpm lint --no-cache`, local esbuild server compile and `EXPO_OFFLINE=1 pnpm exec expo export --platform ios|android|web`. The exact runner and complete logs are supplied in the evidence bundle. Platform export is local bundling, **not** a signed application/device build, store submission or deployment.

Lint is not warning-free: the app reports 319 warnings and 0 errors. Backend bundling reports chunk-size warnings. These warnings are not counted as acceptance passes.

GitHub-hosted CI status is not verified: the integration cannot read statusCheckRollup. Only the actual local command results below are claimed.

### Backend
| Validation | Exit code | Evidence log |
|---|---:|---|
| tests | 0 | `backend-tests.log` |
| typecheck | 0 | `backend-typecheck.log` |
| build | 0 | `backend-build.log` |

### Native app
| Validation | Exit code | Evidence log |
|---|---:|---|
| tests | 0 | `app-tests.log` |
| typecheck | 0 | `app-typecheck.log` |
| lint | 0 | `app-lint.log` |
| server-build | 0 | `app-server-build.log` |
| ios-export | 0 | `app-ios-export.log` |
| android-export | 0 | `app-android-export.log` |
| web-export | 0 | `app-web-export.log` |

Backend: Test Files  81 passed (81); Tests  1153 passed | 49 skipped (1202).

App: Test Files  43 passed (43); Tests  453 passed (453).

**Focused integrated QA:** `server/hscQa*.test.ts` — **11 files, 50 tests passed**, including eight service-edit cases. Some checks are source contracts, as called out per defect; none substitutes for the missing authorized UI acceptance.

Initial integration failures were retained in earlier logs, then repaired rather than hidden/skipped: the synthetic SQL adapters needed the new actor query, explicit workday-clearing argument, financial columns and literal service quantities; old import/count assertions needed to allow the bounded recurrence insertion while retaining centralized-service guarantees.

## Authorized target and acceptance limit

Existing target: `https://www.homeserviceconnected.com/`, **HSC Beta QA Test Workspace**, the existing authorized synthetic Company Admin account, America/Chicago. Public form target: `https://www.homeserviceconnected.com/book/hsc-beta-qa-test-workspace-7b9d7c`. **Deployed/build revision: unknown/not supplied.** This task did not merge or deploy these branches and did not perform a new browser/device UI retest. It therefore cannot establish that the target contains these commits or satisfy fix-version closure. This is a provenance/availability gate, not a requirement to create a separate non-production site and not a ban on already-authorized own-account UI testing.

For every entry, disposition is **partially fixed — source remediation or existing-fix regression evidence is available, authorized-target acceptance remains open**. Where the reported fault is not reproduced in current source, that is stated explicitly rather than declared resolved. Original failed and blocked QA statuses remain untouched.

## The 29 dispositions

### HSC-DEF-001 — Chicago conversion times

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** The pending source already uses Company wall-time conversion; the reported deployed five-hour error is not reproducible in this source. This is provenance, not evidence that the live defect disappeared.

**Change:** Preserved companyLocalWallTimeToIso and regression-locked 09:00 and 14:00 Chicago round trips; the native canonical calendar mapping is covered too.

**Affected paths:** `client/src/components/source-ui/CreateJobDialog.tsx`; `shared/companyScheduleTime.ts`; `server/hscQaScheduling.test.ts`; `app: tests/hsc-scheduling-regression.test.ts`.

**Tests/evidence:** hscQaScheduling: two time conversions plus source wiring; estimateService and companyScheduleTime existing suites; native canonical schedule regressions. Not an actual UI save/reload. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/estimates`. Revision **unknown/not supplied**.

**Retest / expected result:** Convert two bounded accepted synthetic estimates at distinct Chicago times; save and hard reload All Jobs, detail and calendar; both original local dates/times must remain exact.

**Original checklist:** `JOB-002`. **Retained evidence:** /workspace/hsc-qa/live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-002 — All Jobs amount

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Current mounted Jobs.tsx already uses the canonical amount through formatBookedDetailPrice. Review did not establish saved-value corruption or reproduce zero against this source.

**Change:** Preserved canonical mapping and added an executable positive $159.90 display projection regression.

**Affected paths:** `client/src/pages/Jobs.tsx`; `client/src/lib/jobPrice.ts`; `server/fieldServiceRouter.ts`; `server/hscQaFinanceProjection.test.ts`.

**Tests/evidence:** hscQaFinanceProjection verifies canonical positive amount mapping; existing Job financial-consistency suites cover list/detail/API projections. No normal-UI amount reconciliation performed. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/jobs`. Revision **unknown/not supplied**.

**Retest / expected result:** For a known positive converted synthetic job, reload All Jobs, detail and linked invoice and compare documented amount/meaning.

**Original checklist:** `JOB-003`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-003 — Payments All and Completed

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** The mounted Payments screen filtered status after a paginated All result and used truthy fallbacks that could replace an explicit canonical zero balance.

**Change:** Moved status filtering into the existing tenant-scoped unpaid query before pagination; use balance_due including zero and sum displayed canonical balances.

**Affected paths:** `client/src/pages/Payments.tsx`; `client/src/lib/financeProjection.ts`; `server/fieldServiceRouter.ts`; `server/paymentService.ts`; `server/hscQaFinanceProjection.test.ts`.

**Tests/evidence:** hscQaFinanceProjection executes Company-bounded Completed-before-pagination and balance projection cases; full existing financial tests retain independent tenant checks. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/payments`. Revision **unknown/not supplied**.

**Retest / expected result:** Keep synthetic work unpaid without collection; All and Completed must show applicable records/balances consistently with invoices/customer/dashboard after reload.

**Original checklist:** `PAY-001`, `PAY-002`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-004 — Durable normal-job discount

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Normal-job client discount preview was not a durable server financial breakdown.

**Change:** Submit the fixed discount, recompute subtotal/discount/net server-side, clamp the discount, and persist all three. Recurring copies retain the same financial metadata.

**Affected paths:** `client/src/components/source-ui/CreateJobDialog.tsx`; `shared/jobPricing.ts`; `server/jobService.ts`; `server/fieldServiceRouter.ts`; `migrations/20261023_hsc_finance_job_discount.sql`; `server/hscQaFinance.test.ts`.

**Tests/evidence:** hscQaFinance executes a synthetic persisted fixed-discount case. Migration file is proposed only, not database-applied. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/schedule`. Revision **unknown/not supplied**.

**Retest / expected result:** Save a bounded normal synthetic job with visible discount; reload subtotal, discount and total and reconcile the accepted calculation.

**Original checklist:** `SCHED-007`. **Retained evidence:** /workspace/hsc-qa/evidence/screenshot-kkCWOu--job-480002-discount-lost.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-005 — Assets crash

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Finance projections could expose a Date object as a React child.

**Change:** Serialize finance business dates in the service and render strings in Assets.

**Affected paths:** `server/financeService.ts`; `client/src/pages/Finance.tsx`; `server/hscQaFinance.test.ts`.

**Tests/evidence:** hscQaFinance executes SQL DATE/string/Date mapping assertions; it does not exercise the actual asset-management screen. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/finance`. Revision **unknown/not supplied**.

**Retest / expected result:** Save a bounded synthetic asset, reload, reopen Assets and exercise its safe management controls without a render crash.

**Original checklist:** `FIN-007`, `FIN-012`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-006 — Public booking load

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Pending source already removed the invalid companies.phone query and raw public errors. A further readback bug discarded JSON objects returned directly by the SQL driver.

**Change:** Preserved the schema/error correction and accept either decoded object or serialized object settings; reject arrays/primitives. Form-load tests execute SELECTs only.

**Affected paths:** `server/publicBookingService.ts`; `client/src/pages/PublicBookingPage.tsx`; `server/hscQaBooking.test.ts`; `server/publicBookingArea.test.ts`.

**Tests/evidence:** hscQaBooking covers configured and disabled settings, unknown slug, isolated Company catalog and safe errors; publicBookingArea is also executed. No booking/contact submission. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/book/hsc-beta-qa-test-workspace-7b9d7c`. Revision **unknown/not supplied**.

**Retest / expected result:** Read https://www.homeserviceconnected.com/book/hsc-beta-qa-test-workspace-7b9d7c in the existing synthetic Company context; a form or plain owner configuration state must load, never internal schema text.

**Original checklist:** `BOOK-001`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-007 — Phone validation

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Customer schemas accepted arbitrary alphabetic phone text.

**Change:** Reject non-phone values in client and authoritative server validation; retain documented common phone formats and a nearby correction message.

**Affected paths:** `server/customerService.ts`; `server/fieldServiceRouter.ts`; `client/src/pages/SourceCustomersPage.tsx`; `server/hscQaCustomers.test.ts`.

**Tests/evidence:** hscQaCustomers executes alphabetic rejection and normal format acceptance; customerService suite remains included. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/customers`. Revision **unknown/not supplied**.

**Retest / expected result:** With email blank, reject alphabetic-only phone in the normal UI with an associated message; accept documented normal formats.

**Original checklist:** `CUST-005`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-008 — Readable validation errors

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Server rejection existed but some active forms exposed raw validation details or gave insufficient correction guidance.

**Change:** Added shared concise feedback and wired Global Customer, Finance and both mounted estimate-entry paths without relaxing server email/positive amount/positive quantity schemas.

**Affected paths:** `client/src/lib/formValidation.ts`; `client/src/pages/SourceCustomersPage.tsx`; `client/src/pages/Finance.tsx`; `client/src/pages/FieldServiceApp.tsx`; `client/src/components/source-ui/CreateEstimateDialog.tsx`; `client/src/components/CreateEstimateDialog.tsx`; `server/hscQaValidation.test.ts`.

**Tests/evidence:** hscQaValidation executes valid/invalid feedback helpers plus authenticated synthetic tRPC rejection before customer/expense/estimate inserts. Field-associated rendering still needs UI verification. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/customers; /app/finance; /app/estimates`. Revision **unknown/not supplied**.

**Retest / expected result:** Enter invalid email, negative expense and negative estimate quantity in the real forms; each must remain rejected with concise associated correction text, not JSON/arrays/regex.

**Original checklist:** `CUST-004`, `FIN-003`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-009 — Technician block lane

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Blocks persist employee_user_id, while calendar mapping read employee_id.

**Change:** Map the numeric authenticated-Company block owner to the correct single/multiple calendar lane and retain a discoverable block marker.

**Affected paths:** `client/src/pages/Schedule.tsx`; `server/fieldServiceRouter.ts`; `server/hscQaScheduling.test.ts`.

**Tests/evidence:** hscQaScheduling checks actual mapping and existing tenant predicate as source contracts; no browser-persisted block interval or conflict-policy proof. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/schedule`. Revision **unknown/not supplied**.

**Retest / expected result:** Save a short labelled block, reload its date and verify its identifiable interval in the intended technician lane. Do not infer an unspecified conflict-prevention policy.

**Original checklist:** `SCHED-005`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-010 — Equity business date

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Date/instant rendering could shift a date-only equity value across the Chicago boundary.

**Change:** Normalize finance business dates as date-only strings and display the serialized entryDate rather than timezone-shifting it.

**Affected paths:** `server/financeService.ts`; `client/src/pages/Finance.tsx`; `server/hscQaFinance.test.ts`.

**Tests/evidence:** hscQaFinance executes date-only string and Date input mappings. No normal-UI equity save/reload was performed. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/finance`. Revision **unknown/not supplied**.

**Retest / expected result:** Save synthetic equity entered as Oct. 22 in Chicago; after reload it must still display Oct. 22.

**Original checklist:** `FIN-009`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-011 — Full audit-log destination

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** The current source already points Advanced settings at a mounted /app/audit-log route with Company/role checks. The historical Dashboard fallback is not reproduced in this source.

**Change:** Preserved the authorized route and regression-locked destination, mount, role gate and company predicate; did not broaden access.

**Affected paths:** `client/src/pages/Settings.tsx`; `client/src/pages/FieldServiceApp.tsx`; `server/fieldServiceRouter.ts`; `server/hscQaPrivacy.test.ts`.

**Tests/evidence:** hscQaPrivacy source-contract assertions verify destination and server bounds; actual permitted/denied UI navigation remains unexecuted. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/settings → /app/audit-log`. Revision **unknown/not supplied**.

**Retest / expected result:** Settings > Advanced > Open full audit log must open a usable authorized audit view, not Dashboard; denied roles must stay denied.

**Original checklist:** `SET-012`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-013 — Accepted-estimate conversion preview

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Server estimate item fields title/quantity/unitPriceCents/rate description were not consistently mapped to the actual conversion preview.

**Change:** Map accepted lines correctly and render service, chosen rate, quantity, unit value and line total in the actual mounted CreateJob dialog.

**Affected paths:** `shared/estimateScheduling.ts`; `shared/catalogPresentation.ts`; `client/src/components/source-ui/CreateJobDialog.tsx`; `server/hscQaCatalogReadback.test.ts`; `server/hscQaCatalog.test.ts`.

**Tests/evidence:** hscQaCatalogReadback executes create/read/accept/convert with a configured Large Scope rate, quantity 2, $125 unit, $250 total; verifies persisted Job lines. This is an in-memory service fixture, not UI conversion. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/estimates`. Revision **unknown/not supplied**.

**Retest / expected result:** Preview two accepted synthetic estimates with different line/rate or quantity patterns; recognizable details must survive save and reload consistently.

**Original checklist:** `EST-007`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-014 — Customer New Invoice

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** The customer action did not lead through a complete canonical saved invoice workflow.

**Change:** Open a preselected-customer dialog and persist the normal Company Job/invoice representation through jobs.createCustomerInvoice; invalidate canonical views, without sending or collecting.

**Affected paths:** `client/src/pages/SourceCustomersPage.tsx`; `client/src/components/CustomerInvoiceDialog.tsx`; `server/fieldServiceRouter.ts`; `server/jobService.ts`; `server/hscQaFinance.test.ts`; `app: tests/hscQaFinanceReadback.test.ts`.

**Tests/evidence:** hscQaFinance executes selected-customer invoice persistence in a synthetic DB; native regression verifies canonical readback. No actual normal-UI invoice was created in this task. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/customers`. Revision **unknown/not supplied**.

**Retest / expected result:** From the existing synthetic Customer profile, create/save a bounded unpaid invoice; reload/reopen customer, lines, amount, status and balance. Do not send or collect.

**Original checklist:** `CUST-022`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-015 — Normal estimate custom rates

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Real normal estimate dialogs did not surface the saved generic rate options.

**Change:** Wire configured size/scope/tier choices into both mounted estimate-entry paths; carry the selected rate key and label while the server resolves the actual price.

**Affected paths:** `client/src/components/source-ui/CreateEstimateDialog.tsx`; `client/src/pages/FieldServiceApp.tsx`; `shared/catalogPresentation.ts`; `server/priceBookPricing.ts`; `server/hscQaCatalogReadback.test.ts`.

**Tests/evidence:** hscQaCatalogReadback proves configured custom rate authority through estimate persistence/conversion; catalog/priceBookConfiguration suites cover options. UI selection is not yet accepted. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/estimates`. Revision **unknown/not supplied**.

**Retest / expected result:** Standard Estimates > New Estimate must expose and apply a synthetic configured service’s documented choices before saving.

**Original checklist:** `EST-008`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-016 — Cancelled work on active calendar

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Dispatch excluded cancelled work but the web calendar still mapped the general jobs list directly.

**Change:** Filter canonical cancelled records from active calendar mapping, preserving history/detail; native existing exclusion is regression-covered.

**Affected paths:** `client/src/pages/Schedule.tsx`; `server/dispatchService.ts`; `server/hscQaScheduling.test.ts`; `app: tests/hsc-scheduling-regression.test.ts`.

**Tests/evidence:** hscQaScheduling executes cancelled-versus-active dispatch data plus web mapping contract; native regression covers its canonical filter. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/schedule`. Revision **unknown/not supplied**.

**Retest / expected result:** Cancel a bounded future synthetic job, hard reload its calendar and retain cancelled history while removing/segregating active work; repeat with a second fixture if available.

**Original checklist:** `JOB-016`. **Retained evidence:** live-log.md; DaG3BG cancellation/calendar cross-check; /workspace/hsc-qa/evidence/screenshot-DaG3BG--resume-cancelled-zero-dollar-job-still-on-calendar.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-017 — Bounded recurrence persistence

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Only the first job and a recurrence rule were saved; preview counts were not materialized. Ordinal first date could use the arbitrary input day.

**Change:** Use the shared recurrence model; normalize ordinal start; convert each occurrence in Company timezone, validate availability and insert every bounded occurrence under Company scope. Preserve lines/materials, fixed discount, assignment and events.

**Affected paths:** `server/recurringJobSchedule.ts`; `server/jobService.ts`; `shared/jobRecurrence.ts`; `server/hscQaScheduling.test.ts`.

**Tests/evidence:** hscQaScheduling executes saved counts/dates for weekly 5, biweekly 3, monthly-by-date 3 and last-Friday 3, including DST and another untouched synthetic tenant. See exact dates below. It does not establish recurring-series identity/edit propagation or UI reload acceptance. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/schedule; /app/jobs`. Revision **unknown/not supplied**.

**Retest / expected result:** Save bounded weekly, biweekly, monthly-date and monthly-ordinal series with notifications off; reload All Jobs/calendar/customer history and compare every count/date with preview, especially first ordinal date.

**Original checklist:** `JOB-012`, `JOB-017`. **Retained evidence:** resume-log.md (All bounded recurrence variants executed); resume-recurrence-expected.json; Km1uVk preview capture; GekZj2 calendar-wrong-Nov4 capture; dtQAju/all-year-only-four-recurrence-records.png; oiPOJt/monthly-one-year-thirteen-preview.png; /workspace/hsc-qa/evidence/screenshot-Km1uVk--resume-last-friday-six-month-six-preview.png; /workspace/hsc-qa/evidence/screenshot-GekZj2--resume-last-friday-actual-first-date-calendar.png; /workspace/hsc-qa/evidence/screenshot-oiPOJt--resume-monthly-one-year-thirteen-preview.png; /workspace/hsc-qa/evidence/screenshot-dtQAju--resume-all-year-only-four-recurrence-records.png; live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-018 — Job Card pricing affordance

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Job Card showed controls that could not persist canonical pricing changes.

**Change:** Make unsupported discount/extra/tax edits read-only before entry with an explanation of Price Book/PaymentService authority. Supported service changes now have a dedicated canonical service editor.

**Affected paths:** `client/src/pages/JobPage.tsx`; `client/src/components/source-ui/JobDetailPanel.tsx`; `server/hscQaFinance.test.ts`.

**Tests/evidence:** hscQaFinance contains source guards for removed editable controls and explanation; no actual keyboard or UI affordance acceptance. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/jobs/<owned-job-id>`. Revision **unknown/not supplied**.

**Retest / expected result:** Before entering data, verify unsupported pricing is non-editable and the authoritative alternative is clear; separately verify supported service editor saves only intended changes.

**Original checklist:** `JOB-020`. **Retained evidence:** live-log.md. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-019 — Clear all workdays

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** COALESCE collapsed omitted input and explicit empty selection, retaining the old restriction.

**Change:** Use an explicit hasWorkdayUpdate flag and CASE: omitted preserves, [] writes empty; keep Company/member authorization.

**Affected paths:** `server/fieldServiceRouter.ts`; `shared/teamMemberWorkdays.ts`; `client/src/pages/TeamMemberProfile.tsx`; `server/hscQaScheduling.test.ts`.

**Tests/evidence:** hscQaScheduling executes empty parsing/serialization plus actual query contract. Existing Company RBAC/staff authority suites are included; exact visual empty-save/reload remains pending. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/team`. Revision **unknown/not supplied**.

**Retest / expected result:** Save Friday-only and reload, then clear every workday/save/hard reload/reopen; none selected and clear unrestricted-state wording must remain. Non-empty behavior must not regress.

**Original checklist:** `TEAM-007`. **Retained evidence:** /workspace/hsc-qa/evidence/screenshot-NNqfXe--workday-clear-reset-reverts-to-friday.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-020 — Existing-job Price Book editing

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** The live JobPage used legacy catalog IDs/pricing and unavailable mutation placeholders.

**Change:** Map canonical active services and persist add/change/primary-service edits through owner/dispatcher Company-scoped transactions. Server resolves saved rate keys, keeps discounts, audits the real actor, and locks paid/partial jobs or active checkout attempts. Unsupported custom/future-series edits are unavailable before entry.

**Affected paths:** `client/src/pages/JobPage.tsx`; `shared/jobProfit.ts`; `server/fieldServiceRouter.ts`; `server/jobService.ts`; `server/hscQaServices.test.ts`.

**Tests/evidence:** hscQaServices (8) cases execute add/change/primary persistence/readback, discount recalculation, foreign-job/catalog denial, inactive/unauthorized denial, all three active checkout states, partial-payment lock and explicit generic scope rate. No provider is called. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/jobs/<owned-job-id>`. Revision **unknown/not supplied**.

**Retest / expected result:** In an unpaid existing synthetic Job, Add Service and Change Original Service must list active owned services, apply the chosen configured rate, save/reload only that appointment and leave protected payment history intact.

**Original checklist:** `JOB-021`, `JOB-028`. **Retained evidence:** /workspace/hsc-qa/evidence/screenshot-owAESP--existing-job-add-service-empty-pricebook-selector.png; resume-log.md; original capture reference screenshot-CGNt5t/resume-original-service-selector-empty.png (not local); /workspace/hsc-qa/evidence/screenshot-CGNt5t--resume-original-service-selector-empty.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-021 — Customer list Lifetime Value

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** The LTV filter used a tenant-scoped SUM but list selection/mapping omitted it, and a client then overwrote it with null.

**Change:** Select/map the Company-scoped lifetime_value and render it consistently with the same LTV filter semantics.

**Affected paths:** `server/customerService.ts`; `client/src/pages/Customers.tsx`; `server/hscQaCustomers.test.ts`.

**Tests/evidence:** hscQaCustomers executes numeric list LTV projection. This is booked-job value matching existing filter semantics, not a claim of cash collected or an externally reconciled payment metric. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/customers`. Revision **unknown/not supplied**.

**Retest / expected result:** Reload known synthetic customer list/profile/filter context (original Beta example $159.95); 100–200 and zero filters must match the documented LTV meaning.

**Original checklist:** `CUST-037`. **Retained evidence:** resume-log.md; original capture reference screenshot-3ZiPlX/resume-lifetime-value-filter-100-to-200.png (not local); /workspace/hsc-qa/evidence/screenshot-3ZiPlX--resume-lifetime-value-filter-100-to-200.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-022 — Extended customer fields

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Global New Customer lacked full persistence/readback contracts for billing contact, source/referrer, tags and initial note.

**Change:** Add Company-bound extended columns and web/native DTOs, supported form inputs/profile readback, and initial note via the existing scoped note store.

**Affected paths:** `migrations/20261023_customer_extended_profile_fields.sql`; `server/customerService.ts`; `server/fieldServiceRouter.ts`; `server/mobileOperations.ts`; `server/mobileCompanyCustomerDto.ts`; `client/src/pages/SourceCustomersPage.tsx`; `server/hscQaCustomers.test.ts`; `app: lib/jobsync-mobile-api.ts, components/company-customer-profile-panel.tsx`.

**Tests/evidence:** hscQaCustomers executes rich-field+initial-note create/readback and foreign-Company denial. Schema migration remains unapplied; actual form/profile/notes acceptance is pending. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/customers`. Revision **unknown/not supplied**.

**Retest / expected result:** Create/save a bounded synthetic customer with supported fields/note; reload and read each through Profile/Edit or Notes; do not infer unsupported data loss.

**Original checklist:** `CUST-035`. **Retained evidence:** resume-log.md; original capture references screenshot-1m0sUH/resume-rich-customer-edit-only-basic-fields.png and screenshot-4ZFwVD/resume-rich-customer-initial-note-missing-after-reload.png (not local); /workspace/hsc-qa/evidence/screenshot-1m0sUH--resume-rich-customer-edit-only-basic-fields.png; /workspace/hsc-qa/evidence/screenshot-4ZFwVD--resume-rich-customer-initial-note-missing-after-reload.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-023 — Configured status labels

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Display surfaces used hard-coded labels instead of the saved custom labels.

**Change:** Use saved display labels in normal Estimates and mounted All Jobs while preserving canonical status keys for filters and business logic.

**Affected paths:** `shared/catalogPresentation.ts`; `client/src/pages/Jobs.tsx`; `client/src/pages/Estimates.tsx`; `server/hscQaCatalog.test.ts`; `server/hscQaCatalogReadback.test.ts`.

**Tests/evidence:** Catalog suites execute display-label lookup/fallback without mutating canonical keys; mounted All Jobs customization query is wired. Real saved-label reload/Estimates display needs UI acceptance. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/jobs; /app/estimates`. Revision **unknown/not supplied**.

**Retest / expected result:** Using only safe reversible own-company/isolated configuration, save/reload labels; Estimates and All Jobs must match them while logic stays canonical; restore originals.

**Original checklist:** `SET-016`. **Retained evidence:** resume-log.md; original capture reference screenshot-3QzHOG/resume-all-jobs-ignores-custom-status-labels.png (not local); /workspace/hsc-qa/evidence/screenshot-3QzHOG--resume-all-jobs-ignores-custom-status-labels.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-024 — Annual booked-revenue goal

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Dashboard mapped a target from an inappropriate range-dependent metric instead of the persisted annual cents value.

**Change:** Map saved bookedRevenueTargetCents to currency independently of viewing day/week/month/custom range; retain actual-range computation.

**Affected paths:** `shared/companyGoals.ts`; `client/src/pages/Dashboard.tsx`; `server/fieldServiceRouter.ts`; `server/hscQaFinance.test.ts`.

**Tests/evidence:** hscQaFinance executes positive persisted target mapping and range-safe behavior; not actual goal-settings save/reload or settled Dashboard rendering. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/dashboard`. Revision **unknown/not supplied**.

**Retest / expected result:** Save a positive synthetic Booked Revenue/Year goal, reload and verify Month card target/progress; retain known working metric/period behavior.

**Original checklist:** `SET-017`. **Retained evidence:** resume-log.md; original capture references screenshot-bwR1WP/resume-goal-year-positive-target-saved.png and screenshot-s2EyPk/resume-booked-year-target-settled-retest.png (not local); /workspace/hsc-qa/evidence/screenshot-bwR1WP--resume-goal-year-positive-target-saved.png; /workspace/hsc-qa/evidence/screenshot-s2EyPk--resume-booked-year-target-settled-retest.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-025 — Authenticated note actor

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Event projection omitted actor metadata and UI attributed all activity to the assigned technician.

**Change:** Join event actor within the same Company; render that authenticated actor separately from technician assignment; note audits use company.userId.

**Affected paths:** `server/jobService.ts`; `client/src/pages/JobPage.tsx`; `server/hscQaPrivacy.test.ts`.

**Tests/evidence:** hscQaPrivacy executes private-note mutation with authenticated synthetic actor and scoped event/audit data; source regression locks actor display. Real activity refresh is pending. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/jobs/<owned-job-id>`. Revision **unknown/not supplied**.

**Retest / expected result:** Assign Technician A, edit a private note as authorized Actor B, reload Activity and verify B is shown while assignment remains A; no impersonation or credential change.

**Original checklist:** `JOB-030`. **Retained evidence:** resume-log.md; original capture reference screenshot-cQHZSF/resume-admin-note-attributed-to-technician.png (not local); /workspace/hsc-qa/evidence/screenshot-cQHZSF--resume-admin-note-attributed-to-technician.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-026 — Accessible service delete

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Icon-only service-card delete lacked a programmatic name.

**Change:** Add Delete [service name] aria-label and title on the real native-button control.

**Affected paths:** `client/src/pages/PriceBook.tsx`; `server/hscQaCatalog.test.ts`.

**Tests/evidence:** hscQaCatalog source assertion verifies aria-label/title wiring only. A complete accessibility tree, keyboard focus/activation and screen-reader-oriented check was NOT performed; this gate is explicitly open. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/price-book`. Revision **unknown/not supplied**.

**Retest / expected result:** On an isolated unused-service fixture, verify every delete control in a complete accessibility tree and by keyboard/screen-reader-oriented interaction; do not treat a source assertion as full accessibility proof.

**Original checklist:** `PRICE-006`. **Retained evidence:** resume-log.md (New LOW DEF026 candidate; PRICE004PASS); VGfU5b/resume-unused-service-deleted-catalog-restored.png; /workspace/hsc-qa/evidence/screenshot-VGfU5b--resume-unused-service-deleted-catalog-restored.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-027 — Private versus customer notes

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** The mounted Create Job copied one private input to both serviceNotes and privateNotes.

**Change:** Send private input only to internal_notes and preserve distinct customer notes; public invoice surfaces do not use private note fields.

**Affected paths:** `client/src/components/source-ui/CreateJobDialog.tsx`; `server/jobService.ts`; `server/hscQaPrivacy.test.ts`; `server/publicRevenueAccess.ts`.

**Tests/evidence:** hscQaPrivacy executes private-only mutation preserving service_notes and checks public invoice source contracts. It is not a browser/public-response privacy acceptance test. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/jobs/<owned-job-id>`. Revision **unknown/not supplied**.

**Retest / expected result:** Use two bounded synthetic jobs with distinctive private text; reload and prove separate notes. A read-only authorized public-invoice check must disclose no private text, with no send.

**Original checklist:** `JOB-032`. **Retained evidence:** resume-log.md (HSCDEF027); logged capture labels 5mhFkbjobdetail and NEGWXfpublicinvoiceomitsnotes; /workspace/hsc-qa/evidence/screenshot-NEGWXf--resume-private-note-public-invoice-check.png; /workspace/hsc-qa/evidence/screenshot-5mhFkb--resume-private-note-duplicated-customer-note-internal.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-028 — Exact linked customer profile

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Legacy navigation dropped the customer ID; list-page selection and native canonical mapping also lost the linked identity.

**Change:** Navigate directly to /app/customers?id= and resolve only tenant-scoped customers.detail; show Profile unavailable without a valid ID. Native preserves canonicalCustomerId separately and gates its action.

**Affected paths:** `client/src/pages/JobPage.tsx`; `client/src/pages/SourceCustomersPage.tsx`; `server/hscQaPrivacy.test.ts`; `app: lib/jobsync-mobile-api.ts, lib/jobsync-company-authority.ts, app/(tabs)/admin-schedule.tsx, tests/hsc-qa-privacy-profile-mapping.test.ts`.

**Tests/evidence:** hscQaPrivacy plus native mapping tests execute canonical IDs/guards and source route contracts; actual new/existing-customer navigation on web/iOS/Android remains pending. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/jobs/<owned-job-id> → /app/customers?id=<linked-id>`. Revision **unknown/not supplied**.

**Retest / expected result:** From full views of a new-customer and an existing-customer synthetic job, open the exact linked profile, including one outside the current list/filter page; malformed/unlinked records must not silently open All Customers.

**Original checklist:** `JOB-033`. **Retained evidence:** resume-log.md (HSCDEF028); logged capture labels Uw7198firstlist and KtOU4ioriginalBeta2ndlist; /workspace/hsc-qa/evidence/screenshot-Uw7198--resume-job-view-profile-routed-to-customer-list.png; /workspace/hsc-qa/evidence/screenshot-KtOU4i--resume-original-customer-profile-button-opens-list.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-029 — Service image readback

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Live Price Book DTO omitted imageUrl, so reopen could appear empty and unrelated save could clear the stored URL.

**Change:** Project stored image_url to imageUrl, preserve valid remote HTTP(S), refresh managed-storage signing and retain the editor preview/save field.

**Affected paths:** `server/fieldServiceRouter.ts`; `server/priceBookReadback.ts`; `client/src/pages/PriceBook.tsx`; `server/hscQaCatalogReadback.test.ts`; `server/hscQaCatalog.test.ts`.

**Tests/evidence:** CatalogReadback executes image projection across two simulated save/read cycles plus an unrelated description edit. This is a pure/isolated fixture, not actual object-storage upload or a browser preview. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/price-book`. Revision **unknown/not supplied**.

**Retest / expected result:** For an owned isolated unused service, enter a valid image URL with loaded preview, save/reload/reopen and confirm URL/image persists; clean up only that isolated fixture.

**Original checklist:** `PRICE-007`. **Retained evidence:** resume-log.md (HSCDEF029); logged capture labels beforevalidowf46R, afterPUZjtz, earlierdlCFcz, and P0CItBcleanup; /workspace/hsc-qa/evidence/screenshot-dlCFcz--resume-remote-image-after-blur-save-reload.png; /workspace/hsc-qa/evidence/screenshot-owf46R--resume-image-valid-loaded-preview-before-save.png; /workspace/hsc-qa/evidence/screenshot-PUZjtz--resume-image-lost-description-persisted-after-reload.png; /workspace/hsc-qa/evidence/screenshot-P0CItB--resume-image-fixture-deleted-original-catalog-restored.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

### HSC-DEF-030 — Server and device logout

**Disposition:** partially fixed; implementation evidence only, acceptance open.

**Root cause/provenance:** Browser logout only removed cookies while signed tokens stayed usable; native Company logout only cleared device state.

**Change:** Persist SHA256 token revocations in existing Company/actor-scoped audit rows; reject replay, assign unique session IDs, fail on persistence failure, no-store authenticated APIs, cancel/clear caches and stale restore, and revalidate protected mounts. Native calls canonical remote logout and clears local state, warning accurately if not fully confirmed.

**Affected paths:** `server/companySessionRevocation.ts`; `server/fieldServiceRouter.ts`; `server/mobileAuth.ts`; `server/index.ts`; `client/src/lib/companyLogout.ts`; `client/src/pages/FieldServiceApp.tsx`; `client/src/contexts/AuthContext.tsx`; `server/hscQaSession.test.ts`; `app: lib/jobsync-auth-context.tsx, lib/jobsync-mobile-api.ts, lib/jobsync-logout.ts, app/(tabs)/profile.tsx, components/ui/top-nav-menu.tsx, tests/hsc-qa-logout.test.ts`.

**Tests/evidence:** hscQaSession executes two sign-out/new-sign-in cycles, old-token rejection in fresh protected contexts, tenant/actor bounds, no raw-token storage, persistence failure, native bearer revocation and cache races. Native mocks cover remote request and offline cleanup. Browser direct-URL/hard-reload and physical devices were not exercised. Relevant suites are included in the recorded whole-repository run above.

**Target:** existing authorized Company Admin context above; relative surface `/app/dashboard; /app/customers`. Revision **unknown/not supplied**.

**Retest / expected result:** In the authorized synthetic Company Admin account, sign out then directly open Dashboard and All Customers and hard reload; require authentication with no stale protected data. Repeat twice; native paired backend/app device acceptance remains separate.

**Original checklist:** `AUTH-002`. **Retained evidence:** resume-log.md: Final authentication; screenshots lzRLR1, R3sFGU, VoAz3G; /workspace/hsc-qa/evidence/screenshot-R3sFGU--post-logout-dashboard-access-first-cycle.png; /workspace/hsc-qa/evidence/screenshot-lzRLR1--resume-post-logout-company-data-access-after-ten-second-wait.png; /workspace/hsc-qa/evidence/screenshot-VoAz3G--resume-login-screen-before-authorized-form-resubmission.png. These original evidence locators are traceability references, not new test output.

**Remaining gate:** execute that original UI path and applicable related passing checks against an identified authorized fix-containing build. No local green result clears its historical FAIL/BLOCKED status.

## Exact isolated recurrence evidence

All are Company 11 synthetic records at 14:00 America/Chicago; a synthetic Company 22 record remains untouched.

| Pattern | Saved count | Saved local dates |
|---|---:|---|
| Weekly | 5 | 2026-10-30, 2026-11-06, 2026-11-13, 2026-11-20, 2026-11-27 |
| Biweekly | 3 | 2026-10-30, 2026-11-13, 2026-11-27 |
| Monthly date 4 | 3 | 2026-11-04, 2026-12-04, 2027-01-04 |
| Last Friday | 3 | 2026-11-27, 2026-12-25, 2027-01-29; arbitrary requested Nov.4 does not become the first appointment |

## Release and remaining risk notes

1. **Two proposed migrations, neither applied:** `migrations/20261023_customer_extended_profile_fields.sql` and `migrations/20261023_hsc_finance_job_discount.sql`. They require ordinary review, compatibility/backfill planning and a separately authorized rollout. The fixtures are not evidence of real MySQL/TiDB migration execution or real lock/concurrency behavior.

2. **Coordinate backend and native release.** The native Company logout endpoint and extended DTOs require the paired backend. iOS/Android exports are not physical-device acceptance. Platform-admin-native revocation is outside the asserted Company logout fix. Offline cleanup cannot prove remote revocation; storage/provider failures warn instead of claiming success.

3. **Revocation retention is security-critical.** Company/actor-scoped audit rows hold token hashes, not raw tokens. They must not be purged while those sessions may remain valid (Company-native tokens can last30 days). No real credentials, password, MFA or account-security settings were changed.

4. **Service editing is bounded.** Only this unpaid appointment is editable; paid/partial invoices or active creating/pending/processing checkouts are locked. No provider is contacted. Unsupported custom-price/future-series controls do not accept entry. Recurrence materialization does not establish future-series service-edit semantics.

5. **Accessibility remains open.** Named native-button semantics are implemented; complete tree/keyboard/screen-reader-oriented checking is still required for DEF026. Privacy, direct-route/hard-reload logout, two-job notes and actual image preview/save/readback likewise need their stated UI exercises.

6. **No prohibited action occurred:** no merge/deploy/publish, real email/SMS/invitation/reset/support send, real charge/refund/subscription/provider activation/card change, real credential change, shared production configuration mutation or other companies’ real-data inspection. Original pending PRs remain separate.

No additional user access or duplicate approval is needed for the source work completed here. The existing no-merge/no-deploy boundary remains in force. Availability/provenance and acceptance must be resolved without silently crossing it.
