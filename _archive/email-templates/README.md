# Tixly Email Templates

Profesionální HTML e-mailové šablony pro ticketingovou platformu Tixly. Všechny šablony jsou optimalizovány pro podporu v Gmail, Outlook, Apple Mail a mobilních klientech.

## Struktura

```
email-templates/
├── shared/
│   └── base.html              # Základní layout (header, footer, branding)
├── order-confirmation.html    # Potvrzení objednávky
├── ticket-delivery.html       # Doručení vstupenky
├── reminder-48h.html          # Připomínka 48h před akcí
├── order-cancellation.html    # Storno objednávky
├── resale-sold.html           # Prodejce notifikace (vstupenka prodána)
├── src/
│   ├── email-renderer.ts      # Renderovací utilita + type definitions
│   └── email-renderer.test.ts # Unit testy
└── README.md                  # Tato dokumentace
```

## Technologické detaily

### Handlebars.js
- Šablony se renderují přes **Handlebars.js**
- Syntaxe: `{{variable}}`, `{{#if}}`, `{{#each}}`
- Triple braces `{{{content}}}` = unescaped HTML (ignoruje encoding)

### Email klienti
- **Tested**: Gmail web, Gmail mobile, Outlook 2019, Apple Mail
- **Responsive**: Max-width 600px, centrovaný layout
- **Fallback**: Všechny šablony fungují bez CSS (inline styles)

### Barvy
- **Primární**: `#6366f1` (indigo-500)
- **Sekundární**: `#f8fafc` (slate-50)
- **Úspěch**: `#10b981` (green-500)
- **Varování**: `#facc15` (amber-300)
- **Chyba**: `#ef4444` (red-500)

## Šablony

### 1. Order Confirmation (`order-confirmation.html`)
Odesláno ihned po zaplacení objednávky.

**Povinné proměnné:**
- `orderNumber` - Číslo objednávky
- `customerName` - Jméno zákazníka
- `orderDate` - Datum objednávky (formát: "pátek 5. dubna 2026")
- `items` - Pole s objekty (eventTitle, date, venue, quantity, unitPrice, totalPrice, ticketType)
- `subtotal` - Cena vstupenek
- `fees` - Poplatek za zpracování
- `total` - Celková cena
- `paymentMethod` - Způsob platby
- `downloadUrl` - Odkaz na stažení vstupenek

**Klíčové prvky:**
- ✓ Zelený checkmark
- Tabulka se shrnutím objednávky
- Rozpad ceny (vstupenky + poplatek)
- CTA: "Stáhnout vstupenky"
- Info: vstupenka v aplikaci

### 2. Ticket Delivery (`ticket-delivery.html`)
Odesláno s PDF přílohou po vytvoření vstupenky.

**Povinné proměnné:**
- `customerName` - Jméno zákazníka
- `eventTitle` - Název akce
- `eventDate` - Datum akce (formát: "pátek 10. května 2026")
- `eventTime` - Čas začátku (formát: "19:30")
- `venue` - Název místa konání
- `venueAddress` - Adresa místa
- `ticketType` - Typ vstupenky
- `seatInfo` - Informace o místě (nullable: "Volné stání" nebo "Sekce A, Řada 3, Místo 12")
- `ticketId` - Jedinečné ID vstupenky
- `qrCodeUrl` - URL obrázku QR kódu (statický náhled)
- `appDownloadUrl` - Odkaz na aplikaci

**Volitelné proměnné:**
- `dynamicQrNote` - Poznámka o dynamickém QR kódu

**Klíčové prvky:**
- Karta s detaily vstupenky
- QR kód jako statický obrázek
- ⚠️ Upozornění: "Dynamický QR je pouze v aplikaci"
- CTA: "Otevřít v aplikaci"
- Info: PDF vstupenka je přiložena

### 3. Reminder 48h (`reminder-48h.html`)
Připomínka 48 hodin před akcí.

**Povinné proměnné:**
- `customerName` - Jméno zákazníka
- `eventTitle` - Název akce
- `eventDate` - Datum akce
- `eventTime` - Čas začátku
- `venue` - Název místa
- `venueAddress` - Adresa místa
- `doorsOpen` - Čas otevření dveří
- `seatInfo` - Informace o místě
- `ticketCount` - Počet vstupenek
- `appDownloadUrl` - Odkaz na aplikaci
- `mapUrl` - Odkaz na mapu
- `resaleUrl` - Odkaz na prodej vstupenky

**Volitelné proměnné:**
- `requiresId` - Boolean: zda je vyžadován průkaz
- `weatherNote` - Poznámka o počasí

**Klíčové prvky:**
- 🎉 Emoji v nadpisu
- Countdown/highlight data
- Checklist: aplikace, ID (podmíněné), čas
- CTA: "Zobrazit vstupenku"
- Sekundární CTA: "Prodejte vstupenku"
- Podmíněný blok: počasí/dress code

### 4. Order Cancellation (`order-cancellation.html`)
Storno objednávky s informací o vrácení peněz.

**Povinné proměnné:**
- `customerName` - Jméno zákazníka
- `orderNumber` - Číslo objednávky
- `eventTitle` - Název akce
- `cancellationReason` - Důvod zrušení
- `refundAmount` - Vrácená částka
- `refundDays` - Počet pracovních dní na vrácení
- `supportUrl` - Odkaz na zákaznickou podporu

