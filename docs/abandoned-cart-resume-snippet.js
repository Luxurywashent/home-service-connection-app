/**
 * Luxury Wash On Wheels — Abandoned Cart Resume Snippet
 * ======================================================
 * Add this script to the booking page on luxurywashonwheels.com
 * (e.g., via WordPress Custom HTML block or footer script).
 *
 * When a customer clicks "Complete My Booking" from the recovery email/SMS,
 * they land on the booking page with ?resume=TOKEN in the URL.
 * This script fetches their saved info and pre-fills the booking form.
 *
 * HOW TO INSTALL:
 *   1. Go to WordPress > Appearance > Theme Editor (or use a plugin like "Insert Headers and Footers")
 *   2. Add this script to the footer of the booking pages:
 *      - /destin/mobile-detailing/
 *      - /crestview/mobile-detailing/
 *      - /niceville/mobile-detailing/
 *      - /fwb/mobile-detailing/
 *      - /pensacola/mobile-detailing/
 *   3. That's it — it will only activate when ?resume=TOKEN is present in the URL.
 */

(function () {
  // ── Config ──────────────────────────────────────────────────────────────────
  const API_BASE = "https://www.luxurywashonwheels.app/api"; // Server API base URL

  // ── Read resume token from URL ───────────────────────────────────────────────
  const params = new URLSearchParams(window.location.search);
  const resumeToken = params.get("resume");
  if (!resumeToken) return; // No token — normal booking flow, do nothing

  // ── Fetch saved cart data ────────────────────────────────────────────────────
  fetch(`${API_BASE}/resume/${resumeToken}`)
    .then(function (res) {
      if (!res.ok) return null;
      return res.json();
    })
    .then(function (data) {
      if (!data) return;

      // ── Helper: fill a field by multiple possible selectors ──────────────────
      function fillField(selectors, value) {
        if (!value) return;
        for (var i = 0; i < selectors.length; i++) {
          var el = document.querySelector(selectors[i]);
          if (el) {
            el.value = value;
            // Trigger React/Vue/GHL change events so the form registers the value
            var event = new Event("input", { bubbles: true });
            el.dispatchEvent(event);
            var changeEvent = new Event("change", { bubbles: true });
            el.dispatchEvent(changeEvent);
            break;
          }
        }
      }

      // ── Helper: select a radio/checkbox option by value ──────────────────────
      function selectOption(name, value) {
        if (!value) return;
        // Try <select> first
        var select = document.querySelector('select[name="' + name + '"]');
        if (select) {
          for (var i = 0; i < select.options.length; i++) {
            if (select.options[i].value.toLowerCase() === value.toLowerCase() ||
                select.options[i].text.toLowerCase().includes(value.toLowerCase())) {
              select.selectedIndex = i;
              select.dispatchEvent(new Event("change", { bubbles: true }));
              return;
            }
          }
        }
        // Try radio buttons
        var radios = document.querySelectorAll('input[type="radio"][name="' + name + '"]');
        for (var j = 0; j < radios.length; j++) {
          if (radios[j].value.toLowerCase() === value.toLowerCase() ||
              radios[j].labels[0]?.textContent.toLowerCase().includes(value.toLowerCase())) {
            radios[j].checked = true;
            radios[j].dispatchEvent(new Event("change", { bubbles: true }));
            return;
          }
        }
      }

      // ── Wait for form to render, then fill ───────────────────────────────────
      // GHL forms can render asynchronously, so we wait up to 3 seconds
      var attempts = 0;
      var maxAttempts = 30;
      var interval = setInterval(function () {
        attempts++;

        // Check if any form fields are present
        var firstNameField = document.querySelector(
          'input[name="first_name"], input[name="firstName"], input[placeholder*="First"], input[id*="first"]'
        );
        if (!firstNameField && attempts < maxAttempts) return;

        clearInterval(interval);

        // ── Fill personal info ──────────────────────────────────────────────
        fillField(
          ['input[name="first_name"]', 'input[name="firstName"]', 'input[placeholder*="First Name"]', 'input[id*="first_name"]'],
          data.firstName
        );
        fillField(
          ['input[name="last_name"]', 'input[name="lastName"]', 'input[placeholder*="Last Name"]', 'input[id*="last_name"]'],
          data.lastName
        );
        fillField(
          ['input[name="email"]', 'input[type="email"]', 'input[placeholder*="Email"]'],
          data.email
        );
        fillField(
          ['input[name="phone"]', 'input[type="tel"]', 'input[placeholder*="Phone"]'],
          data.phone
        );

        // ── Fill address ────────────────────────────────────────────────────
        fillField(
          ['input[name="address1"]', 'input[name="streetAddress"]', 'input[name="street_address"]', 'input[placeholder*="Street"]', 'input[placeholder*="Address"]'],
          data.streetAddress
        );
        fillField(
          ['input[name="address2"]', 'input[name="unit"]', 'input[placeholder*="Apt"]', 'input[placeholder*="Unit"]'],
          data.unit
        );
        fillField(
          ['input[name="city"]', 'input[placeholder*="City"]'],
          data.city
        );
        fillField(
          ['input[name="state"]', 'select[name="state"]', 'input[placeholder*="State"]'],
          data.state
        );
        fillField(
          ['input[name="postal_code"]', 'input[name="zipCode"]', 'input[name="zip"]', 'input[placeholder*="ZIP"]', 'input[placeholder*="Zip"]'],
          data.zipCode
        );

        // ── Select vehicle type ─────────────────────────────────────────────
        if (data.vehicleType) {
          selectOption("vehicleType", data.vehicleType);
          selectOption("vehicle_type", data.vehicleType);
          selectOption("vehicle", data.vehicleType);
        }

        // ── Select package ──────────────────────────────────────────────────
        if (data.packageType) {
          selectOption("packageType", data.packageType);
          selectOption("package_type", data.packageType);
          selectOption("package", data.packageType);
        }

        // ── Show a friendly banner ──────────────────────────────────────────
        var banner = document.createElement("div");
        banner.style.cssText = [
          "background: #0a7ea4",
          "color: white",
          "padding: 12px 20px",
          "border-radius: 10px",
          "font-family: -apple-system, sans-serif",
          "font-size: 15px",
          "font-weight: 600",
          "margin-bottom: 16px",
          "text-align: center",
          "box-shadow: 0 2px 8px rgba(0,0,0,0.15)",
        ].join(";");
        banner.textContent = "✅ We saved your info — just review and confirm!";

        // Insert banner at the top of the form
        var form = document.querySelector("form");
        if (form) {
          form.insertBefore(banner, form.firstChild);
        } else {
          document.body.insertBefore(banner, document.body.firstChild);
        }

        console.log("[LWW Resume] Pre-filled booking form for", data.firstName);
      }, 100); // Check every 100ms
    })
    .catch(function (err) {
      console.warn("[LWW Resume] Could not load saved booking data:", err);
    });
})();
