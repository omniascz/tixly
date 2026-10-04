# PROGRESS_R7 — kolo 7: blokery ostrého prodeje a drobné nedodělky

Větev `fix/round7-2026-10-04` z `ed77a3b9` v `tixly/`. PR na konci do `integrate/2026-10-04`.
Zakázáno: reflog expire, gc, prune, reset --hard, clean, push --force, mazání wip/fix/integrate/audit větví,
stash drop/clear (stash „pred prepnutim na integrate/2026-10-04“ ponechat). Nepushovat master, nespouštět deploy,
žádná produkce. Migrace od 493. Výstupy: logs/r7/. Při startu nové session: přečíst tento soubor.

## Stav kroků
| Krok | Stav | Commit |
|---|---|---|
| 1 uzávěrka prodeje (C-29) | HOTOVO — mig 493, lib/sales/cutoff.ts, 13 kupcových + 4 pokladní cesty, UI; RED 5 → GREEN 7/7 (vizuál „Prodej ukončen" v závěru) | 6659671f |
| 2 DPH, doklady, faktury, ISDOC (C-54) | 2a HOTOVO (sazby v DB mig 494, povinná sazba/DIČ, blokace publikace+prodeje) 9d88f9bf; 2b doklady/řady/dobropis, 2c ISDOC XSD + faktury provize — rozpracováno | 9d88f9bf |
| 3 výplaty — poctivý stav (C-57) | čeká | |
| 4 zranitelné závislosti | čeká | |
| 5 drobnosti (cron, lockfile, ARES) | čeká | |
| 6 sandbox brány | čeká | |
| Závěr | čeká | |

## Poznámky
- Krok 1: odchylka od zadání — existující nevynucovaný sale_end_at převeden do nového sales_end_at a zapisovače přepnuty (uvést v reportu).
- Krok 2: zdroj sazeb — zákon 235/2004 § 47 (znění od 1. 1. 2026, zakonyprolidi.cz verze 69) + Informace GFŘ k 1. 1. 2024 (PDF v logs/r7). XSD ISDOC 6.0.2 z isdoc.cz (sha256 fb5de36f…). Faktury provize platformy dosud stub — staví se v 2c, údaje Tixly s.r.o. nejsou (web „[doplníme]") → konfigurace, fail-closed.
