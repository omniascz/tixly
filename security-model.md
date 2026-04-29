# Bezpečnostní model — Tixly

> Claude Opus 4.6 · 4.4.2026

---

## 1. Anti-scalping — 4 vrstvy (Threat Model)

### Vrstva 1: Ochrana při nákupu

**Botnet mass-buying**
- Detekce: TLS fingerprint (JA3/JA4 hash), timing analýza (bot < 500 ms, člověk 3–15 s), mouse movement telemetrie
- Zamezení: Virtual waiting room (Redis sorted set, FIFO), Proof-of-Work challenge, max 4 vstupenky/uživatel/event, CAPTCHA adaptivně při anomálii
- Slepé skvrny: Residential proxy sítě (Bright Data) jsou téměř neodlišitelné od legitimních uživatelů na IP úrovni

**Fake accounts (account farming)**
- Detekce: Blokace disposable e-mail domén, VoIP čísla (MNP databáze, carrier type), clustering účtů ze stejné IP/device
- Zamezení: SMS OTP verifikace (ne voice call), jedno číslo = max 2 účty, verifikace e-mailu s time-delay (24h před nákupem high-demand eventů), nové účty max 2 vstupenky po dobu 30 dní

**Insider abuse**
- Detekce: Audit log všech operací s inventory, vstupenky rezervované před `sale_start_at`
- Zamezení: Separation of duties, 4-eyes princip pro bulk operace, promotérský účet nemůže být zároveň buyer

---

### Vrstva 2: Ochrana vstupenky

**Screenshot / fotografování QR**
- TOTP QR kód platný max 30 sekund → screenshot je nepoužitelný
- Android `FLAG_SECURE` + iOS `isSecureTextEntry` — zabraňuje screenshotu v aplikaci
- QR kód zobrazit až 2 hodiny před eventem

**Klonování vstupenky (TOTP secret extraction)**
- `totp_secret` uložen v Android Keystore (hardware-backed) / iOS Keychain (`kSecAttrAccessibleWhenUnlockedThisDeviceOnly`)
- Secret nikdy v plaintext v paměti — po generování QR se vynuluje
- Tamper detection: SafetyNet/Play Integrity API (Android), jailbreak detection (iOS)
- Certificate pinning: pinning na leaf certificate + backup pin

**Sdílení účtu**
- Device binding — vstupenka aktivní pouze na zařízení kde proběhl "ticket claim" (biometrické ověření)
- `totp_secret` vázán na device ID, na jiném zařízení se QR negeneruje — nutný re-claim

---

### Vrstva 3: Ochrana u brány

**Fake / expired QR kód**
- Scanner validuje: (1) formát QR payloadu (HMAC integrity), (2) TOTP hodnotu, (3) ticket status v lokální DB
- Při selhání: červená + důvod (invalid / already scanned / revoked)

**Replay / double-entry**
- Po prvním úspěšném skenu: status → `SCANNED`
- Druhý pokus → odmítnutí + alert
- Re-entry flow: separátní re-entry QR s platností 15 minut

**Impersonation (krádež telefonu)**
- Biometric gate check: při zobrazení QR vyžadovat FaceID/TouchID (platný 60 sekund)
- Volitelně: kontrola občanky u high-value eventů

---

### Vrstva 4: Post-sale monitoring

**Resale mimo platformu (Bazoš, FB Marketplace)**
- Web scraping inzerátních portálů každých 30 minut (název eventu + "vstupenka")
- Vstupenka prodaná mimo platformu vyžaduje in-app transfer pro funkční QR — bez transferu kupec má jen neplatný screenshot
- Terms of Service: prodej mimo platformu = revokace vstupenky

**Blacklisting evasion**
- Ban na úrovni: phone number, payment method hash, device fingerprint, billing address

---

## 2. Dynamický QR — kompletní security model

### Algoritmus generování (mobilní aplikace)

