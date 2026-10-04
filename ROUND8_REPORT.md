# ROUND 8 — divadelní prodej pro turné agenturu

Větev `fix/round8-theatre-2026-10-04` z `505084a8`, PR do `integrate/2026-10-04`.
Vše lokálně: Postgres `fix-pg` (role `tixly_app` + RLS, PgBouncer), mailpit, Redis, simulátor GoPay, lokální ARES. Žádná produkce, žádný deploy, master nedotčen.
Migrace 500–506 (od nuly i nad existujícím schématem, 2× po sobě idempotentně). Výstupy v `logs/r8/`, průběh v `PROGRESS_R8.md`.

## 1. Kroky — co bylo v kódu, co je hotové, test, commit

| Krok | Použito / opraveno / nově | Test RED → GREEN | Commit |
|---|---|---|---|
| 0 Provize 0 | **použito** fee_schedules (0 % jde nastavit); **opraveno** faktura provize při 0 → bez faktury, bez chyby (dřív 422/503) | live 1 → 2/2 | 3f539e39 |
| 1 Inscenace + termíny | **použito** catalog.productions, events.production_id, kopie plánku; **rozšířeno** karta inscenace (mig 500); **opraveno** veřejné čtení sálů (web ukazoval „Online"), build DB od nuly bral jen 4xx migrace, productions.poster_url/status (onboarding a v1/publish psaly do neexistujících sloupců); **nově** termín na pár kliknutí (ceník z předchozího termínu), veřejná stránka inscenace, program podle měst + filtr měsíc/město, generovaný test ochrany rout | live 6 → 6/6 | b0f51ab1, d1d71211 |
| 2 Sály a editor | **použito** venues (= sál), seating charts, VisualEditor (výběr/posun/mazání/podklad PDF); **opraveno** promotérská ukládací routa plánku (jiný tvar než editor), kopie plánku do termínu (acc, duplicity, pomalý insert); **nově** venue_places (mig 501), generátor sekcí (řady, číslování asc/desc/liché-sudé, uličky, posun), typy míst, cenové zóny s legendou, přečíslování, kopie řad, podklad s průhledností/měřítkem/posunem, duplicitní označení místa nejde uložit, převzetí plánku u neprodaného termínu | unit 9/9, live 4 → 4/4 | 324931b1 |
| 3 Blokace | **použito** držení na event_seats, POS; **opraveno** POS prodával i držené místo; **nově** seat_blocks + stavy míst (mig 502), uvolnění vybraných/všech, volné vstupenky na jména, prodej na pokladně z blokace, přehled blokace / celkem / uvolněno / vydáno / prodáno, plánek s barvami, souběh uvolnění × nákup | live 6 → 6/6 | 27b08e13 |
| 4 Slevové kategorie | **použito** promo kódy, typy vstupenek (= zóny), issuer, PDF, skener; **opraveno** přiřazení položky k vstupence u míst (víc položek jednoho typu → špatná cena/kategorie) v order-completed, e-mailu, PDF, štítcích; objednávka za 0 Kč bez vstupenek; **nově** price_categories + ceny po zónách (mig 503), výchozí šablona jedním krokem, cena vždy na serveru, doprovod ZTP/P jen se ZTP/P (max 1:1), limit na termín, promo z ceny kategorie omezitelné na kategorie a zóny (+ kontrola vlastníka kódu), kategorie na PDF/e-mailu, skener „Ověřit průkaz: ZTP/P", UI výběru kategorie u místa | live 4/5 RED → 6/6 (+ RED „0 Kč bez vstupenek") | 3a4979f6 |
| 5 Rezervace na pokladně | **použito** pending objednávka s expires_at, release-capacity, evidence pokladny (směny, cash/card), daňový doklad, cron dispatcher + cron-auth, sdílený rate limit; **opraveno** RLS politiky pokladny (v kontextu pořadatele 42501 — existující prodej na pokladně vracel 404), box-office/sell (expires_at NOT NULL → 500, nevydával vstupenky), POS zahazoval způsob platby, obecná expirace a „opuštěný košík" by braly rezervace; **nově** seat_reservations + nastavení termínu (mig 504), lhůta min(N dní, začátek − M h) na serveru, limity 2 rezervace / 10 míst pod zámkem, e-mail s kódem/místy/cenou/lhůtou/odkazem, pokladna (hledání kód/jméno/e-mail/telefon, hotově/kartou → vstupenky + doklad), cron propadnutí + připomínka 24 h, storno odkazem, obsazenost prodáno vs. rezervováno | live 9 → 9/9, unit 5/5 | c47cc141 |
| 6 Firemní objednávky | **použito** b2b_orders.invoice_orders (schéma bez kódu), ARES klient, doklady + ISDOC + dobropis, blokace; **rozšířeno** faktura před zaplacením, e-mail se vstupenkami i jednotlivě; **opraveno** číslo faktury unikátní globálně (řada je per pořadatel → druhý pořadatel nemohl fakturovat), politika invoice_orders; **nově** mig 505, ARES podle IČO (výpadek → ručně), místa z volných i z blokace, cena upravitelná jen s důvodem, místa držená do zaplacení, zaplaceno (datum + reference) → vstupenky, upozornění po splatnosti (1×), zrušení = dobropis + místa zpět do blokace | live 6 → 6/6 | 25540cfe |
| 7 Zrušení a přesun (C-14) | **použito** stav cancelled, postponed_*, event_reschedules + odkaz kupci, executeOrderRefund (hromadný refund kola 6), auto-refund pozdní platby; **opraveno** `/api/reschedule/[token]` (neexistující sloupec → vždy 500, neplatný stav objednávky, peníze se nevracely, přijetí psalo do neexistujícího tickets.event_id), tokeny přesunu jen v console.log → e-mail, vstupenky se vydávaly i na zrušený termín; **nově** mig 506, zrušení termínu (stop prodeje i rezervací, refund online přes bránu + dobropis, neplatné vstupenky, e-maily, seznam k ručnímu vrácení), přesun s odkazem na vrácení (výchozí 14 dní), sdílená cesta refundu (bulk-refund převeden) | live 4 → 4/4 (vč. souběhu zrušení × platba) | e880dff5 |
| 8 Reporty | **použito** data objednávek/míst/blokací/rezervací, pdfkit + fonty vstupenek; **nově** report termín / inscenace / období po zóně × kategorii × kanálu (online, pokladna, rezervace, firemní, volné), obsazenost %, blokace, propadlé rezervace, CSV + XLSX (bez nové závislosti), seznam pro uvaděče (PDF/CSV) | live 4 → 4/4, unit 3/3 | 9a6ce724 |
| 9 E2E turné | **nově** Playwright scénář (10 kroků) proti `next start`, platební stránka simulátoru GoPay; **opraveno** po vizuální kontrole: plánek na mobilu (výřez podle sedadel, rozteč ≥ 32 px), chat bublina přes lištu nákupu, výchozí kategorie firemní objednávky, nastavení rezervací přepsané před načtením, počet zneplatněných vstupenek | 10/10 PASS | ecd76669 |

