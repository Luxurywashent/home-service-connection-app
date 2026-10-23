# HSC Phase 1 blocker resolution

Checked 2026-10-18. Production deployment remains **NOT APPROVED**. No migration was applied. No production data was written. Payments and payroll were not modified.

## 1. Blockers resolved

- **Deployment service.** `www.homeserviceconnected.com` and `jobwash-veysiubh.manus.space` are Manus Publish surfaces. The `.manus.space` host is the JobSync project URL. The `www` host is the custom domain for that published project. GitHub has no environments and no deploy workflow for JobSync. GitHub Actions only runs tests and a build.
- **Application database selector.** JobSync `getDb()` and `getPortalDb()` both use one variable, `DATABASE_URL`. There is no second Company database selector in the server.
- **Development authorization.** The unreleased dashboard and timesheet handlers were exercised over HTTP with two isolated in-memory companies. Owners and dispatchers received their own company's booked and collected figures. Technicians were refused revenue and another employee's timesheet. Company A did not receive Company B's rows. A token role that disagrees with the live membership role follows the live role. See `server/phase1.mobileAuthz.isolation.test.ts` (5 tests passed).
- **Phase 2 scope.** The replacement plan for notes, receptionist, invoice delivery, customer history, and employee performance is in `docs/HSC_PHASE2_LEGACY_MIGRATION_PLAN.md`. Legacy code was not removed.

## 2. Blockers still open

- The current Manus environment value of `DATABASE_URL` was not readable. Cursor hides this environment's config from the agent, and GitHub cannot list the repository secrets. Hostname and schema for each public host are therefore still unconfirmed.
- `uq_fs_clock_records_open_shift` was not checked on the live schema. Duplicate open shifts were not counted.
- No disposable database was available, so an isolated test company and employee were not created and the Web-to-Mobile procedure was not executed.
- Physical-device GPS was not run.
- Production approval has not been given.

Source records, which are not a live `SELECT DATABASE()`:

- JobSync harnesses refuse schema `VEYsiubhaQf4okP5MRdf9b` as the production database id.
- A past environment note names hostname `gateway04.us-east-1.prod.aws.tidbcloud.com` as the host `DATABASE_URL` pointed at then.
- Local historical Luxury Wash query logs use a different host, `gateway05.us-east-1.prod.aws.tidbcloud.com`, and a different schema. That is the legacy database, not the JobSync binding.

## 3. Access required

1. Read-only Manus project settings for the JobSync project that publishes `jobwash-veysiubh.manus.space`, and for the custom-domain binding of `www.homeserviceconnected.com` if it is a separate project. Report only the `DATABASE_URL` hostname and schema name for each. Do not send the user, password, or full URL.
2. A read-only MySQL account on that JobSync schema, used only for `SELECT DATABASE()`, `SHOW INDEX FROM fs_clock_records`, the generated-column definition, and the duplicate-open preflight below. Do not use the Luxury Wash database.
3. A disposable schema that is not `VEYsiubhaQf4okP5MRdf9b`, plus a non-production JobSync process, before any test company or employee is created. Do not create those records in production without a separate approval.
4. A physical technician phone after the disposable environment exists, for the GPS step.
5. Separate approval before the clock-index migration, and separate approval before any deploy.

## 4. Tests passed and not verified

Passed in development:

- Owner of company 11 receives booked `1100` and collected `110`.
- Dispatcher of company 11 receives the same figures.
- Technician of company 11 receives 403 on `GET /api/mobile/v1/dashboard/summary`.
- That technician receives 403 for another member's timesheet and only their own row otherwise.
- Company 22's owner receives booked `2200` and collected `220`. Company 11's owner does not receive the South technician's timesheet, and a request for company 22's member id returns 404.
- A bearer minted as owner is refused when the live role is technician. A bearer minted as technician is allowed when the live role is owner.

Not verified:

- Live hostname and schema of each public host.
- Production presence of `uq_fs_clock_records_open_shift`.
- Duplicate open shifts on the live table.
- Web-to-Mobile clock, timesheet, job, and revenue comparison against a real company.
- Interrupted clock-in against a real server.
- Physical-device GPS.
- The same authorization cases against production or a real disposable database.

## 5. Migration requiring approval

`migrations/20261003_fs_clock_records_open_shift_lock.sql` is the only database change still proposed. It adds virtual column `open_shift_lock_key` and unique key `uq_fs_clock_records_open_shift`. It is **not approved** and was not applied.

Apply it later only if a read-only `SHOW INDEX` shows the key is absent and this preflight returns zero rows:

```sql
SELECT company_id, member_user_id, COUNT(*) AS open_count
FROM fs_clock_records
WHERE clock_out IS NULL AND member_user_id IS NOT NULL
GROUP BY company_id, member_user_id
HAVING COUNT(*) > 1;
```

If that query returns rows, stop. Do not delete or close shifts as part of the migration.

## 6. Controlled production release

**No.** Phase 1 is not ready for a controlled production release.

The Web-to-Mobile procedure to run after a disposable company exists is unchanged from `docs/HSC_PHASE1_PREPRODUCTION_VERIFICATION.md`: clock in and out both ways, create one Web job and read it on Mobile, compare booked and collected revenue, interrupt one clock-in, publish GPS from a physical device, and repeat the company A / company B checks against that database.
