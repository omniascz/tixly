# Kolo 18 — krok 0: ověření stavu po pauze (2026-10-15)

## Git (po `git fetch --all`)
| ref | lokálně | origin |
|---|---|---|
| integrate/2026-10-04 | ed9afdc27cabbc3e07ea433361760179b270417f | ed9afdc27cabbc3e07ea433361760179b270417f |
| master | 3ab7341044449f9133ab0348089710e7f27cf7b5 | d4b43f4f7482d7a928f19b1971619e3f7574a560 |

- Commity od NEXT_STEPS.md (ed9afdc2, 2026-10-08 14:39): `git log --all --since='2026-10-08 14:39'` → jen ed9afdc2 sám. Žádné cizí commity na integrate ani master.
- Lokální master je 139 commitů před origin/master (poslední 3ab73410 „docs(R5): INTEGRATION_REPORT.md…", 2026-10-04) — stav z kola 5, nepushuje se (zákaz), beze změny.
- `git status` v tixly/: čistý (0 necommitnutých změn).

## CI a Vercel na ed9afdc2 / PR #2
PR #2: OPEN, MERGEABLE, CLEAN, head ed9afdc2. `gh pr checks 2`: všechny pass (Install·typecheck·lint·unit, Live sada,
Build bez sítě, Dependency audit ×4, RLS verify DB z migrací, Schema drift, Gitleaks, Vercel – nextjs-boilerplate,
Vercel – tixly, Vercel Preview Comments); „RLS verify (produkce vs snapshot)" skipping (záměr). `gh run list`: CI, Schema
Drift Guard, RLS Gate, Security — success (runy 37778535*, 2026-10-08T12:40Z).

## Advisories
- `npm audit` nextjs-boilerplate: 53 (1 low, 27 moderate, 23 high, 2 critical) — `logs/r18/npm-audit-nextjs.json`.
  Proti kolu 15 (`logs/r15/3_npm_audit.json`, 57) **žádná nová advisory URL**; všechny high/critical jsou známé
  (dev nástroje vitest/tinypool, eslint, tailwind 3 → major; @sentry/nextjs 8 → 11 major; node-forge bez opravy, jen podepisování).
- GitHub Advisory DB (`logs/r18/0_ghsa_next_react.txt`): next@15.5.27, react@19.2.8, react-dom@19.2.8 — `affects` vrací 0.
  Nové advisories pro next od 2026-09-01 se týkají < 15.5.24 / < 15.5.27 nebo jen 16.x; 15.5.27 je opravená verze.
  → **Žádné nové critical/high opravitelné bez major verze.**

## Přístupy (bod 0.5)
- `C:\Users\omnia\Documents\tixly\staging.keys.env` **NEEXISTUJE** (hledáno i v Documents/Desktop/Downloads do hloubky 4,
  a v proměnných prostředí — nic).
- `git check-ignore -v`: staging.keys.env → .gitignore:105, staging.env → .gitignore:103 (ignorovány).
- Chybí všechny povinné: NEON_API_KEY, GOPAY_SANDBOX_GOID, GOPAY_SANDBOX_CLIENT_ID, GOPAY_SANDBOX_CLIENT_SECRET,
  RESEND_API_KEY, STAGING_EMAIL_ALLOWLIST, STAGING_SMOKE_EMAIL (volitelné ComGate také chybí).
- → Podle bodu 0.6 kolo končí; kroky 1–3 a závěr neproběhly.