1. Načti `totp_secret` ze secure storage (Keystore / Keychain)
2. Unix timestamp `T` → time step counter: `C = floor(T / 30)`
3. TOTP hodnota: `HMAC-SHA256(totp_secret, C)` → dynamic truncation → **8místné číslo**
4. Sestav QR payload: `TICKET_ID | TOTP_VALUE | TIMESTAMP | EVENT_ID`
5. Podepíše payload: `HMAC-SHA256(totp_secret, payload)` → integrity signature
6. Finální QR data: `BASE64(payload + signature)`
7. Po 30 sekundách přegeneruj (kroky 2–6)

### Validace (gate scanner)

1. Dekóduj BASE64 → extrahuj `TICKET_ID`, `TOTP_VALUE`, `TIMESTAMP`, `EVENT_ID`, `SIGNATURE`
2. Z lokální SQLite DB načti `totp_secret` pro `TICKET_ID`
3. Ověř integritu: přepočítej HMAC-SHA256 signature → nesedí → REJECT
4. Ověř TOTP: expected hodnota pro `C`, `C-1`, `C+1` (clock skew tolerance ±30 s)
5. Ověř ticket status: musí být `VALID`
6. Ověř `EVENT_ID`: musí odpovídat eventu na scanneru
7. Při úspěchu: status → `SCANNED`, zápis timestamp, async push do backendu
8. Zobrazí: zelená / jméno držitele / sekce+řada+sedadlo

### Offline validace

- **Pre-sync:** 4 hodiny před eventem scanner stáhne dataset `{ticket_id, totp_secret, status, holder_name, seat_info}` šifrovaný AES-256 (klíč v device TPM)
- **Delta sync:** každých 30 s přes `GET /api/gate/sync?event_id=X&since=TIMESTAMP`
- **Post-event:** lokální DB automaticky smazána (secure delete)

### Clock skew tolerance — ochrana proti zneužití

- Tolerance ±1 window (efektivně ±30 s, celkem 90 s validační okno)
- Útočník nemůže zneužít — pro výpočet TOTP v jakémkoliv okně potřebuje `totp_secret`
- Anti-replay: scanner ukládá posledních N TOTP hodnot per ticket — stejná hodnota podruhé je odmítnuta
- NTP: scannery používají lokální NTP server (ne veřejný — riziko spoofingu)

### Lifecycle při resale

1. Seller listuje → ticket status: `LISTED_FOR_SALE`, starý TOTP stále platí
2. Buyer koupí → Payment Service potvrdí
3. Ticket Service:
   - Vygeneruje nový `totp_secret_new` (`crypto.randomBytes(32)`)
   - Zašifruje AES-256-GCM s per-ticket KEK derivovaným z Master Key (HSM/Vault)
   - Přepíše starý secret (kryptograficky smazán, ne soft-delete)
   - `device_binding` → NULL, status → `TRANSFERRED`
4. Buyer provede claim (biometric) → `totp_secret_new` do device Keystore → nový `device_binding`
5. Starý QR sellera: aplikace zobrazí "Vstupenka převedena", QR se negeneruje

### Edge cases

| Situace | Řešení |
|---|---|
| Ztráta telefonu | Invalidace device binding z webu → re-claim na novém telefonu (MFA přes SMS) → nový `totp_secret` |
| Factory reset | Secret smazán → detekce chybějícího secret → automatický re-claim flow |
| Více zařízení | Záměrně NEpovoleno — jeden ticket = jedno zařízení. Explicitní přesun přes re-claim. |
| Vybitá baterie u brány | Supervisor override: lookup jméno + občanka → manuální override (logováno, vyžaduje PIN + důvod) |

---

## 3. Identity & Auth architektura

### Registrace

| Ověření | Mechanismus | Důvod |
|---|---|---|
| E-mail | Verifikační odkaz (24h expiry, single-use token) | Základní identita |
| Telefon | SMS OTP (6 číslic, 5 min expiry, max 3 pokusy) | Anti-Sybil, 2FA fallback |
| Heslo | Min 10 znaků, bcrypt (cost 12), kontrola proti HaveIBeenPwned (k-anonymity) | Credential stuffing ochrana |

