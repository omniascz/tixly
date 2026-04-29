# Tixly — Strategické nápady a rozvojové větve

> Vygenerováno: 6.4.2026  
> Účel: Přehled potenciálních rozšíření platformy mimo aktuální roadmapu

---

## 1. SOCIÁLNÍ A KOMUNITNÍ VRSTVA

### Koordinace skupin
- "Jdeme společně" — friend group, jeden platí za všechny nebo každý sám, ale vstupenky jsou propojené (sedíte vedle sebe, check-in společně)
- Social proof v nákupu: *"17 lidí z tvé sítě tam jde"*
- Skupinové rozhodování: hlasování kde jít (jako Doodle, ale pro výběr akce)
- Carpooling modul — nabídka/poptávka míst v autě na akci

### Fan community
- Profil fanouška — history + wishlist + oblíbení interpreti/týmy
- Follow systém: sleduj promotéra/venue/interpreta → automatický presale přístup
- Post-event reviews a hodnocení (strukturované, ne jen hvězdičky)
- Fan-to-fan interakce: swapování míst, hledání doprovodu

### Paměť a vzpomínky
- "Moje akce" jako timeline, ne jen seznam
- Automatické shrnutí roku (Spotify Wrapped pro live zážitky)
- Sdílení na sociální sítě s branded kartičkou události

---

## 2. ZÁŽITKOVÝ EKOSYSTÉM KOLEM EVENTU

### Před akcí
- Parking rezervace propojená s vstupenkou (venue vlastní parkoviště nebo API na Parking.cz)
- Transport bundle — vstupenka + vlak/bus + parkování v jednom checkout
- Restaurace poblíž — rezervace stolu na předakci (affiliate nebo vlastní modul)
- Pre-event merch preorder — vyzvedneš na místě, bez fronty

### Během akce
- Food & beverage ordering z mobilní aplikace (skip the queue, přinesou k sedadlu)
- Seat upgrade bidding — hodinu před akcí nabídni lepší místa aukčně
- Interactive program — klikatelný program, setlist, speaker bios
- Live polling / Q&A pro konference a workshopy

### Po akci
- Post-event foto/video galerie (upload od pořadatele i fanoušků)
- Certifikát účasti (PDF/wallet, relevantní pro konference a CPD)
- Automatický follow-up: "Příště tento interpret hraje..."
- Survey/feedback loop pro pořadatele

---

## 3. FINANČNÍ A MONETIZAČNÍ INOVACE

### Nové cenové modely
- **Group buying / Skupinový nákup** — pokud koupí 10+ lidí, cena klesne o 15 % (Groupon logika, ale pro legitimní eventy)
- **Pay-what-you-want** — slider s minimem (charity eventy, indie umělci)
- **Crowdfunding eventi** — akce se uskuteční jen pokud se prodá X vstupenek do data D (jako Kickstarter)
- **Dutch auction** — vstupenky startují vysoko, cena klesá dokud se neprodají (clearing price)
- **Patronáž** — měsíční podpora umělce/venue výměnou za exkluzivní přístup

### B2B finanční produkty
- **Korporátní entertainment** — firma koupí vstupenky pro tým/klienty, centrální faktura, správa přiřazení zaměstnancům
- **Revenue advance** — platforma půjčí promotérovi předem (např. 50 % z odhadovaných tržeb) a strhává z prodeje (Stripe Capital model)
- **Event pojištění pro pořadatele** — pojistka proti zrušení, výpadku účinkujícího, špatnému počasí
- **Dynamic cashback** — místo slevy kupující dostávají cashback body s expirací, čímž se přimějí koupit znovu

---

## 4. AI / PERSONALIZACE (hlouběji)

### Kontext-aware doporučení
- Počasí + nálada + lokace + čas → "Dnes večer je krásně, jdi na open-air" (push notifikace)
- Životní události — narozeniny přítele → návrh dárku (zážitek)
- Mood engine — uživatel si vybere náladu, systém navrhne typ akce

### AI pro pořadatele
- Automatický copywriting: popis akce, push notifikace texty, e-maily (GPT backend)
- Optimal venue capacity — predikce pro daný event, doporučení jak nastavit kapacitu
- Competitor intelligence — scraping veřejných dat + alert "v tento datum hraje X v sousedním městě"
- Automatický A/B test cen — platforma testuje 2 ceny a po 48h vyhodnotí

### Fraud detection (AI vrstva nad rule-based enginem)
- Anomaly detection na behaviorální vzorce (ne jen velocity)
- Graph analytics — sítě propojených podezřelých účtů
- Natural language screening — detekce podezřelých popisů a komunikace

---

## 5. FYZICKÁ VRSTVA — IoT A HARDWARE

### Smart venue integrace
- Turnstile API — přímá integrace s fyzickými turnikety (Skidata, Gunnebo)
- Wristband management — NFC náramky (zakoupíš, aktivuješ QR, používáš na místě)
- Locker booking — rezervace šatny/úschovny přímo v apce
- Bag check system — číslo poukázky místo papírku

### Environmental sensing
- Kapacita v reálném čase z kamer/senzorů (ne jen ze scannerů)
- Fronta management — real-time čekací doba pro různé vstupní body
- Environmental dashboard pro pořadatele (teplota, hluk, obsazenost zón)

### Cashless payment na místě
- NFC wristband jako platební prostředek uvnitř areálu
- Kredit dobití přes app, cashout po akci
- Sdílení kreditu v rámci skupiny

---

## 6. CREATOR ECONOMY A INDIE SEGMENT

### Mikro-pořadatelé
- Streamlined onboarding pro jednotlivce bez firmy (živnostník, fyzická osoba)
- "Udělej event za 5 minut" — šablona, cena, platba, sdílení
- Creator monetizace: tip/gratuity tlačítko po akci, merchandise za event

