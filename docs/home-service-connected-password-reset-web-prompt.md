# Copy-and-Paste Prompt: Shared Company Password Reset for Web and Mobile

Implement a secure, production-ready **Forgot Password** flow in the **Home Service Connected web project**. This must reset the **same Company Team Member credential** used by both the web Company sign-in and the Home Service Connection mobile app. Do not create a separate mobile-only account, local mobile password, or PIN-based reset flow.

## Goal and User Experience

Add a **Forgot password?** link to the web Company sign-in page at `/login`. The link must open a public reset-request page at:

```text
https://jobwash-veysiubh.manus.space/forgot-password
```

The page asks only for the Team Member’s email address. After a valid submission, display this privacy-safe message regardless of whether the account exists:

> If an account matches that email address, we sent a password-reset link. Please check your inbox.

Send an email containing a single-use reset link. The link must open this public web page:

```text
https://jobwash-veysiubh.manus.space/reset-password?token=<single-use-token>
```

On that page, the user enters and confirms a new password. On success, show a confirmation state and link them back to `/login`. The new password must work immediately in both the web Company sign-in and the mobile app’s existing Company email/password sign-in.

## Shared API Contract

Create the following versioned public mobile endpoints. The web reset-request screen may call the same request handler internally, or the web app may expose a non-versioned alias that delegates to the same handler. Do not duplicate reset logic.

| Purpose | Method and path | Request JSON | Success response |
|---|---|---|---|
| Request reset email | `POST /api/mobile/v1/auth/password-reset/request` | `{ "email": "user@company.com", "accountType": "company" }` | HTTP `202`, `{ "ok": true }` |
| Validate reset token | `GET /api/mobile/v1/auth/password-reset/validate?token=<token>` | None | HTTP `200`, `{ "valid": true }` for a valid unexpired token; HTTP `400`, `{ "valid": false, "message": "This password-reset link is invalid or has expired." }` otherwise |
| Set new password | `POST /api/mobile/v1/auth/password-reset/confirm` | `{ "token": "<token>", "password": "new-password" }` | HTTP `200`, `{ "ok": true }`; invalid/expired/redeemed token returns HTTP `400` with the same safe message above |

The public website reset form should use the same request/confirm business logic. It can use the versioned endpoints directly. If existing website route conventions require aliases such as `/api/auth/password-reset/request` and `/api/auth/password-reset/confirm`, implement aliases that call the same underlying service rather than reimplementing the behavior.

## Account and Company Rules

1. Look up the account using the exact authoritative identity source already used by the Company email/password login endpoint. The reset must update that same password hash and no other user store.
2. Support active Company Team Members and Company Owners who are permitted to use Company email/password sign-in. Do not reset Platform Admin accounts through this Company endpoint.
3. Never accept Company ID, Team Member name, Team Member ID, role, or PIN as proof of identity in the reset request. Only the verified email link may authorize a password change.
4. Normalize emails by trimming and lowercasing before lookup. Do not expose whether an account, Company, or email address exists.
5. Keep Company isolation intact. The token must be bound to one account and may never be used to change another Company user’s password.

## Token, Password, and Email Security Requirements

1. Generate each token with a cryptographically secure random generator. Use at least 32 random bytes, encoded as a URL-safe string.
2. Store only a cryptographic hash of the token in the database, never the raw token. Store the target account ID, issue time, expiry time, used/redeemed time, and optional audit metadata such as a redacted IP hash.
3. Tokens expire after **60 minutes**, are single-use, and are invalid immediately after a successful password update. Invalidate all older unused reset tokens for that account when issuing a new request.
4. Never write raw reset tokens, password values, password hashes, or full email addresses to client logs, server logs, error reports, analytics, or API responses.
5. Enforce the same password policy as Company login. Require a minimum of **8 characters** and reject an empty confirmation or mismatched confirmation in the web UI. Use the existing secure password-hashing method used by the Company authentication service; do not invent a second hashing scheme.
6. Rate-limit reset requests by IP address and normalized email to protect against abuse. A practical baseline is three requests per email and five requests per IP address per 15-minute window. Return the same HTTP `202` generic success response when a rate limit is reached, and log only a privacy-safe operational event.
7. Use the web platform’s existing transactional-email integration. The email must contain the reset link, expiry time, and a short security notice. Do not send a password, token, or account details in any other form.
8. The password-reset pages must be public but must not render the token visibly in the page body, logs, or analytics. Use HTTPS only.

## Website Screens

### `/forgot-password`

Build a branded Home Service Connected public screen consistent with the existing `/login` design. Include the logo, heading **Reset your password**, a short explanation, an email input, a **Send reset link** button, a loading state, accessible inline validation, a generic success state, and a link back to Company sign-in. Do not require the user to be signed in.

### `/reset-password?token=...`

Build a branded public reset form that validates the token before allowing submission. Include a new-password input, confirm-password input, show/hide controls, accessible validation, a clear invalid/expired state, a successful-reset confirmation, and a link back to `/login`. Do not auto-log the user in after reset unless that behavior is already a tested, intentional platform standard.

## Mobile Handoff Requirement

The Home Service Connection mobile app will call:

```json
POST /api/mobile/v1/auth/password-reset/request
{
  "email": "user@company.com",
  "accountType": "company"
}
```

After a `202` response, mobile will show the generic confirmation message and instruct the user to open the email. The email link must always open the **web** `/reset-password` page, where the user sets the new password. The mobile app should not receive or handle the token and should not embed a reset-password web view.

## Data Model and Implementation Notes

Add a password-reset-token table (or equivalent existing secure token store) with fields comparable to:

```text
id
account_id
token_hash
expires_at
used_at
created_at
request_ip_hash (nullable)
```

Use an indexed lookup by `token_hash`, and use a transaction or equivalent atomic operation when consuming a token and updating the password so a token cannot be redeemed twice under concurrent requests. Make the migration reversible and preserve all existing user, Company, Team Member, session, and password records.

## Required Tests

Write deterministic server and UI tests covering all of the following:

1. An active Company user’s reset request generates one email with an HTTPS link to `/reset-password`.
2. An unknown email returns HTTP `202` with the same response body and does not reveal account existence.
3. A valid token updates the authoritative Company sign-in password hash and can no longer be reused.
4. Expired, altered, missing, and already-redeemed tokens are rejected safely.
5. A reset token cannot change a different account’s password.
6. Reset attempts are rate limited without disclosing account existence.
7. The web pages render valid, invalid/expired, loading, error, and success states accessibly.
8. Existing Company login succeeds with the new password and fails with the old password.
9. The mobile request endpoint accepts the documented payload and returns the generic `202` response.

## Acceptance Criteria

Do not mark this complete until all of the following are true:

- `/forgot-password` renders a usable branded reset-request page instead of redirecting to the Home Service Connected landing page.
- A Company user can request a reset by email, receive the email, open the link, set a password, and sign in with that password on both web and mobile.
- The public API endpoint matches the mobile contract exactly and never leaks whether an email exists.
- Tokens are secure, hashed at rest, short-lived, single-use, rate-limited, and Company-account bound.
- The implementation uses the existing Home Service Connected account and password system, not a copied mobile database or local credential system.
- Existing Company sign-in, sessions, and Company data isolation continue to work.

When finished, provide: the exact endpoint confirmation, request/response JSON examples, the web reset URLs, the files changed, migration name, test results, and one live redacted verification using a test Company account.
