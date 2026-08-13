# Onsale playbook — přežít velký nápor (tisíce prodejů za vteřiny)

Kdy řešit: **jen velký onsale** (festival headliner, populární koncert). Pro divadlo /
stálý prodej NETŘEBA — běžný provoz to zvládá out-of-the-box.

---

## ✅ Co je už ošetřené v kódu (ověřeno)

| Ochrana | Kde | Stav |
|---|---|---|
| **Atomický decrement inventáře** | checkout: `UPDATE … SET remaining = remaining - $qty WHERE remaining_qty >= $qty` | ✅ Žádný dlouhý `FOR UPDATE` na ticket_type → nezasekne se pod náporem (oprava ze zátěžového testu 2026-06-03). |
| **statement_timeout 15 s** | `rls-pool.ts` | ✅ Zaseknutá query/lock spadne, spojení se uvolní (jinak se pool zasekl donekonečna). |
| **Virtuální fronta (waiting room)** | per-event `queue_enabled` + `platform.queue_tokens` | ✅ Pouští kupce ve vlnách; checkout bez admitted tokenu odmítne. E2E 10/10. |
| **Omezený pool + timeouty** | `PG_POOL_MAX` (default 10), connectionTimeout 8 s | ✅ |
| **Seat hold (anti-double-book)** | `FOR UPDATE OF s` na konkrétních sedadlech | ✅ Scoped jen na vybraná sedadla. |

---

## 🔧 Co nastavit PŘED velkým onsale (prod config — tvoje strana)

### 1. Neon **pooler** endpoint v `DATABASE_URL` (NEJDŮLEŽITĚJŠÍ)
Serverless (Vercel) otevírá spojení per-instance; pod náporem to vyčerpá Neon connection
limit (viděli jsme „remaining connection slots reserved for SUPERUSER" už při souběžných
testech). Řešení: použij Neon **pooled** connection string (transaction mode, `-pooler`
v hostu), ne direct.
```
DATABASE_URL=postgresql://…@ep-xxx-pooler.eu-central-1.aws.neon.tech/tixly?sslmode=require
```

**Naměřený strop** (compute 0.25–2 CU, FINDINGS_RLS §192): `max_connections=901`,
6 rezervovaných pro superusera. Přímý endpoint uneseme na **890 souběžných spojení**,
891. spadne na `SQLSTATE 53300` — přesně ta chyba výše. Pooler stojí zhruba
**1 backend na 9 klientských spojení**, přímý 1:1. Strop je pro oba **společný**.

### 1b. ⚠️ DEPLOY REQUIREMENT — `DATABASE_URL_DIRECT` (R-56)

Aplikace má od R-56 **dva pooly** (`src/lib/db/rls-pool.ts`):

| cesta | endpoint | proč |
|---|---|---|
| `db().query()` | **poolovaný** (`DATABASE_URL`) | drží `SET LOCAL` i dotaz v jedné transakci → na pooleru je těsný (0/120) |
| `db().connect()` | **přímý** (`DATABASE_URL_DIRECT`) | nastavuje GUC mimo transakci → na pooleru běží pod **cizím** kontextem (59/60) |

`DATABASE_URL_DIRECT` **není povinná**: když chybí, odvodí se z `DATABASE_URL`
odstraněním `-pooler` z hostu. Nastav ji explicitně jen tehdy, když se hostname
liší jinak než tímhle suffixem. Když `DATABASE_URL` `-pooler` neobsahuje, odvození
je no-op a oba pooly míří na týž (přímý) endpoint — funkční, jen bez úspory slotů.

### 2. `PG_POOL_MAX` a `PG_DIRECT_POOL_MAX`

| proměnná | default | doporučení pro onsale | poznámka |
|---|---|---|---|
| `PG_POOL_MAX` | 10 | 8–10 | poolovaná cesta, spojení jsou levná |
| `PG_DIRECT_POOL_MAX` | **4** | 4 (níž jen při >200 instancích) | 1 spojení = 1 slot z ~855 |
| `PG_IDLE_TIMEOUT_MS` | 30000 | beze změny | |
| `PG_DIRECT_IDLE_TIMEOUT_MS` | **10000** | 10000 | kratší drží míň vzácných slotů |

**Rozpočet slotů:** 901 − 6 superuser − ~5 baseline − ~35 pooler ≈ **855 pro přímý pool**.
Při `PG_DIRECT_POOL_MAX=4` to vyjde na **~213 souběžných Vercel instancí**, než se narazí.
Při starém `10` by to bylo jen ~85 — což je v dosahu onsale špičky, proto ta změna.

`PG_DIRECT_IDLE_TIMEOUT_MS` nezkracuj pod 10 s: nové spojení stojí ~255 ms proti 41 ms
z poolu (horní odhad, měřeno mimo Vercel) a 24 % volání `connect()` je na horkých
cestách (checkout, scanner/POS, veřejný katalog).

⚠️ **Všechna čísla platí pro compute 0.25–2 CU.** `max_connections` na Neonu škáluje
s velikostí compute — při jeho změně se celá tabulka musí přeměřit
(`node scripts/r56-exits-probe.mjs <direct> <pooled> --cap=1100 --only=ceiling`).

### 3. Zapni frontu na horké akci
V detailu akce (admin) nastav `queue_enabled = true`. Kupci pak projdou waiting roomem,
co je pouští v dávkách → checkout nedostane celý nápor naráz.

### 4. Vercel
- Spending limit + concurrency alert (ať tě velký onsale nepřekvapí účtem).
- Fluid compute / dostatečná concurrency.

---

## 📋 Onsale checklist (den D)

- [ ] `DATABASE_URL` = Neon **pooler** endpoint
- [ ] `PG_POOL_MAX` rozumně nastavený (5–10)
- [ ] Horká akce má `queue_enabled = true`
- [ ] Zátěžový test na NASAZENÉ prod (s poolerem + frontou) → znáš reálný strop
- [ ] Sentry + Vercel alerty zapnuté, někdo to sleduje živě
- [ ] Záloha DB (Neon PITR) aktuální

---

## Pozn. k testování zátěže
Lokálně NEspouštět velký load vedle běžícího dev serveru (vyčerpá connection sloty —
to není prod bug, ale dev limit). Reálný strop měř až na nasazené prod s poolerem.
E2E skripty navíc nezavírají `pg.Pool` (test-harness) → po dávce ukliď idle spojení
nebo restartuj.
