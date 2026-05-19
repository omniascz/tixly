# GoOut — kompletní feature audit (analýza, ne implementace)

**Sestaveno:** 2026-05-20
**Zdroje:** goout.net, terms.goout.net, docs.goout.net, App Store, Google Play, recenze, smlouvy v registru, CzechCrunch, Revolgy case study, kckamenice.cz, novaspirala.cz
**Cíl:** identifikovat KAŽDOU funkci GoOut, i tu nejmenší, pro budoucí rozhodnutí "kde investovat dohánět"

> **Pozn.:** Tento dokument se opírá o veřejně dostupné zdroje. Některé interní funkce
> GoOut admina lze odhadnout jen z dokumentace ("upon request" features). Označeno 🔒 = inferred/uncertain.

---

## 1. Společnost & ekonomika

| Faktor | Hodnota |
|---|---|
| Země | Česko + Slovensko + Polsko + Německo (postupně) |
| Sídlo | Praha (PLG Czech Republic s.r.o.) + Bratislava + Varšava |
| Vlastnictví | Stejná skupina co koupila Ticketportal (CzechCrunch 2024) |
| Customer support | Po–Pá ve všech regionech |
| Infrastruktura | Google Cloud, autoscaling (Revolgy case study) |
| Cloud stack | GKE, GCS, BigQuery, Dataflow, Pub/Sub |

## 2. Ceník — pořadatel (CZ)

| Položka | Cena |
|---|---|
| **Provize z prodané vstupenky** | **5 %** + DPH (oficiální smlouvy registr smluv) |
| (Historicky uváděno) | 7-8 % + min. 5 Kč/vstupenku |
| **Service fee za order** | 15 Kč (paušál, bez ohledu na velikost objednávky) |
| **Refund admin fee** | 2 % z ceny vstupenky (platí pořadatel za každou refundovanou) |
| Customer-side fee | ~20 Kč při typické objednávce 2× 800 Kč |
| Min. ticket fee | 5 Kč/vstupenku (historický plán) |

**Tixly vs GoOut srovnání ceny pro pořadatele:**
GoOut bere 5 % + paušál 15 Kč/order + 2 % per refund. Tixly v M1 nestanovuje
oficiální pricing — měli bychom **5 % nebo méně** abychom byli kompetitivní.

## 3. Discovery / buyer flow (web + app)

### Web (goout.net)
- Multi-jazyčné: CS, SK, EN, DE, PL
- Hlavní kategorie: hudba, party, klubové, divadlo, výstavy, kino, sport, dětské, festivaly, talk shows, workshops
- Lokality: města + venues + spádové oblasti
- Datum filtry: dnes, víkend, kdykoliv, kalendář
- Cenové filtry: free, do 500 Kč, do 1000 Kč, atd.
- Online stream události — vlastní kategorie
- Featured / doporučené (curated editorial)
- "Online — Upcoming events" landing pages per kategorii
- Custom kampaňové landing pages (festivaly cluster)
- SEO: stovky URL per akce/artist/venue
- Sharing: FB, Twitter, kopie URL, dříve i Pinterest
- Open Graph + Twitter Card metadata

### Buyer mobile app (iOS + Android)
**Discovery:**
- Personal feed (preference based on interests)
- Search (s historií crashe — komplaint v review)
- Filter: kategorie, město, datum, cena
- Mapa akcí (geo location)

**User account:**
- Saved/favorite events
- Follow artists + venues → notifikace při novém datu
- Notifications (push)
- Share to social media

**Tickets:**
- In-app purchase
- Digital tickets stored v účtu
- QR code scan-ready při vstupu
- Calendar export

**Online events:**
- YouTube streams in-app
- Lectures, digital workshops

**Languages:** CS, SK, EN, DE, PL

**Recenze (komplainty):**
- Search padá (opakovaně 2019-2023)
- Saved events mizí po update
- Streaming ticket UX problematic
- Multiple login methods → duplicate accounts

