# Kolo 17 — zátěžový test na GitHub Actions

Větev `fix/round17-loadtest-2026-10-08` z `e14cbad2` → PR #15 do `integrate/2026-10-04`, sloučeno jako **e19c91e0**.
Výstupy `logs/r17/` (artefakty všech běhů `logs/r17/runs/`, srovnání `2_compare.md`), průběh `PROGRESS_R17.md`.

## 1. Krok 1 — workflow `.github/workflows/loadtest.yml`

- Spouští se ručně, vstupy `ref` (commit / zkrácený commit / větev), `baseline_ref` (volitelný, krok 3), `runs` (3).
  Bez secrets repozitáře (tajné klíče aplikace se generují náhodně pro běh), žádné spojení na produkci, nic se nenasazuje.
- Prostředí jako lokálně v kole 14: Postgres (postgis 17) z migrací **testované verze** + demo data agentury
  (`scripts/staging/create.sh --local`), PgBouncer transaction / pool 10, Redis, Mailpit, simulátor GoPay, `next build`
  + `next start` přes PgBouncer; nástroje testu (e2e/load, simulátor) z větve workflow — pro obě verze stejné.
- Průběh na verzi (`.github/scripts/loadtest-version.sh`): zahřívací běh 5 kupců (nezapočítává se), pak 3× nový termín
  se sálem 500 míst → k6 v2.3.0 (300 kupců / 60 s, scénář `r14-sale.k6.js`) → konzistence (`r14-consistency.mjs`).
- Na začátku `runner.json` (CPU, paměť, OS, kernel, Node, image); na konci artefakt `loadtest-<run_id>` s `results.json`
  (p50 / p95 / p99, počet, chybovost, 5xx / síť / jiné, řízená 503 po krocích pro každý běh) a tabulky v Job Summary.
- actionlint 1.7.12 + shellcheck 0.11.0: 0 nálezů.
- Zjištění při zprovoznění:
  - `gh workflow run loadtest.yml --ref <větev>` → HTTP 404 „not found on the default branch" (master se nepushuje).
    Řešení: spouštěč `push` jen na změnu souboru workflow, job má `if: workflow_dispatch` (přeskočí se) — workflow se tím
    zaregistruje a spouští se přes ID `gh workflow run 378352523 --ref <větev> -f ref=…`. Po dostání na master půjde i jménem.
  - `actions/checkout` s `ref: e14cbad2` selhal (zkrácený hash bere jako větev) → celá historie, ref se přeloží v gitu.
  - `next build` Next 15 2× spadl na „JavaScript heap out of memory" (~1,9 GB, výchozí limit na 7,8 GB) → build s
    `--max-old-space-size=4096` (jen build, server beze změny).

## 2. Parametry runneru

`ubuntu-latest` (image ubuntu24 20260927.320.1 / 20261004.327.1): **2 vCPU, 7,8 GB RAM, Ubuntu 24.04.5 LTS, kernel
6.17.0-1022-azure, Node v24.21.0**. Model CPU se mezi běhy liší: Intel Xeon Platinum 8573C, AMD EPYC 9V45, 9V74, 7763.

## 3. Krok 2 — srovnání f2af248a (Next 14.2.35) × e14cbad2 (Next 15.5.27)

**A) Zadání: 4 samostatné workflow běhy, každá verze 2× (po 3 bězích), medián p95:**

| krok | Next 14 | Next 15 | rozdíl |
|---|---|---|---|
| page | 224 ms | 400 ms | +79 % |
| plan | 100 ms | 294 ms | +196 % |
| hold | 358 ms | 3,25 s | +807 % |
| checkout | 476 ms | 3,36 s | +607 % |
| pay | 2 ms | 2 ms | +14 % |
| webhook | 2,90 s | 22,7 s | +684 % |

Rozdíl je dán strojem, ne verzí: oba běhy Next 15 dostaly EPYC 7763, Next 14 Xeon 8573C a EPYC 9V45. Rozptyl mezi VM
téhož typu je až 3× (Next 14 na Xeon 8573C: hold p95 0,23–1,19 s v jednom VM, 1,40–2,38 s v jiném).

**B) Párové běhy — obě verze za sebou na tomtéž stroji (`baseline_ref`), 3 workflow běhy × 3+3 běhy:**

| workflow běh | CPU | pořadí | hold | checkout | webhook | page | plan |
|---|---|---|---|---|---|---|---|
| 37767610402 | Xeon Platinum 8573C | 14 → 15 | +6,2 % | +13,7 % | +7,7 % | +3,1 % | −0,2 % |
| 37770078757 | EPYC 7763 | 15 → 14 | +15,9 % | +12,9 % | −0,8 % | −8,1 % | +11,6 % |
| 37770629805 | EPYC 9V74 | 14 → 15 | −6,3 % | +8,0 % | +13,7 % | −4,9 % | −26,6 % |

