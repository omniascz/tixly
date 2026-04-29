# Upsell Engine -- Technicka architektura

> Claude Opus 4.6 -- 4.4.2026

---

## 1. Prehled

Upsell engine umoznuje organizatorum nabizet doplnkove produkty a sluzby pri nakupu vstupenek. Cil: zvysit prumernou hodnotu objednavky (AOV) a prijem organizatora.

### Zakladni principy

- **Schema-per-service:** nove schema `upsell` v PostgreSQL
- **Cross-schema bez FK:** referencni integrita pres API, ne pres databazove FK (konzistentni s ostatnimi moduly)
- **DI pres adapter interfaces:** `UpsellService`, `UpsellInventoryAdapter`, `UpsellPricingAdapter`
- **Kafka eventy:** `upsell.purchased`, `upsell.inventory.low`, `upsell.refunded`
- **Idempotency:** kazdy upsell order ma `idempotency_key` (UUID)

---

## 2. Datovy model (PostgreSQL)

```sql
-- =============================================================================
-- SCHEMA: upsell
-- Zodpovednost: definice upsell polozek, pravidla zobrazovani, objednavky, inventar
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS upsell;

-- -----------------------------------------------------------------------------
-- upsell.upsell_items — definice upsell polozek per event
-- -----------------------------------------------------------------------------

CREATE TABLE upsell.upsell_items (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- event_id z catalog.events — cross-schema, bez FK
    event_id        UUID            NOT NULL,
    -- organizer_id z identity.users — cross-schema, bez FK
    organizer_id    UUID            NOT NULL,
    type            TEXT            NOT NULL
        CHECK (type IN (
            'vip_upgrade',
            'insurance',
            'merchandise',
            'parking',
            'fnb_voucher',
            'meet_greet',
            'camping_pass',
            'locker',
            'travel_package'
        )),
    name            TEXT            NOT NULL,
    description     TEXT,
    -- Cena v CZK; pro vip_upgrade = doplatek (pocita se dynamicky pres pricing-engine)
    price           NUMERIC(10, 2)  NOT NULL CHECK (price >= 0),
    currency        CHAR(3)         NOT NULL DEFAULT 'CZK',
    -- Platform fee procento (default 10%)
    platform_fee_pct NUMERIC(5, 2)  NOT NULL DEFAULT 10.00
        CHECK (platform_fee_pct >= 0 AND platform_fee_pct <= 100),
    -- Metadata specificka pro typ (velikosti tricek, parkovaci zona, hodnota voucheru...)
    metadata        JSONB           NOT NULL DEFAULT '{}',
    -- Stav polozky
    status          TEXT            NOT NULL DEFAULT 'active'
        CHECK (status IN ('draft', 'active', 'paused', 'archived')),
    -- Obrazek / thumbnail URL
    image_url       TEXT,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE upsell.upsell_items IS
    'Definice upsell polozek vytvozenych organizatorem pro konkretni event.';
COMMENT ON COLUMN upsell.upsell_items.type IS
    'Typ upsell polozky. vip_upgrade pouziva dynamicky doplatek z pricing-engine.';
COMMENT ON COLUMN upsell.upsell_items.metadata IS
    'JSON metadata specificka pro typ: {sizes: ["S","M","L"]} pro merch, {zone: "A"} pro parking, {value_czk: 100} pro fnb_voucher.';
COMMENT ON COLUMN upsell.upsell_items.platform_fee_pct IS
    'Procento platformoveho poplatku z ceny upsell polozky. Default 10%.';

CREATE INDEX idx_upsell_items_event_id
    ON upsell.upsell_items (event_id);

CREATE INDEX idx_upsell_items_event_status
    ON upsell.upsell_items (event_id, status)
    WHERE status = 'active';

CREATE TRIGGER trg_upsell_items_updated_at
    BEFORE UPDATE ON upsell.upsell_items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- upsell.upsell_rules — pravidla zobrazovani per upsell item
-- -----------------------------------------------------------------------------

CREATE TABLE upsell.upsell_rules (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    upsell_item_id  UUID            NOT NULL REFERENCES upsell.upsell_items (id) ON DELETE CASCADE,
    -- ticket_type_id z catalog.ticket_types — cross-schema, bez FK
    -- NULL = platne pro vsechny ticket types
    ticket_type_id  UUID,
    -- Kdy se upsell zobrazuje
    timing          TEXT            NOT NULL
        CHECK (timing IN ('checkout', 'post_purchase', 'pre_event', 'on_site')),
    -- Poradi zobrazeni (nizsi = vyssi priorita)
    sort_order      INTEGER         NOT NULL DEFAULT 100,
    -- Max kusu na objednavku (NULL = neomezeno)
    max_per_order   INTEGER         CHECK (max_per_order > 0),
    -- Casove okno dostupnosti
    available_from  TIMESTAMPTZ,
    available_until TIMESTAMPTZ,
    -- Exkluzivita: JSON pole ticket_type IDs ktere mohou pristupovat
    -- NULL = zadna restrikce; neprazdne pole = pouze tyto ticket types
    exclusive_to_ticket_types UUID[],
    -- Podminky (JSON): {"min_group_size": 4, "first_time_buyer": true, ...}
    conditions      JSONB           NOT NULL DEFAULT '{}',
    -- Aktivni/neaktivni pravidlo
    is_active       BOOLEAN         NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE upsell.upsell_rules IS
    'Pravidla zobrazovani upsell polozek. Jedna polozka muze mit vice pravidel (napr. jine sort_order pro checkout vs. post_purchase).';
COMMENT ON COLUMN upsell.upsell_rules.timing IS
    'Okamzik zobrazeni: checkout (pri nakupu), post_purchase (dekujeme stranka + email), pre_event (7d/24h pred akci), on_site (staff tablet).';
COMMENT ON COLUMN upsell.upsell_rules.conditions IS
    'Volitelne JSON podminky: min_group_size, first_time_buyer, has_loyalty_points, previous_purchase_types.';

CREATE INDEX idx_upsell_rules_item_id
    ON upsell.upsell_rules (upsell_item_id);

CREATE INDEX idx_upsell_rules_lookup
    ON upsell.upsell_rules (upsell_item_id, timing, is_active)
    WHERE is_active = TRUE;

CREATE TRIGGER trg_upsell_rules_updated_at
    BEFORE UPDATE ON upsell.upsell_rules
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- upsell.upsell_inventory — kapacita a prodany pocet per upsell item
-- -----------------------------------------------------------------------------

CREATE TABLE upsell.upsell_inventory (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    upsell_item_id  UUID            NOT NULL REFERENCES upsell.upsell_items (id) ON DELETE CASCADE,
    -- Celkova kapacita (NULL = neomezena, napr. pojisteni)
    total_qty       INTEGER         CHECK (total_qty > 0),
    -- Prodany pocet (inkrementuje se atomicky)
    sold_count      INTEGER         NOT NULL DEFAULT 0 CHECK (sold_count >= 0),
    -- Reserved pocet (v procesu platby, jeste ne potvrzeny)
    reserved_count  INTEGER         NOT NULL DEFAULT 0 CHECK (reserved_count >= 0),
    -- Low inventory threshold pro Kafka alert
    low_threshold   INTEGER         DEFAULT 5 CHECK (low_threshold >= 0),
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    -- Sold + reserved nesmi prekrocit total (pokud total neni NULL)
    CONSTRAINT chk_upsell_inventory_capacity
        CHECK (total_qty IS NULL OR (sold_count + reserved_count <= total_qty))
);

COMMENT ON TABLE upsell.upsell_inventory IS
    'Stav inventare upsell polozek. Atomicke UPDATE pres PostgreSQL row-level lock.';
COMMENT ON COLUMN upsell.upsell_inventory.total_qty IS
    'NULL = neomezena kapacita (napr. pojisteni vstupenky). Kladne cislo = limitovany pocet (napr. 20 Meet & Greet slotu).';

CREATE UNIQUE INDEX uq_upsell_inventory_item
    ON upsell.upsell_inventory (upsell_item_id);

CREATE TRIGGER trg_upsell_inventory_updated_at
    BEFORE UPDATE ON upsell.upsell_inventory
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- upsell.upsell_order_items — zakoupene upsells (vazane na order)
-- -----------------------------------------------------------------------------

CREATE TABLE upsell.upsell_order_items (
    id                  UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    -- order_id z orders.orders — cross-schema, bez FK
    order_id            UUID            NOT NULL,
    -- ticket_id z tickets.tickets — cross-schema, bez FK
    -- NULL pro upsells ktere nejsou vazane na konkretni vstupenku (napr. parking)
    ticket_id           UUID,
    upsell_item_id      UUID            NOT NULL REFERENCES upsell.upsell_items (id) ON DELETE RESTRICT,
    quantity            INTEGER         NOT NULL DEFAULT 1 CHECK (quantity > 0),
    unit_price          NUMERIC(10, 2)  NOT NULL CHECK (unit_price >= 0),
    total_price         NUMERIC(10, 2)  NOT NULL CHECK (total_price >= 0),
    -- Platform fee snapshot v okamziku nakupu
    platform_fee_pct    NUMERIC(5, 2)   NOT NULL,
    platform_fee_amount NUMERIC(10, 2)  NOT NULL CHECK (platform_fee_amount >= 0),
    -- Organizer payout castka
    organizer_payout    NUMERIC(10, 2)  NOT NULL CHECK (organizer_payout >= 0),
    currency            CHAR(3)         NOT NULL DEFAULT 'CZK',
    -- Stav
    status              TEXT            NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'paid', 'refunded', 'cancelled')),
    -- Idempotency key
    idempotency_key     UUID            NOT NULL DEFAULT gen_random_uuid(),
    -- Metadata (vybrany variant: velikost tricka, parkovaci zona...)
    variant_metadata    JSONB           NOT NULL DEFAULT '{}',
    -- GoPay payment ID (muze byt stejny jako hlavni objednavka nebo separatni)
    gopay_payment_id    TEXT,
    paid_at             TIMESTAMPTZ,
    refunded_at         TIMESTAMPTZ,
    created_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_upsell_order_items_total
        CHECK (total_price = unit_price * quantity),
    CONSTRAINT chk_upsell_order_items_fee
        CHECK (platform_fee_amount = ROUND(total_price * platform_fee_pct / 100, 2)),
    CONSTRAINT chk_upsell_order_items_payout
        CHECK (organizer_payout = total_price - platform_fee_amount)
);

COMMENT ON TABLE upsell.upsell_order_items IS
    'Zakoupene upsell polozky. Kazdy zaznam je vazan na existujici objednavku (orders.orders).';
COMMENT ON COLUMN upsell.upsell_order_items.ticket_id IS
    'NULL pro upsells nezavisle na konkretni vstupence (parking, F&B voucher per order). Non-NULL pro per-ticket upsells (VIP upgrade, pojisteni).';
COMMENT ON COLUMN upsell.upsell_order_items.variant_metadata IS
    'Konkretni varianta: {size: "L"} pro merch, {zone: "P1"} pro parking, {locker_number: "42"} pro locker.';
COMMENT ON COLUMN upsell.upsell_order_items.gopay_payment_id IS
    'GoPay payment ID. Pro in-checkout upsell = stejny payment jako hlavni objednavka. Pro post-purchase = separatni platba.';

CREATE INDEX idx_upsell_order_items_order_id
    ON upsell.upsell_order_items (order_id);

CREATE INDEX idx_upsell_order_items_ticket_id
    ON upsell.upsell_order_items (ticket_id)
    WHERE ticket_id IS NOT NULL;

CREATE INDEX idx_upsell_order_items_upsell_item_id
    ON upsell.upsell_order_items (upsell_item_id);

CREATE UNIQUE INDEX uq_upsell_order_items_idempotency
    ON upsell.upsell_order_items (idempotency_key);

CREATE TRIGGER trg_upsell_order_items_updated_at
    BEFORE UPDATE ON upsell.upsell_order_items
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- upsell.upsell_analytics — agregovan statistiky pro organizer dashboard
-- -----------------------------------------------------------------------------

CREATE TABLE upsell.upsell_analytics (
    id              UUID            PRIMARY KEY DEFAULT gen_random_uuid(),
    upsell_item_id  UUID            NOT NULL REFERENCES upsell.upsell_items (id) ON DELETE CASCADE,
    event_id        UUID            NOT NULL,
    -- Denni agregace
    date            DATE            NOT NULL,
    impressions     INTEGER         NOT NULL DEFAULT 0,
    clicks          INTEGER         NOT NULL DEFAULT 0,
    conversions     INTEGER         NOT NULL DEFAULT 0,
    revenue         NUMERIC(10, 2)  NOT NULL DEFAULT 0,
    created_at      TIMESTAMPTZ     NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_upsell_analytics_item_date
        UNIQUE (upsell_item_id, date)
);

COMMENT ON TABLE upsell.upsell_analytics IS
    'Denni agregace upsell metrik pro organizer dashboard a optimalizaci razeni.';
```

