# HSC API and Database Connection Map

Audit date: 2026-10-17. No database connection was opened. Table names come from SQL in services and from `migrations/` plus the legacy Drizzle schema.

## Connection map

| Client call | Server | Handler | Tables | Owner |
|---|---|---|---|---|
| Web dashboard | JobSync `/api/trpc` `dashboard.summary` | `dashboardRouter.summary` | `fs_jobs`, `companies.timezone`, `fs_price_book`, `company_users`, `fs_job_payments`, `fs_job_payment_refunds`, `fs_estimate_payments`, `fs_company_settings` | JobSync. This is the metric owner. |
| Web timesheets | `operations.clockRecords`, `operations.timesheets` | `fieldServiceRouter.ts`, `timesheetService.queryCompanyTimesheets` | `fs_clock_records`, `company_users` | JobSync |
| Web clock | `operations.clockIn`, `clockOut`, breaks | `timeClockService.ts` | `fs_clock_records` | JobSync |
| Web payroll draft | `operations.createPayrollPeriod` | inline SQL in `fieldServiceRouter.ts` | `fs_payroll_periods`, `fs_payroll_entries`, `fs_jobs`, `company_users` | JobSync. Hours come from job schedule, not clock rows. |
| Web dispatch map | `dispatch` board | `dispatchService.getDispatchBoard` | `fs_jobs`, `company_users`, `fs_technician_locations` | JobSync |
| Web payments | `payments` / `operations` payment procedures | `paymentService.ts` | `fs_job_payments`, `fs_job_payment_refunds`, `fs_estimate_payments`, `fs_finance_transactions` | JobSync `paymentService` for money. `financeService` for the ledger. |
| Mobile Company login | `POST /api/mobile/v1/auth/login` | `mobileAuth.ts` | `company_users`, `companies` | JobSync |
| Mobile jobs | `GET/POST /api/mobile/v1/company/jobs`, `PATCH .../status`, `.../assignment`, `.../schedule` | `mobileOperations.ts` → `jobService.ts` | `fs_jobs`, `fs_customers`, `company_users` | JobSync |
| Mobile Operations Overview | `GET /api/mobile/v1/company/jobs` then **client math** | Same list handler | `fs_jobs` only | **No owner.** The screen invents revenue. |
| Mobile finance panel | `GET /api/mobile/v1/finance` | `getMobileFinanceSummary` | ledger + payment projection | JobSync, but `bookedRevenue` is all-time billed total |
| Mobile clock | `POST /api/mobile/v1/time/clock-in`, `clock-out`, `GET /time/current` | `clockIn` → `clockInMember` | `fs_clock_records` | JobSync |
| Mobile timesheets | `GET /api/mobile/v1/time/timesheets`, `GET /time/team-summary` | `timesheets`, `teamSummary` | `fs_clock_records` | JobSync table, **narrower query** than web |
| Mobile GPS publish | `POST /api/mobile/v1/dispatch/location` | `updateLocation` → `publishTechnicianLocation` | `fs_technician_locations` | JobSync. **No Expo caller.** |
| Mobile payments | `POST /api/mobile/v1/jobs/:jobId/payments`, `POST .../checkout` | `recordPayment`, checkout | `fs_job_payments` | JobSync |
| Mobile legacy schedule / clock / map | `/api/trpc` on the Expo server | `server/routers.ts` | `schedule_jobs`, `clock_in_out_records`, `detailer_locations`, `daily_performance`, `employees` | Legacy database. Not company-scoped. |
| Mobile hardcoded booking/notes | `https://luxwashapp-n2wveyqg.manus.space` | Remote legacy server, not this workspace's running process | Legacy tables on that deployment | **Not verified** that the deployment is still the legacy app |

Duplicate mobile mounts (`/jobs` and `/company/jobs`, `/schedule`) call the same handlers. They are aliases, not a second version.

## Environment variables that choose the system

| Name | Repo | Effect |
|---|---|---|
| `DATABASE_URL` | Both servers | Each deployment's MySQL. Same variable name does not mean the same database. |
| `JWT_SECRET` | JobSync | Signs web cookies and mobile bearers. |
| `EXPO_PUBLIC_JOBSYNC_API_BASE_URL` | Expo, set in `eas.json` production to `https://jobwash-veysiubh.manus.space` | Company API host if the host is allowlisted. |
| Default in `resolveJobSyncBaseUrl` | Expo | `https://www.homeserviceconnected.com` when unset or not allowlisted. |
| `EXPO_PUBLIC_API_BASE_URL` | Expo | Legacy tRPC origin. |
| `EXPO_PUBLIC_API_URL` | Expo | Fallback `http://127.0.0.1:3000` for cache version and geofence. |
| Hardcoded `APP_API_BASE` | Expo schedule | Always the Luxury Wash Manus host. |

