# WordPress Booking Form — Availability Integration

## Overview

This folder contains the modified JavaScript snippets to add to your WordPress booking pages so that:

1. **Booked time slots are greyed out** in real time when a customer selects a date
2. **Bookings are automatically sent to the app** via Zapier → App webhook
3. **Timezone is correctly handled** (US Central Time — CST/CDT)

---

## App API URLs

| Endpoint | Purpose |
|---|---|
| `POST https://luxwashapp-n2wveyqg.manus.space/api/booking/webhook?location=LOCATION` | Receive booking from Zapier |
| `GET https://luxwashapp-n2wveyqg.manus.space/api/booking/availability?location=LOCATION&date=YYYY-MM-DD` | Check available time slots |

---

## Location Slugs

Use these exact values in the `location=` parameter:

| City | Slug | Capacity |
|---|---|---|
| Crestview | `crestview` | 2 simultaneous jobs |
| Niceville | `niceville` | 2 simultaneous jobs |
| Destin | `destin` | 1 job at a time |
| Fort Walton Beach | `fwb` | 1 job at a time |

---

## Zapier Setup (per location)

For each city's Zap, add a **second action** after the existing one:

1. **Action App:** Webhooks by Zapier
2. **Action Event:** POST
3. **URL:** `https://luxwashapp-n2wveyqg.manus.space/api/booking/webhook?location=LOCATION_SLUG`
4. **Payload Type:** Form
5. **Data:** Map all the fields from your Zapier trigger (see field mapping below)

### Field Mapping (Zapier → App)

| Zapier Field | App Field Name |
|---|---|
| First Name | `firstName` |
| Last Name | `lastName` |
| Email | `email` |
| Phone | `phone` |
| Street Address | `streetAddress` |
| Unit | `unit` |
| City | `city` |
| State | `state` |
| Zip Code | `zipCode` |
| Vehicle Type | `vehicleType` |
| Package Type | `packageType` |
| Selected Addons | `selectedAddons` |
| Total Price | `totalPrice` |
| Final Total | `finalTotal` |
| Discount Code | `discountCode` |
| Discount Amount | `discountAmount` |
| Selected Date | `selectedDate` |
| Selected Time | `selectedTime` |
| Page URL | `page` |

---

## Per-Location Webhook URLs

| City | Webhook URL |
|---|---|
| Crestview | `https://luxwashapp-n2wveyqg.manus.space/api/booking/webhook?location=crestview` |
| Niceville | `https://luxwashapp-n2wveyqg.manus.space/api/booking/webhook?location=niceville` |
| Destin | `https://luxwashapp-n2wveyqg.manus.space/api/booking/webhook?location=destin` |
| Fort Walton Beach | `https://luxwashapp-n2wveyqg.manus.space/api/booking/webhook?location=fwb` |

---

## WordPress Form Changes

See the `booking-form-changes.js` file for the exact JavaScript replacements.

There are **3 changes** to make in your booking form's `<script>` block:

1. **Add the `LOCATION` constant** near the top (set it to the city slug for each page)
2. **Replace `getCurrentDateInCDT()`** with the fixed timezone-aware version
3. **Replace `renderTimeSlots()`** with the async version that checks availability

Each booking page gets its own copy with the correct `LOCATION` value.
