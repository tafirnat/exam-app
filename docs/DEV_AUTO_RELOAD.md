# Developer Auto-Reload (Version Polling)

This application includes a lightweight background version checking mechanism (**Method A**) to automatically refresh test/staging environments when a new build is deployed, eliminating manual page reloads.

## 🔒 Production Safety & Scope Guard

> [!IMPORTANT]
> The auto-reload system is **strictly restricted to developer and test environments**. Regular production users will **NEVER** execute version polling or page reloads.

Auto-reload ONLY activates if **one** of the following conditions is met:
1. `localStorage.getItem('dev_auto_reload') === 'true'`
2. The URL contains query parameter `?dev=1` or `?auto_reload=1` (e.g. `https://test-site.com/?dev=1`)
3. The app is running in Vite local dev mode (`import.meta.env.DEV === true`)

## 🛠️ How It Works

1. **Build Step (`vite.config.js`)**:
   During build (`npm run build` or Vite startup), a custom plugin auto-generates `public/version.json`:
   ```json
   {
     "timestamp": 1722462900000,
     "buildTime": "2026-07-31T21:55:00.000Z"
   }
   ```
2. **Git Ignore (`.gitignore`)**:
   `public/version.json` is listed in `.gitignore` so temporary build timestamps are not committed to git repository history.

3. **Client Polling (`src/core/dev-auto-reload.js`)**:
   When active, the app polls `./version.json?t=<timestamp>` every 7 seconds. If the remote build timestamp changes compared to the page's loaded timestamp, `window.location.reload()` is triggered automatically.

## 🚀 How to Use / Toggle

- **Console Toggle**: Open browser DevTools Console and run:
  ```js
  window.toggleDevAutoReload(true);  // Enable
  window.toggleDevAutoReload(false); // Disable
  ```
- **URL Parameter**: Open test URL with `?dev=1` appended.
