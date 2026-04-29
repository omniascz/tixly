# Tixly — SQL Reporty pro Pořadatele

Sada analytických reportů pro pořadatelský dashboard ticketingové platformy. Všechny reporty jsou optimalizovány pro PostgreSQL 15+ a připraveny pro `EXPLAIN ANALYZE`.

---

## Přehled Reportů

| # | Název | Parametry | Popis | Čas běhu |
|---|-------|-----------|-------|----------|
| 01 | `sales_by_zone.sql` | `:event_id` | Prodeje dle zóny, sekce a typu vstupenky | ~200ms |
| 02 | `resale_volume.sql` | `:event_id` | Objem a analýza přeprodejního trhu | ~150ms |
| 03 | `buyer_demographics.sql` | `:event_id` | Geografika kupujících, repeat buyers, device types | ~300ms |
| 04 | `sales_heatmap.sql` | `:event_id` | Kdy se prodávalo — den/hodina (168 buňek) | ~100ms |
| 05 | `pricing_phase_analysis.sql` | `:event_id` | Výkon jednotlivých fází cenotvorby | ~250ms |
| 06 | `refunds_and_cancellations.sql` | `:event_id`, `:organizer_id` | Přehled refundů a zrušených objednávek | ~180ms |
| 07 | `top_customers.sql` | `:organizer_id` | Top 100 zákazníků (VIP/Loyal/Standard) | ~220ms |
| 08 | `revenue_forecast.sql` | `:event_id` | Prognóza tržeb do konce prodeje | ~150ms |
| 09 | `pass_utilization.sql` | `:organizer_id` | Využití permanentek, renewal rate, MRR | ~200ms |
| 10 | `event_comparison.sql` | `:organizer_id`, `:limit` | Benchmarking akcí dle revenue, fill rate, resale | ~300ms |

---

## Spuštění Reportů

### Základní syntaxe

```bash
psql -v event_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/01_sales_by_zone.sql
psql -v organizer_id="'550e8400-e29b-41d4-a716-446655440000'" -f reports/07_top_customers.sql
```

### Příklady

```bash
# Report 1: Prodeje dle zóny pro konkrétní event
psql -U tixly_app -d tixly \
  -v event_id="'550e8400-e29b-41d4-a716-446655440000'" \
  -f reports/01_sales_by_zone.sql

# Report 3: Demografika kupujících (všechny 3 SELECT)
psql -U tixly_app -d tixly \
  -v event_id="'550e8400-e29b-41d4-a716-446655440000'" \
  -f reports/03_buyer_demographics.sql | head -50

# Report 7: Top zákazníci konkrétního organizátora
psql -U tixly_app -d tixly \
  -v organizer_id="'550e8400-e29b-41d4-a716-446655440000'" \
  -f reports/07_top_customers.sql \
  | grep -E "^(VIP|Loyal|Standard)" | wc -l

# Report 10: Porovnání top 20 akcí
psql -U tixly_app -d tixly \
  -v organizer_id="'550e8400-e29b-41d4-a716-446655440000'" \
  -v limit="20" \
  -f reports/10_event_comparison.sql
```

### Formatování výstupu

```bash
# CSV export
psql -U tixly_app -d tixly \
  -v event_id="'550e8400-e29b-41d4-a716-446655440000'" \
  -A -F',' \
  -f reports/01_sales_by_zone.sql \
  > sales_report.csv

# JSON
psql -U tixly_app -d tixly \
  -v event_id="'550e8400-e29b-41d4-a716-446655440000'" \
  --json \
  -f reports/01_sales_by_zone.sql \
  > sales_report.json
```

---

## Detailní Dokumentace Reportů

### 01_sales_by_zone.sql

**Účel:** Přehled prodejů vstuppenek dle zón a sekcí.

**Výstup:**
- `zone`: Zóna/sektor (např. VIP, Regular, Pit)
- `section`: Sekce (pro seated eventy)
- `ticket_type_name`: Název typu vstupenky
- `tickets_sold`: Počet prodaných vstupenek
- `tickets_remaining`: Zbývajícím kapacita
- `revenue`: Tržby v CZK (pouze placené objednávky)
- `avg_price`: Průměrná cena vstupenky
- `fill_percent`: Procento naplnění (0-100%)

