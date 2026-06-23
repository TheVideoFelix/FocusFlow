# FocusFlow

A modern, distraction-free site blocker Firefox Extension designed to help you stay focused on your studies. FocusFlow allows you to easily block distracting websites either for a temporary focus window or during scheduled blocks throughout the week.

## Features

- Dynamic Light & Dark Modes: A modern, gorgeous UI with smooth theme-toggle animations.
- Quick Focus Timer: Instantly block all distracting sites for predefined intervals or a custom duration, with a real-time countdown.
- Weekly Schedules: Set specific block intervals for chosen days of the week.
- Blocked Redirection Page: When accessing a blocked site, you are redirected to a custom dashboard with a live countdown and motivational quotes.
- Domain Blocklist Manager: Add any custom distracting website domain to the blocklist.
- Modern MV3 Integration: Built using Firefox Manifest V3 specifications for high-performance blocking.

## File Architecture

- manifest.json: Extension configuration and MV3 permissions.
- icons/icon.svg: Scalable vector logo.
- background.js: Core state orchestrator.
- popup.html, popup.css, popup.js: Toolbar popup panel interface.
- blocked.html, blocked.css, blocked.js: Redirected layout for blocked sites.

## How to Install and Test in Firefox

1. Open Firefox on your machine.
2. In the URL bar, type `about:debugging` and press Enter.
3. On the left-hand navigation sidebar, click on "This Firefox".
4. Under the "Temporary Extensions" header, click the "Load Temporary Add-on..." button.
5. In the file explorer popup, navigate to the directory where you cloned this repository.
6. Select the `manifest.json` file and click Open.
7. Success! FocusFlow is now loaded. You will see its icon appear in your toolbar extensions drawer.

### First-Time Setup Instructions

1. Click the FocusFlow icon in your toolbar.
2. If an alert banner appears asking for permissions, click "Grant Access".
3. Add any additional sites you want to block in the Blocklist tab.
4. Test the blocker:
   - Click the Timer tab, select 15m, and click "Start Focus".
   - Open a new tab and try to visit a blocked site.
   - You should be instantly redirected to the motivational study page with a live countdown clock.
