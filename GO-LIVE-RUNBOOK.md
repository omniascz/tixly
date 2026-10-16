# GO-LIVE RUNBOOK — den spuštění Tixly

Kolo 9. Navazuje na `GO-LIVE-INVENTORY.md` (co musí být nastaveno), `GO-LIVE-CHECKLIST.md`, `DEPLOYMENT.md`
a `docs/RUNBOOK-DISASTER-RECOVERY.md`. Nasazení = merge PR #2 (`integrate/2026-10-04` → `master`).
Všechny příkazy proti produkci spouští **vlastník** ze svého stroje. Hodnoty `$PROD_OWNER_URL` (role `neondb_owner`)
a `$PROD_APP_URL` (role `tixly_app`) nikam neukládat do repa.

> **Blokující věci před dnem D** (bez nich nenasazovat):
> 1. **Vercel build projektu `nextjs-boilerplate` padá** na každé větvi včetně `master` (od 2026-08-14). Merge PR #2
>    spustí produkční build stejného projektu — nejdřív v administraci Vercelu zjistit příčinu (Deployments → poslední
>    preview → Build Logs) a opravit (typicky chybějící env proměnná v prostředí Preview/Production).
> 2. Všechny povinné proměnné a secrets ze `GO-LIVE-INVENTORY.md` §7 nastavené (Vercel Production + GitHub secrets
>    včetně nových `VERCEL_ORG_ID` a `VERCEL_PROJECT_ID`).
> 3. Staging prošel `scripts/staging/smoke.sh` (turné + sandbox GoPay/ComGate).

---

## 1. Kontroly před nasazením (jen čtení)

```bash
psql "$PROD_OWNER_URL" -v ON_ERROR_STOP=1 -f scripts/prod/preflight.sql > preflight-$(date +%F).txt
PROD_OWNER_URL="$PROD_OWNER_URL" scripts/prod/pending-migrations.sh > pending-$(date +%F).txt
```

`preflight.sql` běží celý v transakci `READ ONLY`. Očekávané výsledky (ověřeno na DB z migrací 000–506):

| Kontrola | Očekávání | Když ne |
|---|---|---|
| 1. role | `tixly_app`: login, **NOSUPERUSER, NOBYPASSRLS**, bez CREATEROLE/CREATEDB; „OK: tixly_app NOBYPASSRLS, NOSUPERUSER" | STOP — `ALTER ROLE tixly_app NOBYPASSRLS NOSUPERUSER;` (vlastník), znovu preflight |
| 2. RLS | po migracích 506: 617 tabulek, 589 s RLS, 28 bez RLS = seznam v souboru (číselníky/systémové) | tabulka s daty zákazníků/objednávek bez RLS = STOP |
| 3. politiky | 871 po migraci 506 (před ní méně — počet roste s chybějícími migracemi) | po migracích ≠ 871 → spustit `node scripts/rls-verify.mjs` (nextjs-boilerplate) proti produkci a porovnat se snapshotem |
| 4. migrace | `schema_migrations` existuje; poslední < 500 před nasazením kol 7–9 | `pending-migrations.sh` vypíše přesný seznam |
| 5. SECURITY DEFINER | přesně 7 funkcí (seznam v souboru); „přepíná kontext" jen `public.app_is_platform_admin` | jiná funkce = neschválený bypass RLS → STOP |
| 6. práva | `tixly_app` SELECT/INSERT na `orders.orders` = t; TRUNCATE na nových tabulkách = f | doplnit GRANT podle migrace |

## 2. Záloha produkční DB před migracemi

Dvě nezávislé zálohy:

1. **Neon větev-snímek** (okamžitá, pro rychlý návrat): Neon konzole → projekt produkce → *Branches* → *Create branch*
   z `main` „před-go-live-RRRR-MM-DD" (point-in-time *now*). Neon navíc drží historii pro obnovu k času (PITR) podle tarifu.
