import os

with open('/home/ubuntu/upload/pasted_content_3.txt', 'rb') as f:
    content = f.read().decode('utf-8')

# Fix 1: Remove sticky positioning from .nav-buttons using line-by-line approach
lines = content.split('\n')
result = []
i = 0
while i < len(lines):
    line = lines[i]
    stripped = line.rstrip('\r')
    if stripped == '        .nav-buttons {':
        result.append(line)
        i += 1
        block = []
        while i < len(lines) and lines[i].rstrip('\r') != '        }':
            block.append(lines[i])
            i += 1
        skip_keys = ['position: sticky', 'bottom: 20px', 'background: white', 'z-index: 50']
        for bl in block:
            if not any(k in bl for k in skip_keys):
                result.append(bl)
        result.append(lines[i])  # closing }
        i += 1
    else:
        result.append(line)
        i += 1

new_content = '\n'.join(result)
nav_section = new_content.split('.nav-buttons')[1].split('}')[0]
print("Fix 1 applied (sticky removed):", 'position: sticky' not in nav_section)

# Fix 2: Add resume pre-fill script before </body>
resume_script = """<script>
/* Luxury Wash On Wheels - Abandoned Cart Resume Pre-fill
   When customer clicks "Complete My Booking" from recovery email,
   URL contains ?resume=TOKEN. Fetches saved info and pre-fills form. */
(function () {
  var API_BASE = 'https://www.luxurywashonwheels.app/api';
  var params = new URLSearchParams(window.location.search);
  var resumeToken = params.get('resume');
  if (!resumeToken) return;
  fetch(API_BASE + '/resume/' + resumeToken)
    .then(function (res) { return res.ok ? res.json() : null; })
    .then(function (data) {
      if (!data) return;
      function fill(ids, value) {
        if (!value) return;
        for (var i = 0; i < ids.length; i++) {
          var el = document.querySelector(ids[i]);
          if (el) {
            el.value = value;
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            break;
          }
        }
      }
      fill(['#first-name'], data.firstName);
      fill(['#last-name'], data.lastName);
      fill(['#email'], data.email);
      fill(['#phone'], data.phone);
      fill(['#street-address'], data.streetAddress);
      fill(['#unit'], data.unit);
      fill(['#city'], data.city);
      fill(['#state'], data.state);
      fill(['#zip'], data.zipCode);
      var b = document.createElement('div');
      b.style.cssText = 'background:#0a7ea4;color:white;padding:14px 20px;border-radius:10px;font-family:-apple-system,sans-serif;font-size:15px;font-weight:600;margin-bottom:20px;text-align:center;box-shadow:0 2px 8px rgba(0,0,0,.15);';
      b.textContent = '\\u2705 We saved your info \\u2014 just review and confirm!';
      var c = document.querySelector('.car-booking-content') || document.body;
      c.insertBefore(b, c.firstChild);
      console.log('[LWW Resume] Pre-filled booking form for', data.firstName);
    })
    .catch(function (e) { console.warn('[LWW Resume] Error:', e); });
})();
</script>
</body>"""

new_content = new_content.replace('</body>', resume_script, 1)
print("Fix 2 applied (resume script):", 'luxurywashonwheels.app/api' in new_content)

os.makedirs('/home/ubuntu/team-luxury-wash/docs', exist_ok=True)
with open('/home/ubuntu/team-luxury-wash/docs/booking-form.html', 'w', encoding='utf-8') as f:
    f.write(new_content)
print("Saved to docs/booking-form.html. Lines:", new_content.count('\n'))
