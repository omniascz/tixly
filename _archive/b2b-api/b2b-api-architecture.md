# B2B API — Architektura

> Tixly B2B API — Fáze 3c, Task #57  
> Verze: 1.0 | Datum: 2026-04-06

---

## Přehled

B2B API umožňuje externím partnerům (POS systémy, prodejní sítě, jiné platformy, affiliate agenti) integrovat se s Ticketariem programaticky. Klíčové odlišnosti od B2C API:

| Aspekt | B2C API (`/api/`) | B2B API (`/api/v1/`) |
|---|---|---|
| Autentizace | JWT (session cookie) | API klíč (header) |
| Limity | Bez rate limiting | Tier-based rate limiting |
| Platby | GoPay redirect | `payment_method: "external"` (POS) |
| Audience | Koncoví zákazníci | Promotéři, partneři, POS |
| Webhooky | Ne | Ano |

---

## 1. Formát API klíčů

```
tick_live_<20 znaků base64url>   # produkční klíč
tick_test_<20 znaků base64url>   # sandbox klíč
```

- **Entropie:** 120 bitů — `crypto.randomBytes(15).toString('base64url')`
- **Uložení:** SHA-256 hash (nikdy plaintext) — stejný vzor jako `identity.refresh_tokens.token_hash`
- **Prefix** (`tick_live_` / `tick_test_`) se ukládá jako `key_prefix` pro rychlou identifikaci v DB

### Generování klíče (Node.js)

```typescript
import { randomBytes, createHash } from 'crypto';

function generateApiKey(env: 'live' | 'test'): { raw: string; hash: string; prefix: string } {
  const random = randomBytes(15).toString('base64url'); // 20 chars
  const raw = `tick_${env}_${random}`;
  const hash = createHash('sha256').update(raw).digest('hex');
  const prefix = `tick_${env}_${random.slice(0, 6)}`;
  return { raw, hash, prefix };
}
```

---

## 2. Databázové schéma

```sql
-- Tabulka API klíčů
CREATE TABLE platform.api_keys (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID        NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name            VARCHAR(200) NOT NULL,
  key_prefix      VARCHAR(15)  NOT NULL,          -- 'tick_live_Ab3xYz' — pro zobrazení v UI
  key_hash        TEXT         NOT NULL UNIQUE,   -- SHA-256 hash raw klíče
  scopes          TEXT[]       NOT NULL DEFAULT '{}',
  environment     TEXT         NOT NULL DEFAULT 'test'
                    CHECK (environment IN ('live', 'test')),
  tier            TEXT         NOT NULL DEFAULT 'free'
                    CHECK (tier IN ('free', 'standard', 'premium')),
  ip_whitelist    TEXT[],                         -- NULL = bez omezení IP
  last_used_at    TIMESTAMPTZ,
  expires_at      TIMESTAMPTZ,                    -- NULL = nikdy
  status          TEXT         NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'revoked', 'expired')),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  revoked_at      TIMESTAMPTZ,
  revoked_reason  TEXT
);

-- Audit log pro API klíče
CREATE TABLE platform.api_key_audit_log (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  api_key_id  UUID        NOT NULL REFERENCES platform.api_keys(id) ON DELETE CASCADE,
  event       TEXT        NOT NULL,  -- 'created', 'used', 'revoked', 'rate_limit_hit'
  ip_address  INET,
  user_agent  TEXT,
  metadata    JSONB,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Webhook endpointy
CREATE TABLE platform.webhook_endpoints (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id     UUID        NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  url             TEXT        NOT NULL,
  events          TEXT[]      NOT NULL DEFAULT '{}',  -- ['order.created', 'ticket.issued', ...]
  signing_secret  TEXT        NOT NULL,               -- HMAC-SHA256 tajný klíč (šifrováno AES-256-GCM)
  status          TEXT        NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'disabled', 'auto_disabled')),
  failure_count   INTEGER     NOT NULL DEFAULT 0,
  last_success_at TIMESTAMPTZ,
  last_failure_at TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Doručení webhooků
CREATE TABLE platform.webhook_deliveries (
  id              UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  endpoint_id     UUID        NOT NULL REFERENCES platform.webhook_endpoints(id) ON DELETE CASCADE,
  event_type      TEXT        NOT NULL,
  payload         JSONB       NOT NULL,
  attempt_count   INTEGER     NOT NULL DEFAULT 0,
  next_attempt_at TIMESTAMPTZ,
  status          TEXT        NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'delivered', 'failed', 'abandoned')),
  last_http_status INTEGER,
  last_error      TEXT,
  delivered_at    TIMESTAMPTZ,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Indexy pro výkon
CREATE INDEX ON platform.api_keys (key_hash);
CREATE INDEX ON platform.api_keys (promoter_id, status);
CREATE INDEX ON platform.api_key_audit_log (api_key_id, created_at DESC);
CREATE INDEX ON platform.webhook_deliveries (endpoint_id, status, next_attempt_at)
  WHERE status IN ('pending', 'failed');
```