### Zážitky jako produkt
- Experiences marketplace — vaříme s šéfkuchařem, soukromý koncert, wine tasting
- Privatní eventy — pronájem instruktora/prostoru bez veřejné stránky
- Online experiences — živé streamy jako placené vstupenky (propojení s hybridním modulem)

### Crowdfunded experiences
- Umělec řekne: "Odehraju koncert pokud se prodá 200 vstupenek do 30 dní"
- Fanoušci pre-purchase, pokud se nenaplní, plný refund
- Gamifikace: první kupující dostávají bonus (lepší místa, merch, backstage)

---

## 7. CESTOVNÍ A DESTINAČNÍ VRSTVA

- **Event package builder** — vstupenka + vlak/letadlo + hotel v jednom checkout
- **Destination event discovery** — "Cestuji do Vídně 15.–17. dubna, co tam dělat?"
- **Festival tourism** — kombinace více eventů v jedné destinaci s ubytováním
- **Travel insurance** — integrace do checkout (zmeškáš vlak, pojišťovna proplatí vstupenku)
- **Last-minute packages** — algoritmus skombinuje zbývající vstupenky s hotelem za dynamickou cenu

---

## 8. UDRŽITELNOST A SOCIÁLNÍ ODPOVĚDNOST

- **Uhlíková stopa eventu** — kalkulace + badge "Tento event je carbon neutral"
- **Carbon offset v checkout** — +20 Kč → zasadíme strom, kupující dostane certifikát
- **Green event certifikace** — skóre na základě kritérií (bezodpadový catering, MHD dostupnost)
- **MHD bundle** — vstupenka + jednodenní MHD v jednom QR kódu (integrace s DPP/IDOS)
- **Charitativní aukce modul** — část výtěžku jde automaticky na vybraný charitativní účet

---

## 9. VZDĚLÁVÁNÍ A CERTIFIKACE

- **CPD tracking** — continuing professional development body za účast (lékaři, právníci, účetní)
- **Automatická certifikace** — QR scan při odchodu → okamžitě certifikát v Apple Wallet
- **Academic conference management** — abstrakty, peer review, program, proceedings
- **Exam slot booking** — propojení s BankID pro věrohodnou identitu u zkoušek
- **Training compliance** — firemní HR sleduje kdo absolvoval povinná školení

---

## 10. PRÁVNÍ A COMPLIANCE INFRASTRUKTURA

- **Elektronická smlouva v ticketu** — při koupi vstupenky zákazník podepisuje podmínky (elektronicky, právně závazné)
- **Věková verifikace** — BankID rozšíření na automatické věkové gating v checkout
- **Kapacitní compliance** — automatické zastavení prodeje při dosažení povolené kapacity (hasiči)
- **GDPR as a service** — export dat, výmaz, consent management pro promotéry (White-label)
- **AML screening** — automatická kontrola kupujících pro high-value transakce (VIP pakety, boxes)

---

## 11. ZDRAVOTNICTVÍ A WELLNESS

- **Elektronická objednanka** — propojení s ISIN/NZIS pro ověření pojišťovny
- **Fyzio/terapie pakety** — 10 sezení, zákazník čerpá postupně (napojení na balíčky v2)
- **Telemedicína sloty** — video konzultace jako "event" s Zoom integrací
- **Lékařský referral flow** — lékař doporučí fyzioterapeuta, pacient si přímo zarezervuje
- **Pojišťovna integrace** — automatické zpracování nároku na refund z pojišťovny

---

## PŘEHLED — STRATIFIKACE VRSTEV

```
VRSTVA 1 — Transakční jádro (hotovo z ~80 %)
  └── Ticketing, rezervace, platby, QR, fraud

VRSTVA 2 — Zážitková (chybí z ~70 %)
  └── Před/při/po akci, sociální, koordinace skupin

VRSTVA 3 — Monetizační (chybí z ~60 %)
  └── Crowdfunding, Dutch auction, revenue advance, B2B

VRSTVA 4 — Datová a AI (chybí z ~50 %)
  └── Kontext-aware AI, creator intelligence, competitor radar

VRSTVA 5 — Fyzická a IoT (chybí z ~80 %)
  └── Turnstile, cashless wristband, environmental

VRSTVA 6 — Ekosystémová (chybí z ~90 %)
  └── Travel bundle, certification, sustainability, healthcare
```

---

## NEJVĚTŠÍ "WHITE SPACES" V ČR

Oblasti kde **nikdo v ČR není silný** a Tixly by mohl dominovat:

| Příležitost | Proč zajímavé | Priorita |
|---|---|---|
| **Crowdfunding eventi** | Nulová konkurence, přirozené rozšíření platformy | ⭐⭐⭐⭐⭐ |
| **Korporátní entertainment + reporting** | Firmy platí dobře, chybí nástroje | ⭐⭐⭐⭐⭐ |
| **CPD certifikace** | Lékaři, právníci, účetní = velký objem, rekurentní | ⭐⭐⭐⭐ |
| **Cashless areálový systém** | Festivaly to chtějí, technologie je složitá | ⭐⭐⭐⭐ |
| **Green event certifikace** | Early mover advantage, EU trend, PR hodnota | ⭐⭐⭐ |
| **Experiences marketplace** | Airbnb Experiences v ČR neexistuje pořádně | ⭐⭐⭐⭐ |
| **Revenue advance pro promotéry** | FinTech + platform play, vysoká marže | ⭐⭐⭐⭐ |
| **MHD bundle** | Unikátní v Evropě, silná partnerství | ⭐⭐⭐ |
