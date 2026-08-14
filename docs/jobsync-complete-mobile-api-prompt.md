# JobSync Complete Mobile API Implementation Prompt

## Copy Everything Below into the Original JobSync Web-App Project

> **Goal:** Build a complete, versioned, bearer-token JobSync Mobile API. Home Service Connection must become a native client of the same JobSync Company and Platform data used by the web app. Do **not** add one-off endpoints for a single screen. Implement the full API surface in one cohesive change, publish it, and prove it with integration tests.

## Non-Negotiable Architecture

JobSync is the **only source of truth**. The mobile app must never create, duplicate, seed, or mutate a separate employee, Company, schedule, payroll, customer, or operational database. Every Company-scoped mobile read and write must use the existing JobSync records and be filtered from the bearer token’s authenticated Company context.

Implement all routes under:

```text
https://jobwash-veysiubh.manus.space/api/mobile/v1
```

Use JSON for every response. Never return the web app’s SPA HTML fallback from an API route. Unknown API routes must return a JSON `404` envelope.

### Authentication and tenancy rules

| Rule | Requirement |
|---|---|
| Company session | A Company bearer token resolves exactly one `companyId`, user ID, Company role, and permitted capabilities. |
| Platform session | A Platform Admin bearer token resolves a platform user and platform role; Company selection is explicit and audited. |
| Tenant boundary | Company endpoints derive `company_id` from the token. They must **not** trust a client-provided Company ID. |
| Member boundary | A Company member may be read or updated only when `member.company_id === token.companyId`. |
| Writes | Owner/Admin and Operations Manager permissions are enforced server-side for each mutable Company resource. |
| Error shape | Return JSON: `{ "error": { "code": "FORBIDDEN", "message": "…" } }`; use appropriate `401`, `403`, `404`, `409`, and `422` statuses. |
| Sensitive values | Never return password hashes, PIN hashes, salts, payment secrets, internal tokens, or support-session tokens. |

### Standard response conventions

```json
{
  "data": {},
  "meta": {
    "requestId": "optional-correlation-id",
    "updatedAt": "2026-08-14T00:00:00.000Z"
  }
}
```

For paginated lists, return:

```json
{
  "data": [],
  "page": { "cursor": "next-cursor-or-null", "hasMore": false }
}
```

## Roles and Permission Model

| Mobile role | JobSync role | Required access |
|---|---|---|
| Company Owner/Admin | `owner` | Full Company data, settings, members, scheduling, finance, payroll, reports, billing, and operational approvals. |
| Operations Manager | `dispatcher` | Company operations, team roster, scheduling, dispatch, jobs, customers, alerts, time-off review, inventory, and member operational edits. No billing or restricted Company ownership controls. |
| Detailer | `technician` | Own profile, availability, time clock, breaks, assigned jobs, customer/job detail required to perform service, job status, inspections, training, notifications, and time-off requests. |
| Platform Owner | `owner` (platform) | All Companies, platform finance, plans, platform staff, support, affiliate program, and Company provisioning. |
| Platform Operations / Support / Sales / Developer | Existing platform roles | Only their current web-permitted platform data and actions. |

## Required API Surface

Implement the following complete route groups. Reuse the existing JobSync database tables, procedures, validation, audit log, and business rules already used by the web app. Add mobile controllers/services only as an API adapter layer; do not fork business logic.

### 1. Authentication, session, and bootstrap

| Method | Route | Required behavior |
|---|---|---|
| `POST` | `/auth/login` | Existing Company and Platform Admin email/password login. Accept `{ accountType, email, password }`; return short-lived bearer access token, token expiry, safe profile, role, Company context when applicable, and capabilities. |
| `POST` | `/auth/refresh` | Rotate a valid refresh token and issue a new access token. |
| `POST` | `/auth/logout` | Revoke the active refresh token/device session. |
| `GET` | `/auth/session` | Return safe current identity, Company context, role, capabilities, branding, and token expiry. |
| `POST` | `/auth/password-reset/request` | Request a reset without account enumeration. |
| `POST` | `/auth/password-reset/confirm` | Confirm a valid reset token and set a new password. |
| `GET` | `/bootstrap` | Return app configuration, Company branding, feature flags, API version, supported sync version, and role-specific navigation capabilities. |

