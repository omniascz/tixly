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

---

# ⭐ RUNBOOK PRVNÍHO NASAZENÍ (od nuly, ručně)

**Kdo to čte:** člověk, který u předchozí práce nebyl.

**Proč ručně:** CI nikdy nic nenasadilo — v repu **nejsou žádné GitHub secrets**
(ověřeno `gh secret list`, prázdné i pro všechna prostředí), takže každý
plánovaný běh týdny selhává. První nasazení je proto ruční; CI se aktivuje
až v kroku 7.

**Předpoklady:** `psql` (klient 17+), `node` 22+, přístup k Neon projektu.

---

## KROK 0 — Rozhodnout, pod jakou rolí poběží aplikace

🔴 **`DATABASE_URL` musí používat roli `tixly_app`, NE `neondb_owner`.**

`tixly_app` je jediná role s `BYPASSRLS = false`. Pod `neondb_owner` je všech
598 RLS policies **inertních** — existují, ale nikdy se nevyhodnotí, takže
izolace tenantů fakticky neplatí.

*Ověření* (po kroku 3):

```sql
SELECT rolname, rolbypassrls FROM pg_roles
WHERE rolname IN ('tixly_app','neondb_owner');
-- tixly_app musí mít rolbypassrls = false
```

---

## KROK 1 — Záloha (pokud DB není prázdná)

```bash
pg_dump "$ADMIN_URL" --no-owner --no-privileges -Fc -f pre-deploy-$(date +%F).dump
```

*Ověření:* soubor existuje a `pg_restore -l` ho přečte.

---

## KROK 2 — Aplikovat migrace runnerem

⚠️ **Musí to být `psql`, ne node.** `000_baseline_20260730.sql` je výstup
`pg_dump 17` a nese psql meta-příkazy; přes SQL driver vrátí `42601`
a **neaplikuje se vůbec** (FINDINGS §33).

```bash
# krok 2 jede jako OWNER, ne jako tixly_app
export DATABASE_URL="postgresql://neondb_owner:...@.../neondb"
./scripts/run-migrations.sh
```

Runner drží pořadí sám (abecední) a je idempotentní:

| # | soubor | co dělá |
|---|---|---|
| 0a | `000_baseline_20260730.sql` | celé schéma — 81 schémat, 600 tabulek, 596 policies |
| 0b | `000_baseline_globals.sql` | role `tixly_app`, granty, default privileges |
| 450 | `450_tickets_dedup_unique.sql` | unique index na lístcích |
| 451 | `451_orders_payment_provider_pos.sql` | rozšíření CHECK `payment_provider` |
| 452 | `452_tracking_events_provider_tiktok.sql` | rozšíření CHECK `provider` |
| 453 | `453_users_select_scoped.sql` | `p_users_select` → 3 policies podle vztahu |
| 454 | `454_rls_cast_nullif_fix.sql` | 4 policies: přímý cast GUC → helper |
| 455 | `455_rls_namedrift_identity.sql` | 20 policies: name-drift → `app_*()` |

*Ověření:* runner vypíše `Aplikováno: 8 / Selhalo: 0 / Warningů: 0`.

🔴 **`Warningů: > 0` NENÍ v pořádku.** `ON_ERROR_STOP` warningy nechytá —
`GRANT` na objekt vlastněný extensionou vrátí `WARNING` a psql skončí kódem 0,
takže migrace „projde", aniž nastal efekt (§27, §29). Pak nepokračuj a přečti je.

*Ověření stavem, ne exit kódem:*

```sql
SELECT count(*) FROM pg_policies;                    -- očekáváno 598
SELECT count(*) FROM pg_class WHERE relrowsecurity;  -- očekáváno 411
```

---

## KROK 3 — Heslo pro `tixly_app`

Heslo **není a nesmí být v repu** — z `pg_roles` se vyčíst nedá, generuje se
při nasazení.

```bash
NEWPW="$(openssl rand -base64 24)"
psql "$DATABASE_URL" -c "ALTER ROLE tixly_app WITH PASSWORD '$NEWPW'"
echo "$NEWPW"   # ulož do správce hesel a do GitHub secrets (krok 7)
```

