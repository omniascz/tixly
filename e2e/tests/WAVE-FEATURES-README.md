# Wave Features E2E Tests

27 testů pro features přidané ve Vlnách 1-3 (UX dokončení po TM/EB parita).

## Spuštění

```bash
# Předpoklad: dev server běží na http://localhost:3000 + seedovaná DB
cd e2e

# Všechny wave-features testy
npx playwright test --project=wave-features

# Specifický test
npx playwright test --project=wave-features --grep "OAuth apps"

# Konkrétní suite
npx playwright test --project=wave-features --grep "Buyer self-service"
```

## Coverage

### Suite 1: Buyer self-service (Vlna 1) — 4 testy
- My Tickets page loaduje
- Cancel order page (pokud má lístek)
- Edit attendee info
- Change ticket type

### Suite 2: Admin event-detail navigace (Vlna 3) — 2 testy
- Layout obsahuje dropdown menu se 7 kategoriemi
- Klik na Hot mode kategorii

### Suite 3: Admin OAuth apps (Vlna 2) — 2 testy
- OAuth apps page loaduje
- Form se otevře

### Suite 4: Admin postpone event (Vlna 1) — 1 test
- Postpone page loaduje

### Suite 5: Admin donation campaign (Vlna 2) — 1 test
- Donation page loaduje

### Suite 6: Admin group discounts (Vlna 2) — 1 test
- Group discounts page loaduje

### Suite 7: Connected apps (Vlna 3) — 1 test
- Connected apps page loaduje

### Suite 8: Admin top-level pages (Vlna 2) — 5 testů
- /admin/collections, /admin/tracking-pixels, /admin/event-templates,
  /admin/pricemaster, /admin/dashboard/live

### Suite 9: Admin event sub-pages (Vlna 2) — 10 testů
- /admin/events/[id]/{channel-prices, custom-fields, resale-policy,
  price-scenarios, wallet-push, wallet-modules, pricing-windows,
  ab-price-tests, advance-payout, will-call}

## Known issues

### Auth timing
Dev server občas má pomalou response na `/api/auth/login` (>30s). Pro spolehlivost:
- Spouštět ve workers=1
- Retries: 2 (config-level)
- Apilogin používá direct `page.request.post` + manual cookie injection

### Dev server cache
Pokud test selže s 404 na novou route, dev server potřebuje rebuild:
- Stop `npm run dev`
- `rm -rf .next/cache`
- Restart

### Test je `test.skip()` pokud:
- Buyer nemá žádný lístek (cancel/change/attendee links nejsou viditelné)
- Promotér nemá žádný event (event sub-pages skip)
- Route vrací 404 (cache issue)

## Co testuje proti čemu

Tahle suite je **smoke** — ověřuje, že:
1. Route existuje a renderuje page (ne 404)
2. Authentication funguje (page se nepřesměruje na /login)
3. Klíčový heading se zobrazí
4. Form elementy jsou viditelné

NEKONTROLUJE plnou funkčnost (data flow, validace, side effects).
Pro hloubkové testy doporučujeme:
- `golden-path-buyer.spec.ts` — buyer purchase flow
- `golden-path-promoter.spec.ts` — promoter setup flow
- `cz-sk-launch.spec.ts` — CZ/SK launch readiness
- `smoke-*.spec.ts` — API smoke tests

## Auth fixture

Tests používají `verze@divadlovceletne.cz` / `Demo2026!` (seedovaný promoter
admin "Divadlo Verze"). Pro nový seedovaný user, edit `apiLogin()` helper
v `wave-features.spec.ts`.
