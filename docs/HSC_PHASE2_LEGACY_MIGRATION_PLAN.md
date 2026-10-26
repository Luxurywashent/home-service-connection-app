# HSC Phase 2 legacy migration plan

Not approved for implementation in this release. Legacy integrations stay in place until each replacement is tested against JobSync. Do not delete the Luxwash host constants, the Expo server, or the legacy database as part of Phase 1.

Company sessions already return before these legacy calls, or they show an unavailable screen. The data is not migrated. The features are missing on Mobile for a Company session.

## Company notes

Legacy: `jobs.addPrivateNote`, `jobs.editPrivateNote`, and `jobs.deletePrivateNote` on `https://luxwashapp-n2wveyqg.manus.space` from `app/(tabs)/schedule.tsx` and `app/(tabs)/admin-schedule.tsx`. A Company session renders no note editor.

JobSync authority: `fs_jobs.internal_notes` and `fs_jobs.service_notes`, updated through the existing Company job note path in `server/jobService.ts`. That field is one note per job, not a threaded author history.

Replacement:

- Add a Company-scoped mobile read and update for `internal_notes` on the JobSync job the employee is allowed to open.
- Keep the note inside `company_id` from the bearer.
- Preserve the legacy threaded editor for non-Company sessions until a Company note history, if required, is designed on JobSync. Do not copy Luxwash note rows into production during Phase 1.

Test before removing the legacy calls: a Company owner writes a note on Web, Mobile shows the same text, a technician in another company receives 404, and the Luxwash endpoint is not called.

## Receptionist

Legacy: `app/(tabs)/admin-receptionist.tsx` and `server/receptionistRouter.ts` target the Luxwash host for Twilio webhooks. A Company session shows "Receptionist is not available in Home Service Connected yet" and does not send Company data.

JobSync authority: the Company call-log router already mounted in `server/fieldServiceRouter.ts` (`callLogs`). Twilio webhooks, if enabled, must be registered on the JobSync host for that company, not on the Luxwash host.

Replacement:

- Point Company receptionist setup at the JobSync call-log and webhook contract.
- Store call records with `company_id`.
- Leave the Luxwash Twilio URL in the legacy employee screen until a Company call can be placed and read back on Web and Mobile.

Test before removal: one Company call is visible only to that company, and the Luxwash webhook is not used.

## Company invoice delivery

Legacy: `POST https://luxwashapp-n2wveyqg.manus.space/api/invoice/send` from `app/(tabs)/admin-schedule.tsx`. A Company session stops and tells the user invoice delivery is not published. It does not call the legacy URL.

JobSync authority: `jobs.sendInvoice` and `jobs.resendInvoice` in `server/fieldServiceRouter.ts`, limited to owners and dispatchers, and the public invoice page `PublicInvoicePage` via `publicRevenue`. Payments stay on the existing `fs_job_payments` path. Do not change payment calculation or Stripe behavior in this phase.

Replacement:

- Mobile invoice send for a Company owner or dispatcher calls the existing JobSync send mutation.
- Technicians do not send invoices.
- The customer payment page remains the JobSync `/invoice/:token` page.

Test before removal: a test-company invoice email or link opens the JobSync public invoice, the amount matches the job, and no request reaches the Luxwash invoice route.

## Customer history

Legacy: `jobs.customerHistory` on the Luxwash host, searched by phone or email, from both schedule screens. Company sessions return before the fetch.

JobSync authority: `fs_customers` and `fs_jobs` for the same `company_id`. History is the Company's jobs for that customer id, not a phone search across the legacy `schedule_jobs` table.

Replacement:

- Mobile job detail for a Company session loads prior jobs through the JobSync customer and job APIs.
- Match the customer by Company customer id. Do not query another company's customers by phone.

Test before removal: two companies with the same phone number each see only their own jobs.

## Employee performance

Legacy: `performance.getByDate` on the Luxwash host, called while completing a legacy job. Company sessions do not take that branch.

JobSync authority: completed `fs_jobs` amounts and `fs_clock_records` hours for the company and member. This is a read model. Do not change `createPayrollPeriod` or any payroll calculation.

Replacement:

- A Company performance view reads completed job value and clock hours from those JobSync tables, in the company timezone.
- It does not write payroll rows and does not read the legacy performance table.

Test before removal: a completed test job and a closed test shift appear on Web and Mobile with the same totals, and payroll period totals are unchanged.

## Exit rule

Remove a legacy call only after its test above passes on a disposable company. Until then the Company session must keep refusing the legacy host. The Luxwash database and the Expo server remain for the separate legacy employee product.