### ER diagram (textovy)

```
catalog.events 1──N upsell.upsell_items 1──N upsell.upsell_rules
                                         1──1 upsell.upsell_inventory
                                         1──N upsell.upsell_order_items
                                         1──N upsell.upsell_analytics

orders.orders 1──N upsell.upsell_order_items
tickets.tickets 1──N upsell.upsell_order_items (nullable)
```

---

## 3. API kontrakt

### 3.1 Buyer-facing endpointy

#### `GET /api/events/[eventId]/upsells`

Vraci dostupne upsell polozky pro dany event, filtrovane podle ticket type a timing.

**Query parametry:**
| Parametr | Typ | Povinny | Popis |
|---|---|---|---|
| `ticket_type_id` | UUID | ne | Filtr podle ticket type (pro exkluzivitu) |
| `timing` | string | ano | `checkout`, `post_purchase`, `pre_event`, `on_site` |
| `order_id` | UUID | ne | Pro post-purchase — identifikace existujici objednavky |
| `user_id` | UUID | ne | Pro personalizaci (z x-user-id headeru) |

**Response 200:**
```typescript
interface UpsellListResponse {
  data: UpsellItemPublic[];
  eventId: string;
  timing: UpsellTiming;
}

interface UpsellItemPublic {
  id: string;
  type: UpsellType;
  name: string;
  description: string | null;
  price: number;              // CZK; pro vip_upgrade = dynamicky doplatek
  currency: string;
  imageUrl: string | null;
  metadata: Record<string, unknown>;  // velikosti, varianty...
  available: boolean;         // false pokud vyprodano
  remainingQty: number | null; // null = neomezeno
  maxPerOrder: number | null;  // null = neomezeno
  // Personalizacni signal
  recommended: boolean;       // true pokud doporuceno engine
  recommendationReason: string | null; // "Kupoval jsi na minule akci"
}
```

