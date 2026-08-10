# Hearthline CRM — Home Service Operations Design

## Rebrand Direction — Takes Precedence

**Hearthline CRM** is the working product identity for this independent copy. It is a calm, mobile-first operating workspace for home-service businesses, with the existing scheduling, customer, team, field-work, finance, and communication capabilities organized as one CRM. It takes high-level visual direction from the supplied Fieldframe reference—an operational dark canvas, clear live-work states, and focused dashboard hierarchy—without copying its brand, imagery, or interface verbatim.

| Screen group | Primary content and function |
|---|---|
| **Operations dashboard** | Today’s open jobs, technicians on site, booked revenue, urgent exceptions, and a compact dispatch snapshot. |
| **Dispatch schedule** | Day and week job views, assignment, technician availability, field status, and property context. |
| **Customers and jobs** | Customer records, properties, service history, photos, notes, payments, and follow-up actions. |
| **Team operations** | Timecards, clock status, availability, training, quality controls, and team communication. |
| **Business controls** | Locations, price book, inventory, reports, finance, customer communications, and service-quality tools. |

The principal user flow is: **Dashboard → Dispatch → Job → Customer or Team Action → Completion**. The principal customer-management flow is: **Customers → Profile → Job History → New Job or Follow-up**. All primary task actions should remain reachable in portrait orientation and comfortably usable with one hand.

| Token | Color | Use |
|---|---:|---|
| **Night canvas** | `#07111F` | Application background and header surface. |
| **Elevated slate** | `#102038` | Cards, grouped content, and modal surfaces. |
| **Cobalt signal** | `#4D8DFF` | Primary actions, selected states, and navigation. |
| **Live mint** | `#52D3B8` | On-site, confirmed, healthy, and completed states. |
| **Warm amber** | `#F2B84B` | Attention, pending, and time-sensitive states. |
| **Coral alert** | `#F06A6A` | Errors and destructive actions. |
| **Cloud text** | `#F6F8FC` | Primary copy and critical metrics. |
| **Steel text** | `#94A3B8` | Supporting labels and secondary details. |

The app mark should be a simple, text-free square symbol: a house outline integrated with a precise route or signal node, rendered in cobalt and mint over the night canvas. In the mobile header, use the compact **HL** mark beside **Hearthline CRM** and the descriptor **Home Service Operations**.

## Archived Implementation Reference

> **Note**: This app serves two audiences — (1) **Staff Portal** (existing detailer/admin screens) and (2) **Client Portal** (new public-facing sales screen, customer booking, and GPS tracking). The Home tab is now the public sales/landing screen visible to all users before login.

## Brand Identity

