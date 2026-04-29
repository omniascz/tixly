# Ticketarium — Co chybí do ultimátního systému + pohled do budoucnosti

*Analýza: 14.4.2026 | Na základě kompletního přehledu systému + trendů ticketingového průmyslu 2026–2030*

> Tento dokument identifikuje **mezery v aktuálním plánu**, navrhuje **nové moduly**, které v dokumentu vůbec nejsou, a přidává **budoucnostní vrstvu** — věci, které trh bude vyžadovat za 2–5 let a na které se vyplatí připravit infrastrukturu už teď.

---

## Jak číst tento dokument

| Symbol | Význam |
|--------|--------|
| 🆕 | **Zcela nové** — v dokumentu vůbec nefiguruje |
| 🔧 | **Rozšíření existujícího** — modul existuje, ale chybí důležitá dimenze |
| 🔮 | **Futuristické** — za 2–5 let bude standard, připravit infrastrukturu teď |
| ⚖️ | **Regulatorní** — legislativa vyžaduje nebo brzy bude vyžadovat |

---

## 1. Přístupnost & Inkluze (WCAG / EAA)

| Funkce | Typ | Proč |
|--------|-----|------|
| WCAG 2.1 AA compliance celého checkout flow | 🆕 ⚖️ | European Accessibility Act (EAA) vstupuje v platnost **28. června 2025** — e-commerce a ticketing musí být přístupný. Porušení = pokuty. V dokumentu **nulová zmínka** o accessibility |
| Screen reader kompatibilita seat-mapy | 🆕 | Interaktivní seat-mapa je typicky kompletně nepřístupná pro nevidomé — potřeba alternativní textový výběr |
| Podpora pro wheelchair-accessible sedadla | 🆕 | Filtrace + automatická nabídka companion seat vedle invalidního místa |
| Vícejazyčný checkout (i18n) | 🆕 | V dokumentu **nulová zmínka** o lokalizaci — pro expanzi za CZ/SK kritické |
| Přepis/titulky pro virtuální eventy | 🔧 | `virtual-stream` modul existuje, ale bez live captions / sign language overlay |
| Snadné čtení (Easy Read) režim | 🔮 | Zjednodušený UI pro kognitivně znevýhodněné uživatele |

**Proč teď:** EAA je zákon EU, ne trend. Od poloviny 2025 platí. Každý ticketingový systém prodávající v EU musí splňovat WCAG 2.1 AA. Toto je **největší slepé místo** celého dokumentu.

---

## 2. AI vrstva nové generace

| Funkce | Typ | Proč |
|--------|-----|------|
| AI chatbot pro zákaznickou podporu | 🆕 | Konverzační bot řešící FAQ, status objednávky, refund flow — 24/7 bez CS agenta. Průmyslový standard 2026 |
| AI-powered seat recommendation | 🆕 | Na základě preferencí (blízko baru, daleko od reproduktorů, s výhledem) AI navrhne optimální sedadlo |
| AI generování popisků akcí z metadata | 🔧 | Modul `AI asistent pro tvorbu akce` je plánován, ale rozšířit na auto-generování celé event page z loga + data + žánru |
| Prediktivní no-show model | 🆕 | ML predikce % no-show per akce → umožní over-selling s kontrolou (letecký model) |
| Conversational ticketing ("kup mi lístek přes chat") | 🔮 | Nákup vstupenky přes chat/voice bez prokliku checkoutem — trend 2027+ |
| AI-powered pricing pro resale | 🔧 | `Resale price prediction (ML)` je plánován — rozšířit na dynamic suggested price v reálném čase |
| Sentiment analýza post-event feedbacku | 🆕 | NLP na recenze, komentáře, social mentions → automatický report promotérovi |
| AI agent pro promotéry | 🔮 | Autonomní agent: "Prodej 500 lístků do pátku" → agent sám nastaví ceny, spustí kampaně, optimalizuje |

---

