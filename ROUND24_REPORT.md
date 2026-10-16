# Kolo 24 — Wero ve zbylých API cestách — ZASTAVENO v kroku 1 (nutná migrace / vada mimo rozsah)

## 1. Krok 0 ✅ (commit 5e751996 na `fix/round24-wero-routes-2026-10-16`)
- HEADy: integrate/2026-10-04 lokál = origin = **80eea362** (80eea36245861ca745a5c34ae9548851d8c51750); master lokál **3ab73410** (neměněn), origin/master **d4b43f4f**; fix/round18-staging-2026-10-14 **716fe3c9** (lokál = origin, beze změny).
- Viditelnost repa: `{"visibility":"PUBLIC"}`.
- Cizí commity po 80eea362 na integrate i master: **0**.
- Necommitnuté změny na startu: **žádné** (stash „pred prepnutim na integrate/2026-10-04“ nedotčen).
- Běhy na 80eea362: CI 38881430350 success, RLS Gate 38881430355 success („RLS verify (produkce)“ skipped), Security 38881430336 success, Schema Drift 38881430361 success; Vercel – nextjs-boilerplate i Vercel – tixly jen „Deployment was blocked“. PR #2 OPEN, MERGEABLE, UNSTABLE, nesloučen. (`logs/r24/0_checks.txt`)
- `staging.keys.env`: neexistuje; `git check-ignore` → `.gitignore:105` (ignorován).
- Ověření Kola 23 (`logs/r24/0_verify_r23.txt`): build 80eea362 rc=0; golden-path-r23-wero **P 1 passed**, **D 1 passed**; live `r23-wero-ticket-types` **6 passed** (DB r24a z migrací, FAILED_FILES=0, tixly_app).

## 2. Krok 1 ⛔ ZASTAVENO — oprava NEPROVEDENA, kód beze změny
Důvod (podrobně `logs/r24/1_blocked.md`): pro (w) by byla nutná **migrace** (zadání: „zastav se a vypiš proč“) a (s) nejde dovést k pojistce bez změny kódu mimo early-guard.

- **(w) `/api/v1/wl/orders`** — `platform.whitelabel_tenants` má pod RLS jedinou politiku `wl_tenants_admin` (`current_setting('app.is_platform_admin')='true'`, `migrations/000_baseline_20260730.sql:42415–42421`, žádná migrace 001–508 ji nemění; ověřeno v r24a přes pg_policies, `tixly_app.rolbypassrls=f`). `verifyWlToken` (`src/lib/whitelabel/tenant-auth.ts:40–59`, service kontext) proto pod tixly_app vrací vždy null → routa vrací vždy **401**, i s platným tokenem tenanta. Early-guard má být podle zadání až po ověření tokenu → 503 nikdy nenastane. Oprava = nová RLS politika = migrace. Týká se celého `/api/v1/wl/*`.
- **(s) `/api/season-passes`** — `catalog.season_pass_products.max_per_buyer` je `NOT NULL DEFAULT 1` → `if (product.max_per_buyer)` (`route.ts:131`) vždy pravda → dotaz na neexistující `orders.season_passes.holder_user_id` (`route.ts:132–136`) → 42703 → ROLLBACK → **500 INTERNAL** pro KAŽDÝ nákup (i gopay), dřív než vznikne záznam. Soupis K23 („+1 objednávka, +1 permanentka“) na DB z migrací neplatí. Pojistka (s) nemůže dojít k volbě platby bez opravy tohoto dotazu, což je mimo povolený rozsah („žádná jiná změna“).
- **(p) party-split** — funguje, RED doměřen; lze opravit samostatně.