### Login flow — JWT + refresh token rotace

1. E-mail + heslo → Auth service ověří bcrypt hash
2. Vydá **access token** (JWT RS256, 15 min) + **refresh token** (opaque UUID, httpOnly cookie, 30 dní)
3. Refresh token uložen v DB: `{token_hash, user_id, device_id, family_id, expires_at, used_at, revoked_at}`
4. Po expiraci access tokenu: klient pošle refresh token → Auth service vydá nový pár + **rotuje refresh token**

### Token theft detection (refresh token family tracking)

1. Útočník ukradne refresh token → použije ho → dostane nový pár. Starý token → `used`.
2. Legitimní uživatel použije svůj (nyní `used`) token → **Automatic reuse detection**
3. Auth service okamžitě revokuje CELOU rodinu (`family_id`) → oba odhlášeni
4. Uživatel se znovu přihlásí → nová rodina tokenů

### MFA

| Situace | Povinnost | Typ |
|---|---|---|
| Login z nového zařízení | Povinné | TOTP authenticator / SMS OTP |
| Resale transakce > 2 000 CZK | Povinné | TOTP / SMS |
| Změna e-mailu / telefonu | Povinné | Verifikace na starém + novém kanálu |
| Admin panel | Povinné vždy | TOTP + WebAuthn/FIDO2 (hardware key) |

### Device fingerprinting

**Co sbíráme (web):** Canvas hash, WebGL renderer, screen resolution, timezone, fonts, language, platform, CPU cores → SHA-256 hash = `device_fingerprint`

**Jak používáme:**
- Login z neznámého fingerprintu → risk score +30 bodů → trigger MFA
- Stejný fingerprint na více účtech → Sybil detection signál

**GDPR:** Právní základ: oprávněný zájem (čl. 6(1)(f)) — prevence podvodů. Retention: 12 měsíců.

### Session management

- Max 5 aktivních sessions per uživatel (při 6. se nejstarší revokuje)
- "Logout ze všech zařízení": revokuje všechny rodiny + Redis blacklist `user_id` s TTL 15 min (access token lifetime)

---

## 4. Resale Marketplace — specifické hrozby

### Price cap bypass
- API manipulation → **server-side validace**: Resale service volá Pricing Engine pro `max_allowed_price` = původní nákupní cena. Odmítne jakoukoliv cenu > `max_allowed_price`. `CHECK (ask_price <= original_price)` přímo v DB.
- Side payment (doplatek mimo platformu) → akceptované residuální riziko. Monitoring flaguje listing za < 20 % původní ceny.

### Escrow fraud
- Escrow release: automaticky 24 hodin po eventu, pokud nedošlo k dispute
- Evidence: gate scan log (byl ticket naskenován?) + claim log (buyer stáhl nový TOTP secret?)
- Úspěšný claim = vstupenka prokazatelně fungovala → dispute zamítnut

### Wash trading
- Cooling period: po nákupu vstupenku nelze dát na resale po dobu 24 hodin
- Graph analýza: buyer a seller sdílejí IP, device, payment method → flagováno
- AML: objem > 50 000 CZK/měsíc na resale → manuální review

### Sybil attack
- Jedno telefonní číslo = max 2 účty. Jedna platební karta = max 3 účty (clustering přes hash posledních 4 číslic + BIN + expiry).
- Network graph: community detection (Louvain method) na grafu interakcí účtů

### Collusion (seller + buyer mimo platformu)
- **Akceptované residuální riziko** — platforma nemůže kontrolovat off-platform platby
- Mitigace: **FIFO marketplace bez targeted sale** — seller nemůže vybrat konkrétního kupce → collusion je výrazně složitější

---

## 5. GDPR compliance architektura

### Data inventory (výběr)