## 2. Scénář turné (e2e/tests/golden-path-r8-theatre-tour.spec.ts) — screenshoty `logs/r8/tour/`

Spuštěno proti `next start` (port 3200) nad DB postavenou od nuly (role `tixly_app` + RLS). Finální běh: **10/10 PASS** (`logs/r8/Z_9_tour.txt`), výsledky kroků `logs/r8/tour/results.json`, screenshoty a soubory v `logs/r8/tour/`.

| # | Krok | Výsledek | Screenshoty / soubory |
|---|---|---|---|
| 1 | Inscenace + 2 sály ve 2 městech v editoru: Brno „Velký sál" generátorem (přízemí 8×15, balkon 2×10, zóny A/B, 2 vozíčkáři + 2 doprovod), Ostrava „Komorní scéna" obkreslením PNG podkladu (3 řady × 8) | PASS (rozložení ověřeno v DB) | 01a–01d |
| 2 | 2 termíny Racka (Brno, Ostrava) + termín Hamleta; schválení platformou; veřejná stránka inscenace, program „Brno" | PASS | 02a–02c |
| 3 | Blokace Firma XY 20 (celý balkon), Tisk 4, Technika 2 přes plánek | PASS | 03 |
| 4 | Kategorie plné, senior, student, ZTP/P, doprovod ZTP/P (formulář); promo −10 % jen na plné | PASS | 04a |
| 5 | Mobil 390 px: výběr 3 míst na plánku, kategorie Plné/ZTP/P/doprovod, promo → 630 Kč přes stránku simulátoru GoPay → potvrzení; e-mail s PDF | PASS | 05a–05d, 05e-vstupenky.pdf, 05f-email.html |
| 6 | Rezervace (mobil) → e-mail s kódem → pokladna najde kód, platba hotově → 2 vstupenky + doklad; druhá rezervace → propadnutí cronem (dispatcher) → místo zpět + e-mail | PASS | 06a, 06b, 06c |
| 7 | ARES → firemní objednávka 15 míst z blokace Firma XY → faktura (PDF + ISDOC) → zaplaceno → 15 vstupenek (1 společné PDF + 15 jednotlivých); 5 míst uvolněno; Tisk 4× volná vstupenka na jméno | PASS | 07a–07c |
| 8 | Skener: běžná vpuštěna; ZTP/P s výzvou „OVĚŘIT PRŮKAZ: ZTP/P"; vstupenka jiného termínu odmítnuta („Lístek na jinou akci"); opakovaný sken „Lístek už byl použit" | PASS (ověřeno UI + stavem vstupenek; tabulku záznamů skenu test nečetl) | 08a–08d |
| 9 | Zrušení termínu Racek Ostrava: online platba vrácena přes simulátor, vstupenka neplatná, e-mail kupci | PASS (v tomto průchodu kupec neměl doklad → dobropis nevznikl; dobropis ověřuje live test kroku 7) | 09a |
| 10 | Report termínu: online 3, rezervace 2, firemní 15, volné 4; obsazenost a tržba = DB (6 030 Kč); seznam uvaděčů 24 řádků = DB; PDF uvaděčů, XLSX inscenace | PASS | 10a, 10b-seznam-uvadecu.pdf, 10c-report-inscenace.xlsx |

