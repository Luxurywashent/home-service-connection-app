# HSC Mobile Reconciliation Matrix

**Baseline:** `Luxurywashent/home-service-connection-app:main` at `3a30e6f07a18…`  
**Manus comparison source:** `/home/ubuntu/mobile-hsc`  
**Rule:** Each decision is capability-scoped. No whole-tree overwrite is permitted.

| File | Capability | GitHub behavior | Manus behavior | Chosen behavior | Merge strategy | Tests required | Risk |
|---|---|---|---|---|---|---|---|
| `app.config.ts` | Expo config | Enables config keys unsupported by installed SDK typings. | Removes unsupported `newArchEnabled` and `edgeToEdgeEnabled`. | **KEEP Manus** | `mobile-config` selective patch. | Type check; Expo config inspection. | Low |
| `app/(customer)/_layout.tsx` | Customer navigation typing | Accepts `string` only for tab color. | Accepts React Native color value. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `app/(customer)/home.tsx` | Customer home rendering | Uses unsupported absolute-fill object API. | Uses compatible absolute-fill constant. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `app/(customer)/messages.tsx` | Customer messaging UI | Uses unsupported absolute-fill object API. | Uses compatible absolute-fill constant. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `app/(customer)/review.tsx` | Customer review UI | Uses unsupported absolute-fill object API. | Uses compatible absolute-fill constant. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `app/(customer)/track/[jobId].tsx` | Customer tracking map | Uses unsupported absolute-fill object API. | Uses compatible absolute-fill constant. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `app/(tabs)/_layout.tsx` | Tab accessibility and typing | Tab color parameter is narrower than React Native navigation emits. | Uses `ColorValue`. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `app/(tabs)/admin-fleet-map.tsx` | Fleet map rendering | Uses unsupported absolute-fill object API. | Uses compatible absolute-fill constant. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `app/(tabs)/admin-schedule.tsx` | Company dispatch board | Clears Company Jobs instead of fetching HSC data. | Fetches Company Jobs and refreshes on Company sync revision. | **MERGE Manus** | `mobile-calendar` hunk patch; dependency isolation remains separate. | Schedule API, auth/session, Calendar tests. | High |
| `app/(tabs)/schedule.tsx` | Mounted Company Calendar | Fixed 8 AM–5 PM grid and legacy roster behavior. | HSC Jobs, Company roster lanes, full-day placement, lifecycle sync. | **MERGE Manus** | `mobile-calendar` hunk patch. | Schedule, roster, early/late placement, device Calendar check. | High |
| `app/_layout.tsx` | Root provider wiring | No Company lifecycle sync provider. | Adds Company sync provider. | **MERGE Manus** | `mobile-calendar` shared foundation patch. | Type check; foreground/reconnect contract test. | Medium |
| `app/login.tsx` | Company login recovery | No recovery entry point. | Adds Forgot Password handoff. | **MERGE Manus** | `mobile-password-reset` selective patch. | Password-reset payload and navigation test. | Medium |
| `components/chat/company-chat-screen.tsx` | Company Team Chat | Earlier single-pane implementation. | Community, Groups, Direct, and threads using HSC API helpers. | **MERGE Manus** | `mobile-company-chat` hunk patch. | Company Chat API, group, direct-message tests. | High |
| `components/company-clock-status.tsx` | Cross-channel clock visibility | Relies on periodic refresh only. | Refreshes after Company sync revision. | **MERGE Manus** | `mobile-calendar` shared sync patch. | Clock refresh contract test. | Medium |
| `components/navigation-map-modal.tsx` | Navigation map rendering | Uses unsupported absolute-fill object API. | Uses compatible absolute-fill constant. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `components/onboarding-walkthrough.tsx` | Onboarding rendering | Uses unsupported absolute-fill object API. | Uses compatible absolute-fill constant. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `components/review-overlay.tsx` | Video review compatibility | Uses unsupported video-view options. | Uses installed SDK-compatible options. | **KEEP Manus** | `mobile-config` selective patch. | Type check; review screen smoke. | Low |
| `components/ui/icon-symbol.tsx` | Native icon typing | Uses a broader unsupported symbol mapping type. | Narrows mapping to valid string symbol names. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `components/ui/top-nav-menu.tsx` | Company feature access | Shows all legacy menu items. | Filters Company menu by Company feature access and redirects from disabled routes. | **MERGE Manus** | `mobile-config` plus API foundation hunk. | Feature-access normalizer and navigation tests. | Medium |
| `lib/jobsync-auth-context.tsx` | Company session/feature state | Restores session only. | Fetches and clears Company feature access with session lifecycle. | **MERGE Manus** | `mobile-config` plus API foundation hunk. | Auth/session and feature-access tests. | Medium |
| `lib/jobsync-mobile-api.ts` | Shared HSC mobile contracts | Basic Company APIs; lacks sync, scoped Jobs, roster metadata, reset, and feature-access helpers. | Adds all of those helpers and their normalizers. | **SPLIT AND MERGE** | Copy only helpers required by each capability branch; do not overwrite unrelated GitHub API validation improvements. | Per-capability API contract tests. | High |
| `package.json` | Network recovery | No reconnect listener dependency. | Adds Expo-compatible NetInfo package. | **MERGE Manus** | `mobile-calendar` shared sync patch. | Locked install; type check. | Low |
| `pnpm-lock.yaml` | Dependency lock | No NetInfo lock entry. | Locks NetInfo transitives. | **MERGE Manus** | Generated alongside `package.json`. | Frozen lockfile install. | Low |
| `tests/jobsync-mobile-api.test.ts` | HSC contract coverage | Baseline normalizers only. | Adds reset, feature access, sync, scoped Jobs, roster, and full-day schedule tests. | **SPLIT AND MERGE** | Preserve GitHub tests and append relevant assertions by branch. | `pnpm vitest run tests`. | Medium |
| `tests/jobsync-native-session.test.ts` | Session fixture typing | Portal field is widened. | Uses `as const` Company portal literal. | **KEEP Manus** | `mobile-config` selective patch. | Type check. | Low |
| `todo.md` | Project notes | Earlier integration checklist. | Different local checklist. | **DOCUMENTATION ONLY** | Do not treat as application code or copy wholesale. | None. | Low |