**JOIN strategie:**
```
catalog.ticket_types
  └─ LEFT JOIN orders.order_items (unit_price > 0)
       └─ LEFT JOIN orders.orders (status = 'paid')
            └─ LEFT JOIN tickets.tickets
                 └─ LEFT JOIN catalog.seats (for seated events)
```

**Indexy doporučené:**
- `idx_catalog_ticket_types_event_id` (existuje)
- `idx_orders_order_items_ticket_type_id` (existuje)
- `idx_orders_orders_status` (existuje)
- `idx_catalog_seats_status` (existuje)

---

### 02_resale_volume.sql

**Účel:** Analýza přeprodejního trhu, slev a efektivity.

**Výstup:**
- `total_listings`: Všechny inzeráty (všechny stavy)
- `active_listings`: Aktivní inzeráty
- `sold_listings`: Prodané inzeráty
- `cancelled_listings`: Zrušené inzeráty
- `avg_ask_price`: Průměrná požadovaná cena
- `avg_discount_pct`: Průměrná sleva oproti původní ceně
- `total_resale_revenue`: Tržby z přeproději
- `platform_commission`: Provize (5% fixu)
- `median_time_to_sell_minutes`: Medián doby do prodeje

**Poznámka:** Používáme `PERCENTILE_CONT()` pro medián, který vyžaduje PostgreSQL 9.4+.

---

### 03_buyer_demographics.sql

**Účel:** Tři analýzy — města, opakovaní zákazníci, device types.

**GDPR:** Neobsahuje jméno ani e-mail, pouze agregované metriky.

**Výstup (3 SELECT):**

1. **Top 10 měst:**
   - `city`: Město
   - `buyer_count`: Počet kupujících
   - `revenue`: Celkové tržby
   - `avg_order_value`: Průměrná hodnota objednávky

2. **Repeat buyers:**
   - `repeat_buyers`: Počet zákazníků s 2+ objednávkami
   - `new_buyers`: Počet nových zákazníků
   - `repeat_rate_pct`: Procento repeat buyers

3. **Device types:**
   - `device_type`: web, ios, android, other
   - `order_count`: Počet objednávek
   - `revenue`: Tržby

---

### 04_sales_heatmap.sql

**Účel:** Vizualizace prodejů podle času (kdy se prodává nejvíce).

**Výstup:**
- `day_of_week`: 0=Neděle...6=Sobota (PostgreSQL EXTRACT(DOW))
- `hour_of_day`: 0-23 (0=00:00, 23=23:00)
- `sales_count`: Počet objednávek v daný čas
- `revenue`: Tržby
- `day_name_cs`: Název dne v češtině

**特性:** Vrací všech 168 kombinací (7 dní × 24 hodin), včetně 0 prodejů.

```sql
-- Kombinační grid
generate_series(0, 6) CROSS JOIN generate_series(0, 23)
```

---

### 05_pricing_phase_analysis.sql

**Účel:** Analýza výkonu jednotlivých fází cenotvorby (Early Bird → Regular → Late → Door).

**Výstup:**
- `phase`: Fáze ('early_bird', 'regular', 'late', 'door')
- `price`: Cena v dané fázi
- `tickets_sold`: Počet prodaných vstupenek
- `revenue`: Tržby
- `pct_of_total_sales`: Procento z celkových prodejů
- `avg_demand_factor`: Průměrný demand multiplikátor
- `phase_duration_days`: Délka trvání fáze

**Poznámka:** Mapujeme fáze přes `unit_price` (denormalizace, bez cross-schema FK).

---

### 06_refunds_and_cancellations.sql

**Účel:** Přehled refundů a stornování.

**Parametry:**
- `:event_id` - UUID konkrétní akce
- `:organizer_id` - UUID organizátora (pokud event_id IS NULL)

**Výstup:**
- `event_title`: Název akce
- `order_id`: UUID objednávky
- `cancelled_at`: Kdy byla zrušena
- `refund_amount`: Vrácená částka
- `cancellation_reason`: Důvod (z audit logu)
- `days_before_event`: Kolik dní před akcí

