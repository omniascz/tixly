# ⚖️ Tixly — podklad pro právní revizi (legal review packet)

> Pro právníka. Cílem je efektivní revize před spuštěním. Tixly NENÍ právní poradna —
> tohle je analýza stavu + seznam, co doplnit a co rozhodnout. Aktualizováno 2026-06-03.

---

## ✅ Co už existuje a je v dobrém stavu

Aplikace má **3 právní stránky** (CZ + SK, ticketing-specifické, odpovídají reálným funkcím):

| Dokument | Kde | Stav |
|---|---|---|
| **Obchodní podmínky** | `/cs/legal/terms`, `/sk/legal/terms` | Solidní draft. Pokrývá: smluvní vztah (Tixly = zprostředkovatel, kupní smlouva s pořadatelem), objednávka/platba, vrácení/storno (§ 1837 OZ / § 7 zák. 102/2014 SK), resale, odpovědnost, scanner, účet. |
| **Zásady zpracování OÚ (GDPR)** | `/cs/legal/privacy`, `/sk/legal/privacy` | Solidní draft. Controller/processor model, data, právní základy (čl. 6 GDPR), příjemci, retence (10 let faktury), práva subjektu, cookies. |
| **Nastavení cookies** | `/cs/legal/cookie-settings` | 3 kategorie (nezbytné/analytické/marketingové), odvolatelný souhlas. |

**Dobrá zpráva:** texty odpovídají tomu, co systém reálně dělá (export dat jako JSON, 30denní smazání, refund policy pořadatele, scanner „první sken").

---

## 🔴 1. Co DOPLNIT (placeholdery — bez právníka)

Oba dokumenty mají poznámku *„doplň konkrétního správce (název, IČO, adresu)"*. Chybí **identifikační blok firmy:**

- [ ] **Tixly s.r.o.** — přesný název, **IČO**, **DIČ**, sídlo (adresa), spisová značka (OR)
- [ ] **Kontaktní e-maily** — `gdpr@tixly.cz` (privacy už ho používá), support/reklamace
- [ ] **Bankovní účet** pro refundy (Fio CZK/EUR)
- [ ] Stejné údaje doplnit do **patičky** a **faktur** (ISDOC/PDF generátor je hotový)

---

## 🟠 2. Klauzule k DOPLNĚNÍ (funkce, co máme, ale nejsou v ToS)

Systém umí víc, než ToS popisuje — doplnit:

- [ ] **Pojištění storna (Stornoschutz)** — kupující si může připlatit pojistku zrušení; claim = refund. Není v ToS → doplnit podmínky (kdo je pojistitel, co kryje, jak uplatnit).
- [ ] **Splátky (payment plans / BNPL)** — záloha + splátky přes Twisto/Skip Pay. Doplnit splátkové podmínky.
- [ ] **Vouchery / dárkové poukazy** — 3letá platnost, podmínky uplatnění.
- [ ] **Věrnostní body, abonmá/permanentky** — podmínky čerpání (volitelné, méně kritické).

---

## ⚠️ 3. Co MUSÍ ROZHODNOUT / OVĚŘIT právník

- [ ] **Platební/agregátorský model** ⬅ **NEJKRITIČTĚJŠÍ.** Kdo inkasuje peníze od kupce a vyplácí pořadateli? Pokud Tixly vybírá platby jménem pořadatelů a přeposílá → je to **agregátor/platební služba = regulovaná činnost** (PSD2, zák. 370/2017 Sb.). Ověřit, zda model GoPay/ComGate (peníze jdou rovnou pořadateli vs. přes Tixly) tohle řeší, nebo zda Tixly potřebuje **licenci/registraci u ČNB** (poskytovatel platebních služeb malého rozsahu). *Souvisí s dřívější otázkou na GoPay podmínky.*
- [ ] **DPA (zpracovatelská smlouva)** — Privacy říká, že pořadatel = správce, Tixly = zpracovatel „na základě DPA". **Tu DPA je potřeba vytvořit** a každý pořadatel ji musí odsouhlasit (součást registrace promotéra / smlouvy). Bez ní GDPR konstrukce nestojí.
- [ ] **SLA 99 % uptime** — ToS to slibuje. Je to závazek, který chceš dát smluvně? (vystavuje Tixly odpovědnosti za výpadky). Zvážit formulaci „bez záruky" vs. konkrétní SLA.
- [ ] **Resale cap — DISKREPANCE:** ToS říká **max 100 %** nominální hodnoty. EU směrnice 2019/771 umožňuje až 110 %. Kód aktuálně vynucuje **100 % (face value)**. Sjednotit ToS + kód + business záměr (chceš 100 nebo 110 %?).
- [ ] **DSA (Digital Services Act)** — Tixly hostí obsah akcí pořadatelů → moderace + report mechanismus už existují (3vrstvá moderace, content_reports). Ověřit, zda Tixly spadá pod DSA povinnosti (notice-and-action, transparentnost) a zda jsou splněné.
- [ ] **Spotřebitelské řešení sporů** — ToS odkazuje ČOI (CZ) / SOI (SK). Ověřit + doplnit ODR platformu EU.
- [ ] **DPH** — CZ 21 %/10 % kultura, SK 23 %/5 %. Ověřit, že fakturační logika (per-event vat_category) sedí s tím, kdo je plátce (Tixly vs. pořadatel) u provize vs. ceny lístku.

---

## 📋 Doporučený postup pro právníka

1. Projít `/cs/legal/terms` a `/cs/legal/privacy` (živé znění v appce).
2. Rozhodnout bod **3** (hlavně platební model + DPA — to jsou strukturální).
3. Doplnit body **1** (firma) a **2** (klauzule).
4. SK verze: drobné odchylky (§ 7 zák. 102/2014, SOI, slovenské DPH) — text už je dvojjazyčný, jen ověřit.

Texty jsou v `src/app/[locale]/legal/{terms,privacy}/page.tsx` — po revizi je upraví vývojář (já) podle pokynů právníka.
