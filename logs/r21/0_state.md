# Kolo 21 — krok 0: výchozí stav (2026-10-15)

`git fetch --all` proveden.

| ref | lokálně | origin |
|---|---|---|
| integrate/2026-10-04 | 9b2e17e7536815f97797f4aff9976488dcfe353e | 9b2e17e7536815f97797f4aff9976488dcfe353e |
| master | 3ab7341044449f9133ab0348089710e7f27cf7b5 (záměrně jiný, neměněn) | d4b43f4f7482d7a928f19b1971619e3f7574a560 |
| fix/round18-staging-2026-10-14 | 716fe3c9a9d8b95ecc3e95939b57eb40d28729ad | 716fe3c9a9d8b95ecc3e95939b57eb40d28729ad (= očekáváno) |

- Commity po 9b2e17e7: `git log 9b2e17e7..origin/integrate/2026-10-04`, `9b2e17e7..origin/master`, `9b2e17e7..master` —
  všechny prázdné. **Cizí commity: žádné.**
- `git status --short` v tixly/: prázdný — **žádné necommitnuté změny** (nic v scrub-pii.ts, sentry.*.config.ts,
  next.config.mjs, package*.json).
- Stash `pred prepnutim na integrate/2026-10-04` a worktree (`../tixly-fix`, `../tixly-audit`, `.claude/worktrees/*`)
  existují, nepoužity, nezměněny.
- PR #2: OPEN, MERGEABLE, mergeStateStatus CLEAN, head 9b2e17e7. `gh pr checks 2`: Build bez sítě pass, Dependency audit ×4
  pass, Install·typecheck·lint·unit pass, Live sada pass, RLS verify (DB z migrací vs snapshot) pass, Schema drift pass,
  Secret scan (Gitleaks) pass, Vercel Preview Comments pass, Vercel – nextjs-boilerplate pass, Vercel – tixly pass;
  RLS verify (produkce vs snapshot) skipping (záměrně).
- `gh run list --branch integrate/2026-10-04`: na 9b2e17e7 Security 38727530766, RLS Gate 38727530374,
  Schema Drift Guard 38727530298, CI 38727530342 = success.
- `staging.keys.env`: **neexistuje**; `git check-ignore -v` → `.gitignore:105:staging.keys.env` (pravidlo platí).
- Větev `fix/round21-sentry-url-tokens-2026-10-15` založena z origin/integrate/2026-10-04 (9b2e17e7).
- Ověření Kola 20: `0_verify_r20.txt`.