---

## 3. Scopes (oprávnění)

| Scope | Popis |
|---|---|
| `read:events` | Čtení eventů a dostupnosti |
| `write:events` | Vytváření a úprava eventů |
| `write:orders` | Vytváření objednávek (POS) |
| `read:orders` | Čtení objednávek |
| `read:reports` | Přístup k reportům a statistikám |
| `manage:webhooks` | Správa webhook endpointů |
| `read:tickets` | Čtení ticketů (stav, scan log) |
| `admin:keys` | Správa API klíčů (pouze pro vlastní klíče) |

---

## 4. Rate Limiting — tiers

| Tier | Limit | Redis klíč | Okno |
|---|---|---|---|
| `free` | 100 req/min | `ratelimit:v1:{key_id}:{window}` | sliding 60s |
| `standard` | 1 000 req/min | totéž | sliding 60s |
| `premium` | 10 000 req/min | totéž | sliding 60s |

### Sliding window implementace (Redis)

```typescript
// Middleware: src/middleware/rate-limit.ts
async function checkRateLimit(keyId: string, tier: 'free' | 'standard' | 'premium'): Promise<{
  allowed: boolean;
  remaining: number;
  resetAt: number;
}> {
  const limits = { free: 100, standard: 1000, premium: 10000 };
  const limit = limits[tier];
  const windowSec = 60;
  const now = Date.now();
  const windowStart = now - windowSec * 1000;
  const redisKey = `ratelimit:v1:${keyId}`;

  const pipe = redis.pipeline();
  pipe.zremrangebyscore(redisKey, '-inf', windowStart);
  pipe.zadd(redisKey, now, `${now}-${Math.random()}`);
  pipe.zcard(redisKey);
  pipe.expire(redisKey, windowSec + 1);
  const results = await pipe.exec();
  
  const count = results![2][1] as number;
  const allowed = count <= limit;
  const resetAt = Math.ceil((now + windowSec * 1000) / 1000);

  return { allowed, remaining: Math.max(0, limit - count), resetAt };
}
```

### Response headers

```
X-RateLimit-Limit: 1000
X-RateLimit-Remaining: 847
X-RateLimit-Reset: 1712410860
Retry-After: 43          # pouze při 429
```

---

## 5. Autentizační middleware

```typescript
// src/middleware/api-key-auth.ts
import { createHash } from 'crypto';
import { NextRequest, NextResponse } from 'next/server';

export interface ApiKeyContext {
  keyId: string;
  promoterId: string;
  scopes: string[];
  tier: 'free' | 'standard' | 'premium';
  environment: 'live' | 'test';
}

export async function authenticateApiKey(
  request: NextRequest,
): Promise<ApiKeyContext | NextResponse> {
  const authHeader = request.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer tick_')) {
    return NextResponse.json({ error: 'Missing or invalid Authorization header' }, { status: 401 });
  }

  const rawKey = authHeader.slice(7); // strip 'Bearer '
  
  // Validace formátu
  if (!/^tick_(live|test)_[A-Za-z0-9_-]{20}$/.test(rawKey)) {
    return NextResponse.json({ error: 'Invalid API key format' }, { status: 401 });
  }

  const keyHash = createHash('sha256').update(rawKey).digest('hex');

  // DB lookup — pouze aktivní klíče, nevypršelé
  const apiKey = await db.queryOne<ApiKeyRecord>(
    `SELECT id, promoter_id, scopes, tier, environment, ip_whitelist, status
     FROM platform.api_keys
     WHERE key_hash = $1
       AND status = 'active'
       AND (expires_at IS NULL OR expires_at > NOW())`,
    [keyHash],
  );

  if (!apiKey) {
    return NextResponse.json({ error: 'Invalid or expired API key' }, { status: 401 });
  }

  // IP whitelist check
  if (apiKey.ip_whitelist && apiKey.ip_whitelist.length > 0) {
    const clientIp = request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
    if (!clientIp || !apiKey.ip_whitelist.includes(clientIp)) {
      return NextResponse.json({ error: 'IP address not whitelisted' }, { status: 403 });
    }
  }

  // Aktualizace last_used_at (fire & forget)
  db.query(
    'UPDATE platform.api_keys SET last_used_at = NOW() WHERE id = $1',
    [apiKey.id],
  ).catch(() => {});

  return {
    keyId: apiKey.id,
    promoterId: apiKey.promoter_id,
    scopes: apiKey.scopes,
    tier: apiKey.tier as 'free' | 'standard' | 'premium',
    environment: apiKey.environment as 'live' | 'test',
  };
}

// Scope guard helper
export function requireScope(context: ApiKeyContext, scope: string): boolean {
  return context.scopes.includes(scope) || context.scopes.includes('admin');
}
```

