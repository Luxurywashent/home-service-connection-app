# Project TODO

## JobSync Platform Integration

- [x] Revise the JobSync mobile API prompt to exclude completed login, session, roster, and detailed Team Member profile integrations.
- [x] Deliver a reduced operational API prompt for clocking, breaks, schedules, jobs, customers, dispatch, payroll, notifications, training, and dashboards.

- [ ] Produce a complete JobSync web-to-mobile API inventory covering every Home Service Connection feature, including read, write, permissions, and sync requirements.
- [ ] Create a ready-to-paste implementation prompt for the JobSync web project to build the complete versioned mobile API surface.

- [ ] Replace piecemeal web-to-mobile data endpoints with a complete, versioned JobSync mobile API covering every Company and Platform Admin mobile domain.
- [ ] Connect every mobile screen to authoritative JobSync data and retire copied local data sources for Company sessions.

- [x] Restore complete Team Member profiles with ID, contact, hire date, work days, pay, bonus, assigned van, and credential-management sections.
- [x] Obtain a Company-scoped JobSync detail API for member profile, payroll, availability, and vehicle assignment data.
- [x] Add a bearer-protected JobSync `GET /api/mobile/v1/company/team-members/:memberId` detail endpoint with authorized profile fields.
- [x] Verify and connect the newly published JobSync detailed Team Member profile endpoint to the mobile profile view.
- [ ] Add authorized JobSync mobile endpoints for work schedule, vehicle assignment, and password/PIN reset before enabling those profile controls.
- [x] Ensure displayed Team Member profile values come from authoritative JobSync Company records rather than copied local placeholders.

- [x] Restore Team Member profile editing through the authoritative JobSync Company API.
- [x] Add and publish a bearer-protected JobSync member-update endpoint for authorized Company Owner and Operations Manager edits.
- [x] Verify the published JobSync member-update endpoint contract and connect mobile saves to it.
- [ ] Verify mobile profile edits refresh the same Company roster shown on web and schedule.

- [x] Replace the Team Members screen’s copied local employee query with the authenticated JobSync Company roster.
- [ ] Verify Team Members count, cards, and role filters match the Company calendar roster.

- [ ] Diagnose why the latest checkpoint is not appearing in the published Home Service Connection deployment.
- [ ] Determine why the latest checkpoint appears not to publish despite successful deployment notifications.

- [x] Increase the signed-in Company-name text size in the shared header while preserving a one-line long-name fallback.
- [x] Retrieve authenticated Company team members from the JobSync API so web-created members appear in the mobile schedule.
- [x] Confirm the bearer-protected JobSync `GET /api/mobile/v1/company/team-members` endpoint returns only the authenticated Company’s active members.
- [x] Connect the confirmed `GET /api/mobile/v1/company/team-members` bearer endpoint to the native schedule roster.
- [ ] Validate that a newly created JobSync web team member appears in the correct Company mobile schedule lane.
- [x] Recheck the deployed JobSync Company roster endpoint after the reported missing-member issue persists.

- [x] Show the authenticated JobSync Company name in signed-in app headers instead of the generic Home Service Connection label.
- [x] Preserve generic Home Service Connection branding on unauthenticated login screens and when no Company context exists.

- [x] Remove hard-coded schedule team members and off-shift placeholders; show only authenticated Company members returned by live data.
- [x] Remove the single-city selector from the schedule header.
- [x] Validate the schedule empty-team state and single-city header behavior through source-boundary, test, lint, build, and preview checks.
- [ ] Validate the actual-team schedule state with authenticated Company roster data.
- [ ] Connect the schedule roster and jobs to Company-scoped JobSync data before enabling calendar assignments for a staffed Company.

- [x] Add the shared mobile-authentication API to the authoritative JobSync web project.
- [x] Discover and document the deployed JobSync mobile-auth endpoint paths, payloads, tokens, and role response.
- [x] Point native Company and Platform Admin login directly at the shared JobSync mobile-auth API.
- [x] Restore native sessions through the shared JobSync session endpoint rather than a copied-app session.
- [ ] Verify one real Company account succeeds on both the JobSync web portal and native mobile login.
- [ ] Verify one real Platform Admin account succeeds on both the JobSync web portal and native mobile login.
- [ ] Confirm Owner/Admin, Operations Manager, Detailer, and Platform Admin route to the correct native areas.

- [ ] Prove which live JobSync database is authoritative for Company and Platform Admin email/password accounts.
- [ ] Inventory the real Company memberships and Platform Admin accounts used by the live web app without exposing stored password hashes.
- [ ] Verify the same known email/password pair succeeds through both the JobSync web endpoint and the Home Service Connection mobile endpoint.
- [ ] Confirm successful Company login resolves the correct Company ID and routes Owner/Admin, Operations Manager, and Detailer into their native dashboards.
- [ ] Confirm successful Platform Admin login routes into the native Platform Admin dashboard.
- [ ] Do not declare authentication complete until both live login paths have passed repeatable end-to-end tests.

- [x] Inspect the uploaded JobSync project and document its platform-admin and company-ID authentication model.
- [x] Connect Home Service Connection authentication to the same JobSync company credentials and company context.
- [x] Add separate Platform Admin and Company Sign In portal choices to the mobile login experience.
- [x] Replace the embedded JobSync web portals with native login forms and native Home Service Connection sessions.
- [x] Route Company and Platform Admin credentials through a secure backend exchange that does not expose JobSync session cookies to the mobile client.
- [ ] Validate a live JobSync Company account and Platform Admin account through the native mobile app on a device.
- [x] Remove Company ID from native JobSync login; use email and password only for automatic Company resolution.
- [x] Audit why existing JobSync credentials fail in the native app and verify the actual deployed authentication contract.
- [x] Map JobSync Company Owner/Admin, Operations Manager, and Detailer roles to native Home Service Connection routes.
- [x] Add company-scoped native route guards so one Company's users cannot enter another Company's workspace.
- [ ] Validate a Company Owner/Admin, Operations Manager, and Detailer with real JobSync credentials before declaring the app transition complete.
- [ ] Verify or create the actual JobSync platform owner, Company owner, and Company member records required for live credential testing.
- [x] Bridge the JobSync-native session into the existing native role guard so authenticated users do not return to the login screen.
- [ ] Replace copied local dashboard queries with Company-scoped JobSync data access before enabling the transitioned Company workspace.

- [x] Theme configuration (blue/black brand colors, performance colors)
- [x] Database schema (Employees, Daily_Performance, Notifications, Time_Off_Requests, Notification_Read_Log)
- [x] API routes for all CRUD operations
- [x] PIN-based login screen (employee ID/email + PIN)
- [x] Remember me / stay logged in functionality
- [x] Role-based navigation (detailer vs admin tabs)
- [x] Detailer Dashboard (Today/This Week toggle, 4 metric cards, trend chart)
- [x] Efficiency color coding (green 80%+, yellow 70-79%, red <70%)
- [x] Detailer Notifications list screen
- [x] Notification Detail screen with acknowledge button
- [x] Detailer History screen (daily/weekly performance)
- [x] Request Off screen with policy validation
- [x] Time-off policy rules enforcement (1d=5d notice, 2-4d=14d, 5+=30d)
- [x] Detailer Profile screen
- [x] Admin Team Dashboard (all detailers with metrics)
- [x] Admin Bell/Alerts (pending items, unacknowledged notifications)
- [x] Admin Employees list screen
- [x] Admin Employee Detail (performance, actions, history, time-off)
- [x] Admin Create Notification form
- [x] Admin Time Off management (filter, approve/deny, manager notes)
- [x] Admin Profile screen (shared with detailer profile)
- [x] Admin PIN reset functionality
- [x] Seed data for testing (demo employees, performance, notifications, time-off)
- [x] App logo and branding (custom navy/gold icon)
- [ ] Push notifications setup (deferred - requires device testing)
- [x] Admin daily performance data entry API route (create/update)
- [x] Admin data entry screen with employee selector and daily metrics form
- [x] Integrate data entry into admin tab navigation
- [x] Calendar date picker on Request Off screen (replace text inputs)
- [x] Fix admin landing on detailer dashboard instead of team dashboard
- [x] Change upsells from count to dollar bonus amount ($) across all screens
- [x] Update database schema/seed data for upsells as decimal dollar amount
- [x] Update API routes for upsells as dollar amount
- [x] Add admin team member management screen (add new team members)
- [x] Add team member creation API route
- [x] Rename all UI-facing "Employee" text to "Team Member" across all screens
- [x] Multi-select team members when creating notifications (each gets separate notification)
- [x] Database tables for quiz questions and employee progression
- [x] API routes for quiz CRUD, progression tracking, and admin visibility
- [x] Admin quiz management screen (add/edit questions, answers, explanations, correct answer)
- [x] Detailer dashboard progression card (van reveal, daily quiz, 3 states)
- [x] Van image progressive reveal system (blur/mask based on progress)
- [x] Quiz modal with answer flow (correct = explanation + progress, incorrect = retry with correct answer shown)
- [x] Admin progression visibility (who completed today, certification status, reset option)
- [x] Weekday-only progression logic (Mon-Fri only)
- [x] Rework quiz to "Mystery Bonus" challenge (remove all certified detailer language)
- [x] Move mystery bonus card to top of detailer dashboard
- [x] Change greeting to "Have a great day today" with name below
- [x] Add "Participate to earn a mystery bonus" header with prize icon
- [x] Add weekly expiration timer for mystery bonus challenge
- [x] One-chance only quiz (no retries if wrong)
- [x] Update admin quiz screen to remove certified language, add expiration date
- [x] Update admin-employees to remove certified badges
- [x] Allow time-off requests outside policy with warning (still submittable, high chance of denial)
- [x] Admin edit team member profiles (name, email, phone, city, role, PIN)
- [x] Make "Have a great day" greeting text bigger
- [x] Support multiple questions per single challenge
- [x] Treasure chest prize reveal animation on successful challenge completion
- [x] First prize: "Lunch On The Boss" with plate of food as showcase prize
- [x] Team Dashboard in Timesheets with Day/Week/Month/Custom filters, percentage breakdown chart, total hours, and per-detailer list


## Door Hanger Tracker

- [ ] Add door_hanger_rep role to employee role enum
- [ ] Create door_hanger_entries and door_hanger_goals tables
- [ ] Add API routes for door hanger CRUD
- [ ] Build door hanger rep entry form screen
- [ ] Build door hanger rep history screen
- [ ] Build admin door hanger dashboard
- [ ] Update auth routing for door_hanger_rep role


## Training Module

- [x] Create training data structure (TrainingModule, Tool, Step, UserTrainingProgress tables)
- [x] Add training API routes (get modules, get module details, update progress)
- [x] Create Training tab in main navigation
- [x] Build training home screen with vehicle parts grid
- [x] Build training module detail screen with tool display
- [x] Build step-by-step viewer with interactive instructions
- [x] Implement progress tracking (mark steps as completed)
- [x] Add completion celebration screen
- [x] Seed training content data (tools and steps for each module)
- [x] Add training section to detailer dashboard
- [x] Remove training tab from tab navigation
- [x] Populate all 14 training modules with tools and steps from handbook
- [ ] Generate images for each training module (optional enhancement)
- [x] Create admin training management screen
- [ ] Add ability to view employee training progress (optional enhancement)
- [ ] Test training module end-to-end with all content


## Training Module Debugging

- [x] Verify training router is registered in server/routers.ts
- [x] Fix missing await statements in database queries (getAllTrainingModules, getToolsForModule, getStepsForModule)
- [x] Fix UI loading states to show errors instead of infinite spinner
- [x] Add error handling and retry buttons to admin training screen
- [x] Add error handling and retry buttons to detailer training screen
- [ ] Test training module with actual login to verify tabs appear
- [ ] Verify admin training screen loads data correctly


## Training Module UI Redesign

- [x] Redesign training section cards with gradients and better visual hierarchy
- [x] Generate icons/emojis for each training module
- [x] Enhance training module detail screen styling
- [x] Add progress indicators to training modules
- [x] Improve step-by-step viewer visual design
- [ ] Add animations to training interactions (optional enhancement)


## Bug Fixes

- [x] Door hanger logout not working - added dismissAll() to clear navigation stack before logout


## Training Videos

- [x] Add videoUrl field to training_modules table
- [x] Create video player component for Loom/YouTube videos
- [x] Add Engine Bay training video (Loom)
- [ ] Add remaining training videos for other modules


## Bugs

- [x] Engine Bay video not displaying - fixed by clearing and reseeding training data
- [x] Make video sticky at top while scrolling through steps

- [x] Add exit button to training module detail screen
- [x] Fix video overlapping back/exit buttons - moved header text below video
- [x] Prevent fullscreen video playback completely - removed allowfullscreen attribute


## Efficiency Score & Tips Tracking

- [x] Add efficiency score calculation (daily, weekly, all-time) based on $100/hour target
- [x] Display efficiency scores on detailer dashboard
- [x] Add tips input field to detailer dashboard
- [x] Store tips data in database
- [x] Add tips column to admin detailer log section


## Tips Adjustment

- [x] Remove tips input from detailer dashboard
- [x] Keep tips display (read-only) on detailer dashboard
- [x] Verify tips input is only in admin panel


## Efficiency Auto-Calculation

- [x] Remove efficiency input field from admin entry form
- [x] Verify efficiency is auto-calculated from revenue and hours


## Projected Income Feature

- [x] Add projected income calculation (tips + bonus + $17/hr - 16.65% tax)
- [x] Display daily projected income on detailer dashboard
- [x] Display weekly projected income on detailer dashboard
- [ ] Display all-time projected income on detailer dashboard
- [x] Test projected income calculations


## UI Cleanup & History Updates

- [x] Remove "After 16.65% Tax" text from projected income section
- [x] Remove efficiency calculation formula text from dashboard
- [x] Add tips column to history tab (daily and weekly)


## Week Calculation Fix

- [ ] Update week boundaries to Monday-Sunday (currently Sunday-Saturday)
- [ ] Fix projected income weekly calculation for current work week
- [ ] Verify history tab shows correct weekly groupings


## Weekly Metrics Bug

- [ ] Debug: This Week shows less revenue/income than Today - should be cumulative
- [ ] Fix weekly metrics aggregation to sum all days Monday-Sunday
- [ ] Verify projected income weekly calculation includes all week data

## Timesheet Management System

- [x] Create timesheet database schema (clock_in_out, breaks tables)
- [x] Build clock in/out API routes
- [x] Create clock in/out UI button (turns blue when clocked in)
- [x] Implement break notification system (10 AM, 3 PM, 12 PM)
- [x] Add push notifications for breaks
- [x] Add in-app alert notifications for breaks
- [x] Build timecard display (hours this week)
- [x] Add break tracking and logging
- [x] Test timesheet system
- [ ] Save checkpoint


## Timesheet Tab (New Feature)

- [x] Add API routes to update clock in/out times (for error corrections)
- [x] Add API route to get weekly hours summary
- [x] Add API route to get daily logs for a week
- [x] Build timesheet screen with week navigation
- [x] Display weekly hours at top of tab
- [x] Create daily log with date, clock in, clock out, breaks
- [x] Make times editable for both detailers and admins
- [x] Add "Start Break" button after clock in
- [x] Update break notifications with "Start Break Now" action button
- [x] Mark breaks as taken when "Start Break Now" is clicked
- [x] Use 12-hour time format throughout
- [x] Add timesheet tab to detailer navigation
- [x] Add timesheet tab to admin navigation
- [x] Admin can view/edit any employee's timesheet
- [x] Detailer can only view their own timesheet
- [x] Auto-populate hours from clock in/out records
- [x] Test timesheet functionality end-to-end

## Notification Display on Dashboard

- [x] Add notification section to detailer dashboard below greeting
- [x] Create notification display component with dismiss/acknowledge options
- [x] Add API routes for fetching and managing notifications (already existed)
- [x] Implement notification state management and persistence

## Admin Training Module Editing

- [x] Add API route to update training module details (name, description, videoUrl)
- [x] Create edit modal component for training modules
- [x] Add edit button to admin training screen
- [x] Allow admins to add/edit Loom video links
- [x] Test admin training module editing end-to-end

## Training Step Editing

- [x] Add API route to update training steps (title, description, imageUrl, warnings, tips)
- [x] Create edit step modal component
- [ ] Add edit button to each step in admin training screen
- [ ] Allow admins to edit step content
- [ ] Test training step editing end-to-end

## Signature Capture for Notification Acknowledgement

- [ ] Create signature capture component using react-native-signature-canvas
- [ ] Add signature modal to notification acknowledgement flow
- [ ] Store signature image with acknowledged notification
- [ ] Display signature on admin side when viewing acknowledgements
- [ ] Test signature capture end-to-end

## UI Enhancements (In Progress)

- [x] Move clock in/out button to top header section
- [x] Add running time display (time since clock in)
- [x] Create split logout/break buttons after login
- [x] Add Timesheet option to navigation dropdown menu
- [x] Test header clock in/out functionality

## Schedule Screen Enhancements

- [x] Add full customer fields to job form: first name, last name, email, phone, address
- [x] Add service with title + description (not just a chip selector)
- [x] Add job price field with subtotal/total display
- [x] Add job detail view (tap job card to see full details)
- [x] Add job status flow: Scheduled → On My Way → Start → Finish
- [x] Persist jobs with AsyncStorage so they survive app restarts

## Schedule GPS Navigation

- [x] Add GPS icon next to address in job detail view that opens Google Maps with directions

## Job Photos

- [x] Add photo section at bottom of job detail view (camera + library picker)
- [x] Store photos per job in AsyncStorage (base64 or file URI)
- [x] Display photo thumbnails in a grid in job detail
- [x] Allow long-press to delete a photo

## Job Status UI

- [x] Redesign status buttons as horizontal row (icon + label) at top of job detail, matching reference screenshot

## Stripe Payment Integration

- [ ] Install @stripe/stripe-react-native SDK
- [ ] Add Stripe secret key to server environment
- [ ] Create server-side /api/stripe/payment-intent endpoint
- [ ] Build Checkout screen (job total, note, payment history)
- [ ] Build Payment method selection (Credit/Debit, Cash, Check, Other)
- [ ] Integrate Stripe PaymentSheet for card payments
- [ ] Record payment status on job (paid, method, amount)
- [ ] Show payment confirmation and update job status

## Checkout & Signature Flow

- [x] Add Pay button to job detail view
- [x] Build Checkout screen (job total, note, payment history)
- [x] Build Payment method selection (Credit/Debit, Cash, Check, Other)
- [x] Build card entry form for Credit/Debit (demo mode, no real charge)
- [x] Add tip selection step (15%, 18%, 20%, 25% presets + custom amount + no tip)
- [x] Build signature capture screen (finger-draw canvas)
- [x] Build payment confirmation screen
- [x] Save payment record to job (method, amount, tip, total, signature, timestamp)
- [x] Show PAID badge on job card in schedule grid
- [x] Show payment summary in job detail view (method, tip breakdown, total)

## Click-and-Drag Scheduling

- [x] Implement drag-to-select time range on schedule grid (touch + mouse)
- [x] Show blue highlight over selected time slots while dragging
- [x] Auto-open Add Job modal pre-filled with dragged start/end hours
- [x] Drag existing job cards to reschedule to a new time slot
- [x] Visual ghost card while dragging an existing job
- [x] Persist rescheduled jobs to AsyncStorage
- [x] Rebuild schedule as full Mon-Sun weekly grid (all 7 days visible across screen)
- [x] Week ends on Sunday (Mon-Sun layout)

## Schedule Screen Layout Fix

- [x] Remove extra blank space between app header bar and "Schedule" title

## Schedule Day View & Drag Fix

- [x] iOS Calendar-style day view: tap day in week strip to see full-width timeline
- [x] Fix drag-and-drop using GestureHandler (PanGesture) instead of PanResponder
- [x] Remove drag hint text from schedule screen
- [x] Show selected day full date label below week strip (e.g. "Sunday, April 5, 2026")

## Service Wizard & Drag Fix

- [x] 3-step service wizard in Add Job: vehicle type → package → add-ons
- [x] Vehicle types: Sedan, SUV, XL SUV/Van, Truck with icons
- [x] Package cards with feature list and auto-populated price/description
- [x] Add-ons grid (multi-select, each with price)
- [x] Total price auto-calculated from package + add-ons
- [x] Fix drag-to-move on existing job cards

## Schedule Bug Fixes (Apr 2026)

- [x] Fix tap on empty time slot no longer opens Add Job modal
- [x] Fix Select Vehicle & Service button not opening service wizard

## Schedule Bug Fixes Round 2 (Apr 2026)

- [x] Remove nested GestureHandlerRootView to fix service wizard Modal touch issues
- [x] Fix tap coordinate using measureInWindow + remeasure on each gesture start
- [x] Fix drag-to-create to snap to exact finger position hour

## Service Picker & Drag Fix Round 3 (Apr 2026)

- [x] Replace service wizard Modal with inline pickers in Add Job sheet (vehicle type, package, add-ons)
- [x] Fix drag-to-create time starting at wrong hour (noon instead of tapped slot)

## Payment & Drag-to-Create Fix (Apr 2026)

- [x] Fix payment button not responding in job detail view (moved CheckoutModal outside gesture scope)
- [x] Enable drag-to-create new jobs on empty time slots (drag down on empty area to set time range)
- [x] Fix drag coordinate using shared values instead of refs (synchronous in worklet)

## Service Line Items & Package Features

- [x] Show included features list on selected package card (shown when package is selected)
- [x] Redesign add-ons as separate line items with quantity +/- steppers
- [x] Qty > 1 shows multiplied price (e.g. $50 × 2 = $100) and counts in service title
- [x] Store addonQtys map on Job type
- [x] Show line item breakdown in job detail view (package + each add-on)
- [x] Rename "Photos" section to "Before & After Photos" in job detail view

## Job Detail Package Feature List

- [x] Show full bullet-point feature list of selected package in job detail SERVICE card


## WordPress Booking Integration

