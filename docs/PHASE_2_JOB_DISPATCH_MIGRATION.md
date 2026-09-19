# Phase 2 — Jobs / Dispatch Migration Log

**Date:** 2026-09-16  
**Branch:** `phase-2/job-dispatch-shared-services`  
**Status:** **NOT STARTED IN CODE** — blocked on JobSync source + tenant-security certification.

---

## OLD PATH (current, observed)

### Company mobile Jobs

```text
Expo UI (schedule / Add Job)
  → lib/jobsync-mobile-api.ts
  → HTTPS GET/POST /api/mobile/v1/company/jobs
  → remote JobSync host (www.homeserviceconnected.com | jobwash-veysiubh.manus.space)
  → unknown JobSync handlers / SQL
  → unknown JobSync DATABASE_URL
```

### Published mobile Jobs / Dispatch (OpenAPI)

```text
GET/POST /api/mobile/v1/jobs
GET/PATCH /api/mobile/v1/jobs/{jobId}...
GET /api/mobile/v1/schedule
GET /api/mobile/v1/dispatch/board
POST /api/mobile/v1/dispatch/location
  → unknown JobSync handlers
```

### Company web Jobs / Dispatch

```text
HSC Web
  → tRPC /api/trpc (procedure names unknown in this workspace)
  → unknown JobSync services / SQL
```

### Leftover non-Company mobile Jobs (not HSC SaaS)

```text
Expo UI (non-Company session)
  → tRPC jobs.* / APP_API_BASE booking routes
  → this repo server/ + drizzle employees/jobs
```

There is no `JobService` or `DispatchService` in this tree. Web and mobile therefore cannot be shown to share one domain module.

---

## NEW PATH (required, not implemented)

```text
Web tRPC Jobs/Dispatch handlers
  → auth + parse + validate
  → JobService / DispatchService
  → shared data access
  → DATABASE_URL (HSC only, company_id from CompanyContext)

Mobile REST /api/mobile/v1/jobs and /dispatch
  → auth + parse + validate
  → SAME JobService / DispatchService
  → SAME data access
  → SAME DATABASE_URL
```

Transport handlers must not keep independent SQL after migration.

Do not delete old JobSync handlers until:

- the shared service works
- tests pass
- both transports call it
- behavior is verified

Then remove duplicated SQL/business logic **in the JobSync repo**.

---

## What this branch contains

Documentation only:

- `docs/PHASE_2_CURRENT_ARCHITECTURE.md`
- `docs/PHASE_2_TENANT_SECURITY_AUDIT.md`
- this file

No product code, no schema migrations, no deploys.

---

## Resume checklist (JobSync web-app repo)

1. Check out current JobSync `main`.
2. Complete STEP 2 on real Jobs/Dispatch queries (`PHASE_2_TENANT_SECURITY_AUDIT.md`).
3. If P0: fix isolation first.
4. Extract/formalize `JobService` from existing web logic; point tRPC and `/api/mobile/v1` Jobs at it.
5. Unify timezone: store instants, interpret business days in company timezone, test DST/midnight.
6. Extract/formalize `DispatchService`; point web + `/dispatch/*` + assignment/reschedule at it.
7. Add contract tests that web and mobile enforce the same rules.
8. Collapse `/company/jobs` vs `/jobs` to one service.
9. Only then delete leftover duplicated SQL.

Do not begin Customers or Estimates in that pass.