## Manus-only files

| File | Classification | Decision |
|---|---|---|
| `app/forgot-password.tsx` | **KEEP** | Migrate on `reconcile/mobile-password-reset`; it uses the shared HSC reset-request endpoint and does not expose tokens. |
| `lib/jobsync-schedule-window.ts` | **KEEP** | Migrate on `reconcile/mobile-calendar`; it provides tested full-day slot placement. |
| `lib/jobsync-sync-context.tsx` | **KEEP** | Migrate as Calendar shared synchronization foundation; it is required for foreground/reconnect authoritative refresh. |
| `scripts/copy-company-team-chat.sh` | **DOCUMENTATION ONLY** | Keep as a developer utility in the Company Chat branch, not as runtime app behavior. |
| `TEAM_CHAT_PORTABLE_COPY.md` | **DOCUMENTATION ONLY** | Keep with the Team Chat branch documentation. |
| `expo-env.d.ts` and TypeScript log files | **REMOVE** | Generated artifacts; do not migrate as source. |

## Phase 1 patch disposition

`docs/phase-1-home-service-connection-app.patch` remains **UNVERIFIED** because it was not available in the accessible repository, task artifacts, or Git metadata. Reconciliation proceeds from current source evidence. If the patch is later recovered, compare it against the reconciled branches; do not apply it blindly.

## Branch dependency order

1. `reconcile/mobile-config` — Expo/type compatibility and feature-access foundation.
2. `reconcile/mobile-calendar` — scoped Jobs, roster lanes, full-day rendering, lifecycle refresh, and NetInfo.
3. `reconcile/mobile-company-chat` — Community, Groups, Direct, threads, and portable docs.
4. `reconcile/mobile-password-reset` — recovery screen and login handoff.
5. `reconcile/mobile-dependency-isolation` — replace active legacy runtime calls only after HSC endpoint contracts are verified.

No branch may merge into `main` until its contract tests, type check, native configuration validation, and relevant read-only HSC acceptance evidence pass.
