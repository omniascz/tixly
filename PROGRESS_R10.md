# PROGRESS — kolo 10 (poslední opravy před stagingem)

Větev `fix/round10-2026-10-04` z `5fa51c02` (PR #6). Výstupy `logs/r10/`.

## Krok 1 — Vercel build `nextjs-boilerplate`
- Nastavení z repa: `nextjs-boilerplate/vercel.json` (framework nextjs, `npm ci`, `npm run build` = prebuild copy-pdf-worker + `next build`),
  bez `engines`/`.nvmrc` → Vercel default Node 24 (lokálně v24.14.1).
- Historie statusů na master: první `failure` 6d661fb3 (2026-08-13), d4b43f4f (2026-08-14); starší commity status nemají
  (`logs/r10/1_vercel_status_history.txt`). Tentýž den 798bbea6 přesměroval `db().connect()` na přímý (odvozený) endpoint.
- Reprodukce: čistý klon, `npm ci` OK, `next build` s prázdnými proměnnými z `.env.example`, bez `.env*` →
  **exit 1: „Error occurred prerendering page /api/postal-fees"** (`logs/r10/1_build_clean_node24.txt`).
  Příčina: GET() bez request se při buildu prerenderuje a `db().connect()` mimo try spadne. Stejný vzor (bez pádu, ale zapečený stav
  z buildu) u `/api/health/db` a `/api/public/incidents`.
- Oprava 07e68c63: `export const dynamic = 'force-dynamic'` + test `tests/fix-r10-build-static-db-routes.test.ts` RED (3) → GREEN.
  Čistý build po opravě **exit 0** (`logs/r10/1_build_clean_node24_after.txt`).
- Zda je to přesně příčina na Vercelu: ověří status „Vercel – nextjs-boilerplate" na PR (logy Vercelu nečtu — produkční služba).

## Krok 2 — neověřené běhy z kola 9 (DB r10a od nuly z migrací, 0 chyb)
- Live sada se simulátorem GoPay přes PgBouncer: **81/81 souborů** (21 skip jen Neon) — refundy `fix-k2-refund` 5/5,
  `fix-k3-capacity` 5/5, `fix-r3-escalations` 17/17, `fix-r6-bulk-refund-gateway`, `webhook-refunded` zelené (`2_live_suite_r10a.txt`).
- Audity proti serveru (:3200) + simulátor: 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · **05 7/1** · 06 21/0 · 07 6/0 · 07b · 08 0 úniků ·
  09 12/0 · 10 7/0 · 11 8/0 · **12 5/0** (oprava kapacity z kola 9 drží; samostatně po 01 padá jen příprava — akci publikuje 02).
- **Turné (Playwright) 10/10** (`2_tour.txt`, screenshoty `logs/r10/tour/`, vizuálně zkontrolováno).
- Audit 05 C2c = skutečná vada: duplicitní potvrzovací e-mail při opakovaném dokončení → oprava e3e18aa2
  (test RED 2/3 e-maily → GREEN; live sada 82/82, unit 660, tsc 0, lint bez nárůstu). Audit 05 znovu proti serveru: viz níže.