- [x] Add bookings table to database schema (location, customer info, date, time slot, service, status)
- [x] Add migration SQL for bookings table
- [x] Add booking DB helper functions (createBooking, getBookingsByDate, getBookingsByLocation)
- [x] Add REST webhook endpoint POST /api/booking/webhook?location=X to receive Zapier payloads
- [x] Add REST availability endpoint GET /api/booking/availability?location=X&date=YYYY-MM-DD
- [x] Add location constants (Crestview, Niceville, Destin, Fort Walton Beach) with detailer capacity
- [x] Seed 6 detailer employees: Michael, Cameron (Crestview), Lamont, Casey (Niceville), Giovanni (Destin), Gabe (FWB)
- [x] Add location selector to Schedule screen (tab bar or dropdown for 4 cities)
- [x] Update Job type to include location field
- [x] Show online bookings on schedule calendar (synced from webhook)
- [x] Fix timezone handling in WordPress form (proper CST/CDT offset)
- [x] Update WordPress form renderTimeSlots() to call availability API and grey out booked slots
- [x] Generate modified WordPress booking form JS for all 4 locations
- [x] Document Zapier webhook URLs for each location

## Role-Based Calendar Visibility

- [ ] Detailers see only their own calendar (no location selector, no other detailer's jobs)
- [ ] Admins see location selector with all 4 cities
- [ ] Admin dual-lane view for Crestview and Niceville (both detailers side-by-side)
- [ ] Admin single-lane view for Destin and Fort Walton Beach
- [ ] Jobs tagged with detailer name when created by a detailer
- [ ] Admin can see which detailer owns each job in dual-lane view

## Admin Schedule Access

- [x] Add Schedule to admin navigation menu (top-nav-menu.tsx)
- [x] Register admin-schedule as a tab route in _layout.tsx
- [x] Build admin schedule screen with city dropdown selector
- [x] Dual-lane timeline for Crestview (Michael + Cameron) and Niceville (Lamont + Casey)
- [x] Single-lane timeline for Destin (Giovanni) and Fort Walton Beach (Gabe)
- [x] Detailer-only schedule: filter jobs by employee city and name, no location selector shown
- [x] Tag new detailer jobs with employee name (detailerName field on Job)

## Admin PIN Reset Bug

- [x] Fix admin PIN reset not working on admin-employees screen
- [x] Verify resetPin tRPC mutation is still registered in routers.ts
- [x] Test PIN reset end-to-end after fix

## Real-Time Projected Pay

- [x] Add live ticker to projected pay on detailer dashboard — increments every second while clocked in
- [x] Ticker pauses when clocked out
- [x] Use clock-in timestamp + hourly rate ($17/hr) to calculate live earnings
- [x] Include today's bonus/tips in the live total

## Upsell Addon Feature

- [ ] Fix admin-schedule route TypeScript error
- [ ] Build admin schedule screen (city dropdown, dual-lane for Crestview/Niceville)
- [ ] Add Upsells panel to job detail modal on schedule screen
- [ ] Define upsell addon catalog (e.g. ceramic coat, engine bay, odor removal, etc.)
- [ ] Allow detailer to select upsells and enter quantities on a completed/started job
- [ ] Calculate 40% of upsell total as detailer bonus
- [ ] Save upsell total to job record
- [ ] Push upsell bonus into daily performance record (upsells field)
- [ ] Live pay ticker includes upsell bonus in real-time total
- [ ] Show upsell bonus breakdown on job detail card

## Bug Fixes (Apr 6)

- [x] Remove city selector tabs from detailer schedule screen — detailers should see NO location selector
- [x] Detailer schedule filters jobs by their own city/name only (no cross-location jobs visible)
- [x] Fix missing upsell button on job detail sheet — "Add Upsells" button now visible for all job statuses

## Bug Fixes (Apr 6 - Round 2)

- [x] Fix upsell panel showing no addons when opened
- [x] Fix save job button doing nothing on detailer schedule screen
- [x] Add job creation (+ button) to admin schedule screen

## Bug Fixes (Apr 6 - Round 3)

- [x] Fix delete job freezing screen (modal/state not cleaned up after delete)
- [x] Add thin white outline to job blocks to prevent visual overlap on calendar
- [x] Upgrade admin booking form to match detailer form (vehicle type, package picker, addon picker)

## Bug Fixes (Apr 6 - Round 4)

- [x] Fix screen freeze after any modal interaction on schedule screen (moved all modals outside ScreenContainer, added onRequestClose)
- [x] Fix upsell button not opening addon catalog
- [x] Rebuild upsell flow: tap button → full addon catalog popup with pre-populated prices → qty controls → 40% of total saved as bonus

## Auto-Tag & Upsell Bonus Wiring

- [x] Auto-tag detailerName on job creation (saveJob uses employee.fullName)
- [x] Auto-tag location on job creation (saveJob uses employee.city slug)
- [x] Wire upsell 40% bonus into existing dashboard bonus field (already wired via performance.upsert + getDateRange invalidation; added refetchOnWindowFocus to ensure fresh data on tab switch)

## Bug Fixes (Apr 6 - Round 5)

- [x] Hamburger menu: tap outside the menu box to close it (full-screen overlay Pressable)
- [x] Upsell button: fully fixed - upsell panel is now inline inside Job Detail Modal (no stacked Modals), guaranteed to receive touches

## Upsell Total Added to Job Price

- [ ] When upsells are saved, add full upsell total to job's price field (not just 40% bonus)
- [ ] Show updated job total on job card and detail view after upsells are added
- [ ] Add custom upsell input (name + price) at bottom of upsell panel
- [ ] Custom upsell also contributes to job total and 40% bonus


## Timer System & Vehicle Inspection

- [x] Add travelStartedAt, arrivedAt, jobStartedAt, jobFinishedAt timestamp fields to Job type
- [x] Update advanceStatus() to record timestamps at each step
- [x] Add 4-step status flow: ON MY WAY → ARRIVED → START → FINISH
- [x] Add live timer display cards (Travel amber, Job Time green) in job detail modal
- [x] Add timerTick state with 1-second interval for live updates
- [x] Add formatElapsed() helper function
- [x] Add live timer badge to job cards in timeline view (shows elapsed time)
- [x] Add VehicleInspection interface and DAMAGE_ITEMS/FUEL_LEVELS constants
- [x] Add vehicle inspection modal with fuel level, mileage, damage checklist
- [x] Add inspection summary card in job detail modal
- [x] Inspection saves to job data and persists in AsyncStorage

## Timer & Inspection Fixes

- [x] Fix inspection button not working (modal not opening from job detail)
- [x] Keep travel and job timers visible after FINISH (don't hide on completion)
- [x] Remove START button from status flow — job auto-starts on ARRIVED
- [x] New flow: ON MY WAY → ARRIVED → FINISH (3 steps, no manual START)

## Inspection UI Redesign (Match Original Design)

- [x] Replace flat checklist with categorized inspection items (Paint, Wheels, Glass, Water Spots, Scratches)
- [x] Add Good/Fair/Poor/N/A rating buttons per category
- [x] Add interactive car diagram (top-down SVG) with tappable damage zones
- [x] Add Exterior/Interior tab toggle for the car diagram
- [x] Add completed report view showing ratings, damage zone chips, and notes
- [x] Add Edit and Done buttons at the bottom of the completed report

## Website Booking Form Integration

- [x] Update booking form: restore Zapier hook URL, add dual submission to app server
- [x] Add city location variable to form (swap per city page)
- [x] Wire schedule screen to pull online bookings from server and merge with local jobs (already implemented)
- [x] Deliver 4 city-specific form versions with instructions

## Booking Form Bug Fixes

- [x] Fix vehicle count Next button not highlighting after selecting number of vehicles (Destin form)
- [x] Fix Next Step button still greyed out after selecting car count (Destin form)
- [x] Fix online bookings from website form not appearing on detailer schedule in app
- [x] Fix mobile app schedule not showing online bookings from server — added syncOnlineBookings to admin-schedule
- [x] Add appointment detail view to admin web app (email, add-ons, service shown in detail modal)

## Automated Sales Callback & Team Management

- [x] Add 'sales' role to employees schema enum and all role validation in routers.ts
- [x] Add 'sales' to EmployeeRole type in auth-context.tsx and add isSalesRep boolean
- [x] Add sales_callbacks table to DB schema (prospect info, scheduled time, notes, status, GHL log)
- [x] Add DB migration for sales_callbacks table
- [x] Add callback DB helper functions (createCallback, getCallbacksByEmployee, getAllCallbacks, updateCallbackStatus)
- [x] Add sales callback tRPC router (schedule, list, listAll, updateStatus, reassign)
- [x] Add GHL API integration on server (send payload to GHL webhook when callback is scheduled)
- [x] Add GHL webhook URL to environment secrets
- [x] Build Sales Dashboard screen (leads list, upcoming callbacks, completion metrics)
- [x] Build Callback Scheduling form (prospect name/phone/email, date/time picker, notes, timezone)
- [x] Add sales role routing in login.tsx (redirect to sales dashboard)
- [x] Add (sales) route group with layout and screens
- [x] Build Admin Callbacks panel (global view, reassign, SMS delivery status, completion rate)
- [x] Add Sales Callbacks section to admin navigation menu
- [x] Add in-app reminder notifications for upcoming callbacks (15 min before)
- [x] Add callback reminder scheduler (server-side polling, similar to clockMonitor.ts)
- [x] Test GHL integration end-to-end (vitest passes, webhook returns 200)
- [x] Test double-booking prevention for callbacks (handled via DB unique callbackId)

## Bug Fixes — Sales Callback Storage

- [x] Fix: callbacks not being saved to DB after scheduling (only webhook fires, no DB insert)
- [x] Fix: callback history not showing on Sales Dashboard
- [x] Fix: Admin Callbacks panel showing no data
- [x] Verify tRPC salesCallback.schedule mutation actually inserts to sales_callbacks table
- [x] Verify salesCallback.list query returns data to the Sales Dashboard

## Bug Fixes — Sales Logout

- [x] Fix: no logout button on sales dashboard — sales reps cannot sign out

## Bug Fixes — Zapier Webhook Missing Fields

- [x] Fix: booking form Zapier webhook not sending streetAddress, city, state, zipCode, selectedAddons, selectedDate, selectedTime, totalPrice, discountCode, discountAmount, finalTotal

## Booking Form Zapier Updates

- [x] Destin form — add sendBookingToZapier, correct Zapier URL (uhuu3tg), thank-you URL /destin/
- [x] Pensacola form — add sendBookingToZapier, correct Zapier URL (uaoh2o4), thank-you URL /pensacola/
- [x] Crestview form — add sendBookingToZapier, correct Zapier URL (uy0xzc0), thank-you URL /crestview/
- [x] Niceville form — add sendBookingToZapier, correct Zapier URL (uoly9zh), thank-you URL /niceville/
- [x] Fort Walton Beach form — add sendBookingToZapier, correct Zapier URL (uoqp6s6), thank-you URL /fort-walton-beach/

## Booking Form Add-On Fix

- [x] Replace broken placeholder add-ons in new form with correct add-ons, prices, and image URLs from old form
- [x] Regenerate all 5 city forms (Destin, Pensacola, Crestview, Niceville, FWB) with fixed add-ons

## Bug Fix — Online Bookings Not Showing in App

- [x] Diagnose why website bookings are not appearing in the app dashboard
- [x] Fix: app was filtering to Upcoming only — rewritten to show All by default; Pensacola added to LOCATIONS, CITY_CONFIG, LOCATION_CAPACITY, normalizeLocation
- [x] Verified: 33 Destin + 4 Crestview bookings confirmed in DB, API returns data, app now displays all bookings

## Data Cleanup

- [x] Update Pensacola detailer from "Sales" to "Terry" in admin-schedule.tsx
- [x] Delete all demo/test bookings from online_bookings table in DB (37 records removed: 33 Destin + 4 Crestview)

## Detailer Dashboard Revenue Sync

- [ ] Audit how detailer dashboard calculates revenue, tips, and bonuses
- [ ] Ensure online bookings on calendar feed into detailer earnings metrics
- [ ] Fix data pipeline so completed calendar bookings appear in detailer revenue/tips/bonus totals

## Bug Fix — Web App Jobs Not Matching Mobile App Schedule

- [ ] Audit web app admin schedule data source vs mobile app schedule data source
- [ ] Fix web app to show exactly the same jobs as mobile app — no extras, no missing
- [ ] Ensure online bookings from DB appear on web app schedule
- [ ] Fix detailer dashboard revenue/tips/bonus to reflect completed calendar bookings

## Job Sync — Server DB (Option A)

- [x] Add schedule_jobs table to DB schema (mirrors Job type from mobile app)
- [x] Add DB migration for schedule_jobs table
- [x] Add job CRUD DB helper functions (upsertJob, getJobsByLocation, getJobsByDate, deleteJob, updateJobStatus)
- [x] Add jobs tRPC router (upsert, list, delete, updateStatus)
- [x] Update mobile app schedule.tsx to save jobs to server on create/edit/delete
- [x] Update mobile app schedule.tsx to load jobs from server on mount (merge with local)
- [x] Update admin-schedule.tsx to load all jobs from server (manual + online bookings)
- [x] Mirror online bookings into schedule_jobs table on webhook receipt
- [ ] Fix detailer dashboard revenue/tips/bonus to reflect completed calendar bookings

## Bug Fix — Online Bookings Not Reaching Server

- [ ] Audit server webhook endpoint — confirm it is publicly reachable from Zapier
- [ ] Check if the booking form is sending directly to the server (dual-submit) or only via Zapier
- [ ] Verify Zapier webhook URL for Niceville matches the live server URL
- [ ] Test the webhook endpoint directly with a curl POST
- [ ] Fix whatever is broken in the pipeline so bookings appear on admin schedule

## Niceville Form Update

- [x] Verify booking-form-niceville.html has correct submitBookingToApp, LOCATION_SLUG=niceville, Zapier URL
- [x] Deliver updated Niceville form to user for WordPress paste

## Dynamic City Booking Capacity

- [x] Audit LOCATION_CAPACITY hardcoded values and employee city fields in DB
- [x] Add DB helpers: getLocationCapacity(), getAllLocationCapacities(), getDetailersByLocation()
- [x] Replace hardcoded LOCATION_CAPACITY with live DB query in availability endpoint
- [x] Update availability endpoint to return capacity = number of active detailers in that city
- [x] Update webhook double-booking check to allow up to N simultaneous bookings (N = active detailers)
- [x] Add /api/booking/detailers endpoint (returns detailer list + capacity per city)
- [ ] Update admin schedule to show a lane per detailer (dynamic, not hardcoded names)
- [ ] Update booking forms (all 5 cities) to reflect dynamic capacity

## New Team Member — Terry (Pensacola)

- [x] Create Terry detailer account in DB (city: Pensacola, PIN: 0000, role: detailer)
- [ ] Verify Terry appears on admin schedule Pensacola lane
- [ ] Verify Pensacola booking capacity reflects Terry

## Per-Detailer Calendar Filtering

- [x] Audit schedule.tsx: how jobs are loaded and whether they are filtered by assignedTo
- [x] Fix schedule.tsx: only show jobs where assignedTo === logged-in detailer's employeeId (primary) + name fallback
- [x] Fix job creation: auto-set assignedTo = logged-in detailer's employeeId when a detailer creates a job
- [x] Online bookings: auto-assign to least-loaded available detailer in city
- [x] Admin schedule: still shows ALL detailers' jobs (no change needed there)
- [ ] Verify: Lamont and Casey (Niceville) each only see their own jobs

## Dashboard Revenue from Completed Jobs

- [x] Audit detailer dashboard: where does revenue/tips/bonus currently come from (performance table)
- [x] When a job is marked "Finished" in schedule, auto-push revenue + tips to daily performance record
- [x] Dashboard revenue total updates when job is completed via handlePaymentComplete
- [x] Dashboard tips total updates when job is completed via handlePaymentComplete
- [x] Upsell bonus already pushed to performance table separately via saveUpsells

## Booking Rules — 4-Hour Window & Slot Ordering

- [x] Server: availability endpoint returns slots blocked if startHour < now + 4 hours (same-day)
- [x] Server: auto-assign checks detailer availability (no conflicting job in time window) before assigning
- [x] Booking forms: slots sorted earliest-first in all 5 city forms
- [x] Booking forms: grey out booked slots with "Unavailable" label (not hidden)
- [x] Booking forms: grey out too-soon slots with "Book 4+ hrs ahead" label

## Reassign Job Feature

- [x] Add reassignJob DB helper (update assignedTo in schedule_jobs)
- [x] Add jobs.reassign tRPC mutation
- [x] Add Reassign button to admin job detail modal
- [x] Show detailer picker with active detailers in that city (from CITY_CONFIG)
- [x] On confirm: update job locally + sync to server DB
- [x] Reset picker state when modal closes

## Detailer Time-Edit Restrictions & Admin Drag-and-Drop

- [x] Disable drag-to-move for detailers (canDrag=false on DayTimeline/JobBlock when role != admin)
- [x] Hide time +/− pickers in add job modal for detailers (show read-only "Time set by admin" label)
- [x] Admins retain full drag + time edit ability on schedule.tsx
- [x] Add drag-and-drop to admin-schedule.tsx (AdminJobBlock with GestureDetector + Animated.View)
- [x] handleMoveAdminJob: updates local state + syncs to server DB on drag complete
- [ ] Verify admin drag-and-drop works on device

## Cross-Lane Drag-and-Drop (Admin Schedule)

- [x] Track horizontal drag position to detect which lane the job is being dropped into
- [x] Show visual indicator (highlight) on target lane while dragging
- [x] On drop: update job's detailerName + assignedTo to the target detailer
- [x] Sync reassignment to server DB (upsert with new assignedTo)
- [x] Job moves to correct lane immediately after drop
- [x] Add assignedTo field to Job interface in admin-schedule.tsx
- [x] Add employeeId to CITY_CONFIG detailers for correct server sync

## Bug Fix — Cross-Lane Drag Job Height

- [x] Fix lane highlight overlay getting stuck after cross-lane drag (height:0 when not active, reset hoverLane on finalize)

## Drag-to-Resize Job Duration (Admin)

- [x] Add bottom resize handle to AdminJobBlock (small grip bar at bottom edge)
- [x] Pan gesture on handle adjusts endHour (snaps to nearest hour)
- [x] Minimum duration: 1 hour
- [x] On release: sync updated endHour to server DB via handleResizeAdminJob
- [x] Wire onResize through DualLaneTimeline → AdminJobBlock → AdminScheduleScreen

## Bug Fix — Online Booking Date Shift

- [x] Trace date string from server DB → tRPC → schedule.tsx dayIndex calculation
- [x] Fix: replaced all new Date(str + "T00:00:00") with parseLocalDate(str) (uses T12:00:00 local noon)
- [x] Fix: replaced all .toISOString().split("T")[0] with localDateStr() (reads local year/month/day)
- [x] Fixed onResize worklet error: DualLaneTimeline was not destructuring onResize from props
- [ ] Verify: online bookings stay on correct day after sync (user to test)

## Photo Capture Auto-Upload (Back-to-Back)

- [x] Build in-app camera session modal using expo-camera (stays open between shots)
- [x] Each capture immediately appends photo to job (no confirm step)
- [x] Show captured thumbnails at bottom of camera view so user sees progress
- [x] "Done" button closes camera session
- [x] Existing library picker flow unchanged

## Bug Fix — Camera Not Opening

- [x] Diagnose why tapping Camera button does not open the camera view
- [x] Fix: replaced Modal with absolute-position overlay (zIndex 9999) to bypass iOS modal-stacking limitation

## On My Way SMS + Live Customer Tracking + Admin Fleet Map

- [ ] Set up Twilio credentials (Account SID, Auth Token, From number) — deferred
- [x] Server: detailer_locations and tracking_tokens tables created and migrated
- [x] Server: tRPC endpoints for location upsert/deactivate/getActive and token create/expire/getByToken
- [x] Server: public /track/:token HTML page with Leaflet map, live polling every 15s, auto-expiry
- [x] Detailer app: GPS location sharing starts on On My Way, stops on Arrived/Finish
- [x] Detailer app: tracking token created on On My Way for customer link
- [ ] Server: send Twilio SMS with tracking link when On My Way is triggered — deferred
- [x] Admin fleet map screen (admin-only, accessible from top nav menu)
- [x] Fleet map: auto-refresh every 30s, tap pin for detailer name + status + last updated

## Fleet Map UI Fixes

- [x] Move legend bar up so it's not cut off at the bottom (now a floating pill overlay above bottom edge)
- [x] Add demo van pin near Niceville to preview what active van looks like
- [x] Custom van marker: amber circle with 🚐 emoji, tail pointer, and name label below
- [x] Demo banner shown when no real vans are active

## Bug Fix — Extra Top Space on Admin Screens

- [x] Identified: TopNavMenu handles insets.top but ScreenContainer default edges also included "top"
- [x] Fixed 15 screens: removed "top" from ScreenContainer edges across all (tabs) screens with TopNavMenu

## Schedule + Fleet Map Fixes

- [x] Fix duplicate day name in schedule card header (formatFullDate already includes day name; removed redundant WEEK_DAYS_FULL prefix)
- [x] Show job destination address in fleet map van callout popup ("📍 Heading to:" row, stored in detailer_locations.customer_address)

## Tracking Link + Fleet Map Enhancements

- [x] Auto-expire tracking token immediately when detailer taps Arrived — tracking page now shows a branded "🏁 Arrived" page instead of generic expired message
- [x] Add Navigate button to fleet map callout — opens Apple Maps on iOS, Google Maps on Android, routing to job address

## Bug Fixes — Camera + Admin Schedule

- [x] Camera overlay appears behind job detail modal — fixed by wrapping Fragment in flex View for proper stacking context
- [x] Jobs not showing on Niceville admin schedule — stale AsyncStorage cache with wrong weekOffset values from old timezone bug
- [x] Bumped STORAGE_KEY to v5 to force clear stale cache on next app open
- [x] Added ⟳ refresh button in admin schedule header to force server resync on demand

## Bug Fixes — Camera Overlay & Drag-Drop (April 8)

- [x] Camera overlay still appears behind job detail modal — fixed: using Modal with presentationStyle=overFullScreen
- [x] Drag-and-drop for existing booked jobs: reduced long-press to 300ms, fixed employeeId→name resolution, unassigned jobs default to lane 0

## Job Detail Enhancement
- [ ] Add tags, privateNotes, leadSource, taxAmount, additionalVehicles columns to DB schema
- [ ] Add server API endpoints: updateJobMeta (tags/privateNotes/taxAmount), getCustomerHistory
- [ ] Build enhanced detailer job detail: customer card with call/text/nav, job schedule card, multi-vehicle card, line items card, tags, private notes (read-only), lead source
- [ ] Build enhanced admin job detail mirroring detailer view with private notes editable
- [ ] Write and run tests for new endpoints

## Job Detail Enhancement (completed Apr 8, 2026)
- [x] Extend DB schema: tags, privateNotes, leadSource, taxAmount, discountCode, discountAmount, additionalVehicles
- [x] Add jobs.updateMeta and jobs.customerHistory API endpoints
- [x] Detailer job detail: enhanced Customer card with call/text/navigate buttons
- [x] Detailer job detail: Job Schedule card in From/To format
- [x] Detailer job detail: Vehicles & Services card with multi-vehicle support, package features, add-ons
- [x] Detailer job detail: Line Items card with subtotal, discount, tax (editable), total
- [x] Detailer job detail: Job Tags card (editable)
- [x] Detailer job detail: Private Notes card (read-only for detailers)
- [x] Detailer job detail: Lead Source row (auto-populated)
- [x] Detailer job detail: Customer History inline expandable
- [x] Admin job detail: mirrors all detailer cards + Private Notes fully editable
- [x] Auto-populate leadSource on new manual job creation


## Per-Author Private Notes

- [x] Change privateNotes DB column from single text string to JSON array of note objects
- [x] Add photoUrls DB column for S3 photo URLs
- [x] Run DB migration for new columns
- [x] Add server endpoints: addPrivateNote, editPrivateNote, deletePrivateNote, getPrivateNotes
- [x] Add server endpoints: uploadPhoto, deletePhoto, getPhotos
- [x] Add PrivateNotesCard component to schedule.tsx (detailer view)
- [x] Add AdminPrivateNotesCard component to admin-schedule.tsx (admin view)
- [x] Per-author edit permission: only the author can edit their own note
- [x] Delete permission: author can delete own note, admin can delete any note
- [x] Fix client-side JSON parsing of privateNotes from DB string to PrivateNote[]

## Discount & Deposit on Job Detail

- [x] Add deposit column to schedule_jobs DB schema and run migration
- [x] Update updateMeta server endpoint to accept deposit amount
- [x] Update admin-schedule.tsx pricing card: Subtotal → Discount (editable) → Tax → Total → Deposit (editable) → Balance Due
- [x] Update schedule.tsx (detailer view) to show discount and deposit in same layout (read-only)

## Revenue Sync, Schedule UX & Add Vehicle

- [x] Fix schedule job revenue not showing on detailer dashboard metrics (fixed tRPC response parsing + added completedForDetailer query to dashboard)
- [x] Replace tap-to-create on schedule timeline with long-press (hold & drag) to book (350ms LongPress gesture)
- [x] Add "Add Vehicle" button to admin job booking form for additional vehicles (per-vehicle type + package, running total, saves to DB)

## Revenue & Bonus Fix (Dashboard)

- [x] Fix revenue push: total revenue = base price + upsell amount on job completion
- [x] Fix bonus calculation: bonus = 40% of upsell only (not base price)
- [x] Fix dashboard weekly totals: sum all days Mon-Sun for revenue and bonus
- [x] Verify daily and weekly revenue display correctly on detailer dashboard

## Revenue Display & Calendar Dots

- [x] Fix revenue: completedForDetailer query matches by employeeId AND name (legacy jobs)
- [x] Dashboard: show revenue from confirmed+in_progress+completed jobs (not just completed)
- [x] Fix visibleJobs filter for blue dot: match by employeeId (new jobs) OR name (legacy)
- [x] Admin dashboard: include schedule job revenue per detailer using jobs.listAll
- [x] 11/11 vitest tests passing for revenue calculation logic

## Stripe Checkout Flow

- [x] Install @stripe/stripe-react-native and configure StripeProvider (platform-safe web stub via Metro resolver)
- [x] Checkout modal: method screen, card entry (Stripe CardField on native, plain inputs on web), tip, signature, result
- [x] Server: createPaymentIntent endpoint using STRIPE_SK env var
- [x] handleConfirm: creates PaymentIntent, calls confirmPayment, shows Approval/Denial result screen
- [x] Approval screen: green check with receipt summary; Denial screen: red X with retry option
- [x] 16/16 vitest tests passing for checkout logic (card formatting, tip calc, amount conversion)

## UI Fixes (Apr 8, 2026)

- [x] Shrink Time Off filter bars to compact pill-style tabs
- [x] Remove book appointment button from detailer schedule view
- [x] Fix admin job cards not tappable in multi-column layout (background gesture on separate absolute layer)
- [x] Add deposit and discount fields to admin job detail / checkout
- [x] Swipe left/right on calendar to change days
- [x] Long press + drag to create new appointment (not tap/short drag)

## Bug Fixes (Apr 9, 2026)

- [x] Fix revenue not showing from schedule jobs for Lamont/Niceville (server query now matches by employeeId OR name)
- [x] Fix blue dots not showing on detailer calendar days (visibleJobs filter matches employeeId OR name)
- [x] Fix admin dashboard revenue: resolve legacy name-based assignedTo to employeeId before aggregating
- [x] Add detailer picker to admin add-job modal (assign team member when creating a job)
- [x] Fix swipe gesture: use failOffsetY to prevent conflict with ScrollView vertical scroll

## Persistent Bugs (Apr 9, 2026) — FIXED

- [x] BUG: Can't swipe left/right on calendar — replaced gesture-based swipe with horizontal paging ScrollView (3-page approach)
- [x] BUG: Can't click/tap job cards from admin side — removed background GestureDetector entirely, empty slots use TouchableOpacity onLongPress
- [x] BUG: Job revenue not showing on detailer dashboard — fixed case-sensitive LIKE query using LOWER() in SQL for both completedForDetailer and listByLocation
- [x] Swipe left/right on calendar timeline to change days (horizontal paging ScrollView approach)
- [x] Keep arrow buttons on day label bar alongside swipe

## Admin Job Card Tap Bug (Apr 9, 2026)

- [x] BUG: Can't tap/edit job cards from admin panel — replaced GestureDetector (Exclusive pan/tap) with simple TouchableOpacity onPress, which doesn't compete with gesture system

## Revenue & Timezone Issues (Apr 9, 2026)

- [x] Timezone: Server runs on Eastern Time (America/New_York). Job dates stored as YYYY-MM-DD strings, no timezone conversion needed.
- [x] $380 vs $400: The $400 job is assigned to Casey, not Lamont. Lamont has a manual performance entry of $380. Reassign the $400 job to Lamont on the schedule to fix.
- [x] Bonus calculation: daily_performance.upsells stores the 40% bonus amount (set by schedule job upsell panel). Dashboard displays it as-is. Fixed double-application of 40% that was introduced in a previous fix.
- [x] Week range: Monday-Sunday confirmed correct in getWeekDates function.

## Timezone Fix (Apr 9, 2026)

- [x] Set server timezone to CST (America/Chicago) — TZ=America/Chicago env var set
- [x] Replace all toISOString().split('T')[0] calls on server with todayCST() helper using Intl.DateTimeFormat
- [x] Fix getWeekRange() in detailer dashboard (index.tsx) to use CST
- [x] Fix getWeekRange() in admin dashboard to use CST
- [x] Client-side date helpers (localDateStr, parseLocalDate) already use local time — correct for CST devices

## Recommendations Feature (Apr 9, 2026)

- [x] Add "Recommended Services" section at bottom of job detail modal
- [x] Detailer can select from existing add-ons list to recommend for the vehicle
- [x] Recommendations saved to the job record in DB (new recommended_services column via migration 0027)
- [x] Show saved recommendations on the job detail view with purple RECOMMENDED badge
- [x] Slide-up panel with full ADDONS list, checkbox multi-select, and save button
- [x] Synced to server via jobToServerPayload and loaded back via syncServerJobs
- [x] Fix admin job card taps — replaced horizontal paging ScrollView (which intercepted all touches) with PanResponder swipe detector; job cards now tappable from admin view
- [x] Admin dispatch board: multi-column layout with one column per detailer at the selected location
- [x] Single-column fallback when only one detailer is at a location
- [x] Each column header shows detailer name with colored dot
- [x] Tapping any job card in any column opens job detail modal for editing
- [x] New detailers automatically get their own column when added to a location
- [x] Add Edit button on admin dispatch board job cards to open job detail modal
- [x] Build full admin web portal at /admin (dispatch board, jobs, team members, timesheets, time-off, alerts)
- [x] Add Map View section to admin web portal (live van GPS + job address pins, auto-refresh every 30s)
- [x] Show clocked-in detailers on Fleet Map for entire shift (clock-in to clock-out)

## Morning Meeting Banner

- [ ] Add Morning Meeting banner to mobile app home screen with clickable Zoom link
- [ ] Add Morning Meeting banner to admin web portal at top of all pages
- [ ] Add admin settings page to configure Zoom meeting link and time


## Admin Dashboard Redesign

- [x] Create cleaner, more focused admin dashboard layout
- [x] Add day/week toggle for revenue metrics
- [x] Display total revenue for selected period (day/week)
- [x] Calculate and display upsell percentage (% of jobs with upsells)
- [x] Integrate map view from admin-fleet-map into dashboard
- [ ] Add break alerts for detailers missing scheduled breaks (10am, 12pm, 3pm) - deferred for API integration
- [ ] Show detailer break status on dashboard with visual indicators - deferred for API integration
- [ ] Test admin dashboard with real data
- [ ] Verify map view displays detailer locations correctly


## Bug Fixes

- [x] Fix fleet map not displaying on admin dashboard - updated to always show map section with placeholder when no data
- [x] Fix weekly/daily challenge button not working for detailers - added seedChallengeData function with sample challenge and quiz questions


## Sales Team Tab Consolidation

- [x] Combine sales rep and door hanger tabs into single unified sales team tab
- [x] Create unified sales team dashboard with both sales rep and door hanger sections
- [x] Update tab navigation to show single "Sales" tab for sales team members
- [x] Test unified sales team tab with both sales rep and door hanger data


## Sales Workflow Redesign

- [x] Redesign sales-team tab with bottom menu bar for Callbacks and Door Hangers
- [x] Combine callbacks and door hangers as single unified job workflow
- [x] Show all job-related features (callbacks, door hangers, goals) in one unified interface
- [x] Add bottom navigation menu to switch between Callbacks and Door Hangers views


## Unified Sales Dashboard Redesign

- [x] Update authentication to treat both sales and door hanger reps as sales role
- [x] Create unified sales dashboard showing both door hanger and sales metrics simultaneously
- [x] Add circular progress indicators for door hangers (250/day goal) with color-coded status
- [x] Display sales metrics: callbacks, revenue generated, jobs booked
- [x] Implement color-coded status indicators (green for on-target, yellow for warning, red for behind)
- [x] Add conversion rate tracking
- [ ] Add historical comparison (yesterday vs today) - deferred for data availability


## Sales Dashboard Navigation & Photo-Based Door Hanger Logging

- [x] Add navigation menu/tabs to sales dashboard (Callbacks, Door Hangers, Performance)
- [x] Create photo-based door hanger logging system
- [x] Integrate camera to capture door hanger photos
- [x] Implement geo-tagging (GPS location) for each photo
- [x] Each photo = 1 door hanger log entry (no manual entry)
- [x] Display photo gallery of logged door hangers
- [x] Add map view showing all door hanger locations placed by team member
- [x] Remove manual entry fields from door hanger logging

## Door Hanger System Update

- [x] Remove old door hanger dashboard - kept for reference, not used
- [x] Remove old manual entry system - replaced with photo-logger
- [x] Update door hanger routes to use photo-based logger - navigation updated
- [x] Test photo entry system - ready for testing


## Camera Auto-Open Redesign (Current Sprint)

- [x] Remove old "Quick Entry" dashboard with manual fields (quantity, neighborhood, notes)
- [x] Remove "entry" tab from door hanger navigation
- [x] Redesign photo-logger to auto-open camera on component mount
- [x] Add item type selector (Door Hanger, Business Card, Yard Sign, Table Topper) that auto-opens camera
- [x] Each photo = 1 entry of selected type (no manual quantity entry)
- [x] Auto geo-tag with GPS coordinates
- [x] Reverse-geocode address from coordinates
- [x] Auto-save to map view after photo capture
- [x] Remove all manual text entry fields from logging flow

## Bug Fixes (Current Sprint)

- [x] Delete entry.tsx file completely to remove from navigation
- [x] Fix camera black screen - add web platform support with image picker fallback
- [x] Fix location permission flow - properly request and handle permissions
- [x] Fix navigation link in sales-team.tsx from entry to photo-logger
- [x] Add better error handling for location capture


## Navigation Redesign (Current Sprint)

- [x] Simplify door hanger flow - convert from nested route to modal overlay
- [x] Add modal to sales-team.tsx that shows Log, History, and Map tabs
- [x] Add close button to modal for easy return to sales dashboard
- [x] Import PhotoLogger, History, and MapView components into modal
- [x] Fix TRPC createEntry mutation call with correct schema
- [x] Remove unnecessary router.push navigation to nested routes

## Location Capture Fix (Current Sprint)

- [x] Add timeout to location request (10 seconds max)
- [x] Allow photos to be saved without location (fallback)
- [x] Change location accuracy to Balanced for faster acquisition
- [x] Handle null location gracefully in photo object

## Camera Preview Fix (Current Sprint)

- [x] Fix black camera screen on web by using image picker instead
- [x] Allow single or multiple photo selection from device library
- [x] Show photo preview grid before submitting
- [x] Add remove button for individual photos
- [x] Display photo count and item type for each photo
- [x] Rewrite photo-logger with better UX for web and native


## Camera UI Redesign (Current Sprint)

- [x] Implement native CameraView with full-screen preview
- [x] Add top toolbar with tools (tag, rotate, crop, settings icons)
- [x] Add zoom controls (.5x, 1x, 5x buttons)
- [x] Add bottom action buttons (gallery, shutter, Done)
- [x] Add mode tabs (SCAN, WALKTHRU, PHOTO, VIDEO, DUAL VIDEO)
- [x] Implement photo capture with location tagging
- [ ] Show map view after photo capture with marker
- [ ] Display photo thumbnail, address, employee name, facing direction
- [ ] Add close button (X) and info button to photo detail view

## Bug Fixes - Camera UI (Current Sprint)

- [x] Add missing React import for hooks
- [x] Remove unused Pressable import
- [x] Fix camera zoom prop to only work on native platforms
- [x] Add permission loading state
- [x] Add permission denied error screen with grant button
- [x] Fix permission request flow
- [x] Fix zoom crash - normalize zoom values to 0-1 range (was using 0.5 and 5 causing native crash)
- [x] Add zoom value clamping to prevent out-of-range values
- [x] Change zoom labels from .5x/1x/5x to 1x/2x/3x with normalized values

## Critical Bug Fixes (Current Sprint)

- [x] Fix camera black screen - replace CameraView with ImagePicker.launchCameraAsync
- [x] Fix history not showing logged entries - fixed wrong auth hook
- [x] Fix map not displaying logged entries - added lat/lng to DB schema
- [x] Verify TRPC createEntry mutation saves to database
- [x] Verify history query fetches entries correctly
- [x] Verify map query loads entries with coordinates

## Auto-Log & Location Fix (Current Sprint)

- [x] Auto-log entry immediately when photo is taken (no submit button)
- [x] Show "Saving..." spinner during auto-log
- [x] Fix location not showing - request GPS permission on mount
- [x] Pre-fetch GPS before camera opens so it's ready when photo is taken
- [x] Show address and GPS coordinates on each logged entry card
- [x] Show green GPS confirmation tick when coordinates are valid
- [x] Refresh GPS in background after each photo for next capture

## Location, Map & History Fixes (Current Sprint)

- [x] Fix location permission - show alert to open iOS Settings if denied
- [x] Pre-request location permission on app launch before camera opens
- [x] Redesign map - remove "Start Logging" button, show real map with all entry pins
- [x] Map pins colored by type (door hanger, yard sign, business card)
- [x] Tap pin on map to show bottom sheet with photo thumbnail, address, employee name
- [x] Add photo thumbnails to history entry cards
- [x] History cards show: photo, item type, address, employee name, date/time
- [x] Fix server router stripping photoUrls before saving to DB (line 475 bug)

## Map Auto-Zoom Fix

- [x] Fix map initial region - auto-fit to bounding box of all logged entry pins (not Dallas default)
- [x] If no entries exist, fall back to device GPS location
- [x] Add "Fit Pins" button to re-center map on all entries

## Door Hanger Dashboard & Admin Fixes

- [x] Fix "Text strings must be rendered within a Text component" crash in history screen
- [x] Fix dashboard goals to count only TODAY's entries (reset each day)
- [x] Dashboard progress bars update live from actual logged photos for today
- [x] Add admin screen to view and edit door hanger entries (address, type, delete)
- [x] Add admin door hanger route to admin navigation

## Dashboard Redesigns

- [x] Redesign door hanger dashboard - bold visuals, gradient header, progress cards
- [x] Redesign sales callback dashboard - bold visuals, stats cards, modern layout
- [x] Fix "Text strings must be rendered within a Text component" crash in history screen
- [x] Fix door hanger dashboard goals to count only TODAY's entries (daily reset)
- [x] Dashboard progress bars update live from actual logged photos for today
- [x] Add admin screen to view and edit/delete door hanger entries
- [x] Add admin door hanger route to admin navigation

## Door Hanger Dashboard Premium Redesign

- [x] Full premium redesign - bold hero section, animated circular progress rings, motivational copy, rich stat cards

## History Screen Crash Fix (Sprint)

- [x] Find and eliminate the "Text strings must be rendered within a Text component" crash in history screen
- [x] Clear Metro cache so new dashboard design loads on device

## Sales Rep Role (Full Feature Build)

- [x] Add sales_rep role to employee role enum in DB schema
- [x] Add sales_performance table (jobs booked, revenue, date, employee_id)
- [x] Add sales rep auth routing (login → sales tab layout)
- [x] Build sales rep tab navigation (Dashboard, Book, Chat, Training, Profile)
- [x] Build sales dashboard with auto-tracked jobs booked + revenue today/week/all-time
- [x] Build booking screen with all calendars (all cities/locations) accessible
- [x] Auto-track performance when booking is made (increment jobs booked + revenue)
- [x] Build in-house team chat (sales reps, admins, detailers in same channels)
- [x] Build sales-specific training screen (separate from detailer training)
- [x] Add admin/detailer view toggle for sales reps (switch to admin or detailer view)

## Sales Layout Fixes

- [ ] Fix header overlapping status bar/notch on all sales tabs (add top safe area)
- [ ] Add Door Hanger tab to sales layout (links to door hanger rep flow)
- [ ] Add Sales Callback tab to sales layout (links to callback flow)

## Sales Layout - Booking & Tab Updates

- [x] Rebuild Book tab to match admin booking panel (direct calendar access, all cities)
- [x] Add Door Hangers tab to sales layout
- [x] Add Callbacks tab to sales layout
- [x] Fix header safe area on all sales screens (status bar overlap)

## Sales Tab Header Safe Area Fixes

- [x] Fix Book tab (admin-schedule) header overlapping status bar
- [x] Fix Callbacks tab header overlapping status bar
- [x] Fix Door Hangers tab header overlapping status bar

- [x] Add Chat tab to admin (tabs) layout so admins can access messaging
- [x] Add logout button to sales rep Profile tab
- [x] Publish web app to luxwashapp-n2wveyqg.manus.space

## Web App Bug Fixes (Apr 20, 2026)

- [x] Add Chat tab to admin (tabs) layout so admins can access messaging
- [x] Add logout button to sales rep Profile tab (already exists as "Sign Out")
- [x] Fix MapView rendering error on web platform (admin dashboard now loads)
- [x] Web app published and accessible at dev preview URL
- [x] Demo data seeding and admin login working (ADM_OWNER / 0000)


## Door Hanger Location Suggestion & Paycheck Feature

- [x] Create tRPC endpoint to calculate city availability for next 7 days (% booked = booked_minutes / 420 minutes)
- [x] Create tRPC endpoint to get suggested city with lowest % booked
- [x] Create door hanger suggestion modal component
- [x] Show suggestion modal when sales rep clicks Door Hangers tab
- [x] Add projected paycheck card to sales dashboard (2nd card position)
- [x] Calculate projected paycheck: total door hanger photos this week × $0.25
- [x] Track door hanger photo count per week (Monday-Sunday reset)
- [x] Create door_hanger_earnings table for weekly tracking
- [x] Test door hanger suggestion with multiple cities
- [x] Test projected paycheck calculation with various photo counts


## Door Hanger Photo Logger - Bug Fixes & UX Improvements

- [x] Fix freeze issue after photo save in log tab
- [x] Fix modal blocking interaction with proper dismissal
- [x] Re-enable auto-reopen camera with 800ms delay for continuous capture
- [x] Ensure modal closes before camera opens
- [ ] Test workflow - should now work smoothly without freezing


## Door Hanger Suggestion Enhancement - Starting Address & Navigation

- [ ] Update getSuggestedCity endpoint to include starting address from first job in suggested city
- [ ] Add suggested location card to sales dashboard (top position)
- [ ] Implement "Take Me Here" navigation button (opens Apple Maps/Google Maps)
- [ ] Test navigation with real addresses


## Door Hanger Suggestion - Smart Neighborhood Logic

- [x] Update getSuggestedCityForDoorHangers to use actual job addresses
- [x] Find today's job for the sales rep, or if none, find a job from this week
- [x] Use that job's address as the starting point
- [x] Find a nearby neighbor address in the same neighborhood
- [x] Track neighborhoods completed in last 30 days (via door_hanger_entries)
- [x] Avoid suggesting neighborhoods already completed in last 30 days
- [ ] Test with various scenarios (today job, week job, no jobs, completed neighborhoods)


## Bug Fixes - Camera & UI

- [ ] Fix camera freeze when opening on log entry screen
- [x] Move location suggestion card from sales dashboard to home screen
- [ ] Test camera functionality after freeze fix

- [x] Remove suggestion modal from photo logger (should only be on home screen)
- [x] Fix camera freeze - removed auto-launch on item select, now manual button only

## Sales Dashboard - Door Hanger Suggestion Card

- [x] Remove Today's Progress bar from sales dashboard
- [x] Add door hanger suggestion card in its place with real home address
- [x] If no job address found, use a real residential address in that city as fallback
- [x] Clear the card after tapping "Take Me There"
- [x] Restrict suggestion card to sales reps only (not detailers)

- [x] Restrict door hanger suggestion card to sales reps only (not detailers)

## Team Member Deactivation & Job Reassignment

- [x] Add tRPC endpoints: deactivateWithJobs, transferJob, unassignJob, listDeactivated, reactivate
- [x] Add db functions for deactivation, job transfer, and unassign
- [x] Add Deactivate button to team member detail modal in admin-employees screen
- [x] Show job handling modal when deactivated team member has active jobs
- [x] Allow admin to transfer or unassign each job individually
- [x] Send push notification to receiving detailer when job is transferred
- [x] Add Deactivated Team Members section to admin-employees screen with Reactivate button
- [x] Add Unassigned column to admin schedule view per city (grey lane, admin-only)
- [x] Unassigned jobs appear in grey in the Unassigned column

## Deactivation - Calendar Removal

- [x] When deactivating a team member, automatically unassign all their scheduled jobs (move to Unassigned column)
- [x] Remove the per-job transfer/unassign modal - auto-clear on deactivation with summary alert

## Admin Web App - Job Form Improvements

- [x] Click & drag on detailer lane to auto-fill time slot and detailer in new job form
- [x] OpenStreetMap address autocomplete on job form address field
- [x] Split customer name into separate First Name and Last Name fields
- [x] Replace vehicle size dropdown with tap-to-select card grid
- [x] Replace detail package dropdown with tap-to-select card grid
- [x] Price auto-fills when vehicle size + package are both selected

## Admin Web App - Unassigned Column

- [x] Add Unassigned column to admin web dispatch board (show jobs with no assignedTo)

## Admin Web App - Scheduled Revenue

- [x] Add scheduled revenue stat card to main dashboard (total value of booked but not completed jobs)

## Morning Meeting Banner - Time Window

- [x] Show morning meeting banner only between 7:15 AM and 7:31 AM CST (disappears automatically)

## Morning Meeting Banner - Mobile App Fix

- [x] Fix mobile app morning meeting banner to only show between 7:15 AM and 7:31 AM CST (was always visible)

## Customers Tab

- [x] Add customers tRPC router with listAll, getDetail, and search endpoints
- [x] Build Customers section in admin web portal (list view with search + lifetime value)
- [x] Build Customer detail panel in admin web portal (contact info, job history, upcoming jobs, stats)
- [x] Build Customers screen in mobile admin app (searchable list)
- [x] Build Customer detail modal in mobile admin app

## Customer Profile Upgrade

- [ ] Add upcoming jobs endpoint to customers router
- [ ] Add customer notes CRUD to customers router
- [ ] Build full-page customer profile in admin web portal (tabbed: Profile, Jobs, Notes)
- [ ] Upgrade mobile customer detail to full-screen profile view with tabs

## Customer Profile Upgrade

- [x] Upgrade web portal customer detail from modal to full-page profile with tabs (Profile, Jobs, Notes)
- [x] Upgrade mobile admin customer detail to full-screen profile view with tabs
- [x] Profile tab: summary sidebar (LTV, dates, contact info), upcoming appointments, vehicle history
- [x] Jobs tab: full job history with amounts, detailer, and status
- [x] Notes tab: add private notes per customer

## Customer Profile Fixes & Enhancements

- [ ] Fix back navigation from customer profile to go to Customers tab (not dashboard)
- [ ] Add photo attachments tab to customer profile (upload, view, delete)
- [ ] Add photo attachments to web portal customer profile
- [ ] Build estimates database schema (estimates, estimate_line_items tables)
- [ ] Build estimates API routes (create, list, get, update, send)
- [ ] Build estimates section in web portal (create, view, send via email)
- [ ] Build estimates screen in mobile admin app
- [ ] Add Estimates tab to customer profile (web + mobile)

## Payments - Admin Schedule

- [x] Add Collect Payment button to admin job detail screen
- [x] Wire AdminCheckoutModal with Stripe payment sheet (cash, card, check, other)
- [x] Mark job as paid after successful payment (local state update)

## Checkout Modal Fixes

- [ ] Keep job detail modal open behind checkout (don't dismiss it when tapping Collect Payment)
- [ ] Fix signature canvas scrolling while signing
- [ ] Remove tip step for cash/check/other — card payments only
- [ ] Fix tips not showing on dashboard after payment

## Payment Freeze Bug

- [x] Fix screen freeze when tapping Collect Payment button on schedule screen
- [x] Fix signature disappearing when user signs in checkout modal (both schedule.tsx and admin-checkout-modal.tsx)
- [x] Fix signature mid-stroke disappearing (strokes vanish while drawing on second attempt after clear)
- [x] Remove delete job option from detailer schedule screen (admin-only action)
- [x] Fix admin schedule: jobs cannot be tapped/opened for editing from admin login
- [x] Add editable time slot and package fields to admin job detail modal
- [x] Increase text size in admin job detail modal
- [x] Add date editing to admin job detail modal (alongside time editor)
- [x] Make admin schedule detailer columns dynamic — auto-show all active detailers for the selected location
- [x] Fix availability endpoint to correctly block slots when all detailers are booked (scheduleJobs + onlineBookings)
- [x] Fix Sean not showing as named column in Crestview calendar
- [x] Ensure Unassigned column always shows in admin schedule
- [x] Admin schedule columns always show all detailers + Unassigned even on days with no jobs

## Push-to-Talk Walkie-Talkie

- [x] Add audioUrl column to teamChatMessages DB schema for voice messages
- [x] Add sendVoiceMessage tRPC mutation (upload base64 audio → S3, save message)
- [x] Add push notification delivery for incoming voice messages
- [x] Build hold-to-record PTT button component with chirp sound
- [x] Integrate PTT into Chat tab (new "Walkie" tab alongside Groups/DMs)
- [x] Voice message playback in chat with waveform display
- [x] Broadcast PTT to all team members (open channel)

## AI Phone Receptionist

- [x] Create receptionist_call_logs table (call logs, outcomes, booking IDs)
- [x] Build Twilio webhook endpoint (POST /api/receptionist/call) — ready, awaiting keys
- [x] Build OpenAI conversation handler (GPT-4o-mini, TTS) — ready, awaiting keys
- [x] Connect receptionist to availability endpoint and booking webhook
- [x] Build admin AI Receptionist screen (call logs, live status, test chat, configuration)
- [x] Add company knowledge base (services, pricing, areas, FAQs) to receptionist config
- [ ] Wire up Twilio + OpenAI keys when provided (tomorrow)

## Luxury Talk & AI Receptionist Enhancements

- [x] Add transcript and recordingUrl columns to receptionist_call_logs table
- [x] Store full conversation transcript in AI receptionist call logs
- [x] Add Twilio call recording support (recordingUrl stored per call)
- [x] Update receptionist admin screen to show transcripts and play recordings
- [x] Rename "Walkie" tab to "Luxury Talk" throughout the app
- [x] Add Luxury Talk PTT button to Direct Message conversations
- [x] Add Luxury Talk PTT button to Group Channel conversations
- [x] Allow choosing PTT target: individual DM, specific group, or all-team broadcast

## AI Receptionist Test Call Simulator
- [ ] Add test call simulator to admin-receptionist screen
- [ ] Simulate full call flow with typed input and AI text responses
- [ ] Add TTS playback of AI responses using expo-speech
- [ ] Show live scrolling transcript during test call
- [ ] Save test call to call log with mock recording entry

## AI Quick Book End-to-End Fix

- [ ] Add createJobFromQuickBook tRPC mutation to server (creates job in DB directly)
- [ ] Add date picker to Quick Book preview for missing/unspecified dates
- [ ] Add time slot picker to Quick Book preview for missing/unspecified times
- [ ] Add location picker to Quick Book preview if city not detected
- [ ] On confirm, create job directly in schedule without leaving the screen
- [ ] Show success confirmation with link to the created job on the schedule

## Bonus & Tips Routing Fix

- [x] Add upsell_total column to schedule_jobs DB table
- [x] Fix admin-schedule onComplete to save tips to DB and push to daily_performance
- [x] Fix getCompletedJobsForDetailer to return upsell_total and tips from DB
- [x] Fix dashboard calculateMetrics to read tips from schedule_jobs directly
- [x] Fix projected paycheck to use metrics (tips + bonuses + hours) from jobs
- [x] Fix saveUpsells in schedule.tsx to persist upsellTotal to DB
- [x] Fix schedule.tsx payment completion to pass upsellTotal to DB

## Community Posts (Skool-style Feed)

- [x] Add community_posts and community_comments tables to DB schema
- [x] Add community_post_likes table to DB schema
- [x] Add server tRPC routes: create/list/delete posts, like/unlike, create/list/delete comments
- [x] Build Community Posts feed screen (post cards, like button, comment count, category pills)
- [x] Build Create Post modal (title, body, category tag)
- [x] Build Post Detail screen (full post + comments + comment input)
- [x] Admin can pin/unpin posts
- [x] Add Community Posts as a tab under Chat section
- [ ] Seed a couple of example posts for first-time experience

## Twilio + OpenAI AI Receptionist Integration

- [x] Store TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_PHONE_NUMBER as secrets
- [x] Store OPENAI_API_KEY as secret
- [x] Verify Twilio account is active via API
- [x] Verify OpenAI API key is valid
- [x] Add /api/receptionist/configure-webhook endpoint to auto-set Twilio webhook URL
- [x] Add "Activate Live Phone Line" button to admin receptionist status screen
- [x] Show webhook URL on admin receptionist status screen

## AI Receptionist Booking Fix

- [x] Add real-time availability check: query schedule_jobs for existing bookings before offering time slots
- [x] Fix booking creation: actually write to bookings table when caller confirms appointment
- [x] Fix outcome logging: mark call as "booked" only when DB booking succeeds
- [x] Prevent AI from offering slots that are already taken
- [x] Add GPT-based structured data extraction to populate bookingData from conversation
- [x] Add final slot re-validation at confirmation time to handle race conditions

## AI Receptionist Abrupt Hangup Fix

- [x] Identify false-positive confirmation trigger causing premature hangup
- [x] Fix callerConfirmed detection to not fire on early "yes" responses (e.g. "yes I want to book")
- [x] Add error recovery so exceptions don't silently hang up the call — re-prompt instead of hanging up
- [x] Fix Gather TwiML: added actionOnEmptyResult=true and timeout=10 to prevent silent hangup
- [x] Remove fallthrough <Hangup/> from Gather block

## AI Receptionist Enhancements

- [x] SMS confirmation: send caller their booking details via Twilio SMS after successful booking
- [x] Admin push notification: send in-app notification to all admin/ops_manager employees when AI books a new job
- [x] Call transcript: expandable full transcript already present on each call log card in Calls tab

## AI Receptionist Critical Fixes (Round 2)

- [x] Fix availability check: now queries BOTH scheduleJobs AND onlineBookings for real schedule data
- [x] Fix booking confirmation gate: triggers when AI confirms + all fields present (no strict caller phrasing required)
- [x] Add call recording: Gather TwiML now includes record=record-from-ringing
- [x] Add /api/receptionist/recording-callback endpoint to save recording URL to call log

## AI Receptionist City & Duplicate Fix

- [ ] Fix city extraction: parse city from full address string (Florida city names)
- [ ] Fix location slug mapping to handle "Road crew" and other non-standard city strings
- [ ] Add duplicate customer lookup: search schedule_jobs by phone number before creating new booking
- [ ] If existing customer found, pre-fill their name and vehicle info
- [ ] Inject customer history into AI context so it can greet returning customers by name

## AI Receptionist Schedule Fix & Speed

- [x] Fix booking: write to scheduleJobs table (real schedule) not just onlineBookings
- [x] Fix city extraction: parse city from full address (e.g. "4733 Live Oak Church Rd, Crestview FL")
- [x] Add duplicate customer lookup by phone number — greets returning customers by name
- [x] Speed up AI: system prompt cut from ~800 to ~300 tokens, use gpt-4o-mini, max_tokens=250
- [x] Speed up AI: eliminated separate extractBookingData GPT call — now single combined call
- [x] Speed up AI: availability only re-queried when city+date change, not every turn
## Admin Schedule Phone Booking Visibility Fix
- [x] Add useFocusEffect to admin-schedule.tsx: auto-sync jobs from server when tab gains focus
- [x] Fix AI receptionist: auto-assign least-loaded detailer when creating phone bookings
- [x] Patch existing unassigned Adrian booking (PHONE_1777046355499_14N8PN) to assign to Cameron
## AI Receptionist Detailer Notification
- [x] Send push notification to assigned detailer when AI books a job for them
- [x] Fix lead source label to display "AI Receptionist" (not "Phone — AI Receptionist")
## AI Receptionist Knowledge Base Update
- [x] Rewrite system prompt with real services, prices, service areas, and booking/upsell logic from price book
## AI Receptionist Webhook Fix
- [x] Fix operator precedence bug in configure-webhook URL builder
- [x] Re-point Twilio webhook to correct public URL
- [x] Add auto-webhook configuration on server startup via PUBLIC_URL env var
- [x] Fix Gather action URLs to be absolute (Twilio requires absolute URLs, relative caused application error)
## AI Receptionist Booking Flow Fix
- [x] Fix: AI must always collect time slot before confirming booking
- [x] Fix: if call ends with name+address+service but no time, write a pending booking with TBD slot instead of dropping it
- [x] Fix: "Destin" city not being recognized in city slug map (check extractor)
## Caller ID Pre-fill
- [ ] Pre-fill phone number from Twilio caller ID so AI never asks for it
## Caller ID Pre-fill
- [x] Pre-fill phone from Twilio caller ID and confirm with caller ("I have your number as X — is that correct?")
## AI Receptionist Call Log — View Job Link
- [x] Add "View Job" button on call log entries with a bookingId that navigates to the job on the admin schedule

## Web Admin Portal (Desktop Browser)
- [x] Audit all mobile admin screens for features to port
- [x] Build web admin portal shell: sidebar nav, layout, auth, routing (already existed)
- [x] Port: Admin Schedule (already existed as Dispatch Board)
- [x] Port: AI Receptionist (call log, status, View Job deep-link) — NEW
- [x] Port: Dashboard (already existed)
- [x] Port: Team Members (already existed)
- [x] Port: Timesheet (already existed)
- [x] Port: Callbacks (callback list, filter, detail, status update) — NEW
- [x] Port: Door Hangers (stats, goals, entries, delete) — NEW
- [x] Port: AI Coach (analytics, Quick Book) — NEW
- [x] Port: Training (already existed)
- [x] Port: Alerts/Notifications (already existed)
- [x] Port: Customers (already existed)
- [x] Port: Fleet Map (already existed)
- [x] Port: Time Off requests (already existed)
- [x] Fix web admin portal login — pre-existing syntax error in morning meeting banner setTimeout callback

## Auto-Efficiency from Schedule Jobs
- [x] Auto-calculate detailer efficiency from completed schedule jobs (upsert daily_performance on job completion)
- [x] Backfill existing completed jobs into daily_performance records
- [x] Remove admin log/data-entry tab from navigation (no longer needed with auto-efficiency)

## Upsell Revenue Fix
- [x] Include upsellTotal in revenueProduced when syncing performance from schedule jobs
- [x] Re-run backfill to update all existing performance records with corrected revenue
- [x] Remove duplicate daily_performance records caused by old PERF- format vs new PERF_ format

## Week Efficiency & Revenue Display Fixes
- [x] Fix weekly efficiency showing 0.0% — caused by duplicate performance records overwriting correct values; pick best record per date (highest efficiency)
- [x] Fix efficiency falsy check — use hoursWorked > 0 guard instead of truthy efficiencyPercent so days with valid 0% are handled correctly
- [x] Fix revenue on detailer dashboard (Today + Week) to include upsellTotal from schedule jobs
- [x] Fix revenue on admin dashboard to include upsellTotal in total revenue
- [x] Delete remaining duplicate PERF-DET_LAMONT-2026-04-22 record

## Upsell Bonus Not Showing on Dashboard
- [x] Fix upsell bonus (40% of upsellTotal) not appearing on detailer dashboard Bonus metric
- [x] Ensure syncPerformanceFromJobs correctly writes upsell bonus to daily_performance.upsells
- [x] Ensure dashboard reads upsell bonus from the correct field for all views (Today/Week/All Time)

## Projected Paycheck Clock-In Bug
- [x] Fix projected paycheck not updating when detailer clocks in — confirmed working on device

## Remove Performance Tab
- [x] Confirmed no separate performance tab exists — dashboard covers all metrics

## Media Upload Enhancements
- [x] Add image and video upload to community posts (Camera + Library picker, upload to S3, display in feed)
- [x] Add video upload to job card before/after section (alongside existing photo upload)

## Payroll Tab
- [x] Add a Payroll tab visible to all team members showing their pay history, current period earnings breakdown (hours, tips, upsell bonus), and projected paycheck

## Alphabetical Customer Sorting
- [x] Sort customers alphabetically (A–Z by full name) in the admin customers list screen

## Inventory Management System
- [x] 3-tier inventory system: Warehouse → Blue Box Locations → Vans
- [x] Dynamic categories (Chemicals, Towels, Uniforms, Marketing Materials, Business Cards)
- [x] Add/edit/delete categories and items
- [x] Count-based inventory tracking per location
- [x] Add, remove, adjust inventory actions
- [x] Transfer inventory between warehouse, location, and van
- [x] Low-stock threshold alerts with visual flags
- [x] Centralized restock list (warehouse, location, van shortages)
- [x] Saturday van restock / Monday warehouse ordering workflow banners
- [x] KPI dashboard: totals by tier, by category
- [x] Transaction history log
- [x] Usage tracking (last 30 days high-usage items)
- [x] Loss tracking (manual removals)
- [x] Admin-only access via top nav menu

## Inventory UI Improvements (Apr 2026)

- [x] Add address, gate code, box code fields to Blue Box locations (DB schema + server + UI)
- [x] Replace all dashed Add buttons with compact + button above search bar in all inventory tabs

## Per-Location Item Subsets (Apr 2026)

- [ ] Add location_item_assignments table so each location/van tracks only its own items
- [ ] Update server getStockWithDetails to filter by enabled items per location
- [ ] Add server procedures to assign/unassign items to a location
- [ ] Update InventoryTab UI to show only assigned items for non-Warehouse locations
- [ ] Add "Manage Items" UI for each location/van to add/remove tracked items

## Per-Location Inventory

- [x] Add address, gate code, box code fields to Blue Box locations (DB schema + server + UI)
- [x] Replace all dashed Add buttons with compact + button above search bar in all inventory tabs
- [x] Per-location inventory: each Blue Box and Van has its own item subset (assign/unassign items)

## Per-City Finance Tracking

- [ ] Add finance_cities table (dynamic, user-managed)
- [ ] Add cityId column to finance_transactions
- [ ] Auto-create finance income transaction when job is marked completed
- [ ] Finance tab: city dropdown selector (All Cities + per-city + Add City)
- [ ] Filter all Finance views (P&L, transactions, reports) by selected city
- [x] Global location context: switching location applies to all admin tabs
- [ ] AI bank statement upload: parse PDF/CSV with AI and auto-create Finance entries
- [ ] Side-by-side reconciliation view: Finance records vs bank transactions with Match/Unmatch


## Client Portal — Home / Sales Screen

- [x] Rebrand login screen to "Luxury Wash On Wheels", Email/Password fields, remove demo data button
- [x] Convert app/index.tsx to public sales/landing screen (hero + packages + add-ons)
- [x] Top bar: logo left, login icon button top-right (opens login screen)
- [x] Hero section: large gradient/image, bold headline "Premium Mobile Detailing", subtitle "We Come To You"
- [x] Staggered alternating packages section (image left/right alternating per row)
- [x] Horizontal scroll add-ons section with name, price, and 1-line benefit description
- [x] Floating "Book Now" pill button pinned to bottom
- [x] Footer: city coverage list

## Client Portal — Customer Auth

- [x] Create app/signup.tsx (first name, last name, email, phone, password, confirm password)
- [x] Add "New customer? Create an account" link on login screen
- [x] Create customer auth context (separate from employee auth)
- [x] Wire customer auth to backend (JWT session)
- [ ] Protect customer routes: redirect to login if not authenticated

## Client Portal — Customer Profile

- [x] Create app/(customer)/profile.tsx
- [x] Personal info section (name, email, phone)
- [x] My Vehicles section (list + add/delete)
- [x] Saved Addresses section (list + add/delete with labels: Home, Work, Other)
- [x] Sign Out button

## Client Portal — My Vehicles

- [ ] Create app/(customer)/vehicles.tsx
- [ ] Add vehicle form: Year, Make, Model, Vehicle Type (auto-detect + editable)
- [ ] Edit vehicle
- [ ] Delete vehicle

## Client Portal — Booking Flow

- [x] Create app/(customer)/book/vehicle.tsx — select or add vehicle (Step 1)
- [x] Create app/(customer)/book/package.tsx — packages with dynamic pricing per vehicle type (Step 2)
- [x] Create app/(customer)/book/addons.tsx — add-ons with benefit descriptions, running total (Step 3)
- [x] Create app/(customer)/book/location.tsx — saved addresses or new address (Step 4)
- [x] Create app/(customer)/book/datetime.tsx — Mon–Fri week view, time slots (Step 5)
- [x] Create app/(customer)/book/confirm.tsx — full summary, confirm (Step 6)
- [x] Create app/(customer)/book/success.tsx — confirmation screen with booking reference

## Client Portal — Customer Dashboard & Appointments

- [x] Create app/(customer)/home.tsx — greeting, hero, packages, Book Now
- [x] Create app/(customer)/bookings.tsx — upcoming + history tabs with status badges
- [ ] Create app/(customer)/booking-detail.tsx — booking detail + GPS tracking link

## Client Portal — GPS Tracking

- [ ] Create app/(customer)/tracking.tsx — live map with detailer pin + ETA
- [ ] Add "On My Way" button to detailer job screen that activates GPS sharing
- [ ] Wire detailer location updates to backend
- [ ] Push notification: "Your detailer is on the way!"

## Client Portal — Backend / Database

- [x] Add customers table (id, firstName, lastName, email, phone, passwordHash, createdAt)
- [x] Add customer_vehicles table (id, customerId, year, make, model, vehicleType)
- [x] Add customer_addresses table (id, customerId, label, street, unit, city, state, zip)
- [x] Add customer_bookings table (id, customerId, vehicleId, package, addons, date, timeSlot, status, total, bookingRef)
- [x] Add customer auth API routes (signup, login, me)
- [x] Add vehicle CRUD API routes
- [x] Add address CRUD API routes
- [x] Add booking API routes (create, list)
- [ ] Add GPS location update route for detailers
- [ ] GPS tracking screen for customers (live map with detailer pin + ETA)
- [ ] "On My Way" button for detailers that activates GPS sharing
- [ ] Push notification: "Your detailer is on the way!"

## Bug Fixes & UI Improvements (Apr 27)

- [x] Fix login: hide booking sub-folder from tab bar so it doesn't appear as a tab
- [x] Customer home screen: black/blue palette, gradient hero, blue accents, logo top-left
- [x] Public home screen: black/blue palette, logo top-left, blue gradient Book Now button
- [x] Customer tab bar: black background, blue active tint

## Bug: Customer Portal Bookings Not Showing on Staff Calendar (Apr 27)

- [x] Verify customer booking is saved to customer_bookings table in DB
- [x] Fix staff schedule/calendar to query customer_bookings table alongside staff bookings
- [x] Map customer booking fields (city from address, date, time, package, vehicle) to calendar display format
- [ ] Test: book via client portal → confirm it appears on correct city calendar tab

## Fleet & Van Maintenance Module

- [ ] Fix staff tab bar: scrollable horizontal tabs to handle overflow
- [ ] Fleet screen: van registry (name, make, model, year, VIN, plate, assigned detailer, mileage)
- [ ] Fleet screen: add/edit/delete vans
- [ ] Maintenance records: log oil changes, tire rotations, brakes, inspections, repairs
- [ ] Maintenance records: mileage-based and date-based service tracking
- [ ] Maintenance alerts: notify admin when van is due for service
- [ ] Fuel log: log fill-ups per van (gallons, cost, mileage)
- [ ] Fuel log: MPG tracking and monthly cost report
- [ ] Backend: fleet_vans table
- [ ] Backend: fleet_maintenance_records table
- [ ] Backend: fleet_fuel_logs table
- [ ] Backend: API routes for fleet CRUD

## Tab Bar Fix & Fleet Module

- [ ] Tab bar: keep only Schedule, Chat, Inventory, Timesheets, AI Coach as visible tabs
- [ ] Tab bar: add "More" tab that opens full-screen grid menu
- [ ] More menu: Fleet, Finance, Customers, Receptionist, Training, Time Off, Door Hangers, Sales, Bonus, Callbacks
- [ ] Fleet Dashboard: city filter tabs (All / Destin / FWB / Niceville / Crestview / Pensacola)
- [ ] Fleet Dashboard: van list with status (Driving / Parked / Idle) and last location
- [ ] Fleet Dashboard: map view with numbered orange van pins
- [ ] Van Detail screen: Overview tab (fuel %, DTCs, recalls, battery, tires, odometer, VIN, plate, driver)
- [ ] Van Detail screen: Trips tab (week calendar + trip list with start/end address, duration, miles)
- [ ] Fleet Alerts screen: maintenance reminders list with city filter and unread highlighting
- [ ] Backend: fleet_vans table
- [ ] Backend: fleet_trips table
- [ ] Backend: fleet_alerts table
- [ ] Backend: API routes for fleet CRUD and alerts


## Fleet & Van Management Module

- [x] Create fleet database tables (fleet_vans, fleet_maintenance, fleet_fuel_logs, fleet_trips, fleet_alerts)
- [x] Create fleetDb.ts with all CRUD helpers
- [x] Add fleet tRPC router to routers.ts (vans, maintenance, fuel, alerts, trips)
- [x] Rebuild Fleet Dashboard screen with Live Map / Vans / Alerts tabs
- [x] Add city filter chips to Vans and Alerts tabs
- [x] Add Van Card with status badge, fuel %, odometer display
- [x] Add Add Van modal (name, make, model, year, plate, color, VIN, driver, city)
- [x] Add Alert Row with severity color coding and mark-as-read
- [x] Create Van Detail screen (admin-fleet-van-detail.tsx)
- [x] Van Detail: Overview tab (health stats, last location, vehicle info)
- [x] Van Detail: Maintenance tab (log records, delete, cost display)
- [x] Van Detail: Fuel Log tab (fill-ups, auto-calculate total, delete)
- [x] Van Detail: Trips tab (log trips, from/to addresses, duration, miles)
- [x] Van Detail: Edit Van modal (all fields + status + city)


## Nav & UI Fixes

- [x] Add 5 pinned quick-access tabs to top nav bar (Dashboard, Schedule, Fleet, Chat, + More)
- [x] Fix menu card backgrounds — replace semi-transparent tint with solid dark surface color
- [x] Make menu grid cards clearly readable with proper contrast

## Team Member Deactivation Fix

- [x] When a team member is deactivated, remove/unassign their calendar slot from the schedule
- [x] Filter inactive team members from all schedule/calendar views

## Team Member Management Enhancements

- [x] Reactivation restores detailer to city calendar automatically
- [x] Deactivation confirmation sheet showing upcoming job count and impact
- [x] Inactive team member archive tab with performance history view

## Sales Rep Login Fix

- [ ] Remove old callbacks screen that flashes on login for sales reps

## Web Admin Portal — Missing Features

- [x] Finance section (revenue, expenses, bank statements, payroll)
- [x] Inventory section (supplies tracking)
- [x] Bonus/Quiz section (team member bonus management)
- [x] Chat section (team messaging)
- [x] Fleet detail pages (van detail: maintenance, fuel, trips)
- [x] Team Member Archive (inactive/deactivated members with history)
- [x] Add Finance, Inventory, Bonus, Chat, Fleet, Archive to sidebar nav
- [x] Equipment Repair Request system - DB schema (repair_orders, repair_equipment, employee_van_assignments tables)
- [x] Equipment Repair Request system - tRPC routes (listRepairEquipment, createRepairOrder, updateRepairStatus, countOpenRepairs, getVanAssignment, setVanAssignment, removeVanAssignment)
- [x] Equipment Repair Request system - Detailer repair-request screen (equipment picker, sub-issues, priority, notes, history modal)
- [x] Equipment Repair Request system - Admin Fleet Repairs tab (repair order cards, status filter, mark in-progress/resolved)
- [x] Equipment Repair Request system - Red badge on Fleet tab (admin) and Repairs item (detailer) in TopNavMenu
- [x] Equipment Repair Request system - Van assignment section in admin Team Members detail modal
- [x] Equipment Repair Request system - Seed 13 default equipment items (air compressor, pressure washer, Tornador, buffer, extractor with sub-issues, etc.)
- [x] Equipment Repair Request system - DB schema (repair_orders, repair_equipment, employee_van_assignments tables)
- [x] Equipment Repair Request system - tRPC routes (listRepairEquipment, createRepairOrder, updateRepairStatus, countOpenRepairs, van assignment)
- [x] Equipment Repair Request system - Detailer repair-request screen (equipment picker, sub-issues, priority, notes, history modal)
- [x] Equipment Repair Request system - Admin Fleet Repairs tab (repair order cards, status filter, mark in-progress/resolved)
- [x] Equipment Repair Request system - Red badge on Fleet tab (admin) and Repairs item (detailer) in TopNavMenu
- [x] Equipment Repair Request system - Van assignment section in admin Team Members detail modal
- [x] Equipment Repair Request system - Seeded 13 default equipment items
- [x] Push notification to admin when repair order submitted (in-app + notifyOwner)
- [x] Admin Equipment List Management screen (add, edit, deactivate, restore, sub-issues)
- [x] Admin Repair History Report screen (filter by van, date range, status, search)

## Van Assignment (Shift-Based)

- [x] Van assignment: support 2 team members per van (1st shift / 2nd shift)
- [x] Admin Van Assignment screen with team member picker per shift slot
- [x] Repair request screen shows detailer's assigned shift label
- [x] Investor Portal: DB tables (investors, investments, payments, documents, updates, support, audit_log)
- [x] Investor Portal: tRPC server routes (auth, dashboard, payments, documents, updates, support, admin)
- [x] Investor Portal: Investor login screen with separate auth context
- [x] Investor Portal: Investor dashboard (summary cards, repayment progress, recent updates)
- [x] Investor Portal: Investment detail with payment history
- [x] Investor Portal: Documents screen with S3 file access
- [x] Investor Portal: Investor updates feed
- [x] Investor Portal: Support request screen
- [x] Investor Portal: Admin investor management (create, edit, view all investors)
- [x] Investor Portal: Admin investor detail (investments, payments, documents, notes)
- [x] Investor Portal: Admin investor support responses
- [x] Investor Portal: Admin post investor updates
- [x] Investor Portal: "Access Investor Portal" link on main login screen
- [x] Investor Portal: Investors nav item in admin menu
- [x] Investor Admin: Separate investor_admin role in DB
- [x] Investor Admin: Default investor admin account created
- [x] Investor Admin: Role-based redirect on investor login (admin -> investor-admin-home, investor -> dashboard)
- [x] Investor Admin: Dedicated Investor Admin home screen with stats and nav cards
- [x] Investor Admin: Removed Investors from regular admin nav menu

## Investor Portal Bug Fixes & Dashboard Redesign

- [x] Fix investor login button not opening dedicated login screen (navigation issue)
- [x] Fix investor portal navigation bugging out after login
- [x] Fix investment not showing for Adrian Miller (was linked to wrong investor ID - fixed in DB)
- [x] Redesign investor dashboard as comprehensive one-screen investment overview (all key info visible without navigating)

## Booking System Modernization

### Phase A — Zapier Elimination
- [ ] Add sendBookingConfirmationSms() to booking webhook handler (Twilio, fires after booking saved)
- [ ] Update WordPress booking form integration file to remove sendToZapier(), use app webhook only
- [ ] Rename zapierPayload to webhookPayload in schema and db

### Phase B — Preferred Detailer
- [ ] Add preferred_detailer_id and preferred_detailer_name columns to online_bookings schema
- [ ] Add show_on_booking_form column to employees schema
- [ ] Update /api/booking/availability to accept optional detailerId param for per-detailer slots
- [ ] Update /api/booking/detailers to include showOnBookingForm field
- [ ] Update booking webhook handler to assign preferred detailer when provided
- [ ] Update WordPress booking form integration file with detailer selection UI step

### Phase C — Customer Pipeline
- [ ] Extend online_bookings status enum with follow_up_sent and closed stages
- [ ] Add pipeline_notes column to online_bookings schema
- [ ] Run DB migration for all schema changes
- [ ] Add pipeline tRPC procedures (list by date/location, update stage, send follow-up SMS)
- [ ] Build admin pipeline screen (kanban columns, booking cards, stage selector bottom sheet)
- [ ] Add Send Follow-Up SMS button on completed bookings (Twilio review request + rebook offer)
- [ ] Add pipeline tab/screen to admin navigation

## Booking System Modernization

### Phase A — Zapier Elimination
- [x] Add sendBookingConfirmationSms() to booking webhook handler (Twilio, fires after booking saved)
- [x] Update WordPress booking form integration file to remove sendToZapier(), use app webhook only
- [x] Rename zapierPayload to webhookPayload in schema and db

### Phase B — Preferred Detailer
- [x] Add preferred_detailer_id and preferred_detailer_name columns to online_bookings schema
- [x] Add show_on_booking_form column to employees schema
- [x] Add /api/booking/detailers endpoint (returns active detailers for a location)
- [x] Update booking webhook handler to assign preferred detailer when provided

### Phase C — Customer Pipeline
- [x] Extend online_bookings status enum (en_route, in_progress, follow_up_sent, closed, cancelled)
- [x] Add pipeline_notes column to online_bookings schema
- [x] Run DB migration for all schema changes
- [x] Add pipeline tRPC procedures (list, update stage, send follow-up SMS)
- [x] Build admin pipeline screen (kanban columns, booking cards, stage selector, notes)
- [x] Add Send Follow-Up SMS button on completed bookings
- [x] Add pipeline to admin navigation

## Abandoned Cart & Pipeline Visibility

- [x] Add Pipeline to admin dashboard feature grid (All Features menu)
- [x] Add "abandoned" as first stage in pipeline status enum and STAGES config
- [x] Create pipeline.abandonCart tRPC procedure (saves partial booking on pricing step)
- [x] Wire abandonCart call into customer booking form when pricing step is reached
- [x] If customer completes booking, promote abandoned record to confirmed (pipeline.promoteAbandonedCart)
- [x] Add "Send Recovery SMS" button on abandoned pipeline cards
- [x] Add recovery SMS template to pipeline.sendFollowUpSms procedure

## Personalized Recovery SMS

- [x] Pass packageName from booking context into abandonCart mutation
- [x] Store packageName in the abandoned cart DB record (packageType field in online_bookings)
- [x] Update Recovery SMS template to include the specific package name

## Tip & Tap to Pay

- [ ] Audit existing Collect Payment screen and Stripe SDK installation
- [ ] Add tip selection step (15%, 20%, 25%, custom) before payment
- [ ] Build Stripe PaymentSheet with Apple Pay / Google Pay (Tap to Pay, no hardware)
- [ ] Build manual card entry fallback using Stripe CardField
- [ ] Add server-side createPaymentIntent tRPC procedure
- [ ] Record tip amount and payment method on job completion

## Apple Pay & Tap to Pay

- [x] Add apple_pay and tap_to_pay to PaymentMethod type and labels/icons
- [x] Add Apple Pay option to checkout method list (iOS only, black button)
- [x] Add Tap to Pay option to checkout method list (iOS only, shows "Coming Soon" screen with Apple entitlement instructions)
- [x] Add processApplePayPayment() to stripe-payment.native.ts using initPaymentSheet + presentPaymentSheet
- [x] Add processApplePayPayment() web stub to stripe-payment.web.ts
- [x] Update stripe-payment.d.ts with processApplePayPayment declaration
- [x] Route apple_pay through tip step first, then to Apple Pay payment screen
- [x] Tip Continue button shows "Pay with Apple Pay" when method is apple_pay

## App Freeze / Crash Stability Fix

- [x] Audit all screens for polling intervals without cleanup (setInterval not cleared on unmount)
- [x] Audit all screens for WebSocket/subscription listeners not unsubscribed on unmount
- [x] Audit all screens for infinite re-render loops (useEffect with missing/wrong deps)
- [x] Fixed: header-clock-status 2s→30s and 5s→30s (was polling every screen)
- [x] Fixed: timecard-display 5s→60s
- [x] Fixed: index.tsx three 15s queries→60s, disabled refetchOnWindowFocus
- [x] Fixed: chat-screen 8s→20s, 15s→30s
- [x] Fixed: ptt-screen 4s→20s
- [x] Fixed: community-screen 10s→30s, 15s→30s
- [x] Verified TypeScript: 0 errors after all changes

## Efficiency Score Fix

- [x] Fix efficiency score showing 166.8% instead of ~50% for $1,085/22.8hrs
- [x] Change all-time/week efficiency to Option B: total revenue / total hours / $100 target (weighted rate)
- [x] Fix formula in admin-entry.tsx (new entries), server/db.ts (schedule job auto-calc), index.tsx (Today/Week/All Time display), admin-employees.tsx (team list + archived detail), history.tsx (weekly groupings)
- [x] Run DB migration to recalculate all stored efficiency_percent values with correct formula

## Login Flash Fix

- [x] Fix admin login flashing detailer dashboard before redirecting to admin dashboard
- [x] Route admins directly to /(tabs)/admin-dashboard in login.tsx (both success paths)
- [x] Remove redundant admin redirect useEffect from tabs _layout.tsx

## Login Flash Fix (Round 2)

- [x] Refactor index.tsx into guard wrapper (HomeScreenGuard) + inner component (DetailerDashboard)
- [x] Guard wrapper returns null and redirects admins/sales before any detailer UI mounts
- [x] Fixes React Rules of Hooks violation from previous attempt
- [x] Rename Fleet tab "Crew" sub-tab to "Van Assignment"

## Timesheet Dropdown

- [x] Replace horizontal pill buttons with dropdown picker for team member selection on admin timesheet page

## Customer Profile Bug Fixes

- [x] Fix total jobs count showing 6 when only 2 jobs in history (counting all statuses instead of completed only)
- [x] Fix LTV calculation to match actual completed job revenue

## Team Locations Map Fix

- [x] Only show van pins on admin dashboard map for detailers who are currently clocked in

## AI Training Section

- [ ] Add AI Training tab/section under Test Call on the AI Receptionist screen
- [ ] Allow admin to add/edit/delete knowledge base entries (FAQs, services, pricing, policies)
- [ ] Persist training data to DB so AI uses it during calls

## Customer Profile Jobs/LTV Fix (Round 2)

- [ ] Show confirmed/in-progress jobs in total jobs count and LTV on customer profile (not just completed)

## Save Card on File

- [ ] Add "Save Card on File" button to admin customer profile (CRM)
- [ ] Add card save option to customer-facing online booking form
- [ ] Store Stripe payment method ID against customer record in DB
- [ ] Show saved card indicator on customer profile

## AI Training + Customer Profile + Saved Cards (Apr 29 2026)

- [x] Add AI Training tab to AI Receptionist screen with knowledge base editor (categories, CRUD, persisted to DB, injected into AI system prompt)
- [x] Fix customer profile jobs count and LTV to show all non-cancelled jobs (not just completed)
- [x] Add customer_payment_methods DB table and migration
- [x] Add savedCards tRPC router (createSetupIntent, saveCard, list, delete, setDefault, chargeCard)
- [x] Add 💳 Cards tab to admin customer profile screen (view/delete/set default saved cards)

## Customer Management (Admin)

- [ ] Add do_not_service column to customers table in DB
- [ ] Add server endpoints: customer.delete and customer.setDoNotService
- [ ] Block DNS customers from booking on the customer-facing booking screen
- [ ] Add Delete Customer button (admin only) with confirmation dialog on customer profile
- [ ] Add Do Not Service toggle (admin only) with red banner on customer profile
- [ ] Show DNS badge on customer list row

## Training Module Rebuild (Apr 30 2026)
- [x] Remove standalone Wheels & Tires module (merged into Exterior Detailing)
- [x] Rebuild 6 training modules: Welcome & Company Standards, Safety & Chemical Handling, Exterior Detailing, Interior Detailing, Customer Service & Upselling, Using the App
- [x] Seed all 6 modules with step-by-step content (warnings, tips, bold formatting)
- [x] TM_APP module covers full app walkthrough: login, schedule, running late, clock in/out, time off requests, breaks, messages/notifications, payment & job completion
- [x] Add trainingQuizQuestions and trainingQuizAttempts DB tables with migration
- [x] Seed 5 quiz questions per module (30 total)
- [x] Add tRPC endpoints: getQuizQuestions, submitQuizAttempt, getQuizAttempts, getBestQuizAttempt, addQuizQuestion, updateQuizQuestion, deleteQuizQuestion, getAllEmployeesProgress, resetEmployeeProgress
- [x] Rebuild Training Dashboard (index) with progress bar, sequential unlock, module cards
- [x] Rebuild Module Detail screen: video player preserved + step reader + quiz CTA
- [x] Build Quiz Screen: MCQ, instant feedback, 80% pass threshold, results with answer review, unlimited retakes
- [x] Rebuild Admin Training Panel: Team Member progress table (expandable, per-module status + quiz scores) + Quiz Question editor (add/delete per module)

## Pending Tasks (May 2026)

- [x] Admin door hangers tab: add door hanger map and history sections (mirror sales tab)
- [x] Sales layout: add Customers tab so sales reps can access customer list/profiles
- [ ] Geo tracking for detailers: admin map section with real-time detailer locations, admin-defined geofence zones, push notifications when a detailer enters or exits a zone
## Customer Portal Enhancements (May 2026)
- [x] Job detail screen: tap job card → full detail view with re-book button
- [ ] Push notification to customer when job status changes (confirmed, en_route, completed)
- [ ] Customer profile: add card on file (Stripe setup intent, center modal popup)
- [ ] Customer profile: update email and phone number

## Customer Portal Enhancements (May 2026)
- [x] Job detail screen: tap job card to open full detail view with re-book button
- [ ] Push notification to customer when job status changes (confirmed, en_route, completed)
- [ ] Customer profile: add card on file (Stripe setup intent, center modal popup)
- [ ] Customer profile: update email and phone number

## Customer Auto-Creation on Job Save

- [x] Audit jobs.upsert server endpoint to understand current customer linking
- [x] Add upsertCustomer helper (find-or-create by email OR phone, no duplicates)
- [x] Call upsertCustomer inside jobs.upsert and link customerId to the job
- [x] Verify existing jobs with email/phone get linked to customer on next save
- [x] Test: creating a job twice with same email does not create duplicate customer

## Email Notifications (Gmail SMTP)

- [x] Create server/email.ts Gmail SMTP helper using nodemailer
- [ ] Add GMAIL_USER and GMAIL_APP_PASSWORD secrets
- [x] Wire email sending into notifications.create endpoint
- [x] Add "Also send email" toggle to admin alert compose form
- [x] Add sendEmail flag to notifications.create tRPC input schema
- [ ] Test email delivery end-to-end

## Bug Fixes (May 2026)
- [x] Fix profile photo upload "empty SET clause" error — use Drizzle column refs in updateCustomerProfile
- [x] Fix job/[id] tab showing in customer bottom nav — add _layout.tsx + tabBarButton: () => null
- [x] Customer booking confirmation email — auto-sent from admin@luxurywashonwheels.com when booking is created
- [x] Email log screen — admin can view all sent emails with recipient, subject, type badge, and timestamp
- [x] Email DB logging — every sent/failed email is recorded in email_logs table
- [x] Email log moved inside Inbox screen as "Emails" tab — removed standalone Email Log nav tab
- [x] Fix Inbox tab bar spacing (paddingHorizontal instead of flex:1)
- [x] Fix email log row layout (stacked vertically)
- [x] Make email log rows tappable to view full email body
- [x] Add email body storage to DB (body column in email_logs)
- [x] Add WebView email detail modal in Inbox > Emails tab
- [x] Fix customer portal bookings not appearing on admin calendar (mirror to schedule_jobs on create)
- [x] Backfill existing portal booking for Adrian Miller into schedule_jobs

## Booking Availability & Auto-Assign
- [x] getAvailableSlots endpoint — package-based slots with real detailer availability check
- [x] datetime.tsx — rebuilt with package-based time slots, real availability query, greyed-out booked slots
- [x] createBooking — parse slot label for start/end hours, auto-assign first available detailer, mirror to schedule_jobs

## Customer Booking Management (v2)
- [x] Admin new booking alert email + in-app notification on every portal booking
- [x] Customer cancel booking with 24-hour cutoff, admin notified
- [x] Customer reschedule booking with 24-hour cutoff, admin notified
- [x] Notify assigned detailer when auto-assigned to a portal booking
- [x] allJobs returns bookingRef and packageId for portal bookings
- [x] Cancel/Reschedule buttons on booking cards with 24-hour lock

## Interactive Training Modules - Exterior (with real handbook photos)

- [ ] Extract and upload real tool photos from handbook PDF for all exterior modules
- [ ] Interactive training: Engine Bay module with real handbook photos
- [ ] Interactive training: Wheel Cleaning module updated with real handbook photos
- [ ] Interactive training: Tire Cleaning module with real handbook photos
- [ ] Interactive training: Wheel Well Cleaning module with real handbook photos
- [ ] Interactive training: Exhaust Tips module with real handbook photos
- [ ] Interactive training: Exterior Wash module with real handbook photos
- [ ] Add all exterior modules to training index

## Customer Homepage Redesign

- [x] Replace static hero image with looping video hero (F-250 walkaround video)
- [x] Remove all prices from customer homepage
- [x] Add "What We Do" service pillars section (Exterior, Interior, Full/Luxury)
- [x] Add "How It Works" 3-step flow (Book → We Come to You → Drive Away Impressed)
- [x] Replace package price display with informational descriptions and duration
- [x] Add "Why Choose Us" section (Mobile, Trained, Premium Products, Flexible)
- [x] Add final CTA section with headline and Book Now button
- [ ] Customer booking flow — review and improve each step of the booking funnel

## Splash Screen Redesign

- [x] Replace white splash background with black (#0A0A0A) for both light and dark modes
- [x] Generate white/gold version of Team Luxury Wash logo for dark splash background
- [x] Update splash-icon.png with new white-on-black logo
- [x] Increase splash image width to 220px for better presence

## Homepage Content Update

- [x] Move "How It Works" section above "What We Do" section
- [x] Replace all placeholder package card images with real customer vehicle photos
- [x] Basic Detail card: Red Chevy Silverado Z71 (freshly washed)
- [x] Full Detail card: GMC Yukon Denali + Ford Raptor (two vehicles, one visit)
- [x] Interior Detail card: Van open showing interior detailing setup
- [x] Exterior Detail card: Black Lexus LX on paver driveway (mirror finish)
- [x] Luxury Detail card: White Maserati GranTurismo with Luxury Wash van

## RV Detailing Support

- [x] Add "rv" to VehicleType in booking-context.tsx
- [x] Add RV vehicle type option to vehicle selection screen
- [x] Add RV-specific packages (20-29ft, 30-39ft, 40ft+) to package screen with correct pricing
- [x] Show RV packages only when vehicle type is "rv", hide standard packages for RV

## Ops Manager Dashboard

- [x] Add site_inspections, inspection_items, van_checklists, van_checklist_items tables to schema
- [x] Add ops manager API routes (getTodayPunctuality, submitInspection, listInspections, submitVanChecklist, listVanChecklists)
- [x] Add OPS_MANAGER_ITEMS nav menu for operations_manager role
- [x] Build Appointment Punctuality Tracker screen (ops-punctuality.tsx)
- [x] Build Job Site Inspection screen (9-item checklist + notes + submit) (ops-inspection.tsx)
- [x] Build Van Checklist screen (8 categories, 100+ items from inventory) (ops-van-checklist.tsx)
- [x] Add isOpsManager flag to auth-context
- [x] Register ops screens in tabs layout

## Layout Jump Fix (Filter Buttons)

- [x] Fix Team Members position filter buttons causing page jump when tapped
- [x] Fix Pipeline location/stage filter buttons causing page jump when tapped
- [x] Fix Callbacks status/rep filter buttons causing page jump when tapped
- [x] Root cause: FlatList/ScrollView resetting scroll position when filter data changes
- [x] Fix: Wrap filters + FlatList in flex:1 View, give FlatList style flex:1, fix filterRow height
- [x] Timesheet admin: show ALL team members (not just Detailers) — switched listDetailers to listAll; added role subtitle in dropdown and selected-member display

## Bug Fixes — Customer Profile & Add Job

- [x] Customer profile shows $0/0 jobs — root cause: payment columns missing from DB (not migrated); ran ALTER TABLE to add all 8 payment columns; getCustomerJobs now returns correct data
- [x] Customer profile LTV/job count fallback — when live query returns empty, falls back to params passed from customer list
- [x] Add Job second tap for same customer goes to calendar without opening form — reset prefillHandledRef.current = null in all modal close handlers (X button, Cancel button, onRequestClose)

## Add Job Flow Fix

- [x] Move add-job form into admin-customer-profile as an inline modal (stay on Customers tab, no navigation to Schedule tab)

## Ops Manager Dashboard

- [x] Ops Manager dashboard screen with weather widget at top
- [x] Van locations map section (existing trpc.location.getActive + MapView)
- [x] Wire ops manager dashboard into ops manager tab navigation

## Customer Promo Banner

- [ ] Add promotions table to DB (title, description, discount_type, discount_value, promo_code, start_date, end_date, is_active, bg_color)
- [ ] Add tRPC routes: createPromo, updatePromo, deletePromo, listPromos (admin), getActivePromos (customer)
- [ ] Admin promo management UI (create/edit/delete promos with live preview)
- [ ] Customer home screen promo banner (shows active promos, tap to expand, copy promo code)

## Customer Promo Banner

- [x] Promotions DB table (promotions) created in MySQL
- [x] tRPC routes: promotions.list, promotions.getActive, promotions.create, promotions.update, promotions.delete
- [x] Admin promotions management screen (admin-promotions.tsx) with live preview, color picker, emoji picker, discount type, promo code, date range, active toggle
- [x] Customer home screen promo banners — expandable cards with gradient, copy promo code, Book Now CTA
- [x] Promotions added to admin nav menu
- [x] expo-clipboard installed for copy-to-clipboard feature

## On My Way – Customer Live Tracking Screen
- [ ] Add getTokenByJobId endpoint to location router (look up active token by jobId)
- [ ] Create app/(customer)/track/[jobId].tsx — full-screen MapView with van marker + destination pin
- [ ] Register track route in customer layout (hide from tab bar)
- [ ] Van marker uses custom van image, destination uses pin marker
- [ ] Polling every 5s via refetchInterval on tRPC query
- [ ] Arrived state: show "Your detailer has arrived!" overlay
- [ ] Token-not-found / expired state: graceful fallback message

## On My Way – Customer Live Tracking

- [x] Backend: getActiveTokenDataByJobId function in db.ts (handles both bookingRef and portal_bookingRef)
- [x] Backend: location.getByJobId tRPC endpoint (polls every 5s)
- [x] Customer tracking screen: app/(customer)/track/[jobId].tsx
- [x] Full-screen MapView with van marker (pulsing ring + van photo)
- [x] Destination pin (red home icon)
- [x] Dashed polyline route between van and destination
- [x] Bottom status card: "On the Way" / "Arrived" states
- [x] LIVE chip with red dot
- [x] Arrived overlay modal (triggered when token deactivated)
- [x] Empty state when no active tracking token
- [x] Customer layout: track route registered (hidden from tab bar)

## Admin Calendar – First Shift Availability Fix

- [x] Admin booking calendar: gray out time slots already occupied by a first-shift detailer
- [x] Prevent admin from selecting/booking a slot when first-shift detailer is already booked for that time
- [ ] Ensure the gray-out logic matches the same availability check used on the customer-facing booking side

## Admin Calendar – First Shift Conflict Prevention

- [x] Admin Add Job modal: show "Booked Xh" badge on detailer chips when they have jobs that day
- [x] Admin Add Job modal: gray out (red BUSY label) hours already occupied by selected detailer
- [x] Admin Add Job modal: show warning banner when selected detailer has conflicting hours
- [x] Admin Schedule screen: same gray-out logic in DragTimePicker for inline add-job form
- [x] Admin Schedule screen: detailer chips show "Booked Xh" badge when detailer has jobs that day

## Shift Schedule Enforcement
- [x] Add `shift` field to detailer config: "first" (Mon-Thu) or "second" (Fri-Sun)
- [x] Admin calendar: gray out / hide detailers on days outside their shift
- [x] AddJobModal: filter detailer list by shift day (only show detailers available that day)
- [x] Customer booking portal: filter available slots/detailers by shift day
- [x] Niceville: Lamont = first shift only (Mon-Thu), no second shift yet
- [x] When a second-shift detailer is added to any city, auto-restrict their calendar to Fri-Sun

## Customer Portal Live Tracking Notifications
- [x] Server: added customer.activeTracking endpoint — polls for active tracking token on customer's upcoming bookings
- [x] Server: added customer.updatePortalBookingStatus endpoint — lets detailer schedule update portal booking to en_route/arrived/etc
- [x] Detailer schedule: advanceStatus now syncs portal booking status when detailer taps On My Way (sets en_route) or Arrived
- [x] Customer Home screen: live "Your Detailer is On the Way!" pulsing banner appears above next appointment when detailer is en route
- [x] Customer Bookings tab: same pulsing banner at top of screen when detailer is en route
- [x] Customer Bookings tab: Track button now shows for all job sources when en_route or activeTracking matches job
- [x] Tracking map screen: handles bookingRef IDs via getByJobId (tries both portal_ prefix and raw ref)

## Admin Reporting Tab

- [x] Add reporting.getSummary tRPC endpoint (revenue, job count, avg job time by date range)
- [x] Add reporting.getPackageBreakdown tRPC endpoint (detail time and revenue per package type)
- [x] Add reporting.getDetailerStats tRPC endpoint (per-detailer revenue, jobs, avg hours)
- [x] Build admin-reporting.tsx screen with date range picker (Today/Week/Month/Custom)
- [x] Revenue summary card (total revenue, avg per job, tips, upsells)
- [x] Time on job metrics (avg hours per job, total hours worked)
- [x] Package breakdown table (jobs and revenue per package type)
- [x] Detailer performance table (jobs, revenue, avg hours per detailer)
- [x] Add Reporting to admin top-nav-menu
- [x] Register admin-reporting screen in tabs layout

## Drive Time Tracking

- [x] Add onMyWayAt and arrivedAt timestamp columns to schedule_jobs schema
- [x] Run DB migration to add new columns
- [x] Add stampJobTimestamp tRPC mutation (sets onMyWayAt or arrivedAt)
- [x] Call stampJobTimestamp when detailer taps On My Way (sets onMyWayAt)
- [x] Call stampJobTimestamp when detailer taps Arrived (sets arrivedAt)
- [x] Add reporting.getDriveTimeStats tRPC endpoint
- [x] Add Drive Time section to admin-reporting screen

## Price Book

- [x] Add price_book_services table to DB schema (id, name, description, features, vehiclePrices JSON, isActive, sortOrder)
- [x] Run DB migration for price_book_services table
- [x] Add tRPC endpoints: pricebook.list, pricebook.upsert, pricebook.delete
- [x] Build admin-pricebook.tsx screen (list view + add/edit sheet + delete)
- [x] Add Price Book to admin top-nav-menu
- [x] Register admin-pricebook in tabs layout
- [x] Wire price book services into job booking package selector (fallback to hardcoded if DB empty)

## Price Book - Seed & Sort

- [x] Seed current packages (Basic, Full, Luxury, Interior, Exterior Detail) into price_book_services
- [x] Add up/down sort controls to admin-pricebook.tsx
- [x] Add pricebook.reorder tRPC mutation to persist sort order changes

## Bug Fixes

- [x] Fix large press-highlight box on alerts tab nav buttons

## Google Maps Switch

- [x] Audit all MapView usages across the app
- [x] Configure Google Maps API key in app.config.ts
- [x] Switch all MapView instances to PROVIDER_GOOGLE
- [x] Verify maps render correctly on iOS and Android

## In-App Detailer Navigation (Uber-style)

- [x] Finish switching all MapView instances to PROVIDER_GOOGLE
- [x] Wire Google Maps API key into app.config.ts ios/android config blocks
- [x] Build NavigationMapModal component with Google Directions API polyline route
- [x] Show turn-by-turn step list with current step highlighted
- [x] Show ETA, distance remaining, and current speed
- [x] Auto-advance turn instructions as detailer moves
- [x] Arrive button to dismiss navigation and mark arrived
- [x] Wire NavigationMapModal to On My Way button in schedule.tsx

## ETA Push Notification

- [x] Add phone.sendEtaNotification tRPC mutation (sends SMS to customer with ETA)
- [x] Call sendEtaNotification from NavigationMapModal after route is fetched
- [x] SMS includes detailer name, ETA in minutes, and job address confirmation

## Door Hanger Map Photo Callout

- [x] Show door hanger photo in pin callout bottom sheet when pin is tapped

## App Name Update

- [x] Replace all "Team Luxury Wash" references with "Luxury Wash On Wheels"
- [x] Update app.config.ts appName to "Luxury Wash On Wheels"

## Bug Fixes

- [x] Fix NavigationMapModal render error: etaSentRef used before initialization

- [x] Fix 5PM check-in hook: handle "No active clock in found" error gracefully (not a crash)

## On My Way / Arrived Flow Bugs

- [x] Fix: NavigationMapModal does not auto-open when On My Way is tapped (modal only opens via Navigate button)
- [x] Fix: Tapping Arrived in NavigationMapModal does not start the job timer

## Alerts Screen Bug

- [x] Fix: Blank/empty card appearing at top of Alerts screen — system types (clock_check_5pm, clock_alert, ai_booking, etc.) now filtered at SQL level in getAllNotifications and getUnacknowledgedCritical

## Schedule Screen Glitch

- [x] Fix: Jobs briefly appear under wrong employee column on initial load (Cameron → Michael flicker) — now shows loading spinner until detailerList is fetched, then renders columns correctly on first paint

## RV Services

- [x] Add RV services to price book DB (RV Wash 20-29ft $275, 30-39ft $330, 40ft+ $375, Quarterly Maintenance $250, Paint Sealant Add-On $15/ft)
- [x] Update admin price book screen to show RV size-based pricing instead of vehicle type for RV services
- [x] Update job wizard vehicle step to show RV size options under "RV SERVICES" section
- [x] Filter job wizard packages by vehicle group (RV services only shown when RV size selected)

## Team Member System Pre-Launch Fixes

- [ ] Fix Sean's shift to first shift in DB and fallback
- [ ] Fix Saturday showing as available for first-shift detailers
- [ ] Remove hardcoded FALLBACK_DETAILERS — calendar fully driven by live DB
- [ ] Add van assignment field to Add/Edit Team Member form
- [ ] Ensure new team members auto-appear on calendar without code changes

- [x] VIP Program DB tables (vip_contracts, vip_visits) with auto-migration
- [x] VIP server API (create, list, get, send-signature, sign page, update-visit, cancel, by-token)
- [x] VIP contract auto-schedules 12 monthly visits with add-ons (Paint Sealant, Leather Condition, Leather Deep Clean)
- [x] VIP e-signature web page (canvas-based, mobile-friendly, saves signature to DB)
- [x] Admin VIP management screen (create contract, filter by status, 12-visit timeline, mark complete/missed, send signature, cancel)
- [x] Customer portal VIP tab (membership status, progress bar, this-month highlight, 12-visit timeline, add-on legend)
- [x] VIP tab added to customer portal navigation
- [x] VIP Program added to admin top-nav menu

## VIP Service Start Date
- [ ] Add service_start_date column to vip_contracts table (separate from start_date/signed_date)
- [ ] Update vipRouter create endpoint: accept service_start_date, use it for visit/job date computation
- [ ] Update admin VIP form: add Service Start Date picker (separate from contract signed date)
- [ ] Visit dates and schedule_jobs computed from service_start_date, not contract creation date
- [x] Two-date system: Contract Date (start_date) + Service Start Date (service_start_date) — both stored in DB, both shown in contract detail
- [x] Missed visit auto-replacement: marking a visit as "missed" auto-creates a replacement appointment one month after the last scheduled visit, using the same week/day preferences, inserts schedule_job on admin calendar, extends contract end_date if needed
- [x] Replacement visits shown in timeline with orange REPLACEMENT badge and left border
- [x] Alert shown to admin after marking missed: confirms replacement date
- [x] VIP: Add frequency selector (Monthly / Biweekly) to contract creation form
- [ ] VIP: Support multiple vehicles per customer (each vehicle = its own VIP program/contract)
- [x] VIP: Update server visit generation to use biweekly intervals (every 2 weeks) when frequency=biweekly
- [x] VIP: Add frequency column to vip_contracts database table
- [x] VIP: Show frequency label on admin contract cards and detail view
- [x] VIP: Show frequency on customer VIP portal
- [ ] Fix online booking sync — customer bookings not appearing on admin/detailer schedule
- [x] Fix online booking: customers can book on days when no detailers are scheduled (availability check ignores shift schedules)
- [x] Fix online booking webhook: customers can book even when no availability (double-booking protection not working, shift schedule not checked)
- [ ] Fix: website bookings from today/yesterday not appearing on admin schedule in the app
- [ ] Fix other 4 city booking forms (Destin, Niceville, FWB, Pensacola) with the await prefetchAvailability fix
- [ ] Add all customers as map pins on the admin fleet map using their service address (new and existing customers visible as distinct pins)
- [x] Add all customers as map pins on the admin fleet map using their service address (new and existing customers visible as distinct green house pins with toggle)

## Training Module Overhaul (May 2026)

- [x] Remove chemical/towel images from all 15 interactive training module challenge questions (text-only answers)
- [x] Overhaul InteractiveVideoGate: no Skip on first watch, Skip available on repeat visits (AsyncStorage persistence)
- [x] Redesign module flow: video is now the module intro (not labeled as Step 1), shown before steps begin
- [x] Quiz section shown to detailers at end of every module
- [x] Remove hardcoded INTERACTIVE_MODULES list from detailer training index
- [x] Admin: add/remove steps within a module
- [x] Admin: add/remove entire modules
- [x] Admin: reorder modules via up/down controls
- [x] Admin: editable quiz title per module
- [x] Admin: "Preview as Detailer" button to view the detailer training experience
- [x] DB schema: quizTitle column added to training_modules table
- [x] Server: createModule, deleteModule, reorderModules, reorderSteps endpoints added


## Training Interactive Module Overhaul (Round 2 — May 2026)

- [ ] Remove chemical/towel images from challenge answer buttons in all 15 interactive module files
- [ ] Move video to module-level intro (before step 1, no step number label on video gate)
- [ ] No skip on first watch; skip allowed on repeat (fix call sites in all 15 module files)
- [ ] Add quiz section at end of every interactive module before completion screen
- [ ] Admin Interactive tab: show all steps for selected module (not just step 1)
- [ ] Admin Interactive tab: editable challenge answers (all 3 options per step)
- [ ] Admin Interactive tab: correct answer picker per step
- [ ] Admin Interactive tab: editable wrong/correct explanations per step
- [ ] Admin Interactive tab: editable pro tip per step
- [ ] Keep admin Preview button and module reorder (↑↓ arrows) — do not remove

## Training Admin — Per-Module Management (May 2026)
- [x] Add interactive_module_steps DB table and CRUD endpoints (getInteractiveSteps, addInteractiveStep, updateInteractiveStep, deleteInteractiveStep, reorderInteractiveSteps)
- [x] Rewrite InteractiveModuleEditor with Card/Tools/Steps tabs
- [x] Tools tab: add/edit/delete tools, chemicals, and towels per module with photo URL support
- [x] Steps tab: add/edit/delete/reorder steps per module (stored in DB, not hardcoded)
- [x] Steps tab: full step form (title, instruction, area, question, choices, correct answer, explanations, pro tip)

## Leads Inbox (May 2026)

- [x] Add /api/lead/webhook server endpoint for Maintenance/Ceramic lead capture (status=pending, bookingDate=TBD)
- [x] Add pipeline.listLeads tRPC procedure (query by bookingDate=TBD)
- [x] Add pipeline.convertLeadToBooking tRPC procedure (set real date/time/detailer, status=confirmed)
- [x] Add dedicated Leads Inbox tab to Pipeline screen (separate from confirmed bookings)
- [x] Lead cards with service icon, quick Call/Text/Details actions
- [x] Lead detail modal with contact buttons, service info, notes, Convert to Booking form, Dismiss option
- [x] Generate all 10 city-specific A2P-compliant booking forms (5 cities x Maintenance + Ceramic)

## Abandoned Cart Tracking (May 2026)

- [x] Add POST /api/booking/abandoned endpoint (creates status=abandoned record in pipeline)
- [x] Add POST /api/booking/abandoned/complete endpoint (marks record closed when booking confirmed)
- [x] Inject sendAbandonedCartToApp() into all 5 city booking forms (fires on personal info step)
- [x] Inject markAbandonedCartComplete() into all 5 city booking forms (fires on booking confirm)
- [x] Abandoned cart records appear in Pipeline > Abandoned Cart column with recovery SMS button

## Abandoned Cart Recovery (May 2026)

- [x] Auto-send recovery SMS after 30 minutes (checks status before sending)
- [x] Auto-send branded recovery email with city booking page link
- [x] Send admin push notification when abandoned cart recovery fires
- [x] Add conversion tracking tab (📊 Tracking) to Pipeline screen
- [x] Week-over-week recovery rate comparison (This Week / Last Week / All Time)
- [x] "How it works" explainer section in Tracking tab
- [x] buildAbandonedCartRecoveryEmail in email.ts
- [x] getAbandonedCartsForRecovery and markAbandonedCartRecoverySent in db.ts
- [x] getAbandonedCartConversionStats in db.ts
- [x] pipeline.conversionStats tRPC procedure
- [x] abandoned-cart-monitor.ts server module
- [x] startAbandonedCartMonitor wired into server startup

## Training Step Delete (May 2026)
- [x] Add isDeleted column to interactive_step_overrides table
- [x] Add deleteBuiltInStep tRPC procedure (marks step as isDeleted=true)
- [x] Add restoreBuiltInStep tRPC procedure (marks step as isDeleted=false)
- [x] Add 🗑 delete button to each built-in step card in admin-training.tsx
- [x] Show greyed-out strikethrough row with Restore button for deleted steps
- [x] Filter deleted steps from employee training view

## Portal Inbox Improvements (May 2026)

- [x] Add city column to customers table (DB migration + schema update)
- [x] Update listThreads SQL query to include city in SELECT and GROUP BY
- [x] Display city under phone number in portal thread header
- [x] Fix chat background transparency (use colors.background on FlatList)
- [x] Redesign portal thread rows with prominent unread indicators (red badge, bold name, blue left accent bar)
- [x] Add deep-link support to admin-communications (tab + customerId params)
- [x] Add portal unread message banner to admin-dashboard
- [x] Add portal unread message banner to ops-dashboard
- [x] Create CustomerMessageBanner component for customer portal screens
- [x] Add CustomerMessageBanner to customer home screen
- [x] Add CustomerMessageBanner to customer bookings screen
- [x] Add CustomerMessageBanner to customer VIP screen
- [x] Add CustomerMessageBanner to customer profile screen

## Tracking Tab Period Filter

- [x] Add today/thisMonth periods to getAbandonedCartConversionStats in db.ts
- [x] Add convPeriod state (day/week/month/all) to admin-pipeline.tsx
- [x] Replace static This Week / Last Week / All Time sections with a single Day/Week/Month/All toggle
- [x] Show week-over-week trend only when Week filter is active

## Expense → Finance Linking

- [x] Add cityId column to expense_submissions table (DB + schema)
- [x] Update submitExpense to auto-resolve cityId from employee's city (server-side lookup)
- [x] Update reviewExpense to auto-create a finance_transaction (type=expense) when approved
- [x] Map expense category to finance category (fuel→Fuel, supplies→Chemicals, equipment→Equipment, etc.)
- [x] Pass cityId from expenses.tsx using resolved finance city from employee.city
- [x] Add cityId to submitExpense router input schema

## Pipeline Fixes (May 23, 2026)
- [x] Auto-convert abandoned cart to confirmed when admin manually creates a job (jobs.upsert)
- [x] Deduplicate pipeline: same person only appears once per stage (by phone/email)
- [x] Manually mark Arabhesky Chacon's abandoned cart as confirmed in DB

## Customer City Auto-Population (May 23, 2026)
- [x] Add updateCustomerCity function to customerDb.ts (only sets if not already populated)
- [x] Call updateCustomerCity in createBooking mutation after booking is created

## Customer Onboarding Walkthrough (May 23, 2026)
- [x] Create OnboardingWalkthrough component with 5-step spotlight overlay, pulsing arrow, tooltip, skip option
- [x] Integrate walkthrough into customer home screen (auto-launches on first login via AsyncStorage flag)
- [x] Steps: Profile tab → Add Address → Add Vehicle → Messages tab → Book button

## VIP Screen Enhancement (May 23, 2026)
- [x] Add vipInterest mutation to customer router (notifies admin team + sends portal message)
- [x] Replace no-contract VIP screen with full maintenance program description (How It Works, What's Included)
- [x] Add "I'm Interested — Notify the Team" button with success confirmation state
- [x] Fix referral link end-to-end: referral code shown cleanly in profile, share message includes code, booking confirm screen has referral code input with validation, 10% discount applied, referrer earns 500 pts when booking is confirmed

## Pending Booking Confirmation Flow

- [x] Change webhook booking creation to start as pending (not confirmed)
- [x] Change portal createBooking to create schedule_jobs as pending
- [x] Update inbound SMS handler to accept C/c/CONFIRMED replies and update status to confirmed
- [x] Remove appt_reminder_sent requirement from SMS confirmation check
- [x] Update email confirm link to also set schedule_jobs.status = confirmed
- [x] Update booking confirmation SMS to say "Reply C to confirm"

## Apple Tap to Pay (Stripe Terminal)

- [ ] Add Apple Tap to Pay entitlement to app.config.ts
- [ ] Install @stripe/stripe-react-native SDK
- [ ] Add server-side Terminal connection token endpoint
- [ ] Build Tap to Pay charge screen (amount input, reader init, payment flow)
- [ ] Wire Tap to Pay into job detail / collect payment screen


## Apple Tap to Pay Compliance (Required for Entitlement Approval)

- [ ] Add StripeTerminalProvider to root _layout.tsx for app-wide Terminal access
- [ ] TTP warm-up on app launch / foreground (req 1.5) — call discoverReaders on app start
- [ ] OS version error handling for iOS < 17.6 (req 1.4)
- [ ] In-app awareness moment — one-time modal showing TTP is available (req 3.1, 3.3)
- [ ] T&C acceptance flow — admin-only modal with Stripe TOS before first TTP use (req 3.5, 3.8)
- [ ] Unauthorized user message — show "contact admin" if non-admin tries to enable TTP (req 3.8.1)
- [ ] TTP Settings toggle in admin area — enable/disable TTP from settings (req 3.6)
- [ ] Merchant education screens after T&C acceptance (req 4.2, 4.5, 4.6)
- [ ] Configuration progress indicator using Terminal update events (req 3.9.1)
- [ ] "Initializing" screen if TTP takes > 300ms to open (req 5.7)
- [ ] Wire TTP button in AdminCheckoutModal to TapToPayCheckout (currently shows "Coming Soon")
- [ ] Add TTP awareness to admin-schedule checkout flow

## Discount Revenue Fix (May 26, 2026)

- [x] Fix server-side updateJobMeta: recalculate totalPrice = price + upsellTotal - discountAmount when discount is saved
- [x] Fix schedule.tsx CheckoutModal: subtract discountAmount from subtotal in Collect Payment button and checkout total
- [x] Fix schedule.tsx jobToServerPayload: store discounted totalPrice in DB on job completion
- [x] Fix schedule.tsx fullJobRevenue: subtract discountAmount before pushing to detailer performance
- [x] 26/26 vitest tests passing for discount revenue math (admin dashboard, detailer revenue, checkout subtotals)

## Booking Confirmation Email + Notify Customer Toggle (May 26, 2026)

- [x] Auto-send booking confirmation email to customer when a job is created via admin or detailer booking form (jobs.upsert)
- [x] "Notify customer" toggle (Switch) added to both admin and detailer Add Job modals — defaults to ON (blue)
- [x] Toggle subtitle shows "Confirmation email will be sent" / "No email will be sent" based on state
- [x] notifyCustomer: false passed for all re-sync calls (drag-to-move, resize, bulk sync) to prevent duplicate emails
- [x] 22 unit tests added covering shouldSendConfirmation guard, time formatting, date formatting, and all toggle scenarios

## 30-Minute Time Increments + VIP Package Fix (May 26, 2026)

- [ ] DB schema: change startHour/endHour from int to real (decimal) in drizzle schema and run migration
- [ ] Update HOURS array to use 0.5 increments (8, 8.5, 9, 9.5, ... 21)
- [ ] Update formatHour to format half-hours (8.5 → "8:30 AM")
- [ ] Update PICK_HOURS in DragTimePicker to use 0.5 increments
- [ ] Update grid positioning math to use fractional hours correctly
- [ ] Update drag-to-move and resize snapping to snap to 0.5-hour increments
- [ ] Update admin job detail time editor to use 0.5-hour increments
- [ ] Update detailer schedule +/- buttons to step by 0.5
- [ ] Update parseTimeSlot to handle ":30" minutes
- [ ] Fix booking form (admin + detailer) to load custom price book packages (VIP, etc.) from DB
- [ ] Show custom packages alongside hardcoded PACKAGES in the service wizard

## 30-Minute Time Increments & VIP Package Fix (May 26, 2026)

- [x] DB migration: changed startHour/endHour columns from INT to DECIMAL(4,1) in schedule_jobs and online_bookings
- [x] Drizzle schema updated to decimal() for startHour/endHour
- [x] HOURS array updated to 29 half-hour slots (7:00–21:00) in admin-schedule.tsx and schedule.tsx
- [x] SLOT_HEIGHT halved (64→32) to maintain visual proportions
- [x] formatHour updated to show ":00" / ":30" suffixes in both screens
- [x] PICK_HOURS updated to 30-min increments in admin DragTimePicker
- [x] fmtH updated to handle half-hours in admin job detail time editor
- [x] +/- time buttons in detailer Add Job modal step by 0.5 hours
- [x] Drag/resize snapping updated to 0.5-hour increments in admin-schedule.tsx
- [x] parseTimeSlot updated to handle :30 minutes (8.5 for 8:30 AM)
- [x] parseHour updated in routers.ts to handle :30 minutes
- [x] parseFloat coercions added to all syncServerJobs mappings (MySQL DECIMAL returns strings)
- [x] VIP and custom price book packages now show in admin and detailer booking forms
- [x] allJobPackages built from pbServices (price book) in admin-schedule.tsx, replaces hardcoded PACKAGES
- [x] All PACKAGES references in admin booking form, job detail editor, and extra vehicle picker updated to allJobPackages

## Calendar 8 AM–5 PM Restriction (May 26, 2026)

- [x] HOURS array restricted to 8:00 AM–5:00 PM (19 half-hour slots) in admin-schedule.tsx
- [x] PICK_HOURS restricted to 8:00 AM–5:00 PM in admin DragTimePicker
- [x] HOURS array restricted to 8:00 AM–5:00 PM in schedule.tsx
- [x] +/- time buttons clamped to 8:00 AM–5:00 PM in detailer Add Job modal
- [x] Shift-off overlay updated to cover full grid (0 to HOURS.length-1)

## Job Block Height Fix (May 26, 2026)
- [x] Fix customer_bookings fallback path to parse full time range (e.g. "8:00 AM – 12:00 PM") instead of hardcoding endHour = startHour + 2
- [x] Add parseFloat coercions to all three online booking mapping paths in schedule.tsx

## Private Notes Persistence Fix (Jun 4, 2026)
- [x] Fix private notes not showing after refresh — onNotesChange in schedule.tsx now calls persistJobs to update AsyncStorage
- [x] Fix same bug in admin-schedule.tsx — onNotesChange now calls persistJobs
- [x] Filter out __new__ placeholder note before persisting to AsyncStorage in both files

## Online Booking Package/Add-on Display Fix
- [x] Fix parseAddonIds to handle hyphenated Zapier slugs (clay-bar → clay_bar)
- [x] Add resolveVehicleType to normalize Zapier vehicle types (small/midsize → sedan)
- [x] Fix admin-schedule to use parseAddonIds(sj.selectedAddons) instead of sj.addonIds (wrong field)
- [x] Fix resolvePackageId to match short keys (luxury, full, basic) directly
- [x] Fix serviceTitle to show human-readable package name for short-key packages

## Admin Job Creation Discount
- [x] Add discount field ($ or %) to admin job creation form
- [x] Add optional discount code field to admin job creation form
- [x] Persist discount to DB on job save (upsert and createRecurring mutations)
- [x] Show live after-discount price preview in the form
## Add Job Time Picker UX Improvements
- [x] Fix scroll jump — Add Job modal ScrollView now uses ref + maintainVisibleContentPosition to stay in place after time selection
- [x] Auto-populate soonest available time slot when opening Add Job form
- [x] Auto-select detailer with the earliest open slot (still overridable)
- [x] Fix misleading warning text ("Red slots are unavailable" → accurate description)
- [x] Improve booked slot visuals — red background tint, strikethrough text, red dot + "Booked" label
## Detailer Schedule Auto-Refresh
- [x] Add 30-second background polling for detailers so new jobs appear automatically
- [x] Add AppState listener to re-sync when detailer brings app back from background
- [x] Polling and foreground refresh are detailer-only (admins unaffected)

## Calendar & Override Price Fixes
- [x] Fix calendar month header not updating when navigating months (combined state)
- [x] Fix override price not displaying after entry (show addCustomPrice in package card)
- [x] Show strikethrough original price when override is active
- [x] Show override amount on the "Override price" button label

## Recommended Services Fix
- [x] Add recommendedServices to jobs.upsert mutation schema in routers.ts
- [x] Add recommendedServices to jobs.upsert data mapping so it saves to DB

## Crestview Availability & Booking Flood Fix
- [x] Fix /api/booking/availability to count raw job count instead of registered-detailer matching
- [x] Fix /api/booking/webhook double-booking check to use raw job count
- [x] De-duplicate online_booking mirrors in schedule_jobs to avoid double-counting
- [x] Verified: fully-booked slots now correctly blocked; open slots still accept bookings

## Job Site Inspection Improvements

- [x] Replace Detailer Name text input with dropdown (Casey, Lamont, Michael, Cameron, Gabe, Giovanni)
- [x] Send email report to detailer on inspection submit
- [x] Add job site report stats card at top of inspection screen (pass %, total inspections, fail count)
- [x] Add admin view for inspection reports (new admin-inspections screen)
- [x] Remove extra spaced header from inspection screen

## Door Hangers for Detailers

- [x] Create /app/(tabs)/door-hangers.tsx — simplified photo logger pre-set to door_hangers type
- [x] Add door-hangers tab to _layout.tsx for detailers (hidden from admins)
- [x] Add Door Hangers entry to DETAILER_ITEMS in top-nav-menu.tsx pointing to /door-hangers
- [x] Fix TS errors in door-hangers.tsx (correct createEntry schema: date, city, outreachType, quantityDistributed)

## Chat Push Notifications & Unread Banner

- [x] Fix sendMessage push: DMs push only the recipient, group channels push all except sender
- [x] Add push notifications to sendVoiceMessage (Luxury Talk PTT) for all channel types
- [x] Add push notifications to community.createPost for all team members
- [x] Add chat_last_seen DB table for per-employee unread tracking
- [x] Add chat.markSeen tRPC route (called when user opens any channel/DM/community)
- [x] Add chat.getUnreadCount tRPC route (polls every 30s, returns total + type breakdown)
- [x] Build ChatUnreadBanner component (blue banner below nav bar, shows count + type)
- [x] Wire ChatUnreadBanner into TopNavMenu (visible on all screens using the shared nav)
- [x] Call markSeen in ConversationScreen when messages load
- [x] Call markSeen in PttScreen (Luxury Talk) when messages load
- [x] Call markSeen in CommunityScreen when posts load

## Schedule Pull-to-Refresh

- [x] Add RefreshControl import to admin-schedule.tsx
- [x] Add onRefresh/refreshing props to DualLaneTimeline component
- [x] Wire RefreshControl to the timeline's inner ScrollView (blue spinner, pull-down gesture)
- [x] Fix forceSync button to invalidate tRPC cache before re-fetching (so stale cache doesn't block updates)
- [x] Pass forceSync and isSyncing to DualLaneTimeline so pull-down and button share the same refresh state

## Job Event Push Notifications & In-App Banner

- [x] Create job_events DB table (tracks created/cancelled/rescheduled events)
- [x] Create job_event_seen DB table (tracks which team members have seen each event)
- [x] Add server-side push notifications to jobs.upsert for new jobs (📋 New Job Added)
- [x] Add server-side push notifications to jobs.upsert for rescheduled jobs (🔄 Job Rescheduled)
- [x] Add server-side push notifications to jobs.delete for cancelled jobs (❌ Job Cancelled)
- [x] Push targets all detailers, admins, and operations managers
- [x] Add jobs.getUnseenEvents tRPC route (returns unseen events from last 48h)
- [x] Add jobs.markEventsSeen tRPC route (marks events as seen per employee)
- [x] Build JobEventBanner component (blue banner, polls every 30s, animates in/out)
- [x] Wire JobEventBanner into TopNavMenu so it appears on all screens
- [x] Tapping banner navigates to Schedule and marks all events as seen

## Online Booking Webhook Notifications Fix

- [x] Fix webhook to push notifications to all detailers (not just admins/office) when a new online booking arrives
- [x] Create job_event record on new online booking so in-app banner shows for all detailers/admins

## Time Off Auto-Blocker

- [x] Server-side: when a time off request is approved, auto-create schedule blockers for each day of the approved period (ID: TIMEOFF-{requestId}-{date}, reason: "Time Off", allDay=1)
- [x] Client-side: pass startDate and endDate from selectedReq to updateStatus mutation so server has dates without extra DB lookup
- [x] Idempotent: skip blocker creation if one already exists for that day/request
- [x] Graceful error handling: approval still succeeds even if blocker creation fails

## Review Automation & Payment Fix

- [x] Remove payment auto-completing jobs — payment collection no longer changes job status to "completed"
- [x] Add city-specific Google review links map (Crestview, Destin, Fort Walton Beach, Niceville, Pensacola)
- [x] Build branded review request email template (buildReviewRequestEmail)
- [x] Queue review email 1 hour after detailer stamps finishedAt (via email_queue table)
- [x] Add review_request type to email_queue schema and apply DB migration

## QC Tab (Quality Control)
- [x] Add qc_records DB table to schema.ts
- [x] Run DB migration to create qc_records table
- [x] Add qc.getTodayJobs server route (completed jobs today with customer/detailer info + QC status)
- [x] Add qc.logCall server route (stamps calledAt timestamp on a QC record)
- [x] Add qc.saveResult server route (upsert pass/fail + feedback on a QC record)
- [x] Add qc.listHistory server route (past QC records for history tab)
- [x] Add clipboard.list.fill icon mapping to icon-symbol.tsx
- [x] Add ops-qc tab entry to _layout.tsx (visible to admin + ops_manager)
- [x] Add QC item to ADMIN_ALL_ITEMS in top-nav-menu.tsx
- [x] Add QC item to OPS_MANAGER_ITEMS in top-nav-menu.tsx
- [x] Create app/(tabs)/ops-qc.tsx screen with Today tab and History tab
- [x] Today tab: summary stats (passed/failed/pending), FlatList of completed jobs
- [x] Each job card: customer name, phone, detailer, city, Call button
- [x] Call button: dials customer via Linking.openURL('tel:...') + logs call timestamp
- [x] After call logged: show Pass / Fail buttons + feedback text input
- [x] Visual status indicators: green (passed), red (failed), gray (not called)
- [x] History tab: past days' QC records with date grouping

## Edit Vehicles & Services on Existing Jobs

- [x] Add Edit button to Vehicles & Services card in job detail (schedule.tsx)
- [x] Allow removing additional vehicles from a job
- [x] Allow adding new vehicles to a job from the detail view
- [x] Allow changing package per vehicle
- [x] Allow toggling add-ons per vehicle with qty +/- controls
- [x] Recalculate total price after edits
- [x] Persist changes to AsyncStorage and server (additionalVehicles now included in jobToServerPayload)

## Add Job Modal (Customer Profile New Job)
- [x] Pull packages from live price book instead of hard-coded list
- [x] Add RV vehicle types (rv_20_29, rv_30_39, rv_40_plus)
- [x] Add multi-vehicle support (additional vehicles with package/add-on selection)
- [x] Add custom price override
- [x] Add discount (fixed/percent)
- [x] Add job notes field
- [x] Add notify customer toggle
- [x] Add detailer availability / off-shift display
- [x] Persist additionalVehicles and notes in save payload

## Never-Ends Recurrence
- [x] Add neverEnds flag to RecurrenceRule type
- [x] Add Never Ends option to RecurrencePicker UI with description
- [x] Disable end-date options when Never Ends is selected
- [x] Update createRecurring server route to generate 13 jobs when neverEnds=true
- [x] Add getJobsByRecurrenceParent to db.ts
- [x] Auto-spawn next job in updateStatus when neverEnds job is completed

## Cancel Recurring Jobs
- [x] Add cancelRecurringSeries db function (sets status to cancelled, preserves history)
- [x] Add cancelRecurringSeries tRPC route
- [x] Add Cancel Recurring Job button to admin-schedule job detail (This Job Only / This & All Future / Entire Series)

## Performance by City (Reporting)
- [x] Add getCityBreakdown tRPC route (revenue, jobs, avg/job, tips per city)
- [x] Add cityBreakdownQ query to admin-reporting.tsx (enabled only when All Locations selected)
- [x] Add Performance by City section with horizontal bar chart and summary table

## Weekly Detailer Leaderboard

- [x] Weekly Detailer Leaderboard server endpoint (weeklyDetailerLeaderboard in performance router)
- [x] Leaderboard screen with animated podium (1st/2nd/3rd), category tabs (Overall/Revenue/Referrals/Upsells)
- [x] Full rankings list with animated slide-in rows, medal badges, stat chips
- [x] Score legend card and motivational footer
- [x] Leaderboard tab added to admin navigation (trophy icon, admin-only)
- [x] Unpaid Jobs tracker (admin tab) — list all jobs with outstanding balances, search/filter by status, quick call button, detail modal with call/text/email follow-up actions

## VIP Screen Multi-Contract & Live Dates

- [x] VIP screen: swipeable vehicle selector for customers with multiple contracts
- [x] VIP screen: show exact appointment date (day/month/year) instead of month-only in visit rows
- [x] VIP screen: auto-complete visits when linked schedule_job is marked completed (via backend enrichment)
- [x] VIP screen: prefer email lookup (returns all contracts) over saved token on load
- [x] VIP screen: show time slot in "This Month" card
## Ops Manager Bug Fixes
- [x] Fix default tab: ops managers now land on Dashboard instead of Punctuality (request-off and timesheet tabs hidden from ops managers via (isAdmin || isOpsManager) condition)
- [x] Add Pending Time Off banner to ops-dashboard.tsx (trpc.alerts.getSummary query + amber banner with count, tappable → admin-timeoff)
- [x] Make Pending Time Off badge tappable on admin-dashboard.tsx (wrapped in Pressable, navigates to admin-timeoff)

## VIP + Maintenance Program Expansion

- [x] Add program_type column (ENUM 'vip'/'maintenance', default 'vip') to vip_contracts table
- [x] Update vipRouter.ts: accept programType, skip add-ons for maintenance, use MNT- prefix for contract numbers
- [x] Update vipRouter.ts: use email-only matching (remove all phone-based contract lookups)
- [x] Update db.ts getAllCustomers VIP enrichment: use email-only matching
- [x] Update admin-vip.tsx: program type toggle in create form, badge on contract list, filter tabs (All/VIP/Maintenance)
- [x] Update admin-vip.tsx: email required field in create form with label noting it links to customer account
- [x] Rebuild customer vip.tsx sales screen: hero + comparison card + dual CTA (VIP vs Maintenance)
- [x] Update customer vip.tsx dashboard: show program_type badge, hide add-ons column for Maintenance contracts

## Address Save Fix

- [x] Fix booking location step to immediately save new address to customer profile on Continue tap
- [x] Parse address string into street/city/state/zip parts for DB storage
- [x] Show loading spinner on Continue button while address is being saved
- [x] Skip duplicate save if address already exists in profile
- [x] Confirmed customer profile My Addresses section already shows saved addresses with add/delete

## Date Pickers + Service/Warranty Reports

- [x] Add date picker to SERVICE DATE and NEXT SERVICE DATE fields in Log Service Record modal
- [x] Add date picker to EXPIRY DATE field in Upload Warranty modal
- [ ] Add tappable service record rows → detail modal showing full service report
- [ ] Add tappable warranty rows → detail modal showing warranty image/PDF and all details

## Date Pickers + Service/Warranty Reports

- [x] Add date picker to SERVICE DATE and NEXT SERVICE DATE fields in Log Service Record modal
- [x] Add date picker to EXPIRY DATE field in Upload Warranty modal
- [ ] Add tappable service record rows → detail modal showing full service report
- [ ] Add tappable warranty rows → detail modal showing warranty image/PDF and all details

## VIP Dashboard Fixes (Jun 13)
- [x] Fix VIP MEMBER badge position — use safe area insets so badge clears the Dynamic Island/notch
- [x] Fix "visits remaining" count — should be total visits minus completed visits (not total minus completed minus 1)
- [x] Fix vipRouter: cap visit generation at exactly 12 (no 13th renewal visit)
- [x] Remove existing 13th renewal visits from DB for existing contracts
- [x] Add renewalInterest mutation — notifies admin team when customer requests renewal
- [x] Add renewal CTA in customer VIP tab — "Request Renewal" button in expiry banner sends message to team

## QC Masked Calling (Jun 2026)

- [x] QC masked calling via Twilio (admin/ops manager) — customer sees (850) 367-8586
- [x] Call outcome tags: Satisfied, Issue Reported, No Answer, Left Voicemail
- [x] Masked call modal with personal phone prompt
- [x] QC history shows masked call badge and outcome tags
- [x] DB columns: call_outcome, twilio_call_sid, call_duration_seconds, caller_phone
- [x] Server route: qcUpdateOutcome mutation
## Late Notification + ETA Banner + Card-on-File Tip (Jun 2026)
- [x] Remove SMS from late arrival notification — replaced with push notification + email
- [x] Update schedule.tsx late sheet: description says "push notification and email", button says "🔔 Notify Customer", SMS preview removed
- [x] Update sendLateArrivalNotification server endpoint: remove Twilio SMS, send push notification to customer portal account, store late_eta in DB
- [x] Add late_eta and late_notified_at columns to customer_bookings schema + DB migration
- [x] Add lateEta field to portalJobs mapping in routers.ts
- [x] Add ETA banner to customer job detail screen (app/(customer)/job/[id].tsx) — amber warning banner shown when lateEta is set
- [x] Add tip step to card-on-file payment flow in CheckoutModal (card_on_file → tip → card_on_file_confirm → result)
- [x] Fix missing input style in admin-vip.tsx StyleSheet (TS error resolved)

## In-App Messaging (Jun 2026)
- [x] Create job_messages DB table (booking_ref, sender_type, sender_id, sender_name, message, created_at, read_at)
- [x] Add job_messages table to drizzle/schema.ts
- [x] Add messaging tRPC router: send, list, markRead, unreadCount endpoints
- [x] Messaging window logic: active when status is on_the_way/in_progress, stays open 3h post-completion
- [x] Customer chat UI in app/(customer)/job/[id].tsx — chat banner, chat modal, 5s polling, unread badge
- [x] Detailer chat UI in app/(tabs)/schedule.tsx — chat button in job detail, chat modal, 5s polling, unread count
- [x] Push notifications sent to other party when message is received
- [x] Mark messages as read when chat modal opens
## Portal ↔ Admin Sync Fixes (Jun 2026)
- [x] Sync customer_bookings when admin edits a portal job (date/time/package/address/status/assignedTo)
- [x] Send detailer push notification when customer cancels a booking
- [x] Send detailer push notification when customer reschedules a booking

## VIP Video Hero (Jun 2026)

- [x] Upload VIP explainer video to CDN (S3)
- [x] Create VipVideoProvider that pre-loads player at app startup via createVideoPlayer
- [x] Add VipVideoHero component with tap-to-play, volume on, caption bar
- [x] Insert video as first item in both no-contract and active-contract VIP views

- [x] Investor sales/pitch landing screen with pathway diagram, VIP tier, and personal message


## Calendar Sync Bugs (Critical - Launch Day)

- [x] Fix: Abandoned carts showing as booked jobs in customer portal
- [x] Fix: Deleted jobs from admin still appearing on detailer calendar after refresh
- [x] Fix: Old/stale jobs reappearing on detailer calendar when refreshing
- [x] Fix: Ensure all 3 calendars (Customer Portal, Admin, Detailer) stay perfectly in sync for create/delete/reschedule/cancel
- [x] Make hero media (video/image) configurable from server without rebuild

## Investor Inquiry Form (Lead Capture)

- [x] Create investor_inquiries database table
- [x] Add Drizzle schema definition for investor_inquiries
- [x] Add tRPC endpoint: investor.submitInquiry (public mutation)
- [x] Add tRPC endpoint: investor.adminListInquiries (admin query)
- [x] Add tRPC endpoint: investor.adminUpdateInquiryStatus (admin mutation)
- [x] Build investor inquiry form screen (app/investor-inquiry.tsx)
- [x] Wire "Get Started" button on investor-pitch.tsx to open inquiry form
- [x] Build admin investor inquiries screen (app/(tabs)/admin-investor-inquiries.tsx)
- [x] Add admin investor inquiries nav button to admin-investors.tsx
- [x] Send email notification to admin on new inquiry submission
- [x] Register admin-investor-inquiries in tabs layout

## Calendar Sync Bug Fix (Jun 27, 2026)

- [x] Fix: Ashley Ludlow's job showing on Elijah's schedule after portal deletion — directly cancelled stale DB row
- [x] Fix: cancelBooking endpoint now also cancels admin-created schedule_jobs matched by customerId+date+timeSlot (previously only matched by onlineBookingId which is NULL for admin-created jobs)

## Customer Portal Access Fix (Jun 27, 2026)

- [x] Fix signup: if email exists but no password set, allow setting password (claim account flow)
- [x] Add forgotPassword tRPC endpoint (sends reset token via email)
- [x] Add resetPassword tRPC endpoint (validates token, sets new password)
- [x] Add Forgot Password modal on login screen
- [x] Add admin "Send Portal Access" button in customer detail view
- [x] Add sendPortalAccess tRPC endpoint (admin triggers setup email for any customer)

## Remote Package Images (Jun 27, 2026)

- [x] Create package_images table in DB (packageId, imageUrl, updatedAt)
- [x] Seed current image URLs for all packages
- [x] Add tRPC endpoint: packages.getImages (returns all package image URLs)
- [x] Update customer portal package screen to fetch image URLs from API
- [x] Add admin "Manage Package Images" screen with upload/URL update per package
- [x] Add tRPC endpoint: packages.updateImage (admin mutation)

## VIP Credit System
- [x] Add `use-credit` booking request endpoint to vipRouter (customer requests date/time for unscheduled visit)
- [x] Add computed `credits_remaining` to by-email response
- [x] Add Credit Balance Card to customer VIP portal (prominent display of visits remaining)
- [x] Add "Request a Visit" button per unscheduled visit with date/time picker modal
- [x] Send admin notification email when customer requests a credit booking
- [x] Auto-decrement credits display when visit marked completed (dynamically computed from vip_visits)
- [x] Remove 14-day lookback limit on job history (admin + detailer schedule now fetch from 2020-01-01)
- [x] Fix photo loading in admin customer profile (always refresh from server when job modal opens)
- [x] Remove fake card-on-file modal stub from admin customer profile
- [x] Add VIP Elite contract type (2 luxury + 10 basic details, 12 months, custom pricing, full amount upfront, customer self-schedules)
- [x] Update DB schema: add vip_elite to program_type ENUM in vip_contracts table
- [x] Update admin-vip.tsx: VIP Elite option in new contract form, badge, filter, detail modal title
- [x] Update customer portal vip.tsx: VIP Elite member badge, credit heading, visit schedule helper, add-on legend
- [x] Update vipRouter.ts: VIP Elite contract creation, visit labels (Luxury/Basic), renewal job, signature page HTML verbiage

## Detailer Job Matching Bug Fix

- [x] Fix fuzzy LIKE matching in getScheduleJobsByLocationAndDateRange (replaced with strict exact match)
- [x] Fix fuzzy LIKE matching in getCompletedJobsForDetailer (replaced with strict exact match)
- [x] Per-employee AsyncStorage cache key (prevents cross-detailer cache leakage)
- [x] Clear old shared cache key on login and logout
- [x] Unit tests for strict matching logic

## Customer Portal Payment Status & Pay Now

- [ ] Add payment status (paid/unpaid) display to customer portal bookings list (green/red text)
- [ ] Add payment status to customer job detail screen
- [ ] Add Pay Now button for unpaid jobs in customer portal (Stripe)
- [ ] Sync payment status to admin schedule view
- [ ] Sync payment status to detailer schedule view
- [x] Add PAID/UNPAID badges (green/red) to customer portal bookings list
- [x] Add PAID/UNPAID badges to customer portal job detail screen
- [x] Add Pay Now button on job detail for unpaid upcoming jobs
- [x] Add UNPAID badge to detailer schedule job detail
- [x] Verify admin schedule already shows PAID/UNPAID badges (confirmed working)
- [x] Verify payment data syncs from admin/detailer to customer portal (confirmed working)

## Multi-Vehicle Pricing Bug Fix

- [x] Fix removeVehicleFromJob reading wrong column (job.price instead of customPrice ?? totalPrice)
- [x] Verify client-side sync mapping uses totalPrice correctly (confirmed: line 1672 already reads customPrice ?? totalPrice)
- [x] Add manual price editing UI for admin job detail (tap Service Total to edit, saves to customPrice + totalPrice)
- [ ] Trigger iOS build with all accumulated fixes

## VIP Elite Credit Redemption Fix

- [x] Fix backend: create vip_visits rows for credit-system contracts (was exiting early without creating any)
- [x] Fix isEliteCreditSystem detection: always true for VIP Elite (removed notes field dependency)
- [x] Add backfill-credits endpoint to fix existing contracts that had no visit rows
- [x] Backfill test contract (420002) and Greg Meadows contract (360001) with 12 credit rows
- [x] Update VisitTimelineCard to show "Available — Book Anytime" for null-date visits
- [x] Show service type label (Luxury Detail / Basic Detail) on each credit slot
- [x] Update section header to "Your 12 Service Credits" for VIP Elite
- [x] Update description text with dynamic remaining count
- [x] Verify Credits Used history shows service type from notes field

## VIP Elite Portal Overhaul

- [x] Add 6/12 credit count selector when creating VIP Elite contract (admin)
- [x] Remove vehicle requirement for VIP Elite contracts
- [x] Redesign VIP customer portal with clean light theme (remove dark cards)
- [x] Add Request Flex Pass button with calendar/city/time picker for priority scheduling
- [x] Add view contract details option for customers
- [x] Show percentage of credits used visually (credits used/remaining in contract details)
- [x] Active/inactive toggle on Price Book services to control customer portal visibility
- [x] Customer portal pulls services dynamically from Price Book (pricing + descriptions) instead of hardcoded values

## AI Coach Deep Analysis Enhancement

- [x] Enhance AI Coach system prompt to require deep, actionable business analysis
- [x] Add schedule density analysis (jobs per day per detailer, gaps between jobs)
- [x] Add drive time analysis (geographic clustering, route efficiency)
- [x] Add average job size breakdown (by service type, by detailer, by location)
- [x] Add upsell performance analysis (rate per detailer, missed opportunities, revenue impact)
- [x] Add payroll efficiency analysis (revenue per labor hour, labor cost ratio, overtime)
- [x] Add per-detailer performance comparison with specific recommendations
- [x] Feed richer data context to LLM (timesheet hours, per-detailer job counts, address clustering)
- [x] Upgraded to gemini-3.1-pro-preview with 8192 thinking tokens for deeper reasoning
- [x] Added fallback to gemini-3-flash-preview if primary model fails
- [x] Added new stats to frontend (Rev/Hr, Labor %, Jobs/Day)

## Portal Search & Chat Fixes

- [x] Fix customer search showing "Unknown" names in Portal tab and New Portal Message modal
- [x] Increase keyboard gap / input padding in chat so text is more visible when typing
- [x] Add image sharing capability to customer portal chat (send/receive images)
- [x] Add image sharing capability to admin chat view (send/receive images)
- [x] Fix empty-string phone digit matching bug in portal search filter
- [x] Add email field to portal thread search filter
- [x] Add image_url column to portal_messages table
- [x] Display received images in chat bubbles (both sides)

## VIP Credit Booking

- [x] Add "Book with Credit" button to each available VIP credit slot
- [x] Show button on ALL non-completed/cancelled/missed slots for all VIP contract types
- [x] Slots with existing date show "Change Date" button instead
- [x] Modal title and description update based on whether slot is already scheduled
- [x] Submit button label changes to "Request Date Change" vs "Book with Credit"

## Booking Crash Fix

- [x] Fix crash that occurs when customer taps "Confirm Booking" — root cause: 'rv' vehicleType not in server Zod enum or DB schema
- [x] Added 'rv' to vehicleType enum in createBooking, addVehicle, updateVehicle Zod schemas
- [x] Added 'rv' to vehicleType enum in drizzle schema (customer_vehicles + customer_bookings)
- [x] Ran ALTER TABLE to update MySQL ENUM columns in production DB
- [x] Updated all TypeScript union types in customerDb.ts
- [x] Fix success.tsx crash: expo-calendar was statically imported at top level — crashes on mount if native module not linked in build — fixed with dynamic import
- [x] Fix success.tsx: setCalendarLoading(false) missing in early-return paths — fixed

## Accountability Tab Pill Label Fix

- [x] Fix period filter pills (Day/Week/Month/Custom) showing blank text in native iOS build
- [x] Added minWidth, alignItems center, lineHeight, and includeFontPadding:false to pill Text

## Training Module Player Overhaul

- [x] Video-only modules (0 steps, has video): show video → Mark Complete button (no steps/quiz)
- [x] All step-based modules use Wheel Cleaning card design (image top, dark card, challenge tiles)
- [x] Mark Complete button at end of every module (video-only and step-based)
- [x] Removed quiz redirect from last step — modules are purely instructional
- [x] Challenge tiles: 3-column grid, dark background, green/red feedback, haptic feedback
- [x] Progress bar in step header, star score badge
- [x] Module Complete celebration screen with green checkmark
- [x] "Already Completed" state shown for previously completed modules

## Guest Booking Flow

- [x] Add "Continue as Guest" button to login screen (navigates directly to booking flow)
- [x] Update booking-context.tsx to add guestInfo state (firstName, lastName, email, phone)
- [x] Update vehicle.tsx to show inline form for guest users (no saved vehicles list)
- [x] Update confirm.tsx to show guest contact info fields (name, email, phone) when no token
- [x] Add createGuestBooking mutation to server/routers.ts (finds/creates customer, creates vehicle, booking, schedule job, sends confirmation email, admin alert, abandoned cart record)

## App Entry Point

- [x] App now opens on customer Home screen by default (not login screen)
- [x] Unauthenticated users land on customer home and can browse/book as guest
- [x] Employee/admin logins still redirect to their respective portals
- [x] Loading state prevents flash of marketing page before redirect

## Guest Booking Success & Lookup (Jul 31, 2026)

- [x] Add isGuest parameter to success screen to differentiate guest vs authenticated flows
- [x] Update success screen buttons: guests see "Create Account" and "Track Your Booking" instead of "View My Bookings"
- [x] Add guest booking lookup API endpoint (lookupGuestBooking) — public query with email + reference
- [x] Add getGuestBookingByEmailAndRef DB helper in customerDb.ts
- [x] Create booking lookup screen (app/(customer)/book/lookup.tsx) with email/reference input
- [x] Display booking details on lookup result (vehicle, service, date, time, location, total, status)
- [x] Add "Track Your Booking" button on guest success screen linking to lookup screen
- [ ] Test guest booking flow end-to-end: book as guest → success screen → create account / track booking
- [ ] Verify lookup screen works with valid and invalid email/reference combinations
- [ ] Test iOS build with all guest booking features

## Image Viewer for Customer Messages (Aug 3, 2026)

- [x] Add full-screen image viewer modal to customer messages screen
- [x] Implement tap-to-open functionality on message images
- [x] Add close button and tap-to-dismiss on modal
- [x] Write unit tests for image viewer state management (6 tests)
- [x] Write unit tests for timezone utilities (17 tests)
- [x] Update vitest config to support @ path alias resolution
- [x] All 23 tests passing ✅
- [x] Trigger iOS Build #118 with image viewer feature


## Loan Contract Management System (Aug 4, 2026)

### Phase 1: Database & Core API
- [ ] Create loan_contracts table with all fields
- [ ] Create loan_payment_schedules table
- [ ] Create loan_payments table
- [ ] Build tRPC loan router with endpoints
- [ ] Implement payment schedule generator (weekly/bi-weekly/monthly)
- [ ] Build interest calculator
- [ ] Create database helper functions

### Phase 2: Admin Loans Tab UI
- [ ] Create admin-loans.tsx tab screen
- [ ] Build loan-form-modal.tsx for creating/editing loans
- [ ] Create admin-loan-detail.tsx for viewing loan details
- [ ] Add loans tab to admin navigation
- [ ] Build loan cards with status badges
- [ ] Implement search/filter functionality
- [ ] Add quick action buttons (view, edit, send contract, record payment)

### Phase 3: Contract & Email
- [ ] Build PDF contract generator
- [ ] Create contract email template
- [ ] Implement signature capture endpoint
- [ ] Add S3 storage for contracts
- [ ] Build "send contract" functionality
- [ ] Create signed contract confirmation email

### Phase 4: Payment Management
- [ ] Build payment recording UI
- [ ] Implement payment status tracking
- [ ] Create payment reminder scheduler (1 day before)
- [ ] Build celebratory payment reminder email template (sent to lender)
- [ ] Add automatic email sending logic
- [ ] Create payment history view
- [ ] Add ability to edit loan terms (recalculates schedule)

### Phase 5: Testing & Polish
- [ ] Unit tests for payment schedule generator
- [ ] Integration tests for loan CRUD
- [ ] End-to-end testing (create → sign → pay)
- [ ] UI polish and refinements
- [ ] Performance optimization

## Home Service CRM Refactor

- [x] Audit all VIP-contract and loan-contract screens, navigation entries, server routes, schemas, and shared components.
- [x] Remove VIP-contract and loan-contract functionality without leaving inaccessible routes or broken references.
- [x] Reposition the product identity, copy, and core visual language for a distinct home-service CRM.
- [x] Create a dedicated CRM app icon and update application branding metadata.
- [x] Apply the supplied Fieldframe web-app reference to the CRM’s information hierarchy, calm dark visual system, and operations-focused terminology.
- [x] Preserve the unused VIP and loan-contract tables without future destructive migrations.
- [x] Validate navigation, type safety, and the primary non-contract workflows after the refactor.
- [x] Optimize the generated Hearthline CRM icon for checkpoint-safe launcher, splash, and favicon use.
- [x] Update the product name and core user-facing branding to Home Service Connection.
- [x] Resolve the mobile launch link HTTP 500 error and verify server accessibility.
- [x] Remove remaining copied Luxury Wash On Wheels labels from the core application identity and entry screens.
- [x] Repair the Expo Go launch path and validate both the manifest and iOS bundle responses.
- [x] Run the default mobile development server without the unrelated API background workers so the public Expo proxy remains stable.
- [x] Inspect and simplify the Expo Go startup path until the manifest and initial iOS bundle open without HTTP 500 responses.
- [x] Produce an evidence-based root-cause report for the persistent Expo Go HTTP 500 launch failure, including proxy, manifest, bundle, asset, and runtime analysis.
- [x] Apply and validate only the repair supported by the Expo Go incident findings.
- [x] Disconnect Stripe and Stripe Terminal native integrations from this independent copy without affecting the original project or Stripe account.
- [ ] Revalidate Expo Go compatibility after Stripe removal and document all disabled payment functionality.
- [ ] Hold TestFlight submission until a native validation route and its prerequisites are confirmed.
- [x] Prepare a distinct Home Service Connection iOS/TestFlight identity without submitting or publishing the build.
- [ ] Verify App Store Connect and Expo build prerequisites for a separate internal TestFlight validation path.
- [x] Prepare a distinct Home Service Connection iOS/TestFlight identity without submitting or publishing the build.
- [ ] Verify App Store Connect and Expo build prerequisites for a separate internal TestFlight validation path.
- [x] Replace the copied Luxury Wash On Wheels login identity with Home Service Connection before native build validation.
- [x] Verify the active login source displays Home Service Connection; any Luxury Wash On Wheels preview is stale cached output.
- [x] Create and verify a new administrator profile for Adrian Miller at adrian@detailertoceo.com in this independent copy.
- [x] Create and verify a new administrator profile for Adrian Miller at adrian@detailertoceo.com in this independent copy.
- [x] Restore direct routing to the Home Service Connection login screen after the sandbox reset.
- [x] Restore the Home Service Connection logo and remove remaining user-facing Luxury Wash On Wheels wording.
- [x] Restore the web-safe native-map compatibility shim and verify the preview loads from current source.
- [x] Archive the copied static web export so it cannot shadow current Home Service Connection Expo Router routes.
- [x] Remove the Continue as Guest option from the Home Service Connection login screen.
- [x] Remove the Continue as Guest option from the Home Service Connection login screen.
- [ ] Verify Home Service Connection TestFlight prerequisites and prepare the user-controlled release checklist.
- [ ] Retrieve and provide the current Home Service Connection Expo development link.
- [ ] Link the local Home Service Connection configuration to its newly created Expo/EAS project before the first iOS build.
- [ ] Retrieve or establish the Expo/EAS project association without requiring a manually copied Project ID.
- [ ] Use the managed Publish flow for the TestFlight build without exposing an EAS token or running a local build.
- [ ] Keep TestFlight credentials in the managed Expo/Apple flow and rotate the EAS token that was shared in chat.
- [x] Lower the Home Service Connection logo and login form to improve the sign-in screen’s vertical spacing.
- [x] Repair Adrian Miller’s administrator sign-in by aligning the active API target and account record.
- [x] Restore deployed administrator login by making the employee authentication query compatible with the active production schema.
- [x] Verify the live deployed administrator login response after the compatibility release and correct any remaining mismatch.
- [ ] Verify Adrian Miller’s administrator sign-in through the deployed client flow and correct any client-side mismatch.
- [ ] Audit the deployed authentication flow end-to-end and add a reliable administrator account provisioning path if required.
- [ ] Confirm whether the Home Service Connection project database is shared with the deployed web app backend.
- [x] Route numeric administrator PIN logins directly to the verified employee endpoint and make customer lookup compatible with the deployed schema.
- [ ] Add a dedicated Employee ID and PIN sign-in path for administrator access and verify Adrian Miller’s credentials through it.
- [x] Prevent employee session storage failures from blocking a successful administrator login redirect.
- [ ] Record and verify the completed App Store Connect connection for Home Service Connection.