## 4. Pořadatel admin — features (z `goout.net/cs/pro-poradatele/funkce/`)

### A. Správa akcí
- **Akce všech formátů** — koncert, divadlo, výstava, sport, festival, online
- **Více typů vstupenek na jednu akci** — single-day, multi-day, VIP, sleva pro děti/studenty/seniory
- **Multi-day events** podporované nativně
- **Online streamy** s YouTube/vlastní player
- 🔒 **Recurring events** (divadelní repríza, weekly workshops) — implicitní z platform
- 🔒 **Cancel + reschedule flow** — viz refund policy

### B. Prodej vstupenek
- **GoOut Marketplace** — listing na goout.net, mobile app, partner sítí
- **Vlastní web (widgety)** — embed na promotérův web, customizovatelné v adminu
- **GoOut box office** — fyzická síť poboček (převzato po akvizici Ticketportal)
- **Platby**: karta, převod, faktura, Twisto (BNPL)
- **Employee benefits**: Pluxee (Sodexo), eBenefity, Edenred, Benefity, Benefit Plus
- **Cizí měna** — CZK, EUR, PLN podle země eventu

### C. Vouchers / dárkové poukazy
- Pre-paid voucher purchase
- 1 rok od nákupu validní
- Použitelný **opakovaně** dokud nevyčerpán balance (partial use)
- Limit na CZ akce (regional restriction)
- 🔒 Dárkové designy (různé motivy)
- 🔒 Custom branded vouchers pro pořadatele

### D. Slevové kódy
- Promo codes (OFF5 = 5 %, LLAF = 10 %)
- 🔒 Per-event nebo globální
- 🔒 Single-use vs multi-use
- 🔒 Limit počtu použití
- 🔒 Limit per zákazník

### E. Refund + storno
- Změna termínu → refund nebo voucher
- Zrušení akce → refund nebo voucher (5 pracovních dnů)
- Force majeure → pouze voucher
- Nedoručení → refund do 30 dnů
- **Refund admin fee 2 %** platí pořadatel
- Refund jen do výše co GoOut má (zbytek = zodpovědnost pořadatele)
- Žádné 14-day cooling-off (kvalifikováno jako "volnočasová služba")

### F. Hosté / guestlist
- **Guestlist** — promotér přidá hosty v admin
- Hosté dostanou **elektronické pozvánky ve formátu vstupenek**
- Validace stejně jako placené vstupenky
- Vyřeší papírovou listy hostů
- 🔒 RSVP / confirm před vstupem

### G. Scanner / odbavení
- **GoOut Scanner app** (separátní iOS + Android, 10K+ stažení Android)
- Skenuje **QR i čárové kódy** kamerou
- **Manuál focus** (tap na obrazovku)
- **Lupa / manual lookup** — pro případy kdy zákazník nemá kód
- **Update ticket database** (sync offline → online)
- 🔒 Multi-event handling (jeden scanner pro více akcí)
- 🔒 Multi-day re-entry tracking
- 🔒 Zone/gate handling (VIP entry vs general)
- **Hardware podpora** — možnost zapůjčit speciální čtečky
- **Real-time monitoring** — promotér vidí stav odbavení v admin
- Hodnocení 3.8★ (Android), 46 recenzí

### H. Marketing (in-house service)
- **Vlastní marketing oddělení** v GoOut spravuje propagaci
- **Social media** management (FB, Instagram, TikTok)
- **Recommended events** na homepage + per-category
- **Newsletter** s curated výběrem akcí
- **Push notifications** přes mobile app
- **Editorial content** — články, doporučení, "Tip dne"
- **Data analytics** — sběr a analýza pro pořadatele
- **Meta Pixel + TikTok Pixel** integrace (sledování konverzí pořadatele)

