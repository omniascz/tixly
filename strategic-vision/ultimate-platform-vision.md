# TIXLY — STRATEGICKÁ ANALÝZA PLATFORMY
## McKinsey + Technický architekt: Kam skutečně míří

*Datum: 6. dubna 2026 | Verze: 1.0*

---

## ČÁST I — FUNDAMENTÁLNÍ REDEFINICE

### Co platforma ve skutečnosti je

Tixly není ticketingový systém s doplňkovými funkcemi. Je to implementace jednoho z nejstarobylejších primitiv civilizace:

> **Právo přístupu ke vzácnému zdroji, kryptograficky vynucené, vázané na ověřenou identitu.**

Fyzický klíč toto řeší od doby bronzové. Razítko, pečeť, průkaz, certifikát, licence — to vše jsou analogové instance stejného problému. Tixly je první systém, který toto primitiv implementuje digitálně:

1. **Unfalsifikovatelně** (TOTP + HMAC-SHA256, ne statické číslo)
2. **Vázaně na skutečného člověka** (BankID = eIDAS Substantial)
3. **Atomicky přenositelně** (escrow + okamžité zneplatnění starého tokenu)
4. **Dynamicky oceňovaně** (demand-based pricing)
5. **Programaticky přístupně** (B2B API, webhooky)
6. **Multi-tenantně izolovaně** (RLS)

Pět slov shrnující vše:

> **Tixly je infrastruktura pro digitální práva.**

---

## ČÁST II — ANALÝZA KATEGORIÍ

### A. Digitální práva a licence

**Proč primitiva sedí:** TOTP token s N-use logikou je strukturálně identický se softwarovou licencí.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Software seat licensing | AccessToken, N-use | Enterprise SaaS infrastruktura |
| API credit marketplace | Ticket, scan counter | AWS Marketplace killer pro SMB |
| AI/GPU compute slots | space_rental, dynamic pricing | QC/GPU marketplace |
| Paywalled journalism | AccessToken s replay oknem | NYT/FT white-label |
| NFT-gated experiences | TOTP jako proof-of-access | Bez blockchainu, bez gas fees |

**Přidat:** Multi-use counter, concurrent session limit, subscription renewal API.

---

### B. Vládní a občanské použití

**Proč primitiva sedí:** BankID je v ČR de facto státní identita (eIDAS Substantial). BankID + TOTP = kryptograficky vynucená profesní licence.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Profesní licence (lékař, advokát) | AccessToken, scopes, valid_until | ČLK, ČAK partnerství |
| Stavební povolení | AccessToken, resource_id = parcela | Digitalizace stavebního řízení |
| Termíny na úřadě | recurring events, virtual queue | Největší neobsloužený segment CZ |
| Komunální hlasování | single-use ticket, BankID | DAO/zastupitelstvo |
| Celní clearance sloty | space_rental, B2B API | EU Single Window for Customs |

**Přidat:** ISDS integrace, kvalifikovaný elektronický podpis (QES), cross-tenant verification.

**Blokátory:** eIDAS 2.0 / EUDIW kompatibilita nutná do 2026.

---

### C. Healthcare a biotech

**Proč primitiva sedí:** Recept = AccessToken s `max_uses` = počet výdejů, `valid_until` = platnost, anti-replay = TOTP.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Elektronický recept (TOTP) | N-use AccessToken | SÚKL partnerství, anti-zneužití opiátů |
| MRI/CT slot reservation | space_rental, no-show deposit | NIS integrace |
| Klinické studie | AccessToken, scopes | EMA/SÚKL audit trail |
| GDPR zdravotní souhlas | revocable AccessToken | GDPR čl. 9 implementace |
| Přístup k výzkumným datům | AccessToken, verifier_tenant | Data access agreement |

**Přidat:** GDPR čl. 9 schéma (separátní RLS), HL7 FHIR kompatibilita.

