# Phase 2 — Current Architecture Baseline

**Date:** 2026-09-16  
**Mobile baseline:** `Luxurywashent/home-service-connection-app` `main` `c45c3bfed8e5cb5f970a2982d3eac7178f1598a4`  
**JobSync web/backend source in this workspace:** **NOT PRESENT**

This document is the Phase 2 STEP 1 map. It is compiled from:

1. The Home Service Connection mobile repository (this GitHub project).
2. Published JobSync Mobile OpenAPI at `https://jobwash-veysiubh.manus.space/api/mobile/v1/openapi.json` and `https://www.homeserviceconnected.com/api/mobile/v1/openapi.json` (identical documents on this date).
3. Existing mobile audits in `docs/` (`shared-authentication-audit.md`, `jobsync-complete-mobile-api-prompt.md`, `jobsync-remaining-operational-mobile-api-prompt.md`, `HSC_COMPANY_FEATURE_GAPS.md`).

It is **not** a source-level map of JobSync tRPC routers, SQL, or CompanyContext. Those live in the original JobSync web-app project, which is not a repository in this Cloud Agent environment.

---

## 1. Hard constraint

Phase 2 requires the JobSync backend to become the single domain authority:

```text
HSC Web (React)                 HSC Mobile (Expo)
       │                               │
       ▼                               ▼
 tRPC /api/trpc                REST /api/mobile/v1
       │                               │
       └──────────────┬────────────────┘
                      ▼
                HSC Backend
                      │
        Auth → RBAC → CompanyContext
                      │
                Validation
                      ▼
            Shared Domain Services
                      ▼
             Shared Data Access
                      ▼
              DATABASE_URL
                 HSC ONLY
```

This repository contains:

| Layer | Location | Role today |
|---|---|---|
| HSC Mobile client | `app/`, `components/`, `lib/jobsync-mobile-api.ts` | Expo client. Company Jobs/Chat/Auth/Price Book call JobSync over HTTPS. |
| Local leftover backend | `server/`, `drizzle/` | Copied Luxury Wash tRPC/Express app. Tables are `employees`, `jobs`, city slugs — **not** `company_users` / `fs_*`. No `company_id`. |
| JobSync backend | Remote hosts only | Authoritative HSC SaaS. Source not in this git remote. |

GitHub access from this environment lists one Luxurywashent repository: `home-service-connection-app`. Environment `repos` is the same single URL.

**JobService / DispatchService cannot be extracted here.** Creating them in the Expo app would put business rules on the wrong side of the architecture.

---

## 2. Transports

### WEB — `/api/trpc` (JobSync, remote)

Documented Company web login from prior JobSync source review (not present in this tree):

| Concern | Observed contract |
|---|---|
| Login | `auth.emailLogin` |
| Workspace | `auth.workspace` |
| Session cookie | `hsc_company_session` |
| Identity | `company_users` joined to `companies` |
| Platform cookie | `fs_platform_owner` via `platformOwnerAuth.emailLogin` |
| Platform identity | `platform_operators` |

Exact Jobs/Dispatch tRPC procedure names are **unverified** in this workspace. Mobile prompts instruct implementers to reuse those web procedures rather than fork SQL.

### MOBILE — `/api/mobile/v1/*`

Canonical production origin used by the mobile client:

- Default: `https://www.homeserviceconnected.com`
- Allowlisted: `homeserviceconnected.com`, `www.homeserviceconnected.com`, `jobwash-veysiubh.manus.space`
- Resolver: `resolveJobSyncBaseUrl()` in `lib/jobsync-mobile-api.ts`
- Luxury Wash hosts are rejected and rewritten to the HSC default.

Auth:

| Method | Path |
|---|---|
| POST | `/api/mobile/v1/auth/login` |
| GET | `/api/mobile/v1/auth/session` |
| POST | `/api/mobile/v1/auth/password-reset/request` |

Bearer header: `Authorization: Bearer <token>`.

### Local leftover transport (not HSC)

`server/_core/index.ts` mounts tRPC at `/api/trpc` against the copied Luxury Wash schema. Phase 1 Company sessions are guarded off these routes for calendar, Add Job, receptionist, and locations. This local stack is **not** the Phase 2 shared backend.

---

## 3. Database

### JobSync (remote, not in this repo)

Prior audits and Phase 2 instructions name:

| Family | Examples |
|---|---|
| Identity | `companies`, `company_users`, `platform_operators` |
| Field service | `fs_jobs`, `fs_job_payments`, `fs_online_bookings` (named in feature-gap docs) |
| Tenancy column | `company_id` |

Schema, indexes, and query text are **not inspectable here**.

### This repository (`drizzle/schema.ts`)

Local tables include `users`, `employees`, `daily_performance`, `notifications`, and other copied-app operational tables. There is **no** `company_users`, **no** `companies`, **no** `fs_jobs`, and **no** `company_id` column. `DATABASE_URL` in this project, if set, is the leftover mobile/server database — not JobSync.

