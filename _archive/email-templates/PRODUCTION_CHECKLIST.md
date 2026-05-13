# Production Deployment Checklist

Před spuštěním e-mailů v produkci, projdi tuto kontrolní seznam.

## Pre-deployment (1-2 týdny před spuštěním)

### Mailgun Setup
- [ ] Mailgun účet vytvořen (https://mailgun.com)
- [ ] Doména TicketAriumu přidána a ověřena
- [ ] API key vygenerován a uložen v `.env` (development i production)
- [ ] SPF record přidán do DNS
  - TXT: `v=spf1 include:mailgun.org ~all`
- [ ] DKIM record přidán do DNS (Mailgun vygeneruje)
- [ ] DMARC record přidán do DNS
  - TXT: `v=DMARC1; p=quarantine; rua=mailto:admin@tixly.cz`
- [ ] Test: Odeslat email z Mailgun dashboard → měl by přijít

### Webhook Infrastructure
- [ ] Express webhook endpoint implementován: `/webhooks/mailgun`
- [ ] Webhook handler ověřuje Mailgun signature (HMAC-SHA256)
- [ ] Database schema pro `email_events` a `email_bounces` vytvořen
- [ ] Webhook handler testován s mock daty
- [ ] Webhook URL zaregistrován v Mailgun dashboard
  - Events: delivered, opened, clicked, failed, unsubscribed, bounced
- [ ] Webhook monitoring a alerting nastaven

### Email Templates
- [ ] Všechny 5 šablon renderují bez chyb
- [ ] Unit testy procházejí: `npm test`
- [ ] Plain-text fallback neobsahuje HTML tagy
- [ ] Handlebars syntax je správný ({{variable}}, {{#if}})
- [ ] Unsubscribe link {{unsubscribeUrl}} je v patičce VŠECH šablon
- [ ] Preheader text {{preheaderText}} je nastavený

### Email Content
- [ ] Všechny subject lines jsou česky a profesionální
- [ ] Preheader text je výstižný (ne duplikát subject)
- [ ] CTA tlačítka mají jasný text ("Stáhnout vstupenky", ne "Click here")
- [ ] Všechny linky jsou HTTPS
- [ ] Všechny obrázky mají alt text
- [ ] Branding je konzistentní (barvy, font, logo)
- [ ] Typo kontrola v textu
- [ ] Česká lokalizace: datum, ceny, čísla

### Testing (Email validation)
- [ ] Testovací e-mail odeslán skrz Mailgun do Gmail
  - [ ] Dorazil do inbox (ne SPAM)
  - [ ] Správné renderování
  - [ ] Tlačítka jsou klikatelná
- [ ] Testovací e-mail v Outlook
  - [ ] Správné renderování
  - [ ] Žádné CSS chyby
- [ ] Testovací e-mail na mobilu (Gmail app, iOS Mail)
  - [ ] Responsive design funguje
  - [ ] Čitelný text bez scrollování
- [ ] Dark mode test (Litmus nebo Mailmodo)
  - [ ] Text viditelný na tmavém pozadí
  - [ ] Barvy nejsou příliš tmavé
- [ ] Plain-text verze kontrola
  - [ ] Žádné HTML tagy
  - [ ] Čitelná struktura
  - [ ] Všechny linky přítomny

### Environment Variables
- [ ] `.env.production` vytvořen s Production Mailgun credentials
- [ ] `MAILGUN_API_KEY` nastaven správně
- [ ] `MAILGUN_DOMAIN` nastaven správně
- [ ] `MAILGUN_FROM_EMAIL` nastaven správně (noreply@tixly.cz)
- [ ] Secret key pro unsubscribe tokeny nastaven (`UNSUBSCRIBE_SECRET`)
- [ ] Variables nejsou commitetty do git (`.gitignore`)

### Unsubscribe Management
- [ ] Unsubscribe endpoint implementován: `GET /unsubscribe?token=...`
- [ ] Token verification funguje (HMAC kontrola)
- [ ] Database flag `email_notifications_enabled` implementován
- [ ] Mailer check: `if (user.email_notifications_enabled) { sendEmail(...) }`
- [ ] Unsubscribe link v patičce je na všech šablonách
- [ ] Test: Odklikni unsubscribe link → user by měl být opt-out

### Bounce Handling
- [ ] Webhook handler zpracovává `bounced` event
- [ ] Permanent bounces: automaticky opt-out uživatele
- [ ] Temporary bounces: logování pro retry
- [ ] Bounce DB records: `email_bounces` tabulka
- [ ] Bounce report v adminu

### Sendgrid (Pokud se používá místo Mailgun)
- [ ] SendGrid API key nastaven
- [ ] Authentication email ověřen
- [ ] Webhook endpoint nastaven
- [ ] SPF/DKIM/DMARC pro SendGrid doménu
- [ ] Unsubscribe management dle SendGrid dokumentace

## Staging (Týden před produkcí)

### Load Testing
- [ ] Mailgun rate limit otestován: 600 emails/min
- [ ] Aplikace zvládá 100+ emailů/sec bez timeout
- [ ] Database INSERT (`email_events`) je performantní

### Integration Testing
- [ ] Objednat vstupenku → email se odešle
- [ ] Stornovat vstupenku → cancellation email se odešle
- [ ] Webhook: email marked as delivered v DB
- [ ] Webhook: email marked as opened v DB

### Monitoring Setup
- [ ] Sentry/Rollbar pro error tracking
- [ ] CloudWatch logs pro Mailgun events
- [ ] Email delivery metrics sledovány
- [ ] Alerting: Delivery rate < 95% → notify DevOps
- [ ] Alerting: Bounce rate > 5% → notify DevOps
- [ ] Dashboard: Visualize sent/delivered/bounced metrics

### Documentation
- [ ] Runbook vytvořen: "Co dělat pokud selžou e-maily"
- [ ] Mailgun dashboard tutorial pro ops team
- [ ] Bounce list monitoring pro ops team
- [ ] Escalation procedure dokumentován

## Launch Day (Go-live)

### Final Checks (30 minut před)
- [ ] Všechny testy procházejí: `npm test`
- [ ] Žádné deploy errors v production
- [ ] Staging environment je aktuální
- [ ] Ops team je upozorněn a ready
- [ ] Monitoring je zapnuto a viditelné

### Initial Rollout (Gradual)
- [ ] **Hodina 1**: Odeslat 10 test emailů do interno@tixly.cz
  - [ ] Zkontrolovat inbox, spam, chegmail
  - [ ] Webhook events se zapisují do DB
- [ ] **Hodina 2**: Odeslat 100 emailů k existujícím uživatelům
  - [ ] Delivery rate >= 95%
  - [ ] Žádné vracení bounce errors
- [ ] **Hodina 4**: Odeslat 1000 emailů
  - [ ] Žádné performance issues
  - [ ] Bounce rate < 2%
- [ ] **Konec dne**: Rollout na 100% (všichni uživatelé)

### Production Monitoring (First week)
- [ ] Daily: Check delivery rate (target > 98%)
- [ ] Daily: Check bounce report
- [ ] Daily: Check unsubscribe rate (should be < 0.5%)
- [ ] Daily: Check complaint rate (should be 0%)
- [ ] Real-time: Sentry/Rollbar bez nových errorů

## First Week (Post-launch)

### Metrics Review
- [ ] Delivery rate: Target 98%+ (actual: ?)
- [ ] Open rate: Target 30%+ (actual: ?)
- [ ] Click rate: Target 5%+ (actual: ?)
- [ ] Bounce rate: Target < 2% (actual: ?)
- [ ] Unsubscribe rate: Target < 0.5% (actual: ?)
- [ ] Complaint rate: Target 0% (actual: ?)

### Adjustments
- [ ] Subject lines optimizovány na základě open rate
- [ ] CTA text/placement optimalizován na základě click rate
- [ ] Bounce list očistěn (permanent bounces)
- [ ] Unsubscribe requests zpracovány manuálně (pokud jich málo)

### User Feedback
- [ ] Support team hlášení o email issuesích (log, forward, resolve)
- [ ] Obsah emailů kontrolován na feedback
- [ ] Design/typografie adjustmenty, pokud jsou issues

## Ongoing (Maintenance)

### Weekly Tasks
- [ ] Bounce report review
- [ ] Unsubscribe requests processing
- [ ] Metrics dashboard check
- [ ] Any critical alerts investigation

### Monthly Tasks
- [ ] Email performance report
- [ ] Segment analysis (který typ uživatele otevírá emaily)
- [ ] A/B test results analysis
- [ ] Future improvements brainstorming

### Quarterly Tasks
- [ ] Mailgun contract review (pricing, limits)
- [ ] Infrastructure scaling assessment
- [ ] Security audit (SPF/DKIM/DMARC)
- [ ] Compliance check (CAN-SPAM, GDPR)

## Compliance & Legal

### CAN-SPAM Act (USA)
- [ ] Fyzické mailing address v footeru ✓
- [ ] "From" address je skutečný (ne noreply@...jen) ✗ (OK pro transakcí)
- [ ] Subject line není misleading
- [ ] Unsubscribe link v každém emailu ✓
- [ ] Unsubscribe request zpracován do 10 dnů

### GDPR (EU)
- [ ] Consent zaznamenán (user opt-in) - Řeší GoPay signup
- [ ] Unsubscribe mechanic implementován ✓
- [ ] Data retention policy: Keep logs 90 dní, pak delete
- [ ] Data access request handling (user wants their email events)
- [ ] Privacy policy updated (zmínit Mailgun)

### Czech e-commerce law
- [ ] Obchodní podmínky zmínují emailing
- [ ] Email footer: Obchodní firma jméno, IČ, sídlo
- [ ] Kontakt: support@tixly.cz viditelný

## Disaster Recovery

### Mailgun outage
- [ ] Fallback: SendGrid configured a ready-to-use?
- [ ] RTO: Max 1 hodina (emailů se bude delay)
- [ ] Procedure: Dokumentován step-by-step process

### Database outage (email_events)
- [ ] Backups: Daily automated, testovány
- [ ] RTO: < 1 hodina
- [ ] RPO: < 15 minut (max loss of data)

### Email delivery stuck
- [ ] Rollback plan: Downgrade na předchozí verzi
- [ ] Queue monitoring: Alerting, pokud queue roste
- [ ] Manual resend: Script na manuální odeslání emailů z queue

## Security

- [ ] API keys nejsou v source code (pouze .env)
- [ ] API keys jsou rotovány každých 6 měsíců
- [ ] Webhook signature verification je ON (HMAC-SHA256)
- [ ] HTTPS everywhere (email linky i webhook endpoint)
- [ ] Rate limiting: Mailgun 600/min, API rate limits nastaveny
- [ ] SQL injection protection: Parametrizované queries
- [ ] XSS protection: HTML entities escaped (Handlebars default)
- [ ] CSRF protection: Unsubscribe token ověřován

## Sign-off

**Čekám na approval od:**
- [ ] **Tech Lead**: Kód je production-ready
- [ ] **DevOps**: Infrastructure je ready
- [ ] **Product**: Feature je complete a testováno
- [ ] **Compliance**: GDPR/CAN-SPAM checklist passed

**Go/No-go decision:**
- [ ] ✅ GO LIVE - Všechny checklisty passed
- [ ] ❌ NO GO - Vyřešit issues a re-check

---

**Launch date**: ________________
**Launched by**: ________________
**Sign-off date**: ________________