**Blokátory:** Zákon o léčivech, SÚKL certifikace, MDR (Medical Device Regulation).

---

### D. Právní a compliance

**Proč primitiva sedí:** Audit log + hash chain = notářská pečeť. BankID = ověřená identita advokáta.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Přístup k důkazním materiálům | AccessToken, audit log | E-spisy soudů |
| GDPR consent management | revocable AccessToken, scopes | OneTrust killer |
| AML/KYC portabilita | BankID hash jako shared attestation | ČNB, 6AMLD |
| Smlouva jako AccessToken | AccessToken, webhook on expiry | Primitivní "smart contract" |
| Notářské úkony | recurring slots, BankID | Notářský zákon |

**Přidat:** QES podpis, cross-tenant token verification API, immutable hash chain.

---

### E. Finanční nástroje

**Proč primitiva sedí:** Dluhopis = AccessToken s `valid_until` = splatnost. Uhlíkový kredit = single-use ticket s TOTP anti-double-spend.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Komunální dluhopisy | AccessToken, webhook coupon | Tokenizace RWA bez blockchainu |
| Uhlíkové kredity | single-use ticket, TOTP | Gold Standard/Verra infrastruktura |
| Inter-operabilní věrnostní body | cross-tenant exchange rate | Loyalty economy clearinghouse |
| Pojistné smlouvy | AccessToken, escrow claim | InsurTech infrastruktura |
| Gift cards / prepaid | AccessToken s hodnotou | Mastercard Prepaid killer |

**Blokátory:** MiCA (Regulation), ESMA pro cenné papíry. Vyžaduje ČNB licenci pokud "e-money token".

---

### F. Supply chain a logistika

**Proč primitiva sedí:** Přístav = venue, lůžko = seat (SVG), slot = time slot, spedice = B2B API.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Přístavní lůžka | space_rental, B2B API | Rotterdam, Hamburg |
| Celní clearance sloty | space_rental, TOTP | EU Single Window |
| Airport gate parking | seat map, B2B | IATA integrace |
| Skladové rampy | recurring, virtual queue | DHL/Amazon white-label |
| ATA Carnet digitalizace | AccessToken, `valid_until` | HK ČR partnerství |

**Přidat:** Multi-dimensional seat attributes (tonáž, rozměry), multi-leg journey token.

---

### G. Energie a životní prostředí

**Proč primitiva sedí:** Rybářská kvóta = N-use AccessToken. Přebytek solární energie = "ticket" na grid. TOTP jako proof-of-retirement pro uhlíkové kredity.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Rybářské kvóty | N-use AccessToken, IoT scan | EU CFP digitalizace |
| Vodní práva | AccessToken + IoT counter | Austrálie, Izrael, Španělsko |
| P2P energy trading | ticket na grid injection | EU Smart Grid direktiva |
| Lovecké povolení | AccessToken, recurring | MZe ČR partnerství |
| Chráněné lokality | timed entry, denní limit | NP Bohemian Switzerland |

**Přidat:** IoT Event Ingestion API (senzor jako "scanner"), geofencing, environmental data API.

---

### H. Vzdělávání a věda

**Proč primitiva sedí:** Vědecký přístroj = venue. Grant = AccessToken s budget counter. BankID = anti-cheating.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Vědecké přístroje (ELI Beams) | space_rental, auction | ESFRI infrastruktura |
| Grantové čerpání | AccessToken, budget_remaining | GAČR, ERC audit |
| Přístup k výzkumným datům | AccessToken, verifier API | DAA technická implementace |
| Online zkoušení | event + BankID verification | ProctorU killer |
| Akademické publikace | read token, resale | Elsevier disruption |

**Přidat:** Budget counter na AccessToken, ORCID integrace, delegation API.

---

### I. Budoucí technologie

