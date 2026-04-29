# Resale Marketplace — Technická architektura

> Claude Opus 4.6 · 4.4.2026

---

## 1. Escrow Flow — stavový diagram

```
BUYER klikne "Koupit"
        │
        ▼
┌──────────────────┐
│  PAYMENT_PENDING  │  ← Buyer má 10 min na dokončení platby
└────────┬─────────┘
         │ GoPay AUTHORIZED (preautorizace — peníze nejsou strženy)
         ▼
┌──────────────────┐
│   ESCROW_HELD     │  ← Autorizováno na kartě buyera, nestrženo
└────────┬─────────┘
         │ QR invalidace + nový secret + buyer claimne
         ▼
┌──────────────────┐
│ ESCROW_CAPTURED   │  ← GoPay CAPTURE — peníze reálně strženy
└────────┬─────────┘
         │ 24h po skončení eventu
         ▼
┌──────────────────┐
│ PAYOUT_PENDING    │
└────────┬─────────┘
         │ GoPay payout na IBAN sellera
         ▼
┌──────────────────┐
│ PAYOUT_COMPLETED  │  ← Konečný stav
└──────────────────┘
```

### Chybové větve

```
Z PAYMENT_PENDING:   timeout 10 min → CANCELLED (listing zpět active)
Z ESCROW_HELD:       claim timeout 4h → REFUNDED (buyerovi)
                     event cancelled → REFUNDED (buyerovi)
Z ESCROW_CAPTURED:   chargeback → CHARGEBACK_REVIEW (manuální)
                     event cancelled → REFUNDED (buyerovi)
Z PAYOUT_PENDING:    payout failed → PAYOUT_RETRY (max 3x, pak manuální)
```

### GoPay technický mechanismus

GoPay podporuje **preautorizaci** (`preauthorization: true`) + následný **capture**:
- `POST /api/payments` s `preauthorization: true` → autorizace na kartě, peníze nejsou strženy
- Autorizace platí max **4 dny** (omezení karetních schémat)
- `POST /api/payments/{id}/capture` → skutečné stržení peněz
- `POST /api/payments/{id}/void-authorization` → uvolnění bez stržení

**Rozhodnutí:** Capture provedeme okamžitě po úspěšném claim vstupenky (ne až po eventu — 4denní limit by nestačil). Peníze sedí na GoPay merchant účtu, payout sellerovi řídíme my.

**Payout timing:** 24 hodin po skončení eventu — ochrana proti chargeback fraudu.

---

## 2. QR Invalidace — přesný flow

### Sekvence

```
T+0s    GoPay AUTHORIZED callback přijat

T+0s    BEGIN TRANSACTION
          1. UPDATE ticket SET status = 'resale_transfer'
          2. Vygeneruj nový totp_secret (crypto.randomBytes(32))
          3. Zašifruj AES-256-GCM, ulož do DB (přepíše starý)
          4. UPDATE resale_listing SET status = 'sold'
          5. INSERT INTO ticket_transfer_log (záloha starého secretu pro claim rollback)
        COMMIT

T+0s    Publish Kafka: ticket.resale.transferred
T+1s    Push sellerovi: "Vstupenka prodána"
        Push buyerovi: "Claimněte vstupenku" (deep link)
T+?     Buyer claimne → stáhne nový totp_secret → generuje nové TOTP kódy
T+?     GoPay CAPTURE (po claim)
```

### Klíčová rozhodnutí

**Kdy se generuje nový secret?** Okamžitě při AUTHORIZED callbacku, v jedné DB transakci. Starý secret přestane existovat okamžitě — žádné okno se dvěma platnými secrety.

**Co se stane se seller aplikací?** App generuje TOTP z lokálně cached secretu — kódy vypadají platně v UI, ale gate scanner je odmítne (validuje proti novému secretu z DB). Při dalším API callu app zjistí změnu a vymaže cache.

**Okno bez platného QR:** Existuje mezi COMMIT a buyer claim. Gate scanner detekuje `status = 'resale_transfer'` a zobrazí "Vstupenka v procesu převodu" místo "Neplatná".

