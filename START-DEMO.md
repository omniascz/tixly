# Tixly — Lokální demo (3 role: master admin, promotér, kupec)

> **Cíl této příručky:** krok po kroku tě dovést od čistě naklonovaného repa
> k plnohodnotnému lokálnímu demu, kde funguje **celý životní cyklus
> platformy**:
>
> 1. **Master admin** (`superadmin@tixly.cz`) — schválí nového promotéra
> 2. **Promotér** (`admin@tixly.cz` nebo nově registrovaný) — založí akci přes UI
> 3. **Kupec** — koupí lístek, mock platba, e-mail v Mailhogu
>
> Žádné externí služby — vše běží v Dockeru na tvém počítači.
>
> Existující `start.md` se týká **produkčního deploye**. Tento dokument je
> pro **fázi A** — lokální demo PŘED deploy.

---

## Obsah

1. [Co budeš mít po dokončení](#co-budes-mit-po-dokonceni)
2. [Předpoklady](#predpoklady)
3. [Krok 1 — Inicializace `.env.local`](#krok-1)
4. [Krok 2 — Doplnění chybějících závislostí](#krok-2)
5. [Krok 3 — Vytvoření modulu `@tixly/crypto`](#krok-3)
6. [Krok 4 — Vytvoření mock modulu `gopay-payments`](#krok-4)
7. [Krok 5 — Spuštění Docker služeb](#krok-5)
8. [Krok 6 — Seed (data + master admin + 2 promotéři)](#krok-6)
9. [Krok 7 — Auth API + role v JWT](#krok-7)
10. [Krok 8 — Role-based middleware](#krok-8)
11. [Krok 9 — Veřejné stránky (login, registrace, akce)](#krok-9)
12. [Krok 10 — Promotér: tvorba akce přes UI](#krok-10)
13. [Krok 11 — Master admin: schvalování promotérů](#krok-11)
14. [Krok 12 — Moderace akcí (keyword blocklist + lidský review)](#krok-12)
15. [Krok 13 — Mock platební stránka](#krok-13)
16. [Krok 14 — Spuštění aplikace](#krok-14)
17. [Krok 15 — Smoke test (3 scénáře + moderace)](#krok-15)
18. [Příloha A — Časté chyby a řešení](#priloha-a)
19. [Příloha B — Co dál (cesta k produkci)](#priloha-b)

---

<a id="co-budes-mit-po-dokonceni"></a>
## Co budeš mít po dokončení

Po projití všech 15 kroků poběží na `http://localhost:3000`:

### Tři účty, tři role
| Účet | Heslo | Role | Co umí |
|---|---|---|---|
| `superadmin@tixly.cz` | `Demo2026!` | master admin | schvalovat promotéry, sledovat platformu (`/platform`) |
| `admin@tixly.cz` | `Demo2026!` | promotér (active) | vytvářet akce, sledovat objednávky (`/admin`) |
| `pending@example.cz` | `Demo2026!` | promotér (pending) | čeká na schválení master adminem |

### Veřejné URL
- `http://localhost:3000/cs/events` — veřejný seznam akcí
- `http://localhost:3000/cs/login` — login (všechny role)
- `http://localhost:3000/cs/register` — registrace kupce
- `http://localhost:3000/cs/register-promoter` — self-service registrace promotéra
- `http://localhost:3000/admin` — promotér dashboard
- `http://localhost:3000/platform` — master admin dashboard
- `http://localhost:8025` — Mailhog UI

### Demo flow (E2E)
1. Master admin schválí pending promotéra → status `active`
2. Promotér klikem založí novou akci → akce jde do `pending_review` (NE rovnou do prodeje)
3. Master admin akci v `/platform/event-moderation` schválí → akce se objeví v `/cs/events`
4. Pokus o akci s názvem např. „Heil koncert" → keyword blocklist instantně přidělí status `rejected`
5. Kupec se zaregistruje, koupí lístek, mock GoPay potvrdí → e-mail v Mailhogu
6. Promotér vidí objednávku v `/admin/orders`

---

<a id="predpoklady"></a>
## Předpoklady

### Software
| Co | Verze | Ověření | Win instalace |
|---|---|---|---|
| Node.js | 20+ | `node -v` | https://nodejs.org/ (LTS) |
| npm | 10+ | `npm -v` | součást Node.js |
| Docker Desktop | latest | `docker -v` | https://docker.com/products/docker-desktop |
| Docker Compose | v2 | `docker compose version` | součást Docker Desktop |
| psql client | 16 | `psql --version` | součást PostgreSQL installeru |

**Pozn. k Windows:** příkazy v této příručce používají bash syntax.
Spouštěj v **Git Bash**, ne v cmd/PowerShell.

### Místo + RAM
- ~4 GB volného místa (Docker images + node_modules)
- 8 GB RAM minimum

### Před začátkem
```bash
cd C:/Users/omnia/Documents/tixly
git status
docker info   # Docker Desktop musí běžet
```

---

<a id="krok-1"></a>
## Krok 1 — Inicializace `.env.local`

### Cíl
Vytvořit `nextjs-boilerplate/.env.local` se všemi proměnnými, které
middleware, DB pool a checkout API očekávají.

### 1.1 — Vygeneruj JWT secret
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```
Vypíše 128 hex znaků. **Zkopíruj si je.**

### 1.2 — Vygeneruj ENCRYPTION_KEY
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Vypíše 64 hex znaků. **Zkopíruj si je.**

### 1.3 — Vytvoř `.env.local`
Soubor `C:/Users/omnia/Documents/tixly/nextjs-boilerplate/.env.local`:

```dotenv
# ─── Aplikace ──────────────────────────────────────────────────────────────
NODE_ENV=development
NEXT_PUBLIC_APP_URL=http://localhost:3000
NEXT_PUBLIC_API_URL=http://localhost:3000

# ─── Databáze (lokální Docker) ─────────────────────────────────────────────
DATABASE_URL=postgresql://tixly:tixly_dev@localhost:5432/tixly
POSTGRES_HOST=localhost
POSTGRES_PORT=5432
POSTGRES_DB=tixly
POSTGRES_USER=tixly
POSTGRES_PASSWORD=tixly_dev

# ─── Redis ────────────────────────────────────────────────────────────────
REDIS_URL=redis://default:redis_dev@localhost:6379

# ─── Kafka ────────────────────────────────────────────────────────────────
KAFKA_BROKERS=localhost:9094
KAFKA_CLIENT_ID=tixly-dev

# ─── JWT (vlož secret z 1.1) ──────────────────────────────────────────────
JWT_SECRET=PASTE_64_BYTES_HEX_HERE
JWT_ACCESS_TOKEN_TTL=900
JWT_REFRESH_TOKEN_TTL=604800
NEXTAUTH_SECRET=PASTE_64_BYTES_HEX_HERE

# ─── Interní webhook token ────────────────────────────────────────────────
INTERNAL_SERVICE_TOKEN=internal-dev-token-change-me-32chars-min-xxxxxx

# ─── E-mail (Mailhog catch-all) ───────────────────────────────────────────
SMTP_HOST=localhost
SMTP_PORT=1025
SMTP_USER=
SMTP_PASS=
SMTP_SECURE=false
EMAIL_FROM=vstupenky@tixly.local

# ─── GoPay (mock) ─────────────────────────────────────────────────────────
GOPAY_MOCK=1
GOPAY_CLIENT_ID=mock
GOPAY_CLIENT_SECRET=mock
GOPAY_GOID=8888888888

# ─── Šifrování (vlož 64 hex z 1.2) ────────────────────────────────────────
ENCRYPTION_KEY=PASTE_32_BYTES_HEX_HERE
```

### ✓ Checkpoint
```bash
grep -E "JWT_SECRET|DATABASE_URL|ENCRYPTION_KEY" C:/Users/omnia/Documents/tixly/nextjs-boilerplate/.env.local | head
```
Tři řádky s vyplněnými hodnotami (ne `PASTE_...`).

---

<a id="krok-2"></a>
## Krok 2 — Doplnění chybějících závislostí

### Cíl
`src/middleware.ts` importuje `jose`. Auth routes potřebují `bcryptjs`.

### 2.1 — Instalace
```bash
cd C:/Users/omnia/Documents/tixly/nextjs-boilerplate
npm install jose@^5 bcryptjs@^3
npm install -D @types/bcryptjs @types/nodemailer
```

### ✓ Checkpoint
```bash
node -e "require('jose'); require('bcryptjs'); console.log('OK')"
```
Vypíše `OK`.

---

<a id="krok-3"></a>
## Krok 3 — Vytvoření modulu `@tixly/crypto`

### Cíl
`src/lib/ticket-issuer.ts` importuje `@tixly/crypto`. Vytvoříme lokálně.

### 3.1 — Vytvoř soubor
```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/lib/crypto
```

`src/lib/crypto/index.ts`:
```typescript
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'crypto';

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey(): Buffer {
  const hex = process.env.ENCRYPTION_KEY;
  if (!hex) throw new Error('ENCRYPTION_KEY not set');
  if (hex.length !== 64) return createHash('sha256').update(hex).digest();
  return Buffer.from(hex, 'hex');
}

export function encryptSecret(plaintext: string): string {
  const iv = randomBytes(IV_LEN);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, ciphertext, tag]).toString('base64');
}

export function decryptSecret(encoded: string): string {
  const buf = Buffer.from(encoded, 'base64');
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('Invalid ciphertext');
  const iv = buf.subarray(0, IV_LEN);
  const tag = buf.subarray(buf.length - TAG_LEN);
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}
```

### 3.2 — Namapuj v tsconfig.json
Přidej do `paths`:
```json
"@tixly/crypto": ["./src/lib/crypto/index.ts"]
```

### 3.3 — Namapuj v next.config.ts
Najdi blok `webpack:` a přidej alias:
```typescript
import path from 'path';

webpack: (config) => {
  config.resolve.fallback = { ...config.resolve.fallback, fs: false, path: false, os: false };
  config.resolve.alias = {
    ...config.resolve.alias,
    '@tixly/crypto': path.resolve(__dirname, 'src/lib/crypto/index.ts'),
  };
  return config;
},
```

---

<a id="krok-4"></a>
## Krok 4 — Vytvoření mock modulu `gopay-payments`

### 4.1 — Vytvoř soubory
```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/lib/gopay-mock
```

`src/lib/gopay-mock/gopay-payment.service.ts`:
```typescript
import { randomUUID } from 'crypto';

export type GopayPaymentStatus =
  | 'CREATED' | 'PAYMENT_METHOD_CHOSEN' | 'PAID'
  | 'AUTHORIZED' | 'CANCELED' | 'TIMEOUTED' | 'REFUNDED';

export interface GopayPayment {
  id: string;
  orderId: string;
  gatewayUrl: string;
  status: GopayPaymentStatus;
  amountHalire: number;
  currency: string;
  createdAt: string;
  updatedAt: string;
  paymentInstrument: string | null;
}

export interface CreatePaymentInput {
  orderId: string;
  amountHalire: number;
  currency?: string;
  buyerEmail: string;
  buyerName?: string;
  description?: string;
  returnUrl?: string;
}

export interface GopayPaymentService {
  createPayment(input: CreatePaymentInput): Promise<GopayPayment>;
  getPayment(paymentId: string): Promise<GopayPayment>;
  refundPayment(paymentId: string, amountHalire: number): Promise<GopayPayment>;
}

export function createGopayPayment(): GopayPaymentService {
  const store = new Map<string, GopayPayment>();
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL ?? 'http://localhost:3000';

  return {
    async createPayment(input: CreatePaymentInput): Promise<GopayPayment> {
      const id = `mock-pay-${randomUUID().slice(0, 8)}`;
      const now = new Date().toISOString();
      const payment: GopayPayment = {
        id,
        orderId: input.orderId,
        gatewayUrl: `${baseUrl}/mock-gopay/${id}`,
        status: 'CREATED',
        amountHalire: input.amountHalire,
        currency: input.currency ?? 'CZK',
        createdAt: now,
        updatedAt: now,
        paymentInstrument: null,
      };
      store.set(id, payment);
      return payment;
    },
    async getPayment(paymentId: string): Promise<GopayPayment> {
      const p = store.get(paymentId);
      if (!p) throw new Error(`Mock payment not found: ${paymentId}`);
      return p;
    },
    async refundPayment(paymentId: string): Promise<GopayPayment> {
      const p = store.get(paymentId);
      if (!p) throw new Error(`Mock payment not found: ${paymentId}`);
      const refunded: GopayPayment = { ...p, status: 'REFUNDED', updatedAt: new Date().toISOString() };
      store.set(paymentId, refunded);
      return refunded;
    },
  };
}
```

`src/lib/gopay-mock/service-container.ts`:
```typescript
import { Pool } from 'pg';
import { createGopayPayment, GopayPaymentService } from './gopay-payment.service';

export interface GopayServiceDeps {
  db: Pool;
  paymentService: GopayPaymentService;
}

let cached: GopayServiceDeps | null = null;

export function getServiceDeps(): GopayServiceDeps {
  if (cached) return cached;
  cached = {
    db: new Pool({ connectionString: process.env.DATABASE_URL }),
    paymentService: createGopayPayment(),
  };
  return cached;
}
```

### 4.2 — Namapuj v tsconfig.json paths
```json
"gopay-payments/services/gopay-payment.service.js": ["./src/lib/gopay-mock/gopay-payment.service.ts"],
"gopay-payments/lib/service-container.js": ["./src/lib/gopay-mock/service-container.ts"]
```

### 4.3 — Namapuj v next.config.ts webpack.alias
```typescript
'gopay-payments/services/gopay-payment.service.js': path.resolve(__dirname, 'src/lib/gopay-mock/gopay-payment.service.ts'),
'gopay-payments/lib/service-container.js': path.resolve(__dirname, 'src/lib/gopay-mock/service-container.ts'),
```

---

<a id="krok-5"></a>
## Krok 5 — Spuštění Docker služeb

### 5.1 — Spusť stack
```bash
cd C:/Users/omnia/Documents/tixly
docker compose up -d
```
První spuštění trvá 3–5 min (stahování + 142 migrací).

### 5.2 — Sleduj logy
```bash
docker compose logs -f postgres | head -200
```
Hledej: `==> DB inicializace dokončena.` (Stop: `Ctrl+C`)

### 5.3 — Ověř služby
```bash
docker compose ps
```
Všechny `Up (healthy)`: `tixly-postgres`, `tixly-redis`, `tixly-kafka`, `tixly-mailhog`.

### 5.4 — Mailhog UI
http://localhost:8025 — měl bys vidět prázdný inbox.

### ✓ Checkpoint
```bash
docker compose exec postgres psql -U tixly -d tixly -c "\dn"
```
Schémata obsahují: `identity`, `catalog`, `orders`, `tickets`, `platform`, `audit`.

---

<a id="krok-6"></a>
## Krok 6 — Seed (data + master admin + 2 promotéři)

### Cíl
Naplnit DB demo daty (500 uživatelů, 10 akcí, 300 objednávek) + vytvořit:
- Master admin (`superadmin@tixly.cz`)
- Aktivní promotér (`admin@tixly.cz` → org `Tixly Events`)
- **Pending promotér** (`pending@example.cz` → org `Pending Events`) — pro otestování schválení

### 6.1 — Aplikuj `seed.sql`
```bash
docker compose exec -T postgres psql -U tixly -d tixly < C:/Users/omnia/Documents/tixly/seed.sql
```
Trvá 10–30 sekund. Konec: `COMMIT`.

### 6.2 — Vygeneruj password hash (společný pro všechny demo účty)
```bash
cd C:/Users/omnia/Documents/tixly
node scripts/generate-password-hash.js "Demo2026!"
```
Vypíše bcrypt hash (např. `$2b$12$Abc...XYZ`). **Zkopíruj.**

### 6.3 — Vlož hash do `seed-owner.sql`
Otevři `C:/Users/omnia/Documents/tixly/scripts/seed-owner.sql`, najdi řádek (~38):
```sql
'$2b$12$717vz6ZuAMviXtxs1m7k.u0BfzuVlEaD9Q/AHxwtmRawpL3HFvB0K',
```
Nahraď svým hashem z 6.2.

### 6.4 — Aplikuj `seed-owner.sql` (aktivní promotér)
```bash
docker compose exec -T postgres psql -U tixly -d tixly < C:/Users/omnia/Documents/tixly/scripts/seed-owner.sql
```
Vytvoří `admin@tixly.cz` → org `Tixly Events` (status `active`).

### 6.5 — Přidej sloupec `is_platform_admin` + master admina + pending promotéra

Vytvoř `C:/Users/omnia/Documents/tixly/scripts/seed-platform.sql`. **POZOR**:
nahraď `<HASH_FROM_6.2>` skutečným hashem.

```sql
-- 1) Sloupec pro master admina
ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS is_platform_admin BOOLEAN NOT NULL DEFAULT FALSE;

-- 2) Master admin (superadmin@tixly.cz)
INSERT INTO identity.users (
  id, email, name, password_hash, is_platform_admin,
  gdpr_consent_at, created_at, updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000001',
  'superadmin@tixly.cz',
  'Platform Admin',
  '<HASH_FROM_6.2>',
  TRUE,
  NOW(), NOW(), NOW()
)
ON CONFLICT (email) DO UPDATE
  SET is_platform_admin = TRUE,
      password_hash = EXCLUDED.password_hash;

-- 3) Pending promotér — uživatel
INSERT INTO identity.users (
  id, email, name, password_hash,
  gdpr_consent_at, created_at, updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000002',
  'pending@example.cz',
  'Karel Pendingovič',
  '<HASH_FROM_6.2>',
  NOW(), NOW(), NOW()
)
ON CONFLICT (email) DO UPDATE SET password_hash = EXCLUDED.password_hash;

-- 4) Pending promotér — organizace (status='pending')
INSERT INTO platform.promoters (
  id, name, slug, contact_email, status,
  created_at, updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000020',
  'Pending Events s.r.o.',
  'pending-events',
  'pending@example.cz',
  'pending',
  NOW(), NOW()
)
ON CONFLICT (slug) DO UPDATE SET status = 'pending';

-- 5) Pending promotér — member link
INSERT INTO platform.promoter_members (
  promoter_id, user_id, role, created_at, updated_at
) VALUES (
  '00000000-0000-4000-a000-000000000020',
  '00000000-0000-4000-a000-000000000002',
  'owner'::platform.member_role,
  NOW(), NOW()
)
ON CONFLICT (promoter_id, user_id) DO UPDATE SET role = EXCLUDED.role;

-- 6) Event moderation — rozšíření status enum + audit log + blocklist
ALTER TABLE catalog.events DROP CONSTRAINT IF EXISTS events_status_check;
ALTER TABLE catalog.events ADD CONSTRAINT events_status_check
  CHECK (status IN ('draft', 'pending_review', 'published', 'rejected', 'flagged', 'cancelled', 'completed'));

CREATE SCHEMA IF NOT EXISTS audit;

CREATE TABLE IF NOT EXISTS audit.event_moderation_log (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id         UUID NOT NULL,
  actor_user_id    UUID,
  actor_type       TEXT NOT NULL CHECK (actor_type IN ('auto_keyword', 'auto_ai', 'human')),
  decision         TEXT NOT NULL CHECK (decision IN ('submitted', 'approved', 'rejected', 'flagged')),
  reason           TEXT,
  matched_keywords TEXT[],
  ai_score         NUMERIC(3,2),
  ai_categories    TEXT[],
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_moderation_log_event
  ON audit.event_moderation_log (event_id, created_at DESC);

CREATE TABLE IF NOT EXISTS catalog.moderation_blocklist (
  id         UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  keyword    TEXT NOT NULL UNIQUE,
  category   TEXT NOT NULL CHECK (category IN ('hate', 'extremism', 'scam', 'adult', 'violence')),
  severity   TEXT NOT NULL CHECK (severity IN ('auto_reject', 'flag_for_review')) DEFAULT 'flag_for_review',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Demo seed pro blocklist (orientační, produkce potřebuje větší + AI vrstvu)
INSERT INTO catalog.moderation_blocklist (keyword, category, severity) VALUES
  ('heil', 'extremism', 'auto_reject'),
  ('sieg heil', 'extremism', 'auto_reject'),
  ('judenfrei', 'extremism', 'auto_reject'),
  ('white power', 'hate', 'auto_reject'),
  ('hitler', 'extremism', 'flag_for_review'),
  ('nacismus', 'extremism', 'flag_for_review'),
  ('rasově čistý', 'hate', 'auto_reject'),
  ('100% zaručený zisk', 'scam', 'flag_for_review'),
  ('investiční příležitost', 'scam', 'flag_for_review'),
  ('zaručeně zbohatnout', 'scam', 'flag_for_review')
ON CONFLICT (keyword) DO NOTHING;

-- 7) Ověření
DO $$
DECLARE
  admin_count INT;
  pending_count INT;
  blocklist_count INT;
BEGIN
  SELECT COUNT(*) INTO admin_count FROM identity.users WHERE is_platform_admin = TRUE;
  SELECT COUNT(*) INTO pending_count FROM platform.promoters WHERE status = 'pending';
  SELECT COUNT(*) INTO blocklist_count FROM catalog.moderation_blocklist;
  RAISE NOTICE '✓ Master admin accounts:       %', admin_count;
  RAISE NOTICE '✓ Pending promoters:           %', pending_count;
  RAISE NOTICE '✓ Moderation blocklist entries: %', blocklist_count;
END $$;
```

Aplikuj:
```bash
docker compose exec -T postgres psql -U tixly -d tixly < C:/Users/omnia/Documents/tixly/scripts/seed-platform.sql
```

### 6.6 — Přiraď demo akce ze seedu k aktivnímu promotérovi
```bash
docker compose exec -T postgres psql -U tixly -d tixly <<'EOF'
UPDATE catalog.events
SET promoter_id = (SELECT id FROM platform.promoters WHERE slug = 'tixly-events' LIMIT 1)
WHERE promoter_id IS NULL;
EOF
```

### ✓ Checkpoint
```bash
docker compose exec postgres psql -U tixly -d tixly -c "
SELECT u.email, u.is_platform_admin, p.name AS promoter, p.status
FROM identity.users u
LEFT JOIN platform.promoter_members pm ON pm.user_id = u.id
LEFT JOIN platform.promoters p ON p.id = pm.promoter_id
WHERE u.email IN ('superadmin@tixly.cz', 'admin@tixly.cz', 'pending@example.cz')
ORDER BY u.email;
"
```

Očekávaný výstup:
```
       email         | is_platform_admin |   promoter     | status
---------------------+-------------------+----------------+--------
admin@tixly.cz       | f                 | Tixly Events   | active
pending@example.cz   | f                 | Pending Events | pending
superadmin@tixly.cz  | t                 |                |
```

---

<a id="krok-7"></a>
## Krok 7 — Auth API + role v JWT

### Cíl
JWT bude obsahovat **role** uživatele. Middleware z toho rozhodne, kam má
přístup. Routes:
- `POST /api/auth/register` — kupec
- `POST /api/auth/register-promoter` — self-service registrace promotéra (status `pending`)
- `POST /api/auth/login` — všechny role
- `POST /api/auth/refresh`

### 7.1 — `src/lib/auth.ts`

```typescript
import { SignJWT, jwtVerify, JWTPayload } from 'jose';
import { Pool } from 'pg';
import bcrypt from 'bcryptjs';

const JWT_SECRET = process.env.JWT_SECRET ?? 'dev-secret-change-me';
const ACCESS_TTL = parseInt(process.env.JWT_ACCESS_TOKEN_TTL ?? '900', 10);
const REFRESH_TTL = parseInt(process.env.JWT_REFRESH_TOKEN_TTL ?? '604800', 10);
const secretKey = new TextEncoder().encode(JWT_SECRET);

export interface PromoterMembership {
  promoterId: string;
  promoterSlug: string;
  promoterName: string;
  status: 'pending' | 'active' | 'suspended';
  role: string;
}

export interface UserRoles {
  isPlatformAdmin: boolean;
  promoterMemberships: PromoterMembership[];
}

export interface AuthUser {
  id: string;
  email: string;
  name: string;
}

let pool: Pool | null = null;
export function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function getUserRoles(userId: string): Promise<UserRoles> {
  const adminRow = await db().query<{ is_platform_admin: boolean }>(
    'SELECT is_platform_admin FROM identity.users WHERE id = $1',
    [userId],
  );
  const isPlatformAdmin = adminRow.rows[0]?.is_platform_admin ?? false;

  const memberRows = await db().query<{
    promoter_id: string; slug: string; name: string;
    status: 'pending' | 'active' | 'suspended'; role: string;
  }>(
    `SELECT pm.promoter_id, p.slug, p.name, p.status, pm.role::text AS role
     FROM platform.promoter_members pm
     JOIN platform.promoters p ON p.id = pm.promoter_id
     WHERE pm.user_id = $1`,
    [userId],
  );

  return {
    isPlatformAdmin,
    promoterMemberships: memberRows.rows.map((r) => ({
      promoterId: r.promoter_id,
      promoterSlug: r.slug,
      promoterName: r.name,
      status: r.status,
      role: r.role,
    })),
  };
}

export async function signAccessToken(user: AuthUser, roles: UserRoles): Promise<string> {
  return new SignJWT({
    sub: user.id,
    email: user.email,
    name: user.name,
    roles: {
      isPlatformAdmin: roles.isPlatformAdmin,
      promoterMemberships: roles.promoterMemberships.map((m) => ({
        promoterId: m.promoterId,
        status: m.status,
        role: m.role,
      })),
    },
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${ACCESS_TTL}s`)
    .sign(secretKey);
}

export async function signRefreshToken(user: AuthUser): Promise<string> {
  return new SignJWT({ sub: user.id, type: 'refresh' })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${REFRESH_TTL}s`)
    .sign(secretKey);
}

export async function verifyToken(token: string): Promise<JWTPayload> {
  const { payload } = await jwtVerify(token, secretKey);
  return payload;
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** Set both accessToken (cookie + JSON) and refreshToken (httpOnly cookie). */
export function setAuthCookies(
  res: import('next/server').NextResponse,
  accessToken: string,
  refreshToken: string,
): void {
  const isProd = process.env.NODE_ENV === 'production';
  res.cookies.set('accessToken', accessToken, {
    httpOnly: false, // middleware reads this; klient může číst pro fetch
    sameSite: 'lax',
    secure: isProd,
    maxAge: ACCESS_TTL,
    path: '/',
  });
  res.cookies.set('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isProd,
    maxAge: REFRESH_TTL,
    path: '/',
  });
}
```

### 7.2 — `src/app/api/auth/register/route.ts` (kupec)

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/auth/register
```

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  db, hashPassword, signAccessToken, signRefreshToken,
  setAuthCookies, getUserRoles,
} from '@/lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
});

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }
  const { email, password, name } = parsed.data;
  const hash = await hashPassword(password);

  try {
    const result = await db().query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW(), NOW())
       RETURNING id`,
      [email.toLowerCase(), name, hash],
    );
    const userId = result.rows[0]!.id;
    const user = { id: userId, email, name };
    const roles = await getUserRoles(userId);
    const accessToken = await signAccessToken(user, roles);
    const refreshToken = await signRefreshToken(user);

    const res = NextResponse.json({ user, roles, accessToken });
    setAuthCookies(res, accessToken, refreshToken);
    return res;
  } catch (err) {
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Email already registered' }, { status: 409 });
    }
    console.error('[register]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
```

### 7.3 — `src/app/api/auth/register-promoter/route.ts` (self-service)

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/auth/register-promoter
```

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  db, hashPassword, signAccessToken, signRefreshToken,
  setAuthCookies, getUserRoles,
} from '@/lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  name: z.string().min(1).max(120),
  companyName: z.string().min(2).max(200),
  slug: z.string().regex(/^[a-z0-9-]+$/, 'Pouze a-z, 0-9 a pomlčky'),
});

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }
  const { email, password, name, companyName, slug } = parsed.data;
  const hash = await hashPassword(password);
  const client = await db().connect();

  try {
    await client.query('BEGIN');

    const userRes = await client.query<{ id: string }>(
      `INSERT INTO identity.users (email, name, password_hash, gdpr_consent_at, created_at, updated_at)
       VALUES ($1, $2, $3, NOW(), NOW(), NOW())
       RETURNING id`,
      [email.toLowerCase(), name, hash],
    );
    const userId = userRes.rows[0]!.id;

    const promoterRes = await client.query<{ id: string }>(
      `INSERT INTO platform.promoters (name, slug, contact_email, status, created_at, updated_at)
       VALUES ($1, $2, $3, 'pending', NOW(), NOW())
       RETURNING id`,
      [companyName, slug, email.toLowerCase()],
    );
    const promoterId = promoterRes.rows[0]!.id;

    await client.query(
      `INSERT INTO platform.promoter_members (promoter_id, user_id, role, created_at, updated_at)
       VALUES ($1, $2, 'owner'::platform.member_role, NOW(), NOW())`,
      [promoterId, userId],
    );

    await client.query('COMMIT');

    const user = { id: userId, email, name };
    const roles = await getUserRoles(userId);
    const accessToken = await signAccessToken(user, roles);
    const refreshToken = await signRefreshToken(user);

    const res = NextResponse.json({ user, roles, promoterId, accessToken });
    setAuthCookies(res, accessToken, refreshToken);
    return res;
  } catch (err) {
    await client.query('ROLLBACK');
    if ((err as { code?: string }).code === '23505') {
      return NextResponse.json({ error: 'Email nebo slug už existuje' }, { status: 409 });
    }
    console.error('[register-promoter]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
```

### 7.4 — `src/app/api/auth/login/route.ts`

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/auth/login
```

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import {
  db, verifyPassword, signAccessToken, signRefreshToken,
  setAuthCookies, getUserRoles,
} from '@/lib/auth';

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

interface UserRow { id: string; email: string; name: string; password_hash: string; }

export async function POST(request: NextRequest): Promise<Response> {
  const body = await request.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed' }, { status: 422 });
  }
  const { email, password } = parsed.data;

  const result = await db().query<UserRow>(
    'SELECT id, email, name, password_hash FROM identity.users WHERE email = $1 LIMIT 1',
    [email.toLowerCase()],
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }
  const row = result.rows[0]!;
  if (!(await verifyPassword(password, row.password_hash))) {
    return NextResponse.json({ error: 'Invalid credentials' }, { status: 401 });
  }

  const user = { id: row.id, email: row.email, name: row.name };
  const roles = await getUserRoles(row.id);
  const accessToken = await signAccessToken(user, roles);
  const refreshToken = await signRefreshToken(user);

  const res = NextResponse.json({ user, roles, accessToken });
  setAuthCookies(res, accessToken, refreshToken);
  return res;
}
```

### 7.5 — `src/app/api/auth/refresh/route.ts`

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/auth/refresh
```

```typescript
import { NextRequest, NextResponse } from 'next/server';
import {
  db, signAccessToken, verifyToken, getUserRoles, setAuthCookies, signRefreshToken,
} from '@/lib/auth';

interface UserRow { id: string; email: string; name: string; }

export async function POST(request: NextRequest): Promise<Response> {
  const refreshToken = request.cookies.get('refreshToken')?.value;
  if (!refreshToken) return NextResponse.json({ error: 'No refresh token' }, { status: 401 });

  let payload;
  try { payload = await verifyToken(refreshToken); }
  catch { return NextResponse.json({ error: 'Invalid refresh token' }, { status: 401 }); }

  if (payload['type'] !== 'refresh' || !payload.sub) {
    return NextResponse.json({ error: 'Invalid token type' }, { status: 401 });
  }

  const result = await db().query<UserRow>(
    'SELECT id, email, name FROM identity.users WHERE id = $1 LIMIT 1',
    [payload.sub],
  );
  if (result.rows.length === 0) return NextResponse.json({ error: 'User not found' }, { status: 404 });

  const user = result.rows[0]!;
  const roles = await getUserRoles(user.id);
  const accessToken = await signAccessToken(user, roles);
  const newRefresh = await signRefreshToken(user);

  const res = NextResponse.json({ user, roles, accessToken });
  setAuthCookies(res, accessToken, newRefresh);
  return res;
}
```

---

<a id="krok-8"></a>
## Krok 8 — Role-based middleware

### Cíl
Jediný `middleware.ts` v rootu projektu, který:
- chrání `/admin/*` a `/api/admin/*` → jen uživatel s aspoň 1 promotér membership
- chrání `/platform/*` a `/api/platform/*` → jen `isPlatformAdmin = true`
- nechá veřejné: `/cs/*`, `/api/auth/*`, `/mock-gopay`, `/api/mock-gopay`, `/api/internal`

### 8.1 — Přepiš `src/middleware.ts`

> Pokud `src/middleware.ts` existuje s vlastní logikou (locale handling),
> nahraď celý obsah tímto. Ostatní logiku můžeš dodat později.

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { jwtVerify } from 'jose';

const PUBLIC_PREFIXES = [
  '/cs/login',
  '/cs/register',
  '/cs/register-promoter',
  '/cs/events',
  '/cs/order-confirmation',
  '/api/auth',
  '/api/health',
  '/api/internal',
  '/api/mock-gopay',
  '/mock-gopay',
];

const secretKey = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');

interface JWTRoles {
  isPlatformAdmin?: boolean;
  promoterMemberships?: Array<{ promoterId: string; status: string; role: string }>;
}

async function decodeRoles(token: string): Promise<JWTRoles | null> {
  try {
    const { payload } = await jwtVerify(token, secretKey);
    return ((payload as { roles?: JWTRoles }).roles) ?? {};
  } catch {
    return null;
  }
}

function getToken(req: NextRequest): string | null {
  const auth = req.headers.get('authorization');
  if (auth?.toLowerCase().startsWith('bearer ')) return auth.slice(7);
  return req.cookies.get('accessToken')?.value ?? null;
}

function deny(req: NextRequest, redirectPath?: string): NextResponse {
  const isApi = req.nextUrl.pathname.startsWith('/api/');
  if (isApi) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  const url = new URL(redirectPath ?? '/cs/login', req.url);
  url.searchParams.set('from', req.nextUrl.pathname);
  return NextResponse.redirect(url);
}

export async function middleware(req: NextRequest): Promise<NextResponse> {
  const path = req.nextUrl.pathname;

  if (path === '/' || path === '/cs') {
    return NextResponse.redirect(new URL('/cs/events', req.url));
  }

  if (PUBLIC_PREFIXES.some((p) => path === p || path.startsWith(p + '/'))) {
    return NextResponse.next();
  }

  const isPlatformPath = path.startsWith('/platform') || path.startsWith('/api/platform');
  const isAdminPath = path.startsWith('/admin') || path.startsWith('/api/admin');

  if (!isPlatformPath && !isAdminPath) {
    return NextResponse.next();
  }

  const token = getToken(req);
  if (!token) return deny(req);

  const roles = await decodeRoles(token);
  if (!roles) return deny(req);

  if (isPlatformPath) {
    if (!roles.isPlatformAdmin) return deny(req);
  } else if (isAdminPath) {
    if (!roles.promoterMemberships?.length) return deny(req);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|images|fonts).*)'],
};
```

### ✓ Checkpoint
(otestujeme po `npm run dev` v Kroku 14)

---

<a id="krok-9"></a>
## Krok 9 — Veřejné stránky (login, registrace, akce)

### Cíl
Veřejné UI: login, registrace kupce, **registrace promotéra**, seznam akcí,
detail akce, checkout. Vše pod `src/app/[locale]/...`.

### 9.1 — Locale layout

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/[locale]
```

`src/app/[locale]/layout.tsx`:
```typescript
import { ReactNode } from 'react';
import Link from 'next/link';

export default function LocaleLayout({
  children,
  params,
}: {
  children: ReactNode;
  params: { locale: string };
}) {
  return (
    <div className="min-h-screen flex flex-col">
      <header className="border-b bg-card">
        <div className="container mx-auto flex h-14 items-center justify-between px-4">
          <Link href={`/${params.locale}/events`} className="text-lg font-semibold">Tixly</Link>
          <nav className="flex items-center gap-4 text-sm">
            <Link href={`/${params.locale}/events`}>Akce</Link>
            <Link href={`/${params.locale}/login`}>Přihlásit</Link>
            <Link href={`/${params.locale}/register-promoter`} className="text-muted-foreground">Pro promotéry</Link>
            <Link href="/admin" className="text-primary">Admin</Link>
          </nav>
        </div>
      </header>
      <main className="flex-1 container mx-auto px-4 py-8">{children}</main>
      <footer className="border-t bg-card text-xs text-muted-foreground">
        <div className="container mx-auto px-4 py-3">© Tixly Demo</div>
      </footer>
    </div>
  );
}
```

### 9.2 — Seznam akcí

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/[locale]/events/[id]
```

`src/app/[locale]/events/page.tsx`:
```typescript
import Link from 'next/link';
import { Pool } from 'pg';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { formatCzechDate } from '@/lib/format';

interface EventRow { id: string; title: string; date_start: string; venue_name: string; }

async function fetchEvents(): Promise<EventRow[]> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const result = await db.query<EventRow>(`
      SELECT e.id, e.title, e.date_start, COALESCE(v.name, 'Online') AS venue_name
      FROM catalog.events e
      LEFT JOIN catalog.venues v ON v.id = e.venue_id
      JOIN platform.promoters p ON p.id = e.promoter_id
      WHERE e.date_start >= NOW() AND p.status = 'active' AND e.status = 'published'
      ORDER BY e.date_start ASC
      LIMIT 50
    `);
    return result.rows;
  } finally {
    await db.end();
  }
}

export const dynamic = 'force-dynamic';

export default async function EventsPage({ params }: { params: { locale: string } }) {
  const events = await fetchEvents();
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Nadcházející akce</h1>
        <p className="mt-2 text-sm text-muted-foreground">{events.length} akcí v prodeji</p>
      </div>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-3">
        {events.map((e) => (
          <Link key={e.id} href={`/${params.locale}/events/${e.id}`}>
            <Card className="h-full transition-shadow hover:shadow-md">
              <CardHeader>
                <CardTitle className="text-base">{e.title}</CardTitle>
                <CardDescription>{e.venue_name}</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="text-sm text-muted-foreground">{formatCzechDate(e.date_start)}</div>
              </CardContent>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
```

> **Pozn.** Pokud `catalog.events` nemá sloupec `published`, vyhoď ho z `WHERE`.
> Aplikujeme zde filtr na `p.status = 'active'`, takže akce `pending` promotérů
> se ve veřejném listu nezobrazí.

### 9.3 — Detail akce + tlačítko koupit

`src/app/[locale]/events/[id]/page.tsx`:
```typescript
import { notFound } from 'next/navigation';
import { Pool } from 'pg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { formatCzechDate, formatCzk } from '@/lib/format';
import { BuyButton } from './BuyButton';

interface EventDetail {
  id: string; title: string; description: string | null; date_start: string;
  venue_name: string; venue_address: string;
}
interface TicketType { id: string; name: string; price_halire: number; available: number; }

async function fetchDetail(id: string) {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const eventResult = await db.query<EventDetail>(`
      SELECT e.id, e.title, e.description, e.date_start,
             COALESCE(v.name, 'Online') AS venue_name,
             COALESCE(v.address, '') AS venue_address
      FROM catalog.events e
      LEFT JOIN catalog.venues v ON v.id = e.venue_id
      WHERE e.id = $1
    `, [id]);
    if (eventResult.rows.length === 0) return null;

    const ticketsResult = await db.query<TicketType>(`
      SELECT id, name, price_halire,
             COALESCE(capacity - sold, 0) AS available
      FROM catalog.ticket_types
      WHERE event_id = $1
      ORDER BY price_halire ASC
    `, [id]);

    return { event: eventResult.rows[0]!, ticketTypes: ticketsResult.rows };
  } finally { await db.end(); }
}

export const dynamic = 'force-dynamic';

export default async function EventDetailPage({ params }: { params: { locale: string; id: string } }) {
  const data = await fetchDetail(params.id);
  if (!data) notFound();
  const { event, ticketTypes } = data;
  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <h1 className="text-3xl font-bold">{event.title}</h1>
        <div className="mt-2 text-muted-foreground">{event.venue_name} · {event.venue_address}</div>
        <div className="mt-1 text-sm text-muted-foreground">{formatCzechDate(event.date_start)}</div>
        {event.description && <p className="mt-6 text-sm leading-relaxed">{event.description}</p>}
      </div>
      <div>
        <Card>
          <CardHeader><CardTitle>Vstupenky</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            {ticketTypes.length === 0 ? (
              <p className="text-sm text-muted-foreground">Žádné vstupenky v prodeji</p>
            ) : ticketTypes.map((tt) => (
              <div key={tt.id} className="flex items-center justify-between rounded-md border p-3">
                <div>
                  <div className="font-medium">{tt.name}</div>
                  <div className="text-xs text-muted-foreground">
                    {tt.available > 0 ? `${tt.available} dostupných` : 'Vyprodáno'}
                  </div>
                </div>
                <div className="text-right">
                  <div className="font-semibold">{formatCzk(tt.price_halire)}</div>
                  <BuyButton eventId={event.id} ticketTypeId={tt.id}
                    disabled={tt.available <= 0} locale={params.locale} />
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
```

`src/app/[locale]/events/[id]/BuyButton.tsx`:
```typescript
'use client';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface BuyButtonProps { eventId: string; ticketTypeId: string; disabled?: boolean; locale: string; }

export function BuyButton({ eventId, ticketTypeId, disabled, locale }: BuyButtonProps) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  function handleClick() {
    setLoading(true);
    const params = new URLSearchParams({ eventId, ticketTypeId });
    router.push(`/${locale}/checkout?${params.toString()}`);
  }
  return (
    <Button size="sm" className="mt-2" disabled={disabled || loading} onClick={handleClick}>
      {loading ? '...' : 'Koupit'}
    </Button>
  );
}
```

### 9.4 — Login

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/[locale]/login
```

`src/app/[locale]/login/page.tsx`:
```typescript
'use client';
import { FormEvent, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function LoginPage({ params }: { params: { locale: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const fromParam = searchParams.get('from');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Přihlášení selhalo');
        return;
      }
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('roles', JSON.stringify(data.roles));

      // Smart redirect podle role
      let target = fromParam;
      if (!target) {
        if (data.roles?.isPlatformAdmin) target = '/platform';
        else if (data.roles?.promoterMemberships?.length > 0) target = '/admin';
        else target = `/${params.locale}/events`;
      }
      router.push(target);
      router.refresh();
    } catch {
      setError('Síťová chyba');
    } finally { setLoading(false); }
  }

  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Přihlášení</CardTitle>
          <CardDescription>Vstup pro kupce, promotéry i master adminy.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div>
              <label className="mb-1 block text-xs font-medium">E-mail</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Heslo</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '...' : 'Přihlásit'}
            </Button>
          </form>
          <div className="mt-4 space-y-1 text-xs text-muted-foreground">
            <p>Nemáš účet? <Link href={`/${params.locale}/register`} className="text-primary hover:underline">Registrace kupujícího</Link></p>
            <p>Jsi pořadatel? <Link href={`/${params.locale}/register-promoter`} className="text-primary hover:underline">Registrace promotéra</Link></p>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 9.5 — Registrace kupce

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/[locale]/register
```

`src/app/[locale]/register/page.tsx`:
```typescript
'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

export default function RegisterPage({ params }: { params: { locale: string } }) {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [name, setName] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password, name }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Registrace selhala');
        return;
      }
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('roles', JSON.stringify(data.roles));
      router.push(`/${params.locale}/events`);
      router.refresh();
    } catch { setError('Síťová chyba'); }
    finally { setLoading(false); }
  }

  return (
    <div className="mx-auto max-w-sm">
      <Card>
        <CardHeader>
          <CardTitle>Registrace</CardTitle>
          <CardDescription>Účet pro nákup vstupenek.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="mb-1 block text-xs font-medium">Jméno</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div><label className="mb-1 block text-xs font-medium">E-mail</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div><label className="mb-1 block text-xs font-medium">Heslo (min. 8 znaků)</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '...' : 'Registrovat'}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Už máš účet? <Link href={`/${params.locale}/login`} className="text-primary hover:underline">Přihlásit</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 9.6 — Self-service registrace promotéra

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/[locale]/register-promoter
```

`src/app/[locale]/register-promoter/page.tsx`:
```typescript
'use client';
import { FormEvent, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

function slugify(s: string): string {
  return s.toLowerCase()
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '').slice(0, 60);
}

export default function RegisterPromoterPage({ params }: { params: { locale: string } }) {
  const router = useRouter();
  const [companyName, setCompanyName] = useState('');
  const [slug, setSlug] = useState('');
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const res = await fetch('/api/auth/register-promoter', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ companyName, slug: slug || slugify(companyName), name, email, password }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Registrace selhala');
        return;
      }
      const data = await res.json();
      localStorage.setItem('accessToken', data.accessToken);
      localStorage.setItem('user', JSON.stringify(data.user));
      localStorage.setItem('roles', JSON.stringify(data.roles));
      router.push('/admin');
      router.refresh();
    } catch { setError('Síťová chyba'); }
    finally { setLoading(false); }
  }

  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader>
          <CardTitle>Registrace promotéra</CardTitle>
          <CardDescription>
            Po registraci čeká účet na schválení master adminem. Akce nelze publikovat
            dokud není organizace schválena.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-3">
            <div><label className="mb-1 block text-xs font-medium">Název organizace</label>
              <Input value={companyName} onChange={(e) => {
                setCompanyName(e.target.value);
                if (!slug) setSlug(slugify(e.target.value));
              }} required /></div>
            <div><label className="mb-1 block text-xs font-medium">Slug (URL)</label>
              <Input value={slug} onChange={(e) => setSlug(e.target.value)}
                placeholder="auto-generováno z názvu" pattern="[a-z0-9-]+" /></div>
            <div><label className="mb-1 block text-xs font-medium">Tvé jméno</label>
              <Input value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div><label className="mb-1 block text-xs font-medium">E-mail</label>
              <Input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required /></div>
            <div><label className="mb-1 block text-xs font-medium">Heslo (min. 8)</label>
              <Input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required minLength={8} /></div>
            {error && <p className="text-sm text-destructive">{error}</p>}
            <Button type="submit" disabled={loading} className="w-full">
              {loading ? '...' : 'Vytvořit účet promotéra'}
            </Button>
          </form>
          <p className="mt-4 text-xs text-muted-foreground">
            Jsi kupec? <Link href={`/${params.locale}/register`} className="text-primary hover:underline">Standardní registrace</Link>
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 9.7 — Checkout + order confirmation

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/[locale]/checkout
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/[locale]/order-confirmation
```

`src/app/[locale]/checkout/page.tsx`:
```typescript
'use client';
import { useEffect, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function CheckoutPage({ params }: { params: { locale: string } }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const eventId = searchParams.get('eventId');
  const ticketTypeId = searchParams.get('ticketTypeId');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const token = typeof window !== 'undefined' ? localStorage.getItem('accessToken') : null;
    if (!token) {
      router.replace(`/${params.locale}/login?from=${encodeURIComponent(window.location.pathname + window.location.search)}`);
    }
  }, [router, params.locale]);

  async function handleConfirm() {
    setError(null); setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/checkout', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          eventId,
          items: [{ ticketTypeId, quantity: 1 }],
          paymentMethod: 'gopay',
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? data.message ?? `Checkout selhal (${res.status})`);
        return;
      }
      const data = await res.json();
      if (data.gatewayUrl) window.location.href = data.gatewayUrl;
      else router.push(`/${params.locale}/order-confirmation?orderId=${data.orderId}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Síťová chyba');
    } finally { setLoading(false); }
  }

  if (!eventId || !ticketTypeId) {
    return <p className="text-sm text-destructive">Chybějící parametry</p>;
  }
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader><CardTitle>Potvrzení objednávky</CardTitle></CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">
            Po kliknutí na „Pokračovat k platbě" budeš přesměrován na platební bránu.
          </p>
          {error && <p className="mt-3 text-sm text-destructive">{error}</p>}
          <Button onClick={handleConfirm} disabled={loading} className="mt-4 w-full">
            {loading ? '...' : 'Pokračovat k platbě'}
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
```

`src/app/[locale]/order-confirmation/page.tsx`:
```typescript
import Link from 'next/link';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { CheckCircle2 } from 'lucide-react';

export default function OrderConfirmationPage({
  searchParams, params,
}: { searchParams: { orderId?: string }; params: { locale: string } }) {
  return (
    <div className="mx-auto max-w-md">
      <Card>
        <CardHeader className="text-center">
          <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-600" aria-hidden />
          <CardTitle className="mt-2">Objednávka přijata</CardTitle>
        </CardHeader>
        <CardContent className="text-center text-sm text-muted-foreground">
          {searchParams.orderId && <p className="mb-4">Číslo: <span className="font-mono">{searchParams.orderId}</span></p>}
          <p>Vstupenku ti pošleme e-mailem.</p>
          <Link href={`/${params.locale}/events`} className="mt-4 inline-block text-primary hover:underline">
            ← Zpět na seznam akcí
          </Link>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

<a id="krok-10"></a>
## Krok 10 — Promotér: tvorba akce přes UI

### Cíl
- `GET /api/admin/venues` — list dostupných míst pro dropdown
- `POST /api/admin/events` — vytvoří akci v transakci s ticket types
- `/admin/events/new` — formulář s dynamickými řádky pro ticket types
- Banner v `/admin` ukazující pending status (pokud promotér čeká na schválení)

### 10.1 — Helper pro získání promoter_id z JWT

`src/lib/admin-auth.ts`:
```typescript
import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');

export interface RequestPromoter {
  userId: string;
  promoterId: string;
  status: 'pending' | 'active' | 'suspended';
  role: string;
}

export async function requirePromoter(req: NextRequest): Promise<RequestPromoter | null> {
  const auth = req.headers.get('authorization');
  const token = auth?.toLowerCase().startsWith('bearer ')
    ? auth.slice(7)
    : req.cookies.get('accessToken')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey);
    const sub = payload.sub as string | undefined;
    const roles = (payload as { roles?: { promoterMemberships?: Array<{ promoterId: string; status: 'pending' | 'active' | 'suspended'; role: string }> } }).roles;
    const m = roles?.promoterMemberships?.[0];
    if (!sub || !m) return null;
    return { userId: sub, promoterId: m.promoterId, status: m.status, role: m.role };
  } catch {
    return null;
  }
}
```

### 10.2 — `GET /api/admin/venues`

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/admin/venues
```

`src/app/api/admin/venues/route.ts`:
```typescript
import { NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface VenueRow { id: string; name: string; address: string | null; }

export async function GET(): Promise<Response> {
  const result = await db().query<VenueRow>(
    'SELECT id, name, address FROM catalog.venues ORDER BY name LIMIT 100'
  );
  return NextResponse.json({ venues: result.rows });
}
```

### 10.3 — `POST /api/admin/events`

`src/app/api/admin/events/route.ts` (vytvoření; pokud existuje GET, doplň POST handler vedle něj):

```typescript
import { NextRequest, NextResponse } from 'next/server';
import { z } from 'zod';
import { Pool } from 'pg';
import { requirePromoter } from '@/lib/admin-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const ticketTypeSchema = z.object({
  name: z.string().min(1).max(100),
  priceHalire: z.number().int().min(0),
  capacity: z.number().int().min(1).max(100000),
});

const schema = z.object({
  title: z.string().min(2).max(200),
  description: z.string().max(5000).optional(),
  dateStart: z.string().datetime(),
  venueId: z.string().uuid().nullable().optional(),
  ticketTypes: z.array(ticketTypeSchema).min(1).max(10),
});

export async function POST(req: NextRequest): Promise<Response> {
  const promoter = await requirePromoter(req);
  if (!promoter) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  if (promoter.status !== 'active') {
    return NextResponse.json(
      { error: `Tvůj promotér účet má status "${promoter.status}". Akce může vytvořit jen schválený promotér.` },
      { status: 403 },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Validation failed', issues: parsed.error.issues }, { status: 422 });
  }
  const input = parsed.data;
  const client = await db().connect();

  try {
    await client.query('BEGIN');

    // === Vrstva 1: keyword blocklist scan ===
    const haystack = [
      input.title,
      input.description ?? '',
      ...input.ticketTypes.map((t) => t.name),
    ].join(' ').toLowerCase();

    const blocklistRes = await client.query<{ keyword: string; category: string; severity: string }>(
      `SELECT keyword, category, severity FROM catalog.moderation_blocklist`,
    );
    const matched = blocklistRes.rows.filter((row) => haystack.includes(row.keyword.toLowerCase()));
    const autoReject = matched.some((m) => m.severity === 'auto_reject');
    const flagForReview = matched.some((m) => m.severity === 'flag_for_review');

    // Default: pending_review (vrstva 3 — lidská kontrola). auto_reject = okamžité zamítnutí.
    const initialStatus = autoReject ? 'rejected' : 'pending_review';

    const eventRes = await client.query<{ id: string }>(
      `INSERT INTO catalog.events (
         promoter_id, title, description, date_start, venue_id, status, created_at, updated_at
       ) VALUES ($1, $2, $3, $4, $5, $6, NOW(), NOW())
       RETURNING id`,
      [promoter.promoterId, input.title, input.description ?? null, input.dateStart, input.venueId ?? null, initialStatus],
    );
    const eventId = eventRes.rows[0]!.id;

    for (const tt of input.ticketTypes) {
      await client.query(
        `INSERT INTO catalog.ticket_types (event_id, name, price_halire, capacity, sold, created_at, updated_at)
         VALUES ($1, $2, $3, $4, 0, NOW(), NOW())`,
        [eventId, tt.name, tt.priceHalire, tt.capacity],
      );
    }

    // === Audit log (DSA compliance — povinný legal trail) ===
    await client.query(
      `INSERT INTO audit.event_moderation_log
         (event_id, actor_user_id, actor_type, decision, reason, matched_keywords)
       VALUES ($1, $2, 'auto_keyword', $3, $4, $5)`,
      [
        eventId,
        promoter.userId,
        autoReject ? 'rejected' : 'submitted',
        autoReject
          ? `Auto-reject: keyword(s) ${matched.filter((m) => m.severity === 'auto_reject').map((m) => m.keyword).join(', ')}`
          : flagForReview
            ? `Flagged for review: ${matched.map((m) => m.keyword).join(', ')}`
            : 'Submitted for review (default policy)',
        matched.map((m) => m.keyword),
      ],
    );

    await client.query('COMMIT');
    return NextResponse.json(
      {
        eventId,
        status: initialStatus,
        message: autoReject
          ? 'Akce byla automaticky zamítnuta kvůli zakázanému obsahu. Pro vysvětlení kontaktuj support.'
          : 'Akce čeká na schválení master adminem. Po schválení půjde do prodeje.',
      },
      { status: 201 },
    );
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[POST /api/admin/events]', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  } finally {
    client.release();
  }
}
```

> **Pozn. ke schématu:** `catalog.events` musí mít sloupec `status` s rozšířeným enum
> (viz Krok 6.5 — `pending_review`, `rejected`, `flagged`). `requirePromoter` musí
> vracet i `userId` (nejen `promoterId`) — pokud ne, doplň ho do `lib/admin-auth.ts`.

### 10.4 — Stránka `/admin/events/new`

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/admin/events/new
```

`src/app/admin/events/new/page.tsx`:
```typescript
'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

interface Venue { id: string; name: string; }
interface TicketTypeRow { name: string; priceCzk: string; capacity: string; }

export default function NewEventPage() {
  const router = useRouter();
  const [venues, setVenues] = useState<Venue[]>([]);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [dateStart, setDateStart] = useState('');
  const [venueId, setVenueId] = useState<string>('');
  const [ticketTypes, setTicketTypes] = useState<TicketTypeRow[]>([
    { name: 'Standard', priceCzk: '500', capacity: '100' },
  ]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/admin/venues')
      .then((r) => r.json())
      .then((d) => setVenues(d.venues ?? []))
      .catch(() => setVenues([]));
  }, []);

  function updateRow(idx: number, patch: Partial<TicketTypeRow>) {
    setTicketTypes((prev) => prev.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  }
  function addRow() { setTicketTypes((prev) => [...prev, { name: '', priceCzk: '0', capacity: '100' }]); }
  function removeRow(idx: number) { setTicketTypes((prev) => prev.filter((_, i) => i !== idx)); }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null); setLoading(true);
    try {
      const token = localStorage.getItem('accessToken');
      const res = await fetch('/api/admin/events', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify({
          title,
          description: description || undefined,
          dateStart: new Date(dateStart).toISOString(),
          venueId: venueId || null,
          ticketTypes: ticketTypes.map((r) => ({
            name: r.name,
            priceHalire: Math.round(parseFloat(r.priceCzk) * 100),
            capacity: parseInt(r.capacity, 10),
          })),
        }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? 'Vytvoření selhalo');
        return;
      }
      router.push('/admin/events');
      router.refresh();
    } catch { setError('Síťová chyba'); }
    finally { setLoading(false); }
  }

  return (
    <div className="mx-auto max-w-2xl">
      <Card>
        <CardHeader><CardTitle>Nová akce</CardTitle></CardHeader>
        <CardContent>
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="mb-1 block text-xs font-medium">Název akce</label>
              <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={2} />
            </div>
            <div>
              <label className="mb-1 block text-xs font-medium">Popis</label>
              <textarea
                className="flex min-h-20 w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={description} onChange={(e) => setDescription(e.target.value)} />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="mb-1 block text-xs font-medium">Datum a čas</label>
                <Input type="datetime-local" value={dateStart} onChange={(e) => setDateStart(e.target.value)} required />
              </div>
              <div>
                <label className="mb-1 block text-xs font-medium">Místo</label>
                <select className="flex h-10 w-full rounded-md border border-input bg-background px-3 text-sm"
                  value={venueId} onChange={(e) => setVenueId(e.target.value)}>
                  <option value="">— online / bez místa —</option>
                  {venues.map((v) => <option key={v.id} value={v.id}>{v.name}</option>)}
                </select>
              </div>
            </div>

            <div>
              <div className="mb-2 flex items-center justify-between">
                <label className="text-xs font-medium">Typy vstupenek</label>
                <Button type="button" size="sm" variant="outline" onClick={addRow}>+ Přidat</Button>
              </div>
              <div className="space-y-2">
                {ticketTypes.map((row, idx) => (
                  <div key={idx} className="grid grid-cols-12 gap-2">
                    <Input className="col-span-5" placeholder="Název (např. Standard)"
                      value={row.name} onChange={(e) => updateRow(idx, { name: e.target.value })} required />
                    <Input className="col-span-3" type="number" min="0" step="0.01" placeholder="Cena Kč"
                      value={row.priceCzk} onChange={(e) => updateRow(idx, { priceCzk: e.target.value })} required />
                    <Input className="col-span-3" type="number" min="1" placeholder="Kapacita"
                      value={row.capacity} onChange={(e) => updateRow(idx, { capacity: e.target.value })} required />
                    <Button type="button" variant="ghost" size="sm" className="col-span-1"
                      onClick={() => removeRow(idx)} disabled={ticketTypes.length === 1}>×</Button>
                  </div>
                ))}
              </div>
            </div>

            {error && <p className="text-sm text-destructive">{error}</p>}
            <div className="flex gap-2">
              <Button type="submit" disabled={loading}>{loading ? '...' : 'Vytvořit akci'}</Button>
              <Button type="button" variant="outline" onClick={() => router.push('/admin/events')}>Zrušit</Button>
            </div>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 10.5 — Tlačítko „Nová akce" na `/admin/events`

Otevři `src/app/admin/events/page.tsx` a v hlavičce stránky vedle nadpisu
přidej tlačítko (importuj `Link` z `next/link` a `Button` z `@/components/ui/button`):
```tsx
<div className="flex items-center justify-between">
  <PageHeader title="Akce" subtitle="Tvé připravené akce" />
  <Link href="/admin/events/new">
    <Button>+ Nová akce</Button>
  </Link>
</div>
```

### 10.6 — Pending banner v `/admin` layoutu

V `src/app/admin/layout.tsx` přidej nad `<main>` banner, pokud má uživatel
v `localStorage.roles` membership se status `pending`:

`src/components/admin/PendingBanner.tsx`:
```typescript
'use client';
import { useEffect, useState } from 'react';

export function PendingBanner() {
  const [show, setShow] = useState(false);
  useEffect(() => {
    try {
      const raw = localStorage.getItem('roles');
      if (!raw) return;
      const r = JSON.parse(raw);
      const m = r?.promoterMemberships?.[0];
      setShow(m?.status === 'pending');
    } catch {}
  }, []);
  if (!show) return null;
  return (
    <div className="border-b border-amber-300 bg-amber-50 px-6 py-2 text-sm text-amber-900">
      ⏳ Tvůj účet promotéra <strong>čeká na schválení</strong> master adminem. Akce zatím nelze publikovat.
    </div>
  );
}
```

A v `src/app/admin/layout.tsx`:
```typescript
import { PendingBanner } from '@/components/admin/PendingBanner';
// ...
<div className="flex min-w-0 flex-1 flex-col">
  <Topbar title="Tixly Admin" subtitle="Promotér" />
  <PendingBanner />
  <main className="flex-1 overflow-y-auto p-6">{children}</main>
</div>
```

---

<a id="krok-11"></a>
## Krok 11 — Master admin: schvalování promotérů

### Cíl
- `/platform` layout + dashboard (počty pending / active / suspended)
- `/platform/promoters` — tabulka všech promotérů s tlačítky **Schválit / Pozastavit**
- `GET /api/platform/promoters`
- `POST /api/platform/promoters/[id]/approve`
- `POST /api/platform/promoters/[id]/suspend`

### 11.1 — Helper pro check master admina

`src/lib/platform-auth.ts`:
```typescript
import { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

const secretKey = new TextEncoder().encode(process.env.JWT_SECRET ?? 'dev-secret-change-me');

export async function requirePlatformAdmin(req: NextRequest): Promise<{ userId: string } | null> {
  const auth = req.headers.get('authorization');
  const token = auth?.toLowerCase().startsWith('bearer ')
    ? auth.slice(7)
    : req.cookies.get('accessToken')?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey);
    const roles = (payload as { roles?: { isPlatformAdmin?: boolean } }).roles;
    if (!roles?.isPlatformAdmin) return null;
    const sub = payload.sub as string | undefined;
    if (!sub) return null;
    return { userId: sub };
  } catch { return null; }
}
```

### 11.2 — API: list / approve / suspend

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/platform/promoters/[id]/approve
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/platform/promoters/[id]/suspend
```

`src/app/api/platform/promoters/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface PromoterRow {
  id: string; name: string; slug: string; contact_email: string;
  status: 'pending' | 'active' | 'suspended';
  member_count: string; event_count: string;
  created_at: string;
}

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await db().query<PromoterRow>(`
    SELECT p.id, p.name, p.slug, p.contact_email, p.status,
           COALESCE(m.cnt, 0)::text AS member_count,
           COALESCE(e.cnt, 0)::text AS event_count,
           p.created_at
    FROM platform.promoters p
    LEFT JOIN (SELECT promoter_id, COUNT(*) cnt FROM platform.promoter_members GROUP BY promoter_id) m ON m.promoter_id = p.id
    LEFT JOIN (SELECT promoter_id, COUNT(*) cnt FROM catalog.events GROUP BY promoter_id) e ON e.promoter_id = p.id
    ORDER BY p.created_at DESC
    LIMIT 200
  `);

  return NextResponse.json({ promoters: result.rows });
}
```

`src/app/api/platform/promoters/[id]/approve/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await db().query<{ id: string; status: string }>(
    `UPDATE platform.promoters SET status = 'active', updated_at = NOW()
     WHERE id = $1 RETURNING id, status`,
    [params.id],
  );
  if (result.rows.length === 0) {
    return NextResponse.json({ error: 'Not found' }, { status: 404 });
  }
  return NextResponse.json({ promoter: result.rows[0] });
}
```

`src/app/api/platform/promoters/[id]/suspend/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(req: NextRequest, { params }: { params: { id: string } }): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await db().query<{ id: string; status: string }>(
    `UPDATE platform.promoters SET status = 'suspended', updated_at = NOW()
     WHERE id = $1 RETURNING id, status`,
    [params.id],
  );
  if (result.rows.length === 0) return NextResponse.json({ error: 'Not found' }, { status: 404 });
  return NextResponse.json({ promoter: result.rows[0] });
}
```

### 11.3 — Platform layout + sidebar

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/platform/promoters
```

`src/components/platform/PlatformSidebar.tsx`:
```typescript
'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { ShieldCheck, Building2 } from 'lucide-react';

const items = [
  { href: '/platform', label: 'Dashboard', icon: ShieldCheck },
  { href: '/platform/promoters', label: 'Promotéři', icon: Building2 },
];

export function PlatformSidebar() {
  const path = usePathname();
  return (
    <aside className="w-56 shrink-0 border-r bg-card">
      <div className="border-b px-4 py-3">
        <div className="text-xs font-semibold uppercase text-muted-foreground">Tixly Platform</div>
        <div className="text-sm font-medium">Master Admin</div>
      </div>
      <nav className="space-y-1 p-2 text-sm">
        {items.map((it) => {
          const Icon = it.icon;
          const active = path === it.href || path.startsWith(it.href + '/');
          return (
            <Link key={it.href} href={it.href}
              className={`flex items-center gap-2 rounded-md px-3 py-2 ${active ? 'bg-accent font-medium' : 'hover:bg-accent/50'}`}>
              <Icon className="h-4 w-4" /> {it.label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
```

`src/app/platform/layout.tsx`:
```typescript
import { ReactNode } from 'react';
import { PlatformSidebar } from '@/components/platform/PlatformSidebar';

export default function PlatformLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-background">
      <PlatformSidebar />
      <main className="flex-1 overflow-y-auto p-6">{children}</main>
    </div>
  );
}
```

### 11.4 — Platform dashboard

`src/app/platform/page.tsx`:
```typescript
import { Pool } from 'pg';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';

interface Counts { pending: number; active: number; suspended: number; total_events: number; }

async function fetchCounts(): Promise<Counts> {
  const db = new Pool({ connectionString: process.env.DATABASE_URL });
  try {
    const r = await db.query<Counts>(`
      SELECT
        COUNT(*) FILTER (WHERE p.status='pending')::int AS pending,
        COUNT(*) FILTER (WHERE p.status='active')::int AS active,
        COUNT(*) FILTER (WHERE p.status='suspended')::int AS suspended,
        (SELECT COUNT(*)::int FROM catalog.events) AS total_events
      FROM platform.promoters p
    `);
    return r.rows[0]!;
  } finally { await db.end(); }
}

export const dynamic = 'force-dynamic';

export default async function PlatformDashboard() {
  const c = await fetchCounts();
  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Platform overview</h1>
      <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Pending</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-amber-600">{c.pending}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Active</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-emerald-600">{c.active}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Suspended</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold text-rose-600">{c.suspended}</div></CardContent></Card>
        <Card><CardHeader><CardTitle className="text-sm text-muted-foreground">Akcí celkem</CardTitle></CardHeader>
          <CardContent><div className="text-3xl font-bold">{c.total_events}</div></CardContent></Card>
      </div>
    </div>
  );
}
```

### 11.5 — `/platform/promoters` (seznam s akcemi)

`src/app/platform/promoters/page.tsx`:
```typescript
'use client';

import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

interface Promoter {
  id: string; name: string; slug: string; contact_email: string;
  status: 'pending' | 'active' | 'suspended';
  member_count: string; event_count: string;
}

export default function PlatformPromotersPage() {
  const [items, setItems] = useState<Promoter[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  async function load() {
    setError(null);
    try {
      const res = await fetch('/api/platform/promoters');
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = await res.json();
      setItems(data.promoters ?? []);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
  }

  useEffect(() => { load(); }, []);

  async function action(id: string, kind: 'approve' | 'suspend') {
    setBusyId(id);
    try {
      const res = await fetch(`/api/platform/promoters/${id}/${kind}`, { method: 'POST' });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data.error ?? `HTTP ${res.status}`);
      }
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); }
    finally { setBusyId(null); }
  }

  function statusBadge(s: Promoter['status']) {
    const colors = {
      pending: 'bg-amber-100 text-amber-800',
      active: 'bg-emerald-100 text-emerald-800',
      suspended: 'bg-rose-100 text-rose-800',
    };
    return <span className={`rounded-full px-2 py-0.5 text-xs ${colors[s]}`}>{s}</span>;
  }

  return (
    <div className="space-y-6">
      <h1 className="text-3xl font-bold">Promotéři</h1>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Card>
        <CardHeader><CardTitle>Všichni promotéři ({items.length})</CardTitle></CardHeader>
        <CardContent>
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-xs uppercase text-muted-foreground">
                <th className="py-2">Název</th>
                <th>E-mail</th>
                <th>Status</th>
                <th>Členů</th>
                <th>Akcí</th>
                <th className="text-right">Akce</th>
              </tr>
            </thead>
            <tbody>
              {items.map((p) => (
                <tr key={p.id} className="border-b">
                  <td className="py-2 font-medium">{p.name}<div className="text-xs text-muted-foreground">{p.slug}</div></td>
                  <td>{p.contact_email}</td>
                  <td>{statusBadge(p.status)}</td>
                  <td>{p.member_count}</td>
                  <td>{p.event_count}</td>
                  <td className="text-right">
                    {p.status !== 'active' && (
                      <Button size="sm" onClick={() => action(p.id, 'approve')} disabled={busyId === p.id} className="mr-2">
                        Schválit
                      </Button>
                    )}
                    {p.status !== 'suspended' && (
                      <Button size="sm" variant="outline" onClick={() => action(p.id, 'suspend')} disabled={busyId === p.id}>
                        Pozastavit
                      </Button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </CardContent>
      </Card>
    </div>
  );
}
```

---

<a id="krok-12"></a>
## Krok 12 — Moderace akcí (keyword blocklist + lidský review)

### Cíl
Žádná akce nesmí jít do prodeje bez schválení. 3 vrstvy obrany:

1. **Vrstva 1 — Keyword blocklist** (auto, už hotová v Kroku 10.3): při vytvoření
   akce promotérem se naskenují title + description + ticket type names. Zásah do
   `auto_reject` keywordu → `status='rejected'`. Zásah do `flag_for_review`
   keywordu → `status='pending_review'` + flag pro lidskou kontrolu.
2. **Vrstva 2 — AI gate** (placeholder, do produkce): Claude moderation API.
   V demu necháváme jen vrstvy 1 + 3.
3. **Vrstva 3 — Lidská fronta** (tato sekce): master admin v `/platform/event-moderation`
   vidí všechno v `pending_review` + `flagged`, klikem schválí (`status='published'`)
   nebo zamítne (`status='rejected'`) s důvodem do `audit.event_moderation_log`.

**Proč to musí být v MVP:**
- DSA (EU 2022/2065) — povinný legal trail rozhodnutí + možnost odvolání.
- Trestní zákoník §403–405 (propagace hnutí směřujících k potlačení práv) — Tixly by
  bylo spolupachatelem, kdyby sneslo „Heil koncert" online.
- Visa/MC AUP + GoPay smlouva — okamžité ukončení MID za hate content.

### 12.1 — `GET /api/platform/moderation/queue`

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/platform/moderation/queue
```

`src/app/api/platform/moderation/queue/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface QueueRow {
  id: string;
  title: string;
  description: string | null;
  date_start: string;
  status: string;
  created_at: string;
  promoter_name: string;
  promoter_slug: string;
  matched_keywords: string[] | null;
  reason: string | null;
}

export async function GET(req: NextRequest): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const result = await db().query<QueueRow>(`
    SELECT
      e.id, e.title, e.description, e.date_start, e.status, e.created_at,
      p.name AS promoter_name, p.slug AS promoter_slug,
      latest.matched_keywords, latest.reason
    FROM catalog.events e
    JOIN platform.promoters p ON p.id = e.promoter_id
    LEFT JOIN LATERAL (
      SELECT matched_keywords, reason
      FROM audit.event_moderation_log
      WHERE event_id = e.id
      ORDER BY created_at DESC
      LIMIT 1
    ) latest ON TRUE
    WHERE e.status IN ('pending_review', 'flagged')
    ORDER BY e.created_at DESC
    LIMIT 100
  `);

  return NextResponse.json({ items: result.rows });
}
```

### 12.2 — `POST /api/platform/moderation/[eventId]/approve` + `/reject`

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/platform/moderation/[eventId]/approve
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/platform/moderation/[eventId]/reject
```

`src/app/api/platform/moderation/[eventId]/approve/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

export async function POST(
  req: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE catalog.events
         SET status = 'published', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending_review', 'flagged')
       RETURNING id`,
      [params.eventId],
    );
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Event not in review state' }, { status: 409 });
    }
    await client.query(
      `INSERT INTO audit.event_moderation_log
         (event_id, actor_user_id, actor_type, decision, reason)
       VALUES ($1, $2, 'human', 'approved', 'Manuálně schváleno master adminem')`,
      [params.eventId, admin.userId],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[moderation/approve]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  } finally {
    client.release();
  }
}
```

`src/app/api/platform/moderation/[eventId]/reject/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';
import { z } from 'zod';
import { requirePlatformAdmin } from '@/lib/platform-auth';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

const schema = z.object({ reason: z.string().min(3).max(1000) });

export async function POST(
  req: NextRequest,
  { params }: { params: { eventId: string } },
): Promise<Response> {
  const admin = await requirePlatformAdmin(req);
  if (!admin) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const body = await req.json().catch(() => null);
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Reason required (min 3 chars)' }, { status: 422 });
  }

  const client = await db().connect();
  try {
    await client.query('BEGIN');
    const upd = await client.query(
      `UPDATE catalog.events
         SET status = 'rejected', updated_at = NOW()
       WHERE id = $1 AND status IN ('pending_review', 'flagged')
       RETURNING id`,
      [params.eventId],
    );
    if (upd.rowCount === 0) {
      await client.query('ROLLBACK');
      return NextResponse.json({ error: 'Event not in review state' }, { status: 409 });
    }
    await client.query(
      `INSERT INTO audit.event_moderation_log
         (event_id, actor_user_id, actor_type, decision, reason)
       VALUES ($1, $2, 'human', 'rejected', $3)`,
      [params.eventId, admin.userId, parsed.data.reason],
    );
    await client.query('COMMIT');
    return NextResponse.json({ ok: true });
  } catch (err) {
    await client.query('ROLLBACK');
    console.error('[moderation/reject]', err);
    return NextResponse.json({ error: 'Internal error' }, { status: 500 });
  } finally {
    client.release();
  }
}
```

### 12.3 — Stránka `/platform/event-moderation`

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/platform/event-moderation
```

`src/app/platform/event-moderation/page.tsx`:
```typescript
'use client';
import { useEffect, useState } from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { formatCzechDate } from '@/lib/format';

interface QueueItem {
  id: string;
  title: string;
  description: string | null;
  date_start: string;
  status: string;
  created_at: string;
  promoter_name: string;
  promoter_slug: string;
  matched_keywords: string[] | null;
  reason: string | null;
}

export default function EventModerationPage() {
  const [items, setItems] = useState<QueueItem[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  async function load(): Promise<void> {
    try {
      const res = await fetch('/api/platform/moderation/queue');
      if (!res.ok) throw new Error(`${res.status}`);
      const data = await res.json();
      setItems(data.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba načítání');
    }
  }

  useEffect(() => { void load(); }, []);

  async function approve(id: string): Promise<void> {
    setBusyId(id); setError(null);
    try {
      const res = await fetch(`/api/platform/moderation/${id}/approve`, { method: 'POST' });
      if (!res.ok) throw new Error(`${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally { setBusyId(null); }
  }

  async function reject(id: string): Promise<void> {
    const reason = window.prompt('Důvod zamítnutí (povinné, min 3 znaky):');
    if (!reason || reason.trim().length < 3) return;
    setBusyId(id); setError(null);
    try {
      const res = await fetch(`/api/platform/moderation/${id}/reject`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      if (!res.ok) throw new Error(`${res.status}`);
      await load();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Chyba');
    } finally { setBusyId(null); }
  }

  function toggle(id: string): void {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold">Moderace akcí</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Akce čekající na schválení. Po schválení jdou do prodeje na `/cs/events`.
        </p>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      {items.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-muted-foreground">
            Fronta je prázdná. Všechno schváleno.
          </CardContent>
        </Card>
      ) : (
        items.map((item) => (
          <Card key={item.id}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{item.title}</span>
                <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">
                  {item.status}
                </span>
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="grid grid-cols-2 gap-2 text-xs text-muted-foreground">
                <div><strong>Promotér:</strong> {item.promoter_name} ({item.promoter_slug})</div>
                <div><strong>Datum akce:</strong> {formatCzechDate(item.date_start)}</div>
                <div><strong>Vytvořeno:</strong> {formatCzechDate(item.created_at)}</div>
                <div><strong>Důvod fronty:</strong> {item.reason ?? '—'}</div>
              </div>
              {item.matched_keywords && item.matched_keywords.length > 0 && (
                <div className="rounded bg-rose-50 p-2 text-xs">
                  <strong className="text-rose-800">Zachycené keywords:</strong>{' '}
                  {item.matched_keywords.join(', ')}
                </div>
              )}
              {item.description && (
                <div>
                  <button
                    type="button"
                    className="text-xs text-blue-600 underline"
                    onClick={() => toggle(item.id)}
                  >
                    {expanded.has(item.id) ? 'Skrýt' : 'Zobrazit'} popis
                  </button>
                  {expanded.has(item.id) && (
                    <p className="mt-2 whitespace-pre-wrap rounded bg-muted p-3 text-xs">
                      {item.description}
                    </p>
                  )}
                </div>
              )}
              <div className="flex gap-2 pt-2">
                <Button onClick={() => approve(item.id)} disabled={busyId === item.id}>
                  Schválit
                </Button>
                <Button
                  variant="outline"
                  onClick={() => reject(item.id)}
                  disabled={busyId === item.id}
                >
                  Zamítnout
                </Button>
              </div>
            </CardContent>
          </Card>
        ))
      )}
    </div>
  );
}
```

### 12.4 — Přidat položku do PlatformSidebar

V `src/components/platform/PlatformSidebar.tsx` doplň do menu (vedle „Promotéři"):

```typescript
import { FileSearch } from 'lucide-react';
// ...
{ href: '/platform/event-moderation', label: 'Moderace akcí', icon: FileSearch },
```

### 12.5 — Status badge na `/admin/events`

V `src/app/admin/events/page.tsx` (seznam akcí promotéra) přidej barevný badge:

```typescript
function statusBadge(s: string) {
  const map: Record<string, string> = {
    draft: 'bg-gray-100 text-gray-700',
    pending_review: 'bg-amber-100 text-amber-800',
    published: 'bg-emerald-100 text-emerald-800',
    rejected: 'bg-rose-100 text-rose-800',
    flagged: 'bg-orange-100 text-orange-800',
    cancelled: 'bg-slate-100 text-slate-600',
    completed: 'bg-blue-100 text-blue-700',
  };
  const label: Record<string, string> = {
    pending_review: 'Čeká na schválení',
    published: 'V prodeji',
    rejected: 'Zamítnuto',
    flagged: 'Označeno',
  };
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs ${map[s] ?? 'bg-gray-100'}`}>
      {label[s] ?? s}
    </span>
  );
}
```

### ✓ Test blocklist scanu (proběhne v Kroku 15)

Vytvoříš dvě akce promotérem:
- **„Demo koncert"** → match 0 → `pending_review` → master admin schválí.
- **„Heil koncert"** → match `heil` (auto_reject) → okamžitě `rejected` + log.
  V `/admin/events` vidí promotér červený badge **Zamítnuto**.

---

<a id="krok-13"></a>
## Krok 13 — Mock platební stránka

### Cíl
Mock GoPay → `/mock-gopay/[paymentId]` se 2 tlačítky (**Zaplatit / Zrušit**).
„Zaplatit" označí order paid + zavolá interní webhook (e-mail s lístkem).

### 13.1 — Stránka mock platby

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/mock-gopay/[paymentId]
```

`src/app/mock-gopay/[paymentId]/page.tsx`:
```typescript
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card';
import { Button } from '@/components/ui/button';

export default function MockPaymentPage({ params }: { params: { paymentId: string } }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleAction(action: 'pay' | 'cancel') {
    setLoading(true); setError(null);
    try {
      const res = await fetch(`/api/mock-gopay/${params.paymentId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        setError(data.error ?? `${res.status}`);
        return;
      }
      const data = await res.json();
      if (action === 'pay') router.push(`/cs/order-confirmation?orderId=${data.orderId}`);
      else router.push(`/cs/events`);
    } catch { setError('Síťová chyba'); }
    finally { setLoading(false); }
  }

  return (
    <div className="mx-auto mt-12 max-w-md px-4">
      <Card>
        <CardHeader>
          <CardTitle>Mock GoPay brána</CardTitle>
          <CardDescription>Lokální simulace platby. V produkci jdeš na skutečnou GoPay.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-xs text-muted-foreground">Payment ID: {params.paymentId}</p>
          {error && <p className="text-sm text-destructive">{error}</p>}
          <div className="flex gap-2">
            <Button onClick={() => handleAction('pay')} disabled={loading} className="flex-1">
              {loading ? '...' : 'Zaplatit'}
            </Button>
            <Button onClick={() => handleAction('cancel')} disabled={loading} variant="outline" className="flex-1">
              Zrušit
            </Button>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
```

### 13.2 — Mock GoPay API endpoint

```bash
mkdir -p C:/Users/omnia/Documents/tixly/nextjs-boilerplate/src/app/api/mock-gopay/[paymentId]
```

`src/app/api/mock-gopay/[paymentId]/route.ts`:
```typescript
import { NextRequest, NextResponse } from 'next/server';
import { Pool } from 'pg';

let pool: Pool | null = null;
function db(): Pool {
  if (!pool) pool = new Pool({ connectionString: process.env.DATABASE_URL });
  return pool;
}

interface OrderRow { id: string; user_id: string; }

export async function POST(
  request: NextRequest,
  { params }: { params: { paymentId: string } },
): Promise<Response> {
  const { action } = await request.json().catch(() => ({}));

  const orderResult = await db().query<OrderRow>(
    `SELECT id, user_id FROM orders.orders WHERE payment_id = $1 LIMIT 1`,
    [params.paymentId],
  );
  if (orderResult.rows.length === 0) {
    return NextResponse.json({ error: 'Order not found for payment' }, { status: 404 });
  }
  const order = orderResult.rows[0]!;

  if (action === 'cancel') {
    await db().query(
      `UPDATE orders.orders SET status = 'cancelled', updated_at = NOW() WHERE id = $1`,
      [order.id],
    );
    return NextResponse.json({ orderId: order.id, status: 'cancelled' });
  }

  await db().query(
    `UPDATE orders.orders SET status = 'paid', paid_at = NOW(), updated_at = NOW() WHERE id = $1`,
    [order.id],
  );

  try {
    await fetch(`${process.env.NEXT_PUBLIC_APP_URL}/api/internal/order-completed`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-internal-token': process.env.INTERNAL_SERVICE_TOKEN ?? '',
      },
      body: JSON.stringify({ orderId: order.id }),
    });
  } catch (err) {
    console.error('[mock-gopay] internal webhook failed', err);
  }

  return NextResponse.json({ orderId: order.id, status: 'paid' });
}
```

---

<a id="krok-14"></a>
## Krok 14 — Spuštění aplikace

### 14.1 — Type-check
```bash
cd C:/Users/omnia/Documents/tixly/nextjs-boilerplate
npx tsc --noEmit 2>&1 | grep -v "stripe-payments\|gopay-payments/src\|@tixly/db-adapter\|nodemailer\|order-service-full\|smoke-full-flow\|ticket-issuer\|order-completed.test" | head -30
```
Měly by zbýt **0 chyb** ze souborů, které jsi v této příručce vytvořil.

### 14.2 — Spuštění dev serveru
```bash
npm run dev
```
Po ~10 sekundách:
```
   ▲ Next.js 14.x.x
   - Local:        http://localhost:3000
 ✓ Ready in 8.2s
```

### ✓ Checkpoint
- `http://localhost:3000` → redirect na `/cs/events`
- `http://localhost:3000/admin` → redirect na `/cs/login` (nejsi přihlášen)
- `http://localhost:3000/platform` → také `/cs/login`

---

<a id="krok-15"></a>
## Krok 15 — Smoke test (3 scénáře + moderace)

Tři okna prohlížeče (1× normální, 2× inkognito) pro odděleny session.

### Scénář A — Master admin schvaluje promotéra

**Okno 1 (normální):**

1. `http://localhost:3000/cs/login`
2. E-mail: `superadmin@tixly.cz`, Heslo: `Demo2026!`
3. Po loginu jsi automaticky přesměrován na **`/platform`**
4. Vidíš dashboard: `Pending: 1`, `Active: 1`, `Suspended: 0`
5. Klik na **Promotéři** v sidebaru → tabulka 2 řádků
6. Vedle `Pending Events s.r.o.` klikni **Schválit**
7. Status se přepne na `active`

✅ **Master admin funguje.**

### Scénář B — Self-service promotér + tvorba akce

**Okno 2 (inkognito):**

1. `http://localhost:3000/cs/register-promoter`
2. Vyplň: Název organizace `Demo Promo`, Tvé jméno `Jan Promotér`,
   E-mail `promo@example.cz`, Heslo `Demo2026!`
3. Klik **Vytvořit účet promotéra**
4. Auto-login → přesměruje na `/admin`
5. Nahoře vidíš žlutý banner **„Tvůj účet promotéra čeká na schválení"**

**Okno 1 (master admin):**

6. Refresh `/platform/promoters` (nebo F5)
7. Najdi `Demo Promo` → klik **Schválit**

**Okno 2 (promotér):**

8. F5 nebo přihlas se znovu (aby JWT obsahoval `status='active'`)
9. Banner zmizel
10. Klik **Akce** v sidebaru → klik **+ Nová akce**
11. Vyplň:
    - Název: `Demo koncert`
    - Datum: zítra 19:00
    - Místo: ponech `online`
    - Typy vstupenek: `VIP / 1500 Kč / 20`, klik **+ Přidat**, `Standard / 500 Kč / 100`
12. Klik **Vytvořit akci**
13. Přesměruje na `/admin/events` — tvá akce v seznamu se žlutým badgem
    **„Čeká na schválení"** (NE `published` — vrstva 1 + 3 moderace)

**Bonus test blocklist scanu (vrstva 1):**

14. Klik **+ Nová akce**, vyplň název **`Heil koncert`**, ostatní cokoli, klik
    **Vytvořit akci**
15. V seznamu má tato akce červený badge **„Zamítnuto"** — auto-reject
    keywordem `heil`. Promotér vidí, že akce neprošla, ale nemá detail důvodu
    (ten je v `audit.event_moderation_log` pro DSA audit).

**Okno 1 (master admin):**

16. Otevři `/platform/event-moderation`
17. V seznamu je **Demo koncert** (status `pending_review`)
    — `Heil koncert` tu **NENÍ**, protože byl auto-rejected.
18. Klik **Schválit** u `Demo koncert`
19. Karta zmizí (akce má teď `status='published'`)

✅ **Promotér + moderace funguje.**

### Scénář C — Kupec si koupí lístek

**Okno 3 (inkognito):**

1. `http://localhost:3000/cs/events`
2. V seznamu vidíš `Demo koncert` (akci od promotéra `Demo Promo`)
3. Klik na akci → klik **Koupit** u Standard
4. Aplikace tě nepustí (nejsi přihlášen) → redirect na `/cs/login?from=/cs/checkout?...`
5. Klik **Registrace kupujícího** → vyplň jméno, e-mail `kupec@test.cz`, heslo
6. Po registraci jsi zpět na `/cs/checkout`
7. Klik **Pokračovat k platbě**
8. Přesměruje na `/mock-gopay/mock-pay-xxxxxxxx`
9. Klik **Zaplatit**
10. Přesměruje na `/cs/order-confirmation?orderId=...`

**Mailhog (`http://localhost:8025`):**

11. Měl bys vidět e-mail s předmětem „Vaše vstupenka" (nebo podobně)

**Okno 2 (promotér):**

12. Otevři `/admin/orders`
13. Tvoje nová objednávka je nahoře se stavem **Zaplaceno**

✅ **E2E flow funguje.**

---

## 🎉 Hotovo! Máš plnohodnotné demo se 3 rolemi.

Teď můžeš:
- Přepínat mezi master adminem, promotérem, kupcem
- Schvalovat/pozastavovat promotéry z UI
- Klikem zakládat akce
- Sledovat objednávky v reálném čase
- Reset DB: `docker compose down -v && docker compose up -d` → pak znovu Krok 6

---

<a id="priloha-a"></a>
## Příloha A — Časté chyby a řešení

### "Cannot find module 'jose'"
Krok 2 přeskočen. `cd nextjs-boilerplate && npm install jose bcryptjs`.

### "ECONNREFUSED 127.0.0.1:5432"
Postgres neběží. `docker compose ps` → `docker compose restart postgres`.

### "relation 'identity.users' does not exist"
Migrace se neaplikovaly. `docker compose down -v && docker compose up -d`,
počkej na `==> DB inicializace dokončena.` v `docker compose logs postgres`.

### "Invalid credentials" při loginu
Hash neodpovídá heslu. Vygeneruj nový (`scripts/generate-password-hash.js "Demo2026!"`),
uprav `seed-owner.sql` + `seed-platform.sql`, smaž a aplikuj znovu:
```bash
docker compose exec postgres psql -U tixly -d tixly -c "
DELETE FROM platform.promoter_members WHERE user_id IN (SELECT id FROM identity.users WHERE email IN ('admin@tixly.cz','superadmin@tixly.cz','pending@example.cz'));
DELETE FROM platform.promoters WHERE slug IN ('tixly-events','pending-events');
DELETE FROM identity.users WHERE email IN ('admin@tixly.cz','superadmin@tixly.cz','pending@example.cz');
"
docker compose exec -T postgres psql -U tixly -d tixly < scripts/seed-owner.sql
docker compose exec -T postgres psql -U tixly -d tixly < scripts/seed-platform.sql
```

### "JWSSignatureVerificationFailed" v middlewaru
JWT_SECRET v `.env.local` se liší od toho, kterým byl token podepsán. Smaž
cookies + localStorage v prohlížeči (DevTools → Application → Storage → Clear),
přihlas se znovu.

### "Forbidden — platform admin only"
JWT neobsahuje `roles.isPlatformAdmin = true`. Možnosti:
- Nejsi přihlášen jako `superadmin@tixly.cz`
- `is_platform_admin` flag v DB není `TRUE`: `SELECT email, is_platform_admin FROM identity.users WHERE email='superadmin@tixly.cz';`
- JWT je starý (před aplikací `seed-platform.sql`) — odhlas se a přihlas znovu

### "Forbidden — promoter members only"
Stejně, JWT neobsahuje `promoterMemberships`. Buď nejsi promotér member, nebo
máš starý JWT. Odhlas se, přihlas znovu.

### `/admin/events/new` POST → 403 "status pending"
Tvůj promotér čeká na schválení. Jdi do `/platform/promoters` jako master
admin a klikni **Schválit**, pak se přihlas jako promotér znovu (JWT se obnoví
se status `active`).

### "platform.member_role" type doesn't exist
Schéma nemá enum `platform.member_role`. Zkontroluj:
```bash
docker compose exec postgres psql -U tixly -d tixly -c "\dT platform.*"
```
Pokud chybí, podívej se do `migrations/` — možná migrace s tímto enumem
nedoběhla. `docker compose down -v && up -d`.

### Mock GoPay route 404 "Order not found for payment"
Sloupec `orders.orders.payment_id` není naplněn. Ověř:
```bash
docker compose exec postgres psql -U tixly -d tixly -c "SELECT id, status, payment_id FROM orders.orders ORDER BY created_at DESC LIMIT 5;"
```
Pokud `payment_id IS NULL`, checkout route neukládá payment ID — zkontroluj
`/api/checkout/route.ts`.

### Mailhog nezobrazuje e-maily
Aplikace běží mimo Docker → `SMTP_HOST=localhost` je správně. Pokud aplikaci
spustíš v Dockeru, změň na `host.docker.internal`.

### Akce se nezobrazila v `/cs/events` po vytvoření
Normální chování — nová akce má `status='pending_review'` a čeká na master
admina v `/platform/event-moderation`. Query v `events/page.tsx` filtruje
`status='published'`. Ověř:
```bash
docker compose exec postgres psql -U tixly -d tixly -c "SELECT title, status FROM catalog.events ORDER BY created_at DESC LIMIT 5;"
```

### Promotér nevidí důvod zamítnutí akce
Záměr — důvod je v `audit.event_moderation_log` pro DSA audit trail (master
admin + legal). V demu promotér vidí jen badge `Zamítnuto`. Do produkce ještě
musí přibýt UI pro zobrazení důvodu + appeal flow (DSA čl. 20).

### Keyword blocklist nerozpoznal slovo
Match je **case-insensitive** (`haystack.toLowerCase()` + `keyword.toLowerCase()`),
ale **exact substring** — diakritika se neodstraňuje. Pokud chceš chytit
`Hítler` i `Hitler`, potřebuješ normalizaci přes `.normalize('NFD').replace(/[̀-ͯ]/g, '')`.
Pro demo stačí, jak to je — pro produkci přidej.

### `column "status" of relation "events" violates check constraint`
Migrace se neaplikovala nad rozšířeným enumem. Zkontroluj:
```bash
docker compose exec postgres psql -U tixly -d tixly -c "\d+ catalog.events" | grep check
```
Musíš vidět `CHECK (status IN ('draft','pending_review','published','rejected','flagged','cancelled','completed'))`.
Pokud chybí, znovu pusť SQL z Kroku 6.5 (DROP CONSTRAINT + ADD CONSTRAINT).

### `/platform/event-moderation` prázdná, i když promotér vytvořil akci
Možné příčiny:
- `requirePromoter` vrací `userId` = NULL (viz poznámka v Kroku 10.3). Oprav
  `lib/admin-auth.ts` tak, aby vracela i userId.
- INSERT do `audit.event_moderation_log` selhal (ale event se vytvořil). Zkontroluj
  logy Next.js. Pokud vidíš FK error, tabulka `audit.event_moderation_log`
  nemá správný schema — znovu spusť Krok 6.5.

---

<a id="priloha-b"></a>
## Příloha B — Co dál (cesta k produkci)

Po úspěšném demu pokračuj dle existujícího `start.md` (produkční deploy):

1. **Fáze B (staging):** Vercel + Railway + Upstash + GoPay sandbox
2. **Fáze C (produkce):** IČO → GoPay produkční credentials → DNS na produkci

Před deploy ještě vyřeš tyto **P1 položky**:

- **Bug A1** — GoPay webhook → `orders.paid` (Kafka consumer chybí)
- **B13** — server-side price validation
- **`withTenantContext` stuby** — 11 modulů, multi-tenant isolation
- **Schema `platform.payouts`** — chybí FK constraints
- **KYC flow** — pro produkční onboarding promotérů (přidej do `/api/auth/register-promoter`)
- **E-mail master adminovi** — když se zaregistruje nový promotér, pošli notifikaci
- **2FA pro `superadmin@tixly.cz`** — TOTP přes `@tixly/crypto`

---

## Dodatek — Rychlý reset

```bash
cd C:/Users/omnia/Documents/tixly
docker compose down -v
docker compose up -d
sleep 60
docker compose exec -T postgres psql -U tixly -d tixly < seed.sql
docker compose exec -T postgres psql -U tixly -d tixly < scripts/seed-owner.sql
docker compose exec -T postgres psql -U tixly -d tixly < scripts/seed-platform.sql
docker compose exec -T postgres psql -U tixly -d tixly -c "
UPDATE catalog.events SET promoter_id = (SELECT id FROM platform.promoters WHERE slug='tixly-events' LIMIT 1) WHERE promoter_id IS NULL;
"
```