### 2. Company branding, settings, and workspace

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/company` | Return authenticated Company identity, display name, slug, logo, colors, address/service areas, timezone, subscription/workspace status. |
| `PATCH` | `/company` | Owner-only update of allowed branding and workspace settings. |
| `GET` | `/company/settings` | Return Company settings, policies, notification preferences, booking rules, and feature configuration needed by mobile. |
| `PATCH` | `/company/settings` | Owner-only update of validated Company settings. |
| `POST` | `/company/logo` | Secure Company-logo upload. Return safe URL. |

### 3. Team Members and full profiles

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/company/team-members` | Return all active Company members with ID, member ID, name, role, availability, City, and roster metadata. Support role/status/cursor filters. |
| `POST` | `/company/team-members` | Owner/Operations Manager creates a Company member with invitation/password enrollment flow. |
| `GET` | `/company/team-members/:memberId` | Return complete safe profile: member ID, name, email, phone, City, hire date, role, availability, work days, hourly rate where permitted, upsell bonus where permitted, mystery-bonus status, training summary, assigned vehicle, and active state. |
| `PATCH` | `/company/team-members/:memberId` | Authorized profile edit. Validate Company boundary and allowed role transitions. |
| `PATCH` | `/company/team-members/:memberId/availability` | Set `available`, `busy`, or `off_duty`. A technician may update only self; Owner/Operations Manager may update Company members. |
| `PATCH` | `/company/team-members/:memberId/work-schedule` | Authorized work-day/shift changes. Return updated profile. |
| `POST` | `/company/team-members/:memberId/reset-password` | Owner/Operations Manager starts a secure reset/invitation process; never expose or set a plaintext password in a GET response. |
| `POST` | `/company/team-members/:memberId/reset-pin` | Only if PIN is still a supported JobSync Company feature; validate and hash server-side. Otherwise omit this route and use password reset. |
| `POST` | `/company/team-members/:memberId/deactivate` | Authorized deactivation with server-side job reassignment/unassignment plan. |
| `POST` | `/company/team-members/:memberId/reactivate` | Authorized reactivation. |
| `GET` | `/company/team-members/:memberId/performance` | Role-safe performance, efficiency, job totals, and history. |
| `GET` | `/company/team-members/:memberId/training` | Role-safe training progress and module status. |

### 4. Time clock, breaks, timesheets, and time off

These routes are required because Clock In, Clock Out, and Break currently do not work in mobile.

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/time/current` | Current clock state, active break, today’s totals, and permitted actions. |
| `POST` | `/time/clock-in` | Clock in current authenticated user; use server time and optional validated location metadata. |
| `POST` | `/time/clock-out` | Clock out current authenticated user; prevent invalid duplicate actions. |
| `POST` | `/time/breaks/start` | Start break for current user. |
| `POST` | `/time/breaks/end` | End current active break. |
| `GET` | `/time/timesheets` | Current user history; owner/Operations Manager may filter authorized Company members and date range. |
| `PATCH` | `/time/timesheets/:entryId` | Authorized correction workflow with audit metadata and approval state. |
| `GET` | `/time/team-summary` | Owner/Operations Manager Company hours, attendance, active clock status, and exceptions. |
| `GET` | `/time-off` | Current user requests; privileged roles can list Company requests. |
| `POST` | `/time-off` | Create a validated request. |
| `PATCH` | `/time-off/:requestId/review` | Owner/Operations Manager approve/deny with manager note. |

### 5. Schedule, dispatch, jobs, routing, and bookings

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/schedule` | Company calendar by range. Return jobs, unassigned lane, assigned member, status, service window, customer summary, availability conflicts, and City/service-area data. |
| `GET` | `/schedule/availability` | Return Company-aware booking capacity and available technicians/slots for date, service, and service area. |
| `GET` | `/jobs` | Paginated Company jobs with date, status, assignee, customer, search, and cursor filters. |
| `POST` | `/jobs` | Owner/Operations Manager job creation. |
| `GET` | `/jobs/:jobId` | Full Company job detail including customer, service, line items, materials, assignments, timeline, payments, notes, inspection, and permitted actions. |
| `PATCH` | `/jobs/:jobId` | Authorized job update. |
| `PATCH` | `/jobs/:jobId/assignment` | Assign/unassign only a valid active Company member. |
| `PATCH` | `/jobs/:jobId/status` | Enforce valid status transitions and capture actor/time/location. |
| `PATCH` | `/jobs/:jobId/schedule` | Move/reschedule using server-side conflict checks. |
| `POST` | `/jobs/:jobId/check-in` | Technician check-in/on-site event. |
| `POST` | `/jobs/:jobId/check-out` | Technician completion/check-out event. |
| `POST` | `/jobs/:jobId/inspection` | Save Company-scoped service/vehicle inspection. |
| `POST` | `/jobs/:jobId/photos` | Secure pre/post-service photo upload and metadata. |
| `GET` | `/dispatch/board` | Owner/Operations Manager dispatch board for selected date/range. |
| `PATCH` | `/dispatch/jobs/:jobId/move` | Dispatch move/reassignment operation. |
| `POST` | `/dispatch/location` | Authorized worker location update with retention policy. |
| `GET` | `/bookings` | Company online bookings and conversion status. |
| `PATCH` | `/bookings/:bookingId/status` | Authorized booking approval, conversion, or status change. |

