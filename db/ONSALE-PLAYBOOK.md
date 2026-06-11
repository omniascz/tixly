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

### 2. `PG_POOL_MAX`
S poolerem nech nízký per-instance (např. 5–10) — pooler sdílí spojení napříč instancemi.
Vercel env: `PG_POOL_MAX=8`.

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
