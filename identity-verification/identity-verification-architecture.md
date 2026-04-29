# Architektura systému ověření identity — Tixly
> Claude Sonnet 4.6 · Opus-level návrh · 2026-04-06
> Dokument pro uložení: `C:\Users\omnia\Documents\tixly\identity-verification\identity-verification-architecture.md`

---

## Obsah

1. BankID integrace (primární provider)
2. Fallback — OCR dokladů (sekundární)
3. Kdy vyžadovat verifikaci
4. GDPR a datová architektura
5. DB schéma — SQL CREATE TABLE
6. TypeScript interface definice
7. Anti-scalping využití
8. End-to-end flow — sequence diagramy
9. Edge cases
10. Implementační plán pro task #67

---

## 1. BankID integrace (primární provider)

### 1.1 Co je BankID.cz

BankID.cz je bankovní identita provozovaná českou bankovní asociací. Právní základ: nařízení eIDAS, úroveň záruky **Substantial** (standardní) nebo **High** (s biometrickým ověřením v bance). Pro Tixly dostačuje Substantial — garantuje, že osoba za účtem je skutečná fyzická osoba ověřená bankou při zakládání účtu.

Klíčové vlastnosti oproti klasickému OAuth:
- Podléhá bankovní regulaci, ne jen podmínkám komerčního providera
- Zákonná odpovědnost banky za správnost identifikačních dat
- `sub` claim je stabilní a globálně unikátní napříč providery (bankami)
- Dostupné přes většinu českých bank (Česká spořitelna, ČSOB, Komerční banka, Raiffeisenbank, UniCredit, Moneta, Air Bank, Fio a další)

### 1.2 OpenID Connect Claims — co BankID vrací

BankID implementuje OpenID Connect Core 1.0 s rozšířenými claims dle specifikace eIDAS. Po úspěšné autorizaci (scope `openid profile.birthdate profile.name profile.addresses idcard.id`) vrací:

```
Standard OIDC claims:
  sub             — stabilní unikátní identifikátor osoby (UUID formát, per-bank)
  given_name      — křestní jméno
  family_name     — příjmení
  birthdate       — datum narození (YYYY-MM-DD)
  email           — e-mail z banky (pokud uživatel souhlasí)
  phone_number    — telefon z banky (pokud uživatel souhlasí)

BankID rozšíření (scope: profile.addresses):
  addresses[]     — pole adres
    type          — "PERMANENT_RESIDENCE" | "SECONDARY_RESIDENCE"
    street        — ulice a číslo popisné
    city          — město
    postal_code   — PSČ
    country       — ISO 3166-1 alpha-2 (CZ, SK, ...)

BankID rozšíření (scope: idcard.id):
  idcards[]       — pole dokladů
    type          — "ID" | "P" (občanský průkaz / pas)
    number        — číslo dokladu (pro deduplikaci)
    issue_date    — datum vydání
    expiry_date   — datum platnosti

Bezpečnostní claims:
  iss             — issuer (konkrétní banka nebo aggregátor)
  aud             — client_id Ticketaria
  iat / exp       — čas vydání / expirace ID tokenu
  acr             — autentizační kontext: "loa2" (Substantial) nebo "loa3" (High)
  amr             — použité metody: ["pwd", "otp"] nebo ["pwd", "bio"]
```

**Klíčové rozhodnutí: Co ukládat vs. co zahazovat**

BankID nám umožňuje claims získat — nemusíme je ale všechny persistentně ukládat. Architektura odděluje:

| Claim | Perzistujeme | Důvod |
|---|---|---|
| `sub` + `iss` (kombinace = globální klíč) | ANO, jako `bank_id_sub` | Deduplikace osob, anti-scalping |
| `given_name` + `family_name` | ANO, šifrovaně | Zobrazení na vstupence, gate check |
| `birthdate` | ANO, šifrovaně | Věkové omezení eventů |
| `addresses[PERMANENT_RESIDENCE]` | NE — zahazujeme | Nepotřebujeme pro ticketing |
| `idcards[].number` | NE — zahazujeme po verifikaci | Příliš citlivé, sloužilo jen jako vstup |
| `idcards[].expiry_date` | ANO | Detekce expirovaného dokladu |
| `email`, `phone_number` | NE — máme vlastní | Duplicitní s identity.users |
| `acr` | ANO | Záznám úrovně záruky |

### 1.3 Token Exchange Flow

```
Tixly Frontend                BankID OIDC Provider           Tixly Backend
        │                                   │                               │
        │  [1] User klikne "Ověřit přes BankID"                            │
        │──────────────────────────────────────────────────────────────────►│
        │                                   │                               │
        │  [2] Backend vygeneruje state (CSRF) + code_verifier (PKCE)      │
        │◄──────────────────────────────────────────────────────────────────│
        │  { authUrl, state } uloží state do Redis TTL 10 min              │
        │                                   │                               │
        │  [3] Přesměrování na BankID Authorization Endpoint               │
        │──────────────────────────────────►│                               │
        │  GET /oauth2/authorize?           │                               │
        │    response_type=code             │                               │
        │    client_id=TIXLY_CLIENT_ID│                               │
        │    redirect_uri=.../callback      │                               │
        │    scope=openid profile.name      │                               │
        │      profile.birthdate idcard.id  │                               │
        │    state=<CSRF token>             │                               │
        │    code_challenge=<S256 hash>     │                               │
        │    code_challenge_method=S256     │                               │
        │    acr_values=loa2               │                               │
        │                                   │                               │
        │  [4] BankID autentizuje uživatele │                               │
        │◄──────────────────────────────────│                               │
        │  (výběr banky → přihlášení → SMS OTP)                            │
        │                                   │                               │
        │  [5] Callback na Tixly redirect_uri                        │
        │──────────────────────────────────────────────────────────────────►│
        │  GET /api/identity/bankid/callback│               │               │
        │    ?code=<auth_code>              │               │               │
        │    &state=<CSRF token>            │               │               │
        │                                   │               │               │
        │                                   │  [6] Ověření state vs. Redis  │
        │                                   │               │               │
        │                                   │  [7] POST /oauth2/token       │
        │                                   │──────────────►│               │
        │                                   │  grant_type=authorization_code│
        │                                   │  code=<auth_code>             │
        │                                   │  code_verifier=<verifier>     │
        │                                   │  client_secret=...            │
        │                                   │               │               │
        │                                   │◄──────────────│               │
        │                                   │  { access_token, id_token }   │
        │                                   │               │               │
        │                                   │  [8] Validace id_token JWT    │
        │                                   │  (podpis, iss, aud, exp, acr)│
        │                                   │               │               │
        │                                   │  [9] GET /userinfo            │
        │                                   │──────────────►│               │
        │                                   │  Authorization: Bearer <at>   │
        │                                   │               │               │
        │                                   │◄──────────────│               │
        │                                   │  { sub, name, birthdate,      │
        │                                   │    idcards, ... }             │
        │                                   │               │               │
        │                                   │  [10] Uložení verifikace do DB│
        │                                   │  (šifrovaná PII data)         │
        │                                   │               │               │
        │◄──────────────────────────────────────────────────│               │
        │  Redirect na /dashboard?verified=1                │               │
```

### 1.4 Kdy re-verifikovat

