/**
 * ============================================================
 * LUXURY WASH ON WHEELS — BOOKING FORM AVAILABILITY INTEGRATION
 * ============================================================
 *
 * HOW TO USE:
 * In your WordPress booking form's <script> block, make the
 * following 3 replacements. Each city's page gets its own copy
 * with the correct LOCATION value.
 *
 * STEP 1: Add these two constants near the TOP of your <script>
 *         block, right before the variable declarations.
 *
 * STEP 2: Replace getCurrentDateInCDT() with the fixed version.
 *
 * STEP 3: Replace renderTimeSlots() with the async version.
 *
 * STEP 4: Replace the sendToZapier() call in the confirm-booking
 *         click handler with the updated version that also posts
 *         to the app webhook.
 */


// ============================================================
// STEP 1 — ADD THESE CONSTANTS (one set per booking page)
// ============================================================

// ── CRESTVIEW PAGE ──────────────────────────────────────────
const LOCATION = 'crestview';

// ── NICEVILLE PAGE ──────────────────────────────────────────
// const LOCATION = 'niceville';

// ── DESTIN PAGE ─────────────────────────────────────────────
// const LOCATION = 'destin';

// ── FORT WALTON BEACH PAGE ──────────────────────────────────
// const LOCATION = 'fwb';

// App API base URL (same for all pages)
const APP_API_BASE = 'https://luxwashapp-n2wveyqg.manus.space';


// ============================================================
// STEP 2 — REPLACE getCurrentDateInCDT() with this version
// ============================================================
// FIND this in your script:
//   const getCurrentDateInCDT = () => {
//       const now = new Date();
//       const cdtOffset = -5 * 60;
//       ...
//   };
//
// REPLACE WITH:

const getCurrentDateInCST = () => {
    // Use the Intl API to get the correct US Central time (handles DST automatically)
    const now = new Date();
    const centralTime = new Date(now.toLocaleString('en-US', { timeZone: 'America/Chicago' }));
    return centralTime;
};

// Also update the reference in generateCalendarDates():
// Change:  const today = getCurrentDateInCDT();
// To:      const today = getCurrentDateInCST();


// ============================================================
// STEP 3 — REPLACE renderTimeSlots() with this async version
// ============================================================
// FIND this in your script:
//   const renderTimeSlots = () => {
//       const container = document.getElementById('time-slots-grid');
//       container.innerHTML = '';
//       const slots = getTimeSlotsForPackage();
//       if (!slots.length) {
//           container.innerHTML = '<div class="time-slot-text">Please select a package first.</div>';
//           return;
//       }
//       slots.forEach(slot => {
//           const timeSlot = document.createElement('div');
//           timeSlot.className = `time-slot ${selectedTime === slot.time ? 'selected' : ''}`;
//           timeSlot.onclick = () => selectTime(slot.time);
//           timeSlot.innerHTML = `<div class="time-slot-text">${slot.time}</div>`;
//           container.appendChild(timeSlot);
//       });
//   };
//
// REPLACE WITH:

const renderTimeSlots = async () => {
    const container = document.getElementById('time-slots-grid');
    container.innerHTML = '';

    const slots = getTimeSlotsForPackage();

    if (!slots.length) {
        container.innerHTML = '<div class="time-slot-text">Please select a package first.</div>';
        return;
    }

    // Show loading state while checking availability
    container.innerHTML = '<div class="time-slot-text" style="color:#6b7280;font-style:italic;">Checking availability...</div>';

    // Fetch booked slots from the app API
    let bookedSlots = [];
    if (selectedDate) {
        try {
            const url = `${APP_API_BASE}/api/booking/availability?location=${LOCATION}&date=${selectedDate}`;
            const resp = await fetch(url);
            if (resp.ok) {
                const data = await resp.json();
                bookedSlots = data.bookedSlots || [];
            }
        } catch (err) {
            // If the API is unreachable, show all slots (fail open)
            console.warn('Availability check failed, showing all slots:', err);
        }
    }

    container.innerHTML = '';

    slots.forEach(slot => {
        const isBooked = bookedSlots.includes(slot.time);
        const isSelected = selectedTime === slot.time;

        const timeSlot = document.createElement('div');
        timeSlot.className = `time-slot ${isSelected ? 'selected' : ''} ${isBooked ? 'unavailable' : ''}`;

        if (isBooked) {
            // Greyed out — not clickable
            timeSlot.style.opacity = '0.45';
            timeSlot.style.cursor = 'not-allowed';
            timeSlot.style.pointerEvents = 'none';
            timeSlot.innerHTML = `
                <div class="time-slot-text">${slot.time}</div>
                <div style="font-size:11px;color:#9ca3af;margin-top:2px;">Fully Booked</div>
            `;
        } else {
            timeSlot.onclick = () => selectTime(slot.time);
            timeSlot.innerHTML = `<div class="time-slot-text">${slot.time}</div>`;
        }

        container.appendChild(timeSlot);
    });
};