Vizuální kontrola screenshotů proběhla. Odhalila a opravila: malý plánek na mobilu (uložený viewBox editoru), chat bublinu přes lištu nákupu, výchozí kategorii „Doprovod ZTP/P" ve firemní objednávce, přepsání nastavení rezervací před načtením a nulový počet zneplatněných vstupenek ve zprávě o zrušení.

## 3. Lokální sada a CI

| Sada | Výsledek | Log |
|---|---|---|
| Migrace od nuly | 59 souborů, 0 chyb; migrace 500–506 i nad existující DB (r7z) 2× idempotentně; RLS gate bez driftu (871 politik, 589 tabulek); schema-drift 43 (baseline utažena 46 → 43) | Z_1_* |
| Typecheck | 0 chyb | Z_2_tsc.txt |
| Lint (baseline CI) | 993 chyb, baseline 1008, žádná nová | Z_3_lint.txt |
| Unit | 71 souborů / 655 testů prošlo, 13 přeskočeno | Z_4_unit.txt |
| Live (tixly_app, přímý port jako v kole 7) | 78 souborů / 349 testů prošlo; 22 souborů skip (jen pro Neon) | Z_5_live.txt |
| Live přes PgBouncer | 77/78 — padá `fix-r3-pool-nested`: lokální PgBouncer má `default_pool_size = 2`, test potřebuje 4 + 4 spojení (deadlock poolu, ne kód). Kolo 7 tuto sadu přes PgBouncer reálně nespouštělo. | Z_5_live_pgbouncer.txt |
| Build | `next build` EXIT 0 (lokální env) | Z_6_build.txt |
| Audity | 01 26/0 · 02 36/0 · 03 23/0 · 04 14/0 · 05 8/0 · 06 21/0 · 07 6/0 · **07b** 0 zápisů · **08** 166 rout × 3 aktéři, 0 úniků, 0× 5xx · 09 12/0 · 10 7/0 · 11 8/0 · 12 5/0 | Z_8_audit_* |
| E2E turné | 10/10 | Z_9_tour.txt |

**CI na GitHubu:** push běhy commitů R8-0 až R8-8 prošly (CI, Schema Drift Guard, RLS Gate). Stav posledního pushe — viz níže / PR.

## 4. Co selhalo / zůstává / co je potřeba od vás

- **Živé platební brány neověřeny** — všechny platby šly přes simulátor GoPay (lokální). Sandbox GoPay/ComGate čeká na klíče (jako v kole 7).
- **ARES** byl v testech lokální náhrada (`ARES_BASE_URL`); proti skutečnému ARES neověřeno (testy nesmí ven).
- **PgBouncer**: lokální `default_pool_size = 2` neodpovídá produkčnímu pooleru; pro běh live sady přes PgBouncer je třeba pool ≥ 8, nebo test pool-nested přes PgBouncer vynechat. Rozhodnutí na vás.
- Migrace 500–506 **nejsou na produkci** (deploy se nespouštěl). Vyžadují nasazení v pořadí 500 → 506.
- Promo kód s omezením na kategorie se zakládá API (`applicableCategoryCodes`); v administraci promo kódů pole pro kategorie zatím není.
- Hlášení skeneru „Lístek na jinou akci (Racek)" uvádí jen název — u turné stejné inscenace by pomohlo doplnit datum a město (neupraveno).
- Na mobilu se větší sál posouvá do stran uvnitř rámu plánku (záměrně kvůli rozteči 32 px); „pinch zoom" není.
- Bezplatná objednávka kategorie 0 Kč a pokladní prodej (`box-office/sell`) byly opraveny; existující tok „pending → zaplaceno později" pro jiné kanály kolo neměnilo.

## 5. PR a poslední commit

__PR__