| Trigger | Akce |
|---|---|
| `idcards[].expiry_date` < NOW() | Požadavek re-verifikace při příštím privilegovaném úkonu |
| Uživatel smaže a znovu vytvoří účet | Nový účet navázán na existující `verified_person` přes `bank_id_sub` |
| Promotér vyžaduje `acr=loa3` | Re-auth s vyšší zárukou (biometrie v bance) |
| Podezření na fraud (velocity check) | Admin trigger manuální re-verifikace |
| Uplynutí 2 let od poslední verifikace | Proaktivní reminder, re-verifikace optional (ne povinná) |
| Změna identity (soudní rozhodnutí, změna jména) | Podpora → manuální update přes KYC review panel (#71) |

---

## 2. Fallback — OCR dokladů (sekundární)

### 2.1 Provider — Onfido vs. Jumio vs. vlastní

**Rozhodnutí: Onfido**

| Kritérium | Onfido | Jumio | Vlastní OCR |
|---|---|---|---|
| CZ/SK doklady | Ano, v Standard | Ano | Složité na training |
| eIDAS soulad | Partial | Partial | N/A |
| Liveness check | SDK (FaceSDK) | SDK | Rekurzivní problém |
| Cena (per check) | ~3–6 EUR | ~5–8 EUR | Vysoká implementace |
| GDPR DPA | EU Data Processing | EU DP | N/A |
| Integrace | REST + Webhook | REST + Webhook | — |
| Referenční zákazníci v CZ | Ano | Méně | — |

Onfido nabízí **Onfido Studio** — flow builder kde specifikujeme: Document Capture → Face Match → Liveness. Výsledek přijde přes webhook jako `check.completed` s `result: "clear" | "consider" | "unidentified"`.

### 2.2 Co uložit z OCR výsledku

Z Onfido **neukládáme** raw OCR data ani obrazová data dokladů. Ukládáme pouze:

```
- onfido_check_id          — pro zpětné dohledání u Onfido (90 dní retention u nich)
- onfido_report_ids[]      — pole report ID pro document + facial_similarity
- result                   — "clear" | "consider" | "unidentified"
- breakdown_flags[]        — jaké sub-checky prošly / selhaly (pro audit)
- document_type            — "national_identity_card" | "passport" | "driving_licence"
- document_expiry_date     — expirace dokladu (ne číslo!)
- first_name, last_name    — šifrovaně (pro gate display)
- date_of_birth            — šifrovaně (pro věkové omezení)
```

**Výslovně neukládáme:**
- Fotografie přední/zadní strany dokladu
- Číslo dokladu (high-risk PII bez přidané hodnoty pro nás)
- Adresu z dokladu
- Selfie fotografie

### 2.3 Liveness check flow

Onfido FaceSDK provede:
1. Passive liveness (analýza pohybu v krátkém videu) — základní, bez instrukce uživateli
2. Active liveness (výzva: "otočte hlavu doleva") — pro high-value eventy

Výsledek: `facial_similarity.result = "clear"` = tvář na selfie odpovídá dokladu. Žádná biometrická data se neukládají na naší straně — vše je výhradně v Onfido's secure vault po dobu 90 dní dle jejich retention policy.

---

## 3. Kdy vyžadovat verifikaci

### 3.1 Trigger matice

```
Úroveň 0: Žádná verifikace
  → Běžné eventy s kapacitou > 500, cena < 2 000 Kč
  → Uživatel si koupí bez omezení (max 4 vstupenky/event = platform default)

Úroveň 1: Soft gate — doporučení verifikace
  → Verified Fan program registrace (presale přístup)
  → Resale Marketplace — kupující (bez verifikace může koupit, ale limit 1 lístek)
  → Věrnostní program tier GOLD+ výhody

Úroveň 2: Hard gate — verifikace povinná
  → Resale Marketplace — PRODÁVAJÍCÍ (must-have, chrání escrow integritou)
  → Verified Fan final selection — vybraní fani musí verifikovat před nákupem
  → Eventy označené promotérem: requires_verification = true
  → Objednávky > 10 000 Kč celkem (hard threshold, konfigurovatelný)
  → Více než 4 vstupenky na 1 event v jedné objednávce (překračuje platform limit)

Úroveň 3: Re-verifikace (pro existující verifikaci)
  → Promotér vyžaduje acr=loa3 (biometrická re-auth u banky)
  → Doklad expiroval
  → Admin trigger při podezření na fraud
```

### 3.2 Promotér konfigurace

Promotér v dashboardu (event settings) může nastavit:
```typescript
interface EventVerificationConfig {
  requires_verification: boolean;           // zapne hard gate pro event
  verification_level: 'bankid' | 'ocr' | 'any'; // akceptovaný typ
  ticket_limit_per_person: 2 | 4 | 6;      // override platform default
  require_liveness: boolean;                // jen pro OCR path — active liveness
  minimum_age?: number;                     // věkové omezení (18, 21, ...)
}
```

---

## 4. GDPR a datová architektura

### 4.1 Data inventory pro verifikaci

| Data | Právní základ | Retention | Kde uloženo | Forma |
|---|---|---|---|---|
| `bank_id_sub` (hash `iss + sub`) | Oprávněný zájem (čl. 6(1)(f)) — prevence scalping | Po dobu platformy | `identity.verified_persons` | SHA-256 hash — ireversibilní |
| Jméno (`given_name + family_name`) | Plnění smlouvy (čl. 6(1)(b)) — gate display | 3 roky po poslední transakci | `identity.verified_persons` | AES-256-GCM šifrovaně |
| Datum narození | Plnění smlouvy — věkové omezení | 3 roky po poslední transakci | `identity.verified_persons` | AES-256-GCM šifrovaně |
| Expirace dokladu | Plnění smlouvy — platnost verifikace | 3 roky | `identity.verifications` | Plaintext DATE |
| Provider výsledek (`check_id`) | Plnění smlouvy | 1 rok (pak zahazujeme — Onfido ho stejně smaže) | `identity.verifications` | Plaintext string |
| ID tokeny, access tokeny z BankID | Dočasně pro exchange | Nikdy persistentně | Redis TTL 5 min | Dočasný cache |
| Fotografie dokladů | Nezachováváme | — | Pouze u Onfido, 90 dní | — |

**Klíčové rozhodnutí:** `bank_id_sub` ukládáme jako **SHA-256(iss + ":" + sub)** — ireversibilní hash. BankID `sub` je unikátní pro daného uživatele globálně, ale my z hashe nemůžeme zpětně rekonstruovat identitu. Slouží výhradně jako deduplikační klíč. Toto je v souladu s GDPR principem minimalizace dat.

### 4.2 Šifrování PII dat

Následujeme vzor z `totp-encryption.service.ts` — AES-256-GCM s AAD:

```
Master Key (IDENTITY_MASTER_KEY env var, 32 bytes) → uložen v KMS / Vault
  └─► Data Encryption Key: per-person, derivován jako HKDF(masterKey, person_id)
        └─► Šifrování: AES-256-GCM(plain_text, dek, iv)
              └─► Uloženo: { encrypted_bytes, iv } v DB
              └─► Auth tag: append to ciphertext (stejný vzor jako totp-encryption)
```

### 4.3 Right to Erasure — flow

```
Uživatel podá žádost o výmaz
        │
        ▼
identity.anonymize_user(user_id)  ← existující funkce v ticketing_schema.sql
        │
        ▼
Kafka event: "tixly.identity.user-deleted"
        │
        ├─► identity service: anonymize_verification(user_id)
        │     - verified_persons: šifrovaná PII → přepisem náhodným bytem (secure wipe)
        │     - verifications: status → 'anonymized', provider IDs → NULL
        │     - verification_attempts: ip_address → NULL
        │     - ZACHOVAT: verified_person_id (pro referenční integritu tickets)
        │     - ZACHOVAT: bank_id_sub_hash (pro anti-fraud deduplikaci)
        │       └─► POZOR: toto je tradeoff — viz níže
        │
        └─► Ostatní services (Kafka subscribers):
              - tickets.tickets: holder_name z verifikace → NULL (jméno na vstupence)
              - orders: billing PII → anonymizace (existující mechanismus)
```

**Tradeoff: `bank_id_sub_hash` vs. právo na výmaz**

Toto je nejsložitější právní otázka celého systému. Možnosti:

| Varianta | Popis | Pros | Cons |
|---|---|---|---|
| A) Zachovat hash | `bank_id_sub_hash` zůstane i po výmazu | Anti-scalping funguje i po výmazu | Technicko-právně hraničí — hash může být osobní údaj |
| B) Smazat hash | Kompletní výmaz | Plné GDPR právo na výmaz | Osoba může zaregistrovat nový účet a obejít limity |
| C) Pseudonymizovat s rotací | Hash rotovat na jiný náhodný klíč | Částečná ochrana | Původní deduplikace ztracena |

**Doporučení:** Varianta A s právním zdůvodněním. Právní základ: **oprávněný zájem** (čl. 6(1)(f)) — prevence podvodů. SHA-256 hash sám o sobě není osobní údaj pokud není k dispozici původní `sub` (one-way function). Přidat do Privacy Policy explicitní zmínku. Konzultovat s DPO při spuštění.

**Pro splnění výmazu:** Smazat veškerá plaintextová nebo šifrovaná PII data (jméno, datum narození). Hash ponechat v anonymní tabulce (bez vazby na uživatele) pouze pro deduplikaci.

### 4.4 Retention Policy přehled

```
Typ dat                              Retention           Trigger mazání
─────────────────────────────────────────────────────────────────────────
Šifrované PII (jméno, DOB)           3 roky              Poslední transakce + 3y
Verifikace výsledek (provider)       1 rok               Datum verifikace + 1y
Onfido check_id                      1 rok               Pak NULL update
BankID ID token (Redis)              5 minut             TTL automatický
BankID authorization code (Redis)    10 minut            TTL automatický
Attempt log (IP, user_agent)         1 rok               Rolling window
bank_id_sub_hash (anti-fraud)        Po dobu platformy   Pouze soud / DPA výzva
```

---

## 5. DB schéma — SQL CREATE TABLE

