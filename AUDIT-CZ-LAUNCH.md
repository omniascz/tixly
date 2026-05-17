# Audit CZ launch — co máme, co chybí

> Systematický průchod všemi flow pro český trh. Datum: 2026-05-15. Stav: 247 API routes, 173 migrací, 358 testů zelených.

**Legenda:** ✅ Funguje · 🟡 Funguje, ale s drobnostmi · 🔴 Chybí · ⚠️ Funguje, ale nevhodně nakonfigurováno

---

## 1. BUYER FLOW (kupec)

### 1.1 Registrace + verifikace
| Funkce | Stav | Pozn. |
|---|---|---|
| Registrace email + heslo | ✅ | `/cs/register` + `/api/auth/register` |
| Email verifikace (token) | ✅ | `/cs/verify-email` + `/api/auth/verify-email` |
| Login + JWT | ✅ | `/cs/login` + `/api/auth/login` |
| Refresh token rotation | ✅ | `/api/auth/refresh` |
| Logout + token revocation | ✅ | `/api/auth/logout` |
| Login history | ✅ | `/api/auth/login-history` |
| Sessions management | ✅ | Viz aktivní sessions, lze ukončit |
| Phone verification (SMS OTP) | ✅ | `/api/buyer/phone-verification` |
| Guest checkout (bez registrace) | ✅ | order.user_id se vyrobí jako guest |
| Unsubscribe (newsletter) | ✅ | `/api/auth/unsubscribe` + `/cs/unsubscribe` |
| Password reset | 🔴 | **CHYBÍ** — žádný route ani UI pro „Zapomenuté heslo" |
| 2FA pro buyera (volitelné) | 🟡 | Admin má 2FA, buyer ne |

**🔴 GAP: Password reset flow**. To je standardní feature. Bez ní kupec co zapomene heslo nemá jak se dostat zpátky. Musí přijít na support.

### 1.2 Discovery + nákup
| Funkce | Stav | Pozn. |
|---|---|---|
| Homepage s eventy | ✅ | `/cs` — kategorie + this week + upcoming |
| Lokalizace CS/SK/EN | ✅ | i18n dict + locale-aware texty |
| Vyhledávání | ✅ | `/cs/search` |
| Mapa akcí (geolocation) | ✅ | `/cs/events/map` |
| Public event detail | ✅ | `/cs/events/[id]` + slug `/cs/p/[event-slug]` |
| Public promotér profile | ✅ | `/cs/p/[slug]` se stats + reviews |
| Editorial blog | ✅ | `/cs/blog` |
| Seat picker | ✅ | Renderuje layout, hold/release, real-time SSE |
| Best available auto-select | ✅ | „Vyber X nejlepších" v SeatPicker.tsx |
| Recommendation engine | ✅ | `/api/buyer/recommendations` (W.2) |
| Reviews & ratings | ✅ | `marketing.event_reviews` |
| RSVP / „půjdu" | ✅ | `event_rsvps` + UI |
| Lottery / ballot | ✅ | `/cs/lottery` + redeem |
| Subscriptions / permanentky | ✅ | `/cs/subscriptions` + flex passes |
| Cross-event passes | ✅ | `/cs/cross-passes` |
| Tixly+ membership | ✅ | `/cs/tixly-plus` |
| Gift vouchers | ✅ | `/cs/gift` + redeem flow |

### 1.3 Checkout
| Funkce | Stav | Pozn. |
|---|---|---|
| Form s validací | ✅ | jméno, email, telefon, age verification gate |
| Quantity z URL | ✅ | catch-up fix |
| Apple/Google Pay přes GoPay | ✅ | GoPay allowed_payment_instruments má GPAY + APPLE_PAY |
| Bank transfer s VS | ✅ | 10-digit per-event format (EEEEEENNNN) |
| Wero (SEPA Instant) | 🟡 | mock — pro EUR později |
| Przelewy24 | 🟡 | mock — PL trh, ne core CZ |
| Benefit cards (Pluxee/Sodexo/Edenred/Benefit+/Gallery Beta) | 🟡 | callback route + lib, ale UI selektor v checkoutu **CHYBÍ** |
| Promo kódy | ✅ | s validací + uses_count atomicky |
| Volume discount | ✅ | tier-based, displayed v košíku |
| Gift vouchers redemption | ✅ | claim v checkoutu |
| Subscription redemption (permanentka) | ✅ | checkbox „Použít permanentku" |
| Verified Fan presale | ✅ | catch-up #14 |
| Waiting room (anti-bot queue) | ✅ | `/cs/queue` |
| Age gate (18+) | ✅ | birth date + checkbox |
| hCaptcha | 🟡 | mock — potřeba production keys |
| Access code (private events) | ✅ | `/api/events/[id]/unlock-access-code` + rate-limit |
| Order timeout (15 min) | ✅ | cron expire-pending-orders |

