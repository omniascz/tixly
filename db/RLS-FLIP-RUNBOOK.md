# RLS Fáze 2 — produkční flip runbook

Cíl: zapnout vynucení Row-Level Security v produkci jediným příkazem
`ALTER ROLE tixly_app NOBYPASSRLS;` — bezpečně, s ověřením a okamžitým rollbackem.

**Princip:** appka v produkci běží jako role `tixly_app` (NOSUPERUSER, zatím **BYPASSRLS**
→ RLS „spí"). Flip přepne roli na **NOBYPASSRLS** → DB začne vynucovat tenant izolaci
(záchranná síť pod app-layer `WHERE`). Rollback = přepnout zpět na BYPASSRLS (1 řádek,
žádná migrace zpět).

> Stav k 2026-06-08: kód i policy jsou hotové a **funkčně ověřené pod enforce** na dev
> (role `tixly_rls_test` = NOBYPASSRLS): kompletní E2E sweep zelený (250+ kontrol),
> 0 lockoutů přes 147 admin tabulek, 7 Tier-C tabulek izolováno. Vše na větvi
> `feature/rls-phase2-enforcement` (97 commitů nad `master`). Produkce zatím běží starý
> `master` + BYPASSRLS (dormant).

---

## ⚠️ PREREKVIZITY (GO gate — VŠE musí platit, jinak flip NEdělat)

- [ ] **Větev `feature/rls-phase2-enforcement` reviewnutá + mergnutá do `master`.**
      Obsahuje `runAs*`/`db()` kontext, bez kterého policy vrátí 0 řádků = tiché rozbití.
- [ ] **Vercel deploy z `master` je READY** a prod běží NOVÝ kód (ověř `health/ready` 200).
- [ ] **Migrace 330–354 aplikované na prod Neon DB** (kanonický kontrakt + policy vlny +
      Tier C). Ověření v Kroku 0.
- [ ] **Prod `DATABASE_URL` (Vercel env) ukazuje na roli `tixly_app`**, NE na superuser
      `tixly`/Neon-owner. (Flip dává smysl jen pokud app běží jako `tixly_app`.)
- [ ] **Záloha hotová:** Neon PITR retention ≥ 7 dní, nebo vytvoř Neon branch jako
      restore point těsně před flipem.
- [ ] Máš po ruce přístup, kterým umíš spustit `ALTER ROLE` (Neon owner role / SQL editor).

---

## KROK 0 — Ověř výchozí stav (prod DB, read-only)

```sql
-- Očekáváš: bypassrls = t, super = f
SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'tixly_app';

-- Ověř, že RLS policy existují (mělo by být stovky)
SELECT count(*) FROM pg_policies;

-- Ověř, že kritické tabulky mají RLS zapnutou
SELECT relname, relrowsecurity FROM pg_class
 WHERE relname IN ('orders','events','tickets','promo_codes','audit_log','venue_seating_charts')
   AND relkind = 'r';
```
Pokud `bypassrls = f` už teď → flip už proběhl (nebo špatná role). Pokud policy chybí →
migrace nejsou aplikované → **STOP**, dokonči prerekvizity.

---

## KROK 1 — STAGING dry-run na Neon branch (DŮRAZNĚ DOPORUČENO)

Neon umí větvit DB s kopií dat — ideální „staging" bez rizika pro prod.

1. V Neon konzoli vytvoř **branch z produkce** (kopie schématu i dat).
2. Na branchi spusť flip: `ALTER ROLE tixly_app NOBYPASSRLS;`
3. Vytvoř Vercel **preview deploy** s `DATABASE_URL` = connection string té branche.
4. **Smoke test na preview** (viz Krok 3 — celý seznam).
5. Když vše projde → pokračuj na prod (Krok 2). Když regrese („prázdný výpis",
   „permission denied", 500 na admin) → oprav na větvi, branch zahoď, NEpouštěj na prod.

> Bez Neon branche: flip rovnou na prod je možný (rollback je 1 řádek), ale staging
> dry-run je levná pojistka — udělej ho.

---

## KROK 2 — Flip na PRODUKCI

Zvol okno **mimo špičku** (ne během onsale).

```sql
ALTER ROLE tixly_app NOBYPASSRLS;
```

- Změna je okamžitá na úrovni role.
- **Doporučeno:** hned po flipu spusť na Vercelu **redeploy** (nebo restart funkcí), aby
  všechna poolovaná spojení navázala čerstvě pod novým režimem. (Atribut role se sice
  aplikuje i na existující spojení při další transakci, ale čistý restart je jistota.)

---

## KROK 3 — Okamžitý smoke (do ~3 min po flipu)

Projeď a sleduj, že se NEVRACÍ prázdné výpisy / 500 / „permission denied":

- [ ] `curl https://app.tixly.cz/api/health/ready` → `{database:ok, redis:ok}`
- [ ] **Buyer (veřejné):** `/cs/events` ukazuje akce · detail akce má sedadla/ceny ·
      přidat do košíku · checkout proběhne (mock/real) · přijde lístek
- [ ] **Promotér (`/admin`):** login · výpis akcí (NE prázdný) · detail objednávky ·
      scanner · payouts · **promotér A NEvidí data promotéra B**
- [ ] **Platform (`/platform`):** dashboard načte čísla · seznam sálů · promotéři
- [ ] **Crony:** v logu žádné selhání (běží v service kontextu — měly by projít)
- [ ] Sentry / Vercel logy: žádné nové `permission denied for table …` ani prázdné sekce

---

## 🔴 ROLLBACK (kdykoli něco nefunguje)

```sql
ALTER ROLE tixly_app BYPASSRLS;
```
+ Vercel redeploy. Návrat je okamžitý, **žádná migrace zpět netřeba** — policy jen znovu
„usnou". Pak v klidu zjisti příčinu (nejčastěji route bez `runAs*` kontextu → 0 řádků)
a oprav na větvi.

---

## KROK 4 — Po flipu (24–48 h monitoring)

- [ ] Sentry: žádné RLS chyby ani nárůst 500
- [ ] Žádné stížnosti na „nevidím svoje akce/objednávky" (= chybějící kontext někde)
- [ ] Connection pool: pod enforce + při onsale hlídej Neon connection limit
      (doporučeno **Neon pooler endpoint** v `DATABASE_URL` + `PG_POOL_MAX`).

---

## Co flip NEřeší (mimo rozsah)

- Externí blockery launche (GoPay/ComGate, Resend, doména, legal) — nezávislé.
- Connection-leak v `scripts/e2e-*.mjs` (nezavírají `pg.Pool`) — jen test-harness, ne prod.
- Dead-duplicate libs (`vs-generator`/`seat-lock`/`currency-rates`) — cleanup, ne blocker.

## Reference
- Policy/architektura: `db/rls-phase2-plan.md`, `db/security-rls-report.md`
- Empirické audity: `nextjs-boilerplate/scripts/audit-admin-rls.mjs`,
  `nextjs-boilerplate/scripts/audit-public-rls.mjs`
- Enforce test role (dev): `tixly_rls_test` (NOBYPASSRLS), port 5433
