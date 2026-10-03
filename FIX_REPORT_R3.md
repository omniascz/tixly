# FIX_REPORT_R3 — kolo 3 oprav Tixly

Větev `fix/round3-2026-10-03` (worktree `../tixly-fix`), základ `fix/round2-2026-10-01` @ `080b24a`.
Prostředí: izolovaná DB z migrací (`fix-pg` :55632, template `tixly_zero` = migrace od nuly),
PgBouncer transaction mode :56633, fake-gopay :3998, Mailpit, Redis. Aplikace i testy pod `tixly_app`.
Žádné připojení k produkční DB ani službám. `tixly/` neměněno.
Průběh krok za krokem: `PROGRESS_R3.md`. Výstupy: `logs/r3/`.

---

## Krok 0 — závěrečné ověření kola 2 (`logs/r3/0_*`)

**Regrese kola 2 nalezena a opravena jako první:** audit 05 — C1a/C1b/C2a/C2c FAIL, 98/100 souběžných
checkoutů 500 (`timeout exceeded when trying to connect`, 173× v logu aplikace). Příčina: oprava R-56
(8713d13) sloučila `connect()` a `query()` do jednoho poolu; routy drží klienta z `connect()` v transakci
a uvnitř volají `db().query()` → pod souběhem deadlock poolu. Oprava `91a1316`, test
`fix-r3-pool-nested` RED 12/12 timeout → GREEN.

Dvě vady auditních skriptů (`2d80acc`): 03 V12 četl neexistující sloupec `result` (je `scan_result`),
05 C2c počítal e-maily předchozích běhů (sdílený prefix).

| Skript | PASS | FAIL | FAIL (očekávané — řeší kroky 2–5) |
|---|---|---|---|
| 01 | 26 | 0 | |
| 02 | 36 | 0 | |
| 03 | 21 | 3 | R5, R6, V9b |
| 04 | 13 | 1 | X6 |
| 05 | 8 | 0 | |
| 06 | 17 | 4 | K3a, K4d, K5, K8a |
| 09 | 12 | 0 | |
| 10 | 7 | 0 | |
| 11 | 8 | 0 | |
| 12 | 5 | 0 | |
| **Σ** | **153** | **8** | všech 8 je v seznamu FAIL po 3B; jiné FAIL = 0 |

P1, P5d, C2b, P13, V12, D3a **PASS**; C1a (100 nákupů na 10 míst), C2a (idempotence) **PASS**.
Live sada 94 passed / 0 failed (+87 skip Neon).

---

## Nálezy kroků 1–5

