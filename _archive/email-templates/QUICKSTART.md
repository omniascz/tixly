# Quick Start - Email Šablony Tixly

Zde je nejrychlejší způsob, jak začít odesílat e-maily.

## 30 sekund setup

### 1. Instalace
```bash
cd email-templates
npm install
```

### 2. Konfigurace Mailgun
```bash
# Vytvořit .env soubor
cat > .env << EOF
MAILGUN_API_KEY=key-xxxxxxxxxxxxxxxxxxxx
MAILGUN_DOMAIN=tixly.cz
MAILGUN_FROM_EMAIL=noreply@tixly.cz
EOF
```

[Mailgun API key najdeš zde](https://app.mailgun.com/app/account/security/api_keys)

### 3. Odeslat první email
```typescript
import { sendOrderConfirmation } from './examples/mailgun-config';

await sendOrderConfirmation('customer@example.com', {
  unsubscribeUrl: 'https://tixly.cz/unsubscribe?token=xxx',
  preheaderText: 'Objednávka potvrzena',
  orderNumber: 'ORD-2026-001',
  customerName: 'Jan Nový',
  orderDate: 'čtvrtek 2. dubna 2026',
  items: [{
    eventTitle: 'The Cure',
    date: 'pátek 5. května 2026',
    venue: 'O2 Universum',
    quantity: 1,
    unitPrice: '850 Kč',
    totalPrice: '850 Kč',
    ticketType: 'Stání',
  }],
  subtotal: '850 Kč',
  fees: '50 Kč',
  total: '900 Kč',
  paymentMethod: 'Bankovní transfer',
  downloadUrl: 'https://tixly.cz/download/xxx',
});
```

**Hotovo! Email je odeslán.**

---

## Které šablony existují?

| Šablona | Kdy se odesílá | Funkce |
|---------|---|---|
| `OrderConfirmation` | Po zaplacení | Potvrzení objednávky + link na stažení |
| `TicketDelivery` | Po vytvoření vstupenky | Vstupenka + QR kód + PDF |
| `Reminder48h` | 48h před akcí | Připomínka + checklist |
| `OrderCancellation` | Při stornu | Info o vrácení peněz |
| `ResaleSold` | Prodejce prodá vstupenku | Info o vyplacení |

## Příklady pro každou šablonu

### OrderConfirmation
```typescript
await sendEmail('customer@example.com', EmailTemplate.OrderConfirmation, {
  unsubscribeUrl: 'https://...',
  preheaderText: 'Objednávka č. ORD-001 byla potvrzena.',
  orderNumber: 'ORD-001',
  customerName: 'Jana Nová',
  orderDate: 'čtvrtek 2. dubna 2026',
  items: [{ eventTitle: '...', date: '...', venue: '...', ... }],
  subtotal: '2 300 Kč',
  fees: '100 Kč',
  total: '2 400 Kč',
  paymentMethod: 'Bankovní transfer',
  downloadUrl: 'https://...',
});
```

### TicketDelivery
```typescript
await sendEmail('customer@example.com', EmailTemplate.TicketDelivery, {
  unsubscribeUrl: 'https://...',
  preheaderText: 'Vaše vstupenka je připravena!',
  customerName: 'Jana Nová',
  eventTitle: 'The Beatles Revival',
  eventDate: 'pátek 5. května 2026',
  eventTime: '20:00',
  venue: 'O2 Universum',
  venueAddress: 'Nový Butovický Svět 1, 150 00 Praha 5',
  ticketType: 'Stání VIP',
  seatInfo: 'Zóna A', // nebo null pro volné stání
  ticketId: 'TKT-001',
  qrCodeUrl: 'https://qr-image-url.png',
  appDownloadUrl: 'https://tixly.cz/app',
});
```

### Reminder48h
```typescript
await sendEmail('customer@example.com', EmailTemplate.Reminder48h, {
  unsubscribeUrl: 'https://...',
  preheaderText: 'Zítra The Beatles Revival!',
  customerName: 'Jana Nová',
  eventTitle: 'The Beatles Revival',
  eventDate: 'pátek 5. května 2026',
  eventTime: '20:00',
  venue: 'O2 Universum',
  venueAddress: 'Nový Butovický Svět 1, 150 00 Praha 5',
  doorsOpen: '19:00',
  seatInfo: 'Zóna A',
  ticketCount: 1,
  appDownloadUrl: 'https://...',
  mapUrl: 'https://maps.google.com/?q=O2+Universum',
  resaleUrl: 'https://tixly.cz/resale/xxx',
  weatherNote: 'Teplota kolem 18°C, doporučujeme si vzít mikinu.', // optional
  requiresId: true, // optional
});
```

### OrderCancellation
```typescript
await sendEmail('customer@example.com', EmailTemplate.OrderCancellation, {
  unsubscribeUrl: 'https://...',
  preheaderText: 'Objednávka byla zrušena.',
  customerName: 'Jana Nová',
  orderNumber: 'ORD-001',
  eventTitle: 'The Beatles Revival',
  cancellationReason: 'Zrušení na žádost zákazníka',
  refundAmount: '2 400 Kč',
  refundDays: 3,
  supportUrl: 'https://tixly.cz/support?order=ORD-001',
});
```

### ResaleSold
```typescript
await sendEmail('seller@example.com', EmailTemplate.ResaleSold, {
  unsubscribeUrl: 'https://...',
  preheaderText: 'Vaše vstupenka byla prodána!',
  sellerName: 'David Svoboda',
  eventTitle: 'The Beatles Revival',
  salePrice: '1 000 Kč',
  buyerFirstName: 'Alena',
  payoutDate: 'středa 7. května 2026',
  payoutAmount: '850 Kč', // Po komisi
  dashboardUrl: 'https://tixly.cz/dashboard/resale',
});
```

## Jak odeslat PDF přílohu s e-mailem?

```typescript
import * as fs from 'fs';
import { sendEmail } from './examples/mailgun-config';

const pdfBuffer = fs.readFileSync('/path/to/ticket.pdf');

await mg.messages.create(MAILGUN_DOMAIN, {
  from: 'Tixly <noreply@tixly.cz>',
  to: ['customer@example.com'],
  subject: 'Vaše vstupenka je připravena!',
  html: html,
  text: text,
  attachment: {
    filename: 'vstupenka_TKT-001.pdf',
    data: pdfBuffer,
  },
});
```

## Jak automatizovat odeslání?

### Cron job (48h reminder)
```typescript
import cron from 'node-cron';
import { renderEmail, EmailTemplate } from '@tixly/email-templates';

// Každý den v 10:00
cron.schedule('0 10 * * *', async () => {
  const tomorrow = new Date();
  tomorrow.setDate(tomorrow.getDate() + 2);

  // Najít vstupenky na akce za 48 hodin
  const tickets = await db.tickets.findByEventDate(tomorrow);

  for (const ticket of tickets) {
    if (ticket.reminder_sent_at) continue; // Skip already sent

    const { html, text } = renderEmail(EmailTemplate.Reminder48h, {
      // ... data
    });

    await sendEmail(ticket.customer_email, html, text);
    await db.tickets.update(ticket.id, { reminder_sent_at: new Date() });
  }

  console.log(`Sent ${tickets.length} reminders`);
});
```

## Jak testovat?

### Jednotlivé šablony
```bash
npm test
```

### Testovací e-mail
```typescript
import { sendTestEmail } from './examples/mailgun-config';

await sendTestEmail(); // Pošle test email na test@example.com
```

### Litmus (doporučeno)
1. Vygenerate HTML: `renderEmail(EmailTemplate.OrderConfirmation, data)`
2. Zkopírovat do [Litmus](https://litmus.com)
3. Ověřit v Gmail, Outlook, Apple Mail

## Debugging

### Email se neodeslal?
```typescript
try {
  await sendEmail(...);
} catch (error) {
  console.error('Mailgun error:', error.message);
  // "Invalid API key" → Check MAILGUN_API_KEY
  // "Invalid domain" → Check MAILGUN_DOMAIN
  // "Invalid recipient" → Check email format
}
```

### Máš špatný HTML?
```typescript
const { html, text } = renderEmail(EmailTemplate.OrderConfirmation, variables);
console.log(html); // Zkontroluj output
```

### Plain-text fallback má HTML?
```typescript
const { text } = renderEmail(...);
console.log(text); // Měl by obsahovat jen text, bez tagů
```

## Best practices

✅ **DÍ:**
- Vytvářej unsubscribe tokeny
- Trackuj email events (delivered, opened, clicked)
- Validuj data před renderováním
- Cachuj compiled templates

❌ **NEDĚLEJ:**
- Neposílej spamem (rate limit: 600/min)
- Nepoužívej HTML třídy (Gmail je stripuje)
- Nepřidávej `<style>` bloky
- Neignoruj user preferences (opted_out)

## Kde jsou data brána?

Pro `OrderConfirmation`:
- `orderNumber` - z `orders.id`
- `customerName` - z `users.name`
- `items` - z `order_items` + `events` join
- `total` - z `orders.total_price`

Ověř, že všechna data přicházejí ze správných tabulek!

## Další kroky

1. **Implementuj webhook handler** - Mailgun send events
2. **Nastav bounce handling** - Automaticky opt-out bounced emails
3. **Monitoruj delivery rate** - Měřit úspěšnost odesílání
4. **A/B testuj subject lines** - Zvýšit open rate

---

**Potřebuješ help?**
- 📖 Čti [README.md](./README.md) pro detaily
- 🛠️  Čti [IMPLEMENTATION.md](./IMPLEMENTATION.md) pro workflow
- 💾 Čti source: [email-renderer.ts](./src/email-renderer.ts)
