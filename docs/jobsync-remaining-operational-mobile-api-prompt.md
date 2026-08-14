# JobSync Remaining Operational Mobile API Prompt

## Copy This into the Original JobSync Web-App Project

> **Do not rebuild authentication or Team Members.** Home Service Connection mobile already uses the shared JobSync bearer login/session flow and the Company Team Member roster, detailed member profile, and member update routes. The remaining problem is that the mobile app’s operational controls still point at copied local logic, so Clock In/Out, Breaks, schedules, jobs, customers, and other actions do not work against JobSync.

Build and publish the remaining **operational** mobile API under:

```text
https://jobwash-veysiubh.manus.space/api/mobile/v1
```

Use the existing bearer access token issued by the current mobile login endpoint. Every Company route must derive `companyId` from the token, never from an untrusted client parameter. Reuse the existing JobSync service/database rules already used by the web app; do not create a mobile-only data store.

## Already Complete — Do Not Duplicate

| Completed mobile capability | Existing shared route family |
|---|---|
| Company and Platform Admin email/password login | `/auth/login`, `/auth/session`, existing bearer session flow |
| Company Team Member roster | `/company/team-members` |
| Team Member detail profile | `/company/team-members/:memberId` |
| Team Member identity edit | `PATCH /company/team-members/:memberId` |
| Company context and signed-in Company name | Existing session/Company response |

## Implement These Remaining Operational API Domains

### 1. Time Clock, Clock Out, and Breaks — Highest Priority

The mobile Clock In/Out and Break buttons currently do not work. Build this group first, but ship it with the rest of the groups below.

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/time/current` | Return current user’s clock state, active break, clock-in time, today’s paid hours, and allowed next actions. |
| `POST` | `/time/clock-in` | Clock in authenticated user using server time; reject duplicate clock-ins. |
| `POST` | `/time/clock-out` | Clock out authenticated user; apply existing active-break rule and return finalized time entry. |
| `POST` | `/time/breaks/start` | Start an authorized break. |
| `POST` | `/time/breaks/end` | End current active break. |
| `GET` | `/time/timesheets` | Current user history; Owner/Operations Manager may filter authorized Company members and date range. |
| `PATCH` | `/time/timesheets/:entryId` | Authorized correction with actor, reason, audit record, and existing approval rules. |
| `GET` | `/time/team-summary` | Owner/Operations Manager Company attendance, active clock status, hours, and exceptions. |

### 2. Schedule, Dispatch, Jobs, and Booking Capacity

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/schedule?start=&end=` | Company calendar lanes, jobs, unassigned work, assigned member, status, customer summary, and time window. |
| `GET` | `/schedule/availability` | Company booking capacity/available technicians for date, service, and service area. |
| `GET` | `/jobs` | Company jobs with date/status/assignee/search/cursor filters. |
| `POST` | `/jobs` | Owner/Operations Manager creates Company job. |
| `GET` | `/jobs/:jobId` | Full safe job detail: customer, service, line items, materials, assignment, timeline, notes, payment state, and permitted actions. |
| `PATCH` | `/jobs/:jobId` | Authorized job edit. |
| `PATCH` | `/jobs/:jobId/assignment` | Assign/unassign active members in same Company only. |
| `PATCH` | `/jobs/:jobId/status` | Enforce existing valid status transitions with actor/time metadata. |
| `PATCH` | `/jobs/:jobId/schedule` | Reschedule using Company conflict checks. |
| `POST` | `/jobs/:jobId/check-in` | Technician arrival/check-in. |
| `POST` | `/jobs/:jobId/check-out` | Technician completion/check-out. |
| `POST` | `/jobs/:jobId/inspection` | Save a Company job/vehicle inspection. |
| `POST` | `/jobs/:jobId/photos` | Secure before/after photo upload. |
| `GET` | `/dispatch/board` | Owner/Operations Manager dispatch board. |
| `PATCH` | `/dispatch/jobs/:jobId/move` | Dispatch drag/move/reassignment operation. |
| `POST` | `/dispatch/location` | Authorized workforce location update with retention policy. |
| `GET` | `/bookings` | Company online bookings and conversion status. |
| `PATCH` | `/bookings/:bookingId/status` | Authorized booking approval/conversion/status update. |

### 3. Customers, Estimates, Leads, Payments, and CRM

| Method | Route group | Required behavior |
|---|---|---|
| `GET/POST` | `/customers` | List/create Company customers. |
| `GET/PATCH` | `/customers/:customerId` | Safe profile, preferences, history, jobs, and authorized update. |
| `GET/POST` | `/customers/:customerId/communications` | Communication history/logging. |
| `GET/POST` | `/estimates` | Company estimates. |
| `GET/PATCH` | `/estimates/:estimateId` | Estimate detail/status update. |
| `POST` | `/estimates/:estimateId/convert` | Convert estimate to Job using existing JobSync rules. |
| `GET/POST/PATCH` | `/leads` and `/leads/:leadId` | Company lead inbox, assignment, and update. |
| `GET` | `/payments/unpaid-jobs` | Authorized unpaid-job queue. |
| `GET/POST` | `/payments` | Payment history and recording through existing payment business rules only. |