```sql
-- =============================================================================
-- SCHÉMA: identity (rozšíření existujícího)
-- Nové tabulky pro identity verification — BankID + OCR
-- =============================================================================

-- -----------------------------------------------------------------------------
-- identity.verified_persons
-- Deduplikační tabulka — jeden člověk = jeden záznam
-- Vazba přes bank_id_sub_hash nebo onfido_applicant_id
-- GDPR: šifrovaná PII, right to erasure zachovává záznam ale nuluje PII
-- -----------------------------------------------------------------------------
CREATE TABLE identity.verified_persons (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Deduplikační klíč: SHA-256(iss + ":" + sub) — ireversibilní
    -- NULL pokud verifikace proběhla pouze přes OCR (bez BankID)
    bank_id_sub_hash        TEXT        UNIQUE,

    -- Onfido applicant ID — pro případ OCR-only verifikace bez BankID
    -- Slouží jako fallback deduplikační klíč
    onfido_applicant_id     TEXT        UNIQUE,

    -- Šifrovaná PII: AES-256-GCM, IV uložen v _iv sloupci
    -- Po GDPR výmazu: přepsáno náhodným bytem (secure wipe), iv také přepsáno
    given_name_encrypted    BYTEA,
    given_name_iv           BYTEA,
    family_name_encrypted   BYTEA,
    family_name_iv          BYTEA,
    date_of_birth_encrypted BYTEA,
    date_of_birth_iv        BYTEA,

    -- Expirace dokladu — není osobní údaj (jen datum), ukládáme plaintext
    -- NULL pokud neznáme (starší verifikace bez dokladu)
    document_expires_at     DATE,

    -- Typ dokladu použitého k verifikaci
    document_type           TEXT        CHECK (document_type IN (
                                            'national_id', 'passport',
                                            'driving_licence', 'residence_permit'
                                        )),

    -- eIDAS Level of Assurance dosažená při verifikaci
    -- 'substantial' = BankID standardní, 'high' = biometrie v bance nebo loa3
    loa_level               TEXT        NOT NULL DEFAULT 'substantial'
                                        CHECK (loa_level IN ('low', 'substantial', 'high')),

    -- Stav záznamu
    -- 'active' = platná verifikace
    -- 'expired' = doklad expiroval, nutná re-verifikace
    -- 'suspended' = admin/fraud pozastavení
    -- 'anonymized' = GDPR výmaz (PII smazáno, záznam zůstává pro integritu)
    status                  TEXT        NOT NULL DEFAULT 'active'
                                        CHECK (status IN (
                                            'active', 'expired', 'suspended', 'anonymized'
                                        )),

    -- Ticket limit pro tuto osobu (override platform default 4)
    -- NULL = použij platform default
    ticket_limit_override   INTEGER     CHECK (ticket_limit_override BETWEEN 1 AND 20),

    -- GDPR: kdy byla provedena anonymizace (PII smazáno)
    anonymized_at           TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE identity.verified_persons IS
    'Deduplikační tabulka fyzických osob. Jeden záznam = jedna reálná osoba, '
    'i když má více účtů. bank_id_sub_hash je SHA-256(iss:sub) — ireversibilní. '
    'PII pole jsou šifrována AES-256-GCM. Záznam přežívá GDPR výmaz (anonymized_at), '
    'bank_id_sub_hash zůstává pro anti-fraud deduplikaci (právní základ: oprávněný zájem).';

COMMENT ON COLUMN identity.verified_persons.bank_id_sub_hash IS
    'SHA-256(bankid_iss + ":" + bankid_sub) — ireversibilní hash pro deduplikaci osob. '
    'Nikdy nesmí být uložen raw sub hodnota. '
    'Po GDPR výmazu ZŮSTÁVÁ (právní základ: oprávněný zájem, prevence scalping podvodů).';

COMMENT ON COLUMN identity.verified_persons.loa_level IS
    'eIDAS Level of Assurance: low (nepoužíváme), substantial (BankID standard), '
    'high (BankID loa3 nebo Onfido active liveness).';

CREATE INDEX idx_verified_persons_bank_id_sub_hash
    ON identity.verified_persons (bank_id_sub_hash)
    WHERE bank_id_sub_hash IS NOT NULL;

CREATE INDEX idx_verified_persons_onfido_applicant_id
    ON identity.verified_persons (onfido_applicant_id)
    WHERE onfido_applicant_id IS NOT NULL;

CREATE INDEX idx_verified_persons_status
    ON identity.verified_persons (status)
    WHERE status != 'anonymized';

CREATE INDEX idx_verified_persons_document_expires
    ON identity.verified_persons (document_expires_at)
    WHERE document_expires_at IS NOT NULL AND status = 'active';

CREATE TRIGGER trg_verified_persons_updated_at
    BEFORE UPDATE ON identity.verified_persons
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- identity.user_verifications
-- Vazební tabulka: identity.users (účet) ↔ identity.verified_persons (fyzická osoba)
-- Jeden uživatel může mít max 1 aktivní verifikaci
-- Jedna fyzická osoba může mít více uživatelských účtů (detekujeme přes verified_person_id)
-- -----------------------------------------------------------------------------
CREATE TABLE identity.user_verifications (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES identity.users (id) ON DELETE CASCADE,
    verified_person_id      UUID        NOT NULL REFERENCES identity.verified_persons (id),

    -- Stav verifikace pro tento konkrétní user-person vztah
    status                  TEXT        NOT NULL DEFAULT 'active'
                                        CHECK (status IN (
                                            'active',       -- platná verifikace
                                            'expired',      -- doklad expiroval
                                            'revoked',      -- admin revokace
                                            'superseded'    -- nahrazena novější verifikací
                                        )),

    -- Kdy tato vazba vyprší (odvozen z document_expires_at nebo 2 roky od verifikace)
    expires_at              TIMESTAMPTZ,

    verified_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at              TIMESTAMPTZ,
    revoked_by              UUID,       -- admin user_id nebo NULL pro systém

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE identity.user_verifications IS
    'Vazba účtu (identity.users) na ověřenou fyzickou osobu (identity.verified_persons). '
    'Umožňuje detekci jedné fyzické osoby s více účty: '
    'SELECT user_id FROM identity.user_verifications WHERE verified_person_id = X.';

-- Jeden uživatel může mít max 1 aktivní verifikaci
CREATE UNIQUE INDEX uq_user_verifications_active_user
    ON identity.user_verifications (user_id)
    WHERE status = 'active';

CREATE INDEX idx_user_verifications_user_id
    ON identity.user_verifications (user_id);

CREATE INDEX idx_user_verifications_verified_person_id
    ON identity.user_verifications (verified_person_id);

-- Detekce multi-account: vše na jednu osobu
CREATE INDEX idx_user_verifications_person_active
    ON identity.user_verifications (verified_person_id, status)
    WHERE status = 'active';

CREATE TRIGGER trg_user_verifications_updated_at
    BEFORE UPDATE ON identity.user_verifications
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- identity.verifications
-- Záznamy provedených verifikačních úkonů (každá BankID auth, každý Onfido check)
-- Audit trail verifikačního procesu
-- -----------------------------------------------------------------------------
CREATE TABLE identity.verifications (
    id                      UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID        NOT NULL REFERENCES identity.users (id),
    verified_person_id      UUID        REFERENCES identity.verified_persons (id),

    -- Jaký provider provedl verifikaci
    provider                TEXT        NOT NULL
                                        CHECK (provider IN ('bankid', 'onfido', 'manual')),

    -- Výsledek verifikace
    result                  TEXT        NOT NULL
                                        CHECK (result IN (
                                            'approved',         -- prošlo
                                            'declined',         -- odmítnuto providerem
                                            'consider',         -- Onfido "consider" — manuální review
                                            'expired',          -- doklad expiroval při verifikaci
                                            'error'             -- technická chyba
                                        )),

    -- BankID specifické fields
    -- NULL pro Onfido verifikace
    bankid_acr              TEXT        CHECK (bankid_acr IN ('loa1', 'loa2', 'loa3')),
    bankid_amr              TEXT[],     -- ["pwd", "otp"] nebo ["pwd", "bio"]
    bankid_iss              TEXT,       -- issuer (banka)

    -- Onfido specifické fields
    -- NULL pro BankID verifikace
    onfido_check_id         TEXT,       -- pro zpětné dohledání u Onfido (90 dní)
    onfido_report_ids       TEXT[],     -- document + facial_similarity report IDs
    onfido_result           TEXT        CHECK (onfido_result IN ('clear', 'consider', 'unidentified')),
    onfido_breakdown        JSONB,      -- sub-checks breakdown pro audit

    -- Manual admin verifikace (#71 KYC review panel)
    manual_reviewer_id      UUID        REFERENCES identity.users (id),
    manual_review_notes     TEXT,

    -- Metadata
    ip_address              INET,
    user_agent              TEXT,

    -- GDPR: po anonymizaci NULL update
    anonymized_at           TIMESTAMPTZ,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE identity.verifications IS
    'Audit trail každého verifikačního úkonu. Jeden záznam = jeden pokus o verifikaci '
    '(úspěšný i neúspěšný). Immutable po vytvoření — nikdy UPDATE ani DELETE '
    '(výjimka: GDPR anonymizace přes anonymized_at a NULL update PII).';

CREATE INDEX idx_verifications_user_id
    ON identity.verifications (user_id);

CREATE INDEX idx_verifications_verified_person_id
    ON identity.verifications (verified_person_id)
    WHERE verified_person_id IS NOT NULL;

CREATE INDEX idx_verifications_result
    ON identity.verifications (result, created_at DESC);

CREATE INDEX idx_verifications_provider_result
    ON identity.verifications (provider, result, created_at DESC);

-- Partial: Onfido checks pro dohledání u providera
CREATE INDEX idx_verifications_onfido_check_id
    ON identity.verifications (onfido_check_id)
    WHERE onfido_check_id IS NOT NULL;

-- -----------------------------------------------------------------------------
-- identity.verification_attempts
-- Jemnozrnnější audit log — každý request/krok v procesu verifikace
-- Slouží pro rate limiting, fraud detection a diagnostiku
-- -----------------------------------------------------------------------------
CREATE TABLE identity.verification_attempts (
    id                      BIGSERIAL   PRIMARY KEY,
    user_id                 UUID        NOT NULL REFERENCES identity.users (id),
    verification_id         UUID        REFERENCES identity.verifications (id),

    -- Fáze procesu
    step                    TEXT        NOT NULL
                                        CHECK (step IN (
                                            'initiate',         -- uživatel zahájil flow
                                            'bankid_redirect',  -- přesměrování na BankID
                                            'bankid_callback',  -- callback z BankID
                                            'token_exchange',   -- výměna kódu za tokeny
                                            'userinfo_fetch',   -- načtení claims
                                            'onfido_sdk_start', -- Onfido SDK otevřeno
                                            'onfido_upload',    -- doklad nahrán
                                            'onfido_webhook',   -- výsledek přijat
                                            'complete',         -- úspěšně dokončeno
                                            'failed'            -- selhání
                                        )),

    -- Výsledek tohoto konkrétního kroku
    outcome                 TEXT        CHECK (outcome IN ('ok', 'error', 'timeout', 'user_cancelled')),

    -- Chybový kód pro diagnostiku (bez PII)
    error_code              TEXT,

    -- Metadata — GDPR: ip_address NULL update při anonymizaci
    ip_address              INET,
    user_agent              TEXT,

    -- Korelační ID pro tracing přes logy
    trace_id                TEXT,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE identity.verification_attempts IS
    'Jemnozrnný audit log kroků verifikačního procesu. Slouží pro: '
    '(1) rate limiting — počet attempts per user per den, '
    '(2) fraud detection — opakované selhání, '
    '(3) diagnostiku technických problémů (BankID/Onfido výpadky). '
    'Immutable po vytvoření.';

CREATE INDEX idx_verification_attempts_user_id
    ON identity.verification_attempts (user_id, created_at DESC);

CREATE INDEX idx_verification_attempts_verification_id
    ON identity.verification_attempts (verification_id)
    WHERE verification_id IS NOT NULL;

-- Rate limiting index: počet pokusů za posledních 24h
CREATE INDEX idx_verification_attempts_rate_limit
    ON identity.verification_attempts (user_id, created_at DESC)
    WHERE step = 'initiate';

-- -----------------------------------------------------------------------------
-- identity.event_verification_configs
-- Per-event verifikační požadavky (promotér nastavuje v dashboardu)
-- -----------------------------------------------------------------------------
CREATE TABLE identity.event_verification_configs (
    id                          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
    event_id                    UUID        NOT NULL UNIQUE, -- FK na catalog.events (cross-schema — no FK, referential)
    promoter_id                 UUID        NOT NULL,        -- FK na identity.users / promoters (cross-schema)

    -- Základní přepínač — je verifikace povinná pro tento event?
    requires_verification       BOOLEAN     NOT NULL DEFAULT FALSE,

    -- Akceptovaný typ verifikace
    -- 'bankid' = pouze BankID, 'ocr' = pouze Onfido, 'any' = oboje
    accepted_providers          TEXT        NOT NULL DEFAULT 'any'
                                            CHECK (accepted_providers IN ('bankid', 'ocr', 'any')),

    -- Minimální eIDAS LoA pro přístup k eventu
    minimum_loa                 TEXT        NOT NULL DEFAULT 'substantial'
                                            CHECK (minimum_loa IN ('substantial', 'high')),

    -- Limit vstupenek na verifikovanou osobu (override platform default 4)
    ticket_limit_per_person     INTEGER     NOT NULL DEFAULT 4
                                            CHECK (ticket_limit_per_person BETWEEN 1 AND 10),

    -- Věkové omezení (např. 18 pro alkohol eventy)
    minimum_age                 INTEGER     CHECK (minimum_age BETWEEN 16 AND 21),

    -- Zda vyžadovat re-verifikaci pokud existující je starší než X dní
    -- NULL = neověřovat stáří verifikace
    max_verification_age_days   INTEGER     CHECK (max_verification_age_days BETWEEN 30 AND 730),

    created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE identity.event_verification_configs IS
    'Per-event konfigurace verifikačních požadavků. Promotér nastaví v dashboardu. '
    'Checkout flow konzultuje tuto tabulku před dokončením objednávky.';

CREATE INDEX idx_event_verification_configs_event_id
    ON identity.event_verification_configs (event_id);

CREATE INDEX idx_event_verification_configs_requires
    ON identity.event_verification_configs (event_id)
    WHERE requires_verification = TRUE;

CREATE TRIGGER trg_event_verification_configs_updated_at
    BEFORE UPDATE ON identity.event_verification_configs
    FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- -----------------------------------------------------------------------------
-- Audit triggers pro nové tabulky
-- -----------------------------------------------------------------------------
CREATE TRIGGER trg_audit_verified_persons
    AFTER INSERT OR UPDATE OR DELETE ON identity.verified_persons
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

CREATE TRIGGER trg_audit_user_verifications
    AFTER INSERT OR UPDATE OR DELETE ON identity.user_verifications
    FOR EACH ROW EXECUTE FUNCTION public.audit_trigger_func();

-- -----------------------------------------------------------------------------
-- Anonymizace funkce — rozšíření existující identity.anonymize_user()
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION identity.anonymize_verification(p_user_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
    v_person_id UUID;
BEGIN
    -- Najdi verified_person_id pro tohoto uživatele
    SELECT verified_person_id INTO v_person_id
    FROM identity.user_verifications
    WHERE user_id = p_user_id AND status = 'active'
    LIMIT 1;

    -- Revokuj user_verification vazbu
    UPDATE identity.user_verifications
    SET status = 'revoked', revoked_at = NOW()
    WHERE user_id = p_user_id;

    -- Pokud existuje verified_person a tento user byl JEDINÝ aktivní účet pro ni
    IF v_person_id IS NOT NULL THEN
        IF NOT EXISTS (
            SELECT 1 FROM identity.user_verifications
            WHERE verified_person_id = v_person_id
              AND user_id != p_user_id
              AND status = 'active'
        ) THEN
            -- Anonymizuj PII — přepiš náhodným bytem
            UPDATE identity.verified_persons
            SET
                given_name_encrypted    = gen_random_bytes(32),
                given_name_iv           = gen_random_bytes(12),
                family_name_encrypted   = gen_random_bytes(32),
                family_name_iv          = gen_random_bytes(12),
                date_of_birth_encrypted = gen_random_bytes(32),
                date_of_birth_iv        = gen_random_bytes(12),
                onfido_applicant_id     = NULL,
                status                  = 'anonymized',
                anonymized_at           = NOW()
                -- bank_id_sub_hash ZÁMĚRNĚ PONECHÁVÁME — viz GDPR rozhodnutí
            WHERE id = v_person_id;
        END IF;
    END IF;

    -- Anonymizuj verifikace (NULL sensitive fields)
    UPDATE identity.verifications
    SET
        ip_address      = NULL,
        user_agent      = NULL,
        onfido_check_id = NULL,
        onfido_report_ids = NULL,
        onfido_breakdown = NULL,
        anonymized_at   = NOW()
    WHERE user_id = p_user_id
      AND anonymized_at IS NULL;

    -- Anonymizuj verification_attempts
    UPDATE identity.verification_attempts
    SET
        ip_address  = NULL,
        user_agent  = NULL
    WHERE user_id = p_user_id;
END;
$$;

COMMENT ON FUNCTION identity.anonymize_verification(UUID) IS
    'GDPR anonymizace verifikačních dat. Volat z identity.anonymize_user() '
    'a jako Kafka subscriber na tixly.identity.user-deleted. '
    'bank_id_sub_hash je záměrně zachován (oprávněný zájem — anti-fraud).';
```

