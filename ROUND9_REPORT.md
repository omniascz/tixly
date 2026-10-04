# ROUND 9 — dokončení před spuštěním a příprava ostrého provozu

Větev `fix/round9-golive-2026-10-04` z `37d7dc04`. Nic se nepřipojovalo k produkční DB ani službám záměrně,
master nepushnut, PR #2 nesloučen, žádný deploy. Výstupy `logs/r9/`, průběh `PROGRESS_R9.md`.
**Jedna výjimka (incident, viz §5):** při prvním boot testu pojistky stagingu se server pokusil spojit s produkčním Neon hostem.

## 1. Krok 1 — drobnosti

| Položka | Hotovo | Test RED → GREEN | Commit |
|---|---|---|---|
| PgBouncer pool 10 | `audit/r2/pgb/pgbouncer.ini` i CI blok `default_pool_size 2 → 10`; lokální `fix-pgb` přemontován na soubor z tohoto repa | `fix-r3-pool-nested` přes PgBouncer 1/1 fail → celá live sada přes PgBouncer **79/79** (21 skip jen Neon); na integrate 80/80 | 4bdbb5ac |
| Promo kód — omezení v UI | výběr termínu → kategorie a zóny (nic = všechny), volba „jen tento termín", sloupec Omezení; API ověřuje vlastnictví termínů/zón (`RESTRICTION_NOT_OWNED`) | Playwright `e2e/tests/golden-path-r9-golive.spec.ts` A: fail (ovládání chybí) → pass | 89852994 (s 1d) |
| Skener „jiný termín" | „Lístek platí na jiný termín: Racek — 29. 10. 2027 19:30, Ostrava (Komorní scéna)." + `validFor` | live `fix-r9-scanner-wrong-term` 1/1 fail → pass; `fix-r3-v9b-wrong-event` 4/4 | b16128c8 |
| Next.js advisory obrázků | `images.unoptimized: true`, odstraněn placeholder `cdn.example.com`; opraven veřejný kiosk (dotaz na neexistující sloupce → 500, nečitelné nadpisy) | Playwright B: kiosk 500 → pass; obrázky na webu (next/image) i v administraci se načtou, nejdou přes `/_next/image`, endpoint nevrací 200 | 89852994 |

**Zdroj advisory:** GitHub Advisory Database (přes `npm audit` pro next 14.2.35, text staženy `gh api advisories/…`, uloženo
`logs/r9/1d_next_advisories.txt`):
- **GHSA-2xp9-vwfh-vxw4** (critical) — RCE v Image Optimization API při optimalizaci AVIF (sharp/libheif), opraveno 15.5.24 / 16.3.3;
  advisory neuvádí konfigurační workaround → zmírnění = vypnutí optimalizace.
- **GHSA-h64f-5h5j-jqjh** (DoS Image Optimization API): „If you are using `images.unoptimized: true`, you are NOT impacted."
- **GHSA-9g9p-9gw9-jx7f** (DoS přes remotePatterns) — týká se jen optimalizace vzdálených obrázků; s vypnutou optimalizací irelevantní.
- Zbývající critical **GHSA-p293-qw3h-jr36** (RCE na serverech s Windows) se produkce na Vercelu (Linux) netýká; bez workaroundu.
- Ostatní advisories next 14 (DoS Server Components, SSRF, cache poisoning…) konfigurací zmírnit nejdou — trvalé řešení = upgrade na 15.5.24+.

## 2. Krok 2 — sloučení PR a sada na integrate

- Sloučeno přes `gh pr merge --merge`: **PR #3** (round7) → 8aadf388, **PR #4** (round8) → 0f3e2186, **PR #5** (round9 krok 1) → f391fcc2.
  Před každým sloučením prošly GitHub Actions (CI, live, RLS, schema drift). Check „Vercel – nextjs-boilerplate" selhává na všech
  PR i na `master` od 2026-08-14 (předexistující; logy jsou ve Vercelu — produkční služba, nepřipojoval jsem se).
- Lokální `tixly/` přepnuto na `integrate/2026-10-04` (fast-forward na f391fcc2), pak zpět na větev kola pro další kroky.

| Sada na integrate/2026-10-04 (f391fcc2) | Výsledek | Log |
|---|---|---|
| Migrace od nuly | 59 souborů, 0 chyb; RLS gate bez driftu; schema drift 43 (baseline) | 2_Z1_* |
| Typecheck / lint | 0 / žádná nová chyba (993 vs baseline 1008) | 2_Z2, 2_Z3 |
| Unit | 655 prošlo (po LF checkoutu 2 souborů — artefakt Windows `autocrlf`, opraveno `.gitattributes` fe200138) | 2_Z4 |
| Live přes PgBouncer | **80/80** (21 skip jen Neon) | 2_Z5 |
| Build | OK | 2_Z6 |
| Audity | 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · 05 8/0 · 06 21/0 · 07 6/0 · 07b 0 zápisů · 08 166 rout, 0 úniků · 09 12/0 · 10 7/0 · 11 8/0 · **12 1/4 FAIL** | 2_Z8_* |
| Scénář turné | **neproběhl** — server i simulátor GoPay ukončil systém kvůli nedostatku paměti | — |