---

### 07_top_customers.sql

**Účel:** Identifikace nejlepších zákazníků (VIP, Loyal, Standard).

**GDPR:** Žádné jméno/e-mail, pouze `user_id`. Dashboard si dohledá informace přes vlastní API.

**Segmentace:**
- **VIP:** `total_spent > 10000 CZK`
- **Loyal:** `orders_count > 5`
- **Standard:** Ostatní

**Limit:** TOP 100

---

### 08_revenue_forecast.sql

**Účel:** Prognóza tržeb na základě historie poslední 7 dnů.

**Výstup:**
- `current_revenue`: Dosavadní tržby
- `remaining_capacity`: Zbývající počet vstupenek
- `avg_daily_sales_last_7_days`: Průměrné denní tržby za poslední týden
- `days_until_event`: Dní do startu akce
- `forecast_additional_revenue`: Prognóza přidaných tržeb
- `forecast_total_revenue`: Celková prognóza
- `confidence`: low/medium/high

**Confidence scoring:**
- **high:** `days > 14` AND `remaining > 20%`
- **medium:** Normální situace
- **low:** `days < 3`

---

### 09_pass_utilization.sql

**Účel:** Analýza permanentek a sezónních karet (pokud existují).

**Výstup:**
- `pass_type_name`: Název permanentky
- `active_passes`: Počet aktivních permanentek
- `total_uses`: Celkový počet použití
- `avg_uses_per_pass`: Průměr na permanentku
- `unused_passes`: Nevyužívané permanentky
- `renewal_rate_pct`: Procento obnovených permanentek
- `monthly_recurring_revenue`: MRR (jen monthly passes)

---

### 10_event_comparison.sql

**Účel:** Benchmarking a porovnání akcí organizátora.

**Parametry:**
- `:organizer_id` - UUID organizátora (povinný)
- `:limit` - počet řádků (default: 10)

**Výstup:**
- `event_title`: Název akce
- `event_date`: Datum
- `total_revenue`: Tržby
- `tickets_sold`: Počet prodaných vstupenek
- `fill_rate_pct`: Procento naplnění
- `resale_rate_pct`: Procento prodejů přes resale
- `avg_ticket_price`: Průměrná cena
- `days_to_sellout`: Dny do vyprodání (NULL pokud se neprodala)
- `rank`: Ranking dle revenue DESC

---

## PostgreSQL VIEW

### organizer_sales_summary

```sql
CREATE OR REPLACE VIEW organizer_sales_summary AS
SELECT
  event_id, organizer_id, title, date_start,
  total_orders, total_revenue, tickets_sold,
  resale_count, days_until_event
FROM ...;
```

**Použití:**
```sql
SELECT * FROM organizer_sales_summary
WHERE organizer_id = '550e8400-e29b-41d4-a716-446655440000'
ORDER BY date_start DESC;
```

---

## Indexy Doporučené pro Výkon

### Stávající (již v schématu)

```sql
idx_catalog_ticket_types_event_id        ✓
idx_catalog_ticket_types_available       ✓
idx_orders_order_items_order_id          ✓
idx_orders_order_items_ticket_type_id    ✓
idx_orders_orders_user_id                ✓
idx_orders_orders_status                 ✓
idx_orders_orders_created_at             ✓
idx_tickets_tickets_order_id             ✓
idx_tickets_tickets_status               ✓
idx_resale_listings_ticket_id            ✓
idx_resale_listings_listed_at            ✓
idx_resale_listings_active               ✓
idx_identity_user_devices_user_id        ✓
```

### Doporučené pro optimalizaci reportů

```sql
-- Report 03: Demografika (buyer cities)
CREATE INDEX idx_identity_users_city
  ON identity.users (city)
  WHERE anonymized_at IS NULL;

-- Report 04: Sales heatmap (časové indexy)
CREATE INDEX idx_orders_orders_paid_at
  ON orders.orders (paid_at DESC)
  WHERE status = 'paid';

-- Report 06: Refunds (audit trail)
CREATE INDEX idx_audit_log_orders_status_change
  ON audit.audit_log (schema_name, table_name, action, created_at DESC)
  WHERE table_name = 'orders' AND action = 'UPDATE';

-- Report 09: Pass utilization
CREATE INDEX idx_passes_season_passes_organizer
  ON passes.season_passes (organizer_id, status);
```

