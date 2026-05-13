# Push Notification Copy — Tixly

Centralizovaná knihovna push notification textů pro Tixly ticketing platformu. Obsahuje všechny texty v češtině a angličtině, s podporou A/B testingu a template variables.

## Struktura

```
push-notification-copy/
  ├── notifications.ts              # Katalog všech notifikací
  ├── notification-helpers.ts       # Funkce pro rendering a výběr variantů
  ├── notification-helpers.test.ts  # Vitest testy (15+ testů)
  ├── package.json
  ├── tsconfig.json
  └── README.md
```

## Instalace

```bash
npm install @tixly/push-notification-copy
```

## Použití

### Základní import

```typescript
import { pushNotifications } from '@tixly/push-notification-copy'
```

### Vybrání varianty a renderování

```typescript
import { pickVariant, renderNotification } from '@tixly/push-notification-copy'

// Vybrat náhodnou variantu (bez seedu = random)
const variant = pickVariant(
  pushNotifications.reminder.h24,
  'cs' // 'cs' nebo 'en'
)

// Vybrat determinističkou variantu pro A/B testing (stejný seed = vždy stejná varianta)
const deterministicVariant = pickVariant(
  pushNotifications.reminder.h24,
  'cs',
  userId // seed
)

// Nahradit proměnné v notifikaci
const rendered = renderNotification(variant, {
  eventName: 'Koncert Letního festivalu',
  eventTime: '20:00',
  venueName: 'O2 Arena',
  ticketId: '123456'
})

// Výsledek
console.log(rendered)
// {
//   title: "Koncert Letního festivalu za 24 hodin",
//   body: "Začíná v 20:00, O2 Arena. Vstupenka je připravena!",
//   url: "/tickets/123456"
// }
```

## Katalog notifikací

### 1. Reminder před eventem (`reminder`)

**24h před eventem** (`h24`)
- 2x varianta v češtině
- 2x varianta v angličtině
- URL: `/tickets/{{ticketId}}`

**2h před eventem** (`h2`)
- 2x varianta v češtině
- 2x varianta v angličtině
- URL: `/tickets/{{ticketId}}`

### 2. Resale alerty (`resale`)

**Nový listing — watchlist match** (`watchlistMatch`)
- 2x varianta v češtině
- 2x varianta v angličtině
- URL: `/events/{{eventId}}/resale`

**Tvoja vstupenka byla prodána** (`ticketSold`)
- 2x varianta v češtině
- 2x varianta v angličtině
- URL: `/account/payouts`

**Rezervace vstupenky** (`ticketReserved`)
- 1x varianta v češtině
- 1x varianta v angličtině
- URL: `/account/listings`

### 3. Early bird expiruje (`earlyBird`)

**24h do konce early bird ceny** (`h24`)
- 2x varianta v češtině
- 2x varianta v angličtině
- URL: `/events/{{eventId}}`

**1h do konce early bird ceny** (`h1`)
- 2x varianta v češtině
- 2x varianta v angličtině
- URL: `/events/{{eventId}}`

### 4. Permanentky (`seasonPass`)

**Prodloužení permanentky — 14 dní do expirace** (`expiringReminder`)
- 2x varianta v češtině
- 2x varianta v angličtině
- URL: `/passes/{{passId}}/renew`

**Churn risk — sleva na prodloužení** (`churnDiscount`)
- 2x varianta v češtině
- 2x varianta v angličtině
- URL: `/passes/{{passId}}/renew`

### 5. Objednávka a platba (`order`)

**Potvrzení objednávky** (`confirmed`)
- 1x varianta v češtině
- 1x varianta v angličtině
- URL: `/orders/{{orderId}}`

**Platba selhala** (`paymentFailed`)
- 1x varianta v češtině
- 1x varianta v angličtině
- URL: `/orders/{{orderId}}/retry`

### 6. Referral (`referral`)

**Někdo použil tvůj referral link a nakoupil** (`creditEarned`)
- 1x varianta v češtině
- 1x varianta v angličtině
- URL: `/account/credit`

## Proměnné

Všechny dostupné template proměnné (Handlebars syntax):

- `{{eventName}}` — název akce
- `{{venueName}}` — název venue
- `{{venueAddress}}` — adresa venue
- `{{eventTime}}` — čas začátku (např. "20:00")
- `{{eventDate}}` — datum (např. "15. dubna")
- `{{ticketId}}` — ID vstupenky
- `{{orderId}}` — ID objednávky
- `{{passId}}` — ID permanentky
- `{{eventId}}` — ID akce
- `{{price}}` — cena v Kč
- `{{originalPrice}}` — původní cena
- `{{earlyBirdPrice}}` — early bird cena
- `{{savings}}` — úspora v Kč
- `{{deadline}}` — čas expirace (např. "dnes v 23:59")
- `{{passExpiry}}` — datum expirace pasu
- `{{discountPct}}` — % sleva
- `{{creditAmount}}` — připsaný kredit v Kč
- `{{totalCredit}}` — celkový kredit
- `{{payoutDate}}` — datum výplaty

