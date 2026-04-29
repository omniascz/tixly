# Tixly — Kompletní přehled systému
*Generováno: 14.4.2026 | Zdroj: TODO.md + analýza 10 konkurentů*

> Tento dokument slouží jako mapa systému — co Tixly **umí dnes**, co **rozestavěné**, a co je **v plánu**. Organizováno tematicky, aby bylo vidět kde jsou mezery a kam se dá expandovat.

---

## Legenda

| Symbol | Význam |
|--------|--------|
| ✅ | Hotovo a v produkční kvalitě |
| 🟡 | Modul existuje, ale nekompletní / chybí testy nebo routes |
| ❌ | Plánováno, zatím neimplementováno |

---

## Rychlý přehled

| Oblast | ✅ Hotovo | 🟡 Rozestav. | ❌ Plánováno |
|--------|----------|-------------|-------------|
| Jádro ticketingu | 12 | 5 | 18 |
| Platební metody | 4 | 4 | 6 |
| Distribuce a prodej | 4 | 0 | 6 |
| Bezpečnost & anti-fraud | 10 | 1 | 2 |
| Kontrola vstupu | 0 | 1 | 5 |
| Analytics & reporting | 9 | 2 | 7 |
| Marketing & komunikace | 6 | 2 | 12 |
| CRM & zákazníci | 3 | 0 | 4 |
| Resale & sekundární trh | 2 | 1 | 6 |
| Věrnost & retence | 6 | 1 | 3 |
| Multi-tenant platforma | 10 | 0 | 0 |
| Integrace třetích stran | 4 | 2 | 7 |
| Developer platform | 4 | 0 | 0 |
| Konzumentská strana | 1 | 2 | 5 |
| HR & operace | 3 | 1 | 0 |
| Infrastruktura & deploy | 3 | 0 | 6 |
| Vertikály | 14 | 0 | 0 |

---

## 1. Jádro ticketingu

### Správa akcí a inventáře

| Funkce | Stav | Detail |
|--------|------|--------|
| Event CRUD + správa | ✅ | event-management: 14 funkcí, 12 routes, 15 testů |
| Recurring events (RRULE) | ✅ | event-cloning: opakující se akce, šablony, 11 testů |
| Tour / Series management | ❌ | Skupinové turné / festival více dní. Sdílená seat-mapa, hromadné úpravy |
| Seat map backend | ✅ | seat-map hotov, interaktivní výběr sedadla |
| Seat lock (7 min hold) | ✅ | Redis SETNX TTL, Lua atomic script — bez race conditions |
| Holds & Kills v seat-mapě | ❌ | Rezervace sedadel pro produkci/umělce (Hold) nebo trvalé vyřazení (Kill) |
| Virtual Venue — 3D seat preview | ❌ | Interaktivní 3D prohlídka výhledu ze sedadla před nákupem |
| In-venue seat upgrades | ❌ | Fanoušek si upgraduje sedadlo z mobilu po příchodu |
| Pricing engine | ✅ | Fázové zdražování + demand-based dynamika |
| AI dynamic pricing | ✅ | 4 strategie + combined, 8 testů |
| Auto Early Bird cutoff (ML) | ❌ | ML predikce optimálního konce early bird — bez modulu |
| Sell-through rate forecast | ❌ | ML predikce prodejnosti — bez modulu |
| Real-time revenue kalkulace | ❌ | Při změně kapacity/ceny okamžitý výpočet dopadu na tržby |
| Default ticket settings per event | ❌ | Globální výchozí hodnoty (věkové omezení, max qty, inactive msg) |
| Skupinové vstupenky | 🟡 | group-tickets: svc + 2 routes + 1 test |
| PDF vstupenka | 🟡 | pdf-ticket: 3 svc + 1 route + 1 test — A10 (import) pending |
| Digitálně podepsané PDF vstupenky | ❌ | PKI podpis (X.509), nelze zfalšovat, Adobe Acrobat ověření |
| Ticket swap / reissue po skenování | ❌ | Změna delivery method nebo reissue po vstupu |
| Comp tickets management | ❌ | Artist riders, press, VIP — alokace + audit kdo co kdy dostal |
| Hidden / Access Code tickets | ❌ | Skryté vstupenky přístupné přes speciální odkaz nebo kód |
| Donation tickets / Fundraising | ❌ | Vstupenka bez fixní ceny — pay-what-you-want nebo minimum |
| Packages / balíčky | ❌ | Prodej balíčků: ticket A + ticket B + merch + parking |
| Flex Plans | ❌ | Sezónkáři si sestaví vlastní balíček ze sady akcí |
| Pre-Entry Check Mode | ❌ | Dry-run validace vstupenek před otevřením brán |
| Ticket Transfer Timer | ❌ | Datum vypnutí transferů (1–31 dní před akcí) |