2. **Logický dump** (nezávislý na Neonu) — stejně jako workflow `db-backup.yml`:
   ```bash
   pg_dump --format=custom --compress=9 --no-owner --no-privileges "$PROD_OWNER_URL" -f pred-golive.dump
   pg_restore --list pred-golive.dump | grep -c ' TABLE '      # TABLE + TABLE DATA; na DB z migrací kola 9 = 1360
   ```
   **Ověření obnovitelnosti** (povinné, ne jen `--list`): obnovit do prázdné databáze mimo produkci
   (lokální Postgres 17 nebo dočasná Neon větev), spustit nad ní `preflight.sql` a porovnat počty řádků klíčových tabulek:
   ```bash
   createdb tixly_restore_test && pg_restore --no-owner -d tixly_restore_test pred-golive.dump
   psql -d tixly_restore_test -f scripts/prod/preflight.sql | head -40
   for t in orders.orders tickets.tickets catalog.events identity.users; do
     echo "$t prod=$(psql "$PROD_OWNER_URL" -Atc "select count(*) from $t") restore=$(psql -d tixly_restore_test -Atc "select count(*) from $t")"; done
   ```
   Dump šifrovat (`openssl enc -aes-256-cbc -pbkdf2`) a uložit mimo Neon (S3 jako v `db-backup.yml`).

## 3. Aplikace migrací

- **Které chybí:** `scripts/prod/pending-migrations.sh` (porovná `migrations/[4-9][0-9][0-9]_*.sql` s `public.schema_migrations`).
  Kola 7–9 přidávají 493–499 a 500–506; přesný seznam podle produkce dá skript.
- **Kdo je spouští:** workflow `deploy.yml` po merge do `master` — od kola 9 **nejdřív `migrate`, pak `deploy`**
  (dřív obráceně — nový kód chvíli běžel nad starým schématem). Runner `scripts/run-migrations.sh`: `ON_ERROR_STOP`,
  evidence v `schema_migrations`, zastaví se na první chybě; po migracích `rls-verify` proti produkci.
  Pro kontrolu lze migrace pustit ručně předem ze stroje vlastníka (`DATABASE_URL="$PROD_OWNER_URL" ./scripts/run-migrations.sh`) —
  workflow je pak přeskočí (evidence).
- **Pořadí:** číselné (glob se `LC_ALL=C`), nikdy nepřeskakovat.
- **Zámky:** migrace jsou aditivní — nové tabulky, `ADD COLUMN` s konstantním defaultem (v PG 11+ jen metadata, okamžité),
  výměny politik a CHECK omezení. Krátký `ACCESS EXCLUSIVE` zámek berou `ALTER TABLE` na `catalog.events`,
  `catalog.event_seats`, `orders.orders`, `orders.order_items`, `tickets.tickets` (sloupce kategorií, nastavení rezervací,
  zrušení). `pending-migrations.sh` u každé uvede počet `ALTER TABLE` / `CREATE INDEX`. Indexy jsou na nových (prázdných)
  tabulkách. Doporučení: okno s nízkým provozem a `PGOPTIONS='-c lock_timeout=5s'`, aby migrace při zaseknutém
  zámku spadla místo blokování prodeje.
- **Při chybě:** runner skončí na chybné migraci, další se nespustí a **deploy se nespustí** (needs: migrate). Migrace jsou
  idempotentní (`IF NOT EXISTS`, `DROP … IF EXISTS`) — opravit příčinu (zámek → znovu v klidnější chvíli; data
  porušující nové omezení → opravit data) a spustit znovu. Nikdy needitovat již aplikovanou migraci — nová oprava = nový soubor.

## 4. Nasazení

1. PR #2 (`integrate/2026-10-04` → `master`): ověřit zelené GitHub Actions (CI, Schema Drift Guard, RLS Gate,
   Security) a **opravený** Vercel build (viz blokující bod 1).
2. Merge PR #2 → workflow **Deploy** (`.github/workflows/deploy.yml`): `ci` + `schema-drift` + `rls-gate` → `migrate`
   (migrace + RLS produkce) → `deploy` (`vercel pull/build/deploy --prod`).
3. Sledovat: GitHub → Actions → běh „Deploy" (každý job zelený); Vercel → Deployments (stav *Ready*, doména produkce
   ukazuje na nový deployment); logy funkce v prvních minutách (Vercel → Logs, filtr `error`).

## 5. Smoke test produkce (hned po nasazení)

