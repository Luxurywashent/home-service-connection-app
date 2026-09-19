# Phase 2 — Tenant Security Audit

**Date:** 2026-09-16  
**Mobile baseline:** `c45c3bfed8e5cb5f970a2982d3eac7178f1598a4`  
**JobSync backend source:** **NOT IN THIS WORKSPACE**

Verdict for this pass: **BLOCKED** (cannot certify JobSync Jobs/Dispatch SQL isolation).

This is **not** a confirmed cross-company P0 in JobSync, because the queries cannot be inspected. STEP 2 requires a source-level check of every Jobs and Dispatch query. That check did not run. Service extraction is stopped.

---

## 1. Required rule

The server must derive `company_id` from authenticated context.

Never trust a client-supplied `company_id` for authorization.

Required chains:

```text
Web cookie → authenticated company user → CompanyContext → company_id
Mobile bearer → authenticated company user → CompanyContext → company_id
```

---

## 2. Evidence that could be gathered

### 2.1 JobSync server (authoritative)

| Check | Result |
|---|---|
| `CompanyContext` implementation | **Not found** — no JobSync server tree |
| Cookie `hsc_company_session` binder | Documented in `docs/shared-authentication-audit.md`; source not present |
| Bearer token → company_id | OpenAPI describes bearer JWT; decoder/SQL not present |
| Jobs SELECT/INSERT `WHERE company_id = ctx.companyId` | **Unverified** |
| Dispatch board/location queries | **Unverified** |
| Rejection of client `companyId` body/query | **Unverified** |
| Two-company isolation tests | **Not in this repo** |

Published OpenAPI claims “Company-scoped” for `/jobs`, `/schedule`, and `/dispatch/board`. That is documentation, not a query proof.

### 2.2 Mobile client (this repo) — favorable, not sufficient

| Check | Result |
|---|---|
| Login sends `companyId` | **No.** `{ accountType, email, password }` only. |
| Job create sends `companyId` | **No.** Customer id + Price Book service id + optional assignee + ISO schedule. |
| Customer create sends `companyId` | **No.** |
| Team roster | Response `company.id` must equal session company or the client throws. |
| Host isolation | `resolveJobSyncBaseUrl` rejects Luxury Wash hosts. |
| Feature-access nav filtering | Helper exists; **not** wired into `top-nav-menu.tsx`. Direct routes for receptionist/locations still render Company unavailable screens. |

Client hygiene is necessary and currently good for Jobs create/list. It cannot stop a server that filters on the wrong column or trusts a body field.

### 2.3 Local leftover backend (this repo) — unscoped, guarded for Company UI

`server/` and `drizzle/schema.ts` have **zero** `company_id` / `CompanyContext` usage.

| Surface | Isolation |
|---|---|
| `trpc.jobs.*` | Employee/job records are global to the leftover database |
| `trpc.employee.listDetailers` | All detailers |
| Receptionist / invoice HTTP | Hard-coded Luxury Wash `luxwashapp-n2wveyqg.manus.space` inside **legacy** screens |
| Company session reaching those screens | Phase 1 guards: Company calendar/Add Job skip leftover fetches; `admin-receptionist` and `admin-locations` render unavailable placeholders before legacy trees mount |

This leftover stack is not the HSC SaaS database. It is still a tenancy hole **if** a Company session were pointed at it. Phase 1 closed the active Company UI paths that used to call it. It is **not** a substitute for JobSync SQL review.

---

## 3. Jobs and Dispatch isolation checklist

| Query / operation | Transport | Isolation proof |
|---|---|---|
| List Company jobs | Mobile `GET /api/mobile/v1/company/jobs` | Client sends bearer only. Server filter **unverified**. Path is also **not** the OpenAPI `/jobs` path. |
| Create Company job | Mobile `POST /api/mobile/v1/company/jobs` | No client `companyId`. Server must bind customer and Price Book rows to token company. **Unverified.** |
| OpenAPI list/create | `GET/POST /jobs` | Documented Company-scoped. **Unverified.** Dual path vs `/company/jobs` is an isolation risk until proven to be the same handler. |
| Get / status / assign / reschedule | OpenAPI `/jobs/{jobId}/*` | Not called by current Company calendar client. **Unverified.** |
| Schedule list | OpenAPI `GET /schedule` | Not called by current client. **Unverified.** |
| Dispatch board | OpenAPI `GET /dispatch/board` | Not called by current client. **Unverified.** |
| Dispatch location | OpenAPI `POST /dispatch/location` | Not called by current client. **Unverified.** |
| Web tRPC jobs/dispatch | JobSync `/api/trpc` | **Unverified** — source missing. |
| Local leftover `jobs.upsert` | This repo tRPC | No tenant filter. Company UI must not call it (Phase 1 guards). |

---

## 4. Dual-route risk (not scored P0 without server source)

Mobile Company calendar and Add Job use:

```text
/api/mobile/v1/company/jobs
```

Published OpenAPI (both production hosts) documents:

```text
/api/mobile/v1/jobs
/api/mobile/v1/jobs/{jobId}
/api/mobile/v1/jobs/{jobId}/assignment
/api/mobile/v1/jobs/{jobId}/schedule
/api/mobile/v1/dispatch/board
```

If those are two implementations, tenant rules can diverge. If they are aliases over one service, they must be proven in JobSync source. This is a **P1 architecture defect** until the JobSync handlers are reviewed. It is not labeled P0 here because exploitability is unproven without SQL.

---

## 5. P0 definition for this audit

A P0 would be a demonstrated or source-proven path where Company A’s credential can read or write Company B’s jobs/dispatch records.

| Finding | Class |
|---|---|
| JobSync Jobs/Dispatch SQL not reviewed | **BLOCKER** for extraction — not a proven P0 |
| Client Job writes omit `companyId` | Positive control, not a finding |
| Leftover local tRPC has no `company_id` | Isolated leftover stack; Company UI guarded |
| OpenAPI vs `/company/jobs` path split | P1 until proven same service |
| Feature-access menu not wired | Product gap, not a data-exfil P0 by itself |

**P0 FINDINGS: NONE confirmed.**

**TENANT SECURITY: BLOCKED** until JobSync `main` is available and every Jobs/Dispatch query is shown to use `CompanyContext.company_id` (or equivalent token-derived id), never a client-supplied company id.

---

## 6. Stop condition

Phase 2 STEP 2:

> If a cross-company access vulnerability exists: STOP.  
> Do not continue service extraction until it is addressed.

This pass stops because isolation **cannot be certified**, which is a stricter gate than “no P0 found in an incomplete review.”

Do **not** add JobService / DispatchService to this mobile repository.

Resume extraction only in the JobSync web-app repo after:

1. Cookie and bearer both populate the same CompanyContext.
2. Jobs list/get/create/update/cancel/assign/reschedule queries filter by that company id.
3. Dispatch board/move/location queries filter by that company id.
4. Automated two-company tests fail closed when company ids differ.
5. `/jobs` and `/company/jobs` are the same service or one is removed.
