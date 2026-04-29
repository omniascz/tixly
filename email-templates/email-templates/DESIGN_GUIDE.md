# Design Guide - Tixly Email Šablony

Tato příručka zajišťuje, že všechny e-maily mají konzistentní vizuální styl a komunikaci.

## Branding

### Barvy

```
Primární (Indigo):      #6366f1  ← Hlavní CTA, headery, highlights
Sekundární (Slate):     #f8fafc  ← Pozadí, secondary elements
Úspěch (Green):         #10b981  ← Potvrzení, checkmarks
Varování (Amber):       #facc15  ← Upozornění, info boxy
Chyba (Red):            #ef4444  ← Chyby, zrušení
Text (Slate):           #1e293b  ← Primární text
Text Secondary (Gray):  #64748b  ← Sekundární text
```

### Font

- **Familie**: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif
- **Hmotnost**: 400 (regular), 500 (medium), 600 (semibold), 700 (bold)
- **Velikost**: 
  - Body: 14-15px
  - Heading h2: 26-28px
  - Heading h3: 16-20px
  - Small: 12-13px

### Loga a branding
- Logo "Tixly" v headeru
- Tagline: "Vaše vstupenky na jediném místě"
- Gradient background: `linear-gradient(135deg, #6366f1 0%, #4f46e5 100%)`

## Layout

### Struktura
```
┌─────────────────────────────┐
│  Header (Gradient)          │ ← #6366f1 → #4f46e5
│  Logo + Tagline             │
├─────────────────────────────┤
│  Preheader (hidden)         │ ← {{preheaderText}}
├─────────────────────────────┤
│                             │
│  Content (40px padding)     │ ← Main message
│  - Hero text                │ ← ✓ icon + headline
│  - Details                  │ ← Tables, info boxes
│  - CTA button(s)            │ ← Primární + sekundární
│                             │
├─────────────────────────────┤
│  Footer (Slate background)  │ ← #f8fafc
│  Address + unsubscribe      │
│  © 2026 Tixly         │
└─────────────────────────────┘
```

### Rozměry
- **Max-width**: 600px (optimální pro mobile)
- **Padding**: 30px na stranách (header/footer), 40px (content)
- **Border-radius**: 6-8px (buttons, info boxes)
- **Line-height**: 1.5-1.6 (readability)

## Typografie

### Nadpisy (H2)
```html
<h2 style="margin: 0 0 8px 0; color: #1e293b; font-size: 28px; font-weight: 600;">
  Objednávka potvrzena!
</h2>
```

### Nadpisy (H3)
```html
<h3 style="margin: 0 0 16px 0; color: #1e293b; font-size: 16px; font-weight: 600;">
  Máte vše připraveno?
</h3>
```

### Body text
```html
<p style="margin: 0; color: #475569; font-size: 15px; line-height: 1.6;">
  Děkujeme za nákup!
</p>
```

### Secondary text
```html
<p style="margin: 12px 0 0 0; color: #64748b; font-size: 15px; line-height: 1.6;">
  Objednávka byla zpracována 2. dubna 2026.
</p>
```

### Malý text (labels, hints)
```html
<span style="color: #64748b; font-size: 13px;">Volné stání</span>
```

## Komponenty

### CTA Button (Primární)
```html
<a href="{{downloadUrl}}" 
   style="display: inline-block; 
          background-color: #6366f1; 
          color: #ffffff; 
          padding: 14px 40px; 
          border-radius: 6px; 
          text-decoration: none; 
          font-weight: 600; 
          font-size: 15px; 
          border: 2px solid #6366f1;">
  Stáhnout vstupenky
</a>
```

**Styling:**
- Barva: #6366f1 (primary)
- Padding: 14px 40px (height: 48px)
- Border-radius: 6px
- Font-weight: 600
- Text: všechna CAPS nejde (příliš agresivní)
- Hover: přidej `opacity: 0.95` (CSS, ale ne vždy se zobrazuje v emailech)

### Info Box (Žlutý)
```html
<div style="background-color: #fef3c7; 
            border-left: 4px solid #fcd34d; 
            padding: 16px; 
            margin-bottom: 30px; 
            border-radius: 4px;">
  <p style="margin: 0 0 8px 0; color: #b45309; font-size: 14px; font-weight: 600;">
    ⚠ Upozornění
  </p>
  <p style="margin: 0; color: #92400e; font-size: 14px; line-height: 1.5;">
    Obsah upozornění...
  </p>
</div>
```