### 4. Time Off, Notifications, Communications, and Support

| Method | Route group | Required behavior |
|---|---|---|
| `GET/POST` | `/time-off` | Current user time-off history/request; privileged roles list Company requests. |
| `PATCH` | `/time-off/:requestId/review` | Owner/Operations Manager approval/denial with note. |
| `GET` | `/alerts` | Role-safe Company alerts and operational events. |
| `PATCH` | `/alerts/:alertId/read` | Mark alert read. |
| `POST` | `/alerts/read-all` | Mark all eligible alerts read. |
| `GET/PATCH` | `/notifications` and `/notifications/:notificationId/read` | Current user notifications and read state. |
| `GET/POST` | `/messages/conversations` and `/messages/conversations/:conversationId/messages` | Role-safe Company conversations and messages. |
| `GET/POST` | `/support/conversation` | Company support thread and replies. |
| `POST` | `/support/request-human-help` | Escalate support request. |

### 5. Operations: Inventory, Price Book, Fleet, Payroll, Reports, and Training

| Method | Route group | Required behavior |
|---|---|---|
| `GET` | `/price-book` | Company price book and service catalog. |
| `POST/PATCH` | `/price-book/items` | Authorized Company item management. |
| `GET` | `/inventory` | Company inventory and low-stock state. |
| `POST` | `/inventory/:itemId/adjustments` | Audited authorized adjustment. |
| `GET` | `/fleet/vehicles` and `/fleet/vehicles/:vehicleId` | Company fleet, assigned member, condition, inspection, and maintenance summary. |
| `PATCH` | `/fleet/vehicles/:vehicleId/assignment` | Authorized vehicle assignment/unassignment. |
| `GET/POST/PATCH` | `/payroll/periods`, `/payroll/entries/:entryId` | Owner-authorized payroll periods, entries, adjustments, and status. |
| `GET` | `/reports/dashboard` | Role-specific Company dashboard metrics. |
| `GET` | `/reports/team-efficiency` | Owner/Operations Manager workload and efficiency. |
| `GET` | `/reports/finance` | Owner-authorized finance report. |
| `GET` | `/training/modules` and `/training/modules/:moduleId` | Training modules and current member progress. |
| `POST` | `/training/modules/:moduleId/completion` | Authorized progress/completion update. |

### 6. Company Settings, Devices, and Synchronization

| Method | Route | Required behavior |
|---|---|---|
| `GET` | `/company` | Existing safe Company branding/context. |
| `GET/PATCH` | `/company/settings` | Owner-only settings, policies, booking rules, and feature configuration. |
| `POST` | `/devices/push-tokens` | Register/remove device push token for current authenticated user. |
| `GET` | `/sync/changes?cursor=` | Company-scoped changed resources: time clock, members, jobs, customers, alerts, notifications, bookings, and assignments. Return a new cursor and tombstones. |

### 7. Platform Admin Operational APIs

Use existing Platform bearer tokens and existing platform roles. Build adapters only for mobile screens that already exist or will exist in Home Service Connection.

| Route group | Required coverage |
|---|---|
| `/platform/overview` | Portfolio metrics and operational overview. |
| `/platform/companies` | Company list/detail, lifecycle, subscription state, notes, and provisioning actions. |
| `/platform/team`, `/platform/timesheets`, `/platform/time-off` | Platform workforce operations. |
| `/platform/finance`, `/platform/affiliates`, `/platform/support` | Finance, affiliates, support inbox, and audited Company support sessions. |

## Required Rules

1. **Use existing JobSync business logic and tables.** Do not create a second mobile database or copied employee records.
2. **Every Company endpoint derives Company context from the bearer token.** Never trust `companyId` sent by mobile.
3. **Return JSON on every API response.** Unknown/mobile-invalid API paths return JSON `404`, never SPA HTML.
4. **Use stable IDs and `updatedAt` values** in mutable resources. Return `409` on conflicting updates.
5. **Do not expose** password/PIN hashes, salts, payment secrets, support tokens, or private platform credentials.
6. Publish `/api/mobile/v1/openapi.json` documenting all routes, schemas, permissions, and error envelopes.
7. Add `GET /api/mobile/v1/health` returning JSON health/version data.

## Required Tests Before Publishing

1. A technician can clock in, start/end a break, clock out, and retrieve the same time entry shown on web.
2. A technician cannot access another Company’s member, job, customer, time entry, vehicle, or payroll data.
3. An Owner/Operations Manager can schedule, assign, and move a Company job; the web schedule and mobile API return the same updated job.
4. A Company member profile, assignment, job status, booking, and clock event appear through `/sync/changes` with the correct Company boundary.
5. A Company API route always returns JSON, including 401/403/404 error cases.
6. Platform roles can access only their permitted Platform resources and cross-Company activity is audited.

## Delivery Required

1. Implement every route group above as one operational mobile API milestone.
2. Publish the JobSync deployment.
3. Return the base URL, OpenAPI URL, route list, role matrix, and safe sample responses.
4. Do not claim success until Clock In/Out, Breaks, schedule, jobs, customers, notifications, time-off, and role dashboards work through the shared JobSync API.