*Ověření:* přihlášení pod novou rolí projde a **vidí míň** než owner:

```bash
psql "postgresql://tixly_app:$NEWPW@.../neondb" -c "SELECT current_user"
```

---

## KROK 4 — Nakreslit čáru v evidenci migrací

```bash
psql "$DATABASE_URL" -f scripts/reset-migration-ledger.sql
```

Proč: evidence `public.schema_migrations` má z historie 245 řádků a končí na
`339_...`, zatímco schéma je reálně u ~449 — migrace 340–449 se aplikovaly,
aniž se zapsaly (stará CI smyčka do evidence nezapisovala, §17). Rekonstruovat
je zpětně by byla fikce; baseline je snapshot skutečného stavu a evidence
začíná od něj.

⚠️ Skript **není migrace** a leží schválně v `scripts/`, aby ho nechytil žádný
`migrations/*.sql` glob.

*Ověření:*

```sql
SELECT count(*) FROM public.schema_migrations;   -- řádově jednotky, ne 245
```

---

## KROK 5 — Ověřit RLS proti očekávanému stavu

```bash
cd nextjs-boilerplate && npm ci
DATABASE_URL="postgresql://tixly_app:...@.../neondb" node scripts/rls-verify.mjs
```

*Ověření:* `GATE PROŠEL — žádný drift`, exit 0. Při selhání vypíše konkrétní
rozdíly (chybějící/přebývající/změněná policy, vypnuté RLS, role ≠ `{public}`,
helper bez `SECURITY DEFINER`).

🔴 **Tenhle krok nahrazuje `BUNDLE_340-348_prod.sql`.** Ten byl dřív jediné, co
drift RLS vracelo zpět — pouštěl se opakovaně a přepisoval, co se rozešlo.
Baseline se aplikuje jednou, takže tu roli přebírá tahle kontrola. BUNDLE už
v deploy cestě není (leží v `migrations/archive/`, žádný workflow ho nepouští).

---

## KROK 6 — Přepnout `DATABASE_URL` aplikace na `tixly_app`

Ve Vercelu (Production): `DATABASE_URL` = connection string **role `tixly_app`**
s heslem z kroku 3.

*Ověření:* aplikace naběhne a promotér vidí **jen svoje** data:

```sql
-- pod tixly_app s kontextem promotéra musí vyjít MÉNĚ než celkový počet
SET app.current_promoter_id = '<id>'; SET app.role = 'promoter';
SELECT count(*) FROM identity.users;
```

---

## KROK 7 — Teprve teď zapnout CI gate

GitHub → Settings → Secrets → Actions:

| secret | hodnota | pro co |
|---|---|---|
| `DATABASE_URL` | connection string role **`tixly_app`** | `rls-gate`, `migrate` |
| `NEON_API_KEY` | Neon API klíč | noční sken, `snapshot-drift` |

Dokud `DATABASE_URL` neexistuje, `rls-gate` se **hlasitě přeskočí**
(`::warning` + zápis do job summary) — neblokuje deploy, ale ani nekontroluje.
Jakmile secret vznikne, aktivuje se sám, bez dalšího zásahu.

*Ověření:* `Actions → RLS Gate → Run workflow` musí skončit zeleně a **bez**
varování „RLS gate PŘESKOČEN".

⚠️ Zkontroluj taky, že `deploy.yml` má `environment:` shodné se skutečným
názvem prostředí — v repu existují `Production`, `Production – nextjs-boilerplate`
a `Production – tixly`, zatímco workflow uvádí `production`. **NEOVĚŘENO.**

---

## Po každé další migraci, která mění RLS

```bash
node scripts/rls-verify.mjs --snapshot --url="<klon s migracemi>"
git add nextjs-boilerplate/rls-snapshot.json
```

Jinak spadne job `snapshot-drift` s výzvou snapshot přegenerovat.

## Poznámka: „capacity backfill"

V `migrations/` **žádná capacity-backfill migrace není** (ověřeno výpisem
adresáře). Do pořadí výše ji nezařazuji, protože neexistuje — jde buď o krok,
který ještě nevznikl, nebo o práci mimo tenhle adresář.
