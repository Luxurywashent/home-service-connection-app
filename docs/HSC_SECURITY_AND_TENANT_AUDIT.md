# HSC Security and Tenant Audit

Audit date: 2026-10-17. This is a source review. Company A versus Company B was **not** executed against a database in this audit. Existing automated tests in `repos/jobsync` encode that isolation and were not re-run here.

Removing a `company_id` check to "make mobile match web" would be an incident, not a fix.

## Where isolation is enforced

JobSync is the enforcement point. The UI is not.

| Gate | What it trusts | What it refuses |
|---|---|---|
| `tenantProcedure` in `server/fieldServiceRouter.ts` | Cookie JWT, then a live `company_users` row: `id = ? AND company_id = ? AND is_active = 1`, and the live role | A body or query `companyId` is not the tenant id. Services take `session.companyId`. |
| `requireMobileCompany` in `server/mobileAuth.ts` | Bearer JWT `companyId` and `accountId`, then `companyProfile` membership | A client-supplied company id. Role on the token is replaced with the live role (`withLiveMembershipRole`). |
| `jobService` / `paymentService` / `timeClockService` / `dispatchService` | `company.companyId` from that context | `WHERE id = ? AND company_id = ?` on mutations that were read for this audit |
| `technicianScopeSql` | Technician role | Dashboard and job lists add `assigned_user_id = session user` for technicians |
| `publishTechnicianLocation` | Technician role only | Owners and dispatchers cannot publish a point as themselves through that function |
| Platform admin procedures | Platform session | May pass `companyId` **by design** for support. That is not a tenant procedure. |

Web technicians are blocked from some owner/dispatcher procedures and told to use mobile. Mobile technicians call the REST API with the same company id from the token.

## Legacy plane has no tenant key

`drizzle/schema.ts` in the Expo server has employees, jobs, clock rows, locations, customers, and invoices **without** `company_id`. Any caller who can reach that tRPC API sees that deployment's single dataset.

Company mode turns many of those hooks off (`enabled: !jobSyncSession`). That is a client flag. The legacy procedures still exist. `schedule.tsx` still calls `https://luxwashapp-n2wveyqg.manus.space` for some booking and note routes. Those requests are outside JobSync's company predicate.

**Confirmed risk:** a Company phone can still touch the legacy host for the calls that were not gated. Whether that host is reachable and what auth it requires is **not verified**.

**Correction:** delete or gate those fetches. Do not point them at JobSync by stripping auth.

## Checks requested

| Check | Result |
|---|---|
| Company A cannot read Company B jobs, payments, clock rows, or locations through JobSync services | **Confirmed in source** for the procedures read (`company_id` predicate plus session company). **Not re-tested** at runtime. Repo tests such as `server/phase5d.dashboardEod.test.ts` expect separate booked revenue for two companies. |
| Company A cannot update Company B rows | **Confirmed in source** for job, clock, and payment mutations that include `company_id` in the `WHERE` clause. Runtime **not executed**. |
| Employees cannot open owner functions | **Confirmed in source.** `requireManager` on dispatch, finance, team timesheet summary, payroll list. Technician job scope. A full button-by-button matrix was **not verified**. |
| API cannot switch company by a parameter | **Confirmed** for mobile `requireMobileCompany` and web `tenantProcedure`. Platform admin is the exception. |
| Financial rows stay in the company | **Confirmed in source** on `fs_job_payments`, refunds, and finance ledger queries that take `company_id`. |
| GPS and employee rows stay in the company | **Confirmed in source** on `fs_technician_locations` and `company_users` queries. Latest-point query filters `company_id`. It does not filter age. |
| Legacy database | **Fails** the company test by schema. There is nothing to filter on. |

## Session notes

| Topic | Finding |
|---|---|
| Mobile token length | 30 days. Logout must delete SecureStore `hsc_jobsync_mobile_bearer_v1`. A stolen token works until expiry or until membership is deactivated, because each request reloads `is_active`. |
| Web cookie | `hsc_company_session`. Revalidated against the user row. |
| Error text | Mobile `requestJson` fallback for a non-401 with an empty body says authentication is unavailable. That can send a user through a login reset for a 503. It does not bypass auth. |
| Clock 409 | "You are already clocked in." does not grant access to another member's row. The lookup is company id plus member id. |
| Support sessions | `kind: "platform_support"` is a separate path with `assertActiveSupportSession`. Not fully traced in this audit. |

## Privacy of location

Showing an unbounded last GPS point is a product bug and a privacy bug. The row is still company-scoped. The fix is a freshness filter, not a wider query.

Technician coordinates must stay on the dispatch surface for that company. Do not write them into the legacy `detailer_locations` table, which has no company id.

## What not to do

- Do not accept `companyId` from the mobile query string to "help" a shared component.
- Do not disable `tenantProcedure` so a technician can see the web dashboard.
- Do not merge legacy rows into `fs_*` without a company id and a reviewed backfill. That backfill is out of scope until someone proves those rows belong to a known company.
- Do not log bearer tokens while fixing the clock timeout.