1. `curl -s -o /dev/null -w '%{http_code}' https://<doména>/api/health` → 200; hlavní stránka, `/cs/program`, přihlášení.
2. **Nákup skutečnou kartou za nejnižší cenu:** na testovacím (skrytém nebo levném) termínu vybrat 1 místo, kategorie Plné,
   zaplatit kartou přes GoPay/ComGate → návrat na potvrzení, e-mail se vstupenkou (PDF bez vodoznaku „Demo" —
   kontrola `TICKET_PDF_PRODUCTION_MODE=1`), objednávka `paid` v administraci.
3. **Refund** téže objednávky v administraci → stav `refunded`, peníze vráceny na kartu (výpis/administrace brány), vstupenka neplatná,
   dobropis, pokud byl vystaven doklad.
4. **Rezervace:** na termínu s povolenými rezervacemi „Rezervovat, zaplatím na pokladně" → e-mail s kódem; v administraci
   najít kód, zaplatit hotově → vstupenky + doklad.
5. **Sken:** v administraci Vstup otevřít skener pro termín, naskenovat vstupenku z kroku 4 → „Vstup povolen", druhý sken „již použitá".
6. **E-mail:** doručení do Gmailu i Seznamu (ne do spamu), hlavička `Authentication-Results`: `spf=pass dkim=pass dmarc=pass`.
7. **Cron:** Vercel → Settings → Cron Jobs — joby registrované; po 15 minutách v logu běh `seat-reservations` a `expire-pending-orders` s HTTP 200.
8. **Webhook brány:** v administraci GoPay/ComGate u platby z kroku 2 stav notifikace „doručeno" (200).

## 6. Rollback

- **Kód:** Vercel → Deployments → předchozí produkční deployment → *Instant Rollback* (*Promote to Production*). Trvá sekundy,
  DB se nemění. Poté revert merge commitu na `master` (nový PR), aby se další push znovu nenasadil.
- **Migrace — nevracet.** Kola 7–9 jsou aditivní; starý kód nad novým schématem funguje (nové sloupce/tabulky nepoužívá).
  Nevratné bez ztráty dat by bylo:
  - mazání nových tabulek (`orders.seat_reservations`, `catalog.price_categories`, `catalog.seat_blocks`, …) — přišli byste o rezervace, kategorie, blokace;
  - 505: návrat globální unikátnosti `invoice_orders.invoice_number` selže, jakmile dva pořadatelé mají stejné číslo faktury;
  - 504/505: výměny politik pokladny a firemních objednávek — staré politiky by znovu zablokovaly pokladnu (42501).
- **Poslední možnost — obnova DB** z Neon větve-snímku (bod 2.1) nebo dumpu: znamená **ztrátu všech dat od zálohy**
  (objednávky, platby) — jen při poškození dat, s ručním dosledováním plateb z administrace brány. Postup v
  `docs/RUNBOOK-DISASTER-RECOVERY.md`.

## 7. Prvních 48 hodin

| Co | Kde | Na co pozor |
|---|---|---|
| Chyby aplikace | Sentry (od kola 9 se serverový Sentry skutečně načítá — `instrumentationHook`), Vercel → Logs | 5xx na `/api/checkout*`, `/api/payments/*/webhook`, `/api/internal/order-completed` |
| Webhooky bran | administrace GoPay / ComGate (stav notifikací), Vercel Logs | objednávky `pending` se zaplacenou platbou, opakované notifikace |
| Objednávky | SQL (read-only): `select status, count(*) from orders.orders where created_at > now()-interval '1 day' group by 1` | rostoucí `pending` po expiraci = nefunkční cron; `refund_failed` |
| Cron | Vercel → Cron Jobs + Logs; dispatcher vrací 200 i při selhání jobu → dívat se na tělo odpovědi (`status` uvnitř) | `expire-pending-orders`, `seat-reservations`, `corporate-orders-overdue` |
| E-maily | Resend → Logs (bounce, complaint), DMARC reporty | odmítnuté doručení, spam |
| Zálohy | GitHub → Actions → „DB backup" (neděle 4:00 UTC) + S3 | první běh po spuštění zkontrolovat ručně (smoke test dešifrování) |
| RLS | GitHub Actions „RLS Gate" (produkce vs snapshot) | jakýkoli drift |
| Kapacita/výkon | Neon → Monitoring (spojení, CPU), Vercel → Analytics | vyčerpaná spojení (pooler), pomalé dotazy |

Kontakt na eskalaci a postup při výpadku: `docs/RUNBOOK-DISASTER-RECOVERY.md`.
