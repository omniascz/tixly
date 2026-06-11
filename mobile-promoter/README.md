# Tixly Promotér — appka pro obsluhu (React Native + Expo)

Nativní appka pro **promotéry / produkční personál** (iOS + Android z jedné
kódové základny). Bundle ID: `cz.tixly.promoter`. App Store + Google Play.

## Stav (Fáze 1 — funkční jádro)

Hotovo a typově ověřeno (`tsc` exit 0):

- **Přihlášení** (`app/login.tsx`) — `/api/auth/login`, ověří promotérské členství
  (`roles.promoterMemberships`); účet bez přístupu odmítne. Token v SecureStore.
- **Biometrický gate** — Face ID / otisk při otevření.
- **Skener vstupenek** (`app/scanner.tsx`) — kamera (`expo-camera`), parsuje QR
  `tixly:<id>:<code>` / tištěný `TXP1.…` / holé UUID, POST `/api/admin/scanner/validate`,
  barevný výsledek (zelená = vstup povolen, oranžová = už použito, červená = zamítnuto)
  s detailem držitele + tlačítkem „Skenovat další".

## Roadmap (další fáze — plná parita)

- Výběr brány (akce + den + zóna) pro festivaly, re-entry režim (vstup/výstup)
- Skupinové odbavení (1 QR = celá objednávka)
- POS / pokladna na místě (prodej + vystavení lístku)
- Live-ops dashboard (tržby, scan rate, obsazenost, fronta)
- Offline whitelist (sken proti staženému seznamu při výpadku sítě)
- NFC tap-to-scan, push notifikace

## Spuštění (dev)

```bash
cd mobile-promoter
npm install --legacy-peer-deps
EXPO_PUBLIC_API_BASE_URL=http://<tvoje-LAN-IP>:3000 npm run ios   # nebo android
```

> Kamera nefunguje v iOS simulátoru — testuj sken na reálném zařízení (Expo Go / dev build).

## Build / submit (EAS) — potřebuje Apple/Google účty

```bash
npm i -g eas-cli && eas login
eas build --platform all
eas submit
```

> **Před store submission:** vyměň placeholder ikony v `assets/` za skutečné brandové
> a doplň `eas.json` submit údaje (ascAppId, appleTeamId, Google service account).

## Architektura

```
mobile-promoter/
├── app/                 # expo-router routes
│   ├── _layout.tsx
│   ├── index.tsx        # boot: session + biometrie → redirect
│   ├── login.tsx        # + kontrola promotérského členství
│   └── scanner.tsx      # kamera → validate
├── lib/                 # api, session (SecureStore+Face ID), config, theme
├── app.json · eas.json · tsconfig.json
└── assets/              # placeholder ikony (vyměnit před storem)
```