---

## 6. TypeScript Interface Definice

```typescript
// identity-verification.types.ts
// Centrální typové definice pro identity verification systém

// ---------------------------------------------------------------------------
// Enumerations
// ---------------------------------------------------------------------------

export type VerificationProvider = 'bankid' | 'onfido' | 'manual';

export type VerificationResult = 'approved' | 'declined' | 'consider' | 'expired' | 'error';

export type VerifiedPersonStatus = 'active' | 'expired' | 'suspended' | 'anonymized';

export type UserVerificationStatus = 'active' | 'expired' | 'revoked' | 'superseded';

export type LoaLevel = 'low' | 'substantial' | 'high';

export type VerificationStep =
  | 'initiate'
  | 'bankid_redirect'
  | 'bankid_callback'
  | 'token_exchange'
  | 'userinfo_fetch'
  | 'onfido_sdk_start'
  | 'onfido_upload'
  | 'onfido_webhook'
  | 'complete'
  | 'failed';

// ---------------------------------------------------------------------------
// BankID OIDC Claims
// Přesná reprezentace claims vrácených z BankID /userinfo endpoint
// ---------------------------------------------------------------------------

export interface BankIdAddress {
  type: 'PERMANENT_RESIDENCE' | 'SECONDARY_RESIDENCE' | 'CONTACT';
  street?: string;
  city?: string;
  postal_code?: string;
  country?: string; // ISO 3166-1 alpha-2
}

export interface BankIdIdCard {
  type: 'ID' | 'P'; // ID = občanský průkaz, P = pas
  number?: string;   // Číslo dokladu — nezpracováváme ani neukládáme
  issue_date?: string;  // YYYY-MM-DD
  expiry_date?: string; // YYYY-MM-DD — UKLÁDÁME (ne jako PII)
}

/** Kompletní UserInfo response z BankID /userinfo endpoint */
export interface BankIdUserInfo {
  // Standard OIDC
  sub: string;
  iss: string;
  aud: string;
  iat: number;
  exp: number;
  acr: 'loa1' | 'loa2' | 'loa3';
  amr: string[];

  // Identity claims (scope: profile.name)
  given_name?: string;
  family_name?: string;
  name?: string;

  // Birth date (scope: profile.birthdate)
  birthdate?: string; // YYYY-MM-DD

  // Contact (scope: email, phone)
  email?: string;
  phone_number?: string;

  // Address (scope: profile.addresses)
  addresses?: BankIdAddress[];

  // Documents (scope: idcard.id)
  idcards?: BankIdIdCard[];
}

/** Výsledek zpracování BankID UserInfo — co extrahujeme pro persistenci */
export interface BankIdExtractedData {
  /** SHA-256(iss + ":" + sub) — ireversibilní deduplikační klíč */
  bankIdSubHash: string;
  /** Křestní jméno — bude šifrováno */
  givenName: string;
  /** Příjmení — bude šifrováno */
  familyName: string;
  /** Datum narození (YYYY-MM-DD) — bude šifrováno */
  dateOfBirth: string;
  /** Datum expirace dokladu (YYYY-MM-DD) — ukládáme plaintext */
  documentExpiresAt: string | null;
  /** Typ dokladu */
  documentType: 'national_id' | 'passport' | null;
  /** eIDAS LoA dosažená při verifikaci */
  loaLevel: LoaLevel;
  /** BankID issuer (název banky) */
  bankIdIss: string;
  /** Autentizační metody */
  bankIdAmr: string[];
}

// ---------------------------------------------------------------------------
// Domain Entities
// ---------------------------------------------------------------------------

/** Fyzická osoba — deduplikační záznam */
export interface VerifiedPerson {
  id: string; // UUID
  bankIdSubHash: string | null;
  onfidoApplicantId: string | null;
  /** Dešifrované jméno — dostupné jen v zabezpečeném kontextu */
  givenName?: string;
  familyName?: string;
  /** Dešifrované datum narození — dostupné jen v zabezpečeném kontextu */
  dateOfBirth?: string;
  documentExpiresAt: string | null;
  documentType: string | null;
  loaLevel: LoaLevel;
  status: VerifiedPersonStatus;
  ticketLimitOverride: number | null;
  anonymizedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Vazba uživatelského účtu na verifikovanou osobu */
export interface UserVerification {
  id: string; // UUID
  userId: string;
  verifiedPersonId: string;
  status: UserVerificationStatus;
  expiresAt: Date | null;
  verifiedAt: Date;
  revokedAt: Date | null;
  revokedBy: string | null;
  createdAt: Date;
  updatedAt: Date;
}

/** Záznam jednoho verifikačního úkonu */
export interface VerificationRecord {
  id: string; // UUID
  userId: string;
  verifiedPersonId: string | null;
  provider: VerificationProvider;
  result: VerificationResult;
  // BankID specifické
  bankidAcr?: string;
  bankidAmr?: string[];
  bankidIss?: string;
  // Onfido specifické
  onfidoCheckId?: string;
  onfidoReportIds?: string[];
  onfidoResult?: string;
  onfidoBreakdown?: Record<string, unknown>;
  // Manual
  manualReviewerId?: string;
  manualReviewNotes?: string;
  // Metadata
  ipAddress?: string;
  userAgent?: string;
  anonymizedAt?: Date;
  createdAt: Date;
}

/** Per-event konfigurace verifikačních požadavků */
export interface EventVerificationConfig {
  id: string;
  eventId: string;
  promoterId: string;
  requiresVerification: boolean;
  acceptedProviders: 'bankid' | 'ocr' | 'any';
  minimumLoa: LoaLevel;
  ticketLimitPerPerson: number;
  minimumAge: number | null;
  maxVerificationAgeDays: number | null;
  createdAt: Date;
  updatedAt: Date;
}

// ---------------------------------------------------------------------------
// OAuth 2.0 / OIDC Flow State
// Uložen v Redis po dobu duration OAuth flow (TTL 10 min)
// ---------------------------------------------------------------------------

export interface BankIdFlowState {
  /** PKCE code_verifier (plain) — nikdy do DB */
  codeVerifier: string;
  /** CSRF state parametr */
  state: string;
  /** Koho verifikujeme */
  userId: string;
  /** Odkud přišel request (pro redirect po dokončení) */
  returnUrl: string;
  /** Čas vytvoření */
  createdAt: number; // Unix timestamp
}

// ---------------------------------------------------------------------------
// Anti-scalping — Ticket Purchase Authorization
// Volá Checkout service před vytvořením objednávky
// ---------------------------------------------------------------------------

/** Vstup pro kontrolu anti-scalping limitu */
export interface TicketPurchaseAuthRequest {
  userId: string;
  eventId: string;
  requestedQuantity: number;
  /** Celková hodnota objednávky v halířích */
  totalAmountHalere: number;
}

/** Výsledek anti-scalping kontroly */
export interface TicketPurchaseAuthResult {
  allowed: boolean;
  /** Maximální povolený počet vstupenek pro tuto osobu na tento event */
  maxAllowed: number;
  /** Kolik vstupenek tato osoba (= verified_person, ne user) již má pro tento event */
  alreadyOwned: number;
  /** Zda je pro tuto objednávku vyžadována verifikace */
  verificationRequired: boolean;
  /** Pokud verifikace chybí — URL pro spuštění verifikace */
  verificationUrl?: string;
  /** Důvod zamítnutí (pokud allowed = false) */
  denialReason?: 'limit_exceeded' | 'verification_required' | 'verification_expired' | 'underage';
}

// ---------------------------------------------------------------------------
// Service Adapter Interfaces
// Dependency Injection vzor shodný s resale-api a verified-fan
// ---------------------------------------------------------------------------

export interface DbRow {
  [key: string]: unknown;
}

export interface DbAdapter {
  query<T extends DbRow = DbRow>(sql: string, params?: unknown[]): Promise<T[]>;
  execute(sql: string, params?: unknown[]): Promise<void>;
  transaction<T>(fn: (tx: DbAdapter) => Promise<T>): Promise<T>;
}

export interface RedisAdapter {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, ttlSeconds: number): Promise<void>;
  del(key: string): Promise<void>;
  incr(key: string): Promise<number>;
  expire(key: string, ttlSeconds: number): Promise<void>;
}

export interface EventBusAdapter {
  publish(topic: string, payload: unknown): Promise<void>;
}

/** Adapter pro BankID OIDC provider */
export interface BankIdAdapter {
  /** Vygeneruje authorization URL s PKCE parametry */
  buildAuthorizationUrl(params: {
    state: string;
    codeChallenge: string;
    redirectUri: string;
    scopes: string[];
    acrValues?: 'loa2' | 'loa3';
  }): string;

  /** Vymění authorization_code za token pair */
  exchangeCode(params: {
    code: string;
    codeVerifier: string;
    redirectUri: string;
  }): Promise<{ accessToken: string; idToken: string }>;

  /** Načte UserInfo claims */
  fetchUserInfo(accessToken: string): Promise<BankIdUserInfo>;

  /** Ověří ID token podpis a claims */
  verifyIdToken(idToken: string): Promise<{ acr: string; sub: string; iss: string }>;
}

/** Adapter pro Onfido OCR provider */
export interface OnfidoAdapter {
  /** Vytvoří Onfido applicant (pre-check pro SDK) */
  createApplicant(params: {
    firstName: string;
    lastName: string;
  }): Promise<{ applicantId: string; sdkToken: string }>;

  /** Zahájí check po uploadu dokumentů přes SDK */
  createCheck(applicantId: string, reportNames: string[]): Promise<{ checkId: string }>;

  /** Ověří Onfido webhook HMAC podpis */
  verifyWebhookSignature(payload: string, signature: string): boolean;

  /** Načte výsledek checku */
  getCheckResult(checkId: string): Promise<{
    result: 'clear' | 'consider' | 'unidentified';
    reports: Array<{ id: string; name: string; result: string; breakdown: unknown }>;
  }>;
}

// ---------------------------------------------------------------------------
// Error Classes
// ---------------------------------------------------------------------------

export class VerificationRequiredError extends Error {
  readonly statusCode = 403;
  readonly code = 'VERIFICATION_REQUIRED';
  constructor(public readonly verificationUrl: string) {
    super('Identity verification is required to proceed.');
    this.name = 'VerificationRequiredError';
  }
}

export class VerificationExpiredError extends Error {
  readonly statusCode = 403;
  readonly code = 'VERIFICATION_EXPIRED';
  constructor() {
    super('Your identity verification has expired. Please re-verify.');
    this.name = 'VerificationExpiredError';
  }
}

export class TicketLimitExceededError extends Error {
  readonly statusCode = 422;
  readonly code = 'TICKET_LIMIT_EXCEEDED';
  constructor(
    public readonly maxAllowed: number,
    public readonly alreadyOwned: number,
  ) {
    super(`Ticket limit exceeded: max ${maxAllowed}, already own ${alreadyOwned}.`);
    this.name = 'TicketLimitExceededError';
  }
}

export class MultiAccountDetectedError extends Error {
  readonly statusCode = 403;
  readonly code = 'MULTI_ACCOUNT_DETECTED';
  constructor() {
    super('This identity is already associated with another account on this platform.');
    this.name = 'MultiAccountDetectedError';
  }
}

export class BankIdCallbackError extends Error {
  readonly statusCode = 400;
  readonly code = 'BANKID_CALLBACK_ERROR';
  constructor(public readonly errorCode: string, message: string) {
    super(message);
    this.name = 'BankIdCallbackError';
  }
}

export class OnfidoWebhookError extends Error {
  readonly statusCode = 400;
  readonly code = 'ONFIDO_WEBHOOK_ERROR';
  constructor(message: string) {
    super(message);
    this.name = 'OnfidoWebhookError';
  }
}

export class UnderageError extends Error {
  readonly statusCode = 403;
  readonly code = 'UNDERAGE';
  constructor(public readonly minimumAge: number) {
    super(`Minimum age requirement: ${minimumAge} years.`);
    this.name = 'UnderageError';
  }
}
```