**Proč primitiva sedí:** GPU slot = space_rental. Satelitní spektrum = seat s atributy. Dronový let = time slot s TOTP.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Kvantové počítače | space_rental, virtual queue | QC-as-a-Service marketplace |
| Satelitní spektrum | seat s MHz atributem | ITU frequency coordination |
| U-space (drony) | time slot, TOTP | CAA ČR mandát, EASA |
| Vesmírné cestování | high-value seat | Virgin Galactic type |
| Robotické továrny | space_rental, B2B API | Manufacturing-as-a-Service |

**Přidat:** Technical attribute schema, real-time telemetry webhook, SLA guarantee token.

---

### J. Sociální infrastruktura

**Proč primitiva sedí:** Dobrovolnická směna = fitness_class. Zero-price event = jen capacity management.

| Use case | Primitiv | Příležitost |
|---|---|---|
| Dobrovolnictví | event, loyalty points | Connecteam killer pro NNO |
| Kapacitní bohoslužby | zero-price event, seat lock | COVID experience → trvalé řešení |
| Komunální sdílení | space_rental, deposit | Tool library model |
| Veřejné prostory pro akce | AccessToken = permit | Digitalizace "žádosti o povolení" |
| Pohřební obřady | recurring slots | Krematorní kapacita Prahy |

**Přidat:** Zero-price event, donation flow, civic identity layer.

---

### K. Nejrevolucionářnější insight

**Tixly jako "Rights Layer" internetu**

Chybějící vrstva internetu: mezi fyzickou identitou (BankID/eID) a digitálními interakcemi neexistuje standardizovaná infrastruktura pro "kdo má právo k čemu".

Platforma tuto vrstvu implementuje:

```
Fyzická identita (BankID)
        │
        ▼
AccessToken (právo přístupu)
  - unfalsifikovatelné (TOTP)
  - přenositelné (escrow)
  - auditovatelné (hash chain)
  - dynamicky oceněné (pricing)
        │
        ▼
Fyzický nebo digitální zdroj
(sedadlo, místnost, dataset, licence, kvóta)
```

**"Proof of Access" jako nová forma digitálního vlastnictví.** Spotify = máte přístup, ne vlastnictví. NFT = vlastnictví bez praktické hodnoty. AccessToken = kryptograficky vynucené právo přístupu vázané na skutečnou identitu. Toto je třetí cesta.

**Platforma jako regulatorní infrastruktura pro státy.** EU EUDIW (2026 mandát) hledá technickou infrastrukturu. Tixly má vše: BankID, access control, audit trail, multi-tenant RLS. Přihlásit se jako technický provider EUDIW pilotu = realistická příležitost.

**The deepest insight:**

> Veškerá civilizace je o vzácnosti. Tixly je první systém, který vzácnost digitálně kodifikuje, kryptograficky vynucuje a obchodovatelně strukturuje — bez blockchainu, bez gas fees, s ověřenou identitou, v reálném čase.

---

## ČÁST III — TOP 10 PŘÍLEŽITOSTÍ

| Rank | Příležitost | Trh | Tech readiness | Dopad |
|---|---|---|---|---|
| 1 | Profesní licence (lékař, advokát) | CZ 15B Kč IT | 90% | Velmi vysoký |
| 2 | Celní a logistické slot management | EU 20B USD | 85% | Vysoký |
| 3 | Uhlíkové kredity anti-double-spend | 2B USD/rok | 75% | Velmi vysoký |
| 4 | AML/KYC portabilita | EU 8B EUR RegTech | 80% | Vysoký |
| 5 | GDPR consent management | EU SaaS market | 90% | Vysoký |
| 6 | GPU/AI compute marketplace | 1T USD cloud | 95% | Střední |
| 7 | Elektronický recept (TOTP) | 8B Kč zdravotnictví | 70% | Extrémní |
| 8 | U-space drony airspace | EU mandát | 85% | Vysoký |
| 9 | Inter-operabilní věrnostní body | 15B Kč CZ loyalty | 90% | Střední |
| 10 | Rybářské/lovecké kvóty | EU CFP | 80% | Vysoký |

