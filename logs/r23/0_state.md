# Kolo 23 — krok 0.1/0.2: výchozí stav (2026-10-16, po `git fetch --all --prune`)

| ref | hash |
|---|---|
| integrate/2026-10-04 (lokál) | 6799fb5be2416438648b2ce9d82ef16585f5f628 |
| origin/integrate/2026-10-04 | 6799fb5be2416438648b2ce9d82ef16585f5f628 (= očekávání) |
| master (lokál) | 3ab7341044449f9133ab0348089710e7f27cf7b5 (záměrně jiný, neměněn) |
| origin/master | d4b43f4f7482d7a928f19b1971619e3f7574a560 |
| fix/round18-staging-2026-10-14 (lokál = origin) | 716fe3c9a9d8b95ecc3e95939b57eb40d28729ad (= očekávání) |
| head PR #19 (`gh pr view 19`) | 03ddf755137550f29055b8c4b9cd94efff4d605a (= očekávání), OPEN, base integrate/2026-10-04, MERGEABLE, mergeStateStatus UNSTABLE (Vercel blocked) |

- Commity na integrate po 6799fb5b: `git log 6799fb5b..origin/integrate/2026-10-04` → **0**.
- Commity na origin/master po 6799fb5b: `git log 6799fb5b..origin/master` → **0** (poslední d4b43f4f, omnia, 2026-08-14 „docs: §209 …“).
- `gh repo view omniascz/tixly --json visibility` → `{"visibility":"PUBLIC"}`.
- Cizí commity: žádné.

## 0.2 git status (tixly/, větev fix/round22-qr-local-2026-10-15 @ 03ddf755)
`git status --short` → prázdné (žádné necommitnuté změny). Stash `stash@{0}: On master: pred prepnutim na integrate/2026-10-04` — nepoužit, nedotčen.
