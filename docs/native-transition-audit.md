# Native Transition Audit

## Verdict

The current mobile project is **not yet a complete JobSync-to-native transition**. It contains a working native credential relay, but the authenticated JobSync session is not bridged into the existing native role guard or data layer. A successful JobSync login therefore cannot reliably open the native Company workspace.

## JobSync reference model

The uploaded JobSync source has a deliberately separate platform and Company model.

| Portal | Credential route | Roles | Scope |
|---|---|---|---|
| Platform Admin | `platformOwnerAuth.emailLogin` | `owner`, `developer`, `sales`, `customer_support`, `operations` | Across all Companies |
| Company workspace | `auth.emailLogin` | `owner`, `dispatcher`, `technician` | One authenticated Company |

Company email-and-password login resolves the Company automatically from `company_users`. The Company workspace context is returned by `auth.workspace`; it includes the Company identifier, name, branding, and the member role. The reference system's PIN method is separate and uses a Company slug plus member ID and PIN.

## Current native mobile mismatch

The mobile login screen now receives a JobSync-native session and selects a destination based on the JobSync role. However, the existing `/(tabs)` layout does not read that session. It only authorizes a separate `EmployeeAuth` session from the copied app's local `employees` table. When no local employee is present, the tabs layout redirects back to `/login`.

The local mobile database also does not contain JobSync's `companies`, `company_users`, or `platform_operators` identity tables. Existing native dashboards and tRPC procedures query copied local records without a JobSync Company filter. They cannot presently show authentic Company-scoped JobSync data or enforce Company data boundaries.

## Why current credentials fail

The previously created Adrian Miller record is a local copied-app administrator with a six-digit PIN. It is not evidence of a JobSync `company_users` or `platform_operators` account. JobSync email login requires its own stored email-and-password credential, with passwords at least eight characters; its separate PIN route requires a Company slug and member ID. An employee ID plus six-digit local PIN will not authenticate through the JobSync email-and-password route.

## Required repair sequence

1. Verify or create the real JobSync platform-owner account and at least one Company owner account in the JobSync database.
2. Verify that each Team Member has a JobSync Company membership and one of the roles: `owner`, `dispatcher`, or `technician`.
3. Bridge a validated JobSync native session into the native app session, mapping `owner` to Owner/Admin, `dispatcher` to Operations Manager, and `technician` to Detailer.
4. Replace copied local dashboard data access with Company-scoped JobSync API access or migrate JobSync's database model into the app backend before enabling Company routes.
5. Test a real Owner/Admin, Operations Manager, and Detailer account on device before calling the transition complete.