**🟡 GAP: Benefit cards UI selektor v checkoutu**. Backend (`/api/payments/benefit/callback`) funguje, ale buyer si v `/cs/checkout` nemůže vybrat „Pluxee" jako platební metodu. Jen `gopay | wero | przelewy24 | bank_transfer`.

### 1.4 Post-purchase
| Funkce | Stav | Pozn. |
|---|---|---|
| Email s PDF + QR | ✅ | order-completed flow přes mailer |
| SMS magic link na fullscreen QR | ✅ | catch-up #1 |
| `/cs/my-tickets` seznam | ✅ | + refund + transfer modals |
| `/cs/t/[token]` mobile QR (rotating TOTP) | ✅ | Level 1 SafeTix-style |
| Self-service refund (full + partial) | ✅ | per-event deadline + fee |
| Transfer vstupenky na email | ✅ | nový QR, orig deaktivován |
| Refund request (mimo deadline) | ✅ | `/api/buyer/refund-requests` + admin queue |
| Resale listing (peer-to-peer) | ✅ | `/cs/resale` + `/api/buyer/resale/list` |
| Apple Wallet pass | ✅ | `/api/buyer/tickets/[id]/wallet/apple` |
| Google Wallet pass | 🔴 | **CHYBÍ** — jen Apple |
| Order confirmation page | ✅ | `/cs/order-confirmation/[orderId]` |
| GDPR data export | ✅ | `/api/buyer/gdpr/export` (JSON) |
| GDPR account deletion | ✅ | `/api/buyer/gdpr/delete` + cron |
| Loyalty body | ✅ | `/cs/loyalty` |
| Profile + branding | ✅ | `/cs/profile` |
| Push notifikace subscribe | ✅ | `/api/buyer/push/subscribe` |
| Insurance claim flow | ✅ | `/api/buyer/orders/[id]/insurance-claim` |
| Followers (artist/promoter follow) | ✅ | `/api/buyer/follows` |

**🔴 GAP: Google Wallet pass**. Apple Wallet funguje, ale Google Pay/Wallet integration chybí. ~30 % CZ Android uživatelů.

---

## 2. PROMOTÉR FLOW

### 2.1 Onboarding
| Funkce | Stav | Pozn. |
|---|---|---|
| Registrace pořadatele | ✅ | `/cs/register-promoter` |
| KYC formulář | ✅ | IČO + DIČ + ARES verifikace + IBAN + DPH |
| ARES API lookup IČO | ✅ | `src/lib/ares/verify.ts` (auto-fill firmy) |
| Onboarding checklist | ✅ | `/admin/onboarding` + CZ/SK fields |
| Trh + měna setup | ✅ | dnes přidané |
| Branding (logo, barvy, tagline) | ✅ | `/admin/settings/branding` |
| Custom doména | ✅ | `/admin/settings/domains` |
| 2FA aktivace | ✅ | `/admin/settings/TwoFactorSettings.tsx` |
| Team invites | ✅ | `/admin/team` + invite emails |
| Specializované role (RBAC) | ✅ | catch-up #15 |
| Email verification | ✅ | stejné jako buyer |