Medián přes všech 9 + 9 párových běhů: page 345 → 351 ms (+1,8 %), plan 223 → 205 ms (−8,3 %), hold 1,42 → 1,51 s
(+6,2 %), checkout 1,51 → 1,71 s (+13,7 %), pay 2 → 2 ms, webhook 9,97 → 10,73 s (+7,7 %).

**Zhoršení o víc než 20 %: žádné** (na stejném stroji nejvýš +15,9 %) → nic k opravě, žádná změna aplikace.

**Cíle kola 14 na runneru:**
- přeprodej: žádný — konzistence **33/33** měřených běhů OK (prodaná místa 500 = zaplacené položky 500 = vstupenky 500,
  místo ve dvou položkách / vstupenkách 0, osiřelé holdy 0, pending po expiraci 0);
- 5xx: **0** ve všech bězích (i ostatní chyby 0);
- p95 hold a checkout < 1,5 s: závisí na stroji pro **obě** verze — EPYC 9V74 splněno oběma (hold 1,05 / 0,99 s,
  checkout 1,05 / 1,14 s), Xeon 8573C hraniční (Next 14 1,42 / 1,51 s, Next 15 1,51 / 1,71 s), EPYC 7763 nesplněno
  oběma (~2,8–3,5 s). Vlastnost runneru (2 vCPU sdílí k6 se 300 VU, server i Postgres) — zapsáno, neopravuje se.

## 4. Krok 3 — pojistka `baseline_ref`

Zadaná `baseline_ref` se změří první (git worktree `base`, vlastní DB a build), testovaná `ref` po ní na stejném runneru.
Krok „Brána" (`e2e/load/r17-summarize.mjs --gate`) selže, když se medián p95 kteréhokoli kroku zhorší o víc než 20 %
**a zároveň o víc než 25 ms**, nebo když selže konzistence kteréhokoli běhu. Práh 25 ms je doplněk k zadání: krok pay má
p95 1–3 ms a ±1 ms by jinak bránu shazovalo (v datech −22 % i +14 % bez skutečné změny). Bez `baseline_ref` brána jen na
konzistenci. Odpovědi 5xx bránu neshazují, vypíší se jako WARN.

Ověření: naživo prošla ve 3 párových bězích (exit 0); na skutečném artefaktu 37770629805 s prohozenými verzemi selže
(plan +36,3 %, +50 ms → exit 1); s rozbitou konzistencí exit 1 (`logs/r17/3_gate_evidence.txt`).

## 5. Workflow běhy

| běh | co | výsledek |
|---|---|---|
| [37765704022](https://github.com/omniascz/tixly/actions/runs/37765704022) | e14cbad2 | selhal — checkout zkráceného hashe (opraveno) |
| [37766203272](https://github.com/omniascz/tixly/actions/runs/37766203272) | e14cbad2, zkušební | OK |
| [37767338789](https://github.com/omniascz/tixly/actions/runs/37767338789) | f2af248a (krok 2) | OK |
| [37767386803](https://github.com/omniascz/tixly/actions/runs/37767386803) | f2af248a (krok 2) | OK |
| [37767375587](https://github.com/omniascz/tixly/actions/runs/37767375587) | e14cbad2 (krok 2) | OK |
| [37767402384](https://github.com/omniascz/tixly/actions/runs/37767402384) | e14cbad2 (krok 2) | OK |
| [37767610402](https://github.com/omniascz/tixly/actions/runs/37767610402) | e14cbad2 vs f2af248a | OK, brána prošla |
| [37769287280](https://github.com/omniascz/tixly/actions/runs/37769287280) | e14cbad2 vs f2af248a | selhal — OOM next build (opraveno) |
| [37769296735](https://github.com/omniascz/tixly/actions/runs/37769296735) | f2af248a vs e14cbad2 | selhal — OOM next build (opraveno) |
| [37770078757](https://github.com/omniascz/tixly/actions/runs/37770078757) | f2af248a vs e14cbad2 | OK, brána prošla |
| [37770629805](https://github.com/omniascz/tixly/actions/runs/37770629805) | e14cbad2 vs f2af248a | OK, brána prošla |

## 6. CI, Vercel, PR

**PR #15** (`fix/round17-loadtest-2026-10-08` @ a757be0d → `integrate/2026-10-04`): Install · typecheck · lint · unit
pass, Live sada pass, Build bez sítě pass, **Vercel – nextjs-boilerplate pass, Vercel – tixly pass**. Sloučeno
`gh pr merge --merge` → **e19c91e0**, lokální integrate fast-forward. PR #2 nesloučen, master nepushnut, nic nenasazeno.
Kód aplikace beze změny (jen workflow, skripty testu a logy).