**Response headers:** `Cache-Control: no-store` (real-time data)

#### `POST /api/orders/[orderId]/upsells`

Prida upsell polozku k existujici objednavce. Pro in-checkout se pripoji k hlavni platbe; pro post-purchase vytvori separatni GoPay platbu.

**Request body:**
```typescript
interface AddUpsellRequest {
  items: UpsellOrderItemInput[];
  idempotencyKey: string;      // UUID — ochrana pred duplicitami
}

interface UpsellOrderItemInput {
  upsellItemId: string;
  quantity: number;
  ticketId?: string;           // pro per-ticket upsells (VIP upgrade, pojisteni)
  variantMetadata?: Record<string, unknown>;  // {size: "L"}, {zone: "P1"}
}
```

**Response 201 (in-checkout — upsell pridan k pending objednavce):**
```typescript
interface AddUpsellResponse {
  orderId: string;
  upsellOrderItems: UpsellOrderItemPublic[];
  newTotal: number;            // aktualizovany celkovy total objednavky
}
```

**Response 202 (post-purchase — nova separatni platba):**
```typescript
interface AddUpsellPostPurchaseResponse {
  orderId: string;
  upsellOrderItems: UpsellOrderItemPublic[];
  gopayRedirectUrl: string;    // presmerovani na GoPay
  paymentTotal: number;
}
```

**Error responses:**
| Status | Kod | Situace |
|---|---|---|
| 400 | `VALIDATION_ERROR` | Chybejici povinne pole, neplatna quantity |
| 404 | `ORDER_NOT_FOUND` | Objednavka neexistuje |
| 409 | `UPSELL_SOLD_OUT` | Kapacita upsell polozky vycerpana |
| 409 | `DUPLICATE_UPSELL` | Idempotency key jiz pouzit |
| 409 | `INCOMPATIBLE_TICKET_TYPE` | Upsell neni dostupny pro tento ticket type |
| 422 | `MAX_PER_ORDER_EXCEEDED` | Prekrocen max pocet kusu na objednavku |
| 422 | `TIME_WINDOW_CLOSED` | Casove okno pro upsell vyprselo |

#### `DELETE /api/orders/[orderId]/upsells/[upsellOrderItemId]`