## API Reference

### `renderNotification(notification, variables)`

Nahradí všechny `{{variable}}` placeholdery skutečnými hodnotami.

**Parametry:**
- `notification: PushNotification` — notifikace s placeholdery
- `variables: Record<string, string>` — mapa hodnot

**Vrací:** `PushNotification` — notifikace s nahrazenými hodnotami

**Chování:**
- Chybějící proměnné → prázdný string
- Neobjasněné `{{...}}` → odstraněno
- Nezměňuje vstupní objekt

**Příklad:**
```typescript
renderNotification(
  { title: "{{eventName}} za 24h", body: "Začíná v {{time}}" },
  { eventName: "Koncert" }
)
// → { title: "Koncert za 24h", body: "Začíná v " }
```

### `pickVariant(variants, locale, seed?)`

Vybere jednu variantu z NotificationVariants.

**Parametry:**
- `variants: NotificationVariants` — všechny varianty
- `locale: 'cs' | 'en'` — jazyk
- `seed?: string` — seed pro determinismn (user_id, device_id, ...) — OPTIONAL

**Vrací:** `PushNotification` — vybraná varianta

**Chování:**
- Bez seedu: náhodný výběr (pro A/B testing)
- S seedem: determinističký výběr (stejný seed = vždy stejná varianta)
- Seed je hashován a modulován na délku variant pole

**Příklad:**
```typescript
// Random
const v1 = pickVariant(pushNotifications.reminder.h24, 'cs')
const v2 = pickVariant(pushNotifications.reminder.h24, 'cs')
// v1 != v2 (možná)

// Deterministick
const v3 = pickVariant(pushNotifications.reminder.h24, 'cs', 'user-123')
const v4 = pickVariant(pushNotifications.reminder.h24, 'cs', 'user-123')
// v3 == v4 (vždy)
```

## Délka textů

Všechny notifikace jsou validovány:
- **Title:** max 50 znaků (iOS/Android limit)
- **Body:** max 100 znaků

## Testování

```bash
# Run all tests
npm test

# Watch mode
npm test -- --watch

# Coverage
npm test:coverage

# UI
npm test:ui
```

## Testy

Vitest suite obsahuje 15+ testů:

### renderNotification testy
- Nahrazení všech proměnných
- Chybějící proměnné → ""
- Vnořené proměnné
- Absence mutace vstupu
- Prázdná varianta map
- Notifikace bez URL

### pickVariant testy
- Random výběr bez seedu
- Deterministický výběr s seedem
- Stejný seed → vždy stejná varianta
- Různé seedy → různé varianty (zpravidla)
- Respekt lokalizace (cs/en)
- Error pro prázdné pole

### Délka textů testy
- Všechny CZ titly ≤ 50 znaků
- Všechny EN titly ≤ 50 znaků
- Všechny CZ body ≤ 100 znaků
- Všechny EN body ≤ 100 znaků
- Všechny notifikace mají title + body
- Všechny URL mají deep link pattern (`/...`)

## Statistika

- **6 kategorií** notifikací
- **14 typů** notifikací
- **28 CZ variant** (2–41 ks celkem)
- **28 EN variant** (2–41 ks celkem)

## Best practices

### 1. A/B testing s seedem

```typescript
// V backend notifikačním systému
const variant = pickVariant(
  pushNotifications.reminder.h24,
  userLocale,
  userId // Determinističké — vždy stejná varianta pro uživatele
)
```

### 2. Validace chybějících proměnných

```typescript
const rendered = renderNotification(template, variables)
// Pokud chybí proměnná → bude prázdný string
// Log varování pokud si všimneš ""

if (rendered.title.includes('')) {
  console.warn('Missing variable in title rendering', variables)
}
```

### 3. Generování notifikací na backendu

```typescript
import { pushNotifications, pickVariant, renderNotification } from '@tixly/push-notification-copy'

async function sendReminderNotification(userId: string, event: Event) {
  const variant = pickVariant(
    pushNotifications.reminder.h24,
    getUserLocale(userId),
    userId
  )

  const notification = renderNotification(variant, {
    eventName: event.name,
    eventTime: formatTime(event.startsAt),
    venueName: event.venue.name,
    ticketId: getUserTicket(userId, event.id).id
  })

  await sendPushNotification(userId, notification)
}
```

## Architektura

### TypeScript types

```typescript
type PushNotification = {
  title: string      // max 50 chars
  body: string       // max 100 chars
  url?: string       // deep link pattern
}

type NotificationVariants = {
  cs: PushNotification[]  // Czech variants
  en: PushNotification[]  // English variants
}
```

## Lokalizace

Všechny notifikace jsou k dispozici v:
- **Češtině (cs)** — tykání, přirozená čeština
- **Angličtině (en)** — formal, clear

## License

MIT
