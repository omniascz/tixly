# Deploy runbook — větev `feature/rls-phase2-enforcement` → produkce

Cíl: dostat aktuální otestovaný kód (103 commitů: RLS, embed, seating, OG, music,
bezpečnost) na produkci. **Nepotřebuje platební bránu/firmu/doménu** — prod běží
s mock platbami (GoPay live se doplní později). RLS zůstává dormant (BYPASSRLS) —
ostrý RLS flip je samostatný krok (`db/RLS-FLIP-RUNBOOK.md`).

> Ověřeno 2026-06-08: větev se do `master` mergne **čistě** (0 reálných konfliktů;
> master má navíc jen `LAUNCH-CHECKLIST.md`). tsc 0. E2E sweep zelený pod enforce.

---

## ⚠️ NEJDŮLEŽITĚJŠÍ: migrace 335 (user_secrets) je SCHEMA-kritická

Nový login JOINuje `identity.user_secrets` (RLS split hesel). **Pokud prod tu tabulku
nemá, login po deploy SPADNE.** Proto pořadí: **migrace PŘED deployem kódu.**

Klasifikace branch migrací (330–356):
- **335** `identity_user_secrets_split` — **SCHEMA + data + trigger** → MUSÍ být na prod.
- **356** `buyer_service_fee` — **SCHEMA** (přidá `fee_schedules.buyer_fee_basis` +
  `orders.service_fee_minor`). Nový checkout INSERTuje `service_fee_minor` → **bez téhle
  migrace checkout po deployi SPADNE.** MUSÍ být na prod před deployem kódu.
- **330–334, 336–355** — **čistě RLS policy** (dormantní pod BYPASSRLS, idempotentní
  `DROP POLICY IF EXISTS`). Nutné až pro RLS flip, ale aplikuj je rovnou (bezpečné).

---

## KROK 0 — Ověř výchozí stav prod DB (read-only)

```sql
-- Má prod user_secrets? (kritické pro login)
SELECT to_regclass('identity.user_secrets') AS user_secrets_exists;

-- Kolik RLS policy už má? (jestli proběhly vlny 330-355)
SELECT count(*) FROM pg_policies;
SELECT count(*) FROM pg_policy WHERE polname LIKE 'svc_%';

-- Stav app role (po deploy zůstává BYPASSRLS = RLS dormant)
SELECT rolname, rolbypassrls FROM pg_roles WHERE rolname = 'tixly_app';
```
- `user_secrets_exists = NULL` → prod NEMÁ 335 → MUSÍ se aplikovat před deployem.
- nízký počet `svc_` policy → vlny 330-355 ještě neproběhly.

---

## KROK 1 — Deploy gate (musí platit)
- [x] Větev se mergne čistě do master (ověřeno: 0 konfliktů)
- [x] `npx tsc --noEmit` = 0 chyb
- [x] `npx vitest run` zelené — **465 passed / 4 skip / 0 fail** (50 souborů, 2026-06-08)
- [x] E2E sweep zelený pod enforced RLS (lifecycle/features/destructive/dashboards/queue/group)
- [ ] Záloha prod DB (Neon PITR ≥ 7 dní / branch jako restore point)

---

## KROK 2 — Aplikuj migrace na prod (PŘED deployem kódu)

Migrace jsou idempotentní (policy přes `DROP IF EXISTS`; 335 má guardy). Aplikuj
chybějící (min. 335 + RLS sadu). Postup přes existující applier vzor:

```bash
# 1) Vytvoř bundle chybějících migrací (335 + 330-334,336-355) — nebo aplikuj
#    jednotlivě v pořadí. Příklad jednotlivě:
PROD="postgresql://…neon…/tixly"   # prod connection (Vercel env DATABASE_URL_OPS / super)
for m in 330 331 332 333 334 335 336 337 338 339 349 350 351 352 353 354 355; do
  psql "$PROD" -f migrations/${m}_*.sql
done
```
> Pozn.: 340–348 už na prod jsou (BUNDLE_340-348_prod.sql, nasazeno dříve). 335 a
> 330-334/336-355 zkontroluj dle Kroku 0 a aplikuj, co chybí. Re-aplikace policy = no-op.

Po aplikaci ověř (Krok 0 znovu): `user_secrets_exists` ≠ NULL, počet `svc_` policy stoupl.

---

## KROK 3 — Merge + deploy kódu

```bash
git checkout master
git merge feature/rls-phase2-enforcement   # čistý merge (ověřeno)
git push origin master                      # Vercel auto-deploy z master
```
Vercel build proběhne automaticky. Počkej na READY.

---

## KROK 4 — Smoke na produkci (do ~5 min)

- [ ] `curl https://<prod>/api/health/ready` → `{database:ok, redis:ok}`
- [ ] **LOGIN** (kritické — testuje user_secrets/335): přihlas se existujícím účtem
- [ ] Registrace promotéra (200), registrace kupujícího (200)
- [ ] Buyer: `/cs/events` → detail → checkout (mock platba) → přijde lístek
- [ ] Promotér `/admin`: výpis akcí, detail objednávky, scanner
- [ ] Platform `/platform`: dashboard
- [ ] Embed: `https://<prod>/embed/event/<id>` → 200 (ne 404 — locale fix)
- [ ] Sentry/logy: žádné `relation "identity.user_secrets" does not exist`

---

## 🔴 ROLLBACK
- Kód: Vercel → Deployments → předchozí READY → „Promote to Production" (instant).
- Migrace: policy jsou dormantní (BYPASSRLS) → není co rollbackovat. 335 (user_secrets)
  se nerollbackuje (starý kód ji nečte, jen ignoruje) — ale rollback kódu na starý
  master, který user_secrets nečte, je bezpečný.

---

## KROK 5 — (Později, samostatně) RLS ostrý flip
Po stabilním běhu → `db/RLS-FLIP-RUNBOOK.md` (`ALTER ROLE tixly_app NOBYPASSRLS`).
Není součástí tohoto deployu — deploy jen dostane kód+policy na prod, flip je opt-in.

---

## Co tento deploy NEodemyká (čeká na tebe)
Reálné platby (GoPay/ComGate klíče), e-maily (Resend doména), vlastní doména,
firma/IČO/účet. Do té doby prod běží s mock platbami — ideální pro interní testování
a dogfooding na živé URL.