---

## 7. Anti-scalping využití

### 7.1 Ticket Purchase Authorization — logika

Checkout service volá `checkPurchaseAuthorization()` před každou objednávkou:

```
checkPurchaseAuthorization(userId, eventId, quantity, totalAmount)
  │
  ├─► 1. Načti event_verification_config pro event
  │        (requires_verification, ticket_limit_per_person, minimum_age)
  │
  ├─► 2. Načti user_verification pro userId → verified_person_id
  │
  ├─► VĚTEV A: event vyžaduje verifikaci a user NENÍ verifikován
  │     → return { allowed: false, denialReason: 'verification_required' }
  │
  ├─► VĚTEV B: event nevyžaduje verifikaci, user není verifikován
  │     → Aplikuj platform default: max 4 vstupenky per user (ne per osoba)
  │
  └─► VĚTEV C: user JE verifikován (verified_person_id existuje)
        │
        ├─► 3. Zkontroluj stáří verifikace (max_verification_age_days)
        │
        ├─► 4. Věkové omezení: dešifruj date_of_birth, vypočítej věk
        │
        ├─► 5. KLÍČOVÝ DOTAZ: kolik vstupenek na tento event vlastní VŠECHNY účty
        │        vázané na stejnou verified_person_id?
        │
        │   SELECT COUNT(*) FROM tickets.tickets t
        │   JOIN orders.orders o ON t.order_id = o.id
        │   JOIN identity.user_verifications uv ON uv.user_id = o.user_id
        │   WHERE uv.verified_person_id = $person_id
        │     AND t.event_id = $event_id
        │     AND t.status NOT IN ('refunded', 'cancelled')
        │
        ├─► 6. Porovnej s ticket_limit_per_person (event config nebo person override)
        │
        └─► return { allowed, maxAllowed, alreadyOwned, ... }
```

