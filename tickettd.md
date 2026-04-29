# Tixly — Analýza mezer (z "to do ticket.xlsx")
*Porovnání původní analýzy s aktuálním stavem TODO.md | Aktualizováno: 2026-04-14*

---

## P1 — Nutné pro spuštění

| # | Oblast | Co chybělo | Stav dnes |
|---|--------|------------|-----------|
| 1 | *(první položka chybí v exportu)* | — | — |
| 2 | Platební brána — Stripe/Adyen | GoPay jen CZ/SK, pro EU expanzi nutný Stripe nebo Adyen | 🟡 `stripe-payments` modul existuje, není finalizován (#109) |
| 3 | Apple Pay / Google Pay | Na mobilech standard, integrace v checkoutu chybí | ❌ není v projektu |
| 4 | Mobilní QR check-in PWA | Backend pro sken existuje, chybí PWA (offline, multi-device) | 🟡 `scanner-pwa` + `mobile-scanner` — chybí dokončení routes (#9) |
| 6 | Resale marketplace — escrow flow | Platba → hold → transfer → release, fee splitting | ✅ `resale-api` hotovo (#22) |
| 7 | Affiliates & promo kódy | UTM + provize, referral program | ✅ `affiliate-tracking` + `promo-codes` hotovo (#55, #16) |
| 8 | Multi-měna | CZK only, chybí FX conversion layer | 🟡 modul hotov, chybí napojení na checkout (#108) |
| 10 | Email notifikace (transactional) | Potvrzení objednávky, vstupenka v příloze, refund | ❌ Amazon SES setup chybí (#1 v TODO) |

---

## P2 — Důležité (do 6 měsíců)

| # | Oblast | Co chybělo | Stav dnes |
|---|--------|------------|-----------|
| 11 | Sezónní permanentky (Season Passes) | DB schéma passes existuje, API a frontend flow chybí. Klíčové pro sport (fotbal, hokej). | ✅ `season-passes` + `permanentky` hotovo (#53) |
| 12 | Fanklub / presale fronty | Pre-sale kódy pro fankluby, priority access, invitation-only | ✅ `verified-fan` + `presale-access` hotovo (#44, #49) |
| 13 | Upsell & add-ons | Parkovné, merch, meet & greet, VIP balíčky v checkoutu | ✅ `upsell-engine` hotovo (#57) |
| 14 | B2B / Corporate tickets | Fakturace na firmu, hromadný import emailů, delegování vstupenek | ✅ `b2b-api` + `corporate-benefits` hotovo (#41, #118) |
| 15 | Bundle / Package tickets | Balíčky více akcí za zvýhodněnou cenu (festival, muzejní noc) | ✅ `packages-v2` hotovo (#72) |
| 16 | Dynamické ceny | Cena roste jak se zaplňuje kapacita (SeatGeek, AXS model) | ✅ `ai-dynamic-pricing` + `pricing-engine` hotovo (#87, #31) |
| 17 | Čekací listina (Waitlist) | Automatické notifikace + nákup po zrušení vstupenky | 🟡 watchlist v `resale-api` — routes neověřeny (#23) |
| 18 | Zákaznická podpora (helpdesk) | Ticket system, live chat, FAQ | ❌ není v projektu |
| 19 | Eventim XML/API export | Pořadatelé v CZ exportují do Eventim.cz — kompatibilní formát | ❌ není v projektu |
| 20 | Goout embed widget / embedded checkout | Pořadatel si vloží iframe na vlastní web | ✅ `embed-widget` hotovo (#59) |

---

## P3 — Diferenciátory (6–18 měsíců)

| # | Oblast | Co chybělo | Stav dnes |
|---|--------|------------|-----------|
| 21 | NFT vstupenky / blockchain | AXS, GET Protocol — digitální vlastnictví | ❌ mimo scope (Faze 13+) |
| 22 | Fan-to-fan verified resale | GDPR-compliant, cena capped na 110–130 % dle EU regulace | 🟡 `resale-api` existuje, verified resale flow neúplný |
| 23 | Live streaming integrace | Hybridní akce (in-person + stream), separátní ticket typy | 🟡 `virtual-stream` jako orphan modul |
| 24 | Loyalty / body systém | Sbírání bodů za nákupy, tier systém | ✅ `loyalty-points` hotovo (#54) |
| 25 | AI recommendation | "Mohlo by se ti líbit" na základě nákupní historie | 🟡 `recommendation-engine` — 1 test, nedokončeno (#88) |
| 26 | Accessibility features | Místa pro vozíčkáře, companion tickets, audio deskripce (právní povinnost EU) | ❌ není v projektu |
| 27 | Box office / POS terminál | Fyzický prodej přes tablet + card terminal (Stripe Terminal, SumUp) | ❌ není v projektu |
| 28 | Multichannel distribuce | Prodej přes Goout, Eventim, SMSticket (inventory sync) | ❌ není v projektu |
| 29 | GDPR Consent Management Platform | Granulární souhlas, cookie wall, export dat zákazníka | 🟡 `cookie-consent` modul hotov (#111) |
| 30 | Elasticsearch / full-text search | Rychlé hledání akcí podle názvu, místa, interpreta | ❌ zatím PostgreSQL FTS |

---

## Infrastruktura & Ops (průřezové)

| # | Co chybí | Stav dnes |
|---|----------|-----------|
| 31 | **Admin UI frontend** (React/Next.js) pro master admina a pořadatele | ❌ celý backend hotov, **frontend neexistuje** |
| 32 | CI/CD pipeline — GitHub Actions, staging, E2E testy (Playwright) | ❌ není |
| 33 | Monitoring & alerting — Datadog/Grafana, Sentry | ❌ Sentry setup zbývá (#17 v TODO) |
| 34 | Multi-tenant subdomain routing — `{slug}.tixly.cz` | 🟡 `white-label` + `tenant-runtime-config` existují |
| 35 | Load testing — k6 / Artillery před vyprodej-events | ❌ není |
| 36 | SOC 2 / ISO 27001 — nutné pro enterprise a bankovní partnery | ❌ není |

---

## Shrnutí

> *"Backend a business logika jsou z velké části hotové. Největší mezery jsou v admin UI frontendu, interaktivní mapě sedadel, kompletním resale flow, self-service onboardingu pořadatele a multi-měnové platební bráně."*
> — původní analýza

**Co se od té doby vyřešilo:** permanentky, upsell, packages, resale API, B2B, dynamic pricing, promo kódy, affiliate tracking, verified fan, embed widget, loyalty points a desítky dalších modulů.

**Co stále chybí před GO LIVE:**
1. **Admin UI frontend** — největší mezera, celý backend bez rozhraní
2. **Apple Pay / Google Pay** — v checkoutu chybí
3. **Amazon SES** — bez toho nejdou transakční emaily (#1 v TODO)
4. **Stripe finalizace** — modul existuje, není napojen (#109)
5. **CI/CD + monitoring** — Sentry (#17), backup (#18)
6. **Multi-měna napojení na checkout** (#108)
7. **Scanner PWA dokončení** (#9)