## 3. Blockchain & Web3 vrstva

| Funkce | Typ | Proč |
|--------|-----|------|
| NFT vstupenky (opt-in per event) | 🆕 | Blockchain-verified vstupenky eliminující padělky. Smart contract řídí resale pravidla (price cap, royalties pro umělce). V 2026 už mainstream u velkých platforem |
| Token-gated přístupy a perky | 🆕 | Držitel NFT vstupenky odemkne exkluzivní obsah, merch, VIP upgrade — bez nutnosti dalšího systému |
| NFT sběratelské vstupenky (post-event) | 🆕 | Po akci se vstupenka změní na sběratelský artefakt s fotkami, setlistem — fan engagement + budoucí monetizace |
| NFT membership / season pass | 🔮 | Blockchain season pass s automatickým obnovením, hlasováním o lineupech, celoroční perky |
| On-chain audit trail | 🔮 | Neměnitelný záznam celého životního cyklu vstupenky (vydání → transfer → resale → sken) |

**Poznámka:** Implementovat jako opt-in vrstvu nad existujícím systémem. Uživatel nemusí vědět o blockchainu — platí kartou, dostane email. Blockchain běží pod kapotou.

---

## 4. Gamifikace & Engagement

| Funkce | Typ | Proč |
|--------|-----|------|
| Achievement systém pro fanoušky | 🆕 | "Navštívil 10 koncertů" → badge → reward. Propojení s loyalty points |
| Leaderboard návštěvníků | 🆕 | Top fanoušci per venue/promotér — sociální motivace + VIP nabídky |
| AR scavenger hunt na venue | 🔮 | Mobilní AR hra na festivalu — najdi digitální předměty → výhry (merch, drink) |
| Prediction game ("kdo bude headliner?") | 🆕 | Engagement před akcí — tipy, hlasování, odhadování setlistu |
| Check-in streak bonus | 🆕 | 3 akce v řadě u stejného promotéra → automatický bonus (sleva, early access) |

---

## 5. Sustainability & ESG

| Funkce | Typ | Proč |
|--------|-----|------|
| Carbon footprint kalkulačka per event | 🆕 | Automatický výpočet CO₂ stopy (doprava návštěvníků, energie venue) — pro ESG reporting |
| Carbon offset integrace | 🆕 | Opt-in příplatek při checkoutu na kompenzaci CO₂ (partner: Klima, Cloverly) |
| Paperless dashboard pro promotéry | 🔧 | Metriky: kolik papíru ušetřeno díky digitálním vstupenkám |
| Sustainability badge na event page | 🆕 | Certifikace "Green Event" — vizuální diferenciátor |
| ESG reporting modul pro B2B klienty | 🆕 | Export dat pro firemní ESG reporty — roste poptávka od korporátních klientů |

---

## 6. In-Venue Experience (venue jako platforma)

| Funkce | Typ | Proč |
|--------|-----|------|
| F&B pre-order (jídlo/pití předem) | 🆕 | Objednej si pivo z mobilu ještě před přestávkou → pick-up na stánku. Masivní trend 2026 |
| Cashless payment wristband (RFID/NFC) | 🔧 | V dokumentu zmíněno jako enterprise, ale chybí detailní modul — top-up, balance, refund, reporting |
| In-venue navigation (AR wayfinding) | 🔮 | AR navigace k sedadlu, toaletám, food court — propojení s Apple/Google Maps indoor |
| Real-time queue monitoring | 🆕 | Zobrazení aktuální fronty u stánků / toalet → redistribuce návštěvníků |
| Merch pre-order a pickup | 🆕 | Objednej tričko online, vyzvedni na venue bez fronty |
| Fan cam / live wall | 🔮 | Fotky návštěvníků na velkoplošné obrazovce, řízené přes mobilní app |
| Noise monitoring & compliance | 🔮 | IoT senzory hluku pro compliance s regulacemi (noční klid) — auto-reporting |

---