**Audit 12 = skutečná chyba, opravena (fe7fa8d3):** claim skupinové pozvánky vytvoří pending objednávku bez odečtení
`remaining_qty`; při expiraci se kapacita vrátila nad `total_qty` → CHECK `chk_catalog_ticket_types_remaining` → rollback celé dávky
`expire-pending-orders` (nic nepropadlo). Stejný vzor v 5 refundových cestách (po vrácení peněz branou by objednávka uvízla).
Všech 7 míst se stropem `LEAST(total_qty, …)`. Live `fix-r9-expire-capacity-overflow`: cron 500 → 200. Opravy kroků 2–5 jsou na větvi
`fix/round9-golive-2026-10-04` po sloučení PR #5 — **potřebují další PR do integrate** (viz §5).

**CI pro PR #2:** na hlavě `ed77a3b9` (před sloučením) prošly CI, live, RLS, schema drift, gitleaks; padaly *Dependency audit*
(mobile, mobile-promoter, nextjs-boilerplate — zranitelnosti vyžadující hlavní verze, viz kolo 7) a Vercel build. Stav po sloučení
(f391fcc2) — viz §5 (ověření závisí na dostupnosti GitHubu).

## 3. Krok 3 — inventura

`GO-LIVE-INVENTORY.md`: 206 env proměnných (21 povinných — 16 společných + GoPay nebo ComGate, 144 volitelných, 34 jen dev/test,
7 nepoužívaných), 26 „tichých fallbacků" (např. bez `APP_URL` jdou notifikace bran na localhost; bez `TICKET_PDF_PRODUCTION_MODE=1`
vodoznak „Demo"), e-mail = SMTP/nodemailer (Resend) + SPF/DKIM/DMARC, 10 GitHub secrets (+ nové `VERCEL_ORG_ID`, `VERCEL_PROJECT_ID`),
31 cronů (1 nefunkční: `/api/admin/lastminute/check` GET→405; 9 neregistrovaných rout, mj. `payouts-execute`), DB role a ověřovací SQL,
webhooky: GoPay `https://<doména>/api/payments/gopay/webhook` (posílá kód sám), ComGate `https://<doména>/api/payments/comgate/webhook`
(zadat v portálu ComGate). Klíčová tvrzení ověřena přímo v kódu.

## 4. Krok 4 a 5 — staging a runbook

- `scripts/staging/create.sh` (samostatný Neon projekt nebo `--local`; `--dry-run`), `seed-demo.sql`, `vercel-preview.env.example`, `smoke.sh`.
- Pojistka `TIXLY_ENV=staging` (`src/lib/env/staging-guard.ts`) v `instrumentation.ts`, při vytvoření DB poolů a v konfiguraci GoPay/ComGate.
  **Nález:** Next 14 bez `experimental.instrumentationHook` `instrumentation.ts` nespouštěl — nenačítal se ani serverový **Sentry** (opraveno).
- `GO-LIVE-RUNBOOK.md`, `scripts/prod/preflight.sql` (READ ONLY), `scripts/prod/pending-migrations.sh`; `deploy.yml` nově migrace → deploy.

Ověřeno nanečisto: shellcheck 0 (3 skripty), dry-runy včetně odmítnutí produkčního projektu/hostu/domény, `create.sh --local` proti
lokálnímu Postgresu (2 místa, 2 inscenace, 4 termíny, 400 míst, 20 kategorií, 24 blokovaných; `tixly_app` NOBYPASSRLS; 871 politik;
seed idempotentní), boot: staging s produkční DB (falešný host) odmítne bez pokusu o spojení, izolovaný naběhne; preflight +
pending-migrations proti lokální DB (simulace produkce bez 500–506), záloha + obnova (počty sedí).
**Neověřeno:** proti skutečnému Neonu a Vercelu (vyžaduje klíče vlastníka), `smoke.sh` naostro (vyžaduje běžící staging a člověka u platby v sandboxu).

## 5. Co se nepodařilo / zbývá

- **Incident:** první boot test pojistky (`TIXLY_ENV=staging`, `DATABASE_URL` se skutečným produkčním hostem a falešným heslem `x`)
  ukázal, že pojistka neběží — server se pokusil spojit s produkčním Neon endpointem; spojení odmítl TLS (`connection is insecure`),
  k autentizaci ani dotazu nedošlo. Příčina opravena (instrumentationHook + kontrola v poolech), další testy jen s falešným hostem.
- **Scénář turné na integrate neproběhl** a **audit 12 po opravě nebyl znovu spuštěn proti serveru** — systém ukončil server
  a simulátor GoPay pro nedostatek paměti; znovu je nespouštím bez pokynu. Refundové testy (k2, k3, escalations) s opravou kapacity
  čekají na simulátor (bez něj padají na ECONNREFUSED stejně jako před opravou).
- **Commity po sloučení PR #5** (fe7fa8d3, fe200138, 3df432b3, fbf71b5e, 894c296c a report) nejsou v integrate — potřebují nový PR.
  Poslední push selhal: GitHub nedostupný (timeout portu 443) — viz finální stav v odpovědi.
- Vercel build projektu `nextjs-boilerplate` padá (předexistující) — blokuje produkční deploy po merge PR #2.
- Z kódu nefunkční (není otázka klíčů): cron lastminute (GET→405), `payouts-execute` neregistrován, mock `charge-installments`/
  `renew-subscriptions`, chybějící `/api/payments/benefit/return`, benefit karty mimo Pluxee (403).
- Next 14: zbývající advisories (DoS Server Components, SSRF, …) vyžadují upgrade na 15.5.24+.
