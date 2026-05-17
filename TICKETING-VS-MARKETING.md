# Ticketing vs marketing — co je jádro, co je add-on

> Reakce na zpětnou vazbu: v `TIER-B-DECISIONS.md` jsem **smíchal core ticketing** (provize, refund pravidla) s **marketing monetizací** (Ads CPC). To jsou dva rozdílné produkty s rozdílnými rozhodovacími maticemi. Tady to rozplétám.

---

## Dvě vrstvy Tixly

```
┌──────────────────────────────────────────────────────────────────────┐
│  VRSTVA 1: PŘEDPRODEJ (core)                                         │
│  „Promotér chce prodat vstupenky, kupec chce přijít na akci."         │
│                                                                       │
│  Tvorba akce → discovery → koupě → checkout → mail/SMS → scan        │
│  Refund · transfer · resale · permanentky · gift                      │
│                                                                       │
│  Revenue model: provize z prodaných lístků (% × cena)                │
│                  servisní poplatek pro kupce (volitelně)             │
└──────────────────────────────────────────────────────────────────────┘
                              ⇩
┌──────────────────────────────────────────────────────────────────────┐
│  VRSTVA 2: MARKETING ADD-ONS (volitelné služby pro promotéry)        │
│  „Mám akci, jak prodám víc lístků?"                                  │
│                                                                       │
│  • Marketplace Ads (CPC)  — promovat akci na homepage / search       │
│  • Email kampaně           — newsletter buyer base                    │
│  • SMS kampaně             — informační + remarketing                 │
│  • Affiliate / referral    — odměna za přivedení kupce               │
│  • Social ads pixel        — FB/IG tracking + lookalike audience     │
│  • Smart send-time         — AI optimalizovaný čas odeslání          │
│  • Sponsor crm             — sponzoři + B2B prodej                    │
│                                                                       │
│  Revenue model: per-event/měsíční SaaS fee + CPC + per-SMS           │
└──────────────────────────────────────────────────────────────────────┘
```

**Důležitý insight:** vrstva 2 je **sekundární revenue stream pro Tixly**, ne závislost vrstvy 1. Promotér může používat Tixly pro ticketing a marketing si dělat sám (jako u SMSticket).

---

## Vrstva 1 — předprodej (co musíme rozhodnout pro launch)

### Provize: per-promoter, ne globální tier

Tvoje připomínka je správná. SMSticket model: **5 % default, individuální dohoda pro velké pořadatele, slevy pro KSK / charitu**. Žádný rigidní tier.

**Návrh:**
```
catalog.promoters.fee_pct          NUMERIC  -- per-promotér % provize
catalog.promoters.buyer_fee_halire INTEGER  -- per-promotér servisní fee pro kupce
catalog.promoters.fee_pct_override TEXT     -- důvod pro odchylku od defaultu (kultura/charita/objem)
```

**Pricing matrice (jen defaults, override per promotér):**

| Velikost akce | Default % | Default buyer fee |
|---|---|---|
| Malá (< 100 tix) | 7 % | 10 Kč |
| Střední (100–2 000) | 5 % | 10 Kč |
| Velká (2 000+) | 4 % | 15 Kč |
| Charita / KSK | 2 % | 0 Kč |

Master admin v `/platform/promoters/[id]` může přepsat per-promotér. SMSticket-style.

**Co potřebuju od tebe:**
1. Jaké jsou 4 default sazby (nebo souhlas s mým návrhem)?
2. Bude vlastní platforma poplatek brát i z **face value**, nebo má kupec připlácet (transparency)?

### VS pro bank transfer

Tady jsem nepřemýšlel správně. Bankovní převod NENÍ per akce, ale **per objednávka** (kupec převede X Kč jednou). VS musí jednoznačně identifikovat objednávku.

Tvoje formulace „unikátní kód akce" může znamenat:
- a) **VS = event_short_code + buyer_sequence** — např. event ROMEO má kód `RJ` + 6-digit sequence = `RJ001234`. Ale VS musí být numeric (banka), takže event by musel mít numeric ID.
- b) **VS = order_number numeric** — globálně rostoucí, jednoduché. Pair-up přes orders.order_number.
- c) **VS = order_number per event** — sekvence reset per akce, takže R&J má 1,2,3..., Hamlet má 1,2,3... Banka rozpozná po amount + event association.

Můj návrh `YYNNNNNNNN` (rok + globální sekvence) je vlastně varianta (b). Co preferuješ?

### Self-service refund — pravidla

- Default: refund max do X dní před akcí, fee = max(50 Kč, 10 % objednávky), promotér může override per akce
- Kdo nese náklady refund: pravděpodobně promotér ze své kvóty (pokud platí provizi)

**Co potřebuju od tebe:** X dní default? Nebo to per-promotér v promoter settings?