## 7. Regulatorní compliance (chybí v dokumentu)

| Funkce | Typ | Proč |
|--------|-----|------|
| EU Digital Services Act (DSA) compliance | 🆕 ⚖️ | Jako marketplace musí Ticketarium splňovat DSA — transparentnost, nahlašování obsahu, traceabilita prodejců |
| EU AI Act compliance | 🆕 ⚖️ | Pokud AI určuje ceny (dynamic pricing) → může spadat pod high-risk AI systém → potřeba dokumentace, auditu, human oversight |
| Consumer Rights Directive — 14denní refund | ⚖️ | EU právo na odstoupení od smlouvy — v dokumentu **žádná zmínka** o refund policy engine |
| DORA (Digital Operational Resilience Act) | 🔮 ⚖️ | Pokud Ticketarium zpracovává platby → může spadat pod DORA (financial sector resilience) |
| Účtenka EET / e-kasa kompatibilita | 🆕 ⚖️ | Pro POS box office v CZ/SK nutné napojení na fiskální systém |
| Age verification na akce 18+ | 🆕 | Právní povinnost — automatická kontrola věku (BankID existuje, ale chybí flow pro 18+ eventy) |
| Cookie consent — TCF 2.2 | 🔧 | Modul existuje, ale chybí zmínka o IAB TCF 2.2 standardu pro programmatic advertising |

---

## 8. Rozšíření distribuce & discovery

| Funkce | Typ | Proč |
|--------|-----|------|
| TikTok Shop / Instagram Checkout integrace | 🆕 | Nákup vstupenky přímo v sociální síti bez přesměrování — conversion killer 2026 |
| Google Things to Do integrace | 🆕 | Strukturovaná data pro Google vyhledávání → akce se zobrazí přímo v Google s cenou a "Buy" tlačítkem |
| Apple Maps Guides | 🔮 | Akce viditelné v Apple Maps → nativní integrace pro iOS uživatele |
| Voice commerce (Alexa, Google, Siri) | 🔮 | "Hey Siri, kup mi lístek na Metallicu v Praze" → voice-first nákup |
| Affiliate network s influencery | 🔧 | Affiliate tracking existuje — rozšířit o influencer dashboard, auto-payouts, tracking links s UTM |
| Partnerský widget pro média | 🆕 | Embed widget pro novinové weby (iDNES, Aktuálně) s revenue share |

---

## 9. Pokročilá platební infrastruktura

| Funkce | Typ | Proč |
|--------|-----|------|
| Subscription ticketing ("Netflix model") | 🆕 | Měsíční paušál za X akcí — obrovský retention + prediktabilní revenue pro promotéry |
| Group payment splitting | 🆕 | 5 kamarádů, každý platí svou část — split payment v checkoutu |
| Crypto platby (BTC, ETH, stablecoiny) | 🔮 | Opt-in per promotér — relevantní pro tech/Web3 eventy |
| Deposit / záloha model | 🆕 | Zaplať 30 % teď, zbytek 14 dní před akcí — snížení bariéry pro drahé eventy |
| Automatický refund engine | 🆕 | Pravidla: zrušení akce → auto-refund; změna data → nabídka credit/refund. V dokumentu chybí jakýkoliv refund flow |
| Pay-by-link pro B2B | 🆕 | Vygeneruj platební link a pošli emailem — pro firemní objednávky |

---

## 10. Operační inteligence & monitoring

| Funkce | Typ | Proč |
|--------|-----|------|
| Incident management systém | 🆕 | Hlášení incidentů na venue (zdravotní, bezpečnostní) → log + eskalace + reporting |
| Weather integration s auto-notifikací | 🆕 | Napojení na počasí → automatické upozornění "vezmi si pláštěnku" nebo "akce přesunuta" |
| Crowd density heatmap (real-time) | 🔧 | Real-time occupancy existuje — rozšířit na vizuální heatmapu po zónách |
| Predictive crowd flow model | 🔮 | ML predikce přetížených míst → proaktivní přesměrování (digital signage, push notifikace) |
| Automated capacity alerts | 🆕 | 90 % zóny plné → alert security + auto-uzavření prodeje dané zóny |
| Post-mortem generator | 🆕 | Automatický report po akci: co šlo dobře, co ne, srovnání s predikcí |

