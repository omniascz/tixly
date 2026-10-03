# PROGRESS_R6 — kolo 6: přepnutí tixly/, CI na GitHubu, co chybí postavit

Pracuje se v `tixly/` na `integrate/2026-10-04`; `../tixly-fix` zůstává detached (3ab73410).
Zakázáno: reflog expire, gc, prune, reset --hard v tixly/, clean, push --force, mazání wip/fix/integrate/audit větví,
stash drop/clear. Nepushovat master, nespouštět deploy, žádná produkce. Výstupy: logs/r6/.
Při startu nové session: přečíst tento soubor a pokračovat prvním nehotovým krokem.

## Stav kroků
| Krok | Stav | Commit |
|---|---|---|
| 1 přepnutí tixly/ | HOTOVO — strom a44ccdb3 = snímek; master, 0 souborů za 15 min; tixly-fix detached; stash@{0} „pred prepnutim na integrate/2026-10-04“; switch OK, status prázdný; snímek celý (jen 479→488, cart/validate smazaná P1); lokální master fast-forward d4b43f4f → 3ab73410 | |
| 2 CI na GitHubu | iterace 3 (eeb32e47): CI ✓ (unit+live), Schema Drift ✓, RLS Gate ✓, Security: gitleaks ✓, npm audit ✗ (skutečné high/critical) — PR #2 | e72932ce, 35e7e306, df82e836 |
| 3 co chybí postavit | HOTOVO — 16 položek (3 blokující: C-29, C-54, C-31); nálezy opraveny: 3 demo cesty k hodnotě bez platby, bulk-refund přes bránu | 6e1b7280, eeb32e47 |
| Závěr ROUND6_REPORT.md | HOTOVO | (tento commit) |

## Poznámky
- Krok 2 iterace 1 (ef658d73): RLS Gate ✗ — snapshot bez politik vlastníka (chyba integrace R5, opraveno); unit ✗ ECONNREFUSED :5433 (test vyžaduje vývojovou DB, gate env); gitleaks ✗ chybělo pull-requests: read.
- Krok 3 rozpracováno: NÁLEZ cross-passes/purchase aktivuje cross-pass bez platby (bez demo-guardu); bulk-refund nevolá bránu.
