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

## Doporučená náprava (větší projekt — na samostatné plánování)

Pořadí podle hodnoty:

1. **Rozhodnout strategii.** Buď (A) **zapnout enforce RLS** = produkční runtime přepnout
   na roli `tixly_app` a všude používat `with-context`, nebo (B) **vědomě RLS nepoužívat**
   a tenant izolaci řešit jen app-layer + zúžit DB roli (alespoň zrušit superuser/bypassrls
   a dát granulární GRANTy). I varianta B výrazně sníží blast radius.
2. **Pokud (A):** doplnit policy pro 79 tabulek (začít `identity.*` + `payments.*` + `auth.*`),
   pak přepnout `DATABASE_URL` na `tixly_app`. **Pozor:** každý endpoint je nutné projít —
   bez správného `SET LOCAL` kontextu vrátí RLS 0 řádků (tichý rozbití funkcí). Vyžaduje
   důkladné E2E testování celé app pod `tixly_app`.
3. **Minimum hned (i bez velkého projektu):** přestat se připojovat superuserem. Vytvořit
   non-superuser app roli s GRANTy na potřebná schémata (bez `BYPASSRLS`), aby kompromitace
   appky neznamenala plný přístup k clusteru.

## ✅ Hotovo v této session

- **totp_secret_iv konzistence** (`migrations/327_totp_iv_consistency.sql`): CHECK constraint
  na `tickets.access_tokens` a `tickets.cross_pass_memberships` — IV existuje právě tehdy,
  když existuje secret (prevence nedešifrovatelného TOTP tokenu). Aplikováno + v baseline.

## Pozn. k metodice

RLS coverage findings vychází z `scripts/audit-db.sql` (sekce 1b/1c/4a/4b). Spustitelné kdykoli:
`docker exec -i tixly-postgres psql -U tixly -d tixly < scripts/audit-db.sql`