### 7.2 Deduplikace přes `bank_id_sub_hash`

Hlavní ochrana před multi-account scalping:

```
Scénář: Jan Novák má 3 účty (jan@email.cz, jan2@email.cz, jan_privat@email.cz)
Pro každý účet provede BankID verifikaci:
  → bank_id_sub_hash je vždy SHA-256("bankid.cz:a1b2c3d4-...") = stejná hodnota

Při verifikaci účtu #2:
  INSERT INTO identity.verified_persons ... ON CONFLICT (bank_id_sub_hash) DO NOTHING
  → vrátí existující verified_person_id

  INSERT INTO identity.user_verifications (user_id=account2, verified_person_id=existing)

Výsledek: všechny 3 účty mají vazbu na stejný verified_person_id
→ checkPurchaseAuthorization() agreguje vstupenky přes všechny 3 účty
→ limit 4 vstupenky platí pro celou skupinu, ne per-účet
```

### 7.3 Detekce a reakce na multi-account pokus

```
Při pokusu o koupi:
  alreadyOwned (přes ALL accounts vázané na person) + requestedQuantity > maxAllowed
  → ZAMÍTNUTO s kódem TICKET_LIMIT_EXCEEDED

Při verifikaci druhého účtu stejné osoby:
  → NEBLOKUJEME registraci — multi-account je DETEKOVÁN, ne zakázán
  → Kafka event: "tixly.identity.multi-account-detected" { personId, userIds }
  → Fraud queue (#70) dostane signal k manuálnímu review
  → Platform admin může: (a) nechat projít, (b) sloučit účty, (c) ban
  
Proč neblokujeme rovnou?
  Legitimní důvody pro více účtů: rodinný a pracovní e-mail, partner sdílí účet.
  Blokování by způsobilo false positives. Správné řešení: aggregate limits + monitoring.
```

### 7.4 Rodinní příslušníci

```
Scénář: Rodiče kupují vstupenky pro 4 člennou rodinu.
Každý člen rodiny má jiný bank_id_sub → různé verified_person_id.
Každá osoba má svůj limit (default 4 vstupenky).
Rodina může koupit 4×4 = 16 vstupenek → to je scalping problém.

Mitigace (in-scope pro #67):
  - Platform default limit: 4 vstupenky per EVENT per verified person
  - Suspicious purchase detection: N verified persons ze stejného household IP
    → flag pro manuální review, NE automatické blokování (false positives)
  - Pro ultra high-demand eventy (Taylor Swift): promotér nastaví ticket_limit = 2

Mitigace (out-of-scope pro #67, budoucí práce):
  - Household linkage: detekce sdílené platební karty nebo adresy
  - Social graph analysis (#68 device fingerprinting + #70 fraud queue)
```

---

## 8. End-to-End Flow — Sequence Diagramy

### 8.1 Verifikační flow: BankID

```
USER                FRONTEND            IDENTITY API           BANKID           REDIS/DB
 │                      │                    │                    │                │
 │ [1] Klikne           │                    │                    │                │
 │ "Ověřit identitu"    │                    │                    │                │
 │─────────────────────►│                    │                    │                │
 │                      │                    │                    │                │
 │                      │ POST /api/identity │                    │                │
 │                      │ /bankid/initiate   │                    │                │
 │                      │───────────────────►│                    │                │
 │                      │                    │                    │                │
 │                      │                    │ [2] Vygeneruj      │                │
 │                      │                    │ codeVerifier +     │                │                │
 │                      │                    │ state (CSRF)       │                │
 │                      │                    │────────────────────────────────────►│
 │                      │                    │ SET bankid:state:{state} → flow     │
 │                      │                    │ TTL 600s                            │
 │                      │                    │                    │                │
 │                      │                    │ [3] Zaznamenej     │                │
 │                      │                    │ attempt (step:     │                │
 │                      │                    │ initiate)          │                │
 │                      │                    │────────────────────────────────────►│
 │                      │                    │ INSERT verification_attempts        │
 │                      │                    │                    │                │
 │                      │◄───────────────────│                    │                │
 │                      │ { authUrl }        │                    │                │
 │                      │                    │                    │                │
 │◄─────────────────────│                    │                    │                │
 │ Redirect na authUrl  │                    │                    │                │
 │                      │                    │                    │                │
 │ [4] BankID UI:       │                    │                    │                │
 │ výběr banky →        │                    │                    │                │
 │ přihlášení → SMS OTP │                    │                    │                │
 │─────────────────────────────────────────────────────────────►│                 │
 │                      │                    │                    │                │
 │◄─────────────────────────────────────────────────────────────│                 │
 │ Redirect na          │                    │                    │                │
 │ /api/identity/bankid │                    │                    │                │
 │ /callback?code=&state│                    │                    │                │
 │                      │                    │                    │                │
 │ [5] Callback request │                    │                    │                │
 │─────────────────────────────────────────►│                    │                │
 │                      │                    │                    │                │
 │                      │                    │ [6] Ověř state     │                │
 │                      │                    │ z Redisu           │                │
 │                      │                    │◄───────────────────────────────────│
 │                      │                    │ GET bankid:state:{state}            │
 │                      │                    │                    │                │
 │                      │                    │ [7] Token exchange │                │
 │                      │                    │───────────────────►│                │
 │                      │                    │ POST /oauth2/token │                │
 │                      │                    │ code + verifier    │                │
 │                      │                    │◄───────────────────│                │
 │                      │                    │ { access_token,    │                │
 │                      │                    │   id_token }       │                │
 │                      │                    │                    │                │
 │                      │                    │ [8] Validuj        │                │
 │                      │                    │ id_token podpis    │                │
 │                      │                    │ (acr, iss, aud)    │                │
 │                      │                    │                    │                │
 │                      │                    │ [9] GET /userinfo  │                │
 │                      │                    │───────────────────►│                │
 │                      │                    │◄───────────────────│                │
 │                      │                    │ { sub, name,       │                │
 │                      │                    │   birthdate,       │                │
 │                      │                    │   idcards }        │                │
 │                      │                    │                    │                │
 │                      │                    │ [10] Zpracuj claims│                │
 │                      │                    │ SHA-256(iss:sub)   │                │
 │                      │                    │ Šifruj PII (AES-GCM)               │
 │                      │                    │                    │                │
 │                      │                    │ [11] UPSERT do DB  │                │
 │                      │                    │ (serializable TX)  │                │
 │                      │                    │────────────────────────────────────►│
 │                      │                    │ INSERT/UPDATE verified_persons      │
 │                      │                    │ INSERT user_verifications           │
 │                      │                    │ INSERT verifications                │
 │                      │                    │                    │                │
 │                      │                    │ [12] Kafka event   │                │
 │                      │                    │ identity.verified  │                │
 │                      │                    │                    │                │
 │◄─────────────────────────────────────────│                    │                │
 │ Redirect na          │                    │                    │                │
 │ /dashboard?verified  │                    │                    │                │
 │ =1                   │                    │                    │                │
```