| Nález | Příčina | Oprava | Test | RED → GREEN | Commit |
|---|---|---|---|---|---|
| Krok 0: deadlock poolu (regrese kola 2) | R-56 sloučil pooly, vnořené výpůjčky | `connect()` opět vlastní pool | fix-r3-pool-nested | 12/12 timeout → 0 | 91a1316 |
| Krok 1: kolize migrace 472 | kolo 1 `472_refund_gateway_state` vs necommitnutá 472 v tixly/ | přejmenováno na 479; od nuly 32/32, 2× nad stávajícím exit 0 | fix-r3-migration-numbers | 472 → 2/2 | e78c5cc |
| R5 webhook REFUNDED | webhook jen přepsal status; vstupenky valid, kapacita nevrácena; PARTIALLY → celé refunded | `executeOrderRefund` režim `gatewayRefundedExternally` (bez brány), idempotentní | fix-r3-r5-webhook-refunded | 3 fail → 3/3 | f800b76 |
| R6 platba po expiraci | webhook PAID na expired neudělal nic | `reacquire-capacity` (vše nebo nic) → paid + vstupenky; jinak auto-refund + e-mail | fix-r3-r6-paid-after-expiry | 3 fail → 3/3 (vč. souběhu o 1 kus) | d58c3ef |
| mobile/payment-intent rate limit | K3 jen v checkoutu | sdílený `enforceOrderCreationLimits` (IP + pending per kupec) | fix-r3-mobile-rate-limit | 3 fail → 3/3 | b275ecf |
| /api/mobile/* bez identity (nový) | prefix chyběl v middleware → vždy 401 | do `API_OPTIONAL_AUTH_PREFIXES` | fix-r3-mobile-auth | 401 → 3/3 | 799bfa0 |
| /api/my/* bez identity (nový) | totéž; upgrade kupce nefungoval | totéž | fix-r3-my-auth | 401 → zelené | b110d66 |
| Guard stavu objednávky/vstupenky | RLS hlídá řádky, ne sloupce | migrace 486 BEFORE UPDATE triggery (orders, tickets, order_items) + legitimní cesty kupce přes `asSystemInTx` | fix-r3-guard-trigger (23 kontrol) | 12 fail (bez triggeru), 6 fail (bez úprav rout) → 23/23 | b1c9b72 |
| X7 číslo faktury | UNIQUE(invoice_number) globálně, generátor per pořadatel | migrace 487 UNIQUE(promoter_id, invoice_number) | fix-r3-x7-invoice-number | 2 fail → 2/2 | 055b631 |
| Krok 3: 54 eskalací | `SET LOCAL app.is_platform_admin` pro kupce/anonyma/pořadatele | 29 odstraněno, 9 zúženo (`asSystemInTx`), 1 `asUserInTx`, 3 duplicity, 10 ponecháno za `requirePlatformAdmin`; tabulka `ESKALACE_R3.md` | fix-r3-escalations (17) | 8 fail → 17/17 | db3bffe |
| K4d refresh jako access | tokeny bez typu | claim `type`, kontrola na obou stranách (middleware, platform-auth, server-session, me, oauth, refresh) | fix-r3-k4d-token-type | 4 fail → 7/7 | 1e5c3da |
| K3a cron bez CRON_SECRET | recompute + refresh-spotify bez autorizace; 2 fail-open | `cron-auth` / fail-closed interní token; výpis 37 rout `logs/r3/4_k3a_cron_routes_after.txt` | fix-r3-k3a-cron-auth | 5 fail → 6/6 | 9fdd575 |
| K5 CSRF | jen SameSite=Lax | Origin/Referer v middleware pro cookie-auth stavové požadavky; výjimky webhooky, cron, OAuth callback, platný Bearer | fix-r3-k5-csrf | 5 fail → 9/9 | bc5db9a |
| K8a (S9) neplatné ID akce | volná kontrola UUID, 200 [] | přesný tvar UUID → 400 | fix-r3-k8a-invalid-id | 2 fail → 3/3 | 2043fbb |
| V9b sken jiné akce | validate bez eventId | `eventId` → 409 `wrong_event`, vstupenka zůstane valid; web, offline fronta, mobil posílají akci | fix-r3-v9b-wrong-event | 4 fail → 4/4 | 7f56371 |
| Tisk prodejce | stránka bez kontextu a bez ověření prodejce; token kupce platil jako prodejce | API `reseller/orders/[id]/tickets` pod `requireReseller` + `partner_id`; token `type=reseller` | fix-r3-reseller-print | → 6/6 | cae14fe |
| admin/import | 42501 na `identity.users` ON CONFLICT DO UPDATE + 23502 NOT NULL | uživatel systémově bez přepisu, kontakty v kontextu pořadatele, COALESCE | fix-r3-admin-import | 2 fail → 2/2 | 6510989 |
| X6 GET /api/buyer/orders | routu nic nevolá (web používá `/api/buyer/my-tickets`) | neimplementováno dle zadání; audit 04 X6 kontroluje skutečný seznam | audit 04 X6 | FAIL → PASS | 2f789ee |
| Regrese z R6 (závěr) | webhook držel klienta po COMMITu a čekal na in-process refund → vyčerpání poolu | `releaseClient()` hned po COMMITu | fix-r3-webhook-pool | 2 fail → 2/2 | 60993ee |

---

## Finální sady (2. běh na čisté DB, `logs/r3/Z2_*`)

| Sada | Výsledek |
|---|---|
| typecheck | 1 chyba — známá `.next/types/app/api/rfid/scan/route.ts` (mimo rozsah) |
| unit | 513 passed / 0 failed / 4 skipped |
| live (`FIX_E2E=1`, PgBouncer, max 2 workery) | 190 passed / 0 failed / 87 skipped (Neon) |
| audit 01 | 26 / 0 |
| audit 02 | 36 / 0 |
| audit 03 | 23 / 0 |
| audit 04 | 14 / 0 |
| audit 05 | 8 / 0 |
| audit 06 | 21 / 0 |
| audit 07 | 6 / 0 (3 INFO) |
| audit 07b | anonymní zápisy do publikované akce: 0 řádků ve všech 5 pokusech |
| audit 08 | 0 / **2** — I1 (S2: `buyer/tickets/[ticketId]/upgrade` vrací stav vstupenky cizímu/anonymovi), I2 (5xx: `buyer/orders/[orderId]/calendar.ics` anonym, `public/events/[id]/kiosk`) — **shodné s původním auditem** (`tixly-audit/audit/logs/e2e_08_idor_findings.json`), mimo zadání kola 3, ne regrese |
| audit 09 | 12 / 0 |
| audit 10 | 7 / 0 |
| audit 11 | 8 / 0 |
| audit 12 | 5 / 0 |

Vizuální kontrola (CDP screenshoty `logs/r3/Z_ui_*.png`): skener u brány akce A2 se vstupenkou akce A →
„Lístek na jinou akci", vstupenka zůstala `valid`; tisk prodejce vykreslí vstupenku vlastní objednávky,
cizí objednávka → „Objednávka nenalezena".

---

## Co se opravit nepodařilo / zůstává otevřené

1. **Nová kolize čísla 479.** Krok 1 zvolil 479 jako volné číslo; v `tixly/` mezitím vznikla necommitnutá
   `479_royalty_policies_guc_drift.sql` (oprava R-58 pro `lineups.royalty_*`, 2026-10-03). Ve větvi nejde
   řešit: mezi 471 a 480 není volné číslo a 486 závisí na sloupcích z refund migrace, takže ji nejde
   posunout za 486. `tixly/` se v tomto kole měnit nesmí. **Doporučení:** při slučování přečíslovat
   `tixly/479_royalty_policies_guc_drift.sql` na 488 — nic na ní nezávisí.
2. **S2 + dvě 5xx routy z IDOR sweepu (audit 08)** — předexistující, nebyly v zadání.
3. **25 dalších rout bez identity** (prefix chybí v middleware; stejná vada jako /api/mobile, /api/my) —
   `logs/r3/2_unlisted_auth_routes.txt`, mimo zadání.
4. **Nálezy mimo zadání, neopraveno:** cron seat-upgrade-notify čte neexistující sloupce;
   `seat_upgrades` UPDATE/INSERT politika `true`, `postal_deliveries`/`travel_bookings` INSERT `true`;
   `group-invitations/[token]` veřejně vrací e-mail organizátora; `subscriptions.holders.restwert_credit_halire`
   měnitelné kupcem; výměna mění `event_id` celé objednávky; free upgrade nemění kapacitu typů;
   `my/orders/[id]/upgrade-options` → `catalog.seat_maps` neexistuje (500); mobilní appka volá
   neexistující `/api/v1/buyer/orders`; QR na vstupence tištěné prodejcem je pseudo-matice, skener ji nepřečte.
5. **mobile-promoter** — ve worktree bez `node_modules`, typová kontrola appky neproběhla.
6. Překlep ve zprávě commitu 9fdd575 (4/31 místo 6/29); správně: 6× CRON_SECRET, 2× helper, 29× inline fail-closed = 37.

---

## Překryv s necommitnutými změnami v `tixly/`

V `tixly/` je dnes **110** necommitnutých položek (zadání počítalo s 92; zbytek přibyl 2026-10-03 —
vrstva booking/vyúčtování). Soubory změněné v kole 3 i v `tixly/`:

- `nextjs-boilerplate/src/app/admin/scanner/page.tsx`
- `nextjs-boilerplate/src/app/api/internal/order-completed/route.ts`
- `nextjs-boilerplate/src/middleware.ts`

Plus **kolize čísla migrace 479** (bod 1 výše).