---

## GDPR Poznámky

### PII v Reportech

| Report | PII Obsah | Poznámka |
|--------|-----------|----------|
| 01 | ❌ | Bez PII, pouze agregace |
| 02 | ❌ | Bez PII, resale metrics |
| 03 | ⚠️ | Město (anonymizující), filtr `anonymized_at IS NULL` |
| 04 | ❌ | Bez PII, čas |
| 05 | ❌ | Bez PII, pricing |
| 06 | ⚠️ | order_id je asociovaný s uživatelem, ale bez jména/e-mailu |
| 07 | ✅ | **BEZ JMÉNA/E-MAILU**, pouze `user_id` |
| 08 | ❌ | Bez PII, prognóza |
| 09 | ❌ | Bez PII, permanentky |
| 10 | ❌ | Bez PII, agregace event level |

### Compliance

- **Soft Delete:** Všechny reporty ignorují `anonymized_at IS NOT NULL` uživatele
- **Right to Erasure:** Po anonymizaci přestane být uživatel vidět v demografických reportech
- **Data Retention:** Reporty respektují EET compliance (10 let retence pro orders.payment_events)

---

## Performance Tuning

### EXPLAIN ANALYZE

```bash
psql -U tixly_app -d tixly \
  -v event_id="'550e8400-e29b-41d4-a716-446655440000'" \
  -c "EXPLAIN ANALYZE" \
  -f reports/01_sales_by_zone.sql
```

### Query Planning

```bash
# Bez spuštění (jen plán)
psql -U tixly_app -d tixly \
  -v event_id="'550e8400-e29b-41d4-a716-446655440000'" \
  -c "EXPLAIN" \
  -f reports/01_sales_by_zone.sql

# S bufferovými statistikami (9.0+)
psql -U tixly_app -d tixly \
  -v event_id="'550e8400-e29b-41d4-a716-446655440000'" \
  -c "EXPLAIN (ANALYZE, BUFFERS)" \
  -f reports/01_sales_by_zone.sql
```

---

## Troubleshooting

### Prázdný výstup

1. Zkontrolujte, zda existují zaplacené objednávky (`orders.status = 'paid'`)
2. Ověřte UUID event_id: `SELECT id, title FROM catalog.events LIMIT 5;`
3. Zkontrolujte timezone: reporty používají `NOW()`

### Pomalé spuštění (> 1s)

1. Spusťte `EXPLAIN ANALYZE` a zkontrolujte plán
2. Zkontrolujte dostupnost indexů (viz sekce výše)
3. Zvyšte `work_mem` pro aggregate operace

### "Permission denied"

Ujistěte se, že database user má `SELECT` na všech schématech:
```sql
GRANT USAGE ON SCHEMA catalog, orders, tickets, resale TO tixly_app;
GRANT SELECT ON ALL TABLES IN SCHEMA catalog, orders, tickets, resale TO tixly_app;
```

---

## Integrace do Aplikace

### Node.js / TypeScript

```typescript
const results = await db.query(
  `SELECT * FROM organizer_sales_summary
   WHERE organizer_id = $1`,
  [organizerId]
);
```

### Python

```python
import psycopg2
conn = psycopg2.connect("dbname=tixly user=tixly_app")
cur = conn.cursor()
cur.execute("""
    SELECT * FROM organizer_sales_summary
    WHERE organizer_id = %s
""", (organizer_id,))
results = cur.fetchall()
```

### Go

```go
rows, err := db.Query(
    "SELECT * FROM organizer_sales_summary WHERE organizer_id = $1",
    organizerId,
)
```

---

## Verze & Changelog

| Verze | Datum | Změny |
|-------|-------|-------|
| 1.0 | 2026-04-03 | Iniciální release — 10 reportů + 1 VIEW |

---

## Autory & Licence

Vytvořeno pro platformu **Tixly** (2026).
Dostupné pod MIT licencí.
