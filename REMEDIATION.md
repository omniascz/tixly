# REMEDIATION.md — remediační session (zdroj pravdy: HANDOFF.md)

> Pravidlo: oprav JEDEN nález → ověř proti čerstvé prod-clone Neon větvi → teprve pak další.
> Neopravovat nic z „držících invariantů" (HANDOFF §2). Datum: 2026-07-04.

---

# 📌 STAV — 2026-07-29 (guest-create helper — ROZPRACOVÁNO 7/25)

## 1) ROZPRACOVÁNO: sdílený guest-create helper (7 z 25 lokací)
- **Helper**: `src/lib/identity/guest-user.ts` → `createOrGetGuestUser(client, { email, name? }) → Promise<string>`.
  Bere handle (`PoolClient` i `RlsAwarePool`), **neotevírá ani nezavírá transakci** → funguje v tx (23/25 lokací) i v autocommitu (waitlist, admin/import).
- **Přepojeno 7**: `checkout:898`, `comps`, `guestlist`, `press`, `accreditation`, `waitlist/[entryId]`, `box-office/sell`.
- **🔧 KOREKCE 2026-07-30 — původní tvrzení „všech 7 mělo guest SQL už správně, přínos je jen odstranění copy-paste" BYLO NEPRAVDIVÉ.** Audit `ON CONFLICT` akce per lokace (git diff, ne dokument) ukázal, že politiky **nebyly jednotné** — **3 ze 7 lokací se lišily**:
  | lokace | původní `DO UPDATE` | politika v helperu |
  |---|---|---|
  | checkout:898, accreditation, press, guestlist, waitlist | `SET updated_at = NOW()` | `touch` (default) |
  | **comps:171** | `SET name = COALESCE(EXCLUDED.name, users.name), updated_at = NOW()` | **`fillName`** |
  | **box-office/sell:81** | `SET name = EXCLUDED.name` (**bez** `updated_at`) | **`overwriteName`** |
  | **guestlist:122** | `password_hash = ''` (ostatní `'!guest'`) | srovnáno na `'!guest'` |

  První verze helperu měla jen `touch` → **tiše měnila chování** comps i box-office. Opraveno: helper dostal parametr `onExisting: 'touch' | 'overwriteName' | 'fillName'` a každá call-site má tu politiku, kterou měla PŘED refactorem. **Sjednocení politik je ZÁMĚRNĚ neuděláno** — je to produktové rozhodnutí (mění, jestli pokladní přepíše jméno registrovanému zákazníkovi), ne remediace.
  `password_hash` `''`→`'!guest'` je doloženo jako chování-zachovávající: trigger `trg_move_password` (mig 335:53) má podmínku `WHEN (NEW.password_hash IS NOT NULL)` a `''` **není** NULL → řádek v `user_secrets` vznikal v obou variantách; jediný čtenář hodnoty je `auth/login:58` → `bcrypt.compare`, změřeno `false` pro `''`/`'!guest'`/`'!deleted'` × 3 hesla = 9×, žádný throw; grep: `'!guest'` se nikde nečte pro rozhodování.
  Zbytek původního tvrzení PLATÍ: `23502`/`42P10`/`42703` padlo dřív v `929adf2` + `8852cc7`, helper žádný z těch blockerů neopravil.
- **Kanonický vzor** (ověřený reálným během): `INSERT (email, name, password_hash, gdpr_consent_at) VALUES (LOWER($1), $2, '!guest', NOW()) ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at = NOW() RETURNING id`. **Pozn.:** `DO UPDATE SET updated_at = NOW()` je jen politika `touch`; „kanonický" neznamená, že ji měly všechny lokace (viz korekce výše).
- **Past ON CONFLICT doložena**: `DO NOTHING + RETURNING` při konfliktu **nevrátí řádek** → nutné `DO UPDATE`. Helper má na to pojistku (hodí výjimku místo `undefined`).
- **Ověření reálným během** proti ephemeral klonu prod větve — **22 passed | 1 skipped, exit 0** (2026-07-30):
  - `tests/guest-user.live.test.ts` (12) — insert, dedup, normalizace e-mailu, anonymizovaný účet se nevzkřísí, **rollback v tx** guesta smaže, důkaz pasti `DO NOTHING`, důkaz obou blockerů (23502 / 42P10).
  - `tests/checkout-guest.live.test.ts` (4) — **celá** checkout cesta, **PŘED = PO**.
  - `tests/admin-guest.live.test.ts` (6) — 6 admin cest. **Všech 6 zelených**, ale dva z nich (waitlist, box-office) **asertují SOUČASNÝ ROZBITÝ STAV** s konkrétním SQLSTATE, ne kýžený — mají to v názvu (`T-WAITLIST-PROVIDER` 23514, `T-BOXOFFICE-EXPIRES` 23502) a komentář „až se tiket opraví, tento test spadne — to je záměr".
  - `tests/checkout-stress.live.test.ts` (1) — skipped, gated na `RUN_AUDIT_REPRO` (reprodukovač `T-AUDIT-GUC`).
  - Rollback ověřen na helperu a na checkoutu, **ne per-route** u zbylých šesti.
- **Dráha pro runtime testy**: `vitest.live.config.ts` (node env, bez jsdom setupu). Bez `NEON_API_KEY` se testy samy přeskočí.
- **Unit důkaz zachování chování**: `tests/guest-user-policy.test.ts` (11 asercí) — mapování všech 3 politik na SQL, že `overwriteName` nepřidá `updated_at`, partial predikát, `gdpr_consent_at`, normalizace, pojistka proti `DO NOTHING` regresi. Běží bez DB → je v hlavní sadě a v CI.
- **✅ COMMITNUTO 2026-07-30** (5 commitů: `chore(gitignore)`, `fix(test)`, `refactor(identity)`, `test(live)`, `docs`). Dva nálezy vypadlé z commitování:
  - **hlavní vitest sada padala** — `*.live.test.ts` končí na `.test.ts`, takže je `include` natahoval do jsdom dráhy, kde `tests/setup.ts:19` sahá na `window` → 4 failed suites. Opraveno `exclude` v `vitest.config.ts`.
  - **live sada končila exit 1 při 0 failed testech** — routy berou spojení z líného poolu `rls-pool`, který se nezavíral, a smazání ephemeral větve pod otevřenými sockety dávalo `Connection terminated unexpectedly` jako unhandled error. Opraveno `appDb().end()` před `DELETE` větve.
  - **`.env` zálohy nebyly gitignorované** — `.env.local.axs-backup` a `.env.local.backup-20260619-1842` propadly vzory, které všechny vyžadují koncovku `.local`. Obsahují reálné `DATABASE_URL`/`JWT_SECRET`/`CRON_SECRET`. Historie ověřena jako čistá (0 commitů), vzory doplněny.

### 🔴 HIGH systémový ticket ZŮSTÁVÁ OTEVŘENÝ
**Zbývá 18 guest-create kopií** (ověřeno grepem, ne odhadem): `subscriptions/checkout`, `subscriptions/subscribe`, `season-passes`, `reseller/sale`, `partner/sales`, `p/[slug]/vouchers/checkout`, `gift/redeem`, `gift/[token]`, `charity/claim`, `buyer/resale/buy`, `buyer/modular-pass/checkout`, `buyer/cross-passes/purchase`, `admin/reservations`, `admin/pos/sale`, `admin/orders/[orderId]/support-action`, `admin/import`, `kiosk/order` (2×).
Mimo rozsah (skutečná registrace, reálný hash): `auth/register`, `auth/register-promoter`, `team/accept`, `lib/oauth/provider`.

**BLOKÁTOR:** 3 lokace (`subscriptions/checkout`, `admin/reservations`, `p/[slug]/vouchers/checkout`) posílají `phone`, který schválená signatura nemá → přepojením by přestaly telefon ukládat. **`subscriptions/checkout` je jediná dnes reálně rozbitá guest cesta** (chybí `gdpr_consent_at` → 23502; `ON CONFLICT (email)` bez partial predikátu → 42P10) a je zablokovaná právě tímhle. Rozhodnout: přidat `phone?` do signatury.

**Regrese-ochrana:** guard je parse-only a na `NOT NULL` / `ON CONFLICT` / `CHECK` **strukturálně slepý**. Jakmile budou přepojené všechny, nová guest cesta zavolá helper a je správně od začátku. **Dokud zbývá 18 kopií, tahle ochrana neplatí.**

## 2) NOVÉ TIKETY — předexistující vady odhalené runtime testy (NEopraveno)
- **`T-AUDIT-GUC`** — `RESET` custom GUC nechá **prázdný string**, ne `NULL` (doloženo v PG). `audit_trigger_func` má `COALESCE(current_setting('app.role',TRUE),'system')`, což `''` nechytí → `actor_type=''` → INSERT do `orders.orders` padá **23514** `audit_log_actor_type_check`. Projev **nahodilý** dle recyklace spojení z poolu; reprodukce: 6 nákupů po sobě → `200, 500, 200, 200, 200, 200` (shodně před i po refactoru). Reprodukovač: `tests/checkout-stress.live.test.ts` (`RUN_AUDIT_REPRO=1`). Oprava: `COALESCE(NULLIF(current_setting('app.role',TRUE),''),'system')` → migrace. **Blokuje spolehlivé runtime ověřování všech dalších cest.**
- **`T-WAITLIST-PROVIDER`** — `waitlist/[entryId]` PATCH `status='converted'` vkládá `payment_provider='walkin'`, které **není** v `orders_payment_provider_check` **ani po čekající mig 451**. Konverze z waitlistu padá **23514 vždycky** → mrtvá funkce.
- **`T-BOXOFFICE-EXPIRES`** — `box-office/sell` nedodává `expires_at` (NOT NULL) → **23502**; za tím druhý blocker: `payment_provider='box_office'` taky není v CHECKu. Klasický maskovaný řetěz.
- **`T-ACCR-DEAD-KIND`** — akreditační cesta hledá `tt.kind='accreditation'`, ale `ticket_types_kind_check` povoluje jen `standing/seated/season_pass/bundle` → **mrtvá větev**, funguje jen fallback `base_price = 0`.

## 3) ⚠️ DEPLOY-POŘADÍ (beze změny)
mig **450** (issuer) / **451** (POS) / **452** (tracking) + capacity backfill — vše na DB **PŘED** kódem. Předprodukce, nic zatím na živé DB.

## 4) ZBÝVÁ
- **Dokončit guest-create helper** — 18 lokací (viz blokátor `phone` výše).
- **`programs/[eventId]` `is_published`** — dead-feature průzkum.
- **tickety §7** (produktová rozhodnutí): `T-PAYOUT-SCHEMA`, `T-WL-PAYMENT-ROUTING`, `T-BOXOFFICE-RESTORE`.
- **Nový front (ne remediace):** systematický lov constraint blockerů v INSERTech, které guard nevidí + Track C property/looping testy na logické bugy.

## 5) POUČENÍ
- **Grep, ne dokument.** Ticket tvrdil 8 lokací; grep celého `src/` jich našel **25**. Dokument podhodnocoval — čísla brát z kódu, ne z vlastní poznámky. „Najdi VŠECHNY, ne kolik říká zápis."
- **Replikovaný kód je root-cause třída.** 25 kopií téhož upsertu = 25 příležitostí udělat to jinak špatně. Sdílený helper zavírá i to, na co je guard slepý — ale až když jsou přepojené všechny.
- **Jeden vzorek není důkaz.** PŘED/PO srovnání ukázalo „regresi", která po 4 opakováních zmizela — původní kód selhával taky (nahodile, `T-AUDIT-GUC`). U časově závislých jevů měřit opakovaně, jinak si vyrobíš falešný závěr.
- **Runtime test odhalí víc než přepojení samo.** Tři ze čtyř nových tiketů (`T-WAITLIST-PROVIDER`, `T-BOXOFFICE-EXPIRES`, `T-ACCR-DEAD-KIND`) vypadly z toho, že cesty poprvé někdo skutečně spustil.

---

# 📌 STAV — 2026-07-16 (write-rename reprezentant hotový)

## 1) HOTOVO: tracking_events write-rename (`be399bc`)
- **3 renamy** v `lib/tracking/tiktok-capi.ts` INSERT do `marketing.tracking_events`: `event_name→event_type`, `platform→provider`, `promoter_event_id→event_id` (sourozenci meta-capi/ga4 už kanonické názvy používají).
- **mig 452** — `tracking_events_provider_check` aditivně `+tiktok` (vzor 444/451 payment_provider enum precedent, čistě aditivní — žádná hodnota se neodebírá).
- **catch** `()=>{}` → `console.warn` (best-effort viditelné, nesmí shodit konverzi).
- **4. maskovaný blocker za driftem POTVRZEN** (§5 metoda): za 3 viditelnými renamy číhal enum blocker — `provider='tiktok'` mimo výčet → **23514**, tiše polknuto catchem → audit řádek se nikdy nezapsal.
- **Reálný běh na ephemeral prod-clonu**: PŘED = 23514, PO mig 452 = INSERT projde, **zapsaný řádek ověřen** (`provider=tiktok`, `event_type=Purchase`, `event_id` správný — data neprohozená). Write, ne PREPARE. Větev uklizena.
- **Git**: 27 commitů nad `origin/master`, **nepushnuto**, tree čistý.

## 2) ⚠️ DEPLOY-POŘADÍ (kritické — 3 migrace čekají na live; migrace VŽDY před kódem)
- **mig 450** PŘED novým issuerem (`ON CONFLICT` na `ticket_seq` UNIQUE vyžaduje index)
- **mig 451** PŘED POS endpointy (`orders_payment_provider_check` +`kiosk_card`/`reseller_cash`)
- **mig 452** PŘED tracking kódem (`tracking_events_provider_check` +`tiktok`)
- Projekt je **předprodukční** — nic z toho zatím na živou DB.

## 3) ZBÝVÁ (kde příště začít)
- 🔴 **`capacity_remaining→remaining_qty` — POSLEDNÍ write-rename, NEJcitlivější.** UPDATE **dekrement INVENTÁŘE** (třída jako oversell / race D — chyba = špatný počet prodaných míst). **Vlastní pozornost, ne dávka.** Reálný běh OBĚMA směry: dekrement správně sníží, nejde pod 0, chování za concurrency. **PREPARE nestačí.**
- **guest-create helper** (HIGH, systémový — 8 lokací replikuje guest INSERT; samostatná session s review). **[KOREKCE 2026-07-30: 8 byl podhodnocený odhad z poznámky — grep našel 25. Stav: 7 přepojeno na sdílený helper, 18 kopií ZBÝVÁ. Viz §1 nahoře.]**
- **`programs/[eventId]` `is_published`** — dead-feature průzkum.
- **tickety §7** (produktová/schéma rozhodnutí, ne remediace): `T-PAYOUT-SCHEMA`, `T-WL-PAYMENT-ROUTING`, `T-BOXOFFICE-RESTORE`.

## 4) METODA potvrzena (§5)
Za viditelným driftem čekej **maskovaný blocker** (box-office 2 blockery, guest-create řetěz, tracking enum) → **reálný běh, ověřit ZAPSANÝ výsledek, ne PREPARE**. Commit přes `git commit -F` (bash ≠ here-string). Pozn.: commit `6dc23f5` má pomlácenou zprávu — **opravit při deploy-přeskládání**.

---

# 🏁 ZÁVĚR SESSION — 2026-07-05

## 1) BILANCE: baseline **162 → 104** (guard, proti čerstvé prod-clone větvi)
Rozpad zbývajících **104**:
| kategorie | # | poznámka |
|---|---|---|
| **kosmetika** (SELECT/UPDATE rename/`NULL::text`) | **~70** | guard stačí (pure read/update), nízké riziko, k dodělání příště dávkově per rodina |
| **tickety/dluh** (nepostavené subsystémy, produktové rozhodnutí) | **25** | viz §3 — NE remediace |
| **deploy-dep** (mig 450 `ticket_seq`) | **1** | orthogonální, ne drift k opravě |

## 2) HOTOVO & OVĚŘENO (proti REÁLNÉ DB reálným během, ne jen guard)
| oblast | commit | ověřeno |
|---|---|---|
| build fix (pdfjs worker) | `ec58191` (origin) | Vercel READY |
| třída 1 FALSE SUCCESS (cancel + latentní) | `63b52ec`,`3d7e428`,`e5e5632`,`69d8051` | 200-lež reprodukována→opravena |
| třída 2 GATE OUTAGE (cross-pass, guestlist) | `3283d45` | holder projde u brány |
| #4 RACE double-issuance (mig 450 + issuer) | `75e5b52`,`b45683e` | PŘED 6 lístků→PO 3 |
| POS E2E-green (is_active + mig 451 + total_price) | `5225eb7` | kiosk+reseller HTTP 200 + lístek |
| 4a renamy (kiosk→platform.promoters, anti-scalping→audit.anomaly_alerts) | `da6ca20` | seed→reálná data |
| 4a reseller (auth.users→identity.users, kód-only) | `1b01d6a` | insert+dedup |
| foyer DISABLE (schema drift orphan) | `aa62538` | 0 orphan, žádný false-success |
| program DEAD-FEATURE guard | `fbd0475` | 503 pre-connect, 0 orphan |
| **updated_at** (31 lokací, 15 tabulek: REMOVE+RENAME) | `9d30283`,`cb72760`,`f1a2dbb` | reprezentant naživo, cluster 100% |
| **status/guest-create** (8 lokací) | `929adf2`,`8852cc7` | insert+dedup, skrytý řetěz 8/8 |
| **ticket_types multi-drift** (per-DOTAZ) | `f7a6513`,`738574e`,`8852cc7` | CELÝ dotaz projde, skrytý kind chain |
| reschedule_responses user_id | `e7527d0` | PŘED 42703→PO struktura OK |

