# Shared Authentication Audit

## Verified live portal behavior

On August 13, 2026, the live JobSync deployment at `https://jobwash-veysiubh.manus.space` exposed two distinct email/password portals.

| Portal | Live route | Visible fields | Intended identity table |
|---|---|---|---|
| Company workspace | `/login` | Email and password | `company_users` joined to `companies` |
| Platform Admin | `/platform/login` | Owner email and password | `platform_operators` |

The Company page states that the Company is resolved automatically from the email/password account. The Platform Admin page states that platform access is separate from each Company's private workspace. Therefore, an email/password record in one identity table is not automatically valid in the other portal.

## Verified source contract

Company login uses `auth.emailLogin`. It normalizes the email, requires an active `company_users` row with a password hash and salt, validates the password with scrypt, enforces a single Company membership per email, and issues the `hsc_company_session` cookie. The authenticated workspace is then returned by `auth.workspace`.

Platform Admin login uses `platformOwnerAuth.emailLogin`. It requires an active `platform_operators` row with its own password hash and salt, validates the password with the same scrypt method, and issues the separate `fs_platform_owner` cookie.

The uploaded JobSync capacity baseline reports four Companies and five Company-user records in the assessed database. This proves that Company identities existed in that assessed environment, but it does not identify which live emails have valid password hashes or prove that the deployed site currently points to that same database.

## Current proof gap

No known plaintext email/password pair has yet been demonstrated successfully against both the live JobSync login endpoint and the Home Service Connection mobile relay. Local copied-app PIN records, including the previously created Adrian Miller employee record, are not JobSync Company or Platform Admin email/password identities.

## Database connection finding

The Home Service Connection mobile project database does **not** contain JobSync's `companies`, `company_users`, or `platform_operators` tables. It contains the copied app's local `employees` table, currently with one local employee record. Therefore, this mobile project is not connected to the JobSync database through a shared database connection.

The mobile backend instead connects indirectly through HTTPS. Its `server/jobsyncAuth.ts` sends Company credentials to `https://jobwash-veysiubh.manus.space/api/trpc/auth.emailLogin`, captures the resulting `hsc_company_session` cookie on the server, calls `auth.workspace`, and then issues an app-local native session. Platform credentials use `platformOwnerAuth.emailLogin` and the separate `fs_platform_owner` cookie.

The TestFlight profile correctly points `EXPO_PUBLIC_API_BASE_URL` to `https://luxwashapp-eysenspg.manus.space`, and the deployed mobile login route is available. A deliberately invalid test pair returns `UNAUTHORIZED` through both the web endpoint and the mobile relay, which proves the relay reaches the live JobSync authentication service. This does not prove any previously supplied credential is a real JobSync account.

## Account source-of-truth finding

Valid Company email/password accounts exist only after the live JobSync provisioning flow inserts an active `company_users` row with `password_hash` and `password_salt`. Valid Platform Admin accounts exist only as active `platform_operators` rows with their own password hash and salt. Passwords are one-way scrypt hashes and cannot be recovered from the database; a forgotten or unknown password must be reset or a new verified account must be created.

The uploaded JobSync checklist says one live Company owner login and an existing platform-owner migration were previously validated, but it does not include the plaintext email/password used. No JobSync database credential, owner setup credential, or authenticated browser session is attached to the current mobile project, so the live identity rows cannot yet be inventoried or reset from this workspace.

## Shared mobile API contract

The authoritative JobSync deployment now exposes a versioned mobile contract at:

| Purpose | Method | Endpoint |
|---|---:|---|
| Sign in | `POST` | `https://jobwash-veysiubh.manus.space/api/mobile/v1/auth/login` |
| Validate bearer token and load profile | `GET` | `https://jobwash-veysiubh.manus.space/api/mobile/v1/auth/session` |

The login body requires `accountType`, `email`, and `password`. The Company value is `company`; Platform Admin uses `platform_admin`. Invalid but structurally valid Company credentials return `401` with `Invalid email or password.` Missing or malformed request fields return `400`. The session endpoint requires `Authorization: Bearer <token>` and returns `401` with `Bearer token required.` when the header is absent.

The native app now calls these endpoints directly. It stores only the bearer token in iOS/Android SecureStore, validates the token through the session endpoint on launch, and derives Company and native role context from the safe profile. The old copied-app session is migrated once and then removed.

## Additional live checks

The original shared URL containing `?code=4mEJwZW9RBBHDvV6vxaFEQ` currently opens only the public Home Service Connection sales page; it does not establish a Company or Platform Admin session.

The live `platformOwnerAuth.bootstrapStatus` endpoint reports that a one-time setup code is configured. The `/platform/setup` page is reachable and requests a display name, owner email, password, and that setup code. This proves the deployment is capable of creating a Platform Admin identity, but it does not prove that a `platform_operators` account has already been created or reveal a valid owner email/password pair.
