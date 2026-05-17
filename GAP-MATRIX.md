# Master gap matice — Tixly vs SMSticket / GoOut / Ticketmaster

> Sloučení 13 analýz v `analysis/` do jedné akční tabulky. Filtr: jen feature, kde se Tixly liší od **alespoň jednoho** ze 3 cílových konkurentů.
>
> **Konkurenti:** SMSticket (český benchmark UX + pricing), GoOut/PLG (český dominant po Ticketportal akvizici), Ticketmaster (světový standard).
>
> **Legenda:**
> - ✅ Plně implementováno (UI + API + DB)
> - 🟡 Částečně / stub / jen mock / chybí UI
> - ❌ Vůbec
> - ➖ Záměrně mimo scope MVP
> - 🆕 Tixly má, konkurence nemá (potenciální diferenciátor)

---

## 1. Discovery & marketplace

| Feature | Tixly | SMSticket | GoOut | Ticketmaster | Kde v repu |
|---|---|---|---|---|---|
| Veřejná homepage s akcemi | ✅ | ✅ | ✅ | ✅ | `src/app/[locale]/page.tsx` |
| Kategoriové procházení | ✅ | ✅ | ✅ | ✅ | `src/app/[locale]/events` |
| Filtry město / datum / žánr | ✅ | ✅ | ✅ | ✅ | `src/app/[locale]/events` |
| Plnotextové vyhledávání | ✅ | ✅ | ✅ | ✅ | `src/app/[locale]/search` |
| Mapa akcí s geolocation | ✅ | ❌ | 🟡 | ✅ | catch-up #11 commit `98a5db3` |
| Personalizovaná doporučení (ML) | 🟡 | ❌ | ✅ | ✅ | `src/lib/recommendations/engine.ts` (W.2) |
| Discovery API pro 3rd party | 🟡 | ❌ | ❌ | ✅ | `src/app/api/graphql` (Tier-1 #3) |
| Mobilní aplikace pro kupce | ❌ | ✅ | ✅ | ✅ | — (jen PWA) |
| Apple Music / ChatGPT / Alexa+ | ❌ | ❌ | ❌ | ✅ | ➖ mimo scope |
| TikTok „Get Tickets" embed | ❌ | ❌ | ❌ | ✅ | ➖ mimo scope |
| Discovery v iframe widgetu | ✅ | ✅ | ❌ | ✅ | `src/app/embed` (Tier-1 #1) |
| Editoriální blog / články | ✅ 🆕 | ❌ | 🟡 | ❌ | catch-up #15 commit `e69b62f` |

## 2. Event creation & správa

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Self-service tvorba akce | ✅ | ✅ | 🟡 | ✅ | `src/app/admin/events/new` |
| Vytvoření do několika minut | 🟡 | ✅ (pár minut) | ❓ | ✅ (≤8 min) | `mega-flow-action-plan.md` P0 testy |
| Reusable šablony | ❌ | ❌ | ❌ | ✅ | — |
| Bulk edit napříč akcemi | ❌ | ❌ | ❌ | ✅ | — |
| Event grouping (turné / serie) | 🟡 | ❌ | ❓ | ✅ | DB: `cross_passes`, UI částečně |
| Custom floor edits live | 🟡 | ❌ | 🟡 | ✅ | seating chart editor existuje |
| Kolaborativní workspace + chat | ❌ | ❌ | ❌ | ✅ | — |
| Audit log změn | 🟡 | ❌ | ❓ | ✅ | DB existuje, UI chybí |
| Schvalovací workflow (tier 1) | 🟡 | ✅ | ✅ | ❓ | DB + admin, UI částečné |
| Auto-approve (tier 2+) | ❌ | ✅ | ✅ | ❓ | mega-flow #14 |
| Sandbox / testovací event | ❌ | ✅ | ❌ | ❓ | — |

## 3. Seat mapping

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Interaktivní seat picker | ✅ | ✅ | ✅ | ✅ | `src/components/seat-picker` |
| Seating chart editor | ✅ | 🟡 (na míru) | ❓ | ✅ | `src/app/platform/venues/[id]/seating-chart/editor` |
| Holds & Kills (rezervace pro VIP) | ❌ | ✅ | ❓ | ✅ | mega-flow P1 #10 |
| Best available auto-select | ❌ | ❓ | ❓ | ✅ | mega-flow P1 #9 |
| Wheelchair-accessible + companion | 🟡 | ✅ | ❓ | ✅ | flag v DB, UI chybí |
| Per-event copy z layoutu | 🟡 | ✅ | ✅ | ✅ | známý P0 bug (paměť) |
| Real-time WebSocket / SSE | ❌ | ❓ | ❓ | ✅ | mega-flow P1 #8 |
| 3D Virtual Venue (výhled ze sedadla) | ❌ | ❌ | ❌ | ✅ | ➖ luxus |
| Real-time revenue calc per edit | ❌ | ❌ | ❌ | ✅ | — |

## 4. Pricing & typy vstupenek

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Více ticket types per event | ✅ | ✅ | ✅ | ✅ | core |
| Cenové úrovně (zóny) | ✅ | ✅ | ✅ | ✅ | core |
| Early bird (time-based) | ✅ | ✅ | ❓ | ✅ | catch-up commit nebo přímo schema |
| Early bird (quantity-based) | 🟡 | ✅ | ❓ | ✅ | — |
| Timed entry sloty | ❌ | ✅ | ❓ | ✅ | mega-flow P3 #22 |
| Permanentky / season tickets | 🟡 | ✅ | ❓ | ✅ | `src/app/[locale]/subscriptions` |
| Vstupenky s nulovou cenou (free) | ✅ | ✅ 🆕 (CZ unique) | ❓ | ✅ | core |
| Honor / comp tickets | 🟡 | ✅ | ❓ | ✅ | `_archive/comp-tickets` |
| Skupinová sleva (volume discount) | ❌ | ❓ | ❓ | ✅ | mega-flow P1 #11 |
| Verified discount (student/senior) | ✅ | ✅ | ❓ | ✅ | catch-up #3 commit `7bdd116` |
| Member pricing | ✅ | ❓ | ❓ | ✅ | vlna M |
| Lottery / ballot | ✅ 🆕 | ❌ | ❌ | ✅ | `src/app/[locale]/lottery` |
| Dárkové vouchery | ✅ | ❓ | ❓ | ✅ | catch-up #4 commit `f6a2cf8` |
| Dynamický pricing (algorithmic) | ✅ 🆕 | ❌ | ❌ | ✅ (Platinum) | `src/lib/dynamic-pricing` (W.1) |
| AI auto-pricing suggestions | ✅ 🆕 | ❌ | ❌ | ❓ | `src/lib/ai/price-suggest.ts` (W.4) |
| All-in pricing (transparentní) | ✅ | ✅ | 🟡 | ✅ | core |
| Prodej na fakturu (B2B) | ✅ | ✅ | ✅ | ✅ | `src/app/api/orders` (catch-up #8 `8ae3b05`) |

## 5. Checkout & platby

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Karta (3DS) | 🟡 mock | ✅ | ✅ | ✅ | P0 #1 — Stripe/GoPay produkce |
| Apple Pay | ❌ | ✅ | ❓ | ✅ | P2 #17 |
| Google Pay | ❌ | ✅ | ❓ | ✅ | P2 #17 |
| PayPal | ❌ | ✅ | ❓ | ✅ | — |
| QR platba (české banky) | ❌ | ✅ | ❓ | ❌ | — |
| Bankovní převod | 🟡 | ✅ | ✅ | ✅ | PSD2 OAuth wired (Tier-1 #4) |
| Hotovost (POS) | 🟡 | ✅ | ✅ | ✅ | POS thermal print commit `6b389d3` |
| Klarna / BNPL / Twisto | ❌ | ❓ | ❓ | ✅ | P2 #18 stub |
| Apple Wallet pass | ❌ | ✅ | 🟡 | ✅ | — |
| Google Wallet pass | ❌ | ❓ | ❓ | ✅ | — |
| Pluxee / Benefit Plus / Sodexo | ❌ | ❓ | ❓ | ❌ | P2 #19 |
| Wero (account-to-account) | 🟡 mock | ❌ | ❌ | ❌ | `src/app/mock-wero` (CZ early adopter) |
| Promo kódy | ✅ | ✅ | ✅ | ✅ | `src/app/api/promo-codes` |
| All-in pricing display | ✅ | ✅ | 🟡 | ✅ | core |
| Webhook idempotency | 🟡 | ✅ | ✅ | ✅ | P0 #1 součást |
| 3DS strong customer auth | 🟡 mock | ✅ | ✅ | ✅ | P0 #1 |

## 6. Anti-bot & fairness

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| CAPTCHA na checkout | 🟡 mock | ✅ | ❓ | ✅ | P0 #4 — hCaptcha |
| Waiting room / virtuální fronta | ✅ 🆕 | ❌ | ❌ | ✅ | `src/app/[locale]/queue` |
| Verified Fan (pre-sale registrace) | ✅ 🆕 | ❌ | ❌ | ✅ | catch-up #14 commit `d30aa91` |
| IP rate limiting | 🟡 | ❓ | ❓ | ✅ | částečně přes Next |
| Purchase limit per email/account | 🟡 | ✅ | ❓ | ✅ | DB má `max_per_order` |
| ML fraud detection | 🟡 rules | ❓ | ❓ | ✅ | `src/lib/bot-detection/detect.ts` |
| Bot proof queue (post-purchase ověření) | 🟡 | ❌ | ❌ | ✅ | `_archive/bot-proof-queue` |

## 7. Resale & transfer

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Self-service resale listing | ✅ | ❌ | ❌ | ✅ | `src/app/[locale]/resale` |
| Resale marketplace (P2P) | ✅ 🆕 | ❌ | ❌ | ✅ | core |
| Face value exchange (cap = original) | 🟡 | ❌ | ❌ | ✅ | rule engine zatím chybí |
| Transfer vstupenky na email | ❌ | ❓ | ❓ | ✅ | P1 #7 |
| Deaktivace orig QR + nový | ❌ | ❓ | ❓ | ✅ | P1 #7 |
| Transfer timer (off X dní před) | ❌ | ❌ | ❌ | ✅ | — |
| Money-back guarantee | ❌ | ❓ | ❓ | ✅ | — |
| Self-service refund UI | ❌ | ✅ | ❓ | ✅ | P1 #5 (API existuje) |
| Částečný refund | ❌ | ✅ | ❓ | ✅ | P1 #6 |
| Chargeback workflow | 🟡 stub | ✅ | ✅ | ✅ | P3 #24 |
| Insurance (Allianz / Twisto) | ❌ | ❓ | ❓ | ✅ | — |

## 8. Entry & scanning

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Scanner mobilní app | 🟡 (PWA) | ✅ native | ✅ | ✅ | `src/app/t` |
| Offline sken (sync after) | ✅ | ❓ | ❓ | ✅ | scanner offline commit |
| Statický QR | ✅ | ✅ | ✅ | ❓ | core |
| Dynamický rotující barcode | ❌ | ❌ | ❌ | ✅ (SafeTix) | P2 #20 |
| Elektronický podpis PDF (X.509) | ✅ | ✅ 🆕 (2025) | ❌ | ❌ | PAdES commit `15fef2f` |
| Multi-gate správa | 🟡 | ✅ | ❓ | ✅ | DB existuje |
| Per-gate sken statistiky | ❌ | ✅ | ❓ | ✅ | — |
| Pre-entry check (dry run) | ❌ | ❌ | ❌ | ✅ | — |
| Exit scan (re-entry) | 🟡 | ❌ | ❌ | ✅ | P3 #25 |
| Re-entry multi-counter | ❌ | ❌ | ❌ | ✅ | — |
| Biometric entry (selfie) | ❌ | ❌ | ❌ | ✅ (Nexus) | `_archive/biometric-entry` |
| Cashless platby na místě | ❌ | ✅ | ⏳ 2025 | ✅ | `_archive/cashless-payments` |
| Termotiskárna podpora | 🟡 | ✅ Zebra | ❓ | ✅ | — |
| POS thermal print | ✅ | ✅ | ❓ | ✅ | catch-up #10 commit `6b389d3` |

## 9. Marketing

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Promo kódy | ✅ | ✅ | ✅ | ✅ | core |
| Slevové akce per tier | 🟡 | ✅ | ❓ | ✅ | DB ano |
| Audience segmentation | 🟡 | ✅ Axima | 🟡 | ✅ | `_archive/audience-segmentation` |
| Email kampaně (transactional) | ✅ | ✅ | ✅ | ✅ | `_archive/bulk-email` part wired |
| WYSIWYG email editor | ❌ | 🟡 (na míru) | ❓ | ✅ | P2 #21 |
| SMS informační kampaně | 🟡 mock | ✅ 🆕 (1,50 Kč) | ❌ | 🟡 | P0 #3 |
| SMS reklamní (remarketing) | ❌ | ✅ 🆕 (3 Kč) | ❌ | 🟡 | — |
| SMS vstupenka (QR do SMS) | ❌ | ✅ 🆕 | ❌ | ✅ | — |
| Push notifikace | ❌ | ❓ | ✅ | ✅ | P1 #12 |
| Newsletter opt-in | ✅ | ✅ | ✅ | ✅ | `src/app/[locale]/newsletter` |
| RSVP / „půjdu" social | ✅ 🆕 | ❌ | ✅ | ❓ | catch-up #13 commit `f97b564` |
| Reviews & ratings | ✅ 🆕 | ❌ | 🟡 | ❌ | catch-up #20 commit `7aac090` |
| Tracking pixels (FB / GA / TikTok) | ✅ | ✅ | ✅ | ✅ | core embed |
| Came From Codes / UTM | ✅ | ✅ | ✅ | ✅ | core |
| Promoted Ads CPC marketplace | ❌ | ❌ | ❌ | ✅ | P2 #13 |
| Programmatic ads (display, CTV) | ❌ | ❌ | 🟡 | ✅ | — |
| Affiliate program | ❌ | ❓ | ❓ | ✅ | `_archive/affiliate-tracking` |
| Geo-targeting partnerství | ❌ | ✅ (Pays/Parkum) | ❌ | ✅ | — |
| Personalized email per segment | ❌ | 🟡 | ❓ | ✅ | — |
| Smart send-time | ❌ | ❌ | ❓ | ✅ | — |
| Cart abandonment | ❌ | ❓ | ❓ | ✅ | `_archive/cart-abandonment` |
| Heat-map prodejů (analytics) | ✅ 🆕 | ❌ | ❓ | ✅ | catch-up #17 commit `be1f623` |

## 10. Reporting & analytics

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Real-time prodejní dashboard | ✅ | ✅ | ✅ | ✅ | `src/app/admin` |
| Sales curve (čas vs prodej) | ✅ | ✅ | ❓ | ✅ | catch-up #17 |
| Heat-map sedadel | ✅ | ❌ | ❓ | ✅ | catch-up #17 |
| Per-channel atribuce | 🟡 | ✅ | ❓ | ✅ | — |
| Per-promoter analytics | ✅ | ✅ | ❓ | ✅ | `src/app/admin/analytics` |
| Per-platform analytics (master) | ✅ | n/a | n/a | ✅ | `src/app/platform/analytics` |
| Customizable exports | 🟡 | ✅ | ❓ | ✅ | CSV ano, custom ne |
| Účetní podklady (auto-faktura) | 🟡 | ✅ | ❓ | ✅ | DB ano, automatizace ne |
| Anomaly detection | ❌ | ❌ | ❓ | ✅ | — |
| BI partneři (3rd party) | ❌ | ❌ | ❓ | ✅ (Nexus) | — |

## 11. API & integrace

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Public read-only GraphQL | ✅ 🆕 | ❌ | ❌ | ✅ | `src/app/api/graphql` (Tier-1 #3) |
| Discovery feed (JSON/CSV) | 🟡 | ❌ | ❌ | ✅ | částečně přes GraphQL |
| Partner API (claim links) | ✅ | ❌ | ❌ | ✅ | `src/app/api/partner` + catch-up #6 `a8597d1` |
| Webhooks | 🟡 | ❌ | ❓ | ✅ | DB má webhook subscriptions |
| Mobile SDK (iOS/Android) | ❌ | ❌ | ❌ | ✅ | — |
| iframe embed widget | ✅ | ✅ | ❌ | ✅ | `src/app/embed` (Tier-1 #1) |
| Facebook Pixel auto-embed | ✅ | ✅ | ✅ | ✅ | core |
| Promotér web (B2B widget) | ✅ | ✅ | ❌ | ✅ | embed |
| FB integration (event sync) | 🟡 | ✅ | ✅ | ✅ | — |
| Bandzone.cz partnerství | ❌ | ✅ 🆕 | ❌ | ❌ | ➖ business |
| Distributed commerce (Apple, TikTok) | ❌ | ❌ | ❌ | ✅ | ➖ enterprise |

## 12. Branding & customization

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Per-promotér branding | ✅ | ✅ | 🟡 | ✅ | profile branding |
| Custom PDF design | 🟡 | ✅ | ❓ | ✅ | šablona existuje |
| Custom email šablony | 🟡 | ✅ | ❓ | ✅ | per-promoter templates |
| White-label (vlastní doména) | ❌ | ❌ | ❌ | ✅ | `_archive` má |
| Custom CSS / theming | 🟡 | ❌ | ❌ | ✅ | — |
| Logo partnerů na PDF | 🟡 | ✅ | ❓ | ✅ | — |
| Brandovaný embed widget | ✅ | ✅ | ❌ | ✅ | Tier-1 #1 |

## 13. Subscriptions, loyalty, retention

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| Season tickets / permanentky | ✅ | ✅ | 🟡 | ✅ | `src/app/[locale]/subscriptions` |
| Cross-event passes (festival) | ✅ | 🟡 | ❓ | ✅ | `src/app/[locale]/cross-passes` |
| Tixly+ (členství) | ✅ 🆕 | ❌ | ❌ | ✅ (Plus) | `src/app/[locale]/tixly-plus` |
| Loyalty body | 🟡 | ❌ | ❓ | ✅ | `src/app/[locale]/loyalty` |
| Body za nákup + redemption | ❌ | ❌ | ❓ | ✅ | P3 #26 |
| Artist follows | ❌ | ❌ | ✅ 🆕 | ✅ | `_archive/artist-follows` |
| Venue follows | 🟡 | ❌ | ✅ 🆕 | ✅ | „oblíbená místa" SMSticket 2025 |
| Notifikace o nových akcích | 🟡 | ❌ | ✅ | ✅ | newsletter ano, push ne |
| Subscriber benefits (advance tix) | ❌ | ❓ | ❓ | ✅ | — |

## 14. Vertikály (specializace)

| Vertikála | Tixly | SMSticket | GoOut | TM |
|---|---|---|---|---|
| Koncerty | ✅ | ✅ | ✅ | ✅ |
| Divadlo | ✅ | ✅ | ✅ | ✅ (Paciolan) |
| Festivaly | 🟡 | ✅ | ✅ | ✅ (Front Gate) |
| Sport (permanentky) | 🟡 | ✅ | ✅ | ✅ (Account Manager) |
| Muzea / galerie | ❌ | 🟡 | ✅ | 🟡 |
| Konference | 🟡 | ✅ | 🟡 | 🟡 |
| Plesy (komplexní seating) | ✅ | ✅ 🆕 | ❓ | ✅ |
| Kino | 🟡 | ❓ | ❓ | ❌ | `_archive/cinema` |
| Akreditace (badges) | 🟡 | ❌ | ❌ | 🟡 | `_archive/accreditation` |
| Online streamy | ❌ | ✅ | 🟡 | ❌ | — |
| Workshopy / kurzy | ✅ | ✅ | ✅ | ❌ | core |

## 15. Compliance, bezpečnost, právo

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| WCAG 2.1 AA (EAA compliance) | ✅ | 🟡 | 🟡 | ✅ | Tier-1 #2 commit `fde40aa` |
| GDPR DPA | ❓ | ✅ | ✅ | ✅ | mimo kód |
| PCI-DSS | ❌ (mock pay) | ✅ | ✅ | ✅ | P0 #1 |
| P2PE certifikace | ❌ | ❓ | ❓ | ✅ | — |
| MFA admin | 🟡 | ❓ | ❓ | ✅ | — |
| Passkey / WebAuthn | ❌ | ❌ | ❌ | ✅ | — |
| Age verification (18+) | ✅ | ✅ | ✅ | 🟡 | `_archive/age-verification` |
| KYC pro promotéry | ✅ | ✅ | ✅ | ✅ | DB + admin |
| Audit log | 🟡 | ❓ | ❓ | ✅ | `_archive/action-log` |
| Cookie banner / consent | 🟡 | ✅ | ✅ | ✅ | — |
| ToS + obchodní podmínky | 🟡 | ✅ | ✅ | ✅ | mimo kód |
| EU DSA reporting | ❓ | ❓ | ❓ | ✅ | — |

## 16. AI vrstva

| Feature | Tixly | SMSticket | GoOut | TM | Kde v repu |
|---|---|---|---|---|---|
| AI generování popisů akcí | 🟡 | ❌ | ❌ | ✅ | P3 #28 |
| AI cover image | ✅ 🆕 | ❌ | ❌ | ❓ | W.3 |
| AI auto-pricing | ✅ 🆕 | ❌ | ❌ | 🟡 | W.4 |
| AI dynamic pricing | ✅ 🆕 | ❌ | ❌ | ✅ (Platinum) | W.1 |
| ML recommendation | ✅ 🆕 | ❌ | 🟡 | ✅ | W.2 |
| AI customer support chatbot | ❌ | 🟡 (nápověda AI) | ❓ | ✅ | — |
| Conversational ticketing | ❌ | ❌ | ❌ | ✅ (ChatGPT) | — |
| AI moderace popisků | ❌ | ❌ | ❓ | ✅ | — |
| AI fraud ML | ❌ | ❌ | ❓ | ✅ | — |
| AI seat recommendation | ❌ | ❌ | ❌ | 🟡 | — |
| AI sentiment / review NLP | ❌ | ❌ | ❓ | ✅ | — |

## 17. Lokalizace

| Feature | Tixly | SMSticket | GoOut | TM |
|---|---|---|---|---|
| Čeština | ✅ | ✅ | ✅ | 🟡 |
| Slovenština | ✅ | ✅ | ✅ | ❌ |
| Angličtina | ✅ | ✅ | ✅ | ✅ |
| Multi-měna | ❌ | 🟡 | ✅ | ✅ |
| Vícero zemí v jednom účtu | ❌ | ❌ | ✅ (PLG) | ✅ |
| Lokalizované platby per země | ❌ | ✅ | ✅ | ✅ |

---

## TOP 10 GAPů co nejvíc bolí (subjektivní priorita)

Roztříděno podle **bolesti pro reálný launch** × **náklady na implementaci**:

| # | Gap | Bolest | Náklady | Tier (vs. moje předchozí matice) |
|---|---|---|---|---|
| 1 | **Stripe/GoPay produkce + webhook idempotency** | Bez toho nelze brát peníze | Vysoké (kontrakt + dev 1 týden) | Tier C |
| 2 | **Resend/SES produkční SMTP** | Bez toho nedoručíme PDF | Nízké (3 dny po API key) | Tier C |
| 3 | **Self-service refund UI** (P1 #5) | Support overload bez toho | Nízké (1 den) | Tier A |
| 4 | **Apple Wallet pass** | Standard, fanoušci očekávají | Střední (3 dny) | Tier A |
| 5 | **Real CAPTCHA (hCaptcha)** | Bez toho boti vyžerou inventář | Nízké (1 den po site key) | Tier C |
| 6 | **Transfer vstupenky na email** (P1 #7) | Kupec nemá co s nepoužitými lístky | Střední (2-3 dny) | Tier A |
| 7 | **Holds & Kills** (P1 #10) | VIP/produkce bez toho neumí pracovat | Střední (2 dny) | Tier A |
| 8 | **Best available auto-select** (P1 #9) | Konverze vs ruční výběr | Střední (2 dny) | Tier A |
| 9 | **SSE real-time seats** (P1 #8) | Race conditions, „lístek zmizel" | Střední (3 dny) | Tier A |
| 10 | **POS kompletní toolkit** (cashless + termo) | Velký festival/divadlo bez toho ne | Vysoké (2-3 týdny) | Tier A+C |

## Co máme navíc proti SMSticket (CZ benchmark) 🆕

Konkurenční výhody, na kterých stojí narativ:

- **Dynamický pricing engine** (W.1) — SMSticket neumí
- **AI cover image generation** (W.3) — SMSticket neumí
- **AI auto-pricing suggestions** (W.4) — SMSticket neumí
- **Recommendation engine** (W.2) — SMSticket neumí (jen oblíbená místa od 2025)
- **Verified Fan** model (catch-up #14) — SMSticket neumí
- **Sales heat-map analytics** (catch-up #17) — SMSticket neumí
- **Lottery / ballot** (`/cs/lottery`) — SMSticket neumí
- **RSVP / „půjdu" sociální** (catch-up #13) — SMSticket neumí
- **Reviews & ratings** (catch-up #20) — SMSticket neumí
- **Resale marketplace** — SMSticket neumí
- **Veřejné GraphQL API** (Tier-1 #3) — SMSticket neumí
- **iframe embed widget** s brandingem (Tier-1 #1) — SMSticket má, ale my máme modernější
- **Cross-event passes** — SMSticket umí permanentky, ale ne flex passy
- **Tixly+ membership** — žádný CZ konkurent
- **Editorial blog** — GoOut má částečně, SMSticket vůbec
- **WCAG 2.1 AA audit** (Tier-1 #2) — kritická EAA compliance
- **PSD2 OAuth bank integration** (Tier-1 #4) — SMSticket má jen Pays partnership

## Co máme navíc proti GoOut 🆕

- **Self-service portal pro promotéry** (GoOut je „kontaktní formulář")
- **Veřejný ceník + transparency** (GoOut individuální dohody)
- **Digitálně podepsané PDF (X.509)** (GoOut nemá)
- **SMS funkce** (GoOut nemá vůbec, my máme mock + jasnou cestu k produkci)
- **Resale marketplace** (GoOut nemá)
- **AI vrstva** kompletně
- **Lottery / Verified Fan** (GoOut nemá)
- **Veřejné API** (GoOut nedokumentováno)

## Kde NEMÁME ambici doháněji Ticketmaster ➖

To by bylo plýtvání zdroji. Pochopit jako „strop", nikoli „cíl":

- Native mobile SDK ekosystém (Ignite)
- Apple Music / ChatGPT / Alexa+ integrace
- TikTok „Get Tickets" embed
- Distributed commerce (32M+ tix přes partnery)
- Nexus partner network (100+ certifikovaných partnerů)
- Programmatic display ads (CTV, DOOH)
- 3D Virtual Venue
- Biometric entry
- Multi-region cross-market platform
- Account Manager pro sezónky (jen základ ano)

---

## Závěr — narativ pro sales

Tixly **dnes** překonává SMSticket ve **14 oblastech** (AI, resale, lottery, verified fan, public API, embed, ratings, reviews, accessibility) a překonává GoOut v **8 oblastech** (self-service, transparency, X.509, AI, resale, public API).

Aby Tixly **byl reálně použitelný** na trhu (ne jen lepší featurelist), je nutné dotáhnout **TOP 10 GAPů** výše — z toho **5 je Tier A** (dotáhnu sám) a **5 vyžaduje Tier C** (API keys + kontrakty).

Ticketmaster je **strop, ne cíl** — neztrácet čas dohánět enterprise vrstvu (Ignite SDK, Apple Music partnerství), místo toho **zacementovat CZ/SK trh** přes SMSticket parity + naše AI/resale/Verified Fan diferenciátory.