Odebrani upsell polozky z objednavky (pouze pokud objednavka je stale `pending`).

**Response 200:**
```typescript
interface RemoveUpsellResponse {
  orderId: string;
  removedItemId: string;
  newTotal: number;
}
```

### 3.2 Organizer management endpointy

#### `GET /api/organizer/events/[eventId]/upsells`

Seznam vsech upsell polozek pro event (vcetne draftu a archivovanych).

**Response 200:** `PaginatedResponse<UpsellItemOrganizer>` (stejny vzor jako resale-api)

#### `POST /api/organizer/events/[eventId]/upsells`

Vytvoreni nove upsell polozky.

**Request body:**
```typescript
interface CreateUpsellItemRequest {
  type: UpsellType;
  name: string;
  description?: string;
  price: number;
  metadata?: Record<string, unknown>;
  imageUrl?: string;
  totalQty?: number;           // null = neomezeno
  lowThreshold?: number;       // default 5
  rules: CreateUpsellRuleInput[];
}

interface CreateUpsellRuleInput {
  ticketTypeId?: string;       // null = vsechny ticket types
  timing: UpsellTiming;
  sortOrder?: number;          // default 100
  maxPerOrder?: number;
  availableFrom?: string;      // ISO 8601
  availableUntil?: string;
  exclusiveToTicketTypes?: string[];
  conditions?: Record<string, unknown>;
}
```

**Response 201:** `UpsellItemOrganizer`

#### `PUT /api/organizer/events/[eventId]/upsells/[upsellItemId]`

Aktualizace upsell polozky (cena, popis, pravidla). Zmena ceny neovlivni jiz zakoupene upsells.

#### `DELETE /api/organizer/events/[eventId]/upsells/[upsellItemId]`

Archivace upsell polozky (soft delete — `status = 'archived'`). Neodstrani jiz zakoupene upsells.

#### `GET /api/organizer/events/[eventId]/upsells/analytics`

Statistiky upsell polozek: impressions, conversions, revenue, conversion rate.

**Response 200:**
```typescript
interface UpsellAnalyticsResponse {
  eventId: string;
  totalRevenue: number;
  platformFeeTotal: number;
  organizerPayoutTotal: number;
  items: UpsellItemAnalytics[];
}

interface UpsellItemAnalytics {
  upsellItemId: string;
  name: string;
  type: UpsellType;
  impressions: number;
  clicks: number;
  conversions: number;
  conversionRate: number;      // conversions / impressions
  revenue: number;
  soldCount: number;
  remainingQty: number | null;
}
```

### 3.3 Staff on-site endpointy

#### `POST /api/staff/upsells`

Staff tablet — prodej upsell na miste. Podporuje offline rezim (viz edge cases).

**Request body:**
```typescript
interface StaffUpsellRequest {
  ticketId: string;            // naskenovany QR kod
  upsellItemId: string;
  quantity: number;
  staffId: string;
  idempotencyKey: string;
  offlineCreatedAt?: string;   // ISO 8601 — pro offline sync
}
```

---

## 4. Upsell Engine logika

### 4.1 Filtrovani dostupnych upsells

```typescript
/**
 * Hlavni filtrovaci pipeline. Postupne odfiltruje nedostupne upsells.
 * Kazdy krok snizuje mnozinu kandidatu — poradi filtru je optimalizovano
 * pro rychle odrizeni (DB-level filtry prvni, pak in-memory).
 */
async function getAvailableUpsells(
  eventId: string,
  ticketTypeId: string | null,
  timing: UpsellTiming,
  userId: string | null,
  orderId: string | null,
  deps: ServiceDeps,
): Promise<UpsellItemPublic[]> {

  // ── Krok 1: DB dotaz — zakladni filtrace (event, status, timing, casove okno)
  const candidates = await deps.db.query<UpsellCandidateRow>(`
    SELECT
      ui.id, ui.type, ui.name, ui.description, ui.price, ui.currency,
      ui.image_url, ui.metadata, ui.status,
      ur.ticket_type_id, ur.timing, ur.sort_order, ur.max_per_order,
      ur.available_from, ur.available_until, ur.exclusive_to_ticket_types,
      ur.conditions,
      inv.total_qty, inv.sold_count, inv.reserved_count
    FROM upsell.upsell_items ui
    JOIN upsell.upsell_rules ur ON ur.upsell_item_id = ui.id
    JOIN upsell.upsell_inventory inv ON inv.upsell_item_id = ui.id
    WHERE ui.event_id = $1
      AND ui.status = 'active'
      AND ur.is_active = TRUE
      AND ur.timing = $2
      AND (ur.available_from IS NULL OR ur.available_from <= NOW())
      AND (ur.available_until IS NULL OR ur.available_until >= NOW())
    ORDER BY ur.sort_order ASC
  `, [eventId, timing]);

  // ── Krok 2: Kapacitni filtr (in-memory, rychle)
  const withCapacity = candidates.filter(c =>
    c.total_qty === null || (c.sold_count + c.reserved_count < c.total_qty)
  );

  // ── Krok 3: Ticket type kompatibilita
  const compatible = withCapacity.filter(c => {
    // Pokud pravidlo nema ticket_type_id, platne pro vsechny
    if (c.ticket_type_id === null) return true;
    // Pokud ma, musi odpovidat
    if (ticketTypeId && c.ticket_type_id === ticketTypeId) return true;
    return false;
  }).filter(c => {
    // Exkluzivita — pokud je nastavena, ticket type musi byt v seznamu
    if (!c.exclusive_to_ticket_types || c.exclusive_to_ticket_types.length === 0) return true;
    if (!ticketTypeId) return false;
    return c.exclusive_to_ticket_types.includes(ticketTypeId);
  });

  // ── Krok 4: Podminky (conditions JSON)
  const conditioned = await applyConditions(compatible, userId, orderId, deps);

  // ── Krok 5: Deduplikace (pokud upsell item ma vice pravidel pro stejny timing)
  const deduped = deduplicateByItemId(conditioned);

  // ── Krok 6: Personalizace razeni (viz sekce 4.2)
  const personalized = userId
    ? await personalizeOrder(deduped, userId, deps)
    : deduped;

  return personalized.map(toUpsellItemPublic);
}
```