---

## 11. Rozšíření developer platformy

| Funkce | Typ | Proč |
|--------|-----|------|
| Marketplace pro pluginy / rozšíření | 🆕 | Third-party vývojáři tvoří pluginy (CRM konektory, custom reports) — ekosystém kolem platformy |
| Low-code automation builder | 🆕 | Promotér si sám nastaví "když se prodá 80 %, zvyš cenu o 10 %" bez kódu |
| GraphQL API | 🔧 | REST API existuje — přidat GraphQL pro flexibilní frontend queries |
| Event-driven architecture (pub/sub) | 🔧 | Kafka je v env vars — ale chybí dokumentace a standardní event catalog pro integrátory |
| CLI nástroj pro promotéry | 🔮 | `ticketarium events create --name "Koncert" --date 2026-06-01` — power user workflow |

---

## 12. Data & Privacy — rozšíření

| Funkce | Typ | Proč |
|--------|-----|------|
| Data clean room pro sponzory | 🔮 | Sponzoři se dotážou na agregovaná data bez přístupu k PII — privacy-preserving analytics |
| Consent management platform (CMP) | 🔧 | Cookie consent existuje, ale potřeba plnohodnotný CMP s granulárním souhlasem per účel |
| Data portability (GDPR Art. 20) | 🆕 | Export všech dat zákazníka ve strojově čitelném formátu — v dokumentu zmíněn GDPR export v identity-verification, ale ne jako standalone feature |
| Anonymizovaný analytics mód | 🆕 | Pro promotéry, kteří chtějí analytics bez sbírání PII (privacy-first trend) |
| Right to explanation (AI Act) | 🔮 ⚖️ | Pokud AI rozhoduje o ceně → zákazník má právo vědět proč. Potřeba explainability vrstvy nad dynamic pricing |

---

## 13. Komunikační kanály — rozšíření

| Funkce | Typ | Proč |
|--------|-----|------|
| WhatsApp Business API | 🆕 | Potvrzení objednávky, boarding pass, customer support přes WhatsApp — v CZ/SK roste adoption |
| RCS messaging (Rich Communication Services) | 🔮 | Nástupce SMS — rich karty, tlačítka, karusel přímo v nativní SMS app |
| In-app messaging (customer ↔ promotér) | 🆕 | Přímá komunikace mezi kupujícím a pořadatelem bez emailu |
| Automatické video pozvánky | 🔮 | AI generuje krátké video pozvánky z event dat → sdílení na sociální sítě |

---

## 14. Vertikály — co chybí

| Vertikála | Typ | Proč |
|-----------|-----|------|
| Muzea a galerie (timed entry + audio guide) | 🆕 | `slot-engine` existuje orphan — propojit s audio guide upsell |
| Zoo a botanické zahrady | 🆕 | Timed entry + rodinné balíčky + membership |
| Konferenční vertikála (end-to-end) | 🔧 | Orphan moduly `conference` + `conference-badges` + `conference-exhibitors` — chybí: networking matching, session voting, speaker management, sponsor tiers |
| E-sport turnaje | 🆕 | Specifika: online + offline hybridní akce, team registrace, bracket systém |
| Charitativní akce / galavečery | 🆕 | Specifika: aukce, donation tracking, sponzorské stoly, darovací potvrzení |
| Svatby a privátní akce | 🔮 | RSVP management, seating plan, dietary preferences — nový segment |
| Sportovní ligy (celosezonní) | 🔧 | Season passes existují — ale chybí league management, tabulka, propojení s play-off |

---

## 15. Infrastruktura — kritické mezery

