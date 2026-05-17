# CZ + SK launch — roadmapa

> Rozhodnutí 2026-05-15: zaměřit se nejprve na **český + slovenský trh**. Mezinárodní expanze odložena, budeme se k ní vracet, až bude jasné, co tam reálně potřebujeme.
>
> Tento dokument nahrazuje rozdělení v `TIER-B-DECISIONS.md` — vyfiltrované jen na CZ/SK.

---

## Dvě větve

```
┌─────────────────────────────────────────────────────────────────────┐
│  VĚTEV A — CZ/SK launch (priorita teď)                              │
│  Cíl: 1-3 reální promotéři, první akce za peníze do 4-6 týdnů       │
│                                                                      │
│  Trhy: Česká republika + Slovensko                                  │
│  Měna: CZK (CZ akce) + EUR (SK akce)                                 │
│  Jazyk: CS + SK + EN                                                 │
│  Právní entita: Tixly s.r.o. (CZ), trading do SK                    │
└─────────────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────────────┐
│  VĚTEV B — mezinárodní expanze (odložená)                           │
│  Cíl: ne dřív než po 6 měsících CZ/SK provozu                       │
│                                                                      │
│  Bude potřeba rozhodnout, až bude na řadě:                          │
│  - které trhy (DE/AT? PL? celá EU?)                                  │
│  - lokální entity vs cross-border služba                             │
│  - další měny, VAT MOSS, lokální platební metody                     │
│  - lokalizace nad rámec EN                                           │
│                                                                      │
│  Tixly tech stack to podporuje (multi-currency, multi-locale          │
│  hooks už v kódu), ale nepřipravujeme infrastrukturu dopředu.       │
└─────────────────────────────────────────────────────────────────────┘
```

**Pro tuto sezónu se bavíme jen o VĚTVI A.** O B se vrátíme, až tu budeš mít více informací.

---

## CZ + SK rozdíly (specifika obou trhů)

| Oblast | ČR | SR | Řešení |
|---|---|---|---|
| Měna | CZK | EUR | Per-event currency, per-promotér primary |
| DPH | 21 % standardní / 10 % kulturní | 23 % standardní / 5 % snížená kulturní | Promotér si nastaví v profilu |
| IČO / DIČ | 8-mistné IČO + DIČ `CZ...` | IČO 8-mistné + DIČ `SK...` | Stejný field, prefix určí trh |
| Platby | Karta, GoPay, Apple/Google Pay, Pluxee | Karta, ComGate, Apple/Google Pay | Stripe Connect zvládne obojí |
| Bank transfer | VS (variabilní symbol) | rovnaký systém VS | Sdílený formát |
| Účetnictví | Pohoda, Money S3, iDoklad | Money S3, Pohoda, Omega | Export CSV univerzální |
| Cookies / GDPR | EU GDPR + CZ zákon č. 110/2019 | EU GDPR + SK zákon č. 18/2018 | Jeden cookie banner stačí |
| ToS | Občanský zákoník ČR | Občianský zákonník SR | Dva právní dokumenty, jednoduchá adaptace |
| Cultural pricing | 10 % DPH kultura | 5 % DPH kultura, ZÁKON | Promotér nastaví, transparent k vykazování |
| Distribuce | SMSticket dominance v menších městech | Predaj.sk, ticketportal.sk | Cross-market discovery možný |

**Klíčové insighty:**

1. **SK NENÍ jen „CZ s EUR"** — DPH kulturní je tam 5 %, ne 10 %. Pokud chceme SK promotéry, musíme to v kódu odlišit.
2. **Tixly s.r.o. může trading do SK bez SK entity** — fungujeme jako digital service B2B. VAT MOSS pro EU services. Daňový poradce to potvrdí.
3. **EUR bank account = nutnost** — SK promotéři nebudou převádět CZK. Standardní Fio/Raiffeisen multi-currency account.

---

## Co je hotové v kódu (CZ/SK ready)

Z předchozích commit logů + Tier-1 batch:

