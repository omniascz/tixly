# Kolo 19 — krok 0: výchozí stav (2026-10-15)

`git fetch --all` proveden.

| ref | lokálně | origin |
|---|---|---|
| integrate/2026-10-04 | ed9afdc27cabbc3e07ea433361760179b270417f | ed9afdc27cabbc3e07ea433361760179b270417f |
| master | 3ab7341044449f9133ab0348089710e7f27cf7b5 (o 139 commitů napřed před origin, nepushnuto záměrně) | d4b43f4f7482d7a928f19b1971619e3f7574a560 (14. 8. 2026) |
| fix/round18-staging-2026-10-14 | 716fe3c9a9d8b95ecc3e95939b57eb40d28729ad | 716fe3c9a9d8b95ecc3e95939b57eb40d28729ad |

- Commity po ed9afdc2: na integrate/2026-10-04 **žádné**; na origin/master **žádné** (`git log ed9afdc2..origin/master` prázdné,
  poslední commit origin/master je z 14. 8.). Cizí commity: žádné.
- `git status` (tixly/, na fix/round18 před přepnutím): čistý, žádné necommitnuté změny.
- Větev kola 19 `fix/round19-sentry11-2026-10-15` založena z origin/integrate/2026-10-04 (ed9afdc2). fix/round18 beze změny.
- PR #2: OPEN, MERGEABLE, CLEAN, head ed9afdc2. `gh pr checks 2`: Install·typecheck·lint·unit pass, Live sada pass,
  Build bez sítě pass, Dependency audit ×4 pass, RLS verify (DB z migrací) pass, Schema drift pass, Gitleaks pass,
  Vercel – nextjs-boilerplate pass, Vercel – tixly pass; „RLS verify (produkce vs snapshot)" skipping (záměrně na PR).
- `gh run list --branch integrate/2026-10-04`: CI, Schema Drift Guard, RLS Gate, Security na ed9afdc2 = success.
- `staging.keys.env`: **neexistuje** (`git check-ignore -v` → `.gitignore:105:staging.keys.env`, pravidlo platí).
- Lokální služby: fix-pg, fix-redis, fix-mail byly zastavené (Exited 5 dní) → spuštěny touto session (`docker start`);
  fix-pgb zastaven. Node v24.14.1, npm 11.11.0, nainstalovaný @sentry/nextjs 8.55.2, next 15.5.27.
- Volná RAM při startu: 964 MB z 16 092 MB (souběžná práce jiného vykonavatele).
