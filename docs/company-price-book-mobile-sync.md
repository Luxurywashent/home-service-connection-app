# Company Price Book Synchronization

The **Home Service Connected web application** is the authoritative Company Price Book. Mobile must never seed, merge, or substitute its own packages, add-ons, service names, or prices for a signed-in Company. A service shown in mobile job creation must be an active service returned for the bearer token’s Company workspace.

## Published Company Catalog Route

| Purpose | Method and route | Authorization | Mobile behavior |
|---|---|---|---|
| Read the active Company catalog for job creation | `GET /api/mobile/v1/price-book` | `Authorization: Bearer <Company mobile access token>` | Request after Company session restoration and before opening a service picker. |
| Review inactive services for management only | `GET /api/mobile/v1/price-book?includeInactive=true` | Owner or Operations Manager bearer token | Never use inactive items in a New Job picker. |

The published OpenAPI document identifies this route as **“List active Company Price Book services”** and describes the response as a Company-scoped service catalog. The API must derive Company identity from the bearer token; mobile must not send a Company ID.

## Catalog Item Mapping

| Web Price Book field | Mobile job field | Rule |
|---|---|---|
| `service_id` or `serviceId` | `packageId` / `priceBookServiceId` | Persist the source identifier unchanged. It is the reference back to the authoritative service. |
| `name` | `serviceTitle` | Display exactly as configured in the Company Price Book. |
| `description` and `features` | `serviceDescription` / service detail | Display-only copy from the current catalog record. |
| `vehicle_prices` or `vehiclePrices` | selected service price | Select the price for the chosen vehicle type. Do not use a static price. |
| `emoji` and `image_url_pb` or `imageUrl` | service card presentation | Optional visual metadata only. |
| `is_active_pb` or `isActive` | picker eligibility | Only active services may be selected in a new mobile job. |

## Required Mobile Job Flow

The app should load the active Price Book using the signed-in Company token. If the catalog is loading, the service picker displays a loading state. If the catalog is empty, it displays a clear empty state directing the Company Owner or Operations Manager to add or activate a service on the web Price Book. It must **not** fall back to copied `PACKAGES`, static `ADDONS`, or a custom-service entry.

When a user selects a service and vehicle type, mobile preserves the selected Price Book service ID and derives the displayed price from that item’s vehicle-price map. When the shared Company Jobs API is enabled, mobile sends the service ID and vehicle type—not a trusted client price—to `POST /api/mobile/v1/jobs`. The web service must then re-read the Price Book item in the authenticated Company and calculate the authoritative job line-item price before saving the job.

> This protects synchronization in both directions: a service created, edited, activated, or deactivated on the web Price Book changes what mobile can select, while a mobile-created job remains linked to the exact Company service that generated it.

## Implementation Status

The web application has published the authenticated Price Book reader. The mobile app needs to replace its copied local Price Book calls in its New Job flows with this reader and disable every Company-session fallback catalog. Job creation itself should move to the shared Company Jobs API when that endpoint is available, so the web platform—not the device—validates the final service and price.

## Reference

[1]: https://jobwash-veysiubh.manus.space/api/mobile/v1/openapi.json "Home Service Connected Mobile API OpenAPI document"