### I. Sedačky / sály
- **Seating chart** podpora v adminu
- **Sektory + řady + sedadla**
- **Cenové kategorie per sekce**
- 🔒 Drag-drop editor (nepotvrzeno, ale standard)
- 🔒 Auto-import z existujících sálů (templates pro velké venues)

### J. Widgety / embed
- **Static widgets** na vlastní web pořadatele
- **Customizable v admin interface**
- Embed: nákupní formulář, seznam akcí, jednotlivá akce
- iFrame-based

### K. Customer support pro pořadatele
- **Onboarding contact** — GoOut tým kontaktuje po registraci
- "Most features quick and easy to implement upon request"
- Některé funkce **on-request** (ne self-service)
- Po-Pá customer support

### L. Statistiky a exporty
- 🔒 Sales dashboard (běžné u všech ticketingovek)
- 🔒 Sales per ticket_type, per time period
- 🔒 Export CSV pro účetnictví
- 🔒 PDF daňové doklady
- **Účetní manuál** dostupný v dokumentaci
- 🔒 Payouts s breakdown DPH

### M. Payout proces
- GoOut **odečte provizi z prodaných vstupenek** PŘED převodem pořadateli
- 🔒 Payout schedule: měsíční / po akci (standard)
- 🔒 Hold-back rezerva proti refundům

### N. Bezpečnost + legal
- "Maximum safety and legal protection"
- 🔒 Anti-fraud detection
- 🔒 Bot protection při velkém demand
- GDPR compliance (povinné EU)

## 5. Co GoOut **NEPODPORUJE** (nebo nejasné)

- ❌ **Public API pro pořadatele** (žádná zmínka, ne API doc)
- ❌ **Outbound webhooks** (žádná zmínka)
- ❌ **Zapier / MailChimp native integration**
- ❌ **A/B test email subjects** (in-house marketing, ne self-service)
- ❌ **White-label .com domena** pro pořadatele
- ❌ **Apple/Google Wallet pass** (jen in-app + email)
- ❌ **Account-to-account ticket transfer** (refund only)
- ❌ **P2P resale marketplace** (face-value cap) — žádná zmínka
- ❌ **ISDOC / Pohoda export** — jen CSV
- ❌ **Subscription / divadelní abonentka** — žádná zmínka (divadla mají vlastní `abonentka.eu`)
- ❌ **Dynamic pricing**
- ❌ **Verified Fan / lottery drops** (anti-bot pre-sale)
- ❌ **Multi-tenant data sovereignty** — GoOut je aggregator, vlastní customer data

## 6. GoOut konkurenční výhody

### Co GoOut dělá silně:
1. **Editorial discovery moat** — newsletter, články, "Tip dne", curated featured. **Roky budovaný content**.
2. **Marketing as-a-service** — pořadatel nemusí dělat reklamu, GoOut to dělá za něj (in-house team).
3. **Aggregator + box office** — síť poboček + online (akvizice Ticketportal).
4. **Mobile app first** — silná iOS+Android s notifikacemi.
5. **Cross-border** — CZ+SK+PL+DE jednotná platforma (Tixly aktuálně CZ+SK).
6. **Employee benefits integration** — Pluxee, Edenred, Benefity, atd. (B2B sales channel).
7. **Brand recognition** — top-of-mind pro Gen Z + Gen Y v CZ.
8. **Twisto BNPL** — split na splátky.

### Co GoOut dělá slabě:
1. **API zero** — žádný developer access pro pořadatele.
2. **Aggregator model** — pořadatel nemá vlastní data CRM.
3. **Mobile app crashes** (search v recenzích opakovaně).
4. **Account confusion** (multiple login methods → duplicate users).
5. **Branding limit** — pořadatel je listing v marketplace, ne vlastník storefrontu.
6. **Refund 2 % platí pořadatel** — drahé pro promotéry s vysokým refund ratio.

## 7. End-to-end flows GoOut (popis)