**Varianty:**
- **Blue info**: bg: #f0f4ff, border: #6366f1, text: #4338ca
- **Green success**: bg: #f0fdf4, border: #86efac, text: #14532d
- **Red error**: bg: #fef2f2, border: #fecaca, text: #7f1d1d
- **Yellow warning**: bg: #fef3c7, border: #fcd34d, text: #92400e

### Tabulka (Shrnutí)
```html
<table cellpadding="0" cellspacing="0" border="0" style="width: 100%; border-collapse: collapse;">
  <tr style="background-color: #f1f5f9; border-bottom: 2px solid #e2e8f0;">
    <td style="padding: 12px; font-weight: 600; color: #1e293b; font-size: 14px;">Položka</td>
    <td style="padding: 12px; font-weight: 600; color: #1e293b; font-size: 14px; text-align: right;">Cena</td>
  </tr>
  <tr style="border-bottom: 1px solid #e2e8f0;">
    <td style="padding: 12px; color: #475569; font-size: 14px;">Vstupenka A</td>
    <td style="padding: 12px; color: #1e293b; font-size: 14px; font-weight: 500; text-align: right;">1 200 Kč</td>
  </tr>
</table>
```

**Styling:**
- Header row: bg #f1f5f9, bold font, border-bottom 2px #e2e8f0
- Data rows: border-bottom 1px #e2e8f0
- Padding: 12px (vertikální zarovnání)
- Text-align: right (pro čísla a ceny)

### Checklist
```html
<tr style="border-bottom: 1px solid #e2e8f0;">
  <td style="padding: 12px 0; color: #1e293b; font-size: 14px;">
    <span style="color: #10b981; font-weight: 600; margin-right: 8px;">✓</span> 
    Vstupenka v aplikaci
  </td>
</tr>
```

