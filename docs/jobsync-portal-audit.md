# JobSync Portal Audit

## Verified deployment

The uploaded JobSync project is deployed at `https://jobwash-veysiubh.manus.space`. Its public landing page presents **Home Service Connection** as a company-scoped operations platform and offers both a Company sign-in path and a separate Platform Admin path.

## Portal split

The live Company sign-in route is `https://jobwash-veysiubh.manus.space/login`. It asks for an email address and password, then determines the correct company workspace from the authenticated account. The reference source defines the separate platform-owner route as `/platform/login`, with its own email-and-password credentials and session.

## Integration implication

The mobile project currently has an independent employee database and cannot share JobSync account credentials until it directs authentication to the JobSync service or is migrated to the JobSync database and schema. The correct shared-auth design must preserve JobSync's distinct platform-owner and company-session contracts.
