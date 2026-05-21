# Tixly Mobile (React Native + Expo)

Native mobile app skeleton — TM parity Fáze 4.

Aktuální stav: **skeleton**. Web PWA (`/m/ticket/[id]`) je již produkční;
tato složka slouží jako startovní bod pro skutečnou native distribuci přes
Expo EAS Build + App Store / Google Play až bude rozpočet a App Store
účty schválené.

## Co to dělá v plné verzi

- Login (passkey + email magic link)
- Seznam vstupenek (offline cache)
- Fullscreen QR view s rotujícím barcode
- Push notifikace (APNs + FCM přes `identity.native_push_tokens`)
- Apple Wallet / Google Wallet add buttons
- NFC tap-to-scan (pro Promoter app v budoucnu)

## Setup (až přijde čas)

```bash
cd mobile
npx create-expo-app . --template default
npm install
npx expo prebuild
npm run ios       # nebo android
```

## EAS Build (production)

```bash
npm install -g eas-cli
eas login
eas build:configure
eas build --platform all
eas submit
```

## Endpoints (existují v hlavní app)

- `GET /api/buyer/my-tickets` — seznam vstupenek
- `GET /api/buyer/tickets/:id/qr-image` — rotující QR
- `GET /api/buyer/tickets/:id/wallet/apple` — .pkpass download
- `GET /api/buyer/tickets/:id/wallet/google` — Google Wallet save URL
- `POST /api/buyer/tickets/:id/transfer-invite` — P2P transfer pozvánka
- `POST /api/buyer/passkeys/register` — passkey enrollment
- `POST /api/buyer/passkeys/authenticate` — passkey login

## Architektura

```
mobile/
├── App.tsx              # Root, NavigationContainer
├── app.json             # Expo config (bundle ID, icon, splash)
├── eas.json             # EAS Build profiles (dev/preview/production)
├── src/
│   ├── api/             # fetch wrappers proti backendu
│   ├── screens/         # Login, TicketList, TicketDetail
│   ├── components/      # QrCard, WalletButtons, TransferSheet
│   └── lib/             # passkey native bindings, push tokens
└── assets/              # icons, splash images
```

Web `/m/ticket/[id]` route je production-ready alternativa pro 95 % use cases
bez nutnosti App Store schválení.
