# Home Service Connection — TestFlight Preparation

This project is prepared for a **separate** iOS application identity. No TestFlight submission is configured or has been made.

## Prepared configuration

| Setting | Value |
|---|---|
| Display name | Home Service Connection |
| iOS bundle identifier | `com.homeserviceconnection.mobile` |
| Deep-link scheme | `homeserviceconnection` |
| First release version | `1.0.0` |
| First iOS build number | `1` |
| Build profile | `testflight` |

## Required owner actions before a store build

1. In Apple Developer, register `com.homeserviceconnection.mobile` as a new App ID, or replace it in `app.config.ts` with an identifier your organization controls.
2. In App Store Connect, create a new app record with that same bundle identifier and the name **Home Service Connection**.
3. Link this copy to a new Expo/EAS project. The copied project ID was intentionally removed to prevent a build from being associated with the original app.
4. Create a store build using the `testflight` profile only after the above identities exist. Submit it to TestFlight from App Store Connect after reviewing the build.

## Deliberate exclusions

Stripe, Stripe Terminal, card-on-file, Apple Pay, and Tap to Pay are disconnected in this copy. The copied App Store Connect submission settings were also removed.
