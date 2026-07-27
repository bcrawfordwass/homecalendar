FAMILY HUB - LENOVO TABLET STARTER
==================================

This is a self-contained starter app for a Lenovo Android tablet.
It includes:
- Weekly family calendar
- Colour-coded family members
- Chores
- Dinner planning
- Shopping list
- Offline caching after the first hosted visit
- Local saving in the tablet browser

IMPORTANT
---------
This first version stores information only on the device/browser where it is used.
Google Calendar syncing is not connected yet.

FASTEST WAY TO TRY IT ON A COMPUTER
-----------------------------------
1. Unzip this folder.
2. Double-click index.html.

Most features work directly. Installing it as an Android app and offline caching
require it to be served from a website rather than opened as a local file.

EASIEST WAY TO PUT IT ONLINE
----------------------------
You can drag this entire unzipped folder into a static hosting service such as
Netlify Drop, Cloudflare Pages, GitHub Pages or another HTTPS web host.

ON THE LENOVO TABLET
--------------------
1. Open the hosted address in Chrome.
2. Open Chrome's menu.
3. Choose "Install app" or "Add to Home screen".
4. Launch Family Hub from its new icon.
5. For a wall display, use Android screen pinning or Lenovo kiosk/display settings.

FILES
-----
index.html             App shell
styles.css             Tablet layout and visual design
app.js                 Calendar, chores, meals, shopping and local saving
manifest.webmanifest   Android/PWA install settings
service-worker.js      Offline caching
icons/                 Home-screen icons

DATA RESET
----------
To reset the sample data, clear site data for Family Hub in Chrome settings.