### 4.2 Personalizacni razeni

```typescript
/**
 * Personalizacni algoritmus. Modifikuje sort_order na zaklade
 * historickych dat kupujiciho. Organizatorem nastaveny sort_order
 * se pouzije jako zaklad; personalizace pridava bonus/penaltu.
 *
 * Vysledne skore: finalScore = sort_order - personalizationBonus
 * Nizsi finalScore = vyssi pozice.
 */
async function personalizeOrder(
  items: UpsellCandidate[],
  userId: string,
  deps: ServiceDeps,
): Promise<UpsellCandidate[]> {

  // Paralelne nacti user signaly
  const [purchaseHistory, loyaltyPoints, userProfile] = await Promise.all([
    deps.db.query<{ type: string; count: number }>(
      `SELECT ui.type, COUNT(*) as count
       FROM upsell.upsell_order_items uoi
       JOIN upsell.upsell_items ui ON ui.id = uoi.upsell_item_id
       JOIN orders.orders o ON o.id = uoi.order_id
       WHERE o.user_id = $1 AND uoi.status = 'paid'
       GROUP BY ui.type`,
      [userId],
    ),
    getLoyaltyPoints(userId, deps),
    getUserProfile(userId, deps),
  ]);

  const historyMap = new Map(purchaseHistory.map(p => [p.type, p.count]));
  const isFirstTimeBuyer = purchaseHistory.length === 0;

  return items.map(item => {
    let bonus = 0;

    // Signal 1: Historicky kupoval tento typ → boost (+20)
    const histCount = historyMap.get(item.type) ?? 0;
    if (histCount > 0) {
      bonus += Math.min(histCount * 10, 20); // max +20
    }

    // Signal 2: First-time buyer → pojisteni na prvni misto (+30)
    if (isFirstTimeBuyer && item.type === 'insurance') {
      bonus += 30;
    }

    // Signal 3: Ma vernostni body → VIP upgrade boost (+15)
    if (loyaltyPoints > 0 && item.type === 'vip_upgrade') {
      bonus += 15;
    }

    // Signal 4: Skupinovy nakup → F&B voucher boost (+10)
    if (item.groupSize && item.groupSize >= 3 && item.type === 'fnb_voucher') {
      bonus += 10;
    }

    return { ...item, personalizedSortOrder: item.sortOrder - bonus };
  }).sort((a, b) => a.personalizedSortOrder - b.personalizedSortOrder);
}
```

### 4.3 Validace pri pridani

```typescript
/**
 * Validace pred pridanim upsell k objednavce.
 * Vraci bud validovany seznam polozek, nebo haze typovany error.
 */
async function validateAndReserveUpsells(
  orderId: string,
  items: UpsellOrderItemInput[],
  idempotencyKey: string,
  deps: ServiceDeps,
): Promise<ValidatedUpsellItem[]> {

  // ── Idempotency check
  const existing = await deps.db.query(
    `SELECT id FROM upsell.upsell_order_items WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  if (existing.length > 0) {
    throw new UpsellError('DUPLICATE_UPSELL', 'Upsell order jiz existuje', 409);
  }

  // ── Nacti objednavku
  const order = await deps.db.query<OrderRow>(
    `SELECT id, status, user_id FROM orders.orders WHERE id = $1`,
    [orderId],
  );
  if (order.length === 0) {
    throw new UpsellError('ORDER_NOT_FOUND', 'Objednavka nenalezena', 404);
  }

  const validated: ValidatedUpsellItem[] = [];

  for (const input of items) {
    // ── Nacti upsell item + inventory (FOR UPDATE — row lock)
    const [item] = await deps.db.query<UpsellItemRow>(`
      SELECT ui.id, ui.type, ui.price, ui.platform_fee_pct, ui.event_id,
             inv.total_qty, inv.sold_count, inv.reserved_count
      FROM upsell.upsell_items ui
      JOIN upsell.upsell_inventory inv ON inv.upsell_item_id = ui.id
      WHERE ui.id = $1 AND ui.status = 'active'
      FOR UPDATE OF inv
    `, [input.upsellItemId]);

    if (!item) {
      throw new UpsellError('UPSELL_NOT_FOUND', `Upsell ${input.upsellItemId} nenalezen`, 404);
    }

    // ── Kapacitni check
    if (item.total_qty !== null) {
      const available = item.total_qty - item.sold_count - item.reserved_count;
      if (available < input.quantity) {
        throw new UpsellError('UPSELL_SOLD_OUT',
          `Upsell ${item.id}: dostupno ${available}, pozadovano ${input.quantity}`, 409);
      }
    }

    // ── Max per order check
    const rule = await getApplicableRule(item.id, /* timing, ticket_type */);
    if (rule?.maxPerOrder) {
      const alreadyInOrder = await deps.db.query<{ qty: number }>(
        `SELECT COALESCE(SUM(quantity), 0) as qty
         FROM upsell.upsell_order_items
         WHERE order_id = $1 AND upsell_item_id = $2 AND status != 'cancelled'`,
        [orderId, item.id],
      );
      if (alreadyInOrder[0].qty + input.quantity > rule.maxPerOrder) {
        throw new UpsellError('MAX_PER_ORDER_EXCEEDED',
          `Max ${rule.maxPerOrder} kusu na objednavku`, 422);
      }
    }

    // ── VIP upgrade: dynamicky doplatek z pricing-engine
    let unitPrice = item.price;
    if (item.type === 'vip_upgrade' && input.ticketId) {
      unitPrice = await calculateVipUpgradePrice(input.ticketId, item.event_id, deps);
    }

    // ── Rezervace inventare (atomicky UPDATE)
    await deps.db.execute(
      `UPDATE upsell.upsell_inventory
       SET reserved_count = reserved_count + $1
       WHERE upsell_item_id = $2`,
      [input.quantity, item.id],
    );

    const totalPrice = unitPrice * input.quantity;
    const feeAmount = Math.round(totalPrice * item.platform_fee_pct) / 100;

    validated.push({
      upsellItemId: item.id,
      ticketId: input.ticketId ?? null,
      quantity: input.quantity,
      unitPrice,
      totalPrice,
      platformFeePct: item.platform_fee_pct,
      platformFeeAmount: feeAmount,
      organizerPayout: totalPrice - feeAmount,
      variantMetadata: input.variantMetadata ?? {},
    });
  }

  return validated;
}
```

### 4.4 VIP upgrade -- doplatek ceny

```typescript
/**
 * Pocita doplatek pro VIP upgrade. Pouziva pricing-engine
 * k ziskani aktualni ceny VIP ticket type a odecte puvodni cenu.
 */
