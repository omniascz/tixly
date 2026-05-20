# RLS Migration Guide

**Cíl:** Postupně migrovat 139 API endpointů na RLS-aware DB context bez velkého
big-bang refactoru.

**Aktuální stav:**
- Migrace 285 — RLS policy na 10 kritických tabulkách ✅
- Migrace 286 — `tixly_app` non-privileged role ✅
- `src/lib/db/rls-pool.ts` — AsyncLocalStorage wrapper + `runWithPromoterContext` ✅
- `src/lib/admin-auth.ts` — `runAsPromoter(req, cb)` helper ✅
- `src/lib/platform-auth.ts` — `runAsPlatformAdmin(req, cb)` helper ✅

**Důležité:** Současné endpointy stále fungují — `tixly` user má BYPASSRLS.
Po přepnutí DATABASE_URL na `tixly_app` se aktivuje enforce.

---

## Migration patterns

### Před (současný stav)

```ts
// src/app/api/admin/events/route.ts
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  const r = await db().query(
    `SELECT * FROM catalog.events WHERE promoter_id = $1`,
    [promoter.promoterId],
  );
  return NextResponse.json({ events: r.rows });
}
```

### Po (M2 migration)

```ts
// src/app/api/admin/events/route.ts
import { NextRequest, NextResponse } from 'next/server';
import { runAsPromoter } from '@/lib/admin-auth';
import { db } from '@/lib/db/rls-pool';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPromoter(req, async (promoter) => {
    // RLS automaticky scoped přes SET LOCAL app.current_promoter_id
    // WHERE promoter_id = ... už neni potřeba (RLS policy ho aplikuje)
    const r = await db().query(`SELECT * FROM catalog.events`);
    return NextResponse.json({ events: r.rows });
  });
}
```

### Změny

1. Remove `let pool: Pool | null = null; function db(): Pool {...}` → import z `@/lib/db/rls-pool`
2. Wrap body v `return runAsPromoter(req, async (promoter) => { ... });`
3. `WHERE promoter_id = $X` lze odstranit (RLS dělá to samé)
4. Auth check + 401 response — automaticky `runAsPromoter` vrací 401 helper

---

## Platform admin endpointy

```ts
// src/app/api/platform/admin/promoters/route.ts
import { runAsPlatformAdmin } from '@/lib/platform-auth';
import { db } from '@/lib/db/rls-pool';

export async function GET(req: NextRequest): Promise<Response> {
  return runAsPlatformAdmin(req, async (admin) => {
    // RLS bypass přes app.is_platform_admin = true → vidí všechny promotéry
    const r = await db().query(`SELECT * FROM platform.promoters`);
    return NextResponse.json({ promoters: r.rows });
  });
}
```

---

## Public/anonymous endpointy

Pro public endpointy (search, event detail) **NECHAT jak je** — současné
queries fungují bez context:

```ts
// src/app/api/events/featured/route.ts (žádná změna potřeba!)
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function GET(): Promise<Response> {
  // Bez context — RLS policy vrátí jen status='published' rows
  const r = await db().query(`SELECT * FROM catalog.events WHERE editorial_featured = true`);
  return NextResponse.json({ events: r.rows });
}
```

RLS policy `OR status='published'` automaticky umožní public-policy rows.

---

## Migrate priority order

### Tier 1: Privacy-critical (do týdne po launchi)

- `/api/admin/access-codes/*` — promo kódy nesmí leak
- `/api/admin/customers/*` — buyer PII per promoter
- `/api/admin/invoices/*` — finanční data
- `/api/admin/payouts/*` — bankovní detaily
- `/api/admin/bank-transfers/*` — finanční

### Tier 2: Business-sensitive (1 měsíc)

- `/api/admin/events/*` — pricing, drafts
- `/api/admin/marketing/campaigns/*` — strategie
- `/api/admin/vouchers/*` — gift voucher kódy
- `/api/admin/staff/*` — interní team
- `/api/admin/analytics/*` — performance data

### Tier 3: Operational (3 měsíce)

Zbytek `/api/admin/*` endpointů (~80).

---

## Verify migration per endpoint

Po refactor jednotlivého endpointu spustit:

```bash
# 1. Switch DATABASE_URL na tixly_app
export DATABASE_URL_APP="postgresql://tixly_app:tixly_app_dev_pwd@localhost:5433/tixly"

# 2. Spustit dev s tímto URL
DATABASE_URL=$DATABASE_URL_APP npm run dev

# 3. Test: promotér A request → vrátí jen A data
curl -H "Authorization: Bearer <promoter-A-token>" \
  http://localhost:3000/api/admin/events
# expect: jen events kde promoter_id = A

# 4. Test: promotér A token, ale request s promoter B's event ID:
curl -H "Authorization: Bearer <promoter-A-token>" \
  http://localhost:3000/api/admin/events/<promoter-B-event-id>
# expect: 404 (RLS skryl row)
```

---

## E2E test (M2 milestone)

Viz `e2e/tests/rls-tenant-isolation.spec.ts` — automated check že promotér A
nevidí promotéra B data. Spouštět:

```bash
DATABASE_URL=$DATABASE_URL_APP npm run e2e -- rls-tenant-isolation
```

---

## Switch DATABASE_URL na produkci

**Pre-flight checklist před přepnutím tixly → tixly_app:**

- [ ] Min. 80% Tier 1 endpointů refactored
- [ ] E2E test rls-tenant-isolation passes
- [ ] Backup DB (pg_dump full)
- [ ] Migrace 285 + 286 aplikované na production DB
- [ ] Vercel env DATABASE_URL switched k tixly_app
- [ ] Monitoring: 503 spike po deploy = bug v middleware (rollback)

Pokud jakákoliv query selže s "no rows returned", check že endpoint volá
`runAsPromoter` / `runAsPlatformAdmin` wrapper.

---

## Audit log

| Datum | Verze | Změny |
|---|---|---|
| 2026-05-20 | v1 | RLS infra + migration guide draft |