### 8.2 Gate Scanner — QR ověření s identitou

```
GATE SCANNER APP        LOCAL SQLITE DB         BACKEND (delta sync)
      │                       │                         │
      │ [1] Scan QR kódu      │                         │
      │ BASE64 decode         │                         │
      │ Extrahuj:             │                         │
      │ TICKET_ID, TOTP,      │                         │
      │ TIMESTAMP, EVENT_ID,  │                         │
      │ SIGNATURE             │                         │
      │                       │                         │
      │ [2] Ověř HMAC         │                         │
      │ signature             │                         │
      │ (FAIL → RED)          │                         │
      │                       │                         │
      │ [3] Načti ticket      │                         │
      │ ze SQLite             │                         │
      │──────────────────────►│                         │
      │◄──────────────────────│                         │
      │ { totp_secret,        │                         │
      │   status, holder_name,│                         │
      │   seat, verified_flag,│                         │
      │   min_age_required }  │                         │
      │                       │                         │
      │ [4] Ověř TOTP         │                         │
      │ (C-1, C, C+1 window)  │                         │
      │ (FAIL → RED)          │                         │
      │                       │                         │
      │ [5] Ověř status       │                         │
      │ = VALID               │                         │
      │ (SCANNED → RED "Již   │                         │
      │  použito")            │                         │
      │                       │                         │
      │ [6a] Pokud            │                         │
      │ verified_flag = true  │                         │
      │ → ZELENÁ + jméno      │                         │
      │   + sekce/sedadlo     │                         │
      │                       │                         │
      │ [6b] Pokud            │                         │
      │ verified_flag = false │                         │
      │ AND event requires    │                         │
      │ verification          │                         │
      │ → ŽLUTÁ "Neověřen"    │                         │
      │   (supervisor rozhodne│                         │
      │   dle event policy)   │                         │
      │                       │                         │
      │ [6c] min_age_required │                         │
      │ → zobraz věk nebo     │                         │
      │   "Zkontrolujte doklad│                         │
      │   totožnosti"         │                         │
      │                       │                         │
      │ [7] UPDATE status →   │                         │
      │ SCANNED (SQLite)      │                         │
      │──────────────────────►│                         │
      │                       │                         │
      │ [8] Async push to     │                         │
      │ backend (fire-forget) │                         │
      │──────────────────────────────────────────────►│
      │                       │                POST /api/gate/scan
      │                       │                { ticket_id, scanned_at,
      │                       │                  scanner_id }
```

**Poznámka k pre-sync datasetu:** Delta sync každých 30 s zahrnuje `verified_flag` a `min_age_display` — gateway scanner nevidí samotné PII (jméno, datum narození). Vidí pouze:
- `holder_name` — první jméno pro zobrazení (přednačteno, bez příjmení)
- `verified_flag` — boolean zda osoba prošla verifikací
- `min_age_display` — string "18+" nebo null (pre-computed, ne raw DOB)

---

## 9. Edge Cases

### 9.1 BankID nedostupný (výpadek)

```
Detekce výpadku:
  - HTTP timeout z /oauth2/token nebo /userinfo > 10 sekund
  - HTTP 503 nebo síťová chyba
  - Opakované selhání přes circuit breaker (3 failures / 30 s → open)

Reakce:
  IF event.requires_verification AND provider = 'bankid_only':
    → Zobraz banner: "BankID je momentálně nedostupný. Zkuste znovu za X minut."
    → Checkout dočasně uzavřen pro verified-only položky
    → Cron job monitoruje dostupnost, při obnovení automaticky re-enable

  IF provider = 'any' (bankid OR onfido):
    → Nabídni fallback na Onfido OCR path
    → Uložit preference pro re-attempt BankID po obnovení

Implementace — circuit breaker v Redis:
  bankid:circuit:{state: 'closed'|'open'|'half-open', failure_count, last_failure_at}
  TTL 60 s pro half-open test
```

### 9.2 Uživatel nemá BankID (starší generace, cizinci)

```
Kategorie:
  A) Má české bankovnictví ale neaktivoval BankID
     → Flow: odkaz na aktivaci BankID (bankid.cz/jak-aktivovat)
     → Mezitím: nabídni Onfido OCR fallback

  B) Nemá české bankovnictví (cizinec, expat)
     → Onfido OCR: pas + liveness check
     → Onfido podporuje doklady ze 195+ zemí

  C) Senioři (starší generace) — digitálně méně zdatní
     → Zjednodušený UI flow pro Onfido (3 kroky, velká tlačítka)
     → Telefonická podpora může iniciovat "manual" verifikaci (#71 KYC panel)
     → Manual verifikace: ID scan + telefonická verifikace → manual review → approved

  D) Uživatel nemá smartphone (pro Onfido SDK)
     → Desktop flow: upload fotografie z počítače (Onfido podporuje)
     → QR kód pro dokončení na mobilním zařízení
```

### 9.3 Dítě kupuje vstupenku (rodičovský souhlas)

```
Věkové omezení — 3 úrovně:

Úroveň 1: Event bez věkového omezení
  → Žádná speciální akce. Dítě může koupit normálně (přes rodičovský účet).

Úroveň 2: Event s minimum_age (např. 16 pro noční akci)
  IF verifikovaná osoba < minimum_age:
    → ZAMÍTNUTO: "Věkové omezení: minimálně 16 let"
    → VÝJIMKA: pokud promotér povolil "accompanied_minor" → zobraz instrukci
      pro doprovodného dospělého (1 dospělý = max 2 nezletilé vstupenky)

Úroveň 3: Event 18+ (alkohol, kasino téma)
  → Stejné jako Úroveň 2 s minimumAge = 18
  → Na gate scanneru: scanner zobrazí "Zkontrolujte doklad totožnosti"

Implementace rodičovského souhlasu (budoucí práce, mimo #67):
  Komplexní téma (COPPA, GDPR čl. 8) — odloženo na samostatný task.
  Pro #67: pouze age gate při checkout na základě dešifrovaného date_of_birth.
```

### 9.4 Podnik kupuje vstupenky (B2B flow)

```
Identifikace B2B:
  - Promotér označí event jako "B2B allowed"
  - Buyer registruje "business account" (IČO, název firmy)
  - Business account projde KYC procesem (#71) — ne identity verification

B2B vs. identity verification:
  - identity.verified_persons je navržen pro fyzické osoby
  - Právnické osoby mají jiné identifikátory (IČO, datová schránka)
  - B2B verifikace je separátní flow (mimo scope identity-verification modulu)

Pro #67: pokud account.type = 'business':
  - Přeskočit BankID/Onfido flow
  - Aplikovat business ticket limits (konfigurovatelné per promoter/event)
  - Označit objednávku as B2B pro reporting
```

### 9.5 Verifikace expiruje během nákupu

```
Scénář: Uživatel zahájí checkout, verifikace expiruje uprostřed procesu
(event = právě 2 roky od verifikace, document_expires_at = dnes)

Detekce:
  - Checkout service kontroluje verifikaci na ZAČÁTKU (step 1) i při PLATBĚ (finalizace)
  - Idempotency: pokud status mezi check1 a check2 změnil → graceful error

Reakce:
  IF status změnil během checkout:
    → Nezrušit košík ihned (mohli jsme zamknout sedadla)
    → Response: 422 VERIFICATION_EXPIRED s max 30 min grace period
    → "Vaše ověření exppirovalo. Dokončete re-verifikaci do 30 minut pro zachování košíku."
    → Cart reservation prodloužena na max 30 min (Redis TTL update)
    → Po 30 min bez re-verifikace: cart uvolněn, sedadla odemčena
    
Implementace:
  Redis: cart:{cartId}:grace_extension = true, TTL 1800s
  Cron: každou minutu zkontroluj expired grace carts → uvolni
```

---

## 10. Implementační plán pro Task #67

Task #67 je Sonnet-level implementace. Tento plán rozpisuje konkrétní kroky v pořadí závislostí.