async function calculateVipUpgradePrice(
  ticketId: string,
  eventId: string,
  deps: ServiceDeps,
): Promise<number> {
  // Nacti puvodni ticket type a jeho zaplacenou cenu
  const [ticket] = await deps.db.query<{
    ticket_type_id: string;
    paid_price: number;
  }>(
    `SELECT oi.ticket_type_id, oi.unit_price as paid_price
     FROM orders.order_items oi
     JOIN tickets.tickets t ON t.ticket_type_id = oi.ticket_type_id
     WHERE t.id = $1`,
    [ticketId],
  );

  // Najdi VIP ticket type pro stejny event
  const [vipType] = await deps.db.query<{ id: string }>(
    `SELECT id FROM catalog.ticket_types
     WHERE event_id = $1 AND name ILIKE '%VIP%'
     ORDER BY base_price DESC LIMIT 1`,
    [eventId],
  );

  if (!vipType) {
    throw new UpsellError('VIP_NOT_AVAILABLE', 'Zadny VIP ticket type pro tento event', 404);
  }

  // Ziskej aktualni cenu VIP pres pricing-engine adapter
  const vipPrice = await deps.pricingService.getCurrentPrice(vipType.id);

  const surcharge = vipPrice.finalPrice - ticket.paid_price;
  if (surcharge <= 0) {
    throw new UpsellError('VIP_UPGRADE_NO_SURCHARGE',
      'VIP cena je nizsi nebo stejna jako puvodni — upgrade neni mozny', 422);
  }

  return surcharge;
}
```

---

## 5. Integrace s existujicimi moduly

### Integracni mapa

```
                         ┌──────────────────────┐
                         │    UPSELL ENGINE      │
                         │  (upsell-engine/)     │
                         └──────┬───────────────┘
                                │
        ┌───────────────────────┼───────────────────────┐
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ pricing-engine│    │ recommendation-  │    │ wallet-passes    │
│               │    │ engine           │    │                  │
│ VIP upgrade   │    │ personalizace    │    │ update pass po   │
│ doplatek ceny │    │ razeni upsells   │    │ VIP upgrade      │
└───────────────┘    └──────────────────┘    └──────────────────┘
        │                       │                       │
        ▼                       ▼                       ▼
┌───────────────┐    ┌──────────────────┐    ┌──────────────────┐
│ resale-api    │    │ referral-system  │    │ delayed-delivery │
│               │    │                  │    │                  │
│ vzor pro      │    │ cashback         │    │ merch shipping   │
│ payout flow   │    │ pouzitelny na    │    │ pred eventem     │
└───────────────┘    │ upsell           │    └──────────────────┘
                     └──────────────────┘