**18 commitů nad origin, 0 leaků, tsc 0.** Každý fix ověřen proti čerstvé prod-clone Neon větvi (vždy vytvořena i smazána), ne mockem.

## 3) TICKETY (produktová rozhodnutí, NE remediace) — dle priority
1. **🔴 HIGH — sdílený guest-create helper** (systémový root-cause, 8+ kopií INSERT INTO identity.users, guard slepý, tichý duplikát risk) — samostatná session + review. Viz ticket níže. **[KOREKCE 2026-07-30: 8 byl podhodnocený odhad z poznámky — grep našel 25. Stav: 7 přepojeno na sdílený helper, 18 kopií ZBÝVÁ. Viz §1 nahoře.]**
2. **seat-upgrade subsystém** (seat_assignments/seat_maps/seat_map_entries — 3 tabulky chybí)
3. **forgemsg credentials** (jen outbox existuje)
4. **foyer → jsonb model E2E** (foyer_orders.items jsonb + zrušit foyer_order_items ×3 soubory)
5. **productions stub** (rich production nepostaven — description/poster_url/status/slug)
6. **event_programs booklet** (digitální program — price/published nikde)
7. **P2P transfer** (token, HANDOFF #11 dead)
8. **payouts.status chybí 'processing'** (CHECK 23514)
9. **demand-forecast wrong-schema INSERT** (kód proti jinému designu tabulky)
10. **anomaly_alerts alert_type CHECK + message** (verify-event-completion)

## 4) DEPLOY-POŘADÍ (KRITICKÉ, až půjde live)
- **mig 450** (`ticket_seq`) na DB **PŘED** issuer kódem (`b45683e` ON CONFLICT vyžaduje sloupec+index).
- **mig 451** (`payment_provider` výčet) na DB **PŘED** POS kódem (`5225eb7`, jinak 23514).
- **Projekt je PŘEDPRODUKČNÍ** (`app.tixly.cz` NXDOMAIN) — **nic zatím nebylo aplikováno na živou DB.**

## 5) TRVALÁ POUČENÍ
- **Guard je parse-only → STRUKTURÁLNĚ SLEPÝ** na `NOT NULL`(23502) / `ON CONFLICT` partial(42P10) / `CHECK`(23514) / wrong-schema. **„guard 0" ≠ „funguje"** — pravda je JEN v reálném běhu. Empiricky: 9/11 rizikových INSERTů neslo skrytý blocker, který guard neviděl; status-rodina 6/6.
- **Guard maskuje co-drifty** (PREPARE hlásí jen PRVNÍ chybu/dotaz) — u renamu VŽDY audit KAŽDÉHO sloupce (kiosk měl skrytý `starts_at` za 42P01).
- **Past `*_updated_at`** — naivní find-replace `updated_at` chytá `dynamic_price_updated_at` (existuje) → rozbití. Token-hranice nutná.
- **Baseline je STALE vs prod** — zdroj pravdy = čerstvá prod-clone větev, ne baseline.sql.
- **„Kosmetika" byl ŠPATNÝ ODHAD** — konzumační audit NULL::text poolu (14 „exists-nowhere" sloupců) = **0 triviálních** (rozpad: **7 ticket / 7 redirect / 0 čistý NULL::text**). Zbývajících ~70 „kosmetiky" v baseline je **nadhodnocených**: část jsou **redirecty** (kosmetika, ale ne triviální — rename na jiný název), část **skryté tickety** (funkčně konzumované sloupce, NULL::text by tiše rozbil). **KAŽDÁ rodina chce DVOJÍ audit:** (1) **co-drift** — guard vidí jen 1. chybu, audit KAŽDÉHO sloupce dotazu; (2) **konzumpce** — grep, jestli se hodnota konzumuje (QR/scan/WHERE/INSERT/výpočet) → NULL::text JEN pro čistě zobrazovací sloupce, jinak ticket.
- **Git: 18 commitů nad origin, NEpushnuto** (čeká na deploy-pořadí mig 450/451). Dávka 2026-07-05 (konzumační audit + tickety) **nic nového necommitnula** — jen zápisy do REMEDIATION.md (untracked doc); jediná tracked změna `settings.local.json` je harness config, ne remediace.

## 6) KDE ZAČÍT PŘÍŠTĚ
1. **exists-somewhere REDIRECT/RENAME pool** — sloupce, co existují pod JINÝM názvem (kosmetika, ale ne triviální — redirect, ne NULL::text): `currency`, `buyer_email`, `starts_at`, `row_label`, `event_date`(→date_start), `event_name`(→title), `published`(→status), `doc_type`(→type, +co-drift `uploaded_at`→created_at), `x`(→x_coord).
   **METODA (per rodina):** audit VŠECH sloupců dotazu + rename-cíl proti čerstvé prod-clone větvi (co-drift check), **reprezentant první**, pak dávka. Guard stačí pro SELECT/UPDATE reads — ale co-drift audit ne.
2. **⚠️ `capacity_remaining` ZVLÁŠŤ** — rename→`remaining_qty`, ALE sahá na **UPDATE decrement inventáře** (`SET capacity_remaining = capacity_remaining - 1`). Není to read-rename → chce **reálný běh** (ověřit, že decrement inventáře drží), ne jen PREPARE.

### 🟡 WRITE-RENAME POOL (čekající — společná třída: write, chce reálný běh na ephemeral clone, NE PREPARE)
> Vytaženo z read-rename dávek, protože jde o WRITE (INSERT/UPDATE) → PREPARE parse-only nestačí, ověřit reálným během na ephemeral clonu, že zápis cílí správný sloupec/hodnotu.
- **`capacity_remaining`** (viz bod 2 výše) — UPDATE decrement inventáře → `remaining_qty`.
- **`tracking_events` INSERT** — `lib/tracking/tiktok-capi.ts:106`, `INSERT INTO marketing.tracking_events`. **3 co-drifty** (guard viděl jen 1.): `event_name`→? (reálný cíl `event_type`, ověřit proti větvi), `platform`→`provider`, `promoter_event_id`→`event_id`. Reálné sloupce tabulky: `id, event_id, order_id, provider, event_type, payload, status, response_body, error, created_at, sent_at`.
  - **Fire-and-forget `.catch(()=>{})`** → dnes TIŠE nezapisuje tracking audit; po fixu ožije.
  - **Severita nízká** (tracking, ne peníze/vstup), ale **tichý drift**.
  - **Write → ephemeral clone + reálný běh, ne PREPARE.**

## ✅ DÁVKA 2 comps+press — free-ticket gate sjednocen (is_published fantom → visibility='public') — HOTOVO & OVĚŘENO
- **Rozhodnutí (a):** všechny 3 free-ticket cesty gate-ují stejně na **`tt.visibility='public'`** — vzor **guestlist** (jediná FUNGUJÍCÍ sesterská cesta, stejná třída). `is_published` byl **fantom-jméno** pro týž záměr (NIKDY nevznikl na ticket_types v žádné migraci → POST comps/press 42703/500 od inception `5b87b71`).
- **comps** (`comps/route.ts:144`): 1řádkový — `tt.is_published=TRUE` → `tt.visibility='public'` (currency správně z `e.currency`).
- **press** (`press/route.ts:126`): **byl 3-drift, NE twin** — `is_published` + `currency` + `sort_order` (guard viděl jen `is_published`). Restrukturalizován: **+JOIN catalog.events** pro `e.currency` (na ticket_types neexistuje, vzor comps) + `tt.visibility='public'` + **`ORDER BY tt.created_at`** (drop `sort_order`).
- **Ověřeno reálným během CELÉ transakce** (ephemeral clone `br-holy-fog-al9kwoco`, mig 450 aplikována, smazána): PŘED 42703 (obě); PO — dekrement inventáře 10→8 + INSERT order/order_items + issue lístku + approve accreditation **DOBĚHNE** (12/12 aserce, harness `scratchpad/verify-comps-press.mjs`, věrná replika obou route + demo-issuer). Žádný skrytý NOT NULL řetěz za fantomem. `npx tsc` 0.
- **POZNÁMKA (ordering):** press původně zamýšlel `ORDER BY sort_order` (na ticket_types neexistuje) → nahrazeno `created_at`. **Explicitní ordering ticket typů = samostatná featura**, ne tato oprava.
- **POZNÁMKA (visibility scope):** `visibility='public'` vyloučí `hidden`/`access_code` typy. Comps/press na hidden/access_code = **samostatné produktové rozšíření napříč VŠEMI 3 free-ticket cestami** (guestlist+comps+press naráz), ne teď.
- **Commit:** comps+press dohromady (jedno rozhodnutí, dvě lokace, jeden vzor).

## ✅ DÁVKA 2 row_label→row — HOTOVO & OVĚŘENO
- **event_seats má sloupec `row`** (text), ne `row_label` (ověřeno z information_schema, ne z názvu).
- **(a) Display renamy** (`memory:44` + `commemorative/send:66`) — `es.row_label`→`es.row` uvnitř `concat_ws(...) AS seat_label`; čistě zobrazovací (app čte `seat_label`), žádný alias-back. Dvojí audit u OBOU (různý tvar dotazu), PREPARE zelený. Commit `7dfd106`.
- **(b) exchange ZVLÁŠŤ** (`buyer/tickets/[ticketId]/exchange:227,246`) — write cesta, jiná třída:
  - **CO-DRIFT:** `row_label`→`row` **+** `seat_num`→`seat_number` (guard viděl jen `row_label`).
  - **alias-back** (`row AS row_label, seat_number AS seat_num`) — app JS (`s.row_label`/`s.seat_num`) beze změny.
  - **Ověřeno reálným během** na ephemeral clonu (`br-misty-math-alwj7esu`, mig 450, smazána): PŘED 42703; PO — celá exchange transakce (FOR UPDATE seat lock + auto-přiřazení + release starého + write ticket/order + inventář) **DOBĚHNE**; **žádný skrytý NOT NULL řetěz** za 2 drifty. 12/12 aserce (`scratchpad/verify-exchange.mjs`).
  - **BOD 2 (pořadí auto-přiřazení):** změřeno z DB — `ORDER BY row, seat_number` přiřadí DB-lexikálně první sedadlo; ověřeno na míchaných řadách ('2','10','A'): přiřadí row '10' seat '1'.
  - **⚠️ POZNÁMKA (samostatný backlog ticket, NE tato oprava):** řady se řadí **text-lexikálně** ('10' před '2'), protože `event_seats.row` je **TEXT** bez numerické varianty. **Pre-existing design, ne regrese z renamu** (dotaz s fantomem `row_label` NIKDY neběžel → 42703 od vždy → není co regresovat). Rename věrně obnovuje text-lexikální řazení, které kód vždy zamýšlel. Pokud tým chce **numerické** řazení řad → samostatná featura (natural-sort / číselný sloupec), ortogonální k drift-remediaci.
  - **Commit exchange samostatně** (write cesta, jiná třída než (a) display renamy).

## ✅ x→x_coord (+ y→y_coord co-drift) — checkout sociální-odstup — HOTOVO & OVĚŘENO
- **event_seats má `x_coord`/`y_coord`** (ne `x`/`y`). 2 drift dotazy, oba `checkout/route.ts`: **`:675`** (held seats fetch) + **`:730`** (conflict seats). **Dynamické SQL** → guard je NEVIDĚL (baseline prázdný), nalezeno cíleným grepem. (`seats/route.ts` píše `x_coord`/`y_coord` správně — není drift.)
- **Co-drift:** `x`→`x_coord` **+** `y`→`y_coord` (pár). Zbytek obou dotazů (id/status/ticket_type_id/hold_until/notes/event_id) ověřen — bez skrytého co-drift. **alias-back** (`x_coord AS x, y_coord AS y`) → JS `s.x`/`s.y` beze změny.
- **TŘÍDA:** SQL SELECT-only (x/y nikde v SQL WHERE/ORDER), ALE hodnoty krmí **backend nákup-blokující výpočet** — sociální-odstup kolizní check (`:737-741`, `dy<0.5 && dx>0 && dx<=distN` → ROLLBACK `SOCIAL_DISTANCE_VIOLATION`). Ne frontend-display → **reálný běh, ne PREPARE.**
- **Ověřeno reálným během OBĚMA směry** (ephemeral clone `br-lively-frog-alfuug5s`, smazána, 7/7):
  - (1) POZITIVNÍ (dx=1, dy=0, distN=2) → **BLOKUJE** ✅; alias-back mapuje správně (s.x=x_coord=5, s.y=y_coord=1, ne prohozené).
  - (2) NEGATIVNÍ (dx=5>distN; jiná řada dy=2) → **PROJDE** ✅ (žádný false-positive).
  - (3) HRANIČNÍ (dx=2==distN) → blokuje (`dx<=distN`) ✅.
  - Nezávislé srovnání s ground-truth seed hodnotami — shoda v obou směrech.
- **🔴 SEVERITY nález (zapsat):** originální `x`/`y` NIKDY neexistovaly → `:675` (held-seat fetch, běží pro KAŽDÝ seated checkout se seat-holdem, **nezávisle na distN**) házelo **42703 → seated checkout 500**. Sociální-odstup enforcement byl proto při distN>0 **tiše ROZBITÝ** (500, ne blok). **Rename není regrese — je to RESTORE** (dotaz nikdy neběžel, není co regresovat; fix zapíná zpět seated checkout i sociální-odstup).
- **Sociální odstup = vynucený nákup-blok** (hard ROLLBACK, ne UX hint), promoter-konfigurovatelný per event (`social_distance_seats` CHECK 0–5). Zda regulační závisí na jurisdikci/období zdravotních opatření; funkčně vynucené. Tichý rozpad renamem VYLOUČEN měřením (naopak restore).
- **Commit samostatně** (checkout, write-gating cesta).

---

# 🏁 STAV — 2026-07-16 (DÁVKA 3 UZAVŘENA + kde dál)

## ✅ CLOSING — DÁVKA 3 (redirect pool) KOMPLETNÍ

**1) HOTOVO — 3 commity, vše ověřeno reálným během na ephemeral clonu:**
| commit | co | ověření |
|---|---|---|
| `6dc23f5` | currency redirect (box-office/sell + waitlist, ticket_types→events) | multi-currency, 17/17 + 6/6 |
| `8471666` | buyer_email + buyer_name redirect (ticket-pdf, orders→identity.users) | 4 scénáře, 24/24 |
| `8af3b08` | checkout purchase-limit **OR-email ODSTRANĚNÍ** (ne redirect) | oběma směry, 9/9 |

**Redirect pool uzavřen. Git: 26 commitů nad origin, NEpushnuto, tree čistý** (mimo untracked docs + `settings.local.json`).

**2) checkout fix — proč odstranění, ne redirect:** OR-větev `(o.user_id=$2 OR LOWER(o.buyer_email)=LOWER($3))` **dokázána redundantní** — guest-upsert + unique index `uq_identity_users_email_active` → email→user_id **1:1** (pokus o 2. ne-anon user se stejným emailem → **23505**); $2 vzniká z téhož emailu jako $3 → `o.user_id=$2` chytí vše. Fix `→ AND o.user_id=$2`. Limit **reálně enforcuje** (má 2 → OK; 3. → blok). **Tracked bug `project_purchase_limit_buyer_email` OPRAVEN.**

**3) ZBÝVÁ (kde příště):**
- **🟡 WRITE-RENAME POOL** — nová třída (WRITE → reálný běh oběma směry, NE PREPARE):
  - **`tracking_events` INSERT** (`lib/tracking/tiktok-capi.ts:106`) — 3 co-drifty: `event_name`→`event_type`, `platform`→`provider`, `promoter_event_id`→`event_id`. Fire-and-forget `.catch(()=>{})` → **dnes tiše selhává** (tracking audit se nezapisuje); po fixu ožije. Severita nízká (ne peníze/vstup), ale tichý drift.
  - **`capacity_remaining`→`remaining_qty`** — **UPDATE decrement INVENTÁŘE** (`SET capacity_remaining = capacity_remaining - 1`). Třída **jako oversell** — funkčně citlivé, chyba = špatný inventář. **VLASTNÍ pozornost, ne dávka**, reálný běh.
- **guest-create helper** (HIGH, systémový root-cause, samostatná session).
- **dead-feature:** `programs/[eventId] is_published` (průzkum — dead vs redirect nedořešeno).
- **Tickety §7** (T-PAYOUT-SCHEMA, T-WL-PAYMENT-ROUTING, T-BOXOFFICE-RESTORE) — produktová rozhodnutí, ne remediace.

**4) METODA write-rename (příště):** za **viditelným** driftem čekej **maskovaný blocker** (box-office měl 2: expires_at 23502 + payment_provider 23514; guest-create měl skrytý řetěz) — guard/PREPARE je slepý na NOT NULL/CHECK/wrong-schema → **reálný běh OBĚMA směry na ephemeral clonu**, ne PREPARE. Dvojí audit: co-drift VŠECH sloupců + konzumpce.

---

# 🏁 STAV — 2026-07-15 (DÁVKA 3 redirect: currency + buyer_email)

## ✅ ZÁVĚR DÁVKY 3 (dnešek) — TL;DR