### 2.2 Event management
| Funkce | Stav | Pozn. |
|---|---|---|
| Create event wizard | ✅ | `/admin/events/new` — 6-step |
| Multi-day struktura | ✅ | days + zones |
| Multi-ticket types | ✅ | basePrice, totalQty, zones, access codes |
| Recurring events | ✅ | migrace 018 |
| Event cloning | 🟡 | archive modul (event-cloning), UI chybí |
| Edit event (with re-moderation) | ✅ | PATCH endpoint + AI gate |
| Cover image upload | 🟡 | URL field, ale upload widget chybí — zatím externí hosting |
| AI generování popisů | ✅ | `/admin/events/[id]/ai-description` |
| AI cover image (DALL-E) | ✅ | `/api/admin/ai/cover-image` |
| Refund policy per event | ✅ | dnes přidané |
| QR policy (4 úrovně) | ✅ | dnes přidané |
| VAT category per event | ✅ | dnes přidané |
| Dynamic pricing | ✅ | `/admin/events/[id]/dynamic-pricing` (W.1) |
| Volume discount tiers | ✅ | `/admin/events/[id]/volume-discounts` |
| Member pricing | ✅ | `/admin/events/[id]/member-pricing` |
| Holds & Kills | ✅ | `/admin/events/[id]/holds` (5 kategorií) |
| Add-ons (parking, F&B, merch) | ✅ | `/admin/events/[id]/addons` |
| Hospitality (corporate suites) | ✅ | `/admin/events/[id]/hospitality` |
| Lottery setup | ✅ | `/admin/events/[id]/lotteries` |
| Embed widget | ✅ | `/admin/events/[id]/embed` |
| Live ops dashboard | ✅ | `/admin/events/[id]/live-ops` (real-time during onsale) |
| Sales report per event | ✅ | `/admin/events/[id]/sales-report` |
| Heat-map analytics | ✅ | catch-up #17 |
| Broadcast email/SMS | ✅ | `/admin/events/[id]/broadcast` |
| Accreditation requests | ✅ | `/admin/events/[id]/accreditation` |
| Wristbands (festival entry) | ✅ | `/admin/events/[id]/wristbands` |
| Season tickets setup | ✅ | `/admin/events/[id]/season` |
| Timed entry slots | ✅ | `/admin/events/[id]/settings` |
| Payment plans (splátky) | ✅ | `/admin/events/[id]/settings` + cron |
| Insurance add-on toggle | ✅ | `/admin/events/[id]/settings` |
| Queue / waiting room toggle | ✅ | `/admin/events/[id]/settings` |
| Personalized tickets (jméno per ticket) | ✅ | catch-up #16 |

### 2.3 Sales operations
| Funkce | Stav | Pozn. |
|---|---|---|
| Orders list + filter | ✅ | `/admin/orders` |
| Customer list | ✅ | `/admin/customers` |
| Refund order manually | ✅ | per-ticket nebo full |
| Bulk refund | ✅ | `/api/admin/orders/bulk-refund` |
| Refund requests queue | ✅ | dnes přidané |
| Scanner (PWA mobile) | ✅ | `/admin/scanner` + offline queue |
| Re-entry + exit scan | ✅ | catch-up |
| POS desktop | ✅ | `/admin/pos` form-based |
| POS tablet touch | ✅ | dnes přidané `/admin/pos/quick` |
| Cross-pass scanner | ✅ | flex passes scan |
| Multi-gate setup | ✅ | `/admin/scanner/gates` |
| Thermal print receipt | ✅ | `/admin/pos/receipt/[orderId]` |
| Bank transfer reconciliation | ✅ | `/admin/bank-transfers` + Fio cron |
| Chargebacks list | ✅ | `/admin/chargebacks` |
| Comp tickets (čestné vstupenky) | ✅ | hold_kind=comp |
| Guest list (VIP) | ✅ | `/admin/access-codes` |
| Reservations (B2B/phone) | ✅ | dnes přidané `/admin/reservations` |
| Staff schedule | ✅ | `/admin/staff` (event_staff catch-up) |
| Member groups | ✅ | `/admin/member-groups` (loyalty tiers) |

### 2.4 Payouts + Reports
| Funkce | Stav | Pozn. |
|---|---|---|
| Payouts list (per currency) | ✅ | CZK + EUR oddělené |
| Holdback monitor | ✅ | dnes na master admin dash |
| Auto-settle cron | 🟡 | manuální `/api/admin/payouts/settle` endpoint, scheduled cron chybí |
| Pohoda XML export | ✅ | dnes přidané |
| CSV raw export | ✅ | per-month + DPH rozpis |
| Faktury PDF | ✅ | `/api/admin/invoices/export` |
| Money S3 ISDOC | 🔴 | **CHYBÍ** — TODO ve UI komentáři |
| Daňový report dashboard | 🟡 | placeholder card v `/admin/reports` |

**🟡 GAP: Auto-settle scheduled cron**. Manual settle endpoint existuje, ale není v vercel.json crons. Promotér musí klikat „Settle now" sám místo automaticky 1× za týden.