```

### 5.1 pricing-engine (adapter)

```typescript
interface PricingAdapter {
  getCurrentPrice(ticketTypeId: string): Promise<PriceCalculation>;
}
```

Pouziti: VIP upgrade — dynamicky doplatek = `vipPrice.finalPrice - originalPaidPrice`.

### 5.2 recommendation-engine (adapter)

```typescript
interface RecommendationAdapter {
  /**
   * Vraci personalizovane upsell skore pro uzivatele.
   * Pouziva stejny scoring pipeline jako event recommender,
   * ale s upsell-specific features.
   */
  getUpsellScores(userId: string, upsellItemIds: string[]): Promise<Map<string, number>>;
}
```

Implementace: rozsirime `ai.user_features` o upsell historii (nova pole `upsell_purchase_types`, `upsell_avg_spend`). Batch job `feature-sync.job.ts` je doplni.

### 5.3 wallet-passes (Kafka consumer)

Kafka topic `upsell.purchased` → wallet-passes consumer:
- VIP upgrade → update pass `ticketType` field + zmena barvy pass
- F&B voucher → pridat barcode/QR pro voucher do pass
- Meet & Greet → pridat "backstage" flag do pass metadata

```typescript
// Kafka event payload
interface UpsellPurchasedEvent {
  eventType: 'upsell.purchased';
  orderId: string;
  ticketId: string | null;
  upsellItemId: string;
  upsellType: UpsellType;
  userId: string;
  eventId: string;
  quantity: number;
  totalPrice: number;
  timestamp: string;  // ISO 8601
}
```

### 5.4 referral-system (adapter)

```typescript
interface CashbackAdapter {
  getAvailableBalance(userId: string): Promise<number>;
  applyCashback(userId: string, amount: number, orderId: string): Promise<void>;
}
```

Cashback z referral programu lze aplikovat na upsell — odecte se z `total_price` pred odeslanim na GoPay.

### 5.5 delayed-delivery (Kafka consumer)

Kafka topic `upsell.purchased` kde `type = 'merchandise'`:
- Vytvori delivery order v delayed-delivery modulu
- Spoji merch s adresou z objednavky
- Scheduling: doruceni pred eventem (konfigurovatelne organizatorem)

### 5.6 resale-api (vzor)

Payout organizatorovi pouzije stejny mechanismus jako resale payout sellerovi:
- Batch payout jednou denne v 6:00
- Timing: 24h po skonceni eventu
- Platform fee se odecte pred payoutem
- `payout_status` tracking (pending → completed → failed → retry)

### 5.7 Kafka eventy

| Topic | Kdy | Consumer |
|---|---|---|
| `upsell.purchased` | Po potvrzeni platby | wallet-passes, delayed-delivery, analytics |
| `upsell.inventory.low` | Kdyz `total_qty - sold_count <= low_threshold` | organizer-dashboard (push notifikace) |
| `upsell.refunded` | Po refundu upsell polozky | wallet-passes (revert), inventory (increment available) |
| `order.paid` | Existujici event z orders | upsell-engine (potvrzeni in-checkout upsells) |
| `order.refunded` | Existujici event z orders | upsell-engine (cascade refund upsells) |
| `event.cancelled` | Existujici event z catalog | upsell-engine (batch refund vsech upsells) |

---

## 6. Edge cases -- rozhodovaci tabulka

| Edge case | Reseni | Automaticky / Manualne |
|---|---|---|
| **VIP upgrade kdyz VIP vyprodano** | `upsell_inventory.total_qty` se synchronizuje s `catalog.ticket_types.remaining_qty` pro VIP. Pokud 0, filtr v kroku 2 ho vyradi. UI: "VIP upgrade momentalne nedostupny". | **Automaticky.** DB constraint + filtracni pipeline. |
| **Duplicate upsell order (idempotency)** | `UNIQUE INDEX uq_upsell_order_items_idempotency` na `idempotency_key`. Druhy pokus vraci 409 `DUPLICATE_UPSELL`. Klient pouziva UUID vygenerovany pred odeslanim. | **Automaticky.** DB constraint. |
| **Refund upsell pri stornovani vstupenky** | Kafka consumer na `order.refunded`: batch UPDATE vsech `upsell_order_items` pro dany order na `status = 'refunded'`. Inventar se dekrementuje. GoPay partial refund pro kazdy upsell item. | **Automaticky.** Kafka consumer + GoPay API. |
| **Upsell pro skupinovy nakup** | Kazdy `order_item` (vstupenka) ma vlastni `ticket_id`. Per-ticket upsells (pojisteni, VIP upgrade) se vazi na konkretni `ticket_id`. Per-order upsells (parking, F&B voucher) se vazi na `order_id` s `ticket_id = NULL`. F&B voucher pro skupinu: `quantity = pocet_clenu`, kazdy dostane vlastni QR. | **Automaticky.** Datovy model rozlisuje per-ticket vs. per-order. |
| **Offline on-site upsell (staff tablet)** | Tablet cachuje seznam dostupnych upsells + inventar stav. Offline transakce se ukladaji lokalne s `offline_created_at` timestamp a `idempotency_key`. Po obnoveni pripojeni sync: POST s idempotency key → server provede atomickou validaci a potvrzeni. Konflikty (mezitim vyprodano): staff dostane notifikaci k rucnimu reseni s kupujicim. | **Automaticky sync, manualni konflikty.** |
| **Casove okno vyprselo behem checkoutu** | `available_until` se kontroluje v okamziku `validateAndReserveUpsells()`, ne pri zobrazeni. Pokud vyprsi mezi GET a POST → 422 `TIME_WINDOW_CLOSED`. Frontend: graceful degradation, odebere polozku z kosiku s vysvetlenim. | **Automaticky.** Server-side validace. |
| **VIP upgrade + resale** | Pokud kupujici prodal puvodni vstupenku pres resale a pak chce VIP upgrade na novou: resale-api meni `ticket_id`, upsell engine kontroluje vlastnictvi vstupenky v okamziku upsell. Pokud `ticket.owner_id != user_id` → 403. | **Automaticky.** Ownership check. |
| **Merchandise — velikost vyprodana** | `metadata.sizes` obsahuje dostupne velikosti. Inventar se trackuje per varianta (kazda velikost = separatni `upsell_item` nebo `variant_metadata` tracking v inventory). MVP: separatni items per velikost. Faze 2: variantni inventar. | **Automaticky.** Separatni items v MVP. |
| **Pojisteni — claim proces** | Self-insured MVP: kupujici kontaktuje support, ten overuje podminky (nemoc, nehodna) a rucne schvaluje refund. Partner integrace ve fazi 2. | **Manualne (MVP).** Automaticky ve fazi 2. |
| **Race condition na inventari** | `SELECT ... FOR UPDATE OF inv` row-level lock v PostgreSQL. Dva simultanni requesty na posledni kus: prvni uspeje, druhy dostane 409. Zadny overselling. | **Automaticky.** DB row-level lock. |

---

## 7. Souborova struktura modulu

```
C:\Users\omnia\Documents\tixly\upsell-engine\
├── src/
│   ├── app/
│   │   └── api/
│   │       ├── events/
│   │       │   └── [eventId]/
│   │       │       └── upsells/
│   │       │           └── route.ts          # GET — seznam dostupnych upsells
│   │       ├── orders/
│   │       │   └── [orderId]/
│   │       │       └── upsells/
│   │       │           ├── route.ts          # POST — pridani upsell
│   │       │           └── [upsellOrderItemId]/
│   │       │               └── route.ts      # DELETE — odebrani upsell
│   │       ├── organizer/
│   │       │   └── events/
│   │       │       └── [eventId]/
│   │       │           └── upsells/
│   │       │               ├── route.ts      # GET/POST — CRUD
│   │       │               ├── [upsellItemId]/
│   │       │               │   └── route.ts  # PUT/DELETE — update/archive
│   │       │               └── analytics/
│   │       │                   └── route.ts  # GET — statistiky
│   │       ├── staff/
│   │       │   └── upsells/
│   │       │       └── route.ts              # POST — on-site upsell
│   │       └── gopay-callback/
│   │           └── route.ts                  # POST — GoPay webhook pro post-purchase
│   ├── services/
│   │   ├── upsell.service.ts                 # Hlavni orchestrator
│   │   ├── upsell-inventory.service.ts       # Inventarni operace
│   │   ├── upsell-pricing.service.ts         # VIP upgrade + doplatek logika
│   │   └── upsell-analytics.service.ts       # Analytics agregace
│   ├── lib/
│   │   ├── upsell-errors.ts                  # Typovane errory (vzor z resale-errors.ts)
│   │   ├── service-container.ts              # DI container (vzor z resale-api)
│   │   ├── personalization.ts                # Personalizacni razeni
│   │   └── conditions.ts                     # Evaluator pro rules conditions JSON
│   └── types/
│       └── upsell.ts                         # Vsechny TypeScript typy
├── package.json
└── tsconfig.json
```

---

## 8. Poradi implementace

### MVP (Faze 2a) -- odhad 2-3 tydny

| Polozka | Popis | Priorita |
|---|---|---|
| DB schema | `upsell_items`, `upsell_rules`, `upsell_inventory`, `upsell_order_items` | P0 |
| `GET /api/events/[eventId]/upsells` | Seznam upsells s filtraci (bez personalizace) | P0 |
| `POST /api/orders/[orderId]/upsells` | Pridani upsell k objednavce (in-checkout) | P0 |
| Organizer CRUD | Vytvoreni/editace/archivace upsell polozek | P0 |
| Inventarni logika | Kapacitni check, rezervace, atomicke UPDATE | P0 |
| **Podporovane typy MVP:** | Pojisteni, F&B voucher, Parking | P0 |
| GoPay integrace | In-checkout upsell jako soucast hlavni platby | P0 |
| `upsell.purchased` Kafka event | Zakladni event pro ostatni moduly | P0 |
| Platform fee tracking | 10% fee, payout organizatorovi | P0 |
| Idempotency | `idempotency_key` + DB unique constraint | P0 |
| `DELETE` upsell z kosiku | Odebrani pred platbou | P1 |
| Zakladni analytics | Conversions, revenue per item | P1 |

### Faze 2b -- 2-3 tydny po MVP

| Polozka | Popis | Priorita |
|---|---|---|
| VIP upgrade | Dynamicky doplatek pres pricing-engine | P1 |
| Post-purchase upsell | Separatni GoPay platba, thank-you page + email | P1 |
| Merchandise | Varianty (velikosti), integrace s delayed-delivery | P1 |
| Meet & Greet | Limitovana kapacita, countdown timer | P1 |
| wallet-passes integrace | Update Apple/Google Wallet po VIP upgrade | P1 |
| Cascade refund | Kafka consumer na `order.refunded` → refund vsech upsells | P1 |

### Faze 2c -- 2-3 tydny po 2b

| Polozka | Popis | Priorita |
|---|---|---|
| Personalizacni razeni | Historie nakupu, first-time buyer, vernostni body | P2 |
| Pre-event upsell | Email/push 7d a 24h pred akci | P2 |
| On-site upsell (staff tablet) | Offline rezim, sync logika | P2 |
| Camping pass, Locker | Festivalove typy | P2 |
| Travel package | Hotel + vstupenka bundle | P2 |
| referral-system integrace | Cashback na upsell | P2 |
| Pokrocila analytics | Impressions, click-through rate, A/B testovani razeni | P2 |
| Pojisteni — partner integrace | Automaticky claim proces | P2 |
| Variantni inventar | Jednotny item s vice variantami misto separatnich items | P2 |

---

## 9. Bezpecnost a GDPR

- **Autentizace:** Buyer endpointy vyzaduji `x-user-id` header (konzistentni s resale-api). Organizer endpointy vyzaduji navic organizer roli.
- **Staff endpointy:** Vyzaduji `x-staff-id` + overeni prislusnosti ke konkretnimu eventu.
- **GDPR:** `upsell_order_items` obsahuji `order_id` (ne primo PII). Anonymizace probiha kaskadne pres `orders.orders.user_id` → `identity.users.anonymized_at`.
- **EET:** Upsell transakce podlehaji stejne 10lete retenci jako hlavni objednavky (immutable `payment_events` log).
- **Rate limiting:** Organizer CRUD: 100 req/min. Buyer GET: 60 req/min. Staff POST: 30 req/min.

---

## 10. Monitoring

| Metrika | Threshold | Akce |
|---|---|---|
| Upsell conversion rate | < 2% po 7 dnech | Alert organizatorovi — spatne nastavene ceny/razeni |
| Inventar low | `sold_count >= total_qty - low_threshold` | Kafka `upsell.inventory.low` → organizer push |
| Overselling attempt | `reserved_count + sold_count > total_qty` | Nemoze nastat (DB constraint), ale logovat pokus |
| GoPay callback failure | 3x retry failed | PagerDuty alert |
| Post-purchase platba timeout | > 10 min pending | Auto-cancel, uvolnit inventar |
| Offline staff sync conflict | Merge conflict | Staff UI alert + manualni resoluce |