**1) HOTOVO (DÁVKA 3 redirecty, 3 commity):**
- `6dc23f5` — **currency redirect** box-office/sell + waitlist (reálný běh multi-currency CZK+EUR, 17/17 + 6/6); navíc odhalil blockery → **T-BOXOFFICE-RESTORE** (§7).
- `8471666` — **buyer_email + buyer_name redirect** ticket-pdf (reálný běh 4 scénáře 24/24, vč. anonymized GDPR placeholder).
- `8af3b08` — **checkout purchase-limit OR-email ODSTRANĚNÍ** (ne redirect — OR-větev redundantní po guest-upsert kanonizaci; unique index email→user_id 1:1). Fixuje tracked bug (`project_purchase_limit_buyer_email`). Reálný běh oběma směry, 9/9.
- **Git: 26 commitů nad origin, NEpushnuto, tree čistý** (mimo untracked docs + `settings.local.json`).

**2) METODA redirectu potvrzena:** kardinalita se **OVĚŘUJE ze schématu**, netipuje se — currency 1:1 (event_id NOT NULL FK), buyer_email **taky 1:1** (orders.user_id NOT NULL FK → identity.users, email NOT NULL). *Varování na non-1:1 se u buyer_email NEPOTVRDILO — ověřeno reálně, ne odhad.* **3 pasti redirectu:** (a) duplicity — je JOIN 1:1? (b) NULL/drop — INNER (řádek zmizí) vs LEFT (NULL); tady user_id NOT NULL → INNER nezahodí; (c) hodnota — správná per řádek, vč. **anonymized = placeholder, ne cizí/NULL**.

**3) COMMIT HYGIENA:** `6dc23f5` má pomlácenou zprávu (bash ≠ PowerShell here-string; `@'...'@` se rozbije na `'`/`<`). **Obsah commitu OK.** Opravit **při deploy-přeskládání** (mig 450/451 pořadí), NE riskantním rebasem teď. **Napříště: `git commit -F <soubor>`.**

**4) ZBÝVÁ (kde příště):** *(DÁVKA 3 redirecty HOTOVY — currency + buyer_email + checkout OR-email)*
- **WRITE-RENAME POOL:** `tracking_events` INSERT (3 co-drifty, fire-and-forget audit) + `capacity_remaining`→`remaining_qty` (UPDATE decrement inventáře). Společná třída: write → reálný běh na ephemeral clonu, ne PREPARE.
- **guest-create helper** (HIGH, systémový root-cause, samostatná session).
- **Tickety §7** (T-PAYOUT-SCHEMA, T-WL-PAYMENT-ROUTING, T-BOXOFFICE-RESTORE, funkční) — produktová rozhodnutí.

> ✅ **checkout:916/942 VYŘEŠENO 2026-07-15** (`8af3b08`) — bylo NEJcitlivější; dopadlo na **odstranění OR-větve** (ne redirect). Průzkum PŘED opravou potvrdil redundanci (unique index `uq_identity_users_email_active` → email→user_id 1:1; $2/$3 z téhož emailu; anon scrub ≠ $3). Reálný běh oběma směry (enforce blok+povol, SUM bez duplicit, 23505 redundance-důkaz, žádný masked blocker). Detail v §1b.

---

## 1) HOTOVO dnes (2 commity, redirecty)
| commit | rodina | ověření |
|---|---|---|
| `6dc23f5` | `currency` z ticket_types → events (box-office/sell + waitlist) | **reálný běh** ephemeral clone, 17/17 + 6/6 |
| `8471666` | `buyer_email` + `buyer_name` z orders → identity.users (ticket-pdf) | **reálný běh** ephemeral clone, 4 scénáře, 24/24 |

> ⚠️ Pozn.: commit `6dc23f5` (currency) má kosmeticky pomlácenou zprávu (`@` wrappery + stripnuté uvozovky, `status=published` místo `'published'`) — bash tool NENÍ PowerShell here-string, `@'...'@` nefunguje jako heredoc + rozbíjí se na `'`/`<`. Obsah commitu je korektní; oprava zprávy by chtěla interaktivní rebase (blokováno). **Napříště: commit message přes soubor + `git commit -F`.**

## 1b) buyer_email redirect — ticket-pdf HOTOVO, checkout ZBÝVÁ (jiná třída)
- **Kardinalita OVĚŘENA 1:1** (ne non-1:1, jak se obávalo): `orders.orders` nemá žádný email sloupec → email teče přes `user_id` → `identity.users.email`. `orders.user_id` **NOT NULL FK**, `identity.users.email` **NOT NULL**. Guest = guest-user řádek s reálným emailem → **žádná objednávka bez user_id** → INNER JOIN nikdy nezahodí, email nikdy NULL.
- **Anonymizace** (`process-gdpr-deletions:45`): email scrubnut na `anonymized-<id>@deleted.tixly.cz` (NOT NULL placeholder, ne NULL) — jediná reálná past je **hodnota** (3c), ne NULL/drop. Ověřeno: anonymized order → řádek přežije, buyer_email=placeholder (GDPR-correct).
- **ticket-pdf:53** (reprezentant) — co-drift `buyer_email` + `buyer_name` (oba fantom na orders), INNER JOIN identity.users. Plný dotaz (14 sloupců) auditován, žádný další co-drift. Read path → žádný masked INSERT-blocker.
- **⏭️ checkout:916/942 — ZBÝVÁ, JINÁ TŘÍDA (tracked bug `project_purchase_limit_buyer_email_2026-07-04`):** `WHERE (o.user_id=$2 OR LOWER(o.buyer_email)=LOWER($3))` v purchase-limit **SUM agregaci**. Vlastní scénářový harness + PŘED opravou zjistit:
  1. **AGREGACE duplicity:** přidání `JOIN identity.users` do `SUM(oi.quantity)` dotazu → ověřit reálným během COUNT+SUM před/po na seedu s víc objednávkami téhož kupce, že JOIN **NEZDVOJÍ** součet (zdvojení = špatný limit). users je 1:1 s orders (FK), tak by nemělo — ale ověřit, ne předpokládat.
  2. **OR-EMAIL SÉMANTIKA:** zjistit, jestli `OR LOWER(u.email)=LOWER($3)` ještě něco PŘIDÁVÁ nad `o.user_id=$2` **po guest-upsertu** (`ON CONFLICT (email) WHERE anonymized_at IS NULL` už kanonizuje email→user id). Precedent RESELLER: OR-větev byla **redundantní** (user_id pokrýval téhož kupce). **Možná fix NENÍ redirect, ale ODSTRANĚNÍ OR-větve** → rozhodnout dle nálezu, říct uživateli PŘED opravou.
  3. **Purchase-limit = nákup-blok** → reálný běh OBĚMA směry (blokuje když překročeno, pouští když ne, se správným součtem) — jako x→x_coord.
- **foyer-orders/route.ts** = INSERT do `foyer_orders (user_id, buyer_email)` = **nedostavěný foyer subsystém** (sloupce neexistují, §Třída 3), NE redirect → foyer ticket.

- **Rodina = 2 živé lokace** (ne 3): `box-office/sell:56` + `waitlist/[entryId]:65`. `press` už opraveno `d29d435` (baseline stale). `accreditation`/`comps`/`guestlist` už mají `e.currency` JOIN, `box-office/route.ts:33` už má subquery — ne drift.
- **Fix = subquery** `(SELECT currency FROM catalog.events WHERE id=$evt)`, zrcadlí sourozence `box-office/route.ts:33`. U `box-office/sell` (má `FOR UPDATE`) subquery drží zámek jen na ticket_types (JOIN by zamykal i events → kontence per POS prodej).
- **waitlist skrytý CO-DRIFT** (guard viděl jen currency): `WHERE status='published'` — ticket_types nemá `status` (má `visibility`) → `visibility='public'` (kanonický vzor comps/press/guestlist).
- **Redirect ≠ rename ověřeno:** 3a duplicity (subquery i JOIN → 4 řádky == 4 tt, event_id NOT NULL FK = 1:1), 3b NULL (events.currency NOT NULL + FK → nikdy NULL), 3c hodnota (CZK event→CZK, EUR event→EUR per řádek, perzistuje do orders.currency správně; waitlist visibility filtr bere nejlevnější PUBLIC ne hidden). Harness: `scratchpad/verify-currency-redirect.mjs` + `verify-currency-exact.mjs`.

## 2) 🔴 SEVERITY + METODICKÝ nález — reálný běh odhalil 2 MASKOVANÉ blockery ZA currency driftem
**Reprezentant box-office/sell má 3-deep blocker stack** (currency 42703 → maskuje zbytek):
1. `currency` 42703 (SELECT `:56`) — padne první.
2. `expires_at` **23502** (order INSERT `:87`) — NOT NULL bez defaultu, route ho **neuvádí**.
3. `payment_provider='box_office'` **23514** (`:90`) — mimo enum **i po mig 451** (ta přidala jen kiosk_card/reseller_cash).

**→ §5 lekce POTVRZENA ZNOVU:** currency redirect byl **korektní**, ale **PREPARE by blockery #2/#3 NEVIDĚL** (parse-only, slepý na 23502/23514). Jen **reálný běh** je odhalil. Currency fix je i tak správná remediace — **odmaskováním se nic nezhorší**, jen se odkryje pravý stav (POS prodej byl mrtvý už na currency; teď je mrtvý na dalších dvou, fail-closed). box-office/sell **není čistý restore** jako x→x_coord — obnova = samostatný ticket **T-BOXOFFICE-RESTORE** (viz §7).

---

# 🏁 STAV — 2026-07-09 (redirect/rename pool)

## 1) HOTOVO dnes (6 commitů, redirect/rename pool)
| commit | rodina | ověření |
|---|---|---|
| `217dd5c` | doc_type + event_date + published→status (alias-zpět / WHERE-ekvivalence) | PREPARE (display) + kanonický vzor |
| `d29d435` | comps+press free-ticket gate → visibility='public' | reálný běh (write, 12/12) |
| `7dfd106` | row_label→row display (memory + commemorative) | PREPARE (display) |
| `8ee2766` | exchange row_label→row + seat_num→seat_number (co-drift) | reálný běh (write/funkční, 12/12) |
| `3c53e84` | x→x_coord + y→y_coord sociální-odstup | reálný běh OBĚMA směry (7/7) |

**Metoda držela:** display renamy → PREPARE stačí; write/funkční konzumpce → reálný běh na ephemeral clonu (vždy vytvořena i smazána). Dvojí audit (co-drift VŠECH sloupců + konzumpce) u KAŽDÉ rodiny — odhalil skryté co-drifty za guardem (uploaded_at, seat_num, y, press currency+sort_order).
**Git: 23 commitů nad origin, NEpushnuto, tree čistý** (mimo untracked docs + settings.local.json).

## 2) SEVERITY nálezy dnešní dávky (víc než kosmetika — „kosmetika" byl znovu špatný odhad)
- **x→x_coord NEBYLA kosmetika:** `:675` (held-seat fetch) shazoval **CELÝ seated checkout** (42703, nezávisle na distN) + tiše vypínal **sociální-odstup enforcement** (vynucený hard-block). Rename = **RESTORE dvou funkcí**, ne kosmetika. Regulační: měřením potvrzeno, že po fixu blokuje (i hraniční dx==distN) a nepouští false-positive.
- **comps/press:** fantom `is_published` (nikdy neexistoval) shazoval **celé free-ticket vydání od inception** (5b87b71). Restore, ne rename.

## 3) ZBÝVÁ — kde pokračovat příště
- **DÁVKA 3 REDIRECTY (JINÁ třída — mění co dotaz VRACÍ, ne rename):** `currency` (z events), `buyer_email` (JOIN identity.users). Vyšší péče.
- **WRITE-RENAME POOL** (viz §6 výše): `tracking_events` INSERT (3 co-drifty, fire-and-forget audit), `capacity_remaining`→`remaining_qty` (UPDATE decrement inventáře — třída jako oversell).
- **guest-create helper** (HIGH, systémový root-cause, samostatná session).
- **dead-feature:** `programs/[eventId] is_published` (průzkum nedořešen — dead vs redirect).

## 4) METODA pro redirect pool (příště)
**Redirect ≠ rename.** Rename = tentýž sloupec pod jiným jménem (alias-back, hodnota identická). Redirect = hodnota se bere odjinud (JOIN/jiná tabulka) → **mění co dotaz vrací**. Proto:
- ověř, že JOIN vrací **správnou hodnotu bez duplicit** (kardinalita — LEFT JOIN může znásobit řádky) **a bez NULL** (chybějící match),
- **reálný běh, ne PREPARE** (PREPARE ověří jen že dotaz parse-uje, ne že vrací správná data).
3. **guest-create helper** — pořád **HIGH ticket samostatně** (8+ kopií INSERT INTO identity.users, guard slepý, tichý duplikát risk; refactor + runtime E2E, vlastní session/review). **[KOREKCE 2026-07-30: 8 byl podhodnocený odhad z poznámky — grep našel 25. Stav: 7 přepojeno na sdílený helper, 18 kopií ZBÝVÁ. Viz §1 nahoře.]**
4. **Tickety §7** (T-PAYOUT-SCHEMA + T-WL-PAYMENT-ROUTING + funkční 4) — produktová rozhodnutí, ne remediace.

## 7) TICKET-KANDIDÁTI z konzumačního auditu (2026-07-05) — NEremediace
Metoda: u „exists-nowhere" (truly-missing) sloupců grep konzumaci → *consumed = ticket, ne kosmetika*. 7 nálezů. Financial výš.
> Pozn. dosažitelnosti: projekt je **předprodukční** (žádná živá doména) → „REACHABLE" = kód-dosažitelné / ne-dead-guarded, ne „padá v živém provozu". Kontrast: program `:2233` byl dead-code za 503 guardem — tyhle NEJSOU.

### 🔴 FINANČNÍ — vyšší severita

#### 🎟️ T-PAYOUT-SCHEMA — „payout provider schéma nedomigrováno na promoters" (JEDEN ticket)
**Chybějící sloupce na `platform.promoters`:** `wise_recipient_id` + `paypal_payout_email` + `payout_currency`. (Tabulka reálně má jen `iban, swift_bic, payout_method, primary_currency, auto_payout_days_after_event`.)
- **Fakt:** žádný z těch 3 nikdy v DB (baseline i větev). Guard viděl jen `payout_currency` — 42703 spadl na první; `wise_recipient_id` + `paypal_payout_email` byly **skrytý co-drift** za ním.
- **Konzumace:** payout provider-selection (Wise/PayPal): `row.wise_recipient_id` (cache Wise recipient) + `UPDATE promoters SET wise_recipient_id`; `row.paypal_payout_email` (PayPal cesta); `row.payout_currency ?? row.currency` (override měny výplaty).
- **Dosažitelnost:** SELECT v `fetchPendingPayouts` (executor.ts:283, cron `internal/cron/payouts-execute` — auth `INTERNAL_SERVICE_TOKEN`, ne dead-guard) **i** manuál `admin/payouts/execute:48` (platform-admin). Oba 42703 na SELECTu **PŘED** provider logikou → fallback `?? currency` (executor:64) **nedosažitelný**.
- **Dopad / severita:** automatický payout (cron + manuál) **fail-closed 42703 → nevyplatí NIC; žádné špatné peníze neodejdou.** „Tiše jiná měna" se NEmaterializuje. **Payout nefunkční, ale fail-closed.**
- **Produktové rozhodnutí:** (a) **dostavět provider vrstvu** = migrace přidá `wise_recipient_id` + `paypal_payout_email` na promoters; **NEBO** (b) `payout_currency` je nejspíš jen **rename→`primary_currency`** (existuje) — ne nový sloupec. Tj. reálně 2 sloupce doplnit + 1 rename.

#### 🎟️ T-WL-PAYMENT-ROUTING — white-label order routing čte neexistující promoter sloupec (JEDEN ticket)
**Chybějící sloupec:** `platform.promoters.default_payment_provider`.
- **Fakt (ověřeno read-only proti prod větvi):** promoters nemá ŽÁDNÝ payment/provider/default sloupec. Čte se **jen** v `v1/wl/orders:107` (`p.default_payment_provider AS payment_provider`) — nikde jinde v kódu, žádná migrace ho nepřidává, žádné admin UI ho nesetuje.
- **Konzumace:** routing platby při tvorbě WL objednávky (výběr providera).
- **Dosažitelnost:** REACHABLE za `verifyWlToken` (white-label tenant, ne dead-code); SELECT v transakci (FOR UPDATE) → 42703 → **WL objednávka 500, nevytvoří se**. Reachable, hard-fail, **fail-closed**.
- **🔎 Verdikt WRONG-SCHEMA (ne missing-column):** kanonický model je `orders.payment_provider` **per-objednávka** (existuje; hlavní checkout ho SETuje podle payment logiky — GoPay/ComGate/b2b_credit), **ne** per-promoter default. WL kód čte per-promoter sloupec z designu, který nikdy nedoběhl (0 setterů, 0 migrací, 0 dalších čtenářů).
- **Produktové/schéma rozhodnutí:** (a) má promoter mít default payment provider → dostavět sloupec + migrace + config UI + setter; **NEBO** (b) WL routing má jít stejnou cestou jako hlavní checkout (provider per-objednávka, ne promoter default) → přepsat dotaz, žádný nový sloupec. **Evidence míří na (b)** — je to wrong-schema, ne zapomenutý sloupec.
- **Samostatný od T-PAYOUT-SCHEMA:** jiná cesta (order-create routing ≠ payout execution), jiný dopad.

### 🎫 FUNKČNÍ (feature nefunguje, ne peníze)

