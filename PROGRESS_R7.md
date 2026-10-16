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
| 5 drobnosti (cron, lockfile, ARES) | HOTOVO — 5a mobile-promoter lockfile (npm ci RED→GREEN, tsc 0); 5b cron expire-date-holds ve vercel.json + dispatcheru (RED 3 → GREEN); 5c simulátor ARES + mig 498, výpadek → ruční ověření (RED 6 → GREEN 6) | 81fa66d2, d83bb154, 6ff7145e |
| 6 sandbox brány | HOTOVO — 6a ComGate dle oficiálního API (cesty/pole/webhook JSON/refund timeout, payment_provider dle brány; RED 3 → GREEN 3); 6b GoPay scope payment-all (RED 6 → GREEN, 119/119); 6c brány bez refundu jen pro existující akce (mig 499; RED 5 → GREEN 5); 6d sandbox testy + README env (bez klíčů skip, guard 4/4, nanečisto proti simulátorům 2/2; proti skutečnému sandboxu neověřeno) | d3099c14, 2ac760e0, 048d7c56, 5d60d70c |
| Závěr | HOTOVO — od nuly 52/0, tsc 0, lint 994<1008, unit 636, live 306 (21 skip Neon), build OK, audity 01–12 vč. 07b/08 0 FAIL, vizuál 5/5, gitleaks čisto; ROUND7_REPORT.md | viz report |

## Poznámky
- Krok 1: odchylka od zadání — existující nevynucovaný sale_end_at převeden do nového sales_end_at a zapisovače přepnuty (uvést v reportu).
- Krok 2: zdroj sazeb — zákon 235/2004 § 47 (znění od 1. 1. 2026, zakonyprolidi.cz verze 69) + Informace GFŘ k 1. 1. 2024 (PDF v logs/r7). XSD ISDOC 6.0.2 z isdoc.cz (sha256 fb5de36f…). Faktury provize platformy dosud stub — staví se v 2c, údaje Tixly s.r.o. nejsou (web „[doplníme]") → konfigurace, fail-closed.
- Krok 2c: údaje platformy jako dodavatele = platform.billing_identity, migrace NEPLNÍ (neznámé) → bez nich 503. Předpoklad: payouts.platform_fees je VČETNĚ DPH, DUZP = konec výplatního období (uvést v reportu). Ne-admin na /api/platform/* dostane 403 z middleware.
- Krok 3: zbývá mimo C-57 — cron/resale-payouts (výplaty prodejcům přeprodeje) stále mock „paid" (přeprodej je vypnutá demo cesta); artist-payouts = evidence pořadatele, ne převod platformy. Uvést v reportu.
- Krok 4: build s fix.app.env + přepsané DATABASE_URL_SUPER/OPS, KV_URL, KV_REST_API_URL na lokální (jinak by je Next vzal z .env.local). Live + audity 01–12 po změně závislostí se ověří v závěru.
- Krok 5: RED běh ARES testu poslal několik čtecích dotazů na veřejný ares.gov.cz (starý klient ignoroval ARES_BASE_URL) — uvést v reportu. KYC u zaniklého subjektu (inactive) dál projde (beze změny chování, jen se uloží stav) — uvést.
- Krok 6: RED mobilního testu 6c jednou zavolal api.stripe.com se zástupným klíčem (odmítnuto) — uvést. Volba brány pro akci v administraci neexistuje → politika v checkoutu/mobilu/UI. Security workflow na větvi zelený od běhu 37170601116.