### Fáze 1: DB migrace a základní typy (odhad: 2–3 hodiny)

**Krok 1.1 — DB migrace**
- Vytvořit `identity-verification/migrations/001_identity_verification.sql`
- Spustit všechny CREATE TABLE příkazy z sekce 5 tohoto dokumentu
- Přidat anonymize_verification() funkci
- Zaregistrovat volání v existující `identity.anonymize_user()`

**Krok 1.2 — TypeScript typy**
- Vytvořit `identity-verification/src/types/identity-verification.types.ts`
- Všechny typy z sekce 6 tohoto dokumentu
- Export index

**Krok 1.3 — Encryption service**
- Vytvořit `identity-verification/src/services/pii-encryption.service.ts`
- Adaptovat vzor z `totp-encryption.service.ts`
- AAD = `verified_person_id` (stejný vzor jako ticket_id u TOTP)
- Funkce: `encryptPII(plaintext, personId)`, `decryptPII(encrypted, iv, personId)`
- Env var: `IDENTITY_MASTER_KEY` (32 bytes hex, oddělen od `TOTP_MASTER_KEY`)

### Fáze 2: BankID OAuth Service (odhad: 4–6 hodin)

**Krok 2.1 — BankID Adapter**
- Vytvořit `identity-verification/src/adapters/bankid.adapter.ts`
- Implementovat `BankIdAdapter` interface
- Env vars: `BANKID_CLIENT_ID`, `BANKID_CLIENT_SECRET`, `BANKID_ISSUER_URL`
- PKCE: `generateCodeVerifier()`, `computeCodeChallenge(verifier)` (S256)
- Token exchange: `POST {issuer}/oauth2/token`
- UserInfo: `GET {issuer}/userinfo`
- ID Token verifikace: přes `jose` knihovnu (stejná jako JWT auth) — `jwtVerify` s JWKS

**Krok 2.2 — BankID Service**
- Vytvořit `identity-verification/src/services/bankid.service.ts`
- `initiateVerification(userId, returnUrl, deps)` → uloží flow state do Redis, vrátí authUrl
- `handleCallback(code, state, deps)` → ověří state, exchange, userinfo, uloží do DB
- `extractAndPersist(userInfo, userId, deps)` → serializable TX: UPSERT verified_persons, INSERT user_verifications, INSERT verifications
- Detekce multi-account: pokud bank_id_sub_hash existuje u jiného uživatele → Kafka event

**Krok 2.3 — API Routes — BankID**
- `GET /api/identity/bankid/initiate` → volá service, redirect na BankID
- `GET /api/identity/bankid/callback` → state validace, token exchange, uložení, redirect na frontend
- `GET /api/identity/status` → stav verifikace aktuálního uživatele
- Middleware: všechny routes vyžadují platný JWT (Bearer)

### Fáze 3: Onfido OCR Service (odhad: 3–4 hodiny)

**Krok 3.1 — Onfido Adapter**
- Vytvořit `identity-verification/src/adapters/onfido.adapter.ts`
- Implementovat `OnfidoAdapter` interface
- Env vars: `ONFIDO_API_TOKEN`, `ONFIDO_WEBHOOK_SECRET`
- REST klient: `POST /v3.6/applicants`, `POST /v3.6/checks`, `GET /v3.6/checks/{id}`

**Krok 3.2 — Onfido Service**
- Vytvořit `identity-verification/src/services/onfido.service.ts`
- `initiateOcrVerification(userId, firstName, lastName, deps)` → Onfido applicant, SDK token
- `handleWebhook(payload, signature, deps)` → ověří podpis, zpracuj výsledek, uloží

**Krok 3.3 — API Routes — Onfido**
- `POST /api/identity/onfido/initiate` → vrátí SDK token pro frontend
- `POST /api/identity/onfido/webhook` → Onfido webhook (bez JWT auth — HMAC auth)

### Fáze 4: Purchase Authorization Service (odhad: 2–3 hodiny)

**Krok 4.1 — Authorization Service**
- Vytvořit `identity-verification/src/services/purchase-authorization.service.ts`
- `checkPurchaseAuthorization(req, deps)` → implementuje logiku z sekce 7.1
- Věkový výpočet: dešifruj DOB, `differenceInYears(now, parseISO(dob))`
- Ticket count query přes ALL accounts per verified_person_id

**Krok 4.2 — API Route**
- `POST /api/identity/authorize-purchase` → internal endpoint (service-to-service)
- Volán z checkout flow před GoPay platbou
- Rate limit: 10 req/s per service

### Fáze 5: Integrace s existujícími moduly (odhad: 3–4 hodiny)

**Krok 5.1 — Checkout Integration**
- Přidat `checkPurchaseAuthorization()` do checkout flow
- Middleware pro checkout route: zjisti event verification config, zavolej authorization service

**Krok 5.2 — Verified Fan Integration**
- Upravit `verified-fan.service.ts` → při final selection link redemption zkontroluj verifikaci
- Přidat `verificationRequired` flag do `VerifiedFanConfig`

**Krok 5.3 — Resale Integration**
- Přidat verifikaci pro resale sellers (listing creation)
- Přidat do `resale-listing.service.ts`: `if (!sellerVerified) throw VerificationRequiredError`

**Krok 5.4 — GDPR Kafka Subscriber**
- Subscriber na `tixly.identity.user-deleted`
- Volá `identity.anonymize_verification(userId)`

**Krok 5.5 — Gate Scanner Delta Sync**
- Přidat `verified_flag` a `min_age_display` do gate sync datasetu
- Upravit `/api/gate/sync` endpoint

### Fáze 6: Testy (odhad: 3–4 hodiny)

**Krok 6.1 — Unit testy**
- `bankid.service.test.ts`: PKCE generace, SHA-256 hash, PII šifrování
- `purchase-authorization.service.test.ts`: limit calculation, multi-account, věkové omezení
- `pii-encryption.service.test.ts`: encrypt/decrypt round trip, AAD binding

**Krok 6.2 — Integration testy**
- BankID callback flow (mock adapter)
- Onfido webhook flow (mock adapter)
- Multi-account detection scénáře
- GDPR anonymizace — ověř že PII je smazáno, hash zachován

### Env vars pro .env

```
# BankID
BANKID_CLIENT_ID=tixly_prod_client
BANKID_CLIENT_SECRET=<secret>
BANKID_ISSUER_URL=https://oidc.bankid.cz
BANKID_REDIRECT_URI=https://tixly.cz/api/identity/bankid/callback

# Onfido
ONFIDO_API_TOKEN=<token>
ONFIDO_WEBHOOK_SECRET=<secret>

# PII Encryption (oddělen od TOTP_MASTER_KEY!)
IDENTITY_MASTER_KEY=<64 hex chars = 32 bytes>

# Circuit breaker
BANKID_CIRCUIT_BREAKER_THRESHOLD=3
BANKID_CIRCUIT_BREAKER_TIMEOUT_MS=30000
```

### Celkový odhad

| Fáze | Odhad | Priorita |
|---|---|---|
| 1. DB + typy + šifrování | 2–3h | Must |
| 2. BankID service + routes | 4–6h | Must |
| 3. Onfido service + webhook | 3–4h | Should |
| 4. Purchase authorization | 2–3h | Must |
| 5. Integrace s existujícím | 3–4h | Must |
| 6. Testy | 3–4h | Must |
| **Celkem** | **17–24h** | |

---

## Architektonická rozhodnutí — shrnutí

| Rozhodnutí | Varianta zvolena | Odůvodnění |
|---|---|---|
| BankID sub storage | SHA-256(iss:sub) hash, ne plaintext | GDPR minimalizace, nevratný hash dostačuje pro deduplikaci |
| PII šifrování | AES-256-GCM per-person DEK | Shodný vzor s TOTP encryption service, AAD binding |
| Multi-account policy | Detekce + monitoring, ne blokování | False positive rate by byl příliš vysoký pro legitimní multi-account |
| Dokladové číslo | Nezachováváme | Příliš citlivé PII bez potřeby pro naše use-case |
| Onfido vs. Jumio | Onfido | Lepší pokrytí CZ/SK dokladů, SDK, EU DPA |
| bank_id_sub_hash po GDPR výmazu | Zachovat | Oprávněný zájem (prevence podvodů) — konzultovat s DPO |
| Věkové omezení | Server-side výpočet z šifrovaného DOB | Nikdy client-side, DOB se nedešifruje na frontend |
| Gate scanner | verified_flag boolean, ne PII | Privacy-by-design — scanner nevidí citlivá data |
| Re-verifikace trigger | Expirace dokladu, admin trigger, 2y opt | Vyváženo uživatelskou zkušeností a bezpečností |

---

### Critical Files for Implementation

- `C:/Users/omnia/Documents/tixly/ticketing_schema.sql`
- `C:/Users/omnia/Documents/tixly/totp-qr/src/services/totp-encryption.service.ts`
- `C:/Users/omnia/Documents/tixly/verified-fan/src/services/verified-fan.service.ts`
- `C:/Users/omnia/Documents/tixly/resale-api/src/types/resale.ts`
- `C:/Users/omnia/Documents/tixly/rls-multitenancy/src/lib/tenant-context.ts`