### Buyer flow
```
1. goout.net (web/app) → procházení kategorií / search
2. Klik na event → detail page (Open Graph, recommended similar)
3. "Koupit" → výběr ticket type → quantity
4. Cart → osobní údaje (email, telefon)
5. Platba: karta / převod / Twisto / employee benefit
6. Confirmation email + ticket QR PDF
7. Mobile app sync — ticket v účtu
8. Den akce → push reminder
9. Venue → scanner → admittance
```

### Organizer onboarding flow
```
1. Self-register na goout.net/pro-poradatele
2. GoOut team kontaktuje (manuální approval)
3. Smlouva (5 % provize + 15 Kč/order + 2 % refund fee)
4. Admin access → vytvoření akce
5. Setup: kategorie, datum, sál, ticket types, prices
6. Hosté → guestlist (volitelné)
7. Seating chart (pokud sál seated)
8. Publish → goout.net + mobile app
9. Marketing (GoOut team optional)
10. Den akce → Scanner app
11. Po akci → payout (commission odečten)
```

### Scanner flow
```
1. Pořadatel stáhne GoOut Scanner z App Store / Play Store
2. Login admin credentials
3. Vybere konkrétní akci → sync database
4. Kamera otevřena → focus tap
5. Scan QR / barcode → real-time validace proti DB
6. ✅ admit / ❌ already used / 🟡 manual check needed
7. Manual lookup (lupa) pokud kód unreadable
8. End of event → statistika v adminu
```

### Refund flow
```
1. Zákazník: žádost o refund (email / app)
2. GoOut posoudí dle pravidel:
   - Změna termínu → refund/voucher
   - Zrušení → refund/voucher
   - Force majeure → voucher only
   - "Nepřišel jsem" → ŽÁDNÝ refund (kvalifikace volnočasová)
3. Pořadatel notifikován
4. Refund processed = pořadatel zaplatí 2 % admin fee
5. Buyer dostane peníze / voucher
```

## 8. Tixly vs GoOut — kde jsme nad / pod

### Tixly NAD GoOut (kde jsme silní):
1. ✅ **Multi-tenant SaaS** — pořadatel vlastní data, ne aggregator
2. ✅ **Public B2B API** s scope-based authorization
3. ✅ **Outbound webhooks** subscriptions
4. ✅ **ISDOC export** pro Pohoda/Money S3 — GoOut nemá
5. ✅ **Apple/Google Wallet pass** generator
6. ✅ **Account-to-account transfer**
7. ✅ **P2P resale marketplace** (refund→re-release)
8. ✅ **Audience segmentation 6 dimenzí** + smart-send-time
9. ✅ **DSA Act 2024 compliance** s human moderation queue
10. ✅ **AI moderation gate** (Claude API)
11. ✅ **Per-tenant rate limit** + DR runbook
12. ✅ **Custom seating editor** s overlap detection (audit kvality)
13. ✅ **Embed widget** pro promoter agenda (ne jen event)
14. ✅ **Affiliate / referral codes** native
15. ✅ **Marketplace ads** (CPC slots) — sales channel pro pořadatele
16. ✅ **PWA scanner offline** + offline queue (Tixly umí offline)

### Tixly POD GoOut (kde dohánět):
1. ❌ **Native mobile buyer app** (iOS + Android) — GoOut má, Tixly ne. **P0 post-launch**.
2. ❌ **Native scanner mobile app s KAMEROU** — Tixly má jen text input + USB scanner. **P0**.
3. ❌ **Editorial / curated discovery** — newsletter, "Tip dne", featured. **P1 content moat**.
4. ❌ **Marketing as-a-service** — GoOut má in-house team. **P3 (vyžaduje lidi, ne kód)**.
5. ❌ **Cross-border CZ+SK+PL+DE** — Tixly CZ+SK only. **P2 PL+DE**.
6. ❌ **Employee benefits integration** — Pluxee, Edenred, Benefity. **P1 B2B channel**.
7. ❌ **Twisto BNPL** — split payment. **P1**.
8. ❌ **Brand recognition** — GoOut top-of-mind. **P3 (marketing budget, ne kód)**.
9. ❌ **Box office network** — fyzické pobočky. **P3 (akvizice, ne organic)**.
10. ❌ **Custom branded vouchers** pro pořadatele — máme generic, ne per-promoter design.
11. ❌ **Push notifikace** — backend máme, native app ne.
12. ❌ **RSVP "I'm going"** — bez nákupu interest signal.
13. ❌ **Friends / social features**.