**Gate scanner delta sync:** Každých 60s. Worst case 60s okno se starým secretem — akceptovatelné riziko. Pro high-value eventy: manuální force-sync tlačítko.

**Claim window:** 4 hodiny. Po vypršení: void GoPay authorization, rollback secretu ze `ticket_transfer_log`, listing zpět na active.

---

## 3. Price Cap Enforcement — vícevrstvá ochrana

| Vrstva | Mechanismus | Status |
|---|---|---|
| **DB** | `CHECK (ask_price <= original_price)` | ✅ Existuje |
| **API** | `original_price` načítán z DB (nikdy z klienta) | Implementovat |
| **Payment** | Reconciliation: GoPay amount vs. listing ask_price | Implementovat |
| **Fraud** | Listing za < 50% original_price → auto-block | MVP |
| **Audit** | Immutable log každé transakce | Implementovat |

`original_price` v `resale_listings` se vyplňuje serverově z DB — nikdy nepřijímáme z klienta.

### Side payment detekce (MVP)
Jednoduchý práh: `ask_price < 0.5 × original_price` → auto-block + manuální review.
Plný multi-signal scoring model ve fázi 2.

---

## 4. Seller / Buyer Matching — FIFO design

### Proč FIFO
- Aukce: porušuje price cap princip
- Targeted sale: umožňuje side deals a koordinovaný scalping
- Random: frustrující, nespravedlivé
- **FIFO: spravedlivé, jednoduché, bez prostoru pro manipulaci** ✅

### Jak to funguje
Buyer **nevidí** individuální sellery. UI: `Event → zóna → počet dostupných → nejnižší cena`

Systém přiřadí listing s **nejnižší cenou**. Při shodné ceně → FIFO podle `listed_at`.

### Atomická rezervace
```sql
UPDATE resale_listings
SET status = 'reserved', buyer_id = :buyerId, reserved_until = NOW() + INTERVAL '10 min'
WHERE id = :listingId AND status = 'active'
-- Affected rows = 1 → úspěch
-- Affected rows = 0 → 409 Conflict ("Vstupenka právě obsazena, zkuste jinou")
```
PostgreSQL row-level lock řeší race condition. Žádný TOCTOU bug.

**Reservation window:** 10 minut (pokrývá 3D Secure delay).

### Watchlist notifikace
- Nový listing → Kafka event → consumer prohledá watchlist (event_id, max_price, zone)
- Push + email do 5 sekund od listingu
- Throttling: max 1 notifikace / 5 minut / uživatel / event

---

## 5. Edge Cases — rozhodovací tabulka

| Edge case | Co se stane | Automaticky / Manuálně |
|---|---|---|
| **Event cancelled po resale** | Batch void/refund všech escrow v eventu. Seller nedostane payout — refund za původní ticket přes standardní cancellation. | **Automaticky.** Kafka `event.cancelled` → batch job |
| **Seller no-show (QR bug)** | Support ověří transfer_log. Transfer OK → manuální override token pro gate. Bug → kompenzace. | **Manuálně.** Gate staff volá support. |
| **Buyer no-show** | Nic. Buyer zaplatil, neukáže se — payout sellerovi proběhne normálně. | **Automaticky.** Žádná akce. |
| **Double listing** | Znemožněno: `UNIQUE (ticket_id) WHERE status IN ('active', 'reserved')` partial index → 409. | **Automaticky.** DB constraint. |
| **Claim timeout (4h)** | Void GoPay authorization. Rollback TOTP secretu ze `ticket_transfer_log`. Listing zpět active. Obě strany notifikovány. | **Automaticky.** Kafka delayed message + scheduled job. |
| **Gate offline při resale** | Starý QR může projít (60s window). Post-event reconciliation detekuje nesrovnalosti. | **Auto detekce, manuální řešení.** |
| **Chargeback** | Payout sellerovi na hold. Pokud payout proběhl → platforma nese ztrátu, inkasuje od sellera v dalším payoutu. Buyer flagnutý. | **Auto hold + manuální review.** |
| **Insolvence platformy** | Escrow na GoPay merchant účtu není chráněný vklad. Dokumentovat v T&C. Pro objemy > 1M CZK/měsíc zvážit PSD2 safeguarding. | **Právní / regulatorní.** |

