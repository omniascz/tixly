# Bezpečnostní report — RLS / tenant izolace (2026-06-01)

Vzniklo z velkého DB auditu. Týká se Row-Level Security a izolace dat mezi tenanty
(promotéry) a uživateli.

## 🔴 Hlavní nález: aplikace běží jako DB superuser → RLS se NEAPLIKUJE

`.env.local` → `DATABASE_URL=postgresql://tixly:...@.../tixly`. Role `tixly` má:

```
superuser = true,  bypassrls = true
```

**Důsledek:** Postgres u superuseru / `BYPASSRLS` role **ignoruje všechny RLS policy**.
V produkci tedy:

1. **Žádná z 160 existujících RLS policy nic nefiltruje.** Jsou „uspané".
2. `src/lib/db/with-context.ts` (`SET LOCAL app.current_promoter_id = …`) je fakticky
   **dekorativní** — policy, které ten kontext čtou, se na superuser spojení nespustí.
3. Tenant izolace dnes stojí **výhradně na app-layer** `WHERE promoter_id = …` /
   authz checcích. Jakýkoli chybějící WHERE = cross-tenant leak **bez DB záchranné sítě**.
4. **Blast radius při kompromitaci appky** (SQL injection, bug) = plný superuser přístup
   k DB (číst/měnit vše, DROP tabulek).

Role `tixly_app` (non-superuser, RLS-enforced) existuje, ale v produkčním kódu se
**nepoužívá** — odkazuje na ni jen `rls-tenant-isolation.test.ts`.

## Pokrytí RLS (i kdyby se enforce zapnul)

- **160 policy** existuje (z migrací 285 / 303 / 310) — kritické tabulky pokryté.
- **79 tabulek s `user_id`/`promoter_id` nemá RLS vůbec.** Rozložení:

| Schéma | Tabulek bez RLS | Citlivost |
|---|---|---|
| `identity` | 20 | 🔴 sessions, refresh_tokens, password_reset_tokens, mfa_configs, user_2fa, webauthn_credentials, bankid_auth_sessions |
| `marketing` | 12 | 🟠 reviews, rsvps, loyalty, promo usages |
| `social_graph` | 4 | 🟠 blocks, activities, profiles |
| `reservations` | 4 | 🟡 |
| `venues` / `tickets` / `payments` / `referral` | 3 každé | 🔴 payments.*, tickets.wallet_passes |
| `subscriptions` / `auth` / `platform` / `orders` / `notifications` / … | 2 každé | 🔴 auth.passkey_*, subscriptions.* |

## ✅ FÁZE 1 — HOTOVO (2026-06-01): app už není DB superuser

App runtime přepnut z `tixly` (superuser) na **`tixly_app` = NOSUPERUSER**:
- `migrations/329_app_role_deprivilege.sql` + `db/000_roles.sql` + `db/002_grants.sql`
  (docker init je aplikuje automaticky na čistou DB).
- `tixly_app`: NOSUPERUSER/NOCREATEDB/NOCREATEROLE/NOREPLICATION + GRANT ALL na app schémata.
  Migrace/seedy/ops dál běží jako `tixly` (potřebují pg_read_file aj.).
- `.env.example` → app `DATABASE_URL` ukazuje na `tixly_app`.
- **Ověřeno:** golden-path 4/4 PASS jako `tixly_app`, 0 permission chyb; role NEmůže `CREATE`
  v DB ani číst `pg_authid` (hashe hesel) → katastrofický blast radius pryč.

**BYPASSRLS na `tixly_app` je záměrně PONECHÁN** — drží chování identické s dneškem do Fáze 2.
RLS tedy zatím stále nefiltruje; co se změnilo = odebrání cluster-admin práv aplikaci.

## ⏭️ FÁZE 2 — enforce RLS (velký refaktor, NEdělat naslepo)

`ALTER ROLE tixly_app NOBYPASSRLS` je jednořádkový přepínač, ale **rozbil by 431 souborů**:
tolik route handlerů dělá raw `new Pool` / `pool.query` BEZ tenant kontextu → bez
`SET LOCAL app.current_promoter_id` vrátí RLS 0 řádků = tiché rozbití skoro všeho.
`src/lib/db/rls-pool.ts` (context-aware `db()` přes AsyncLocalStorage) je postavený přesně
na tohle, ale použitý jen ve ~3 souborech.

Postup (samostatný projekt): 1) doplnit RLS policy pro 79 nepokrytých tabulek (priorita
`identity.*`/`payments.*`/`auth.*`); 2) zmigrovat 431 raw-pool míst na context-aware `db()`;
3) per-endpoint E2E test pod `tixly_app` s NOBYPASSRLS na staging; 4) teprve pak
`ALTER ROLE tixly_app NOBYPASSRLS` v produkci.

## ✅ Další hotovo v této session

- **totp_secret_iv konzistence** (`migrations/327_totp_iv_consistency.sql`): CHECK constraint
  na `tickets.access_tokens` a `tickets.cross_pass_memberships` — IV existuje právě tehdy,
  když existuje secret (prevence nedešifrovatelného TOTP tokenu). Aplikováno + v baseline.

## ✅ FÁZE 2 — krok 1 částečně HOTOVO (2026-06-04): veřejné read cesty

Systematicky podchycena **veřejná čtecí vrstva** (to, co se reálně láme při lokálním
testu pod `tixly_rls_test` NOBYPASSRLS). Dřív se to opravovalo reaktivně kus po kuse
(„Online" u venues, prázdné multi-day sekce); teď proběhl plošný audit:

- **`scripts/audit-public-rls.mjs`** — opakovatelný empirický audit. Vytáhne tabulky
  čtené veřejnými server-komponentami + public API a porovná `service` vs `anonym`
  viditelnost. Spustitelné kdykoli: `node scripts/audit-public-rls.mjs`.
- **migrace 349 + 350** — **25 public-read SELECT policy** pro veřejně-zobrazovaná
  data (venues, event_days/zones, collections, cross-pass, entry_slots, lotteries,
  resale_listings, subscriptions plans/packages, bundles, hospitality, reviews,
  editorial, incidents…). Každá gated: `EXISTS published akce` / `active` / `is_public`
  / `status`. Zápis dál řídí tenant/service policy.
- **access_codes** záměrně BEZ public policy (tajné kódy) → `unlock-access-code` route
  obalen `runWithServiceContext` (validace kódu = trusted lookup, ne anonym).
- **Stav po:** 0 reálných veřejných děr (ověřeno auditem), 18 tabulek OK.

**Pořád zbývá pro plný enforce** (krok 2–4 níže): ~431 raw-pool míst v *authed* admin/
buyer routes (ne veřejné čtení) + 79 nepokrytých tabulek (identity/payments/auth).
Veřejná read vrstva je ale teď čistá — to byla ta část, co se lámala viditelně.

## Pozn. k metodice

RLS coverage findings vychází z `scripts/audit-db.sql` (sekce 1b/1c/4a/4b). Spustitelné kdykoli:
`docker exec -i tixly-postgres psql -U tixly -d tixly < scripts/audit-db.sql`
Veřejné read cesty: `node nextjs-boilerplate/scripts/audit-public-rls.mjs` (NOBYPASSRLS role).
