# Tier B — business rozhodnutí, která potřebuju od tebe

> **Tier B = kód umím, ale business pravidla musíš stanovit ty.** Bez tvého „ano/ne" nemůžu odpovědně psát logiku.
>
> Tier A skončil. Tier C čeká na API keys (Stripe, Resend, BulkGate, hCaptcha). Tier D čeká na IČO + bank. Mezitím tu je 6 Tier B rozhodnutí, která **odemknou další ~10-15 dní vývoje** (kód je v archive nebo jen needs config).

---

## B-1: Tier systém pořadatelů — jaké limity?

**Stav:** ✅ kód hotový (commit `f951cb6` — auto-upgrade cron + DB migrace 243). Chybí jen číselné parametry.

**Co potřebuju:**

| Tier | Auto-approve akcí? | Max tix per akce | Provize z prodeje | Servisní poplatek pro kupce | Postoupení (criteria) |
|---|---|---|---|---|---|
| **1 Nový** | ❌ manuálně master admin | ?  | ? % | ? Kč | po X úspěšných akcích → 2 |
| **2 Ověřený** | ✅ + AI gate | ? | ? % | ? Kč | po Y K tržbách → 3 |
| **3 Premium** | ✅ | ∞ | ? % | ? Kč | individuální → 4 |
| **4 Enterprise** | ✅ + dedicated AM | ∞ | custom | custom | — |

**Můj návrh (default, můžeš změnit):**
- Tier 1: max 500 tix/akce, 7 % provize, 15 Kč pro kupce → posun po 3 schválených akcích
- Tier 2: max 5 000 tix/akce, 5 % provize, 10 Kč pro kupce → posun po 1 mil. Kč tržby
- Tier 3: ∞ tix, 4 % provize, 10 Kč → individuální dohoda
- Tier 4: ∞ tix, 3 % provize, 0 Kč pro kupce, custom SLA

**Cesta:** Řekni 4 čísla provize × 4 čísla limitů + 2 thresholdy postupu. Pak to wirenu do `promoter-tier-evaluate` cronu (2 hodiny).

---

## B-2: Marketplace Ads — cena za slot?

**Stav:** ✅ kód hotový (commit `b06d26c` — CPC sponsored placements, migrace 245). Chybí jen pricing model.

**Co potřebuju:**

| Slot | Default CPC | Min daily budget | Pozn. |
|---|---|---|---|
| Homepage masthead | ? Kč/klik | ? Kč/den | top 1 sponsored slot |
| Kategoriová stránka top | ? Kč/klik | ? Kč/den | per kategorie |
| Search výsledky #1 | ? Kč/klik | ? Kč/den | brand keywords |
| Event detail „podobné akce" | ? Kč/klik | ? Kč/den | low-cost, high volume |

**Můj návrh:**
- Homepage: 8 Kč/klik, min 200 Kč/den
- Kategorie: 5 Kč/klik, min 100 Kč/den
- Search: 12 Kč/klik (brand bidding kompetice), min 200 Kč/den
- Event detail: 3 Kč/klik, min 50 Kč/den

**Co řeknout:** „Souhlasím s návrhem" nebo „chci jiné sazby [list]". Pak nastavím v `marketplace_ads_config` a wirenu billing flow (3 hodiny).

---

## B-3: Sub-účty + RBAC — jaké role?

**Stav:** ✅ kód hotový (commit `ec0fe7a` — specializované role pro sub-účty, migrace 242). Chybí jen role taxonomie.

**Co potřebuju:** Co všechno mohou dělat sub-účty? Návrh 4 rolí:

| Role | Akce | Vstupenky | Reporty | Settings | Finance |
|---|---|---|---|---|---|
| **Owner** (vlastník) | full | full | full | full | full |
| **Manager** (manažer akcí) | create/edit/delete | scan/refund | own events | — | — |
| **Box Office** (pokladní) | view | scan/sell on-site | own venue today | — | — |
| **Entry Staff** (vchod) | view | scan only | — | — | — |

**Co řeknout:** Souhlas s 4 rolemi nebo „chci 3/5/jiné". Pak vyplním RBAC matrix v `lib/auth/roles.ts` (4 hodiny).

---

## B-4: Bank transfer — struktura variabilního symbolu?

**Stav:** ✅ kód hotový (commit `bd95ff9` — bank transfer reconciliation, migrace 251). Chybí jen VS formát.

**Možnosti:**

