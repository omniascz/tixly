# Kolo 24 — krok 0: výchozí stav (2026-10-16, po `git fetch --all`)

| ref | hash |
|---|---|
| integrate/2026-10-04 (lokál) | 80eea36245861ca745a5c34ae9548851d8c51750 |
| origin/integrate/2026-10-04 | 80eea36245861ca745a5c34ae9548851d8c51750 (= očekávání) |
| master (lokál) | 3ab7341044449f9133ab0348089710e7f27cf7b5 (záměrně jiný, neměněn) |
| origin/master | d4b43f4f7482d7a928f19b1971619e3f7574a560 |
| fix/round18-staging-2026-10-14 (lokál = origin) | 716fe3c9a9d8b95ecc3e95939b57eb40d28729ad (= očekávání; omnia „docs(R18-0): krok 0 …") |

- Commity na integrate po 80eea362: `git log 80eea362..origin/integrate/2026-10-04` → **0**.
- Commity na origin/master po 80eea362: `git log 80eea362..origin/master` → **0**.
- `gh repo view omniascz/tixly --json visibility` → `{"visibility":"PUBLIC"}`.
- Cizí commity: žádné.

## 0.2 git status (tixly/, integrate/2026-10-04 @ 80eea362)
`git status --porcelain` → prázdné (žádné necommitnuté změny). Stash „pred prepnutim na integrate/2026-10-04" nepoužit, nedotčen.

## 0.3 běhy na 80eea362 a PR #2 (`0_checks.txt`)
CI 38881430350 success (Install·typecheck·lint·unit, Live sada, Build bez sítě), RLS Gate 38881430355 success (DB z migrací pass;
„RLS verify (produkce)" skipped), Security 38881430336 success (Gitleaks + Dependency audit ×4), Schema Drift 38881430361 success.
Commit statusy Vercel – nextjs-boilerplate a Vercel – tixly: failure „Deployment was blocked" (očekávané, varianta A).
PR #2: OPEN, MERGEABLE, mergeStateStatus UNSTABLE, head 80eea362. Kritérium splněno.

## 0.4 staging.keys.env
`ls staging.keys.env` → neexistuje; `git check-ignore -v` → `.gitignore:105:staging.keys.env` (ignorován). Staging se v kole nedělá.

## Větev kola
`fix/round24-wero-routes-2026-10-16` z origin/integrate/2026-10-04 (80eea362).