**Klíčové prvky:**
- ✕ Červené X
- Detail objednávky
- 💰 Refund info box
- FAQ sekce
- CTA: "Kontaktovat podporu"

### 5. Resale Sold (`resale-sold.html`)
Notifikace prodejci - vstupenka byla prodána na resale marketplace.

**Povinné proměnné:**
- `sellerName` - Jméno prodejce
- `eventTitle` - Název akce
- `salePrice` - Prodejní cena
- `buyerFirstName` - Jméno kupujícího (křestní jméno)
- `payoutDate` - Datum vyplacení (formát: "středa 7. května 2026")
- `payoutAmount` - Částka k vyplacení
- `dashboardUrl` - Odkaz na přehled prodejce

**Klíčové prvky:**
- ✓ Zelený checkmark
- Info o kupujícím
- 💰 Info o vyplacení
- FAQ sekce
- CTA: "Zobrazit v přehledu"

## Použití

### Instalace
```bash
npm install handlebars
```

### Implementace
```typescript
import { renderEmail, EmailTemplate, EmailVariables } from './src/email-renderer';

// Příklad: Order Confirmation
const variables = {
  template: EmailTemplate.OrderConfirmation,
  unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=...',
  preheaderText: 'Objednávka potvrzena',
  orderNumber: 'ORD-2026-001234',
  customerName: 'Jan Novotný',
  // ... další proměnné
};

const { html, text } = renderEmail(EmailTemplate.OrderConfirmation, variables);

// Odeslání
await mailgun.messages.create('tixly.cz', {
  from: 'noreply@tixly.cz',
  to: customer.email,
  subject: 'Objednávka potvrzena',
  html: html,
  text: text,
});
```

### Typ-safe volání
```typescript
// Type-safe — TypeScript zkontroluje všechny povinné proměnné
const { html, text } = renderEmail(EmailTemplate.OrderConfirmation, {
  template: EmailTemplate.OrderConfirmation,
  // TypeScript vyžaduje všechny povinné fieldy
});
```

## Best Practices

### HTML
- ✅ Inline CSS (Gmail stripuje `<style>` bloky)
- ✅ Tabulkový layout (ne flexbox/grid)
- ✅ Alt text na všech obrázcích
- ✅ Tlačítka jako `<a>` tag stylizovaný CSS
- ✅ Podmíněný obsah přes `{{#if}}`
- ✅ Smyčky přes `{{#each}}`

### Bezpečnost
- ✅ Triple braces `{{{unescaped}}}` jen pro kontrolovaný obsah
- ✅ Single braces `{{escaped}}` pro uživatelský vstup
- ✅ Žádné `javascript:` URLs
- ✅ Validace při renderování

### Lokalizace (CZ)
- ✅ Datum: "pátek 5. dubna 2026" (Intl.DateTimeFormat)
- ✅ Cena: "1 250 Kč" (bez desetinných míst)
- ✅ Text: "pracovních dní", "vstupenka/vstupenky"

## Testování

### Unit testy
```bash
npm test src/email-renderer.test.ts
```

Testy ověřují:
- ✅ Žádné výjimky při renderování
- ✅ Přítomnost povinných prvků
- ✅ Plain-text fallback bez HTML tagů
- ✅ Podmíněné bloky (if, optional fields)
- ✅ Unsubscribe link v patičce

### Manuální testování
1. Vygenerujte HTML přes `renderEmail()`
2. Odešlete se do Litmus/Email on Acid
3. Ověřte v: Gmail web, Gmail mobile, Outlook 2019, Apple Mail

## Odesílání (Mailgun/SendGrid)

### Mailgun
```typescript
const result = await mg.messages.create('tixly.cz', {
  from: 'Tixly <noreply@tixly.cz>',
  to: [customer.email],
  subject: 'Objednávka potvrzena',
  html: html,
  text: text,
  'v:template': 'order-confirmation',
  'v:customer_id': customer.id,
});
```

### SendGrid
```typescript
const msg = {
  to: customer.email,
  from: 'noreply@tixly.cz',
  subject: 'Objednávka potvrzena',
  html: html,
  text: text,
  categories: ['order-confirmation'],
};
await sgMail.send(msg);
```

## FAQ

### Q: Proč není použit CSS ve `<style>` bloku?
**A:** Gmail, Yahoo Mail a další stripují `<style>` bloky. Všechny styly musí být inline.

### Q: Jak se renderuje QR kód?
**A:** Jako statický obrázek (`<img>`) z URL. Dynamický QR se obnovuje pouze v aplikaci.

### Q: Jak funguje unsubscribe link?
**A:** Mailgun/SendGrid automaticky generují unsubscribe header. Link `{{unsubscribeUrl}}` slouží jako fallback v patičce.

### Q: Jaké je schéma proměnných?
**A:** Viz TypeScript interfaces v `src/email-renderer.ts`. Type-safety zabraňuje chybám.

### Q: Jak se generuje plain-text verze?
**A:** Automaticky strippováním HTML tagů, zachováním struktury (line breaks) a dekódováním entit.

## Údržba

- Aktualizujte barvy v `base.html` a všech šablonách (Find & Replace)
- Přidejte novou šablonu: vytvořte `.html` soubor + interface v `email-renderer.ts`
- Zašlete v production: testujte v Litmus/Email on Acid nejdříve

## Copyright

© 2026 Tixly s.r.o. Všechna práva vyhrazena.
