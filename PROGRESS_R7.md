# PROGRESS_R7 — kolo 7: blokery ostrého prodeje a drobné nedodělky

Větev `fix/round7-2026-10-04` z `ed77a3b9` v `tixly/`. PR na konci do `integrate/2026-10-04`.
Zakázáno: reflog expire, gc, prune, reset --hard, clean, push --force, mazání wip/fix/integrate/audit větví,
stash drop/clear (stash „pred prepnutim na integrate/2026-10-04“ ponechat). Nepushovat master, nespouštět deploy,
žádná produkce. Migrace od 493. Výstupy: logs/r7/. Při startu nové session: přečíst tento soubor.

## Stav kroků
| Krok | Stav | Commit |
|---|---|---|
| 1 uzávěrka prodeje (C-29) | HOTOVO — mig 493, lib/sales/cutoff.ts, 13 kupcových + 4 pokladní cesty, UI; RED 5 → GREEN 7/7 (vizuál „Prodej ukončen" v závěru) | 6659671f |
| 2 DPH, doklady, faktury, ISDOC (C-54) | HOTOVO — 2a sazby v DB (mig 494), povinná sazba/DIČ, blokace publikace+prodeje; 2b doklady po sazbách, řady bez děr (50 souběžných), dobropis při refundu (mig 495), RED→GREEN 7/7; 2c ISDOC 6.0.2 dle oficiálního XSD (RED starý generátor 5 chyb → GREEN 5/5), faktury provize platformy (mig 496, RED stub 3/3 → GREEN 3/3) | 9d88f9bf, 1748dd64, f925611f |
| 3 výplaty — poctivý stav (C-57) | HOTOVO — mig 497 (awaiting_manual_transfer, trigger paid jen s potvrzením, převod neověřených + audit), confirm-transfer endpoint, executor nehlásí paid, UI /platform/payouts + /admin/payouts pravdivě; RED 5 → GREEN 5/5 (vizuál stránek v závěru) | 43a159b6 |
| 4 zranitelné závislosti | HOTOVO — web axios/postcss/nodemailer v major + audit fix (63→52), mobile lockfile sync + audit fix (80→71), gate audit-fixable.mjs (opravitelné = zmizí po audit fix bez --force), security.yml; tsc 0, unit 634, build OK; tabulka logs/r7/4_vuln_table.tsv | c6edc85a |
| 5 drobnosti (cron, lockfile, ARES) | 5a mobile-promoter lockfile HOTOVO (npm ci RED→GREEN, tsc 0) 81fa66d2; cron + ARES čeká | 81fa66d2 |
| 6 sandbox brány | čeká | |
| Závěr | čeká | |

## Poznámky
- Krok 1: odchylka od zadání — existující nevynucovaný sale_end_at převeden do nového sales_end_at a zapisovače přepnuty (uvést v reportu).
- Krok 2: zdroj sazeb — zákon 235/2004 § 47 (znění od 1. 1. 2026, zakonyprolidi.cz verze 69) + Informace GFŘ k 1. 1. 2024 (PDF v logs/r7). XSD ISDOC 6.0.2 z isdoc.cz (sha256 fb5de36f…). Faktury provize platformy dosud stub — staví se v 2c, údaje Tixly s.r.o. nejsou (web „[doplníme]") → konfigurace, fail-closed.
- Krok 2c: údaje platformy jako dodavatele = platform.billing_identity, migrace NEPLNÍ (neznámé) → bez nich 503. Předpoklad: payouts.platform_fees je VČETNĚ DPH, DUZP = konec výplatního období (uvést v reportu). Ne-admin na /api/platform/* dostane 403 z middleware.
- Krok 3: zbývá mimo C-57 — cron/resale-payouts (výplaty prodejcům přeprodeje) stále mock „paid" (přeprodej je vypnutá demo cesta); artist-payouts = evidence pořadatele, ne převod platformy. Uvést v reportu.
- Krok 4: build s fix.app.env + přepsané DATABASE_URL_SUPER/OPS, KV_URL, KV_REST_API_URL na lokální (jinak by je Next vzal z .env.local). Live + audity 01–12 po změně závislostí se ověří v závěru.