**Styling:**
- Checkmark: ✓ (Unicode, barva #10b981)
- Padding: 12px 0 (vertikální spacing)
- Border-bottom: 1px #e2e8f0 (dělič)

### Ikona + text (2-kolona layout)
```html
<table cellpadding="0" cellspacing="0" border="0" style="width: 100%;">
  <tr>
    <td style="width: 30px; color: #6366f1; font-size: 16px; padding-right: 12px; vertical-align: top;">
      📍
    </td>
    <td>
      <div style="color: #475569; font-size: 14px; font-weight: 500;">Venue</div>
      <div style="color: #64748b; font-size: 13px; margin-top: 2px;">Adresa</div>
    </td>
  </tr>
</table>
```

**Styling:**
- Width první kolony: 30px (enough for emoji)
- Vertical-align: top (zarovnání s textem)
- Padding-right: 12px (spacing)
- Margin-top: 2px (mezi linkami)

## Ikonografie

### Emoji (pouze v určitých kontextech)
```
🎉 - Radost, slavnost (Reminder48h heading)
✓  - Úspěch, potvrzení (checkmarks)
✕  - Chyba, zrušení (cancellation header)
💰 - Peníze, platba, refund
📅 - Datum, kalendář
📍 - Lokace, místo
🎫 - Vstupenka, ticket
🚪 - Dveře, otevření
⚠  - Upozornění, varování
ℹ  - Info, informace
💾 - Uložení, tip
📎 - Příloha, attachment
🌤 - Počasí

❌ NEPOUŽÍVEJ:
- Animované GIFy
- Více než 1-2 emoji v e-mailu
- Unicode znaky, které nejsou podporovány
```

## Tón komunikace

### Obecně
- **Přátelský**: "Ahoj Jana," (ne "Pane/paní")
- **Pozitivní**: "Objednávka potvrzena!" (ne "Objednávka přijata")
- **Jasný**: "Vaše vstupenky najdete také v aplikaci" (konkrétní info)
- **Česky**: Používej české termíny ("vstupenka", ne "ticket")

### Subject lines (na inspiraci)
```
✓ "Vaše objednávka byla potvrzena"
✓ "Vaše vstupenka je připravena!"
✓ "Zítra The Cure v O2!"
✓ "Vrátíme vám peníze — storno potvrzeno"

❌ "Order #123 Confirmed"
❌ "URGENT: ACTION REQUIRED"
❌ "Special Offer Inside!!"
```

### Preheader text (preview v inboxu)
```
Dobré: "Objednávka č. ORD-001 byla potvrzena. Stáhněte si své vstupenky."
Špatné: "Click here to download your tickets"
```

Preheader by měl být **doplňující** k subject line (ne duplikát).

## Responsive design (Mobile)

### Test na mobilu
- Gmail app (iOS/Android)
- Outlook app (iOS/Android)
- Safari (iOS)

### Best practices
- Žádné horizontální scrollování
- Text musí být čitelný (min 14px)
- Tlačítka musí být tapovatelná (min 44x44px)
- Spacing musí být dostatečný na dotykovém displeji

### CSS media queries (omezené v emailech)
```html
<style>
  @media only screen and (max-width: 480px) {
    .mobile-hidden { display: none; }
    .mobile-full { width: 100% !important; }
  }
</style>
```

**Pozor**: Mnohé email klienty nepodporují media queries. Preferuj fixed 600px layout.

## Dark mode

### Testování
- Gmail dark mode (Desktop)
- Outlook dark mode (Desktop)
- iOS Mail dark mode

### Best practices
- Nikdy nesiž na "pure black" backgrounds — vejdou se do dark mode
- Používej spíše tmavé šedi: #1e293b, #0f172a
- Testuj v Litmus (dark mode preview)

### Barvy pro dark mode
```
Primární text: #1e293b (zůstane čitelný)
Secondary text: #64748b (může být až #94a3b8)
Backgrounds: #f8fafc (inverzní na #1a1f36 v dark mode)
```

## Přílohy (Attachments)

### PDF vstupenky
- Format: PDF (A4 landscape)
- QR kód: Minimálně 200x200px
- Filename: `vstupenka_TKT-2026-001234.pdf` (jasný, bez diakritiky)
- Size: Max 10MB (Mailgun limit je vyšší, ale email klienti mají omezení)

### Image QR codes
- Format: PNG (podporován všemi klienty)
- Size: 200x200px (dostatečně velké pro skenování)
- URL: HTTPS (https://tixly.cz/qr/TKT-2026-001234.png)

## Accessibility

### Text alternativy
```html
<!-- ANO -->
<img src="qr.png" alt="QR kód vstupenky TKT-2026-001234">

<!-- NE -->
<img src="qr.png">
<img src="qr.png" alt="image">
```

### Barvy (Contrast)
- Primární text na bílém: #1e293b (WCAG AAA ✓)
- Secondary text na bílém: #64748b (WCAG AA ✓)
- Button text: #ffffff na #6366f1 (WCAG AAA ✓)

### Čitelnost
- Font size: Minimálně 14px pro body text
- Line height: Minimálně 1.5x
- Letter spacing: Neměň

## Testing checklist

- [ ] Barvy: Odpovídají brand guidelines
- [ ] Typografie: Consistent font sizes, weights
- [ ] Layout: 600px max-width, centrovaný
- [ ] Buttons: Dostatečně velké (48x48px), jasný CTA text
- [ ] Tables: Čitelné, správné alignment
- [ ] Mobile: Bez horizontálního scrollu, dostatečné spacing
- [ ] Dark mode: Čitelné na tmavém pozadí
- [ ] Links: Všechny HTTPS, tintou #6366f1
- [ ] Images: Alt text, HTTPS URLs
- [ ] Plain-text: Bez HTML tagů, zachovaná struktura
- [ ] Handlebars: {{variable}} syntax správný, {{#if}} správně uzavřeny

## Verze a changelog

### v1.0.0 (2026-04-03)
- ✓ Order Confirmation template
- ✓ Ticket Delivery template
- ✓ Reminder 48h template
- ✓ Order Cancellation template
- ✓ Resale Sold template
- ✓ Handlebars renderer s type safety
- ✓ Unit testy pro všechny šablony

## Kontakt

Otázky ohledně designu?
- **Design lead**: design@tixly.cz
- **Issue tracker**: GitHub Issues
- **Slack channel**: #email-templates