---

## 4. Auth and tenancy (client-visible)

### Intended JobSync chain

```text
Web cookie
        ↓
authenticated company user
        ↓
CompanyContext
        ↓
company_id

Mobile bearer token
        ↓
authenticated company user
        ↓
CompanyContext
        ↓
company_id
```

### What the mobile client actually does

1. Login body is `{ accountType, email, password }`. It does **not** send `companyId`.
2. Session normalizer reads `company.id` from the **server response** (`normalizeJobSyncMobileSession`).
3. Subsequent Job/Customer/Price Book/Chat calls send only the bearer token.
4. Job create body is `{ customerId, priceBookServiceId, assignedUserId?, scheduledStartAt, scheduledEndAt?, privateNotes? }` — no `companyId`.
5. Roster helper `normalizeJobSyncCompanyRoster` **rejects** a payload whose company id does not match the session company. That is a client integrity check, not server authorization.

`JobSyncAuthProvider` stores the bearer token (SecureStore / AsyncStorage) and restores via `GET /auth/session`. It does not currently persist or fetch feature-access into navigation.

---

## 5. Domain map

Status keys:

- **Remote OpenAPI** — published JobSync mobile path exists.
- **Mobile client wired** — `lib/jobsync-mobile-api.ts` (or a screen) calls it for Company sessions.
- **Local leftover** — copied Luxury Wash tRPC/SQL in this repo.
- **JobSync source unknown** — web procedure / SQL / validation / tests not in this tree.

### Jobs

| Concern | Current evidence |
|---|---|
| Web endpoint | JobSync tRPC (names unknown here). Prompts say reuse web job rules. |
| Mobile endpoint | Client: `GET/POST /api/mobile/v1/company/jobs`. OpenAPI: `GET/POST /jobs`, `GET /jobs/{jobId}`, `PATCH /jobs/{jobId}/status`, `PATCH /jobs/{jobId}/assignment`, `PATCH /jobs/{jobId}/schedule`, `POST /jobs/{jobId}/payments`. |
| SQL / data access | JobSync unknown. Local leftover: `server/db.ts` + `jobs` tRPC in `server/routers.ts` (no tenant column). |
| Validation | Mobile create requires Company customer id + numeric Price Book service id; server is expected to price. OpenAPI create requires `customerId`, `title`, `serviceName`, `scheduledStartAt` — **contract mismatch** with the wired client. |
| Authorization | OpenAPI: create/assign/reschedule owner or dispatcher; technician status limited. Not verified in SQL. |
| Tenant filtering | OpenAPI text says Company-scoped. Client does not send `company_id`. Server filter **unverified**. |
| Duplicated logic | Mobile schedule maps JobSync jobs into the leftover `Job` UI model. Local tRPC `jobs.upsert` remains for non-Company sessions. |
| Timezone | Client sends ISO `scheduledStartAt`. Calendar grid uses device-local `localDateStr` / `Date`. Company timezone from `/company/settings` is **not** used by the schedule mapper. |
| Side effects | Price Book ownership and totals are specified as server-side. Local leftover jobs fire email/SMS/booking side effects for non-Company paths. |
| Tests | `tests/jobsync-mobile-api.test.ts` (client fetch contracts). No JobSync JobService tests in this repo. |

### Dispatch

| Concern | Current evidence |
|---|---|
| Web endpoint | Unknown tRPC. |
| Mobile endpoint | OpenAPI: `GET /dispatch/board?date=`, `POST /dispatch/location`, plus job assignment/schedule patches. Client **does not** call `/dispatch/*`. Admin schedule for Company sessions uses `getJobSyncCompanyJobs` + roster. |
| SQL / validation / RBAC | Unknown in JobSync source. OpenAPI: board is owner/dispatcher; location post is technician. |
| Duplicated logic | Company dispatch UI is the calendar, not a shared DispatchService. Local leftover dispatch is city/detailer based. |
| Tests | None for `/dispatch/board` in this repo. |

### Customers

| Concern | Current evidence |
|---|---|
| Mobile | `GET/POST /api/mobile/v1/customers` wired. OpenAPI also `GET /customers/{customerId}`. |
| Web / SQL | JobSync unknown. Local leftover `server/customerDb.ts`. |
| Phase 2 | **Out of scope** for this pass. |

### Estimates / Leads

OpenAPI: `/estimates`, `/estimates/{estimateId}`, `/leads`, `PATCH /leads/{leadId}`. **Not wired** in the mobile Jobs client. Out of scope.

### Team

| Concern | Current evidence |
|---|---|
| Mobile | `GET/PATCH /api/mobile/v1/company/team-members` and `/:memberId`. Roster must match session company id. |
| Web | Documented as existing JobSync member APIs. Source unknown. |
| Local leftover | `employee.*` tRPC + `employees` table. |

### Schedule

