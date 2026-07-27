FAMILY HUB - FOUNDATIONS UPDATE v0.1.0

Replace these files in your existing homecalendar folder:
- index.html
- app.js
- styles.css
- service-worker.js

Add these two new files:
- config.js
- version.json

Do not remove or clear Chrome site data. Your events, meals, chores, shopping items and people remain in the existing localStorage record.

FIRST TABLET REFRESH AFTER DEPLOYMENT
Open this address once in a NORMAL Chrome tab (not Incognito):
https://bcrawfordwass.github.io/homecalendar/?update=0.1.0

The unique address bypasses the old cached index page while keeping access to the same saved data. Leave it open for several seconds, tap "Update now" if shown, then reopen the installed Family Hub icon.

Suggested commit message:
Add safe app updates and version settings
