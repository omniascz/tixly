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
