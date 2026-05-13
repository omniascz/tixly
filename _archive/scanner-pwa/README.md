# Scanner PWA

Offline-capable Progressive Web App for Tixly ticket scanning.

Ports the validation/sync/TOTP logic from the `mobile-scanner` React Native app
to a web platform so staff can install and use it from any modern mobile
browser ("Add to Home Screen") without the native app store.

## Features

- Camera-based QR scanning via `MediaDevices.getUserMedia` + `jsQR`
- 15-minute background sync of the event ticket index
- Fully offline operation — scans are queued in IndexedDB and flushed on reconnect
- Multi-scan detection with red visual + haptic alert ("JIŽ SKENOVÁNO!")
- Installable PWA (web manifest + service worker)
- TOTP verification using the Web Crypto API (HMAC-SHA1, 8 digits, ±1 window)

## Development

```
npm install
npm run dev     # http://localhost:3010
npm run test
npm run typecheck
```

## Structure

- `src/lib/totp.ts` — RFC 6238 TOTP verification (Web Crypto)
- `src/lib/qr-payload.ts` — QR payload parser with Zod validation
- `src/lib/offline-cache.ts` — IndexedDB cache wrapper via `idb`
- `src/lib/sync.service.ts` — 15-min sync cycle + pending-scan flush
- `src/lib/validator.ts` — pure scan validation logic
- `src/stores/scanner.store.ts` — Zustand UI state
- `src/app/scanner/page.tsx` — live scanner view
- `public/sw.js` — service worker (cache-first + offline fallback)
- `public/manifest.webmanifest` — web app manifest

## NOTE

The PNG icons referenced in `public/manifest.webmanifest`
(`/icons/icon-192.png`, `/icons/icon-512.png`) are not yet committed.
Add them under `public/icons/` before shipping — otherwise the install
prompt on iOS / Android will fail to pick up the home-screen icon.