| bod | RED (skutečné, starý kód 80eea362, `logs/r24/1_probe_final.txt`) | GREEN | commit |
|---|---|---|---|
| s1 | 500 `error=INTERNAL`, klíče [error], bez `provider` | neproveden | — |
| s2 | objednávek 0→0, permanentek 0→0 (routa spadne na ř. 132 před INSERTem) | neproveden | — |
| s3 | D: 500 INTERNAL, 0→0 | neproveden | — |
| p1 | 500 `error=INTERNAL`, bez `provider` | neproveden | — |
| p2 | `message` = „No real payment provider configured in production (refusing mock fallback). Set PAYMENT_PROVIDER + provider credentials.“ (interní text JDE ven) | neproveden | — |
| p3 | obsazených slotů 0→0, slotů s objednávkou 0→0, objednávek akce 0→0 (prošlo už v RED) | neproveden | — |
| p4 | D: 200, klíče [amount,currency,ok,orderId,redirectUrl,slotIndex], brána /mock-wero/…, sloty 0→1, objednávky 0→1 | neproveden | — |
| w1 | 401 UNAUTHORIZED (platný WL token neprojde RLS) | nedosažitelné bez migrace | — |
| w2 | interní text ne (401 dřív) | — | — |
| w3 | objednávek 0→0 | — | — |
| w4 | hlavičky `Access-Control-Allow-Origin: *`, `X-Tixly-Tenant: unknown` (tenant nerozpoznán) | — | — |
| w5 | D: 401 UNAUTHORIZED, 0→0 | — | — |
| pojistky | (s) gopay **500** — nedosáhne volby platby; (p) gopay **200**, redirect http://localhost:3998/gw/…, 0→1 ✅; (w) gopay **401** — nedosáhne volby platby | — | — |

Změna tří souborů: **žádná** (nic se neměnilo). Nový text hlášky (plánovaný, nenasazen): `Platba Wero není momentálně dostupná. Zvolte prosím jinou metodu.`
Test-draft (všechny body výše, ověřený během na starém kódu) je uložen mimo testy jako `logs/r24/1_test_draft.live.test.ts.txt`.

## 3. Krok 2 — neproveden
Zastaveno v kroku 1 (pokyn „zastav se … nic dalšího nedělej“). Dosažitelnost build-pass, chování po odeslání a cesta k placené hodnotě bez platby nebyly zkoumány.

## 4. Kompletní sada, CI, PR — neprovedeno
Žádná sada, žádný PR do integrate, žádné sloučení. Na integrate se nic nezměnilo: HEAD **80eea362**. PR #2 OPEN, nesloučen (stav z kroku 0). Vercel nekontaktován, nic neměněno. Na větvi `fix/round24-wero-routes-2026-10-16` jen commity s logy/dokumentací (krok 0 + tento zápis).

## 5. Co nebylo ověřeno a proč
- Kroky 1.3–1.4 (oprava, GREEN), krok 2 a závěr: zastaveno podle zadání (nutná migrace pro WL; season-passes rozbitý mimo rozsah).
- Chování produkce: na produkci se nepřipojuji — není ověřeno, zda prod má na `whitelabel_tenants` jinou politiku než baseline, ani zda prod `season_pass_products.max_per_buyer` má stejné NOT NULL DEFAULT 1 (vše ověřeno jen na DB od nuly z migrací).
- `season-passes/[passToken]/route.ts:124–235` také čte `holder_user_id` z `orders.season_passes` — jen čtením kódu, neověřeno během.

## Co musí vlastník rozhodnout (krok po kroku)
1. **WL API:** schválit migraci s RLS politikou čtení `platform.whitelabel_tenants` pro service kontext (`app_is_service()`, bez SECURITY DEFINER), nebo rozhodnout, že WL API se do spuštění nepoužívá a bod (w) z kola vypustit.
2. **Season-passes:** povolit v kole opravu dotazu limitu `season-passes/route.ts:132–136` (holder_user_id → vazba přes `orders.orders.user_id`, a obdobně `[passToken]/route.ts`), nebo přesunout season-passes do kola abonmá.
3. **Party-split:** lze opravit hned samostatně (draft testu (p) hotový).
Po rozhodnutí: nová session přečte `PROGRESS_R24.md` a pokračuje krokem 1 (draft testu vrátit do `nextjs-boilerplate/tests/r24-wero-routes.live.test.ts`, doplnit W5 konstanty, commit RED).