// NOTE: Because renderTimeSlots is now async, you also need to update
// the selectDate function to await it:
//
// FIND:
//   const selectDate = (dateValue, dateObj) => {
//       selectedDate = dateValue;
//       selectedTime = '';
//       ...
//       renderTimeSlots();     <-- change this line
//       ...
//   };
//
// REPLACE the renderTimeSlots() call with:
//       renderTimeSlots();     // (async — no need to await, it updates the DOM itself)
// (No change needed — calling async function without await is fine here)


// ============================================================
// STEP 4 — UPDATE THE CONFIRM BOOKING CLICK HANDLER
// ============================================================
// FIND the confirm-booking click handler (near the bottom of your script):
//
//   confirmBtn.addEventListener('click', async function (e) {
//       ...
//       try {
//           await Promise.race([
//               sendToZapier(),
//               new Promise(res => setTimeout(res, 1500))
//           ]);
//       } finally {
//           window.location.href = href;
//       }
//   });
//
// REPLACE WITH:

/*
confirmBtn.addEventListener('click', async function (e) {
    if (this.classList.contains('is-disabled')) {
        e.preventDefault();
        return;
    }

    e.preventDefault();
    const href = this.href;
    this.textContent = 'Submitting...';
    this.style.pointerEvents = 'none';

    updateConfirmation();

    try {
        // Send to Zapier (existing) AND to the app webhook simultaneously
        await Promise.race([
            Promise.all([
                sendToZapier(),
                sendToAppWebhook(),
            ]),
            new Promise(res => setTimeout(res, 2000))
        ]);
    } finally {
        window.location.href = href;
    }
});
*/

// ADD this new function anywhere in your script (before the DOMContentLoaded block):

function sendToAppWebhook() {
    let addons;
    switch (packageType) {
        case 'luxury': addons = luxuryAddons; break;
        case 'full': addons = fullAddons; break;
        case 'interior': addons = interiorAddons; break;
        case 'exterior': addons = exteriorAddons; break;
        default: addons = basicAddons; break;
    }

    const selectedAddonNames = selectedAddons
        .map(id => (addons.find(a => a.id === id)?.name || ''))
        .filter(Boolean);

    const formData = new URLSearchParams();
    formData.append('firstName', firstName);
    formData.append('lastName', lastName);
    formData.append('email', email);
    formData.append('phone', phone);
    formData.append('streetAddress', streetAddress);
    formData.append('unit', unit);
    formData.append('city', city);
    formData.append('state', state);
    formData.append('zipCode', zipCode);
    formData.append('vehicleType', vehicleNames[vehicleType] || vehicleType);
    formData.append('packageType', packageNames[packageType] || packageType);
    formData.append('selectedAddons', selectedAddonNames.join(', '));
    formData.append('totalPrice', String(totalPrice));
    formData.append('selectedDate', selectedDate);
    formData.append('selectedTime', selectedTime);
    formData.append('discountCode', discountState.isApplied ? discountState.code : '');
    formData.append('discountAmount', String(discountState.isApplied ? discountState.amount : 0));
    formData.append('finalTotal', String(getDiscountedTotal()));
    formData.append('page', window.location.pathname);

    const webhookUrl = `${APP_API_BASE}/api/booking/webhook?location=${LOCATION}`;

    return fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: formData.toString(),
        keepalive: true,
    }).then(() => true).catch(err => {
        console.error('App webhook error:', err);
        return false; // Don't block the booking if the app webhook fails
    });
}
