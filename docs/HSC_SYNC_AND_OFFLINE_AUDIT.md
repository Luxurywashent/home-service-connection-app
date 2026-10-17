# HSC Sync and Offline Audit

Audit date: 2026-10-17. No new realtime system is recommended. The failures are wrong queries, wrong hosts, and missing reconciliation after a timeout. Polling is already in place.

## How updates move today

| Channel | Where | Interval | What it does |
|---|---|---|---|
| React Query refetch | Web `Dashboard.tsx` | 60s | Reloads `dashboard.summary` |
| React Query refetch | Web schedule / dispatch | about 30s | Reloads the board |
| React Query refetch | Web timesheets | 60s | Reloads clock records |
| React Query refetch | Web chat | about 8–15s | Reloads messages |
| `staleTime` | `client/src/main.tsx` | 30s | Keeps cached web data briefly |
| Clock refresh | `CompanyClockStatus` | 30s and on sync revision | `GET /api/mobile/v1/time/current` |
| Company sync | `lib/jobsync-sync-context.tsx` | 45s, plus NetInfo reconnect, plus AppState foreground | `GET /api/mobile/v1/sync`, stores cursor `hsc_jobsync_sync_cursor_v1:{companyId}`, increments `revision` |
| Legacy location poll | `admin-dashboard.tsx`, fleet map | 30s | `location.getActive`, **disabled** for Company sessions |
| Legacy schedule cache | `schedule.tsx` | on fetch | AsyncStorage `tlw_schedule_jobs_v9_*`. Failures are silent. |
| WebSocket / SSE | — | — | **Not found** for jobs, clock, or payments |

The sync endpoint returns changed ids. Screens that subscribe to `revision` refetch. Screens that keep their own `useEffect` with only `[token, start, end]` do not. Operations Overview jobs load in a `useEffect` that does **not** list `revision`. A web booking can sit on the mobile dashboard until the screen remounts.

## Offline rules that exist

| Action | Offline behavior | Safe? |
|---|---|---|
| Company clock-in / out / break | Live `fetch` only. No queue. | Safe against duplicates only because the server rejects a second open shift. Unsafe because a timeout can hide a success. |
| Company payment | `company-collect-payment.tsx` posts to JobSync. Server payment idempotency key exists in `paymentService.ts`. | Mobile retry wiring was **not executed**. Do not assume the client sends a stable key. |
| Company job create | Live POST. Retry duplicate risk **not verified**. | Needs an idempotency key before offline retry is allowed. |
| Legacy schedule | AsyncStorage shows the last jobs. Mutations that fail do not get a visible pending badge. | The cache can disagree with both servers. |
| Legacy clock | No queue. GPS failure still clocks in on the legacy path. | Can write `clock_in_out_records` with no coordinates. |

There is no SQLite database and no general mutation outbox.

## Required behavior, mapped to current gaps

| Requirement | Today | Change that fits |
|---|---|---|
| Refresh after a successful write | Clock status calls `refresh()` after a resolved POST. Job dashboard does not listen to sync `revision`. | Pass `revision` into the Operations Overview effect. Keep web invalidation on payment and timesheet mutations. |
| Cross-device visibility | Polling only | Keep polling. A socket is not required for 30–60s admin screens. |
| Recover after a drop | Sync refresh on NetInfo reconnect | Clock timeout must reconcile with `GET /time/current` instead of stopping at the error string. |
| Detect stale cache | Sync cursor exists. Dashboard revenue has no "as of" time. Map points have no age. | Show `lastSyncedAt` on money and map screens. Drop locations older than the agreed window. |
| Prevent duplicate writes | Open-shift lock and payment idempotency on the server | Client must reuse one key per user action. Abort or confirm in-flight clock and payment calls. |
| Pending vs confirmed | Not shown. Timeout is an error. "Already clocked in" becomes "On shift". | Three states: confirmed from server, pending request, failed. |
| Conflicting edits | Job status can send `expectedUpdatedAt` (`updateJobSyncCompanyJobStatus`). Timesheet edits last-write the row. | Keep the job precondition. Timesheet edits should send the row version or `updated` timestamp. **Not verified** that every mobile job mutation sends it. |
| Tenant isolation | Sync cursor key includes `companyId`. Queries take company id from the session. | Do not cache one company's jobs under a key that omits company id. Legacy `tlw_schedule_jobs_v9_*` is keyed by employee id, not company id. |
| Background traffic | 30s and 45s polls while the app is in use | Do not add a GPS upload until a technician is clocked in. Stop the upload on clock-out. |

## Clock-in state machine to implement later

Do not implement in this audit. The safe contract is:

1. User taps Clock In. UI shows **Pending**. Do not show "On shift".
2. POST `/api/mobile/v1/time/clock-in` with a client-generated idempotency key stored for that tap. The server already blocks a second open row; the key stops a duplicate if the unique index were ever dropped. Adding the key is a later change and needs a migration review.
3. On HTTP 201, replace pending with the server entry.
4. On HTTP 409 "already clocked in", GET `/time/current` and show that entry.
5. On timeout or network error, GET `/time/current` before deciding. If an open row exists that was not there before the tap, show it as confirmed. If not, show the error and stay clocked out.
6. Never persist a local "clocked in" flag that outlives a failed refresh.

## Realtime recommendation

Do not add WebSockets for dashboard revenue or timesheets. The web and mobile pollers are enough once they request the same payload.

GPS is the one stream that is naturally periodic. A technician who is clocked in can POST a point every few minutes. That is a normal request, not a new broker. Readers must ignore points older than the freshness window.

Chat can stay on its short poll until message latency is a measured problem. It is not the cause of the four incidents.