---

## ČÁST IV — CO PŘIDAT DO ARCHITEKTURY HNED

### 1. Universal AccessToken s polymorfním resource_type

```sql
ALTER TABLE tickets.access_tokens
  ADD COLUMN resource_type TEXT NOT NULL DEFAULT 'space'
    CHECK (resource_type IN (
      'event', 'space', 'dataset', 'license',
      'quota', 'permission', 'credential', 'compute'
    )),
  ADD COLUMN budget_remaining BIGINT,        -- pro grant/budget use cases
  ADD COLUMN issuer_tenant_id UUID,          -- kdo vydal (cross-tenant)
  ADD COLUMN verifier_tenant_id UUID,        -- kdo smí ověřovat
  ADD COLUMN transferable BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN metadata JSONB;                 -- domain-specific atributy
```

### 2. Cross-tenant Token Verification API

```
POST /api/v1/tokens/verify-external
{
  "token_id": "uuid",
  "verifier_api_key": "tick_live_...",
  "verification_context": "medical_license_check"
}
→ { "valid": true, "scopes": [...], "valid_until": "..." }
```

Vydavatel (ČLK) a ověřující (nemocnice) jsou různí tenanti. Platforma = důvěryhodný třetí arbitr.

### 3. IoT Event Ingestion API

```
POST /api/v1/iot/event
{
  "token_id": "uuid",
  "sensor_id": "device_xyz",
  "reading_value": 42.5,
  "reading_unit": "m3",       -- kubiky/kg/kWh
  "timestamp": "ISO8601",
  "signature": "HMAC-SHA256"
}
```

Identická logika jako gate scan, ale iniciátorem je IoT zařízení.

### 4. Qualified Electronic Signature (QES) Bridge

Integrace s TSP (Trust Service Provider):
- First Trust (CZ, akreditovaný MVČR)
- PostSignum (Česká pošta)

Vydání AccessToken s QES = token má právní sílu. Odemyká právní, vládní a zdravotnické use cases.

### 5. EUDIW Compatibility Layer (existenční nutnost do 2026)

Standard: OpenID4VC (OpenID for Verifiable Credentials) + SD-JWT.

```
Platforma jako Verifier: ověřuje EUDIW credentials od uživatelů
Platforma jako Issuer: vydává credentials kompatibilní s EUDIW
```

---

## ČÁST V — CO NIKDY NEIMPLEMENTOVAT

| Zakázáno | Důvod |
|---|---|
| Sociální scoring | Single Customer View nesmí ovlivňovat přístup k základním službám |
| Biometrická surveillance bez souhlasu | GDPR čl. 9, gate scan log = pohybová data |
| Kritická infrastruktura bez regulatorního dohledu | Výpadek = výpadek zdravotní péče |
| Predatory dynamic pricing na základních potřebách | Léky, voda, elektřina = price_cap_hardcoded |
| Cross-tenant data sharing bez GDPR souhlasu | SCV data nesmí k marketingovým third parties |

---

## ZÁVĚR

Tixly stojí na křižovatce tří mega-trendů:

1. **Digitalizace práv** — EU mandátuje (EUDIW, eIDAS 2.0, Single Digital Gateway)
2. **Konec bezstavové identity** — přenositelná, ověřená identita s přístupovými právy
3. **Vzácnost jako aktivum** — omezené zdroje budou stále dražší, platforma je kodifikuje

**Tixly má potenciál být pro přístupová práva to, co Stripe je pro platby.**

Doporučené pořadí:
1. Stabilizovat core ticketing (cash flow, brand)
2. Generalizovat AccessToken primitiv (architekturální investice — migrace 020)
3. Vybrat jednu B2G příležitost (termíny na úřadě, U-space, nebo KYC) — pilot
4. Z pilotu postavit case study pro ostatní vládní zákazníky