| Funkce | Typ | Proč |
|--------|-----|------|
| Multi-region deployment | 🆕 | Pro GDPR compliance data residency — EU data v EU, US data v US |
| Disaster recovery plan | 🆕 | V dokumentu: backup zmíněn, ale žádný DR plán (RTO, RPO definice) |
| Feature flags systém | 🆕 | Postupné rollout nových features per tenant — bez toho nelze bezpečně nasazovat |
| Canary deployment | 🔮 | Nová verze nejprve na 5 % traffic → monitoring → full rollout |
| Observability stack (traces + metrics + logs) | 🔧 | Sentry zmíněn pro errors — ale chybí distributed tracing (Jaeger/OpenTelemetry) a metriky (Prometheus/Grafana) |
| Rate limiting per tenant | 🔧 | Redis rate limiting existuje — ale je per-route, ne per-tenant. Důležité pro fair use v multi-tenant |
| Database connection pooling (PgBouncer) | 🆕 | Pro high-concurrency (vyprodej 10K za 60 s) kritické — v dokumentu chybí |
| Edge caching (CDN pro API) | 🆕 | Statické responses (event detail, seat-mapa) z CDN edge → nižší latence, nižší load |
| Blue-green deployment | 🆕 | Zero-downtime deploy — pro ticketing platformu, kde výpadek = ztráta revenue, je to must-have |

---

## Prioritizace — co implementovat kdy

### Fáze 0: Před go-live (BLOKERY)

1. **WCAG 2.1 AA compliance** — zákonná povinnost EAA
2. **Refund engine** — bez toho nelze provozovat e-commerce v EU
3. **i18n / lokalizace** — minimum CZ + EN
4. **Age verification flow** — pro 18+ akce
5. **Feature flags** — bezpečné nasazování
6. **Blue-green deployment** — zero-downtime

### Fáze 1: Prvních 6 měsíců po launchi

7. AI chatbot pro customer support
8. WhatsApp Business notifikace
9. F&B pre-order (pro festival klienty)
10. Google Things to Do integrace
11. Group payment splitting
12. Subscription ticketing (pilot)
13. Automatický refund engine s pravidly
14. Weather integration

### Fáze 2: 6–18 měsíců

15. NFT vstupenky (opt-in)
16. Gamifikace (achievements, streaky)
17. Marketplace pro pluginy
18. Low-code automation builder
19. Carbon footprint kalkulačka
20. AI seat recommendation
21. TikTok / Instagram checkout
22. Data clean room pro sponzory
23. Incident management

### Fáze 3: 18–36 měsíců (budoucnostní)

24. Conversational ticketing (voice/chat nákup)
25. AR wayfinding na venue
26. Predictive crowd flow
27. AI agent pro promotéry
28. Voice commerce integrace
29. RCS messaging
30. Subscription model plně rozvinutý

---

## Shrnutí největších slepých míst

Dokument je velmi solidní a pokrývá obrovskou šíři. Ale **5 kritických oblastí zcela chybí**:

1. **Přístupnost (Accessibility / WCAG)** — nulová zmínka v celém dokumentu. S EAA to je právní riziko #1.

2. **Refund / cancellation engine** — systém má platby, ale žádný strukturovaný refund flow s pravidly, auto-refund při zrušení akce, partial refund.

3. **Lokalizace (i18n)** — pro systém s ambicí být platformou chybí jakákoliv zmínka o vícejazyčnosti.

4. **Regulatorní compliance** — DSA, AI Act, EAA, Consumer Rights Directive — žádný z těchto EU regulací není adresován.

5. **In-venue experience** — dokument se soustředí na "před akcí" (nákup) a "při vstupu" (sken), ale téměř vůbec neřeší "během akce" (F&B, navigace, engagement).

---

*Tento dokument je doplněk k hlavnímu přehledu systému. Doporučuji integrovat relevantní položky zpět do TODO.md.*