## 9. Co Tixly dělá lépe + lze využít jako sales pitch

Pro promotéra naznačit:
> "U GoOut jste host v aggregatoru. U Tixly máte vlastní brand, vlastní CRM,
> vlastní data. ISDOC export importujete přímo do Pohody. API + webhooks
> propojíte s vaším marketing stackem. Refund engine vám neúčtuje 2 % fee."

**Sales tagline:** *"Tixly = váš ticketing, váš brand, vaše data."*

## 10. Doporučení — okamžité akce

### Před launchem (kritické)
1. **Camera-based QR scanner v PWA** — `html5-qrcode` lib, ~1 den práce.
   Aktuálně Tixly umí jen text input — pořadatel nemůže reálně skenovat iPhone kamerou.
2. **Push notifikace browser** — i bez native app, Web Push API.
3. **Custom branded voucher design** — pořadatel nahraje PNG, generujeme branded PDF voucher.

### 30 dní po launchi
1. **Twisto BNPL integration** — split into 3 / odložit platbu 30 dní (CZ standard).
2. **Pluxee + Edenred + Benefity** employee benefit payment methods.
3. **Curated editorial section** — "Tipy redakce" landing page (manual curation).
4. **Newsletter weekly** s curated výběrem akcí napříč promotéry.

### 90 dní
1. **Native mobile buyer app** (React Native) — 4-6 týdnů. **GoOut killer**.
2. **Native scanner mobile app** se zone management + reentry.
3. **PL + DE lokalizace** + currency PLN/EUR.

### Co NEDĚLÁME (vědomě)
- ❌ Aggregator model (GoOut už dominuje, nedoženeme)
- ❌ Box office network (CapEx-heavy, ne software hra)
- ❌ In-house marketing team (Tixly = SaaS, ne agency)
- ❌ Brand awareness kampaň pre-launch (rozpočet jinam)

---

## Sources

- [GoOut for promoters (Czech)](https://goout.net/cs/pro-poradatele/funkce/)
- [GoOut for promoters (EN)](https://goout.net/en/for-promoters/)
- [GoOut buyer app — App Store](https://apps.apple.com/us/app/goout-your-cultural-guide/id1151779596)
- [GoOut Scanner app — App Store](https://apps.apple.com/cz/app/goout-scanner/id1495536210?l=cs)
- [GoOut Scanner — Google Play](https://play.google.com/store/apps/details?id=net.goout.scanner&hl=en_US)
- [About GoOut](https://goout.net/en/about/)
- [Terms for partners](https://goout.net/en/terms-for-partners/)
- [Pravidla prodeje vstupenek (kckamenice.cz)](https://kckamenice.cz/pravidla-prodeje-vstupenek-goout/)
- [GoOut + Ticketportal akvizice (CzechCrunch)](https://cc.cz/za-stamiliony-koupili-goout-i-ticketportal-a-ovladli-cesko-ne-vsichni-preziji-rika-jejich-sef/)
- [Smlouva v registru smluv (gov.cz)](https://smlouvy.gov.cz/smlouva/soubor/9522671/SMLOUVA_GO_OUT.PDF)
- [GoOut na Google Cloud (Revolgy case study)](https://www.revolgy.com/case-studies/goout)
- [Crunchbase profile](https://www.crunchbase.com/organization/goout)

**Audit log:** v1 vytvořeno 2026-05-20 — Omnia + Claude. Aktualizovat kvartálně.
