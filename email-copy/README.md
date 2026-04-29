# Email Subject Lines — Tixly

Kompletní sada subject line variant pro A/B testování emailových kampaní Tixly. Každá kampaň obsahuje 10 CZ a 10 EN variant s různými copywriting přístupy.

## Obsah

- **subject-lines.ts** — Všechny varianty (200 subject lines, 10 kampaní × 20 variant)
- **subject-line-helpers.ts** — Utility funkce (renderování, výběr variant, validace)
- **subject-line-helpers.test.ts** — 50+ testů (vitest)
- **package.json** — Dependencies
- **tsconfig.json** — TypeScript konfigurace

## Kampaně

| Jméno | Triggr | Proměnné | Tón |
|-------|--------|----------|-----|
| `orderConfirmation` | Objednávka potvrzena | `eventName`, `eventDate`, `orderNumber` | Radostný, potvrzující |
| `reminder48h` | 48 hodin před akcí | `eventName`, `eventDate`, `venueName`, `eventTime` | Připomínající, těšící se |
| `resaleWatchlistAlert` | Vstupenka dostupná | `eventName`, `price`, `availableCount` | Urgentní, příležitost |
| `earlyBirdExpiring` | Early bird cena vyprší | `eventName`, `savings`, `deadline`, `earlyBirdPrice` | Urgentní, ale ne spamový |
| `churnRetentionDiscount` | Sleva na prodloužení permanentky | `discountPct`, `passName`, `expiryDate`, `savings` | Osobní, benefitový |
| `referralCreditEarned` | Kredit z referralu připsán | `creditAmount`, `totalCredit`, `referredUserFirstName` | Slavnostní, motivační |
| `seasonPassRenewalReminder` | Prodloužení permanentky | `passName`, `expiryDate`, `daysLeft` | Připomínající, benefitový |
| `orderCancellationRefund` | Storno a refund | `eventName`, `refundAmount`, `refundDays` | Empatický, jasný |
| `newEventRecommendation` | AI doporučení nové akce | `eventName`, `eventDate`, `venueName`, `recommendationReason` | Personalizovaný, objevovací |
| `walletPassAdded` | Vstupenka v Wallet | `eventName`, `walletType` | Praktický, potvrzující |

## Užití

### Renderování subject line

```typescript
import { renderSubjectLine } from './subject-line-helpers'
import { subjectLines } from './subject-lines'

const variant = subjectLines.orderConfirmation.cs[0]
const rendered = renderSubjectLine(variant, {
  eventName: 'Kabát — O2 Arena Praha',
  eventDate: '15. dubna',
  orderNumber: '12345',
})

console.log(rendered) // "✓ Kabát — O2 Arena Praha — máš to!"
```

### Výběr varianty pro A/B test

```typescript
import { selectVariantForUser } from './subject-line-helpers'
import { subjectLines } from './subject-lines'

const campaign = subjectLines.orderConfirmation
const variant = selectVariantForUser(campaign, 'cs', userId) // Deterministic hash
```

### Validace délky

```typescript
import { validateLength } from './subject-line-helpers'

validateLength('Krátký subject') // 'short'
validateLength('Něco delšího kolem 45 znaků') // 'medium'
validateLength('Velmi dlouhý subject line který má více znaků') // 'long'
validateLength('Příliš dlouhý text > 70 znaků') // 'too_long'
```

## Pravidla pro copy

### Délka

- **Short:** ≤35 znaků (vhodné pro mobil)
- **Medium:** 36–55 znaků
- **Long:** 56–70 znaků (max)
- Žádný variant nepřesahuje 70 znaků

### Distribuce délky (každá kampaň)

- Min. 3 short varianty
- Min. 4 medium varianty
- Min. 3 long varianty

### Tón

- CZ: tykání, přirozená čeština
- EN: přátelský ale profesionální
- Bez CAPS LOCK (výjimka: max 1 slovo)
- Max 1 emoji per subject line
- Bez spamových triggerových slov (ZDARMA, KLIKNI, OTEVŘI)

### Proměnné

Handlebars styl: `{{variable}}`

- `{{eventName}}` — "Kabát — O2 Arena Praha"
- `{{eventDate}}` — "15. dubna", "v sobotu"
- `{{venueName}}` — "O2 Arena"
- `{{eventTime}}` — "20:00"
- `{{orderNumber}}` — "#12345"
- `{{price}}` — "850 Kč"
- Další viz sekce Kampaně

## Copywriting přístupy

Každá varianta má `approach` — popis strategie pro testování:

1. **Emoji + název akce** — Vizuální zaměření
2. **Číslo objednávky** — Referenční identifikace
3. **"Máš to" styl** — Sebejistota, potvrzení
4. **Datum jako hlavní info** — Časový fokus
5. **Venue/akce fokus** — Místo jako hook
6. **Krátká, úderná** — Minimální text
7. **Otazník / vzrušení** — Interakce, engagement
8. **Benefit fokus** — Co získáš
9. **Personalizovaná** — Oslovení prvním osobou
10. **Storytelling** — Emocionální narativ

## Testing

```bash
npm install
npm run test
npm run test:coverage
npm run test:ui
```

Testy ověřují:

- Renderování proměnných (nahrazení, chybějící, mutace)
- Determinismus výběru variant (stejný userId = stejná varianta)
- Distribuci variant (rovnoměrné rozložení)
- Délku subject lines (hraniční hodnoty 35, 36, 55, 56, 70)
- Počet variant (10 CZ + 10 EN per kampaň)
- Distribuci délek (min 3 short, 4 medium, 3 long)
- Emoji flag (soulad se skutečným obsahem)
- Validaci všech 10 kampaní

## Struktura

```
email-copy/
  ├── subject-lines.ts              # Data — všechny varianty
  ├── subject-line-helpers.ts        # Utils — renderování, výběr, validace
  ├── subject-line-helpers.test.ts   # Testy — 50+ unit testů
  ├── package.json
  ├── tsconfig.json
  └── README.md
```

## API

### renderSubjectLine(variant, variables)

Nahradí `{{variable}}` v textu skutečnými hodnotami.

- **variant:** `SubjectLineVariant`
- **variables:** `Record<string, string>`
- **return:** `string`

### selectVariantForUser(campaign, locale, userId)

Vybere variantu deterministically pro A/B test.

- **campaign:** `CampaignSubjectLines`
- **locale:** `'cs' | 'en'`
- **userId:** `string`
- **return:** `SubjectLineVariant`

### validateLength(rendered)

Validuje délku rendered subject line.

- **rendered:** `string`
- **return:** `'short' | 'medium' | 'long' | 'too_long'`

### getVariantsByApproach(campaign, locale, approach)

Vrátí všechny varianty pro daný approach.

- **campaign:** `CampaignSubjectLines`
- **locale:** `'cs' | 'en'`
- **approach:** `string`
- **return:** `SubjectLineVariant[]`

### validateCampaign(campaign)

Kompletní validace kampaně.

- **campaign:** `CampaignSubjectLines`
- **return:** `string[]` (pole chyb, prázdné = OK)

## Poznámky

- Všechny varianty jsou hotové, žádné placeholdery
- Testy jsou připraveny k spuštění (vitest)
- TypeScript typy jsou striktní a vynucují integritu dat
- Vhodné pro integraci do email service (Sendgrid, Mailgun, Custom)