### Tech infra
- ✅ **Multi-currency v DB** (migrace `002_add_currency_timezone_locale.sql`)
- ✅ **i18n CS + SK + EN aktivní** (catch-up #5, `c8a4458`)
- ✅ **DPH rozpis na PDF** — promotér.vat_rate_pct (z `001`), default 10 % CZ
- ✅ **PSD2 OAuth bank integration** — KB/ČS/ČSOB (Tier-1 #4, `b05c9a9`) + Fio (catch-up #9)
- ✅ **GoPay integration** (komercializované přes Stripe wrapper, `6d3f282`)
- ✅ **Wero (SEPA Instant)** — EU-wide A2A platba pro EUR (`d90fdfd`)
- ✅ **Pluxee / Benefit Plus / Sodexo / Gallery Beta / Edenred** (`cdcf23e`) — CZ benefit cards
- ✅ **WCAG 2.1 AA audit** (Tier-1 #2, `fde40aa`) — EAA platí v EU
- ✅ **Czech moderation keyword blocklist** + AI gate (`01d2b6b`)
- ✅ **Apple Wallet pass infra** pro PDF náhradu

### Co chybí v kódu pro **CZ/SK** specifické

1. ❌ **VAT rate per market (SK má 5 % kulturní, ne 10 %)** — `promoters.vat_rate_pct` je flat, neumí per-event currency mapping
2. ❌ **Variabilní symbol pro SK bank transfers** — VS koncept existuje i v SR, ale formát se může lišit. Ověřit.
3. ❌ **EUR primární měna pro SK promotéry** — `promoters.primary_currency` flag chybí
4. ❌ **Slovak ToS / GDPR / Cookie text** — máme jen CS + EN právní texty
5. ❌ **Settlement v EUR** — payouts UI je CZK-only (`/admin/payouts`), neumí filter per currency

To je 5 položek code work, ~5-8 dní.

---

## CZ/SK Tier B rozhodnutí (přepracované)

Vyfiltrované jen na to, co reálně potřebuju pro launch v CZ/SK. **Vyhozeno** to, co nepatří do core ticketing (Ads, Sub-účty viz `TICKETING-VS-MARKETING.md`).

### CZ-SK-1: Default sazba provize + buyer fee + per-promotér override

**Co fixed pro launch:**

```
Default sazby (master admin přepíše per-promotér):
  CZ promotér:
    - Malá akce (< 100 tix):  7 % provize, 10 Kč buyer fee
    - Střední (100-2000):     5 % provize, 10 Kč buyer fee
    - Velká (2000+):          4 % provize, 15 Kč buyer fee
    - Charita / KSK / div.:   2 % provize, 0 Kč buyer fee

  SK promotér:
    - stejné sazby jako CZ, jen v EUR
    - buyer fee 0.40 EUR / 0.40 EUR / 0.60 EUR / 0 EUR
```

Master admin v `/platform/promoters/[id]` přepíše per-promotér. Důvod uložen do `fee_pct_override` (audit trail).

**Otázka pro tebe:**
1. Souhlas se sazbami? (Můžeš změnit kterékoli)
2. Bere se face value (kupec vidí finální cenu) nebo se připlácí (transparency)? Můj návrh: **face value = final, fee zahrnuto v ceně**. SMSticket model.

### CZ-SK-2: VS pro bank transfer

Tvoje formulace „unikátní kód akce" konkretizovaná:

**Návrh A (per-order globální):**
```
VS = YYNNNNNNNN (10 znaků numeric)
   ↑↑          ↑─ 8-digit sequence (max 99M objednávek)
   └── rok 2-digit

Příklad: 2600000123 = 123. objednávka 2026
```
Plus: jednoduchý, univerzální. Mínus: nedává info o akci.

**Návrh B (per-akce sekvence):**
```
VS = EEEEEENNNN (10 znaků numeric)
     ↑      ↑─ 4-digit sequence v rámci akce (max 9999 lístků/akce)
     └── 6-digit event_short_id (přiřazeno akci při tvorbě)

Příklad: 4012340023 = 23. objednávka na event #401234 (Romeo a Julie)
```
Plus: promotér okamžitě vidí, ke které akci převod patří. Mínus: limit 9999 lístků/akce (pro festival se nehodí).

**Návrh C (hybrid):**
```
VS = PPPP NNNNNN (10 znaků numeric)
     ↑    ↑─ 6-digit sequence per promotér (max 999K akcí na promotéra)
     └── 4-digit promoter_id

Příklad: 0123 456789 = 456789. objednávka promotéra #0123
```
Plus: per-promotér accountability, bank reconciliace clean. Mínus: 4-digit promoter ID limit (max 9999 promotérů — pro pilot stačí).

**Můj návrh: B.** Promotér vidí v bance přímo akci, k níž platba patří. Pro festivaly (>9999 ks) máme fallback na sub-sekvence per den/den-segment.

**Co řekni:** A/B/C nebo jiný.

### CZ-SK-3: Refund deadline default

**Tradice v CZ ticketingu:**
- SMSticket: 14 dní před akcí, 5 % fee, promotér může změnit
- GoOut: závisí na promotérovi, typicky 7 dní
- Eventim: 14 dní, 10 % fee
- Letní festivaly: typicky no-refund, max výměna za jiný den

**Můj návrh:**
```
Default:
  - Refund self-service do 7 dní před akcí
  - Refund fee: 5 % objednávky, min 30 Kč / 1.20 EUR
  - Po 7 dnech: jen výjimečně přes support (zdravotní)
  - Promotér může v event settings přepsat:
    - „No refund po publikaci" (pro free akce / VIP)
    - „Refund až 24h před akcí" (pro relaxed promotéry)
    - „Custom fee %" (default 5 %)
```

**Co řekni:** 7 dní default + 5 % fee — ano? Nebo jiné defaulty?

### CZ-SK-4: Chargeback holdback

Z `ANALYZA-CHARGEBACK-A-QR.md`:

**Návrh:**
- Tier 1 (nový, < 5 schválených akcí): **5 %** holdback po **90 dní**
- Tier 2 (ověřený): **3 %** po **60 dní**
- Tier 3+ (důvěryhodní, velký objem): **0 %** holdback

Tier evaluation běží měsíčně (cron). Po každé úspěšné akci se započítává proti thresholdu.

**Co řekni:** ano nebo jiné %.

### CZ-SK-5: QR padělání policy

Z `ANALYZA-CHARGEBACK-A-QR.md` — místo globálního rozhodnutí **per-event flag**:

```
catalog.events.qr_policy:
  'static_allowed'  (default) — PDF i mobile funguje
  'rotating_24h'    — PDF přestane 24h před akcí
  'rotating_only'   — od začátku jen mobile QR
  'photo_required'  — Level 3 pro festivaly
```

Promotér si zvolí při tvorbě akce. Defaults podle tier:
- Tier 1: vždy `static_allowed`
- Tier 2: `static_allowed`, pro high-demand může povýšit
- Tier 3+: může používat všechny varianty

**Co řekni:** ano s 4 úrovněmi nebo zjednodušit?

### CZ-SK-6: SK kulturní DPH 5 %

**Kontext:** SR má pro kulturní akce **5 % DPH**, ne 10 % jako ČR. Pokud SK promotér dělá akci v SR, musí to v účtence být korektní.

**Návrh:**
```
catalog.events.vat_category:
  'standard'      → 21 % CZ / 23 % SR
  'cultural'      → 10 % CZ / 5 % SR  ← AKTUÁLNÍ DEFAULT
  'food_beverage' → 12 % CZ / 19 % SR (pro F&B addony)
  'merchandise'   → 21 % CZ / 23 % SR

Detected from promoters.country (CZ vs SR).
Promotér vidí preview daňové sazby při tvorbě akce.
```

**Co řekni:** ano nebo jen 10 % CZ + 5 % SR bez další granularity?

---

## CZ/SK Tier C — API keys & accounts pro launch

### Platby
- **Stripe Connect** — primární platební brána (multi-currency, multi-country) → KYC 1-3 dny
- **GoPay** — backup pro CZ, mnoho promotérů ho zná → KYC 5-7 dní
- **ComGate** — alternativa pro SK, mnoho slovenských promotérů ho zná → KYC 3-5 dní

**Doporučení:** Start s Stripe (Connect podpora obou trhů z jedné integrace). GoPay/ComGate jako fallback option pro promotéry, kteří už účet mají.

### Email
- **Resend** — moderní, dobré CZ podpora, EU servery → 30 min setup po DNS
- **Postmark** — vyšší cena, ale lepší deliverability → 30 min

### SMS
- **BulkGate** — český provider, výborné CZ + SK rates → 1-2 dny KYC
- **Twilio** — globální fallback (pokud BulkGate selže) → instant

### CAPTCHA
- **hCaptcha** — preferované (GDPR friendly, ne Google) → 10 min

### Push
- **Web Push (VAPID)** — žádný 3rd party, vlastní generování → 0 min
- Nepotřebuje Firebase pro CZ/SK launch

---

## CZ/SK Tier D — fyzické/právní úkony

### Pro CZ
1. **Tixly s.r.o.** — registrace v OR (10 dní)
2. **IČO + DIČ** — automaticky se založením s.r.o.
3. **Bankovní účet (CZK + EUR)** — Fio nebo Raiffeisen umí oba současně
4. **GDPR DPA** + ToS CZ — k právníkovi (1-2 týdny)
5. **Czech accounting** — Pohoda nebo iDoklad účet
6. **Pojistka odpovědnosti** — D&O + IT errors

### Pro SK extension
7. **VAT MOSS** registrace — pro cross-border digital services do SK (Tixly poskytuje SaaS služby SK promotérům, fakturuje s SK VAT) — 1 týden
8. **ToS SK** — překlad z CZ + právní review SK právníkem (1-2 týdny)
9. **Cookie banner SK** — adaptace z CZ verze

### Dohromady
**Timeline:** 3-4 týdny od „rozhodnutí jdeme" k „mám účet, můžu legálně inkasovat". Stripe KYC běží paralelně.

---

## Plán postupu po týdnech (pokud začneš today)

```
Týden 1 (TENTO TÝDEN):
  ✓ TY rozhodneš 6 Tier B otázek (CZ-SK-1 až CZ-SK-6)
  ✓ JÁ implementuju per-promotér fee override + SK DPH 5 % + VS gen
  ✓ TY začneš s.r.o. registraci + Stripe KYC

Týden 2:
  ✓ JÁ dokončím refund deadline UI + qr_policy + Slovak ToS placeholder
  ✓ TY: bank account otevřený, IČO přiděleno
  ✓ JÁ: Resend setup po doménové ověření

Týden 3:
  ✓ Hands-on test s reálným Stripe sandbox
  ✓ První pilot promotér onboarding (Divadlo Verze podle seedu)
  ✓ JÁ: Slovak ToS od právníka → uložit

Týden 4:
  ✓ První reálná akce za peníze (1 Kč pilot)
  ✓ Hands-on smoke test celého flow live
  ✓ Sledování chargebacků / payoutů

Týden 5+:
  ✓ 2-3 reálné akce, kupování běžné
  ✓ Začínáme řešit Vrstvu 2 (marketing add-ons)
```

---

## Co potřebuju ode tebe TEĎ

**6 odpovědí na CZ-SK-1 až CZ-SK-6.** Můžeš:

- **„yes-to-all"** — souhlas s mými návrhy → spustím všech 6 fixů
- **selektivně** — odpověz jen na ty, kde máš jiný názor

A pak se rozjedeme. Vrstva 2 (marketing) zůstane parked, mezinárodní větev zůstane parked.

---

## Co odkládáme do **Větve B** (mezinárodní)

Pro budoucí já / budoucí ty:

- Multi-currency nad rámec CZK + EUR
- Země mimo EU (UK, US, Asia)
- Lokalizace nad EN/CS/SK (DE, FR, IT...)
- Lokální platební metody (iDEAL, BLIK, BANCONTACT, SEPA elektronicky atd.)
- VAT MOSS pro další trhy (DE, AT, PL...)
- Lokální bank account v dalších zemích
- Cross-market discovery (PLG model — sdílení katalogu napříč zeměmi)
- Lokální entity (Tixly GmbH, Tixly OOD, Tixly LTD...)

**Doporučení:** nepřipravovat dopředu. Až přijde reálná business potřeba (např. tě osloví festival z DE, nebo expanze přes acquisition), pak rozhodneme případ od případu.
