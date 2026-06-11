# Tixly — zákaznická appka (React Native + Expo)

Nativní appka pro **kupující** (iOS + Android z jedné kódové základny).
Bundle ID: `cz.tixly.app`. Mířeno na App Store + Google Play.

## Stav (Fáze 1 — funkční jádro)

Hotovo a typově ověřeno (`tsc` exit 0):

- **Přihlášení** (`app/login.tsx`) — e-mail/heslo proti `/api/auth/login`, token v SecureStore (Keychain/Keystore).
- **Biometrický gate** — Face ID / otisk při otevření (`lib/session.ts`).
- **Moje vstupenky** (`app/tickets/index.tsx`) — `GET /api/buyer/my-tickets`, pull-to-refresh.
- **Detail s rotujícím QR** (`app/tickets/[id].tsx`) — polluje `GET /api/buyer/tickets/:id/totp`, renderuje QR `tixly:<id>:<code>` + countdown 30 s, řeší „QR se zobrazí X min před akcí".

## Fáze 2 (hotovo, tsc 0)

- **Procházení akcí** (`app/events/index.tsx`) — `GET /api/events/featured`, cover/cena/místo.
- **Detail akce + koupit** (`app/events/[id].tsx`) — `GET /api/events/:id/ticket-types`, výběr typu+počtu, `POST /api/checkout` → otevře platební bránu v prohlížeči.

## Roadmap (další fáze — plná parita)

- Apple Wallet / Google Wallet tlačítka
- Push notifikace (APNs + FCM)
- Resale / marketplace, přenos vstupenky, sociální FOMO
- Offline cache vstupenek, passkey login
- Refresh-token-in-body z backendu (teď: access token 15 min → po vypršení re-login)

## Spuštění (dev)

```bash
cd mobile
npm install --legacy-peer-deps
# API na LAN (telefon musí dosáhnout na dev server):
EXPO_PUBLIC_API_BASE_URL=http://<tvoje-LAN-IP>:3000 npm run ios   # nebo android
```

`apiBaseUrl` default je `https://app.tixly.cz` (app.json → extra).

## Build / submit (EAS) — potřebuje Apple/Google účty

```bash
npm i -g eas-cli && eas login
eas build --platform all        # produkční build
eas submit                      # po doplnění ascAppId/appleTeamId v eas.json
```

> **Před store submission:** vyměň placeholder ikony v `assets/` za skutečné 1024×1024
> brandové (icon.png, adaptive-icon.png, splash.png) a doplň `eas.json` submit údaje.

## Architektura

```
mobile/
├── app/                 # expo-router routes
│   ├── _layout.tsx      # Stack + theming
│   ├── index.tsx        # boot: session + biometrie → redirect
│   ├── login.tsx
│   └── tickets/{index,[id]}.tsx
├── lib/                 # api (Bearer fetch), session (SecureStore+Face ID), config, theme
├── app.json · eas.json · tsconfig.json
└── assets/              # placeholder ikony (vyměnit před storem)
```