Allowlisted JobSync hosts in code: `homeserviceconnected.com`, `www.homeserviceconnected.com`, `jobwash-veysiubh.manus.space`, plus localhost outside production.

## JobSync tables used by the critical paths

| Table | Keys | Used for |
|---|---|---|
| `companies` | `id`, `timezone`, plan, Stripe billing columns | Tenant and timezone |
| `company_users` | `id`, `company_id`, `member_id`, `role`, `hourly_rate`, `upsell_bonus_pct` | Login, assignment, payroll rate |
| `company_feature_flags` | `company_id`, `feature_key` | Plan overrides, mobile tabs |
| `fs_customers` | `id`, `company_id`, `stripe_customer_id` | Customers and saved Stripe customer |
| `fs_jobs` | `id`, `company_id`, `customer_id`, `assigned_user_id`, `amount`, `status`, `scheduled_start_at`, `completed_at`, `payment_status` | Jobs, booked revenue, completed value, payroll hours |
| `fs_job_payments` | `company_id`, `job_id`, `idempotency_key` | Collected gross |
| `fs_job_payment_refunds` | `company_id`, `job_id`, `payment_id` | Collected net |
| `fs_estimate_payments` | `company_id`, `estimate_id`, `applied_job_id` | Credits |
| `fs_finance_transactions` | `company_id`, `source_type` | Ledger income and expense. Not booked revenue. |
| `fs_clock_records` | `company_id`, `member_user_id`, `date`, `clock_in`, `clock_out`, `approval_status` | Clock and timesheets |
| `fs_payroll_periods`, `fs_payroll_entries` | `company_id` | Pay drafts |
| `fs_technician_locations` | `company_id`, `user_id`, `recorded_at` | GPS |
| `fs_price_book` | `company_id` | Service price and cost |
| `fs_audit_logs` | `company_id` | Finance and other audits |

`fs_invoices` is not the invoice system. The job is the invoice.

## Legacy tables that must not be treated as Company truth

From `home-service-connection-app/drizzle/schema.ts`. No `company_id` column exists in that schema.

| Table | Collision with JobSync |
|---|---|
| `employees` | Not `company_users` |
| `schedule_jobs` | Not `fs_jobs`. Has `total_price`, `upsell_total`, `discount_amount`, `tips`, `tax_amount` |
| `clock_in_out_records`, `break_records` | Not `fs_clock_records` |
| `detailer_locations` | Not `fs_technician_locations` |
| `daily_performance` | Not dashboard SQL |
| `customers` | Not `fs_customers` |
| `refund_records` | Not `fs_job_payment_refunds` |
| `standalone_invoices` | Not the job-as-invoice model |

## Status vocabularies

| JobSync `fs_jobs.status` | Legacy `schedule_jobs.status` | Operations Overview filter |
|---|---|---|
| `draft` | — | excluded |
| `scheduled` | closest to `confirmed` / `pending` | excluded |
| `en_route` | — | excluded |
| `on_site` | closest to `in_progress` | excluded |
| `completed` | `completed` | included |
| `follow_up` | — | excluded |
| `cancelled` | `cancelled` | excluded |
| — | `confirmed`, `in_progress`, `pending` | `confirmed` and `in_progress` included |

## Sync direction

| Action | Writes | Visible on the other app |
|---|---|---|
| Web job edit | `fs_jobs` | Mobile job list after sync revision or the next jobs fetch. Operations Overview still mis-counts it. |
| Mobile job status | `fs_jobs` via `jobService` | Web after React Query refetch (about 30–60s) |
| Mobile Company clock-in | `fs_clock_records` | Web timesheets, if the member and company date match the web week query |
| Web timesheet edit | `fs_clock_records` | Mobile only for that member, and approval is omitted |
| Mobile legacy clock-in | `clock_in_out_records` | **Not** on the web portal |
| Payment on either Company client | `fs_job_payments` | The other client's payment screens. Operations Overview revenue does not include payments. |
| GPS from legacy app | `detailer_locations` | **Not** on the web dispatch board |
| GPS from Company mobile | nowhere today | Web board stays empty or stale |