### 2.5 Marketing
| Funkce | Stav | Pozn. |
|---|---|---|
| Campaign composer (email/SMS/push) | ✅ | dnes přidané `/admin/campaigns` |
| Segment selector | ✅ | all_buyers + last_order_days |
| UTM attribution tracking | ✅ | attribution.touch_points + conversions |
| Marketing dashboard | ✅ | dnes přidané `/admin/marketing` |
| Email template editor | ✅ | `/admin/email-templates` + toolbar |
| SMS campaigns | ✅ | `/admin/sms-campaigns` |
| Broadcast send | ✅ | `/admin/broadcasts` + `/api/internal/broadcast-send` |
| Audience segmentation | 🟡 | DB existuje, UI je v campaigns wizardu (jen 2 dimenze) |
| Smart send-time | 🟡 | catch-up — funguje, ale UI ne |
| Affiliate program | ✅ | `/admin/affiliates` |
| Promoted Ads (CPC marketplace) | ✅ | `/admin/ads` |
| Newsletter management | ✅ | unsubscribe API |
| Push broadcasts | ✅ | broadcast přes push channel |

### 2.6 Settings + governance
| Funkce | Stav | Pozn. |
|---|---|---|
| KYC + ARES IČO | ✅ | + DIČ + IBAN + DPH |
| Branding | ✅ | logo, barvy, tagline, social |
| Custom domains | ✅ | white-label |
| Audit log | ✅ | `/admin/audit-log` + filter |
| Fraud queue | ✅ | `/admin/fraud-queue` |
| Alerts (anomaly detection) | ✅ | `/admin/alerts` |
| Webhook subscriptions (3rd party) | 🟡 | DB existuje, admin UI pro custom webhooks chybí |

---

## 3. MASTER ADMIN FLOW