---

## 2. Platební metody

| Platební metoda | Stav | Detail |
|-----------------|------|--------|
| GoPay (CZ/SK) | 🟡 | Modul existuje, čeká na IČO + fix webhook A1 |
| Stripe (karty) | 🟡 | stripe-payments existuje — napojit na checkout |
| Apple Pay / Google Pay | 🟡 | Součást Stripe checkout — napojit buttony |
| QR Platba (SPD*1.0) | ✅ | billing modul, česká bankovní norma |
| Multi-currency | 🟡 | multi-currency modul hotov — napojit na checkout flow |
| Přelewy24 (PL) | ❌ | Polský trh |
| Wero / A2A platba | ❌ | Evropská A2A — nižší poplatky než karty |
| PayPal | ❌ | Zahraniční kupující, příhraniční akce |
| Benefitní platby | ❌ | Benefit Plus, Pluxee, Gallery Beta — CZ zaměstnanecký benefit budget |
| BNPL / Twisto / Klarna | ❌ | Kup teď, zaplať za 14–30 dní (≠ splátky) |
| Installments — splátky | 🟡 | installments: svc + 3 routes + dunning cron |
| Hotovost (POS) | ❌ | Součást POS box office (#30) |

---

## 3. Distribuce a prodejní kanály

| Kanál | Stav | Detail |
|-------|------|--------|
| Online prodej (vlastní web) | ✅ | Order → Payment → Ticket pipeline, 13-step, 22 testů |
| Embed widget (iframe / JS) | ✅ | embed-widget: 1 route, vložitelné na web pořadatele |
| White-label platforma | ✅ | white-label: 2 svc + 4 routes + 68 testů |
| Prodej na fakturu (B2B) | ❌ | Reserve → proforma faktura → auto-cancel dunning |
| POS / Box office | ❌ | Tablet + Stripe Terminal nebo SumUp, fyzický prodej na místě |
| Tap to Pay | ❌ | Kontaktless platba kartou k telefonu pořadatele bez čtečky |
| Multichannel distribuce | ❌ | Inventory sync s GoOut, SMSticket jako distribuční kanál |
| Retailer partner portal | ❌ | Third-party prodejní místa (kiosky, knihkupectví) — vlastní terminál |
| Cross-platform scanner | ❌ | Skenování vstupenek vydaných jinou platformou (import CSV listiny) |
| Eventim XML/API export | ❌ | Kompatibilní formát pro distribuci přes Eventim.cz síť |
| Discovery Feed / Catalog API | ❌ | JSON/CSV feed veřejných akcí, 50+ datových bodů — pro Goout, SEO |

---

## 4. Bezpečnost & anti-fraud

| Funkce | Stav | Detail |
|--------|------|--------|
| Device fingerprinting + bot detection | ✅ | device-fingerprinting: 85 testů + bot-guard + blocklist |
| Verified Fan presale | ✅ | verified-fan: 55 testů + weighted selection + redeem |
| Identity verification — BankID | ✅ | identity-verification: 91 testů + GDPR export/erasure |
| Purchase limit enforcement | ✅ | @tixly/purchase-limit: 30 testů |
| Buyer blacklist sdílený | ✅ | buyer-blacklist: svc + 8 routes |
| Fraud queue — manuální review | ✅ | fraud-queue: svc + 8 routes + 1 test |
| Geofencing presale | ✅ | presale-access: geofence.ts + 13 testů |
| AI fraud detection | ✅ | ai-fraud-detection: 56 testů + graph analytics + 9 detektorů |
| Rate limiting middleware | ✅ | Redis sliding window, 6 testů |
| Input sanitization | ✅ | 5 highest-risk routes opraveny |
| Rotating QR kódy (SafeTix-like) | ❌ | TOTP-based, kód se mění každých 30 s — eliminace screenshots |
| Passkey / passwordless login | ❌ | WebAuthn, Face ID/Touch ID |

---

## 5. Kontrola vstupu

| Funkce | Stav | Detail |
|--------|------|--------|
| Scanner PWA | 🟡 | scanner-pwa: 2 testy; mobile-scanner: 3 svc — chybí dokončení routes |
| Will-call výdej | 🟡 | will-call: svc + 6 routes + 1 test |
| Multi-zone přístupová kontrola | ❌ | VIP / Skybox / Staff / Parking zóny — jeden QR, více zón |
| Mediální akreditace systém | ❌ | Žádost → schválení → zone-specific QR (fotograf jen fotojáma) |
| Turnikety integrace | ❌ | API pro fyzické turnikety (stadiony, velká venue) |
| Biometrický vstup | ❌ | Face ID vstup místo QR kódu (pilot na jednom venue) |

---

## 6. Analytics & Reporting

| Funkce | Stav | Detail |
|--------|------|--------|
| Post-event report | ✅ | post-event-report: 72 testů |
| Real-time occupancy | ✅ | real-time-occupancy: 70 testů |
| Single customer view (360°) | ✅ | 4 svc + 4 routes + 6 testů, RFM + LTV profil |
| SEO events (schema.org, sitemap) | ✅ | seo-events: 83 testů |
| Server-side tracking (Meta CAPI, GA4) | ✅ | server-side-tracking: 23 testů |
| CS dashboard | ✅ | cs-dashboard: 7 routes + 17 testů |
| Recommendation engine | 🟡 | recommendation-engine: 2 svc + 2 routes + 1 test |
| Churn prediction | 🟡 | churn-prediction: svc + 2 routes + 1 test |
| Resale price prediction (ML) | ❌ | ML fair value — bez modulu |
| Break-even analýza + Revenue forecast | ❌ | Simulace obsazenosti a cenových scénářů před publikací akce |
| Event benchmarking | ❌ | Srovnání sell-through rate, průměrné ceny, konverzí mezi akcemi |
| Daily Stats Email | ❌ | Automatický denní přehled prodejů pro promotéra ráno |
| Sponsor analytics dashboard | ❌ | First-party data pro sponzory: demografika, engagement, expozice |
| Fan surveys | ❌ | Post-event NPS, preference průzkumy propojené s CRM segmentací |
| Axima Analytics-style dashboard | ❌ | Přehledný report zdroje návštěvníků, UTM tracking, live obsazenost |

---

## 7. Marketing & komunikace

| Funkce | Stav | Detail |
|--------|------|--------|
| Cart abandonment emaily | ✅ | cart-abandonment: 2 svc + 3 routes |
| Re-engagement kampaně | ✅ | re-engagement: 3 svc + 3 routes |
| Referral system | ✅ | referral-system: 7 svc + 6 routes + 3 testy |
| Ambassador management | ✅ | ambassador-management: svc + 4 routes |
| Affiliate tracking | ✅ | affiliate-tracking: svc + 3 routes |
| GA4 + Meta Pixel (server-side) | ✅ | analytics-tags + server-side-tracking hotové |
| SMS potvrzení (BulkGate) | 🟡 | bulkgate-sms + sms-barcode — chybí send/bulk/opt-out routes |
| Apple/Google Wallet | 🟡 | wallet-passes: svc + routes + migrace + 1 test |
| Fan Share — P2P marketing s odměnami | ❌ | Trackovaný odkaz, za prodej dostane odměnu (VIP upgrade, cashback) |
| BOGO promo pravidla | ❌ | Buy-one-get-one; kup 3 za cenu 2 — rozšíření promo-codes |
| Lineup / Artist tool | ❌ | Profily umělců, auto-post na Spotify / Bandsintown / Songkick |
| Facebook Events / TikTok integrace | ❌ | Auto-publish + „Get Tickets" tlačítko |
| Spotify integrace | ❌ | „Get Tickets" na Spotify stránce umělce |
| Flash sales | ✅ | flash-sales: svc + 5 routes |
| Promoted Ads — in-platform reklama | ❌ | CPC kampaně na Tixly marketplace, self-serve |
| Dynamic Creative pro reklamy | ❌ | Jeden template → kreativy pro všechny akce automaticky |
| AI copy pro reklamní kampaně | ❌ | AI generuje FB/IG/email copy z akce + cílové skupiny |
| AI asistent pro tvorbu akce | ❌ | AI generuje název, popis, SEO meta, doporučenou cenu |
| Šablony komunikace s fanoušky | ❌ | Pre-built emaily + SMS: countdown 7/1 den, venue info, post-event |
| SMS opt-in flow | ❌ | Sběr tel. čísel na confirmation page po platbě (jednoklikový opt-in) |
| Personalizované push notifikace | ❌ | On-sale alerts, last-minute nabídky, změna pořadu |

---

## 8. CRM & zákaznická data

| Funkce | Stav | Detail |
|--------|------|--------|
| Single customer view | ✅ | 360° profil + RFM + LTV + nákupní historie |
| Cookie consent / GDPR | 🟡 | cookie-consent modul existuje |
| Checkout custom otázky | ❌ | Vlastní pole v checkoutu: menu preference, velikost trička, odkud přišli |
| Oblíbení umělci / venue + notifikace | ❌ | Follow umělce → push/email při nové akci |
| Profilová stránka pořadatele | ❌ | Veřejná branded stránka promotéra — fanoušek může sledovat pořadatele |
| Fan social graph | ❌ | Sledování přátel, activity feed „Petr jde na X" (GoOut core USP) |
| CRM Business pro sponzory | ❌ | Pipeline sponzorských dealů, smlouvy, vizualizace reklamních ploch |

---

## 9. Resale & sekundární trh

| Funkce | Stav | Detail |
|--------|------|--------|
| Resale listing + escrow | ✅ | resale-api: 4 svc + 10 routes + 4 testy + migrace |
| Watchlist / čekací listina | 🟡 | Základ v resale-api — ověřit routes |
| Fan-to-fan etický resale (capped) | 🟡 | Resale API existuje — přidat price cap (max 110 % face value) |
| Artist-controlled resale rules | ❌ | Per akce: povol/zakaz resale, cenový strop, max počet transferů |
| Resale co-mingling na seat-mapě | ❌ | Resale vstupenky viditelné přímo vedle primárních na seat-mapě |
| Premium inventory tier | ❌ | Prémiová sedadla za tržní cenu — legální alternativa ke scalperům |
| Draw / Ballot systém | ❌ | Losování slotů pro ultra high-demand akce (olympiáda, megakoncerty) |
| Virtual Waiting Room | ❌ | Redis queue + websocket notifikace pro high-demand onsale |

---

## 10. Věrnost & retence zákazníků

| Funkce | Stav | Detail |
|--------|------|--------|
| Loyalty points | ✅ | loyalty-points: 3 svc + 4 routes |
| Gift vouchers | ✅ | gift-vouchers: svc + 4 routes |
| Dynamic cashback | ✅ | dynamic-cashback: svc + 7 routes + 3 testy |
| Upsell engine | ✅ | upsell-engine: 3 svc + 7 routes + 3 testy + migrace |
| Season passes / permanentky | ✅ | season-passes: 33 testů + permanentky modul |
| Promo kódy | ✅ | promo-codes hotov |
| Ticket insurance | 🟡 | ticket-insurance: svc + 8 routes + 1 test — přidat pokrytí |
| Tickets for Good — sociální ticketing | ❌ | Vstupenky pro učitele, zdravotníky, dobrovolníky — CZ PR potenciál |
| Corporate suite / VIP management | ❌ | Suite owners přidělují vstupenky zaměstnancům, approval flow |

---

## 11. Multi-tenant platforma

| Funkce | Stav | Detail |
|--------|------|--------|
| RLS (Row-Level Security) | ✅ | rls-multitenancy: 4 testy včetně tenant-context.e2e |
| Promoter registrace + KYC flow | ✅ | promoter-onboarding: 3 svc + 16 routes + 5 testů |
| Payout-management | ✅ | payout-management: 2 svc + 14 routes + 5 testů |
| Instant Payouts | ❌ | Výběr prostředků během minut (Stripe Instant Payouts) |
| Platform-fees správa | ✅ | platform-fees: svc + 8 routes + 4 testy + 2 migrace |
| Platform admin API | ✅ | platform-admin: svc + 10 routes + 75 testů |
| Billing / invoicing | ✅ | VAT engine + credit notes + invoice PDF + QR Platba + migrace 108 |
| Mikro-pořadatel onboarding | ✅ | micro-organizer: svc + 4 routes |
| B2B API | ✅ | b2b-api: 2 svc + 11 routes + 86 testů |
| Webhooks system | ✅ | webhooks: 4 svc + 7 routes + 35 testů |

---

## 12. Integrace třetích stran

| Integrace | Stav | Detail |
|-----------|------|--------|
| GoPay | 🟡 | Čeká na IČO + fix webhook (BUG-001) |
| Stripe | 🟡 | Modul existuje — napojit na checkout |
| Bank reconciliation (Fio) | 🟡 | 4-level matching engine — chybí FIO_TOKEN produkční |
| BulkGate SMS | 🟡 | sms-barcode — chybí routes |
| Zapier / automation | ❌ | Connector pro 6 000+ aplikací (Mailchimp, HubSpot, Google Sheets) |
| Přelewy24 | ❌ | Polský trh |
| Wero / A2A platba | ❌ | Evropská A2A |
| PayPal / Braintree | ❌ | Zahraniční kupující |
| Benefitní platby | ❌ | Benefit Plus, Pluxee, Gallery Beta |
| BNPL (Twisto / Klarna) | ❌ | 14–30denní odklad platby |
| Zoom / YouTube Live | ❌ | Virtuální akce — orphan modul `virtual-stream` čeká |

---

## 13. Developer platform & API

| Funkce | Stav | Detail |
|--------|------|--------|
| Developer portal (API docs) | ✅ | developer-portal: 38 testů |
| SDKs (JS, Python) | ✅ | sdk-generator: 25 testů |
| OAuth2 provider (PKCE) | ✅ | oauth2-provider: 40 testů + migrace 102 |
| Sandbox environment | ✅ | sandbox: 38 testů + multi-tenant + migrace 103 |

---

## 14. Konzumentská strana (buyer-facing)

| Funkce | Stav | Detail |
|--------|------|--------|
| Zákaznický portál API | 🟡 | customer-portal: 5 svc + 8 routes + 1 test |
| Cookie consent | ✅ | cookie-consent modul hotov |
| Apple/Google Wallet | 🟡 | wallet-passes — chybí pokrytí |
| Enhanced Apple Wallet | ❌ | Dynamický obsah: počasí, setlist, mapa venue, push update |
| Buyer-facing mobilní aplikace (iOS/Android) | ❌ | Consumer app — discovery, nákup, správa vstupenek, push notifikace |
| Find My Friends | ❌ | Sdílení polohy ve venue (opt-in, pod QR kódem) |
| AXS Invite — rezervace pro přátele | ❌ | Kupující pošle link na sousední volná místa |
| All-In Pricing | ❌ | Celková cena viditelná od prvního zobrazení (EU regulace) |
| Passkey / passwordless | ❌ | WebAuthn, Face ID/Touch ID |
| Status page | ❌ | Veřejná stránka dostupnosti systému (statuspage.tixly.cz) |

---

## 15. HR & operace

| Funkce | Stav | Detail |
|--------|------|--------|
| Profily zaměstnanců a role | ✅ | event-staff: 81 testů + migrace 101 |
| Plánování směn | ✅ | availability + swap + open shifts + labor cost |
| Activity log a audit trail | ✅ | action-log hotov |
| Collaborative event workflow | ❌ | Tým (agent, box-office) v jedné akci — role-based access, schvalování |
| Organizer Resource Hub | ❌ | Knowledge base pro promotéry, šablony, best practices |
| Pronájem prostor | ❌ | Rezervace sálů / místností vedle ticketingu (muzea, kulturní domy) |

---

## 16. Infrastruktura & deploy

| Funkce | Stav | Detail |
|--------|------|--------|
| Amazon SES / email | ❌ | SMTP setup — blocker pro transakční emaily |
| Migrace na staging DB | ❌ | Migrace 001–108 na Neon / Supabase |
| Railway / Vercel deploy | ❌ | DEPLOYMENT.md hotový, čeká na výkon |
| Env vars na produkci | ❌ | GOPAY_*, JWT_SECRET, DATABASE_URL, REDIS_URL, KAFKA_* |
| GoPay production credentials | ❌ | Přepnutí ze sandbox na live (čeká na IČO) |
| CI/CD pipeline | ❌ | GitHub Actions: lint → test → build → deploy na staging |
| Error monitoring (Sentry) | ❌ | Setup + alerting |
| Backup a monitoring | ❌ | pg_dump cron, uptime monitoring |
| Load testing suite | ❌ | k6 / Artillery: vyprodej 10K vstupenek za 60 s |

---

## 17. Vertikály (hotové)

Všechny níže jsou plně implementované jako samostatné moduly:

| Vertikála | Stav |
|-----------|------|
| Fitness studia | ✅ |
| Kadeřníci / salony | ✅ |
| Coworking | ✅ |
| Sportoviště | ✅ |
| Autobusová doprava | ✅ |
| Online kurzy | ✅ |
| Firemní benefity | ✅ |
| Parky a volnočasové areály | ✅ |
| Restaurace | ✅ |
| Parkoviště | ✅ |
| Ski areály | ✅ |
| Escape rooms | ✅ |
| Kina a multiplexy | ✅ |
| Hotely | ✅ |

---

## 18. Kde lze expandovat — přehled příležitostí

Seřazeno podle dopadu / ease-of-implementation:

### 🔴 Vysoký dopad, nutné pro GO LIVE
- **Admin UI promotér dashboard** — bez UI nelze prodávat; největší mezera
- **Self-service onboarding wizard** — promotér vytvoří akci do 5 minut
- **All-In Pricing** — EU regulatorní povinnost
- **Rotating QR kódy** — bez nich jsou vstupenky snadno padělatelné

### 🟠 Vysoký dopad, klíčové pro konkurenceschopnost
- **Stripe + Apple/Google Pay** — mobilní standard, chybí v checkoutu
- **Virtual Waiting Room** — nutný pro vyprodané akce
- **Break-even analýza + Revenue forecast** — promotéři to potřebují každý den
- **Instant Payouts** — cash flow kritický pro malé promotéry
- **Daily Stats Email** — triviální implementace, velká hodnota bez UI
- **Multi-zone přístupová kontrola** — festivaly a stadiony to vyžadují
- **Benefitní platby (Benefit Plus, Pluxee)** — velký CZ B2B segment

### 🟡 Střední dopad, CZ-specifické výhody
- **Digitálně podepsané PDF vstupenky** — V CZ unikát (SMSticket standard 2025)
- **Mediální akreditace systém** — nutný pro velká venue a festivaly
- **Prodej na fakturu** — firemní segment
- **Fan-to-fan resale (price cap)** — resale API existuje, stačí přidat EU cenový strop
- **PayPal** — příhraniční akce, zahraniční kupující
- **Profilová stránka pořadatele** — brand promotéra, organický traffic
- **Discovery Feed / Catalog API** — distribuce přes GoOut, SEO

### 🟢 Diferenciátory — nikdo v CZ to nemá
- **Tickets for Good** — sociální ticketing, obrovský PR potenciál
- **CRM Business pro sponzory** — pipeline dealů, smlouvy, vizualizace ploch
- **Fan social graph** — „kulturní kompas" typ feature (GoOut USP)
- **Sponsor analytics dashboard** — monetizace first-party dat
- **Buyer-facing mobilní aplikace** — discovery + nákup + správa v kapse
- **Sustainability reporting** — ESG diferenciátor pro B2B klienty

### 🔵 Velké venue a festivaly (enterprise tier)
- **RFID náramky + cashless in-venue** — festivaly to vyžadují
- **Turnikety integrace** — stadiony
- **Biometrický vstup** — pilot na jednom venue
- **Retailer partner portal** — síť fyzických prodejních míst
- **Draw / Ballot systém** — olympiáda, megakoncerty
- **Vendor marketplace API** — stánkáři, cateři jako add-on k vstupence

---

## 19. Orphan moduly na disku (čekají na zapojení)

Moduly existují v kódu, ale nejsou zapojené do žádného aktivního flow:

| Modul | Co dělá | Kde se použije |
|-------|---------|----------------|
| `action-log` | Audit trail | Opravit SQL injection (A4), pak ✅ |
| `analytics-tags` | Tag management | Součást GA4/Meta setup |
| `branch-management` | Správa poboček | Fix A11, pak produkce |
| `bulk-email` | Hromadné emaily | Fix A11, přidat pause/resume |
| `conference` + `conference-badges` + `conference-exhibitors` | Konference | Konferenční modul |
| `email-copy` + `email-templates` | Šablony emailů | Šablony komunikace (#60) |
| `ems-booking` | Rezervace (EMS) | Fix A2 (integrace permanentky) |
| `fitness-reminders` | Připomínky | Fix A7 (swallowed SMS) |
| `jwt-auth` | JWT autentizace | Součást auth vrstvy |
| `landing-pages` | Landing stránky | Fix A5 (XSS), pak produkce |
| `lead-capture` | Sběr leadů | Přidat rate-limit + spam ochranu |
| `newsletter` | Newsletter | Přidat double opt-in flow |
| `optimal-send-time` | ML optimální čas odeslání | Napojit na bulk-email |
| `platform-promoters` | Platform-level promoters | Součást admin panelu (#14) |
| `push-notification-copy` | Push notifikace | Napojit na event systém (#69) |
| `rules-engine` | Business rules | Základ pro automation triggery |
| `service-catalog` | Katalog služeb | Vendor marketplace (#68) |
| `slot-engine` | Časové sloty | Timed entry pro museum/ZOO |
| `sql-reports` | SQL reporty | Pokročilé reporty na vyžádání |
| `strategic-vision` | — | Interní dokument |
| `tenant-runtime-config` | Runtime konfigurace tenanta | Přidat cache invalidation test |
| `totp-qr` | TOTP QR základ | Rozšířit na Rotating QR (#23) |
| `venue-ownership` | Vlastnictví venue | Součást venue management |
| `virtual-stream` | Virtuální stream | Napojit Zoom / YouTube Live (#168) |
| `web-content-cms` | CMS blokový editor | Přidat permissions test |
| `wellness-entry` | Vstup do wellness | Součást fitness vertikály |

---

*Tento dokument je živý přehled. Zdroj pravdy: `TODO.md`*