- **Primary Colors**: Blue (#1E3A5F deep navy, #2563EB bright blue accent), Black (#111827)
- **Background**: White (#FFFFFF) with light gray surfaces (#F8FAFC)
- **Performance Colors**: Green (#22C55E for 80%+), Yellow (#F59E0B for 70-79%), Red (#EF4444 for below 70%)
- **Typography**: Bold numbers are the visual hero. Large, clean sans-serif for metrics. Muted gray (#6B7280) for secondary text.
- **Cards**: White with subtle border (#E5E7EB), rounded-2xl corners, minimal shadow
- **Overall**: Clean, professional, minimal. No flashy elements. Numbers dominate.

---

## Screen List

### Shared Screens
1. **Login Screen** — PIN-based authentication (employee ID/email + 4-6 digit PIN)

### Detailer Screens (5 tabs)
1. **Dashboard** — Today/This Week toggle, 4 metric cards (Revenue, Hours, Efficiency%, Upsells), efficiency trend chart
2. **Notifications** — List of notifications with type badges, read/unread/acknowledged states
3. **Notification Detail** — Full message view with acknowledge button
4. **History** — Past daily performance entries, weekly summaries, efficiency trend
5. **Request Off** — Submit time-off request form with policy validation, view request history
6. **Profile** — Basic employee info display

### Admin Screens (5 tabs)
1. **Team Dashboard** — Grid/list of all detailers with today's metrics, bell icon with badge for pending items
2. **Notifications / Bell** — Pending time-off requests, unacknowledged critical notifications, important items
3. **Employees** — List of all active employees, tap to view detail
4. **Employee Detail** — Full profile with performance, actions (create notification, log QC issue, etc.), history, time-off
5. **Create Notification** — Form to create notification for a specific employee
6. **Time Off** — All time-off requests with status filter, approve/deny with manager notes
7. **Profile** — Admin profile info

---

## Screen Layouts (Mobile Portrait 9:16)

### Login Screen
- App logo centered at top (Team Luxury Wash branding)
- "Team Luxury Wash" title in navy blue
- Employee ID or Email text input
- PIN input (masked, 4-6 digits)
- "Remember Me" toggle
- "Sign In" button (blue, full-width)
- Clean white background

### Detailer Dashboard
- **Header**: "Dashboard" title, greeting with employee name
- **Toggle Bar**: "Today" | "This Week" segmented control (blue active state)
- **4 Metric Cards** (2x2 grid):
  - Revenue Produced — large bold dollar amount
  - Hours Worked — large bold number
  - **Efficiency %** — LARGEST card, dominant number, color-coded (green/yellow/red)
  - Upsells — large bold count
- **Trend Chart**: Simple line chart showing efficiency % by day for current week
- Cards are white with subtle borders, numbers are the hero

### Detailer Notifications
- **Header**: "Notifications" title with unread count badge
- **List**: FlatList of notification items, each showing:
  - Type badge (colored pill: QC Issue=red, Write-Up=red, Missed Step=yellow, Coaching=blue, Time-Off=green, Announcement=gray)
  - Title (bold)
  - Preview text (truncated, muted)
  - Timestamp (relative: "2h ago")
  - Status dot (blue=unread, gray=read, green=acknowledged)
- Tap opens Notification Detail

### Notification Detail
- **Header**: Back arrow, notification type badge
- Title (large, bold)
- Created by + date
- Full message body
- **Acknowledge Button** (if required): Blue full-width button at bottom
- Status indicator

### Detailer History
- **Header**: "History" title
- **Tabs**: "Daily" | "Weekly"
- **Daily View**: FlatList of past days, each card showing date + 4 metrics
- **Weekly View**: Weekly summary cards with aggregated metrics
- Efficiency trend chart at top

### Request Off
- **Header**: "Request Time Off" title
- **Policy Info**: Collapsible section showing notice requirements
- **Form**:
  - Start Date picker
  - End Date picker
  - Calculated days display
  - Calculated notice display
  - Policy validation status (green check or red X with message)
  - Reason text area
  - Submit button (disabled if invalid)
- **Request History**: Below form, list of past requests with status badges (Pending=yellow, Approved=green, Denied=red)

### Detailer Profile
- Profile photo (or initials avatar)
- Full name (large)
- Employee ID
- Email
- City
- Hire date
- Role badge

### Admin Team Dashboard
- **Header**: "Team Luxury Wash" title + Bell icon (with badge count for pending items)
- **Toggle**: "Today" | "This Week"
- **Team Grid**: FlatList of detailer cards, each showing:
  - Name
  - Today's Revenue
  - Today's Hours
  - **Today's Efficiency %** (large, color-coded)
  - Today's Upsells
- Tap card → Employee Detail screen

### Admin Bell / Alerts
- **Sections**:
  - Pending Time-Off Requests (count)
  - Unacknowledged Critical Notifications (count)
  - Items Needing Attention
- Each item tappable to navigate to relevant screen

### Admin Employees
- Search bar at top
- FlatList of all active employees
- Each row: name, role, city, efficiency indicator
- Tap → Employee Detail

### Admin Employee Detail
- **Header**: Employee name + back arrow
- **Sections** (scrollable):
  1. **Performance**: Today/This Week toggle, 4 metric cards, efficiency trend chart
  2. **Actions**: Grid of action buttons:
     - Create Notification
     - Log QC Issue
     - Add Write-Up
     - Add Missed Step
     - Add Coaching Note
     - Reset PIN
  3. **History**: Past performance entries, prior notifications with read/acknowledged status
  4. **Time Off**: Employee's request history, approve/deny buttons

### Admin Create Notification
- Select Employee (if not pre-selected)
- Notification Type dropdown (qc_issue, write_up, missed_step, coaching_note, company_announcement)
- Title input
- Message textarea
- Requires Acknowledgment toggle
- Send button

### Admin Time Off
- **Filter Tabs**: All | Pending | Approved | Denied
- FlatList of requests, each showing:
  - Employee name
  - Dates requested
  - Days + notice given
  - Policy status
  - Current status badge
- Tap → Detail with approve/deny buttons + manager note input

### Admin Profile
- Same as detailer profile but with admin role badge

---

## Key User Flows

### Flow 1: Detailer Login → Dashboard
1. Open app → Login screen
2. Enter employee ID/email + PIN
3. Tap "Sign In"
4. App validates credentials against Employees table
5. Navigate to Detailer Dashboard (default: Today view)

### Flow 2: Admin Reviews Team → Individual Detail
1. Admin logs in → Team Dashboard
2. Sees all detailers with today's metrics
3. Taps a detailer card
4. Opens Employee Detail with performance, actions, history

### Flow 3: Admin Creates Notification
1. From Employee Detail → Tap "Log QC Issue" (or other action)
2. Opens Create Notification form pre-filled with type
3. Admin fills title + message
4. Taps Send
5. Notification saved to DB, employee receives push notification

### Flow 4: Detailer Acknowledges Notification
1. Detailer receives push notification
2. Taps notification → Opens Notification Detail
3. Reads message
4. Taps "Acknowledge" button
5. Status updates to "acknowledged"

### Flow 5: Employee Requests Time Off
1. Detailer navigates to Request Off tab
2. Views policy requirements
3. Selects start/end dates
4. App calculates days + notice, validates against policy
5. If valid → enters reason → submits
6. If invalid → shows error, blocks submission
7. Request saved as "pending"

### Flow 6: Admin Approves/Denies Time Off
1. Admin sees badge on bell icon
2. Navigates to Time Off tab
3. Filters by "Pending"
4. Taps request → sees details
5. Adds manager note (optional)
6. Taps Approve or Deny
7. Status updates, notification sent to employee

---

## Color Choices

| Token | Light | Dark | Usage |
|-------|-------|------|-------|
| primary | #2563EB | #3B82F6 | Buttons, active tabs, links |
| background | #FFFFFF | #111827 | Screen backgrounds |
| surface | #F8FAFC | #1E293B | Card backgrounds |
| foreground | #111827 | #F1F5F9 | Primary text |
| muted | #6B7280 | #9CA3AF | Secondary text |
| border | #E5E7EB | #334155 | Card borders, dividers |
| success | #22C55E | #4ADE80 | Good performance (80%+), approved |
| warning | #F59E0B | #FBBF24 | Fair performance (70-79%), pending |
| error | #EF4444 | #F87171 | Poor performance (<70%), denied, critical |
| navy | #1E3A5F | #1E3A5F | App header, branding accent |

---

## CLIENT PORTAL DESIGN

### Design Philosophy

Inspired by premium consumer apps (cookie/food delivery aesthetic): pure white background, no card borders or shadows, staggered alternating layout, cut-out style imagery floating on white, bold heavy sans-serif headings, and a persistent floating pill CTA. The interface should feel like a premium editorial magazine — the service IS the UI.

### Client Portal Screen List

| Screen | Route | Auth Required |
|---|---|---|
| Home / Sales Screen | `app/(tabs)/index.tsx` | No |
| Login | `app/login.tsx` | No |
| Sign Up | `app/signup.tsx` | No |
| Customer Dashboard | `app/(customer)/index.tsx` | Customer |
| Customer Profile | `app/(customer)/profile.tsx` | Customer |
| My Vehicles | `app/(customer)/vehicles.tsx` | Customer |
| My Appointments | `app/(customer)/appointments.tsx` | Customer |
| Booking Detail + GPS | `app/(customer)/booking-detail.tsx` | Customer |
| Live Tracking | `app/(customer)/tracking.tsx` | Customer |
| Book — Step 1 Vehicle | `app/(customer)/book/vehicle.tsx` | Customer |
| Book — Step 2 Package | `app/(customer)/book/package.tsx` | Customer |
| Book — Step 3 Add-ons | `app/(customer)/book/addons.tsx` | Customer |
| Book — Step 4 Location | `app/(customer)/book/location.tsx` | Customer |
| Book — Step 5 Date/Time | `app/(customer)/book/datetime.tsx` | Customer |
| Book — Step 6 Confirm | `app/(customer)/book/confirm.tsx` | Customer |
| Booking Confirmed | `app/(customer)/book/booking-confirmed.tsx` | Customer |

### Home Screen Layout (Sales/Landing)

- **Top bar**: Logo left, Login icon button top-right
- **Hero**: Large edge-to-edge gradient/image (60% viewport), bold headline "Premium Mobile Detailing", subtitle "We Come To You", location tag "Serving NW Florida"
- **Packages section**: Staggered alternating rows — odd rows: image left / text right; even rows: text left / image right
  - Each row: Package name (bold 28px), tagline, 3 feature bullets, "Starting from $X" price
  - Tap → starts booking flow (prompts login if not authenticated)
- **Add-Ons section**: Horizontal scroll row of add-on cards (image + name + price + 1-line benefit)
- **Floating "Book Now" pill**: Pinned to bottom, black background, white text, fully rounded
- **Footer**: City coverage list

### Pricing Matrix

| Package | Sedan | SUV | XL SUV/Van | Truck |
|---|---|---|---|---|
| Basic Detail | $175 | $200 | $250 | $225 |
| Full Detail | $275 | $300 | $350 | $325 |
| Interior Detail | $200 | $250 | $275 | $225 |
| Exterior Detail | $175 | $200 | $225 | $200 |
| Luxury Detail | $375 | $400 | $450 | $425 |

### Add-Ons (flat price, all vehicle types)

| Add-On | Price | Benefit |
|---|---|---|
| Rain-X | $10 | Repels water for safer driving in rain |
| Paint Sealant | $50 | Protects paint from UV and contaminants |
| Clay Bar | $50 | Removes embedded surface contaminants |
| Leather Conditioning | $40 | Prevents cracking, keeps leather supple |
| Leather Cleaning | $30 | Deep cleans leather surfaces |
| Ozone Treatment | $100 | Eliminates odors at the molecular level |
| Shampoo Seats & Carpets | $75 | Deep cleans fabric seats and floor carpets |
| Pet Hair Removal | $40 | Removes stubborn pet hair from interior |
| One Step Paint Enhancement | $250 | Removes light scratches, restores gloss |
| Shampoo Seats (ONLY) | $50 | Targeted shampoo for seats only |
| Engine Bay Cleaning | $30 | Degrease and detail under the hood |
| Deep Interior Cleaning | $75 | Thorough deep clean of entire cabin |
| Shampoo Carpet (ONLY) | $50 | Targeted shampoo for carpets only |

### Booking Flow

1. **Select Vehicle** — choose from saved vehicles or add new (Year/Make/Model, type auto-detected)
2. **Select Package** — prices shown for selected vehicle type
3. **Select Add-Ons** — relevant add-ons for chosen package, running total
4. **Select Location** — saved addresses or enter new one (optionally save to profile)
5. **Select Date & Time** — Mon–Fri week view, arrows navigate by full week, mobile horizontal scroll
6. **Confirm & Book** — full summary, discount code, confirm button

### Key User Flows

**New customer first booking**: App → Book Now → Sign Up → Add Vehicle → Book (6 steps) → Confirmed

**Returning customer**: App → Login → Book Now → Pick vehicle → Pick package → Confirm (fast path)

**GPS tracking**: Push notification "On My Way" → Open app → Live map with detailer pin + ETA → Status updates

### Vehicle Types

| Internal Key | Display Name | Examples |
|---|---|---|
| `small` | Sedan | Civic, Camry, Mustang |
| `midsize` | SUV | CR-V, Explorer, RAV4 |
| `fullsize` | XL SUV / Van | Suburban, Expedition, Sprinter |
| `pickup` | Truck | F-150, Silverado, Tacoma |