| Data | Právní základ | Retention |
|---|---|---|
| E-mail, jméno, telefon | Plnění smlouvy (čl. 6(1)(b)) | Po dobu účtu + 3 roky |
| Fakturační adresa, transakce | Zákonná povinnost (účetnictví) | 10 let |
| TOTP secret (ticket) | Plnění smlouvy | Do skončení eventu + 30 dní |
| Device fingerprint | Oprávněný zájem (čl. 6(1)(f)) | 12 měsíců |
| Gate scan log | Plnění smlouvy + oprávněný zájem | 90 dní po eventu |

### Right to erasure — flow

1. Ověření identity žadatele (MFA)
2. Kontrola výjimek: účetní doklady (NELZE smazat → pseudonymizace), probíhající dispute
3. Pseudonymizace: jméno → `DELETED_USER_<hash>`, e-mail → `deleted_<hash>@redacted.invalid`
4. Úplný výmaz: heslo hash, TOTP secrets, device fingerprints, IP logy
5. Event-driven propagace: `user.deleted` na Kafka → každý microservice čistí vlastní PII
6. Verifikace po 48 hodinách: automatický audit

### TOTP secret ochrana
- At rest: AES-256-GCM. Key hierarchie: Master Key (Vault/KMS) → Data Encryption Key (per-ticket, derivován z Master Key + ticket_id)
- In transit: TLS 1.3 mezi services, mTLS pro gate sync

### Audit log
- Append-only, hash chain (každý záznam obsahuje hash předchozího) — detekce tampering
- Immutable storage (S3 Object Lock / WORM)
- Retention: 2 roky
- Přístup: security tým read-only přes SIEM, vývojáři NE k produkčním logům

---

## 6. Threat matrix — TOP 10

| # | Hrozba | Pravd. | Dopad | Priorita | Klíčová mitigace |
|---|---|---|---|---|---|
| 1 | Bot mass-buying | 5 | 5 | **KRITICKÁ** | Queue + PoW + JA3 + purchase limits |
| 2 | Credential stuffing / account takeover | 5 | 4 | **KRITICKÁ** | bcrypt + HaveIBeenPwned + MFA + token family |
| 3 | Sybil attack (fake accounts) | 4 | 4 | **VYSOKÁ** | Phone verification + payment clustering + cooling |
| 4 | TOTP secret exfiltrace z mobilní aplikace | 3 | 5 | **VYSOKÁ** | Hardware Keystore/Keychain + device binding |
| 5 | Insider threat | 3 | 4 | **VYSOKÁ** | RBAC + separation of duties + audit log |
| 6 | Escrow fraud / dispute abuse | 4 | 3 | **STŘEDNÍ** | Gate scan evidence + claim verification |
| 7 | Gate scanner compromise | 2 | 5 | **STŘEDNÍ** | mTLS + encrypted at-rest + post-event wipe |
| 8 | Side payment collusion | 4 | 3 | **STŘEDNÍ** | FIFO marketplace + akceptované residuální riziko |
| 9 | GDPR data breach | 2 | 5 | **STŘEDNÍ** | Encryption + network segmentation + audit |
| 10 | DDoS na ticket on-sale | 3 | 3 | **STŘEDNÍ** | CDN + rate limiting + queue absorbs spikes |

---

## Shrnutí klíčových architektonických rozhodnutí

1. **TOTP + device binding** — nejsilnější obrana proti scalping. Slabé místo: exfiltrace secretu z rooted zařízení.
2. **Refresh token family tracking** — nejlepší dostupný mechanismus pro detekci token theft bez server-side session state.
3. **Cenový strop v DB** (`CHECK ask_price ≤ original_price`) — nelze obejít na aplikační vrstvě.
4. **FIFO marketplace bez targeted sale** — price cap bypass přes collusion je výrazně složitější.
5. **Event-driven GDPR výmaz** přes Kafka `user.deleted` s post-hoc verifikací.
6. **Gate scanner offline-first** — pre-sync 4h před eventem, delta každých 30 s, secure delete po eventu.