---

## 6. REST API Endpointy

### URL struktura

```
/api/v1/events                              GET  — seznam eventů promotéra
/api/v1/events/{eventId}                    GET  — detail eventu
/api/v1/events/{eventId}/availability       GET  — dostupnost ticketů (real-time)
/api/v1/orders                              POST — vytvoření objednávky (POS)
/api/v1/orders/{orderId}                    GET  — detail objednávky
/api/v1/orders/{orderId}/tickets            GET  — tickety objednávky
/api/v1/tickets/{ticketId}                  GET  — detail ticketu
/api/v1/webhooks                            GET, POST — seznam/vytvoření endpointů
/api/v1/webhooks/{endpointId}               GET, PATCH, DELETE
/api/v1/webhooks/{endpointId}/test          POST — testovací ping
```

### POST /api/v1/orders — POS objednávka

```typescript
// Request body
interface CreateOrderRequest {
  event_id: string;
  items: Array<{
    ticket_type_id: string;
    quantity: number;
    seat_ids?: string[];     // pro sálové eventy
  }>;
  customer: {
    email: string;
    name: string;
    phone?: string;
  };
  payment_method: 'external';  // POS — okamžitý přechod do 'paid'
  external_reference?: string; // referenční číslo POS systému
  metadata?: Record<string, unknown>;
}

// Response
interface CreateOrderResponse {
  order_id: string;
  status: 'paid';              // vždy paid pro external
  tickets: Array<{
    ticket_id: string;
    ticket_type: string;
    seat_info?: string;
    qr_token?: string;         // pokud scope includes read:tickets
  }>;
  total_amount: number;        // v halířích
  currency: string;
  created_at: string;          // ISO 8601
}
```

---

## 7. Webhooky

### Podporované události

```
order.created         — nová objednávka
order.paid            — platba potvrzena
order.cancelled       — zrušení objednávky
order.refunded        — refundace
ticket.issued         — ticket vystaven
ticket.scanned        — scan na vstupu
ticket.transferred    — přenos na jinou osobu
ticket.revoked        — revokace
resale.listed         — ticket dán do resale
resale.sold           — resale prodej dokončen
event.updated         — změna eventu (čas, místo)
event.cancelled       — zrušení eventu
```

### Podpis requestu (HMAC-SHA256)

```
Tixly-Signature: t=1712410800,v1=a3b4c5d6...
```

**Ověření na straně příjemce:**

```typescript
function verifyWebhookSignature(
  payload: string,       // raw request body (string)
  header: string,        // hodnota Tixly-Signature headeru
  secret: string,        // signing secret endpointu
  toleranceSec = 300,    // 5 minut tolerance na clock skew
): boolean {
  const parts = Object.fromEntries(
    header.split(',').map(p => p.split('=')),
  );
  const timestamp = parseInt(parts['t'], 10);
  if (Math.abs(Date.now() / 1000 - timestamp) > toleranceSec) {
    return false; // replay attack
  }
  const expected = createHmac('sha256', secret)
    .update(`${timestamp}.${payload}`)
    .digest('hex');
  return timingSafeEqual(Buffer.from(parts['v1'], 'hex'), Buffer.from(expected, 'hex'));
}
```

### Doručovací strategie (at-least-once + exponential backoff)

| Pokus | Čekání před opakováním |
|---|---|
| 1 | okamžitě |
| 2 | 1 minuta |
| 3 | 5 minut |
| 4 | 30 minut |
| 5 | 2 hodiny |
| — | opuštěno (status: `abandoned`) |