| Funkce | Stav | Pozn. |
|---|---|---|
| Platform overview dashboard | ✅ | dnes — revenue/měna, top promotéři, holdback, webhook activity, provider health |
| Pending promotéři queue | ✅ | `/platform/promoters` filter |
| Promotér detail + KYC review | ✅ | + CZ/SK launch settings |
| Fee schedule override (per promotér) | ✅ | dnes — vytvoří nový `fee_schedules` row s důvodem |
| Country + currency + tier setup | ✅ | dnes |
| Holdback override (% + dní) | ✅ | dnes |
| Event moderation queue | ✅ | `/platform/event-moderation` |
| AI moderation gate (Claude) | ✅ | `src/lib/moderation/ai-gate.ts` |
| Keyword blocklist | ✅ | `catalog.moderation_blocklist` |
| Audit log search | ✅ | `/platform/audit-log` |
| Venues management | ✅ | `/platform/venues` + seating chart editor |
| Seating chart editor | ✅ | `/platform/venues/[id]/seating-chart/editor` (945 řádků) |
| Webhooks raw log | ✅ | `/platform/webhooks` |
| Identity verifications | ✅ | `/platform/verifications` |
| Editorial articles admin | ✅ | `/platform/editorial` (catch-up #15) |
| Partners API tokens | ✅ | `/platform/partners` |
| Suspend promotér | ✅ | `/api/platform/promoters/[id]/suspend` |
| Approve promotér | ✅ | + auto-email |

---

## 4. CZ-SPECIFIC FEATURES

| Funkce | Stav | Pozn. |
|---|---|---|
| **VAT 10 % kulturní** (default) | ✅ | per-event vat_category |
| **VAT 21 % standard** | ✅ | per-event |
| **VAT 12 % F&B** | ✅ | per-event |
| **DPH plátce / neplátce** | ✅ | `promoters.vat_payer` flag |
| **IČO 8-cifer** validace | ✅ | KYC schema regex |
| **DIČ CZ prefix** | ✅ | display + invoice |
| **ARES API lookup** | ✅ | auto-fill firma z IČO |
| **VS pro bank transfer** | ✅ | 10-digit per-event EEEEEENNNN |
| **Fio Open API auto-pull** | ✅ | cron bank-sync-fio |
| **PSD2 OAuth (KB/ČS/ČSOB)** | ✅ | Tier-1 #4 |
| **X.509 PAdES digital signature PDF** | ✅ | catch-up #2 |
| **Pohoda XML export** | ✅ | dnes |
| **Money S3 ISDOC** | 🔴 | **CHYBÍ** |
| **iDoklad export** | 🔴 | **CHYBÍ** (menší účetní software) |
| **EET záznamy 10 let retence** | ✅ | `orders.payment_events` immutable |
| **Pluxee CZ** | 🟡 | callback ano, UI ne |
| **Edenred CZ** | 🟡 | callback ano, UI ne |
| **Benefit Plus CZ** | 🟡 | callback ano, UI ne |
| **Sodexo CZ** | 🟡 | callback ano, UI ne |
| **Gallery Beta CZ** | 🟡 | callback ano, UI ne |
| **CZ právní text ToS** | 🟡 | placeholder v repu, neprošlo právníkem |
| **CZ Privacy policy** | 🟡 | placeholder |
| **GDPR + Zákon č. 110/2019** | ✅ | data export + deletion + audit log |
| **Cookie banner (TCF v2.2)** | ✅ | localized CS/SK/EN |
| **DSA (Nahlásit obsah)** | 🟡 | obsah moderace existuje, ale „Nahlásit" tlačítko na public eventu chybí |
| **EAA WCAG 2.1 AA compliance** | ✅ | Tier-1 #2 audit log + helpers |

---

## 5. COMPLIANCE + PROVOZ

### 5.1 Cron jobs (vercel.json)
| Job | V dispatcheru | V vercel.json | Endpoint exists |
|---|---|---|---|
| `expire-pending-orders` | ✅ | ✅ */5 min | ✅ |
| `release-expired-seat-holds` | ✅ | ✅ */5 min | ✅ |
| `send-reminders` | ✅ | ✅ */15 min | ✅ |
| `abandoned-cart` | ✅ | ✅ */6 h | ✅ |
| `waitlist-notify` | ✅ | ✅ */30 min | ✅ |
| `charge-installments` | ✅ | ✅ 3 am | ✅ |
| `renew-subscriptions` | ✅ | ✅ 4 am | ✅ |
| `daily-stats` | ✅ | ✅ 6 am | ✅ |
| `onboarding-reminder` | ✅ | ✅ 9 am | ✅ |
| `process-gdpr-deletions` | ✅ | ✅ 2 am | ✅ |
| `anomaly-detect` | ✅ | ✅ hourly | ✅ |
| **`release-rolling-reserves`** | 🔴 | 🔴 | ✅ (dnes) |
| **`promoter-tier-evaluate`** | 🔴 | 🔴 | ✅ |
| **`bank-sync-fio`** | 🔴 | 🔴 | ✅ |
| **`payouts-auto-settle`** | 🔴 | 🔴 | 🔴 endpoint ne |

**🔴 GAP: 4 crony nejsou v dispatcher ani vercel.json**. Endpointy existují, ale Vercel je neexecutuje protože nejsou v `ALLOWED_JOBS` setu. Musím přidat.

### 5.2 Monitoring + observability
| Funkce | Stav | Pozn. |
|---|---|---|
| `/api/health` liveness | ✅ | |
| `/api/health/ready` DB + Redis | ✅ | |
| `/api/health/providers` | ✅ | dnes — 11 providerů check |
| Public `/cs/status` | ✅ | dnes — + provider health + incidents placeholder |
| Sentry integration | 🟡 | DSN env, ale `@sentry/nextjs` package neimportovaný |
| OTel tracing | 🔴 | `_archive/otel-tracing` jen stub |
| Performance budget alerts | 🔴 | CHYBÍ |
| Uptime monitor config | 🟡 | dokumentace ano, automatický setup ne |

### 5.3 Backups
| Funkce | Stav | Pozn. |
|---|---|---|
| Neon PITR (built-in) | ✅ | 7 dní free, paid 30+ |
| `pg_dump` weekly to S3 | 🔴 | **CHYBÍ** — žádný cron, žádný S3 bucket setup |
| Restore drill script | 🔴 | **CHYBÍ** |
| Migration rollback strategy | 🟡 | docs ano, automatický ne |

---

## 6. PAYMENT METHODS pro CZ

| Provider | Backend | UI v checkoutu | Webhook | Refund | Status |
|---|---|---|---|---|---|
| **GoPay** | ✅ | ✅ „GoPay" radio | ✅ | ✅ | **ready** (čeká credentials) |
| **ComGate** | ✅ | 🟡 sdílí GoPay radio | ✅ | ✅ | **ready** (čeká credentials) |
| **Bank transfer + VS** | ✅ | ✅ | n/a | manual | **ready** |
| **Apple Pay** (přes GoPay) | ✅ | auto | ✅ | ✅ | ready |
| **Google Pay** (přes GoPay GPAY) | ✅ | auto | ✅ | ✅ | ready |
| **Wero (SEPA Instant)** | 🟡 mock | ✅ | 🟡 | 🟡 | dev only |
| **Przelewy24** (Polsko) | 🟡 mock | ✅ | 🟡 | 🟡 | dev only |
| **Pluxee** | ✅ callback | 🔴 | ✅ | 🟡 | **CHYBÍ UI** |
| **Edenred** | ✅ callback | 🔴 | ✅ | 🟡 | **CHYBÍ UI** |
| **Benefit Plus** | ✅ callback | 🔴 | ✅ | 🟡 | **CHYBÍ UI** |
| **Sodexo** | ✅ callback | 🔴 | ✅ | 🟡 | **CHYBÍ UI** |
| **Gallery Beta** | ✅ callback | 🔴 | ✅ | 🟡 | **CHYBÍ UI** |
| **Stripe** | ✅ parked | 🟡 | ✅ | ✅ | mezinárodní rezerva |

**🔴 GAP: 5 benefit karet bez UI radio buttonu**. Kód funguje, jen nejdá vybrat při nákupu.

---

## 7. SEZNAM REÁLNÝCH GAPů (priorita)

### 🔴 Blockery pro launch (musí dotáhnout)

1. **Password reset flow** pro kupce — `/cs/forgot-password` + `/api/auth/forgot-password` + email token + reset page. Bez toho support overload.
2. **Vercel crons** chybí 3 položky:
   - `release-rolling-reserves` (denně)
   - `promoter-tier-evaluate` (měsíčně)
   - `bank-sync-fio` (hodinově)
3. **Benefit cards UI v checkoutu** — radio buttony pro Pluxee/Edenred/Benefit+/Sodexo/Gallery Beta. Bez toho B2B segment CZ trhu vypadne.

### 🟡 Důležité ale ne blocker (do týdne)

4. **Google Wallet pass** — Android kupci očekávají
5. **Auto-settle cron** pro payouts (1× týdně)
6. **DSA „Nahlásit obsah"** tlačítko na public eventu
7. **Money S3 ISDOC export**
8. **pg_dump weekly to S3** backup
9. **Sentry npm package install** + middleware (DSN máš v env)
10. **Cover image upload widget** (zatím externí URL)

### 🟢 Nice-to-have (post-pilot)

11. **iDoklad export** (menší CZ účetní)
12. **OTel tracing** zapojit
13. **Audience segmentation UI** rozšířit (víc dimenzí než 2)
14. **Smart send-time UI** otevřít
15. **Webhook subscriptions admin UI** pro custom 3rd party integrations
16. **Audit log advanced filters** (date range, actor type)
17. **Event cloning UI** (modul je v archive)
18. **Restore drill script**

---

## 8. TVRDÁ ANSWER NA TVOU OTÁZKU

**„Když dodám GoPay, můžeme prodat divadelní představení?"**

**Ano, ale s touto reservou:**

✅ **Plný flow funguje** od kupce po payout — toto je 95 % code základna a vše prošlo testy.

🔴 **3 reálné gaps před live traffic:**
1. **Password reset** — když kupec zapomene heslo, je v háji
2. **Vercel crons** chybí pro release-rolling-reserves a bank-sync-fio
3. **Benefit cards UI** chybí (Pluxee/Sodexo et al) — pokud nebudeš mít B2B segment, nezáleží na tom

Tyto 3 můžu hodit do dalších 2-3 hodin práce. Pak je to skutečně launch-ready.

🟡 **5 things to fix přesto v týden 1:**
- Google Wallet pass
- Auto-settle cron
- DSA report button
- pg_dump backup
- Sentry install

Tedy: **realistický minimum viable launch je dnes wieder 3-5 hodin práce + tvé credentials**. Ne dva týdny, jak by mohlo vypadat při čtení tohoto auditu.

Chceš, abych dotáhl ty 3 blockery (password reset, missing crons, benefit cards UI) hned?