### 6. Customers, communications, estimates, sales, and payments

| Method | Route | Required behavior |
|---|---|---|
| `GET/POST` | `/customers` | List/create Company customers. |
| `GET/PATCH` | `/customers/:customerId` | Full permitted profile, communication preferences, jobs, and update. |
| `GET/POST` | `/customers/:customerId/communications` | Company communication history and logging. |
| `GET/POST` | `/estimates` | List/create Company estimates. |
| `GET/PATCH` | `/estimates/:estimateId` | Detail and permitted status update. |
| `POST` | `/estimates/:estimateId/convert` | Convert estimate to Job through existing JobSync business rules. |
| `GET/POST` | `/leads` | Company lead inbox/list and creation. |
| `GET/PATCH` | `/leads/:leadId` | Lead detail and permitted update/assignment. |
| `GET` | `/payments/unpaid-jobs` | Authorized unpaid-job queue. |
| `POST` | `/payments` | Record a payment only through existing JobSync payment business rules. |
| `GET` | `/payments` | Authorized payment history. |

### 7. Operations: inventory, price book, inspections, fleet, and payroll

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/price-book` | Company price book, active state, categories, and items. |
| `POST/PATCH` | `/price-book/items` and `/price-book/items/:itemId` | Owner/Operations Manager item management using existing validation. |
| `GET` | `/inventory` | Company inventory and low-stock status. |
| `POST` | `/inventory/:itemId/adjustments` | Authorized audited inventory adjustment. |
| `GET` | `/fleet/vehicles` | Company vehicles, status, mileage, assigned member, inspection state, and maintenance summary. |
| `GET` | `/fleet/vehicles/:vehicleId` | Vehicle detail and authorized assignment history. |
| `PATCH` | `/fleet/vehicles/:vehicleId/assignment` | Owner/Operations Manager vehicle assignment/unassignment. |
| `GET` | `/payroll/periods` | Authorized payroll periods. |
| `GET` | `/payroll/periods/:periodId` | Authorized entries, totals, and Company member payroll data. |
| `POST` | `/payroll/periods` | Owner creates a payroll period. |
| `PATCH` | `/payroll/entries/:entryId` | Authorized audited payroll adjustment. |
| `PATCH` | `/payroll/periods/:periodId/status` | Authorized payroll status transition. |

### 8. Notifications, alerts, chat, support, and reporting

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/alerts` | Role-safe Company alerts/events. |
| `PATCH` | `/alerts/:alertId/read` | Mark alert read. |
| `POST` | `/alerts/read-all` | Mark all eligible alerts read. |
| `GET` | `/notifications` | Current user notifications with cursor pagination. |
| `PATCH` | `/notifications/:notificationId/read` | Mark notification read. |
| `GET` | `/messages/conversations` | Company team and customer message conversations available to role. |
| `GET/POST` | `/messages/conversations/:conversationId/messages` | List/send messages with audit and moderation rules. |
| `GET/POST` | `/support/conversation` | Company support conversation and message submission. |
| `POST` | `/support/request-human-help` | Escalate support conversation. |
| `GET` | `/reports/dashboard` | Company role-specific dashboard metrics. |
| `GET` | `/reports/team-efficiency` | Owner/Operations Manager team efficiency and workload. |
| `GET` | `/reports/finance` | Owner-authorized finance report. |