### Chargeback holdback (= bývalé B-5)

Když si kupec po nákupu otevře dispute v bance („nedostal jsem lístek"), banka strhne peníze a my musíme z payoutu promotérovi něco držet jako rezervu. Buď to bereme z naší provize, nebo držíme % v settlement.

**Otázka:** Tixly zaplatí promotérovi 100 % příjmu z prodeje hned, nebo držíme X % po Y dní pro chargeback krytí?

To je business risk decision, ne tech. Default ve světě: 5 % po 60 dní (Stripe disputeyhno window je 60-180 dní). Pokud nedržíme nic = my neseme veškeré riziko.

### Statický vs rotující QR (= bývalé B-6)

Když posíláme email s PDF, je tam **statický QR**. Lze ho vyfotit screenshot a sdílet (= padělání).

Náš `/cs/t/[token]` má **rotující QR** který se mění každých 30s. Scanner přijímá oba. Otázka: kdy stáhnout statický a vynutit rotující?

- A. Static funguje vždy (současný stav) — riziko sdílení
- B. Static jen do X dní před akcí, pak jen rotující
- C. Static off úplně — kupec MUSÍ mít smartphone

To je security vs UX decision.

---

## Vrstva 2 — marketing add-ons (oddělená diskuse)

**Toto neřeš teď, pokud nechceš.** Vrstva 1 stačí pro launch. Vrstva 2 je „jak naúčtujeme víc" potom.

### Co Tixly nabízí promotérovi po launch

| Add-on | Kdo platí | Cena návrh | Stav v kódu |
|---|---|---|---|
| **Marketplace Ads** — sponsored slot na Tixly homepage / kategorii / search | Promotér | CPC 3-12 Kč/klik | ✅ hotové (b06d26c) |
| **Emailová kampaň** přes Tixly buyer DB (segmented) | Promotér | 0.50 Kč/email | 🟡 částečně |
| **SMS informační** kupcům aktuální akce | Promotér | 1.50 Kč/SMS | ✅ hotové (catch-up #1) |
| **SMS remarketing** kupcům minulých akcí | Promotér | 3 Kč/SMS | 🟡 částečně |
| **Affiliate / referral** odměna za sdílení | Pokrývá promotér z marže | 5-15 Kč/konverze | ✅ hotové |
| **Push notifikace** subscribers | Free / Tixly+ | — | ✅ hotové (439e562) |
| **Smart send-time** AI | Free pro tier 2+ | — | 🟡 částečně |
| **Heat-map analytika** | Free pro všechny | — | ✅ hotové (be1f623) |
| **AI cover image gen** | Tier 2+ free, Tier 1 platí | 20 Kč/generace | ✅ hotové (W.3) |
| **AI popis akce** | Free do X za měsíc | — | ✅ hotové (b5cdd04) |

**Důležité:** Marketplace Ads znamená, že **Tixly vlastní inventory** (homepage slot, search top atd.) a promotéři si u nás kupují CPC. To je sekundární revenue, ne náhrada provize.

**Tohle ale rozhodovat teď nemusíš.** Pro launch stačí vrstva 1. Marketing add-ony naceníme až po prvním pilotu, kdy uvidíme reálná čísla.

---

## Sub-účty + RBAC

Park it — sám jsi řekl „zatím nevím". To je feature pro promotéry v Tier 2+ (více lidí v týmu spravuje akce). Pro pilot s 1-3 promotéry nepotřebné. Vrátíme se až po prvním reálném použití.

---

## Co tedy potřebuju, abys rozhodl PRO LAUNCH

Vrstva 1 only:

1. **Provize default sazby** — 4 čísla (malá/střední/velká/charita) + souhlas s per-promotér override v master adminu
2. **Buyer fee** — bere se z face value, nebo se připlácí?
3. **VS formát** — sekvence per order, per event, nebo per promotér?
4. **Refund deadline default** — kolik dní před akcí?
5. **Chargeback holdback** — držíme něco nebo platíme hned?
6. **Static QR policy** — A/B/C výše?

Šest čísel / yes-no. Pak je core ticketing rozhodnutý.

Marketing layer 2 odložíme do **post-pilot retrospektivy** (po prvních 3 reálných akcích).

---

## Co jsem opravil v hlavě

- ✗ Tier 1-4 globální sazby → ✓ default sazby + per-promotér override (SMSticket model)
- ✗ Ads pricing jako blocker pro launch → ✓ vrstva 2 add-on, řešíme až po pilotu
- ✗ Sub-účty jako P2 must-have → ✓ vrstva 1 nepotřebuje, parked
- ✗ Promíchat ticketing s marketingem → ✓ dvě oddělené vrstvy
- ✗ Šest Tier B otázek → ✓ šest **ticketingových** otázek (B-1, B-3 vyhozené, B-2 odloženo)