#### 🎟️ T-BOXOFFICE-RESTORE — pokladní (box-office) + walk-in prodej mrtvý na naskládaných blockerech (JEDEN ticket)
> Odhaleno reálným během při currency redirect (2026-07-15). Currency drift byl JEN první z tří; jeho oprava (commit currency redirect) odmaskovala dva další. **NEpatří do currency commitu** (samostatná migrace na sdílený constraint).
- **Blocker #2 — `expires_at` 23502:** `box-office/sell/route.ts:87` order INSERT **neuvádí `expires_at`** (orders.orders: NOT NULL, **bez defaultu**). → 23502 na INSERTu i po currency fixu. (`waitlist/[entryId]:95` `expires_at` UVÁDÍ — tenhle blocker má **jen box-office/sell**.)
- **Blocker #3 — `payment_provider` enum 23514:** `box-office/sell:90` posílá `'box_office'`, `waitlist:93` posílá `'walkin'` — **ani jedno v `orders_payment_provider_check`**. mig 451 přidala jen `kiosk_card`+`reseller_cash` (kiosk/reseller), tyhle dvě vynechala. → 23514 na INSERTu.
- **Řešení = migrace na sdílený `orders.orders` constraint** (aditivní, vzor mig 451/444):
  - Přidat `'box_office'` + `'walkin'` do `orders_payment_provider_check`.
  - **Precedent ověřen (mig 451):** aditivní rozšíření je bezpečné, `orders.orders` prázdná (předprodukce).
  - **Reader výčtu ověřen:** jediný čtenář `payment_provider` je parametrizovaný WHERE filtr (`platform/webhooks/route.ts:49`, `pe.payment_provider = $i` na jiné tabulce) — **žádný hardcoded match na hodnotu**, hodnoty jsou write-only labely (dle komentáře mig 451). → přidání nic nerozbije.
  - **SÉMANTIKA (rozhodnout v ticketu):** `'box_office'` (obsluha u pokladny, box_office_session) vs `'walkin'` (waitlist→order konverze) jsou **sémanticky odlišné** — konzistentní s granularitou mig 451 (kiosk_card ≠ reseller_cash). Doporučení: zachovat oba distinct labely. Alternativa (obecnější jeden label) = produktové rozhodnutí.
  - **+ box-office/sell doplnit `expires_at`** do INSERTu (blocker #2) — např. `NOW() + INTERVAL '45 minutes'` jako waitlist, nebo NULL-able dle záměru (pending POS order expiry).
- **Dosažitelnost / dopad:** box-office/sell (pokladní prodej, za `runAsPromoter`) + waitlist walk-in konverze (za `runAsActivePromoter`) — oba REACHABLE, **hard-fail 500, fail-closed** (žádná objednávka nevznikne, žádné špatné peníze). Mrtvé do vyřešení. Předprodukce → nepadá živě, jen kód-mrtvé.

- **membership_code** — `tickets.cross_pass_memberships`; NIKDY v DB (baseline+větev, žádný code sloupec). Konzumace: **QR scan-payload** ve wallet passech (`qrPayload`, `QRCode.toBuffer`) + label „KÓD:". Skener u brány čte UUID+TOTP, ne tenhle kód. Dosažitelnost: REACHABLE — `wallet/pdf` + `my-memberships` bez env-guardu → 500 (`wallet/apple` je za `APPLE_PASS_*` env). + co-drift `valid_until` (taky chybí → redirect `b.ends_at`).
- **review_token** — `catalog/orders event_reviews` (alias er); NIKDY v DB. Konzumace: `WHERE er.review_token = $1` — **lookup klíč z review-linku**. Dosažitelnost: REACHABLE — `reviews/[token]` GET (otevření odkazu) → 42703.
- **reviewer_email** — `event_reviews`; NIKDY v DB. Konzumace: `INSERT (…, reviewer_email, …)` — **write target**. Dosažitelnost: REACHABLE — `admin/reviews/send-requests` (admin posílá žádosti o recenzi) → 42703 na INSERTu.
- **attribution_data** — campaigns (alias c.); NIKDY v DB. Konzumace: `WHERE (c.attribution_data::jsonb)::text LIKE …` — **filtr v dotazu** (attribution matching). Dosažitelnost: REACHABLE — `admin/marketing/overview` (načtení přehledu) → 42703.

---

## 📍 STAV — kde pokračovat zítra (poslední update: 2026-07-04, konec dne)

### 1) Git
- **origin/master = `ec58191`** — build fix (self-host pdfjs worker), **deployed na Vercel** (READY).
- **Lokál `master` = ec58191 + 5 remediačních** (rebase hotový, čistý, **NEpushnuto**):
  - `b45683e` fix(issuer) — advisory lock + ticket_seq + ON CONFLICT (#4 RACE)
  - `75e5b52` feat(mig 450) — UNIQUE(order_id,ticket_type_id,ticket_seq)
  - `69d8051` fix(postpone) — event_broadcasts drift + log warn
  - `e5e5632` fix(support-action) — odstraň rozbitý ticket_transfer_log INSERT
  - `3d7e428` fix(ticket-changes) — odstraň .catch polykač + oprav refund drift
  - (pozn.: hashe se změnily rebasem; obsah identický, build-fix duplikát `541e501` vypadl.)

### 2) Hotovo & ověřeno (proti čerstvým prod-clone větvím, vždy smazaným)
- **Build fix** — odblokoval Vercel buildy (produkce visela na f97be8e2; padalo od d0ec6d6 na pdf.worker Terser). Ověřeno lokálně `npm run build` zelený + worker 200 application/javascript.
- **Třída 1 (FALSE SUCCESS) KOMPLETNÍ** — cancel (63b52ec, už na origin) + latentní ticket-changes, support-action, postpone cousin. Empiricky: jediný pravý FALSE SUCCESS byl cancel; ostatní byly „náhodou 500" (25P02), opraveny i tak.
- **#4 RACE (double issuance)** — mig 450 UNIQUE backstop (A) + issuer advisory lock (B). Ověřeno: PŘED 6 lístků (M=3) → PO přesně 3.
- **Projekt je PŘEDPRODUKČNÍ** — `app.tixly.cz` NEexistuje v DNS (NXDOMAIN, ověřeno Google+Cloudflare), `tixly.cz` míří na AWS (jiná infra). **Žádná živá doména, mig 450 NEaplikovaná na žádnou živou DB, žádná urgence.**

### 3) 🟠 TŘÍDA 3 ORPHAN (checkout `2200/2211/2233`, POST-commit `:2128`) — PRŮZKUM HOTOV
- **Potvrzeno průzkumem (čerstvá prod-clone větev, viz „✅ Třída 3 foyer" níže):**
  - `orders.foyer_order_items` **tabulka NEEXISTUJE** (42P01).
  - `orders.foyer_orders` **EXISTUJE, ale denormalizovaná** — `items` jsonb NOT NULL, BEZ `user_id`/`buyer_email`; vazba na kupce jen přes `order_id`.
  - `catalog.event_programs` je **rozvrhová/timetable tabulka** (starts_at/ends_at/artist_name/display_order); `program_price_halire`/`is_published` NEEXISTUJÍ nikde → booklet-subsystém nepostaven.
- **foyer `:2200/:2211` → ✅ DISABLE HOTOVO & OVĚŘENO** (viz sekce níže). 
- **program `:2233` → ✅ (b) DEAD-FEATURE + GUARD HOTOVO & OVĚŘENO** (viz sekce níže). Baseline dluh ponechán, fail-closed early-guard proti direct-API.
- **⏭️ DALŠÍ V POŘADÍ: TŘÍDA 4** (renamy/nepostavené subsystémy) nebo TŘÍDA 5 (dávkově).

### 4) Pak (pořadí)
- **4a) Renamy** (kiosk→platform.promoters, reseller→identity.users, aj. z třídy 4).
- **→ Třída 5 dávkově** (~137 nálezů; dominuje `updated_at` ×30, `description` ×10, `status of users` ×6) — mechanické, fail-safe.
- **Mimo řadu (kdykoli):** CI secret `NEON_API_KEY` do GitHub Environmentu `schema-drift` (bez něj guard job v CI padá); **deploy-pořadí mig450 → issuer** až při REÁLNÉM nasazení (b45683e ON CONFLICT vyžaduje index z 75e5b52).

---

## ✅ #1 FALSE SUCCESS — buyer cancel „zruší" objednávku, ale nezruší — **OPRAVENO & OVĚŘENO**

**Soubor:** `nextjs-boilerplate/src/app/api/buyer/orders/[orderId]/cancel/route.ts` (INSERT `:140`, COMMIT `:151`)

### Co bylo (bug — 3 vrstvy)
1. INSERT do `orders.refund_requests` cílil sloupec **`amount_halire`**, který v prod schématu
   **neexistuje** (skutečný sloupec je `refunded_halire`). → `42703 undefined_column`.
2. INSERT **vynechával `user_id`**, který je v tabulce **NOT NULL** (ověřeno z `information_schema`).
3. **Jádro (nejzávažnější):** INSERT byl obalený `.catch(() => null)`. `42703` zabortoval transakci,
   `.catch` chybu spolkl, a následný `COMMIT` na aborted tx Postgres provede **tiše jako ROLLBACK**.
   Všechny předchozí mutace (order→`cancelled`, tickety→`revoked`, restore stocku) se zahodily,
   ale endpoint přesto vrátil **HTTP 200 „Objednávka zrušena, refund do 7 dní"**. → tichá lež
   + ztracený refundační závazek vůči kupujícímu.

### Co je teď (fix)
- `amount_halire` → **`refunded_halire`** (sloupec, který reálně existuje).
- Doplněn **`user_id`** (= `order.user_id`, tj. kupující) do INSERT listu.
- **Odstraněn `.catch(() => null)`** (rozhodnutí odsouhlaseno uživatelem — Varianta A „propagovat"):
  refund_request NENÍ best-effort. Když selže, chyba probublá do existujícího outer `catch (e)` (`:163`),
  který dělá `ROLLBACK` + vrací `500 DB_ERROR`. Tím je celý cancel **atomický** — když refund_request
  nejde vytvořit, order se NEoznačí jako cancelled a kupující dostane reálnou 500, ne falešnou 200.
  4xx zamítnuto: schema/DB selhání není chyba klienta (patří 5xx).

Výsledný INSERT:
```sql
INSERT INTO orders.refund_requests
  (order_id, user_id, refunded_halire, reason, status, promoter_id)
VALUES ($1, $2, $3, $4, 'pending', $5)
```

### Jak ověřeno (ne jen „kód se změnil")
Proti **čerstvé prod-clone Neon větvi** (`br-sweet-moon-al8ndyd7`, klon z production `br-rough-paper-alom0zky`,
role `neondb_owner`), harness `scratchpad/verify-cancel.mjs` (pg 8.20, věrná replika SQL sekvence route handleru):

1. Ověřeno z `information_schema`: `amount_halire` neexistuje; `refunded_halire` existuje; `user_id` NOT NULL.
2. Naseedovány 2 identické **paid** objednávky (30000 halíř, 3 valid tickety), promotér/venue/event/ticket_type.
3. **BUGGY varianta** (původní SQL + `.catch` + COMMIT) → odpověď `HTTP 200 "…refund 300 Kč…"`,
   ale DB **nezměněná**: order `paid`, 3 lístky `valid`, **0 refund_requests**. → **lež reprodukována** (200 + nezměněná DB).
4. **FIXED varianta** → `HTTP 200`, DB **konzistentní**: order `cancelled`, `cancellation_refund_status='pending'`,
   3 lístky `revoked`, **1 refund_request** s `refunded_halire=30000`.
5. Kontrolní důkaz: původní INSERT sám o sobě hodí `42703 column "amount_halire" … does not exist` — přesně to polykal `.catch`.

Všechny aserce zelené (exit 0). Typecheck: `npx tsc --noEmit` — 0 chyb v cancel/route.ts.
Prod-clone větev po ověření **smazána** (`delete_timeline: scheduling`).

### Poznámky / zbytek
- Ověřeno jako `neondb_owner` (bypass RLS). Bug je schema-level (`42703`), nezávislý na RLS roli
  → reprodukce věrná; RLS nemá na COMMIT-as-ROLLBACK vliv.
- Vzor `.catch(()=>null)` kolem tx-kritických INSERTů je systémové riziko (viz HANDOFF §5) —
  jinde neřešeno v tomto kroku.
- Commitnuto samostatně: `63b52ec` (jen `cancel/route.ts`).

---

## ✅ #2 GATE OUTAGE — cross-pass + guestlist holder neprojde u vstupu — **OPRAVENO & OVĚŘENO**

Dva výskyty stejné třídy (schema drift → 42703 → deny-only gate outage). Opraveny v jednom kroku.

### a) cross-pass — `admin/scanner/cross-pass/route.ts` (INSERT `:171`)

**Co bylo:** INSERT do `tickets.cross_pass_redemptions` uváděl sloupec **`event_day_id`**. 42703
zabortoval transakci → outer catch → ROLLBACK → **500**. Každý platný cross-festival pass u brány
byl odmítnut (deny-only), žádná korupce (čistý rollback před commitem).

**Zjištění ze schématu (prod-clone `br-flat-shadow-alfclq4g`, `information_schema`):**
`tickets.cross_pass_redemptions` má přesně 5 sloupců — `id, membership_id, event_id, redeemed_at,
scanned_by_user_id`. `event_day_id` **neexistuje ani pod jiným jménem** (žádný sloupec s `%day%`).
Tabulka `catalog.event_days` sice existuje, ale redemptions na den **nevážou**; idempotence (`:154`)
je klíčovaná na `(membership_id, event_id)`. → **Není to přejmenování ani chybějící vazba** — datový
model je per-event.

**Co je teď (fix):** odstraněn `event_day_id` ze sloupcového listu i hodnoty; `scanned_by_user_id`
posunut na `$3`. Idempotence beze změny.
> **ZÁZNAM (záměr):** `eventDayId` je z requestu (body schema) **nadále přijímán, ale ZÁMĚRNĚ
> nepersistován** — datový model je per-event (idempotence `membership_id + event_id`), per-day
> redemption v tabulce neexistuje. Pokud je per-day reálný požadavek, je to **samostatná featura**
> mimo tuto remediaci (nový sloupec + změna idempotence + souřadná změna chování brány).

### b) guestlist — `admin/events/[id]/guestlist/checkin/route.ts` (UPDATE `:77`)

**Co bylo:** UPDATE `orders.guestlist_entries` nastavoval `updated_at = NOW()`. Endpoint běží přes
`db().query` (autocommit, bez transakce) → 42703 na první mutaci probublá jako unhandled → **500**.
Host se neoznačí `attended` (stav konzistentní, ale host odmítnut u vstupu).

**Zjištění ze schématu:** `orders.guestlist_entries` má `checked_in_at` (nullable), ale **`updated_at`
neexistuje**. UPDATE už `checked_in_at` správně nastavuje.

**Co je teď (fix):** odstraněn `, updated_at = NOW()` ze SET listu (`checked_in_at` zůstává).
Druhý UPDATE na `:87` míří na `tickets.tickets`, který `updated_at` **má** — ponechán beze změny.

### Jak ověřeno (proti čerstvé prod-clone větvi, harness `scratchpad/verify-gate.mjs`, věrná replika obou flow)
Naseedovány prereqs + oddělené řádky pro buggy/fixed běh:

| Brána | PŘED (buggy) | PO (fixed) |
|---|---|---|
| cross-pass | HTTP **500** (42703 `event_day_id`), **0** redemptions — holder odmítnut | **admitted 200**, **1** redemption per-event |
| guestlist | HTTP **500** (42703 `updated_at`), host zůstal `invited`, `checked_in_at` null — odmítnut | **admitted 200**, host `attended`, `checked_in_at` nastaven |

Všechny aserce zelené (exit 0). `npx tsc --noEmit` — 0 chyb v obou souborech.
Prod-clone větev po ověření **smazána**.

---

## 🛡️ CI SCHEMA-DRIFT GUARD (odbočka po #2, HANDOFF §5 bod 2) — POSTAVEN & VALIDOVÁN, NEcommitnuto

**Soubor:** `nextjs-boilerplate/scripts/schema-drift-guard.mjs` (zatím untracked — čeká na potvrzení).

### Zvolený přístup: Varianta A — PREPARE parse-only (potvrzeno uživatelem)
Guard extrahuje (TS AST) KAŽDÝ statický DML dotaz z `.query(...)` v `src/app/api/**` + `src/lib/**`
a nechá ho **PARSNOUT živým Postgresem** přes `PREPARE _g AS <sql>` (parse-only, žádná exekuce).
Chybějící sloupec → `42703`, chybějící tabulka → `42P01` → **DRIFT → CI red**.

**Proč A ne B:** korektnost stojí na parseru Postgresu, ne na reimplementaci SQL scope resolveru
→ ~nula guard-side bugů (klíčové: guard, na který se spoléhá, sám nesmí mít bug).

Ošetřeno per zadání:
1. **Dynamické SQL = viditelná mezera, ne tichý cap.** 134 dynamických dotazů (`${...}`, nelze
   staticky rekonstruovat) guard **vypisuje jmenovitě (`soubor:řádek`)** jako warning. Číslo
   „134 nezkontrolovaných" je sledovatelné v čase (nárůst = signál).
2. **Parse-only mechanika.** `PREPARE → autocommit (bez exekuce)`. `42703/42P01/42704/42P17` = DRIFT.
   `42P18` (nejde odvodit typ parametru) = **PASS** — parse-analýza sloupců proběhla dřív. `42601`
   (syntax/multi-stmt), `42883` (fn), `42803` (GROUP BY), `42P08` (typ param) = INCONCLUSIVE (log, ne drift).
   `search_path` nastaven na všech 80 schémat → žádné falešné 42P01 u nekvalifikovaných názvů.
3. **Validace guardu proti pravdivostní tabulce (self-test) — ✅ PROŠEL:**
   - **Ordering-proof:** dotaz s neexistujícím sloupcem + untyped param → **42703** (ne 42P18) →
     potvrzeno, že 42P18 přichází AŽ ZA column-resolution → pravidlo „42P18 = PASS" DRŽÍ.
   - **GREEN** (3 hotové fixy — nezávislé ověření): `cancel`, `cross-pass`, `guestlist/checkin`
     → všechny **clean** ✅
   - **RED** (zbývající známý drift) → všechny **zčervenaly** ✅:
     `checkout` 655/710 (seated x/y #7), 891/917 (buyer_email #8), 1822 (lottery #10), 1978
     (parking #9), 2200/2211 (foyer #5), 2233 (program #6); `my/tickets/…/transfer` 102 (#11);
     `tickets/transfer/[token]` 15/61 (#11).

### Výsledek běhu proti čerstvé prod-clone větvi (schema-only, po běhu smazána)
```
statických DML: 2374 | dynamických (nekontrolováno): 134 | pokrytí: 94,7 %
SUMMARY: drift=162  inconclusive=5  dynamic-uncovered=134  coverage=94,7%
SELF-TEST: ✅ PROŠEL (guard měří správně)
```

**Klíčové zjištění: drift je mnohem širší než 14 míst z HANDOFF.** Ruční sweep pokryl jen
checkout+refund+scan+transfer; guard sweepnul VŠE a našel **162 drift míst v ~90 souborech**
(season-passes, payouts, lottery admin, foyer, reschedule, reseller, v1/v3 API, kiosk, lib/* …).
Potvrzuje META-ZÁVĚR HANDOFF §5: root cause je systémový (kód proti staršímu schématu), ne 14 bodů.

Pozoruhodné (ukázka hodnoty guardu):
- `admin/ticket-changes/[changeId]/route.ts:131` — **`amount_halire` na `refund_requests`**, stejný
  `.catch` polykač jako cancel. POZOR: klasifikace níže tuto domněnku KORIGUJE — empiricky je to
  třída 5 (500), NE třída 1. Viz „Klasifikace 162 nálezů".
- `reseller/sale` míří na **`auth.users`** a `kiosk/order` na **`catalog.promoters`** (42P01) —
  špatná schémata (Supabase-ismy / přesun tabulek), ne jen přejmenované sloupce.
- 2× `42803` (GROUP BY) = latentní runtime bugy jiné třídy — guard je poctivě NEoznačil jako drift.

### Neblokující baseline režim (přidáno) — regrese-ochrana od první chvíle
Guard umí 3 režimy: STRICT (padá na jakémkoli driftu), `--write-baseline` (zapíše snapshot),
`--baseline` (NEBLOKUJÍCÍ — padá jen na NOVÉM driftu nad baseline). Baseline snapshot současných
162 known-drift míst je v **`scripts/schema-drift-baseline.json`** (137 klíčů; klíč = `soubor+kód+zpráva`
s počtem, odolné vůči posunu řádků — řádek NENÍ v klíči). CI tak od začátku chrání proti regresi,
aniž shazuje na existujícím dluhu. Jak fixy ubývají, `current < baseline` → guard poradí baseline
utáhnout (`--write-baseline`); na 0 → přepnout na STRICT (blocking). 134 dynamických zůstává
jmenovitě ve výpisu jako sledovatelná mezera.

**Ověření neblokujícího chování (2 běhy proti čerstvým ephemeral větvím):**
- Běh A (reálný baseline): `current=162 = baseline` → **exit 0, žádný nový drift** → existující dluh CI neshazuje ✅
- Běh B (baseline zúžený o 2 záznamy): → **exit 1**, přesně ty 2 klíče označeny jako nový drift
  (`base 0 → nyní 1`) → regrese-ochrana měří správně ✅
- Ephemeral create→delete a self-test (truth table + 42P18-ordering) prošly v obou.

### CI integrace — `.github/workflows/schema-drift-guard.yml`
Model: **ephemeral Neon větev per CI běh** — guard s `--ephemeral` si větev sám vytvoří z produkce
a v `finally` smaže (i při chybě), takže zdroj pravdy je vždy čerstvý (ne stale jako `baseline.sql`).
Trigger na push/PR pro `src/**` + `migrations/**` (+ guard/baseline/workflow samy). Spustí
`node scripts/schema-drift-guard.mjs --ephemeral --baseline scripts/schema-drift-baseline.json`.

Bezpečnostní tvrzení (dle review uživatele):
1. **Trigger ZÁMĚRNĚ `pull_request`, NIKDY `pull_request_target`** — guard čte+spouští SQL ze
   zdrojáků proti živé DB s `NEON_API_KEY`; `pull_request_target` s checkoutem PR kódu = RCE/secret-exfil
   (CVE-2025-61671, CVSS 9.3). Fork PR běží bez secrets → guard bez přístupu → žádoucí.
2. **`NEON_API_KEY` v GitHub Environmentu `schema-drift`** (ne jen repo secret) — druhá závora kolem
   klíče, který umí mazat DB větve. Job referencuje `environment: schema-drift`. `permissions: contents:read`.
3. **Delete v `finally` ověřen** — create větve přesunut DOVNITŘ `try`; ephemeral běh proti zúženému
   baseline dal exit 1 (červený) A větev smazána (`br-restless-surf-…`). Po všech bězích: jediná větev = `production` (0 leaků).
4. **Klíč = nejmenší scope** — dedikovaný project-scoped, short-lived CI klíč (create/delete branch +
   connect), NE účtový/org admin token; rotovat. (Neon-side, mimo YAML — na uživateli.)

Provozní podmínky: uživatel musí vytvořit Environment `schema-drift` + do něj přidat secret `NEON_API_KEY`
s omezeným scope. Guard + baseline + workflow commitnuty **lokálně; nepushnuto** (čeká na push uživatelem).

---

---

## 📋 KLASIFIKACE 162 GUARD NÁLEZŮ do tříd HANDOFF §1 (roztřídění, ZATÍM NEOPRAVENO)

> Metoda: každý nález protřízen dle severity. Rozhodující pravidlo pro třídu 1 vs 5 ověřeno
> **empiricky** proti prod-clone větvi (viz „Mechanika" níže), ne odhadem.

### Souhrn
| Třída | Popis | Počet | Stav |
|---|---|---|---|
| **1** | FALSE SUCCESS (tichá 200) | **0 živých** | cancel opraven; jediný pravý výskyt |
| **2** | GATE OUTAGE (nikdo neprojde) | **0 nových** | cross-pass + guestlist opraveny |
| **3** | ORPHAN po commitu (nekonzistentní stav) | **3** | ✅ VŠE HOTOVO: foyer `:2200/:2211` DISABLE; program `:2233` (b) dead-feature + guard |
| **4** | 42P01 špatné schéma / nepostavený subsystém | **22** | hlubší než rename |
| **5** | čistá 500 / dead feature | **137** | fail-safe, ale mrtvé featury |

### 🔑 MECHANIKA třídy 1 (empiricky ověřeno, větev vytvořena i smazána)
Testem minimální tx sekvence proti prod-clone:
- **A) polykač → COMMIT (nic mezi):** COMMIT vrací tag `ROLLBACK`, **žádný throw** → **tichá 200 = TŘÍDA 1**.
- **B) polykač → další dotaz → COMMIT:** další dotaz hodí **25P02** (aborted tx) → probublá → **500 = TŘÍDA 5**.

⇒ **Pravidlo:** `.catch` polykač na drift dotazu je FALSE SUCCESS **jen když je drift POSLEDNÍ dotaz před COMMITem.**
Když mezi polykačem a COMMITem běží jakýkoli další dotaz, ten spadne na 25P02 → 500.

### TŘÍDA 1 — FALSE SUCCESS: kompletní, **přesně jeden živý výskyt**
| soubor:řádek | stav | poznámka |
|---|---|---|
| `buyer/orders/[orderId]/cancel/route.ts:140` | ✅ OPRAVENO (63b52ec) | INSERT refund byl POSLEDNÍ před COMMIT → tichá 200. Jediný pravý FALSE SUCCESS, ověřen naživo. |

**Odpověď na „dvě kopie, nebo víc": ANI JEDNA další živá.** Domnělé kopie byly empiricky třída 5 — **VŠECHNY DOKONČENY:**
| soubor:řádek | proč NE třída 1 | fix |
|---|---|---|
| `admin/ticket-changes/[changeId]/route.ts:131` | mezi polykačem `:136` a COMMIT `:146` běží `UPDATE ticket_changes :139` → 25P02 → 500 | ✅ **b0760c3** — odstraněn polykač + amount_halire→refunded_halire + user_id; ověřeno (feature ožila) |
| `admin/orders/[orderId]/support-action/route.ts:148` | mezi polykačem `:152` a COMMIT `:271` běží `INSERT audit.support_actions :254` → 25P02 → 500 | ✅ **462bea7** — odstraněn rozbitý INSERT (ticket_transfer_log = špatná tabulka; audit zachován přes support_actions); ověřeno |
| `admin/events/[id]/postpone/route.ts:60` (cousin, tichý drop) | autocommit fire-and-forget; core postpone pravdivý, jen ztráta notifikace | ✅ **337dd44** — opraven event_broadcasts drift (channel→pryč, filter='all_buyers', status='sending') + log warn místo null; best-effort zachován; ověřeno |

> **Třída 1 KOMPLETNĚ HOTOVÁ** — cancel (63b52ec) + 3 latentní/cousin (b0760c3, 462bea7, 337dd44).
> Nebezpečný `.catch(()=>null)` polykač na tx-kritickém dotazu je odstraněn ze VŠECH míst.
> Pozn.: baseline (162) lze utáhnout o −3 (ticket-changes:131, support-action:148, postpone:60 už nejsou drift).

### TŘÍDA 2 — GATE OUTAGE: kompletní, **0 nových**
cross-pass (`admin/scanner/cross-pass:171`) + guestlist (`guestlist/checkin:77`) — **OPRAVENY (3283d45)**.
Žádný jiný statický scan/checkin/entry endpoint drift nemá (hlavní scanner cesty jsou čisté — HANDOFF §2 invarianty).

### TŘÍDA 3 — ORPHAN po commitu: 3 (všechny checkout, POST `:2128`)
| soubor:řádek | commit | co |
|---|---|---|
| `checkout/route.ts:2200` | POST | INSERT `foyer_orders` (user_id neexistuje) — HANDOFF #5 |
| `checkout/route.ts:2211` | POST | INSERT `orders.foyer_order_items` (tabulka neexistuje) — HANDOFF #5 |
| `checkout/route.ts:2233` | POST | SELECT `event_programs.program_price_halire` (neexistuje) — HANDOFF #6 |

Boundary: order + inventář už commitnut na `:2128` → buyer dostane 500, ale objednávka drží inventář = orphan pending.

---

## ✅ Třída 3 foyer (`checkout:2200/2211`) — DISABLE **OPRAVENO & OVĚŘENO**

**Rozhodnutí:** (c) DISABLE (ne oprava, ne pouhý baseline). Důvody z průzkumu prod-clone větve:
- `orders.foyer_orders` existuje, ale v **nekompatibilním jsonb tvaru** (`items` jsonb NOT NULL, bez `user_id`/`buyer_email`) — kód psal starý normalizovaný model.
- `orders.foyer_order_items` **NEEXISTUJE** (42P01).
- Celý foyer subsystém je rozbitý E2E — i druhá write cesta `api/foyer-orders/route.ts:98` a admin read cílí týž fantom child table → oprava = **dokončení featury, ne remediace**.
- Blok běží **PO COMMITu `:2128`** → nechat rozbité = aktivně orphanovat objednávky (ne jen deny). A foyer byl **dosažitelný** (loader `/api/events/[id]/foyer-menu` funguje).

**Provedeno (commit samostatný):**
1. **Backend** `checkout/route.ts` — odstraněn celý post-commit foyer blok (`:2178–2227` orig). `input.foyerItems` je záměrně ignorován; `foyerOrderToken` je `const undefined` → odpověď NETVRDÍ foyer úspěch (žádný orphan, žádný false-success).
2. **UI** `checkout/page.tsx` — zaveden `const FOYER_PREORDER_ENABLED = false`, guarduje foyer-menu fetch → `foyerMenu=[]` → fieldset se nevykreslí → buyer foyer nevidí, nevybere, `body.foyerItems` se nepošle, grandTotal foyer nezahrne. **Vypnuto u zdroje**, ne až na backendu (jinak by to byl tichý false-success: buyer vidí menu, „koupí", foyer zmizí).
   - Pozn.: foyer fieldset NEBYL podmíněný žádným feature flagem/event settingem — vykreslil se vždy u eventů s foyer menu; proto zaveden explicitní flag.

**Ověřeno** (`scratchpad/verify-foyer-disable.mjs` proti čerstvé prod-clone větvi, 8/8 ✅, větev smazána):
- OLD: `foyer_orders` INSERT → **42703** (`user_id`), `foyer_order_items` INSERT → **42P01** → handler 500 → objednávka commitnutá = **orphan** (mechanismus reprodukován).
- NEW: 0 foyer SQL v checkout routě (grep) → nic neběží → 0 foyer_orders, `foyerOrderToken===undefined` → handler pokračuje na payment session → **200 bez tokenu**.
- `npx tsc --noEmit` — 0 chyb v checkout souborech (ostatní 2 chyby pre-existing/untracked: rfid gen type, concurrency-harness).

**Baseline:** lze utáhnout o −2 (`checkout:2200`, `checkout:2211` už nejsou drift — SQL odstraněno).

---

## 🎫 FEATURE TICKET (odložená featura, NE remediace) — foyer pre-order → přepsat na jsonb model E2E

> **Není součást schema-drift remediace.** Toto je dokončení half-postavené featury. Do backlogu.

**Cíl:** znovuzapnout foyer pre-order proti REÁLNÉMU schématu (`orders.foyer_orders` s `items` jsonb).

**Rozsah (≥3 soubory + admin read):**
1. `checkout/route.ts` — přepsat foyer zápis na: `INSERT INTO orders.foyer_orders (order_id, event_id, items, total_halire) VALUES (…)` kde `items` = jsonb pole `[{menu_item_id, item_name, quantity, unit_halire}]`; vazba na kupce přes `order_id`→`orders.orders` (žádný `user_id`/`buyer_email` na foyer řádku). Zrušit child-table loop. Ideálně přesunout PŘED COMMIT `:2128` (atomické s objednávkou), nebo ponechat post-commit ale best-effort s log warn.
2. `api/foyer-orders/route.ts:~95/98/165` — stejný přepis (druhá write cesta cílí týž fantom `foyer_order_items`).
3. `admin/events/[id]/foyer-orders/route.ts:53` + `foyer-orders/[id]/...` — READ přepsat na čtení `items` jsonb (dnes SELECTuje neexistující child table → 42P01).
4. UI `checkout/page.tsx` — přepnout `FOYER_PREORDER_ENABLED = true` a ověřit E2E (menu → výběr → order → pickup QR → admin výdej).
5. Rozhodnout účtování: dnes frontend `grandTotal` zahrnuje foyer, ale backend foyer NEúčtuje (foyer_orders je separátní `status=pending`, platí se zřejmě u výdeje) — sjednotit záměr.

**Akceptační kritérium:** buyer s foyer výběrem → objednávka + foyer_orders(items jsonb) konzistentní, pickup QR funguje, admin vidí položky, `schema-drift-guard` na foyer cestách zelený.

---

## ✅ Třída 3 program (`checkout:2233`) — (b) DEAD-FEATURE + GUARD **HOTOVO & OVĚŘENO**

**Rozhodnutí:** (b) DEAD-FEATURE — booklet-subsystém nikdy nepostaven. `catalog.event_programs` je
v prod schématu **rozvrhová/timetable tabulka** (`starts_at/ends_at/artist_name/display_order/zone_id`),
prodejní booklet sloupce **`program_price_halire`/`is_published` NEEXISTUJÍ nikde**. `program_purchases`
+ `program_cast_entries` sice existují, ale centrální booklet-tabulka chybí → **postavit ji = featura**,
ne remediace (NEPSAT migraci tvořící sloupce). Navíc loader `/api/programs/[eventId]:44` padá na
tentýž drift (`is_published`) → z UI je feature **mrtvá** (programInfo=null → checkbox se nevykreslí).

**Provedeno (dle zadání: `:2233` ponechán jako baseline dluh, jen guardován):**
1. **Backend early-guard** `checkout/route.ts` — `if (input.addProgram)` → **`503 PROGRAM_PURCHASE_UNAVAILABLE`**
   umístěný PŘED `client.connect()`/`BEGIN` (vzor podle existujícího crypto guardu `:249`). Fail-closed
   ještě PŘED vytvořením objednávky → žádná objednávka, žádný orphan, čisté odmítnutí místo 42703-crashe.
   - Status **503** (ne 400) — sjednoceno s crypto guardem (`503 PAYMENT_METHOD_UNAVAILABLE`), stejný
     koncept „feature nedostupná"; sémanticky přesnější (request není chybný, feature je nedostupná).
2. **`:2233` blok PONECHÁN** (baseline dluh) — jen okomentován jako NEDOSAŽITELNÝ (early-guard ho odřízne).
   SELECT `event_programs` zůstává drift třídy 3 v baseline (žádný column-fix, žádná migrace).
3. **UI** `checkout/page.tsx` — `PROGRAM_PURCHASE_ENABLED=false` guarduje program fetch → programInfo
   se nenačte → checkbox se nevykreslí (u zdroje, nespoléhat na to, že loader právě teď 500-uje).

**Ověřeno (přímý API POST proti čerstvé prod-clone větvi `br-gentle-art-albog00y`, dev server → větev, větev smazána):**
- `POST /api/checkout` s `addProgram:true` → **HTTP 503 `PROGRAM_PURCHASE_UNAVAILABLE`** (ne 500, ne 42703).
  Tento error kód přichází JEN z pre-connect guardu → dokazuje, že se nedošlo k `connect()`.
  (Re-ověřeno po přepnutí 400→503 proti čerstvé větvi `br-little-cherry-aleb81gf`: 503, 0 objednávek, větev smazána.)
- **0 objednávek** na větvi po POSTu → **žádný orphan** vytvořen.
- Kontrola bez `addProgram` → cesta pokračuje na DB (guard specifický, neblokuje běžný checkout).
- `npx tsc --noEmit` — 0 chyb v checkout souborech.

**Baseline:** `checkout:2233` **ZŮSTÁVÁ** v baseline jako known-drift (záměrně, dead-feature dluh).

---

## 🎫 FEATURE TICKET (odložená featura, NE remediace) — digitální program-booklet subsystém

> **Není součást schema-drift remediace.** Chybí catalog tabulka (`event_programs` je rozvrhová, ne prodejní).

**Cíl:** postavit prodejní digitální program-booklet (dnes `program_purchases` + `program_cast_entries`
existují, ale centrální booklet-catalog chybí).

**Rozsah:**
1. **Migrace** — nová tabulka pro booklet (NE přejmenovat `event_programs` = ta je rozvrhová/timetable):
   sloupce dle kódu loaderu `api/programs/[eventId]/route.ts` — `title, about_text, director_note,
   dramaturg_note, running_time_minutes, intermissions, language, content_warnings,
   program_price_halire, cover_image_url, gallery_urls, is_published`. Zvážit název (`event_program_booklets`?),
   aby nekolidoval s rozvrhovou `event_programs`.
2. **`api/programs/[eventId]/route.ts`** — přepsat SELECT z rozvrhové na novou booklet tabulku.
3. **`checkout/route.ts:2233`** — přepnout na novou tabulku; přesunout PŘED COMMIT (atomické) nebo best-effort.
4. **UI** `checkout/page.tsx` — `PROGRAM_PURCHASE_ENABLED=true`; odstranit backend early-guard `PROGRAM_PURCHASE_UNAVAILABLE`.
5. Admin CRUD pro booklet (dnes žádný — jen `admin/events/[id]/program` míří na rozvrhovou tabulku).

**Akceptační kritérium:** buyer koupí program → `program_purchases` + access_token, viewer `/program/[eventId]`
odemkne obsah; `schema-drift-guard` na program cestách zelený; early-guard odstraněn.

### TŘÍDA 4 — 42P01 špatné schéma / nepostavený subsystém: 22 (dle chybějící tabulky)
| tabulka (chybí) | soubor:řádek | výklad |
|---|---|---|
| `orders.seat_assignments` (+`catalog.seat_maps`,`seat_map_entries`) | `my/orders/[id]/upgrade:72,86,101`, `upgrade-options:33,43,61`, `cron/seat-upgrade-notify:35` | **celý seat-upgrade subsystém nepostavený** (chybí 3 tabulky) |
| `orders.foyer_order_items` | `checkout:2211`(=třída3), `admin/events/[id]/foyer-orders:53`, `foyer-orders:95,165` | foyer-orders sub-tabulka nepostavená (konsolidace do `foyer_orders.items` jsonb?) |
| `auth.users` | `reseller/sale:74,83,89` | **Supabase-ismus** — má být `identity.users`; celá reseller-sale cesta psaná proti jinému schématu |
| `public.forgemsg_credentials` | `lib/forgemsg/dispatch:32`, `provision:32,62,83` | ForgeMsg integrace nepostavená (tabulka credentials chybí) |
| `catalog.promoters` | `kiosk/order:41` | má být `platform.promoters` |
| `pricing.price_tiers` | `lib/pricing/resolve-price:123` | pricing tier subsystém |
| `platform.promoter_alerts` | `admin/anti-scalping/overview:88` | chybí tabulka |
| `catalog.group_discounts` | `admin/events/[id]/save-as-template:58` | (pozn.: existuje `group_discount_tiers`) |
| `marketing.campaign_recipient_events` | `lib/ai/smart-send-time:74` | smart-send analytika |

#### 🔬 ROZPAD 4a/4b (ověřeno z information_schema čerstvé prod-clone větve — netipováno z názvu)

> **Orphan risk: NULOVÝ.** Všichni 4a kandidáti jsou in-tx PŘED INSERT objednávky (kiosk, reseller →
> ROLLBACK před vznikem objednávky) nebo read-only (anti-scalping, save-as-template). Na rozdíl od
> třídy 3 tu orphan nehrozí — vše deny-only / graceful.

**🟢 4a-OPRAVIT — cíl EXISTUJE jinde (4 subsystémy):**

| # | nález | napsaný cíl ❌ | reálný cíl ✅ (ověřeno) | dosažitelný | pre/post | oprava |
|---|---|---|---|---|---|---|
| 1 | `kiosk/order:41` | `catalog.promoters` | **`platform.promoters`** (id, slug, name) | ano (kiosk POS) | in-tx PRE → deny | ✅ **OPRAVENO** — POZOR: NEbyl čistý rename, guard maskoval DRUHÝ drift `e.starts_at`→`e.date_start` (42P01 na tabulce short-circuitoval parse před sloupci). Oprava = tabulka + sloupec. (Sibling `:60 tt.is_active` = třída 5, endpoint E2E-green až s ní.) |
| 2 | `reseller/sale:74,83,89` | `auth.users` (Supabase-ismus) | **`identity.users`** (id, email, name, is_platform_admin) | ano (reseller cash) | in-tx PRE → deny | ✅ **OPRAVENO (kód-only)** — viz níže. Blokery vyřešeny v kódu: (a) `identity.users` MÁ unique email, ale PARTIAL (`uq_identity_users_email_active WHERE anonymized_at IS NULL`) → `ON CONFLICT (email) WHERE anonymized_at IS NULL`; (b) doplněn `gdpr_consent_at=NOW()` + `password_hash='!guest'` (kanonický guest vzor). ŽÁDNÁ změna schématu identity.users. |
| 3 | `anti-scalping/overview:88` | `platform.promoter_alerts` | **`audit.anomaly_alerts`** (1:1: id, promoter_id, event_id, alert_type, severity, message, created_at) | ano (admin) | read-only → deny | ✅ **OPRAVENO** — čistý rename, sloupce sedí přesně |
| 4 | `save-as-template:58` | `catalog.group_discounts` | **`catalog.group_discount_tiers`** (min_quantity, label, discount_pct) | ano (admin) | autocommit `.catch(()=>[])` graceful | 🎫 **DLUH + TICKET (doporučeno, NEopravovat teď)** — viz níže. Ne pouhý join: tabulka keyovaná `ticket_type_id`, ale template ukládá plochý event-level list bez vazby na ticket type; apply strana by pak neuměla obnovit per-ticket-type tiery → korektní fix = save+apply+template_data feature, ne rename. Dnes graceful (spolknuto). |

**🔴 4b-DLUH — cíl NEEXISTUJE vůbec (5 subsystémů):**

| # | nález | chybějící cíl | co reálně existuje | stav |
|---|---|---|---|---|
| 5 | seat-upgrade (`upgrade:72,86,101`, `upgrade-options:33,43,61`, `cron/seat-upgrade-notify:35`) | `seat_assignments`, `seat_maps`, `seat_map_entries` ❌ | `orders.seat_upgrades` ✅ + `catalog.seats` ✅, ale reálné sedění = `catalog.event_seats`+`seat_holds` (jiný model) | **4b-DLUH** — 3 core tabulky chybí, rewrite = featura |
| 6 | forgemsg (`dispatch:32`, `provision:32,62,83`) | `public.forgemsg_credentials` ❌ | jen `public.forgemsg_outbox` ✅ | **4b-DLUH** — per-promotér creds nepostaveno (env fallback `:40` defeated missing tableExists guard) |
| 7 | `smart-send-time:74` | `marketing.campaign_recipient_events` ❌ | jen `marketing.campaign_recipients` | **4b-DLUH, UŽ BEZPEČNÉ** (try/catch → fallback) — bez akce |
| 8 | `resolve-price:123` | `pricing.price_tiers` ❌ (nikde) | — | **4b-DLUH, UŽ BEZPEČNÉ** (guardováno `tableExists()` → skip) — bez akce |
| 9 | foyer_order_items (`admin/events/[id]/foyer-orders:53`, `foyer-orders:95,165`) | `orders.foyer_order_items` ❌ | data v `foyer_orders.items` jsonb | **4b-DLUH** — kryto feature ticketem foyeru (třída 3) |

**Součet:** 4a = 4 subsystémy (2 čisté rename: kiosk+anti-scalping; 2 „rename+": reseller+save-as-template).
4b = 5 subsystémů (2 už bezpečné bez akce: resolve-price+smart-send; 1 kryto foyerem; 2 rozbité-ale-deny: seat-upgrade+forgemsg).

##### Feature-tickety pro 4b (odložené featury, NE remediace)
- **seat-upgrade subsystém** — postavit proti reálnému seat modelu (`event_seats`/`seat_holds`), NE proti neexistujícím `seat_assignments`/`seat_maps`/`seat_map_entries`. Dotčené: `my/orders/[id]/upgrade`, `upgrade-options`, `cron/seat-upgrade-notify`.
- **forgemsg per-promotér credentials** — chybí `public.forgemsg_credentials` (jen outbox existuje). Buď postavit tabulku, nebo (levně) přidat `tableExists` guard → degradovat na env fallback jako `resolve-price`.

##### ✅ 4a rename #1+#3 HOTOVO & OVĚŘENO (kiosk + anti-scalping)
Ověřeno proti čerstvé prod-clone větvi **SE SEEDEM** (venue+event+alert), 8/8 ✅, větev smazána:
- **kiosk/order:41** `catalog.promoters`→`platform.promoters` **+ `starts_at`→`date_start`** (maskovaný 2. drift, odhalen reálným během — ne tsc). PŘED: 42P01. PO: vrací reálný řádek `{title:"Test Event", currency:"CZK", promoter_slug:"demo-promoter"}`.
- **anti-scalping/overview:88** `platform.promoter_alerts`→`audit.anomaly_alerts`. PŘED: 42P01. PO: vrací reálný řádek `{alert_type:"traffic_spike", severity:"info", event_title:"Test Event"}` (JOIN na events OK).
- Poučení: guard hlásí jen PRVNÍ chybu dotazu (42P01 na tabulce short-circuituje před kontrolou sloupců) → u rename PŘED opravou VŽDY ověřit i ostatní sloupce naživo, jinak zůstane skrytý column-drift.

##### ✅ 4a rename #2 HOTOVO & OVĚŘENO (reseller/sale) — kód-only, BEZ změny identity schématu
Klíčová korekce dřívějšího nálezu: `table_constraints` NEukazuje unique INDEXY. Realita (pg_indexes):
`identity.users` MÁ unique na email, ale PARTIAL: `uq_identity_users_email_active UNIQUE (email) WHERE (anonymized_at IS NULL)`.
→ Blocker 2 nebyl „chybí unique", ale „ON CONFLICT nezná predikát" → **kód-only fix** (žádná změna sdílené identity.users).
Fix (dle kanonického vzoru checkout:898/season-passes:119): rename auth.users→identity.users ×3 +
`ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET name=EXCLUDED.name` + `gdpr_consent_at=NOW()` + `password_hash='!guest'`.
Ověřeno proti čerstvé větvi (5/5 ✅): PŘED 42P01; PO upsert projde (žádná 42P10/23502), **dedup na partial indexu** (2. upsert téhož emailu vrátil STEJNÉ id), SELECT-first OK.
⚠️ **Sibling blocker (třída 5):** `catalog.ticket_types.is_active` NEEXISTUJE → `reseller/sale:57` i `kiosk/order:60` mají `WHERE is_active=true` = drift, běží PŘED user/promotér blokem → oba POS endpointy budou **E2E-green až po opravě `is_active`** (třída 5). Class-4 fixy jsou správné, ale ne poslední blocker.

##### 🎫 FEATURE TICKET — save-as-template (#4) group discounts (odloženo, doporučen DLUH)
**Doporučení: NEopravovat teď, nechat jako baseline dluh + ticket.** Zdůvodnění:
- Drift je **graceful** (`.catch(()=>[])`) — dnes template tiše dostane `group_discounts: []`, žádný crash/orphan.
- **Není to join-rewrite jednoho řádku.** `group_discount_tiers` je keyovaná `ticket_type_id`; `save-as-template` ale ukládá plochý event-level list do `template_data.group_discounts` (JSON) BEZ vazby na ticket type. Naivní join (`WHERE tt.event_id`) by posbíral tiery, ale **apply strana (`event-templates/apply`) by je neuměla obnovit** — nová akce má nové ticket types, chybí mapování. → korektní fix = změna tvaru `template_data` + gather + apply (feature napříč soubory), ne rename.
- Naivní join-only by byl **false-fix** (vypadá hotově, ale apply pořád nefunguje).
**Ticket:** „event templates — zachovat group discounts přes save+apply s per-ticket-type vazbou."

##### ✅ POS E2E-GREEN (kiosk + reseller) — HOTOVO & OVĚŘENO reálným během
Priorita „odblokovat POS" (is_active) odhalila reálným E2E **řetěz blokerů** — guard (parse-only) NIC z nich nevidí, jen skutečný běh:
1. **`is_active` drift** (`kiosk:62`, `reseller:59`) — `catalog.ticket_types` nemá `is_active`/`is_published`/`status`. Kanonický checkout ticket types nefiltruje žádným per-tt flagem (sellability = `event.status='published'` + `remaining_qty`). **Fix: odstraněno `AND is_active = true`** (konzistence s checkoutem; `visibility` řídí listing, ne prodejnost).
2. **`payment_provider` CHECK constraint** (23514) — kiosk psal `'kiosk_card'`, reseller `'reseller_cash'`, ani jedno v `orders_payment_provider_check`. Ne prod-za-kódem drift (v žádné migraci nebyly). **Fix: migrace 451** (aditivní, IDENTICKÝ vzor jako 444 pro `'comp'`). Ověřeno: readery constraintu = jen mig 442/444 + 1 komentář, hodnoty write-only (nikde se nečtou), `orders.orders` prázdná → nic se nerozbije. Sémantika sedí (kiosk=karta, reseller=hotovost).
3. **reseller `total_price` bug** (23502) — `order_items` INSERT vynechával NOT NULL `total_price` (kiosk ho dodává). **Fix: doplněno `total_price = base_price * quantity`.**
4. **`ticket_seq`** (42703) — issuer (b45683e) vyžaduje mig 450; prod-clone větev ji nemá = známý deploy-dependency, ne POS bug.

**Ověřeno reálným během** (dev server → prod-clone větev + `seed-e2e-fixtures.sql` + mig 450 + mig 451, event Cyrano):
- `POST /api/kiosk/order` → **HTTP 200**, order + 1 lístek vydán (issuer), 39000 halířů.
- `POST /api/reseller/sale` (Bearer JWT) → **HTTP 200**, order + 1 lístek + `commissionEarned: 3900` (10 %).
- `npx tsc --noEmit` — 0 chyb v kiosk/reseller.
- Poučení: guard je parse-only → NEVIDÍ check-constraint (23514) ani NOT-NULL (23502) porušení; POS řetěz odhalil JEN reálný E2E. Pro „E2E-green" nutno endpoint fakticky spustit, ne jen guard/tsc.

**⚠️ DEPLOY-POŘADÍ (kritické):** mig **450 + 451** musí být na DB **PŘED** nasazením POS/issuer kódu:
- **450** (`ticket_seq`) před issuerem (b45683e ON CONFLICT vyžaduje sloupec + index) — už dřív poznamenáno.
- **451** (`payment_provider` výčet) před kiosk/reseller kódem (jinak POS INSERT padne na check constraint 23514).
- **NEaplikováno na žádnou živou DB** — projekt je předprodukční (ověřeno: `app.tixly.cz` NXDOMAIN).

### TŘÍDA 5 — čistá 500 / dead feature: 137 (seskupeno dle vzoru; každý file:řádek adresovatelný)
**Systémové clustery (potvrzují root cause §5 — kód proti staršímu schématu):**

`"updated_at"` (30, PRE/autocommit) — kód předpokládá `updated_at` na tabulkách, co ho nemají:
`admin/b2b/[accountId]/deposit:32`, `broadcasts/[id]/send:111,144,149,157`, `events/[id]/backstage:61,121`, `events/[id]/comps:216`, `events/[id]/reschedule:149`, `import:175`, `lastminute/check:102`, `lottery/advance:38,75`, `lottery/draw:78,94,105`, `onboarding/step:97`, `subscriptions/refund-prorata:88`, `checkout:1822,2075`, `foyer-orders/[id]/status:29`, `lottery/enter:65`, `payments/wise/webhook:80,89`, `season-passes/[passToken]:244`, `lib/payouts/executor:88,163,214,246,269`

`"description"` (10) — na `ticket_types`/`productions`: `event-templates/apply:91,107`, `clone:101`, `save-as-template:49`, `ticket-types/[ttId]:90`, `ticket-types:153`, `onboarding/step:225`, `v1/publish/events:135`, `v3/events/[id]:81`, `v3/events/[id]/ticket_classes:35`

`"status"` (6) — na `users` (nemá status): `accreditation/[reqId]:172`, `comps:171`, `press:143`, `waitlist/[entryId]:77`, `reservations:85`, `partner/sales:91`

#### 📋 BATCH PLÁN třídy 5 (ověřeno proti čerstvé větvi — netipováno; PLÁN, zatím NEOPRAVENO)

> **Železné pravidlo:** batch MUSÍ jet přes guard baseline (`schema-drift-baseline.json`, přesné file:line),
> NIKDY přes globální find-replace řetězce — tytéž názvy sloupců existují SPRÁVNĚ na desítkách jiných tabulek.

**`updated_at` — NENÍ uniformní (ověřeno: 23 distinct cílů).**
- **16 tabulek MÁ `updated_at`** (orders.orders, tickets.tickets, identity.users, platform.promoters, catalog.events, catalog.event_seats, marketing.*, benefit_payments, party_split_sessions, incidents, qes…) → **SPRÁVNĚ, NESAHAT.** Hromadné odstranění by je rozbilo.
- **REMOVE ×6** (žádný ts sloupec): `catalog.productions`, `catalog.ticket_types`, `orders.foyer_orders`, `orders.season_passes`, `platform.b2b_accounts`, `platform.payouts` → odstranit `, updated_at = NOW()`.
- **RENAME ×1**: `catalog.venues` → má `last_modified_at` (ne updated_at) → přejmenovat, NE odstranit.
- Batchovatelné per-tabulka (všechny lokace téže drift-tabulky = týž fix), ale 2 pod-vzory + tvrdý guardrail „16 nesahat".

**`description` ×10 — near-uniform REMOVE.** `catalog.ticket_types` i `catalog.productions` nemají `description` ani příbuzný sloupec; `catalog.events` ho MÁ (ty výskyty jsou correct). Fix = odstranit `description` z dotčených dotazů na ticket_types/productions. Per-lokace ověřit read vs write (SELECT sloupec vs INSERT/UPDATE), ale vzor = remove.

**`status`-on-users ×6 — rodina guest-create, NE blind remove.** Všech 6 jsou `INSERT INTO identity.users (…, status, …)` — users nemá `status`. Fix = odstranit `status` a srovnat na KANONICKÝ guest-create (checkout:898 / season-passes:119): `(email, name, password_hash, gdpr_consent_at, created_at, updated_at)` + `ON CONFLICT (email) WHERE anonymized_at IS NULL`. Každá lokace může mít i další drift (chybějící gdpr_consent_at, špatný ON CONFLICT) jako reseller → per-lokace review proti kanonickému vzoru.

**Strategie dávek (pořadí dle rizika):**
1. **Mechanické, batchovatelné (ověřený vzor, nízké riziko):** `updated_at`-REMOVE (6 tabulek) + `description`-REMOVE (2 tabulky). Skript iteruje guard baseline, u každé lokace ověří cílovou tabulku (probe), odstraní sloupec. JEDEN reprezentant per tabulka ověřen naživo (PŘED 42703 → PO projde).
2. **Per-lokace judgment (ne blind):** `updated_at`-RENAME venues (1×), `status`-on-users (6× guest-create alignment). Tyto NE dávkově — každá vlastní review.
3. **Guardrail:** po každé dávce spustit `schema-drift-guard --baseline` → current musí klesnout přesně o počet opravených, žádný nový drift; pak baseline utáhnout.

##### ⏳ PRŮBĚH batch #1
- ✅ **REPREZENTANT `platform.payouts` HOTOVO & OVĚŘENO** (commit) — 7 UPDATEů (executor ×5, wise/webhook ×2). 6/6: PŘED 42703 → PO projde, ostatní SET (status/failure_reason/retry_count+1) reálně zapsány.

**🪤 KRITICKÁ PAST (potvrzuje „ne mechanicky"):** naivní match `updated_at` chytá i **`dynamic_price_updated_at = NOW()`** — REÁLNĚ EXISTUJÍCÍ sloupec na `catalog.ticket_types` (`dynamic-pricing/compute:137`, `pricing/dynamic-engine:271`, `cron/recompute-dynamic-pricing:47`). **Odstranit ho = rozbít dynamic pricing.** → batch MUSÍ rozlišovat token `updated_at` od `*_updated_at`; NELZE find-replace. (Přesně scénář, před kterým varováno.)

**🐛 SEPARÁTNÍ BUG (odhalen reprezentantem, MIMO updated_at batch):** `platform.payouts` status constraint = `pending/approved/paid/failed/cancelled` — **BEZ `'processing'`**, ale `executor.ts:164/215/247` (wise/paypal/fio) píše `status='processing'` → payout execution paths spadnou 23514. Latentní (guard parse-only nevidí check-constraint). Do samostatného ticketu / třídy „check-constraint drift" — NEopravovat v updated_at batchi.

**Přesné REÁLNÉ updated_at-REMOVE lokace na zbylých 5 tabulkách (grep, po vyfiltrování `dynamic_price_updated_at`):**
- `foyer_orders`: `foyer-orders/[id]/status:30`
- `productions`: `v1/publish/events/[externalId]:107` (dynamický SET list + updated_at)
- `b2b_accounts`: `admin/b2b/[accountId]/deposit:33`, `checkout:2096` (refund path)
- `season_passes`: `season-passes/[passToken]:245`
- `ticket_types`: `admin/events/[id]/comps:218` (+ ověřit checkout:1822 a zbytek clusteru — grep byl truncated)
> POZOR `ticket_types`: rozlišit `updated_at` (remove) od `dynamic_price_updated_at` (NESAHAT) a od `capacity_remaining` (party-split — jiný drift, samostatně).

##### ✅ updated_at-REMOVE HOTOVO (payouts + 5 tabulek) — commit
- `platform.payouts` (7 lokací) + `foyer_orders`/`productions`/`b2b_accounts`/`season_passes`/`ticket_types` (6 lokací). Ověřeno reálným během (payouts 6/6, batch 11/11): full-exec mutace + PREPARE resolví.
- **guard `--ephemeral --baseline`: baseline 162 → current 139**, žádný nový drift Z TOHOTO batche. (1 nesouvisející „nový drift" = `demo-issuer.ts:160 ticket_seq` = mig 450 deploy-dependency proti prod; ne z batche — demo-issuer nesaháno, remove nemůže drift přidat. Baseline vůči issuer commitu mírně stale.)

##### ✅ ŠIRŠÍ updated_at cluster DOKONČEN (KROK A) — commit
Guard-autoritativní seznam: 18 statických lokací + 1 dynamická (`reschedule/[token]:184`), 9 tabulek. Klasifikace per-tabulka (information_schema):
- **REMOVE ×8 tabulek:** `communications.broadcasts`, `catalog.backstage_moments`, `catalog.event_reschedules`, `catalog.lastminute_rules`, `orders.lottery_entries`, `orders.lottery_campaigns`, `platform.promoter_contacts`, `subscriptions.subscriptions`.
- **RENAME ×1:** `catalog.venues` (onboarding INSERT) → `last_modified_at`.
- Pozn.: `catalog.entry_slots` (checkout:579) MÁ updated_at → correct, NEsaháno (dřívější obava mylná).
- Nuance ošetřeny: INSERT sloupec+hodnota (import), ON CONFLICT SET (backstage/import), dynamický SET (reschedule/[token]), venues rename.
- Reprezentant `orders.lottery_entries` naživo (6/6): PŘED 42703 → PO status→won + payment_deadline + draw_position zapsány.
- **guard: 138 → 120 (přesně −18), 0 ZBÝVAJÍCÍCH updated_at driftů = CELÝ updated_at cluster UZAVŘEN.**
- **BILANCE updated_at:** baseline mělo ~30 flagovaných; hotovo VŠE (payouts 7 + 5 tabulek 6 + širší cluster 18 = 31 lokací napříč 3 commity). updated_at = 100 %.

##### ⚠️ description — per-sloupec batch NENÍ VIABLE (zjištěno reálným během) → per-DOTAZ remediace
Description drift je **ZAPLETENÝ s dalšími sloupcovými drifty** — per-sloupec fix (jen description) neprodukuje funkční ani ověřitelné dotazy:
- ✅ **`save-as-template:49` HOTOVO** (commit) — jediná ČISTÁ description-only lokace. `NULL::text AS description`, ověřeno (SELECT vrací 2 řádky, description=null).
- **`v3/events/[id]:81`** — description + **`currency`** drift (ticket_types NEMÁ currency) → description fix nevyčistí; REVERTOVÁN (žádný half-fix v tree).
- **`v3/events/[id]/ticket_classes:35`** — description + **`sort_order`** drift (ticket_types NEMÁ sort_order).
- **INSERT `ticket-types:154`** — description v pozičním `$1..$10` INSERTu → odstranění = přečíslování všech paramů (křehké).
- **`v1/publish/events:135` + `clone` (productions)** — **`catalog.productions` je STUB** (jen `id, promoter_id, title, slug, created_at`): chybí description I `poster_url` I `status`, a INSERT vynechává NOT NULL `slug`. Není description fix → **productions stub = dead-feature/featura** (jako foyer).

**ZÁVĚR:** ticket_types description lokace (kromě save-as-template) chtějí **per-DOTAZ remediaci** (opravit description + currency/sort_order + poziční INSERT naráz), ne per-sloupec dávku. `productions` je samostatný **stub ticket**. → description NEDÁVKOVAT per-sloupec; přeřadit do per-query remediace.

##### 🎫 TICKET — catalog.productions je STUB (kód očekává rich production)
`catalog.productions` má jen `id, promoter_id, title, slug, created_at`. Kód (`v1/publish/events:135`, `clone`, `v3/events` productions expand) píše/čte `description, poster_url, status, poster` — nic z toho neexistuje; INSERTy navíc vynechávají NOT NULL `slug`. → buď postavit rich productions tabulku (featura), nebo redukovat kód na stub. Rozhodnout oprava vs. featura. Souvisí s třídou 4 (productions napříč v1/v3/clone/templates).

---

## 🔴 HIGH-PRIORITY TICKET (SYSTÉMOVÝ, root-cause) — sdílený guest-create / user-upsert helper

**Typ:** remediace root-cause (jako CI schema-drift-guard byl root-cause obrana proti driftu), NE featura.
**Rozsah:** samostatná session s vlastním review — **NE teď mezi kosmetikou** (větší refactor přes 8+ souborů).

### Zjištění (empiricky, tato session)
**8+ lokací ručně replikuje tentýž `INSERT INTO identity.users` guest upsert** — a **VŠECHNY byly rozbité, každá jinak:** **[KOREKCE 2026-07-30: 8 byl podhodnocený odhad z poznámky — grep našel 25. Stav: 7 přepojeno na sdílený helper, 18 kopií ZBÝVÁ. Viz §1 nahoře.]**
- status-rodina 6/6: `accreditation:172`, `comps:171`, `press:143`, `waitlist:77`, `reservations:85`, `partner/sales:91`
- + `box-office/sell:78` (email_verified), `admin/import:166` (role)
- Bloky napříč: chybějící `gdpr_consent_at` (NOT NULL → **23502**), špatný/chybějící `ON CONFLICT (email) WHERE anonymized_at IS NULL` partial predikát (**42P10**), neexistující sloupec (`status`/`email_verified`/`role` → 42703).
- **Opraveno v této session** (kanonický vzor, každá ověřená reálným během), ALE root-cause = kopie kódu zůstává.

### Proč HIGH (riziko do budoucna)
- Každá **nová** guest-create cesta zopakuje týž bug (copy-paste vzoru).
- **Guard je na tuto třídu STRUKTURÁLNĚ SLEPÝ** — parse-only PREPARE nevidí NOT NULL / ON CONFLICT / CHECK. „Guard zelený" ≠ „guest-create funguje".
- **Nejhorší tichá varianta:** špatný `ON CONFLICT` target NEtvoří chybu — Postgres tiše vloží **duplicitního uživatele** (ověřeno z PG dokumentace: bez matching arbiter constraintu buď 42P10, nebo u ne-partial targetu projde jako plain INSERT → duplikát). Tichý dedup-fail = data-integrita, guard i tsc slepé.

### Návrh
1. **JEDEN sdílený helper** `createOrGetGuestUser(client, { email, name, phone? })` s kanonickým vzorem:
   `INSERT … (email, name, password_hash, gdpr_consent_at) VALUES (…, '!guest', NOW()) ON CONFLICT (email) WHERE anonymized_at IS NULL DO UPDATE SET updated_at=NOW() RETURNING id` (+ dedup přes partial unique index).
2. **Všech 8 lokací volá helper** místo vlastní kopie INSERTu → jediné místo pravdy. **[KOREKCE 2026-07-30: 8 byl podhodnocený odhad z poznámky — grep našel 25. Stav: 7 přepojeno na sdílený helper, 18 kopií ZBÝVÁ. Viz §1 nahoře.]** **Akceptační kritérium tedy NENÍ splněno — je splněné ze 7/25.**
3. **Runtime-level test** (E2E per guest-create cesta) — protože schema-drift-guard je na tuto třídu slepý; strukturální obrana musí být na runtime úrovni (insert+dedup assert), ne jen parse.

### Akceptační kritérium
Žádná route neobsahuje vlastní `INSERT INTO identity.users`; všechny přes helper; E2E test pokrývá insert + dedup (re-insert téhož emailu → stejné id, žádný duplikát); nová guest-create cesta fyzicky nemůže bug zopakovat.

## 🎫 TICKET — demand-forecast wrong-schema INSERT (demand-forecast:148)
`analytics.demand_forecasts` má sloupce `sold_pct, velocity_per_day, projected_final_pct,
recommended_price_halire, price_change_reason, auto_applied` — ale cron INSERTuje
`tickets_sold, tickets_total, pct_sold, velocity_7d, velocity_1d, forecast_sold, forecast_pct,
demand_score, recommendation` (žádný neexistuje kromě event_id/days_to_event). Celý INSERT proti
JINÉMU designu tabulky → per-DOTAZ rewrite (namapovat spočítané hodnoty na reálné sloupce) nebo
sjednotit design. Odhaleno reálným během (1d audit). NE mechanická oprava.

## 🎫 TICKET — anomaly_alerts CHECK/message (verify-event-completion:131)
INSERT do `audit.anomaly_alerts (promoter_id, alert_type, severity, payload)`:
- `payload` → má být `metadata` (jsonb) — rename.
- **chybí NOT NULL `message` (23502)** — guard nevidí.
- `alert_type='event_completion_anomaly'` **NENÍ v CHECK** (`traffic_spike/refund_spike/fraud_cluster/
  queue_overflow/sellout_imminent/low_velocity`) → **23514**, stejná třída jako payouts processing.
→ rozhodnout: přidat `event_completion_anomaly` do CHECK (migrace) vs. remap na existující alert_type
(sémantika); + doplnit message + payload→metadata. Odhaleno reálným během. NE v batchi.

## 🎫 TICKET — check-constraint drift: payouts.status chybí 'processing' (23514)
**Odhaleno reálným během reprezentanta updated_at batche (guard parse-only check-constraint NEVIDÍ).**
`platform.payouts` constraint `payouts_status_check` = `pending/approved/paid/failed/cancelled` — **BEZ `'processing'`**, ale `lib/payouts/executor.ts:164` (wise), `:215` (paypal), `:247` (fio) píše `status='processing'` → payout execution paths spadnou 23514 (objednávka/výplata se nedokončí).
- **Pravděpodobně aditivní migrace vzorem 451** (přidat `'processing'` do výčtu).
- **ALE ověřit sémantiku PŘED rozhodnutím:** proč tam je `'approved'` a ne `'processing'`? Je `'approved'` zamýšlený mezistav místo `'processing'` (pak oprava = KÓD `'processing'`→`'approved'`), nebo je `'processing'` legitimní a chybí (pak migrace)? = oprava vs. featura, rozhodnout dle záměru. NEŘEŠIT v batchi.

`"price_halire"` (4): `cart/validate:105`, `checkout:1978`(#9 parking), `my/orders/upgrade:58`, `v1/publish/events:166`
`o.buyer_email` (3, #8): `buyer/orders/ticket-pdf:45`, `checkout:891,917`
`"holder_user_id"` (3): `season-passes/[passToken]:131`, `season-passes:133,162`
`m.membership_code` (3): `cross-passes/wallet/apple:32`, `wallet/pdf:30`, `my-memberships:19`
`rr.user_id` (3): `reschedule/stats:64`, `reschedule/[token]:34,106`
`"currency"` (3): `box-office/sell:56`, `press:127`, `waitlist/[entryId]:65`
`"promoter_id"` (3): `events/[id]/lastminute:75,115,140`
`"token"` (2, #11 P2P dead): `my/tickets/transfer:102`, `tickets/transfer/[token]:61` (+`:15` `tr.token`)
`"x"` (2, #7 seated): `checkout:655,710`
`p.payout_currency` (2): `payouts/execute:48`, `lib/payouts/executor:283`
`"wise_recipient_id"` (2): `lib/payouts/executor:127,145`
`"row_label"`/`es.row_label`/`es.label` (5): `exchange:227,246`, `commemorative/send:64`, `tickets/[id]/memory:38`, `list-for-resale:30`
`e.starts_at`/`e.event_date` (3): `reviews/send-requests:30`, `reviews/[token]:24`, `ai-description:55`
`"user_id"`/`"order_id"` (4): `reschedule:138`, `foyer-orders:83`, `announcements/respond:35`, `seat-upgrade-notify:84`
`"is_active"`/`tt.is_active` (3): `kiosk/order:60`, `reseller/sale:57`, `reseller/events:34`

**Jednotlivé (1×):** `sent_by_user_id`(broadcasts:76), `email_verified`(box-office/sell:78), `image_url`(clone:55),
`tt.is_published`(comps:140), `t.event_id`(emergency:117), `channel`(postpone:60↑cousin), `about_text`(program:152),
`base_price`(save-as-template:65), `role`(import:166), `c.attribution_data`(marketing/overview:29),
`author`/`duration_minutes`(onboarding:128,166), `from_user_id`(support-action:148↑latent), `reviewer_email`(reviews/send-requests:58),
`amount_halire`(ticket-changes:131↑latent), `e.published`(artists/[slug]:33), `locale`/`u.locale`(forgot-password:94, send-reminders:101),
`responded_at`(announcements/respond:49), `capacity_remaining`(party-split/[token]:232), `tt.price_halire`(party-split:72),
`po.order_id`(pay-by-link:62), `buyer_email`(foyer-orders:150), `tt.sort_order`(gift/[token]:201),
`start_at`/`tickets_sold`(demand-forecast:76,148), `event_seat_id`(expire-pending-orders:76), `wl.user_id`(push-reminders:161),
`s2.event_id`(seat-upgrade-notify:69), `payload`(verify-event-completion:131), `doc_type`(platform/promoters/[id]:79 — degradovaný read),
`name`/`e.name`(press/accreditation:39, press/event:23), `is_published`(programs/[eventId]:44), `capacity`(public/events/kiosk:48),
`event_id`(reschedule/[token]:162), `er.review_token`(reviews/[token]:69), `sp.status`(season-passes/[passToken]:38),
`p.default_payment_provider`/`unit_price_halire`/`data`(v1/wl/orders:106,206,217), `country_code`(v3/events/[id]:93),
`latitude`/`cover_image`(lib/graphql/resolvers:232,280), ~~`event_name`(lib/tracking/tiktok-capi:106)~~ ✅ HOTOVO (mig 452, viz #6)

---

## Pořadí fixů — průběh
1. ✅ **TŘÍDA 1 HOTOVÁ** — cancel (63b52ec) + latentní ticket-changes (b0760c3), support-action (462bea7), postpone cousin (337dd44). Vše ověřeno naživo.
2. ✅ **🔴 #4 RACE — double issuance HOTOVÉ** — mig 450 UNIQUE backstop (dea3d5d) + issuer advisory lock + ticket_seq + ON CONFLICT + re-read merge (f3495bb).
   - A+B: A (UNIQUE) drží pro všechny callery vč. pool fire-and-forget; B (advisory lock) serializuje 7 tx-callerů, no-op v autocommitu.
   - `ticket_seq` NULLABLE → 6 přímých non-issuer INSERT cest (reissue/subscriptions/gift/season-passes/accreditation) NErozbito (NULL distinct v UNIQUE).
   - Ověřeno: PŘED 6 lístků (M=3) → PO přesně 3; NULL-distinct; deterministický seq.
   - ⚠️ **DEPLOY:** migraci 450 aplikovat na prod PŘED nasazením nového issueru (ON CONFLICT vyžaduje index). *(dosud nenasazeno.)*
3. **TŘÍDA 3 — ORPHAN** (checkout `:2128` post-commit):
   - ✅ **foyer `:2200/:2211` DISABLE HOTOVO & OVĚŘENO** (viz „✅ Třída 3 foyer"). foyer_orders jsonb model + foyer_order_items chybí → featura, ne oprava; vypnuto u zdroje (UI flag) + backend no-op; 8/8 ověřeno; feature ticket založen.
   - ✅ **program `:2233` (b) DEAD-FEATURE + GUARD HOTOVO & OVĚŘENO** (viz „✅ Třída 3 program"). event_programs je rozvrhová tabulka, booklet price/published nikde. `:2233` ponechán jako baseline dluh; fail-closed early-guard (503 PROGRAM_PURCHASE_UNAVAILABLE, pre-connect, sjednoceno s crypto guardem) + UI flag; přímý POST ověřen (503, 0 orphan); feature ticket založen.
4. **TŘÍDA 4 — nepostavené subsystémy** — rozhodnout per subsystém: opravit schéma (kiosk→platform.promoters, reseller→identity.users) vs. featura mimo scope (seat-upgrade, forgemsg, foyer_order_items).
5. **TŘÍDA 5** — dávkově dle vzoru (updated_at ×30, description ×10, status-of-users ×6…) — mechanické, fail-safe.
6. ✅ **tracking_events (TikTok CAPI) — rename + provider enum + catch HOTOVO & OVĚŘENO.**
   - `lib/tracking/tiktok-capi.ts:106-107` mělo 3 co-drifty sloupců: `event_name→event_type`, `platform→provider`, `promoter_event_id→event_id` (sourozenci meta-capi/ga4 už používají kanonické názvy). Za nimi maskovaný blocker: `provider='tiktok'` mimo `tracking_events_provider_check {meta_capi, ga4, meta_pixel}` → 23514, tiše spolknuto `.catch(()=>{})` → audit řádek se NIKDY nezapsal.
   - Fix: 3 renamy + **mig 452** (aditivní enum `+tiktok`, vzor 444/451) + `.catch` → `console.warn` (best-effort viditelné, nesmí shodit konverzi — jako postpone cousin).
   - tracking_events je write-only (0 SELECTů, žádná hardcoded závislost na výčtu) → aditivní enum nic nerozbije.
   - Ověřeno reálným během na ephemeral prod-clonu: PŘED = 23514, PO mig 452 = INSERT projde, řádek zapsán a načten zpět, sloupce nesou správná data (ne prohozená). Větev uklizena.
   - ⚠️ **DEPLOY POŘADÍ:** migraci **452 aplikovat na prod PŘED** nasazením kódu — INSERT s `provider='tiktok'` potřebuje rozšířený enum, jinak 23514. *(dosud nenasazeno.)*

Baseline lze utáhnout: −3 (třída 1) a nadále dle třídy 3+ jak fixy ubývají.

---

## 🔧 KOREKCE 2026-07-31 — `63fd1d4` admin/broadcasts NENÍ zprovozněný

Commit `63fd1d4` („fix(broadcasts): odstranit neexistující sent_by_user_id —
částečný restore") je na úrovni SQL **správný** — sloupec `sent_by_user_id` na
`communications.broadcasts` opravdu neexistuje a jeho odstranění je korektní.

**ALE cesta se tím nerozběhne.** Změřeno pod aplikační rolí `tixly_app`:

```
communications.broadcasts → 42501 permission denied for schema communications
```

Schéma `communications` **nemá pro `tixly_app` ani `USAGE`**. INSERT tedy padne
dřív, než se vůbec dostane ke sloupcům. Totéž platí pro
`communications.emergency_announcements`, `.announcement_responses` a čtyři
tabulky ve schématu `brands`.

Tvrzení v tom commitu, že „zbylé 4 hodnoty targetu po tomhle commitu fungují",
je tedy **nepravdivé** — nefunguje žádná.

**Proč to nikdo nechytil:** všechna měření (sken, guard, RED→GREEN harnessy)
běží jako `neondb_owner`, který granty nepotřebuje. Viz FINDINGS §30.

**NEOPRAVENO.** Jestli jsou `communications` a `brands` zavřené záměrně
(mrtvý subsystém) nebo jde o chybějící grant, je produktové rozhodnutí, ne
měření.

---

## 🔒 DEPLOY REQUIREMENT (ruční krok ve Vercelu)

**Produkční `DATABASE_URL` MUSÍ používat roli `tixly_app`, ne `neondb_owner`.**

Důvod: `tixly_app` je **jediná** role s `BYPASSRLS = false`. Pod `neondb_owner`
je všech **596 RLS policies inertních** — existují, ale nikdy se nevyhodnotí.

Je to jediný krok celého deploye, který se dělá ručně (heslo role se z `pg_roles`
vyčíst nedá; generuje se a ukládá do env). Viz `migrations/000_baseline_globals.sql`.

## ⚠️ NOVÝ FRONT: guest-create helper padá pod produkční rolí

Změřeno 2026-07-31 (FINDINGS §31): live sada pod `tixly_app` → **6 z 30 testů
padá**, všech 6 na jedné příčině:

```
new row violates row-level security policy (USING expression) for table "users"
  at createOrGetGuestUser (src/lib/identity/guest-user.ts:130)
```

`ON CONFLICT … DO UPDATE` musí projít i **USING** výrazem RLS policy nad
existujícím řádkem; kontext admin cest (`app.role='promoter'`) na
`identity.users` nestačí.

**Dotčené cesty (všech 7 přepojených + 18 nepřepojených kopií):**
`admin/events/[id]/comps`, `.../guestlist`, `.../press`, `.../accreditation`,
`.../waitlist/[entryId]`, `.../box-office/sell` — checkout jako jediný prošel.

Pod `neondb_owner` to nikdy nebylo vidět. **NEOPRAVENO.**

## ⚠️ Rozhodnutí: `communications` a `brands`

Obě schémata jsou pro `tixly_app` zavřená (ani `USAGE`). Stojí na nich
**13 route souborů** (5 + 8, výčet ve FINDINGS §32). Buď udělit granty, nebo
vypnout vzorem foyer. Bez rozhodnutí jsou to mrtvé cesty, které vypadají živě.

---

## 📊 VERDIKT: kolik „ověřených" cest padne pod `tixly_app`

Změřeno 2026-08-04 na klonu z `000_baseline` + `000_baseline_globals`.
Dvě NEZÁVISLÉ vrstvy, dvě různá čísla — a **nepřekrývají se**:

| vrstva | nástroj | výsledek | stav |
|---|---|---|---|
| **granty** | schema-reality-scan | **+6 nálezů** (140 → 146), 6 z 2365 statických dotazů = **0,25 %** | 🟢 UZAVŘENO |
| **RLS** | live sada | **6 z 30 testů = 20 %** | 🔴 OTEVŘENO |

Že se nepřekrývají, je podstatné: live sada nechytila ani jeden ze 6 grantových
pádů, sken nechytil ani jeden z 6 RLS pádů. Každá vrstva potřebuje svůj nástroj.

**Konkrétní cesty, které se pod produkční rolí rozpadnou:**
- **13 route souborů** (1179 LOC) na `communications` / `brands` → `42501`
- **guest-create helper** — 7 přepojených call-sites + 18 nepřepojených kopií → RLS `USING`

**Co číslo NEPOKRÝVÁ:** 20 % je zkreslení live sady (30 testů), ne systému.
Grantová vrstva je změřená celá (katalog je konečný a prohledal se celý).
RLS vrstva ne — 596 policies za hranicí 30 testů zůstává **NEZMĚŘENÝCH**.

## ✅ PODKLAD K ROZHODNUTÍ: `communications` a `brands` → UDĚLIT GRANTY

Otázka zněla „živé subsystémy, nebo mrtvé foyer?". Grep odpovídá jednoznačně:
**jsou zapojené na všech třech koncích** — API, UI i navigace.

```
13 API route souborů, 1179 LOC, 51 zásahů na schémata
```

**Vlastní UI stránky (ne orphany):**
- `src/app/admin/broadcasts/page.tsx` + `new/page.tsx` — plný CRUD + preview + send
- `src/app/platform/brand-connect/page.tsx` — CRUD kampaní i advertiserů, match
- `src/app/admin/events/[id]/emergency/page.tsx` — nouzové oznámení

**Odkazy v navigaci (tedy dosažitelné klikáním):**
- `components/admin/Sidebar.tsx:113` → „Broadcasty"
- `components/admin/Sidebar.tsx:121` → „Brand Connect"
- `components/platform/PlatformSidebar.tsx:23` → „Brand Connect"
- `admin/events/[id]/EventDetailNav.tsx:76` → „Nouzové oznámení"

🔴 **A jedna cesta je ZÁKAZNICKÁ, ne adminská:**
`BrandConnectBanner` se vykresluje na potvrzení objednávky
(`[locale]/order-confirmation/[orderId]/page.tsx:399`) a volá
`/api/brand-connect/event/[id]` + `/track`. Pod produkční rolí to znamená
selhání ve **flow po zaplacení**, ne v administraci.

**Doporučení: udělit granty.** Vypnout vzorem foyer by znamenalo odstranit
4 položky z navigace, 3 UI stránky a banner z potvrzení objednávky — to není
úklid mrtvého kódu, to je odebrání funkčnosti. Rozhodnutí je ale produktové;
tohle je podklad, ne provedení. **NEOPRAVENO.**

## ⚠️ Baseline není spustitelný „jak leží"

`000_baseline_20260730.sql` nese 2 psql meta-příkazy (`\restrict` /
`\unrestrict`, řádky 5 a 44985). Přes SQL driver → `42601` a **neaplikuje se
vůbec**. Deploy runner musí použít `psql`, nebo je odfiltrovat.
Viz FINDINGS §33.

---

## 📊 VERDIKT RLS (2026-08-04): 64 vzorců, změřeno 33, nezměřeno 25

596 policies = **64 distinktních vzorců**. Testovalo se 58 reprezentativních
tabulek (jedna na vzorec + všech 12 `USING (true)`):

| verdikt | počet | význam |
|---|---|---|
| 🟢 účinných | **14** | tenant vidí vlastní, cizí ne |
| 🔴 děravých | **7** | tenant vidí i cizí řádek |
| ⛔ odepírá vše | **12** | aplikace nedosáhne ani na vlastní data |
| ⚪ neměřeno | **25** | seed neprošel FK/CHECK řetězem |

**Účinných je 14 z 58 = 24 %.** Zbytek je buď rozbitý (19), nebo neznámý (25).
Detail ve FINDINGS §34.

## 🔴 FRONT 1: `identity.users` je čitelná celá, pro každého

`p_users_select` = `PERMISSIVE SELECT USING (true)`. Permissive policies se
OR-ují, takže tahle přebije obě zbývající. Každé připojení s jakýmkoli GUC
přečte všechny uživatele včetně `email`, `phone`, `password_hash`,
`birth_year`, `city`, `postal_code`, `stripe_customer_id`.

Změřeno (tenant A viděl řádky tenanta B), ne odvozeno z definice.
Zbylých 6 děravých jsou `SELECT USING (true)` nad číselníky, kde je veřejné
čtení pravděpodobně záměr — ale nikde to není napsané.

## 🔴 FRONT 2: name-drift GUC — 42 policies čte, co nikdo nenastaví

Aplikace nastavuje `app.current_promoter_id`, `app.current_user_id`,
`app.is_platform_admin`, `app.role`. Policies ale čtou i **7 dalších**:
`app.promoter_id`, `app.user_id`, `app.is_admin`, `app.platform_admin`,
`app.is_service`, `app.bypass_rls`, `app.use_service_role`.

Není to bezpečnostní díra (fail-closed), ale **funkční**: 6 z 12 tabulek, kde
aplikace nevidí ani vlastní data, sedí přesně na tenhle rozpor.

⚠️ A jedna podtřída je horší než mrtvý kód: `(current_setting('app.promoter_id',
true))::uuid`. Nenastavené GUC dá `NULL` (v pořádku), ale **prázdný řetězec**
— doložený stav po `RESET` — dá `''::uuid` → **22P02 a dotaz spadne**.

Rozhodnout se musí jedním směrem: buď přejmenovat policies na GUC, které
aplikace nastavuje, nebo `rls-pool.ts` doplnit o aliasy. **NEOPRAVENO.**

## 🔴 FRONT 3 (DEPLOY BLOCKER): `base64url` neexistuje v PostgreSQL 17

Produkce běží na **17.10**; `base64url` přibyl až v 18. Tři sloupce ho mají
v `DEFAULT` a aplikace ten token nedodává — spoléhá na něj a čte ho zpátky:

```
marketing.ticket_alerts.token           ← api/events/[id]/alert
orders.ticket_transfers.transfer_token  ← api/my/tickets/[ticketId]/transfer
orders.party_split_sessions.share_token ← api/checkout/party-split
```

**Tři zákaznické cesty dnes spadnou na 500** (hlídací pes, převod lístku,
rozdělení platby). Oprava je buď `encode(…, 'base64')` + úprava znaků, nebo
generovat token v aplikaci. **NEOPRAVENO.**

Nenašel to žádný z našich nástrojů — vypadlo to při seedu testu, který hledal
něco jiného. Viz FINDINGS §36 (pokrytí nástrojů).

## ⚠️ DEPLOY: baseline nelze pustit přes SQL driver

`000_baseline_20260730.sql` nese 2 psql meta-příkazy (`\restrict` /
`\unrestrict`, ř. 5 a 44985). Přes node-pg vrátí `42601` a **neaplikuje se
vůbec** — ověřeno reálným během, ne odhadem. Runner musí být `psql`, nebo je
odfiltrovat (`scripts/baseline-clone.mjs` to dělá). Po odfiltrování projde
baseline za 5,6 s a globals za 0,1 s.
