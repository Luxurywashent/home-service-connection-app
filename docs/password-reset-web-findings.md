# Home Service Connected Password Reset Findings

On 2026-09-14, the deployed public route `https://jobwash-veysiubh.manus.space/forgot-password` redirected to the Home Service Connected landing page rather than rendering a password-reset request form. The public website therefore does not currently expose a usable reset-page handoff at that path.

The mobile client has a Company email/password sign-in flow but no published password-reset request endpoint in `lib/jobsync-mobile-api.ts`. A secure mobile reset flow requires the authoritative Home Service Connected web platform to publish a public request endpoint that sends the reset email and a public website reset page that validates a short-lived, single-use token and writes the new password to the same Company account record used by mobile sign-in.
