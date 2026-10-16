# Kolo 24 / krok 1 — ZASTAVENO (test nejde dovést k RED/GREEN bez migrace a bez změny mimo early-guard)

Stav: kód aplikace NEZMĚNĚN (80eea362). Nový test není v `nextjs-boilerplate/tests/` — koncept je uložen jako
`logs/r24/1_test_draft.live.test.ts.txt` (aby ho nepouštěla live sada / CI). Skutečné běhy na nezměněném kódu:
`logs/r24/1_probe_draft.txt` (produkt s max_per_buyer=5) a `logs/r24/1_probe_final.txt` (produkt bez explicitního
max_per_buyer → DEFAULT 1), DB r24a od nuly z migrací (`logs/r24/1_probe2_db.txt`, FAILED_FILES=0), handlery pod tixly_app (RLS).

## Blokace 1 — `POST /api/v1/wl/orders`: WL token pod tixly_app nikdy neprojde (vyžaduje migraci)
- `src/lib/whitelabel/tenant-auth.ts:40–59` čte `platform.whitelabel_tenants` v `runWithServiceContext`.
- Tabulka má RLS a jedinou politiku `wl_tenants_admin` USING `current_setting('app.is_platform_admin', true) = 'true'`
  (`migrations/000_baseline_20260730.sql:42415–42421`; žádná pozdější migrace 001–508 ji nemění — `git grep whitelabel_tenants migrations/`).
- Ověřeno v r24a: `pg_policies` → jen `wl_tenants_admin`; `relrowsecurity=t`; `tixly_app.rolbypassrls=f`.
- Důsledek: `verifyWlToken` vrátí vždy `null` → routa vždy 401 (`v1/wl/orders/route.ts:80–86`) i s platným tokenem
  tenanta založeného testem. Skutečné hodnoty (1_probe_final.txt): wero P 401 UNAUTHORIZED, hlavičky `*`/`unknown`;
  pojistka gopay P 401; wero D 401. Body (w1)/(w4) a pojistka (w) nejdou dovést ke GREEN: early-guard má být podle
  zadání až PO ověření tokenu, takže 503 nikdy nenastane.
- Oprava by vyžadovala novou politiku (např. SELECT pro `app_is_service()`) = migrace → podle zadání STOP.
  `SET LOCAL app.is_platform_admin` / SECURITY DEFINER jsou zakázané.
- Totéž se týká všech `/api/v1/wl/*` (sdílí `verifyWlToken`) — white-label API je pod RLS nefunkční. Live test WL dosud neexistoval
  (jediná zmínka `tests/fix-r7-sales-cutoff.live.test.ts:41` = statická kontrola zdrojáku).

## Blokace 2 — `POST /api/season-passes`: každý nákup končí 500 dřív, než dojde k volbě platby (vada mimo early-guard)
- `catalog.season_pass_products.max_per_buyer` je `NOT NULL DEFAULT 1` (ověřeno v r24a, information_schema) → podmínka
  `if (product.max_per_buyer)` (`season-passes/route.ts:131`) je vždy pravdivá.
- Dotaz `route.ts:132–136` filtruje `orders.season_passes.holder_user_id`, který neexistuje (sloupec `holder_user_id` je v DB jen
  v `tickets.access_tokens`) → 42703 → ROLLBACK (`route.ts:213`) → 500 `{"error":"INTERNAL"}` (`route.ts:215`).
- Komentář `route.ts:161–168` (dfcf9e2c) holder_user_id odstranil jen z INSERTu, ne z kontroly max_per_buyer.
- Skutečné hodnoty: (s1) P wero 500 INTERNAL, klíče [error], interní text NE; (s2) objednávek 0→0, permanentek 0→0;
  (s3) D wero 500 INTERNAL, 0→0; pojistka P gopay 500, 0→0. Soupis K23 (`logs/r23/2_wero_routes.md`: „+1 objednávka a +1 permanentka“)
  na DB z migrací NEPLATÍ — záznam nevznikne, protože routa spadne už na kontrole limitu.
- Early-guard by (s1)/(s2) „zazelenal“, ale pojistka (s) („nesmí skončit 4xx/… musí dojít k volbě platby“) projít nemůže: platným tělem
  dosáhnout `createPayment` nelze, dokud se neopraví dotaz na ř. 132–136 — to je změna mimo povolený rozsah („Žádná jiná změna“).
  Navíc (s3) „D shodné v RED i GREEN“ by znamenalo zakonzervovat 500.
- Tatáž vada platí pro `season-passes/[passToken]/route.ts:124–235` (čte `holder_user_id` z orders.season_passes) — neověřeno během, jen čtení.

## Party-split — funguje a jde dovést k RED (pro příští kolo)
- (p1) P wero 500 INTERNAL; (p2) `message` = „No real payment provider configured in production (refusing mock fallback). Set PAYMENT_PROVIDER + provider credentials.“ (ven jde interní hláška);
  (p3) obsazených slotů 0→0, slotů s objednávkou 0→0, objednávek akce 0→0 (projde už v RED);
  (p4) D wero 200, klíče [amount,currency,ok,orderId,redirectUrl,slotIndex], brána /mock-wero/…, sloty 0→1, objednávky 0→1;
  pojistka P gopay 200, redirectUrl http://localhost:3998/gw/…, 0→1.

## Co musí rozhodnout vlastník
1. WL: schválit migraci s politikou čtení `platform.whitelabel_tenants` pro service kontext (bez SECURITY DEFINER), nebo potvrdit, že WL API
   se do spuštění nepoužívá (pak (w) vyřadit z kola).
2. Season-passes: povolit v kole opravu dotazu limitu (`route.ts:132–136`, holder_user_id → vazba přes `orders.orders.user_id`),
   nebo přesunout season-passes do kola abonmá.
3. Party-split lze opravit samostatně (test-draft (p) je hotový a ověřený na starém kódu).