---

## 6. Provize a payout architektura

### Mechanismus
- Buyer zaplatí `ask_price` (1000 Kč) → celá částka na GoPay merchant účet
- Payout sellerovi: `ask_price × (1 - commission_rate)` = 950 Kč (při 5%)
- 50 Kč = revenue platformy

**Proč ne split při inkasu:** GoPay nepodporuje nativní split v jedné transakci.

### Commission rate
- Default: 5%, range 0–5%
- `commission_rate_snapshot` v `resale_listings` — zamkne se při vytvoření listingu
- Konfigurovatelné per organizátor — fáze 2

### Payout
- Metoda: bankovní převod (IBAN ověřený micro-depositem)
- Batch: jednou denně v 6:00
- Timing: 24h po skončení eventu
- Retry: max 3x, pak manuální

### Daně
- EET zrušeno 1.1.2023 — nerelevantní
- Provize platformy: 21% DPH
- Seller (fyzická osoba) při prodeji za ≤ original_price: žádný zisk → žádná daňová povinnost

---

## 7. Monitoring a fraud detection

### Real-time alerty

| Metrika | Threshold | Akce |
|---|---|---|
| Listings/hodina per user | > 10 | Auto-block + review |
| Purchases/hodina per user | > 5 | Auto-block + review |
| ask_price vs original_price | < 50% | Auto-block + review |
| Opakované buyer-seller páry | > 3x/měsíc | Flag pro review |
| Claim rate | < 50%/den | Alert (technický problém?) |
| Payout failure rate | > 5% | Alert (GoPay problém?) |

### SLA
- P1 (auto-blocked, user complaint): 2h pracovní / 8h mimo
- P2 (flagged): 24h
- P3 (pattern analysis): 72h

---

## 8. Pořadí implementace

### MVP Resale (launch)
1. Listing CRUD (create, cancel, auto-delist 24h před akcí)
2. Buyer purchase flow (FIFO matching, GoPay preauth → capture)
3. QR invalidace (atomický TOTP swap, claim flow s 4h window)
4. Escrow (preauth/capture, 24h payout, batch daily)
5. `resale_allowed` flag per event (organizátor může zakázat)
6. Price cap enforcement (DB + API vrstva)
7. Audit log (immutable)
8. Watchlist push notifikace

**Known limitations MVP:**
- Fraud detection pouze price floor (< 50% = block)
- Dispute resolution přes support email
- IBAN ověření manuální (micro-deposit)
- Scanner offline window 60s — akceptováno
- Provize fixně 5%, nekonfigurovatelná

### Fáze 2 (hardening)
- Fraud scoring model (multi-signal, graph analysis)
- In-app dispute resolution
- Konfigurovatelná provize per organizátor
- Seller dashboard (prodeje, payout history)
- Payment reconciliation job
- Kredit na platformě jako alternativní payout

### Fáze 3 (backlog)
- Coordinated scalping detekce (graph clustering)
- Multi-currency (CZK + EUR) při expanzi na SK
- PSD2 safeguarding pro objemy > 1M CZK/měsíc
- Waitlist systém (buyer se přihlásí před vznikem listingu)

---

## Klíčová rozhodnutí — souhrn

| Rozhodnutí | Volba | Důvod |
|---|---|---|
| Escrow | GoPay preautorizace + capture | Nativní podpora, žádná simulace |
| Payout timing | 24h po eventu | Chargeback ochrana |
| TOTP transfer | Atomický swap v jedné DB transakci | Žádné okno bez platného QR |
| Claim window | 4 hodiny | Kompromis UX vs. seller lock-in |
| Buyer matching | Best price first, FIFO pro ties | Spravedlivé, jednoduché |
| Reservation window | 10 minut | Pokrývá 3D Secure delay |
| Provize odečtení | Při payoutu (ne při inkasu) | Jeden GoPay request |
| Fraud MVP | Pouze price floor | Rychlé nasazení |
| Multi-currency | Odloženo | CZ-only MVP |
