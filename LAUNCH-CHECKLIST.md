# Tixly — Go-live checklist (k ostrému provozu)

Cíl: **reálný divák zaplatí reálnou kartou a dostane lístek do e-mailu.**
Stav (2026-06-01): kód je na ostrý provoz připravený. Blockery jsou **externí** —
tvoje účty / registrace / doména / právní revize. Níže přesně co a kde.

---

## ✅ Hotové (kód) — netřeba sahat
- Platební abstrakce GoPay + ComGate + Stripe (`src/lib/payment/`), přepínač přes `PAYMENT_PROVIDER`. Reálná GoPay integrace (`gopay-real.ts`) naběhne automaticky, jakmile jsou klíče.
- Odesílání e-mailů provider-agnostic SMTP (`src/lib/email/mailer.ts`).
- Právní stránky `/legal/terms`, `/legal/privacy`, cookie-settings + GDPR API + mazací cron.
- DB se postaví od nuly spolehlivě (`scripts/provision-clean-db.sh`), golden-path ověřen.
- App neběží jako DB superuser (Fáze 1 RLS/superuser nápravy).

---

## 🔑 TIER 0 — bez tohohle NELZE pustit (potřebuje tvoje účty)

### 1. Reálná platební brána
- [ ] Merchant účet GoPay (gopay.com) — máš Fio účet, na něj se to napojí.
- [ ] Nastavit env (produkce): `GOPAY_GOID`, `GOPAY_CLIENT_ID`, `GOPAY_CLIENT_SECRET`,
      `GOPAY_REDIRECT_URL=https://<doména>/api/auth/gopay/callback`,
      `GOPAY_MOCK=0`, `PAYMENT_PROVIDER=gopay`.
- [ ] (Alternativa/EUR: ComGate — `COMGATE_MERCHANT`, `COMGATE_SECRET`, `COMGATE_TEST=false`.)
- [ ] **Jedna reálná zkušební platba v sandboxu od začátku do konce** (objednávka → platba → webhook → lístek). Tohle je test, co rozhoduje o všem.
- [ ] Ověřit podpis callbacku na ostro (ne mock HMAC).

### 2. Reálné odesílání e-mailů
- [ ] Účet Resend + **ověřit doménu** (SPF / DKIM / DMARC DNS záznamy).
- [ ] Env: `SMTP_HOST=smtp.resend.com`, `SMTP_PORT=587`, `SMTP_USER=resend`,
      `SMTP_PASS=re_xxx`, `SMTP_SECURE=false`, `EMAIL_FROM=vstupenky@<doména>`.
- [ ] Test: dokončit objednávku → přijde e-mail s PDF lístkem a QR.

### 3. Produkční databáze
- [ ] Vytvořit prod DB (Neon / Supabase / Hetzner Postgres).
- [ ] `DATABASE_URL=postgresql://tixly_app:<silné-heslo>@host:5432/tixly` (NE superuser!).
- [ ] Provisioning: `DATABASE_URL=<superuser-url> SEED=0 ./scripts/provision-clean-db.sh`
      (role + baseline; bez demo seedu pro produkci). Pak `ALTER ROLE tixly_app PASSWORD '<silné>'`.
- [ ] Denní záloha DB.

### 4. Bezpečnostní tajemství (vygenerovat nová, NE dev defaulty)
- [ ] `JWT_SECRET` = `openssl rand -hex 64`.
- [ ] `ENCRYPTION_KEY` = `openssl rand -hex 32` (POZOR: po nasazení neměnit — šifruje TOTP/stream).
- [ ] `INTERNAL_SERVICE_TOKEN` = náhodný silný (cron → interní endpointy, mock webhook).
- [ ] `NEXT_PUBLIC_APP_URL=https://<doména>` (musí sedět kvůli server-side callbackům).

---

## ⚠️ TIER 1 — právně/provozně před prvním prodejem

- [ ] **Doplnit do `/legal/privacy` a `/legal/terms`** konkrétního správce: Tixly s.r.o.,
      IČO, adresu (privacy stránka má dnes explicitní placeholder) — a **nechat právníka projít**
      VOP, GDPR, reklamační/storno řád.
- [ ] Ověřit fakturu/účtenku + DPH (10 % u vstupenek) na reálné objednávce.
- [ ] `SENTRY_DSN` — monitoring + alert „platba prošla, ale lístek se nevystavil".
- [ ] Webhook URL zaregistrované u GoPay/ComGate na produkční doménu.

---

## Pořadí (doporučené)
1. Prod DB + secrets (Tier 0 body 3+4) → app vůbec naběhne na ostro.
2. Resend doména + e-maily (bod 2) → lístky dorazí.
3. GoPay klíče + zkušební platba (bod 1) → tok peněz funguje.
4. Právní doplnění + DPH ověření (Tier 1) → smíš vzít první korunu.
5. Pilotní pořadatel, jedna malá reálná akce (Divadlo v Celetné je nasídlené).

> Nic z Tier 0/1 nejde napsat v editoru za tebe — všechno visí na tvých účtech a registracích.
> Až budeš mít klíče/doménu, můžu projít nastavení env + odladit zkušební platbu a e-mail.