### 9. Training, marketing, QR, and affiliate capabilities

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/training/modules` | Role-safe module list and current user progress. |
| `GET` | `/training/modules/:moduleId` | Module tools, steps, media, and completion state. |
| `POST` | `/training/modules/:moduleId/completion` | Mark permitted progress/completion. |
| `GET/POST/PATCH` | `/marketing/campaigns` and `/marketing/campaigns/:campaignId` | Authorized campaign operations. |
| `GET/POST/PATCH` | `/qr-codes` and `/qr-codes/:qrCodeId` | Authorized QR management. |
| `GET/POST/PATCH` | `/marketing-materials` and `/marketing-materials/:entryId` | Authorized material types and tracking entries. |
| `GET` | `/affiliate/overview` | Company affiliate overview. |
| `POST` | `/affiliate/enrollment` | Request program enrollment. |
| `PATCH` | `/affiliate/payout-email` | Update authorized payout email. |

### 10. Billing and Platform Admin APIs

Platform routes must require a Platform token and enforce existing platform roles. Any Company-specific Platform operation must carry an explicit Company identifier and audit actor, reason, and timestamp.

| Method | Route group | Required coverage |
|---|---|---|
| `GET` | `/platform/overview` | Portfolio overview, Company counts, operations, and role-safe metrics. |
| `GET/POST/PATCH` | `/platform/companies` and `/platform/companies/:companyId` | Company provisioning, account detail, subscription state, branding, notes, and lifecycle actions. |
| `GET/POST/PATCH` | `/platform/team` | Platform team management. |
| `GET/POST/PATCH` | `/platform/timesheets`, `/platform/time-off` | Platform workforce operations. |
| `GET/POST/PATCH` | `/platform/finance` | Platform finance records, subscription payments, and role-safe reporting. |
| `GET/POST/PATCH` | `/platform/affiliates` | Affiliate review, commission review, and payment status. |
| `GET/POST/PATCH` | `/platform/support` | Support inbox, conversations, replies, and status updates. |
| `POST` | `/platform/support-sessions` | Start/end audited Company support session; never reuse Company bearer credentials. |
| `GET/PATCH` | `/billing` and `/billing/portal-session` | Company billing overview and secure provider portal session. |

## Synchronization and Offline Requirements

1. Every mutable response must include `updatedAt` and a stable resource ID.
2. Add `GET /sync/changes?cursor=…` for Company sessions. It must return Company-scoped resource changes only, including members, jobs, customers, alerts, schedule updates, and notifications. Return a new cursor and support tombstones for deactivated/deleted records.
3. Add `GET /sync/changes?cursor=…` for Platform sessions with role-safe platform changes.
4. Add push-event registration endpoint: `POST /devices/push-tokens`; events should notify the client to refresh a resource without embedding sensitive data in the notification payload.
5. Use optimistic concurrency for edits through `updatedAt` or revision fields. Return `409` with the latest safe resource state for a conflict.
6. The mobile app may cache safe read data, but all writes must go to JobSync first. Do not maintain an independent authoritative mobile database.

## Required Integration Tests in JobSync

Create tests that run against the API layer and database fixtures. Do not declare this project complete until all pass.

1. A Company Owner can log in, retrieve only their Company, list only their active members, read a member profile, edit an allowed field, and see the changed data through both the web and mobile API paths.
2. A Company Owner cannot retrieve or edit a member, customer, job, vehicle, payroll entry, or booking from a different Company.
3. An Operations Manager can perform dispatch, team, time-off review, inventory, and permitted profile actions but cannot access Company billing/ownership controls.
4. A Detailer can clock in, start/end break, clock out, read only own time records, see assigned jobs, update permitted job status, request time off, and update own availability.
5. The time clock rejects double clock-in, overlapping breaks, clock-out during an active break unless business rules resolve it, and unauthorized corrections.
6. Calendar, job, customer, roster, and detailed profile reads return `application/json`; no valid or invalid API route may silently return SPA HTML.
7. Company roster changes, member profile changes, job assignment changes, and time-clock changes appear in `/sync/changes` with the correct Company boundary.
8. Platform users can access only their allowed platform APIs and all cross-Company actions are audited.
9. Existing web behavior continues to use the same service layer and database records; there is no separate mobile-only identity or operational data store.
10. Publish a short OpenAPI document at `/api/mobile/v1/openapi.json` and a JSON health endpoint at `/api/mobile/v1/health`.

## Required Delivery from the JobSync Project

1. Implement **all** route groups above in a single mobile API milestone; do not stop after authentication or Team Members.
2. Add request validation, authorization tests, Company-bound integration tests, and OpenAPI documentation.
3. Publish the JobSync deployment.
4. Provide the exact base URL, OpenAPI URL, route list, safe response examples, and any deliberate exclusions.
5. Do not claim completion until Clock In/Out, Break, Team Members, schedule, jobs, customer data, time off, notifications, and the role-specific dashboards work through the shared API.
