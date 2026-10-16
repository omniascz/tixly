# Kolo 22 — krok 0: výchozí stav (2026-10-15)

`git fetch origin` proveden.

| ref | lokálně | origin |
|---|---|---|
| integrate/2026-10-04 | 6799fb5be2416438648b2ce9d82ef16585f5f628 | 6799fb5be2416438648b2ce9d82ef16585f5f628 |
| master | 3ab7341044449f9133ab0348089710e7f27cf7b5 (záměrně jiný, neměněn) | d4b43f4f7482d7a928f19b1971619e3f7574a560 |
| fix/round18-staging-2026-10-14 | 716fe3c9a9d8b95ecc3e95939b57eb40d28729ad | 716fe3c9a9d8b95ecc3e95939b57eb40d28729ad (= očekáváno) |

- Commity po 6799fb5b: `git log 6799fb5b..origin/integrate/2026-10-04` prázdný; origin/master posledně d4b43f4f
  (2026-08-14), lokální master 3ab73410 (2026-10-04) — nic nového. **Cizí commity: žádné.**
- `gh repo view omniascz/tixly --json visibility` → `{"visibility":"PUBLIC"}` (= očekáváno).
- `git status --short` v tixly/: prázdný — **žádné necommitnuté změny** (nic v TwoFactorSettings.tsx, gift/[token]/page.tsx,
  package*.json).
- Stash `pred prepnutim na integrate/2026-10-04` a worktree (`../tixly-fix`, `.claude/worktrees/*`) existují, nepoužity, nezměněny.
- 0.3 rerun: `0_ci_rerun.txt` — CI 38746784038, Security 38746784127, RLS Gate 38746784318, Schema Drift Guard 38746784037
  (attempt 2) **success**, joby skutečně běžely (kroky 5–14, 12 s – 3 min 8 s).
- 0.4 Vercel: `0_vercel.txt` — na 6799fb5b žádné nasazení / status Vercel (projekty pozastaveny vlastníkem).
- 0.5 PR #2: `0_pr2_checks.txt` — OPEN, MERGEABLE, CLEAN; vše pass, RLS verify (produkce) skipping (záměrně), Vercel chybí.
- 0.6 `staging.keys.env`: **neexistuje**; `git check-ignore -v` → `.gitignore:105:staging.keys.env` (pravidlo platí).
- 0.7 Ověření Kola 21: `0_verify_r21.txt` — unit 28 passed (3 soubory), golden-path-r21-sentry-url-tokens 1 passed.
- Volná RAM při startu ~1,4 GB z 16 GB (sdíleno s jinými procesy) — jeden těžký blok naráz.