| Concern | Current evidence |
|---|---|
| Mobile OpenAPI | `GET /schedule?start&end` — technicians receive assigned jobs only. |
| Mobile client | Does **not** call `/schedule`. Uses `/company/jobs` plus `lib/jobsync-sync-context.tsx` incremental `/sync`. |
| UI | `app/(tabs)/schedule.tsx`, `app/(tabs)/admin-schedule.tsx`, `lib/jobsync-schedule-window.ts` (full-day 00:00–24:00 slots). |
| Local leftover | Booking list/availability against Luxury Wash `APP_API_BASE` (guarded off for Company). |

### Time Clock / Time Off

OpenAPI: `/time/current`, clock-in/out, breaks, timesheets, team-summary, `/time-off`. Client wires clock paths in `lib/jobsync-mobile-api.ts`. Local leftover clock monitors remain in `server/`.

### Price Book

Client: `GET /api/mobile/v1/price-book`. Company Add Job uses Company Price Book only. Local leftover `trpc.pricebook.list` disabled for Company sessions.

### Inventory / Payments / Training / Van Inspections / Fleet / Settings / Online Booking / Portal Inbox / Chat

| Domain | OpenAPI | Mobile client | Local leftover |
|---|---|---|---|
| Inventory | `GET /inventory` | Not Jobs-wired | `server/inventoryDb.ts` |
| Payments | `POST /jobs/{jobId}/payments`, `/finance`, `/invoices` | Company invoice send blocked | `server/invoiceRouter.ts`, Stripe jobs |
| Chat | Not in the truncated OpenAPI snapshot used here; client uses `/company/chat/groups`, `/chat/community`, `/chat/direct` | Wired Company Team Chat | Local `trpc.chat.*` |
| Training | `GET /training` | Local training UI remains | `server/training*.ts` |
| Van inspections | `GET/POST /inspections` | Local EOD/van flows | leftover tRPC |
| Settings | `GET /company/settings` (timezone, brand) | Session branding only | leftover |
| Online booking | `PATCH /bookings/{bookingId}/status` | Company booking lookup blocked | leftover `/api/booking/*` |
| Portal inbox / support | `/support/conversation`, `/support/messages` | Not Jobs-wired | leftover communications |
| Fleet | `GET /fleet` | Local fleet map | `server/fleetDb.ts` |

---

## 6. Duplicated business logic (Jobs / Dispatch)

Confirmed duplication **visible from this repo**:

1. **Two Job HTTP shapes** — mobile client `/company/jobs` + Price Book service id versus OpenAPI `/jobs` + `title`/`serviceName`.
2. **Two schedule readers** — OpenAPI `/schedule` versus client `/company/jobs` + `/sync`.
3. **Two backends** — JobSync HTTPS for Company sessions versus local tRPC/SQL for leftover Luxury Wash sessions.
4. **UI-side job mapping** — `schedule.tsx` converts JobSync jobs into the copied-app `Job` type (day index, week offset, device-local hours).
5. **No JobService / DispatchService** symbol exists in this tree (`grep` empty).

Whether JobSync web tRPC already has internal services cannot be confirmed without that repository.

---

## 7. Timezone / date logic (mobile-visible)

| Path | Behavior |
|---|---|
| JobSync API timestamps | ISO strings (`scheduledStartAt` / `scheduledEndAt`), treated as absolute instants by `new Date(...)`. |
| Company timezone | OpenAPI `/company/settings` returns timezone. Mobile schedule does not load or apply it. |
| Device-local calendar | `localDateStr` / local noon parse in `schedule.tsx` avoid UTC day-shift for leftover booking dates. |
| Slot grid | `jobsync-schedule-window.ts` places jobs on a 24-hour local grid from `Date.getHours()`. |
| Tests | Slot index tests only. No company-timezone, DST, or web/mobile parity tests. |

This is the Phase 2 timezone defect the extraction must fix **in JobSync JobService**, then consumed by both transports.

---

## 8. Tests available in this repository

| Suite | What it proves |
|---|---|
| `tests/jobsync-mobile-api.test.ts` | Client normalizers, host allowlist, `/company/jobs` fetch/create payloads, roster company-id match, Price Book filtering. |
| `tests/jobsync-native-session.test.ts` | Session fixture typing. |
| `server/*.test.ts` | Leftover training/customer-dedup — not JobSync tenancy. |
| GitHub `mobile-validation.yml` | Lockfile, Expo SDK, expo-doctor, the two JobSync client test files, `tsc`, iOS bundle. |

There are **no** JobSync server tenant-isolation tests, JobService tests, or DispatchService tests in this repository.

---

## 9. Phase 2 extraction gate

Proceed with JobService / DispatchService **only** in the JobSync web-app repository, after STEP 2 tenant security is proven on that server's Jobs and Dispatch queries.

Required inputs that are missing here:

1. JobSync git remote / source checkout at current JobSync `main`.
2. Ability to grep `CompanyContext`, `company_id`, Jobs SQL, and Dispatch SQL.
3. Ability to run JobSync TypeScript, backend build, and existing web tests.

Until those exist, this document is the mobile-side baseline only.