- Endpoint se **auto-disable** (`auto_disabled`) po 50 konsekutivních neúspěších
- Worker kontroluje `platform.webhook_deliveries WHERE status IN ('pending','failed') AND next_attempt_at <= NOW()`

---

## 8. Sandbox vs. produkce

| Aspekt | `tick_test_` | `tick_live_` |
|---|---|---|
| Objednávky | Neukládají se do produkční DB | Reálné objednávky |
| Platby | Bez skutečné platby | Skutečné platby |
| Tickety | Test QR kódy | Reálné tickety |
| Webhooky | Posílají se na test URL | Posílají se na produkční URL |
| Omezení | Přístup jen k testovacím eventům | Všechny eventy promotéra |

---

## 9. Error formát

```json
{
  "error": {
    "code": "INSUFFICIENT_SCOPE",
    "message": "This endpoint requires the write:orders scope",
    "request_id": "req_01HX..."
  }
}
```

### HTTP status kódy

| Status | Kdy |
|---|---|
| 200 | OK |
| 201 | Vytvořeno |
| 400 | Validační chyba (špatné body) |
| 401 | Chybí / neplatný API klíč |
| 403 | Chybí scope nebo IP whitelist |
| 404 | Zdroj nenalezen nebo nepatří promotérovi |
| 409 | Konflikt (nedostatek míst, locked seats) |
| 422 | Sémantická chyba (event cancelled, ticket revoked) |
| 429 | Rate limit překročen |
| 500 | Interní chyba serveru |

---

## 10. Implementační plán (Task #58)

### Krok 1 — Migrace
Vytvořit `migrations/017_b2b_api_tables.sql` se všemi 4 tabulkami.

### Krok 2 — Autentizační middleware
`b2b-api/src/middleware/api-key-auth.ts` — načte klíč, ověří hash, IP whitelist, vrátí `ApiKeyContext`.

### Krok 3 — Rate limiting middleware
`b2b-api/src/middleware/rate-limit.ts` — Redis sliding window, nastaví response headers.

### Krok 4 — API endpointy
`b2b-api/src/app/api/v1/` — Next.js App Router route handlers:
- `events/route.ts`, `events/[eventId]/route.ts`, `events/[eventId]/availability/route.ts`
- `orders/route.ts`, `orders/[orderId]/route.ts`, `orders/[orderId]/tickets/route.ts`
- `tickets/[ticketId]/route.ts`
- `webhooks/route.ts`, `webhooks/[endpointId]/route.ts`, `webhooks/[endpointId]/test/route.ts`

### Krok 5 — Webhook worker
`b2b-api/src/workers/webhook-delivery.worker.ts` — polling loop nebo cron, exponential backoff, HMAC signing.

### Krok 6 — API klíč management API
`b2b-api/src/app/api/v1/keys/route.ts` — CRUD pro API klíče (pouze vlastní promotér).

### Krok 7 — Testy
Vitest integrace:
- Auth middleware (platný klíč, vypršelý, revokovaný, špatný scope)
- Rate limiting (tier limits, sliding window reset)
- POS objednávka (úspěch, nedostatek míst, locked seats)
- Webhook podpis a retry logika

---

## 11. Soubory k vytvoření (Task #58)

```
b2b-api/
├── package.json
├── tsconfig.json
├── src/
│   ├── app/
│   │   └── api/
│   │       └── v1/
│   │           ├── events/
│   │           │   ├── route.ts
│   │           │   └── [eventId]/
│   │           │       ├── route.ts
│   │           │       └── availability/route.ts
│   │           ├── orders/
│   │           │   ├── route.ts
│   │           │   └── [orderId]/
│   │           │       ├── route.ts
│   │           │       └── tickets/route.ts
│   │           ├── tickets/
│   │           │   └── [ticketId]/route.ts
│   │           └── webhooks/
│   │               ├── route.ts
│   │               └── [endpointId]/
│   │                   ├── route.ts
│   │                   └── test/route.ts
│   ├── middleware/
│   │   ├── api-key-auth.ts
│   │   └── rate-limit.ts
│   ├── services/
│   │   ├── api-key.service.ts
│   │   └── webhook-delivery.service.ts
│   └── workers/
│       └── webhook-delivery.worker.ts
└── migrations/
    └── 017_b2b_api_tables.sql
```