| Formát | Vzor | Pro | Proti |
|---|---|---|---|
| **Order číslo (numeric)** | 2026000123 | Standardní formát ČR, jednoduchý | Když máš víc DB, kolize čísel |
| **Year + tenant + sequence** | 26001000123 | Vícenásobně-tenantní safety | Delší (max 10 znaků v VS bank limitace) |
| **Hash of order UUID** | 8473921056 | Unguessable, no info leak | Stěží zapamatovatelný kupcem |

**Můj návrh:** **Year + sequence** (10 znaků): `YYNNNNNNNN` kde YY = 2-digit rok, NNNNNNNN = seqence 1...99M.
Příklad: `2600000123` = 123. objednávka roku 2026. Limit VS je 10 znaků numeric.

**Co řeknout:** „Yes-to-all" nebo „chci jiný formát [vzor]". Pak wirenu do `lib/payment/vs-generator.ts` (1 hodina).

---

## B-5: Chargeback — % settlement holdback?

**Stav:** ✅ kód hotový (commit `420e9f6` + `af5c04e` — chargeback workflow + holdback v settlement). Chybí jen procento.

**Co je holdback:** Z payoutu promotérovi držíme X % po Y dní pro pokrytí případných chargebacků (po 60-90 dnech, kdy Stripe dispute window končí).

**Možnosti:**

| % holdback | Doba držení | Pro | Proti |
|---|---|---|---|
| 0 % | — | Promotéři dostávají vše hned | My neseme veškeré riziko chargebacků |
| 3 % | 90 dní | Středně bezpečné | Promotér je rád, my máme rezervu |
| 5 % | 90 dní | Bezpečné | Tier 1 promotéři mohou nadávat na cash flow |
| 10 % | 60 dní | Velmi bezpečné | Promotéři odejdou |

**Můj návrh:** Tier-based:
- Tier 1: 5 % po 90 dní
- Tier 2: 3 % po 60 dní
- Tier 3+: 0 % (po individuálním kreditu check)

**Co řeknout:** Vyber jeden řádek nebo „yes-to-all". Pak wirenu do `lib/payouts/holdback.ts` (2 hodiny).

---

## B-6: Dynamický QR — vynutit i pro starší klienty?

**Stav:** ✅ kód hotový (catch-up #1 — fullscreen rotující QR). Statické PDF se stále generuje pro email.

**Otázka:** Co s lidmi, co si vytisknou PDF doma a přijdou s papírovým QR?

| Možnost | Co se stane | Pro | Proti |
|---|---|---|---|
| **A. Static PDF nadále funguje** | Scanner přijme jak rotující, tak statický | Žádný kupec nepřijde s neplatným lístkem | Screenshot z PDF lze sdílet → padělání |
| **B. Static jen pro 7+ dní po vytvoření**, pak jen rotující | Cron přepne na rotující 7 dní před akcí | Kupec měl čas si přečíst email | Babička bez smartphone má smůlu |
| **C. Static OFF, jen rotující URL** | Email obsahuje jen odkaz na fullscreen QR | Maximální bezpečnost | UX horší pro tech-nepřátelské kupce |

**Můj návrh:** **A** pro tier 1 promotéry, **B** pro tier 2+, **C** opt-in pro high-demand akce (concert tickets, festivaly).

**Co řeknout:** Vyber A/B/C globální default. Pak nastavím per-event override (1 hodina).

---

## Souhrn

| Rozhodnutí | Effort po tvém ano | Co odemyká |
|---|---|---|
| B-1 Tier limity | 2 h | Auto-approve flow funguje end-to-end |
| B-2 Ads pricing | 3 h | Marketplace ads začnou generovat revenue |
| B-3 Sub-účty role | 4 h | Box office / festivaly mohou nasadit staff |
| B-4 VS formát | 1 h | Bank transfer auto-pair funguje |
| B-5 Chargeback % | 2 h | Settlement funguje correct |
| B-6 Static QR policy | 1 h | Anti-padělání policy aktivní |

**Suma: ~13 hodin práce po tvých 6 odpovědích.** Můžeš odpovědět na všechny najednou („yes-to-all my navrhy"), nebo postupně.

**Pak se odemkne:** Tier C čeká na tvé API keys, Tier D na IČO/bank.

---

## Jak odpovědět

Stačí napsat:
```
B-1: yes (můj návrh)
B-2: jiný — 10/6/15/4 Kč
B-3: yes
B-4: yes
B-5: yes
B-6: B globální default
```

Nebo prostě „yes-to-all" pokud souhlasíš s mými návrhy. Pak rovnou wirenu.
