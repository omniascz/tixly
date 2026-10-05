# Staging (testovací prostředí) Tixly

Samostatné prostředí pro test před ostrým provozem: **vlastní databáze** (samostatný Neon projekt), **Vercel Preview**,
platby jen v **sandboxu** GoPay / ComGate, e-maily přes **Resend jen na allowlist**. S produkcí nesdílí nic.

| Soubor | K čemu |
|---|---|
| `create.sh` | Založí staging DB (Neon, `--local`, `--dry-run`), migrace, role `tixly_app`, demo data; vypíše `staging.env` |
| `seed-demo.sql` | Demo data agentury (2 místa, 2 inscenace, 4 termíny, kategorie, blokace) — idempotentní |
| `vercel-preview.env.example` | Proměnné pro Vercel → Settings → Environment Variables → **Preview** |
| `smoke.sh` | Smoke test běžícího stagingu (zdraví, e-maily přes Resend, volitelně turné, sandbox testy bran) |

## Pojistka `TIXLY_ENV=staging`

`src/lib/env/staging-guard.ts` — server **nenastartuje** (instrumentation.ts), ani nevytvoří DB pool nebo spojení s branou, když:

- DB proměnná ukazuje na produkční Neon (vestavěný endpoint/projekt + `PROD_DB_HOSTS`),
- `APP_URL` / `NEXT_PUBLIC_APP_URL` je produkční doména,
- GoPay bez `GOPAY_SANDBOX=true` nebo s `gate.gopay.cz`, ComGate bez `COMGATE_TEST=true`, ostré klíče Stripe/Mollie, PayPal/Triple-A bez sandboxu,
- **(kolo 10)** `STAGING_EMAIL_ALLOWLIST` je prázdný nebo obsahuje neplatnou položku.

## E-maily: Resend + allowlist (kolo 10)

Staging nemá Mailpit — e-maily jdou přes **Resend skutečným lidem**, proto je allowlist povinný.

- Nastavení: `SMTP_HOST=smtp.resend.com`, `SMTP_USER=resend`, `SMTP_PASS=re_…`, `RESEND_API_KEY=re_…` (týž účet),
  `STAGING_EMAIL_ALLOWLIST=tester@firma.cz, @firma.cz` (adresy nebo `@domény`; adresa pasuje i s plus-značkou `tester+x@firma.cz`).
- Na adresu **mimo allowlist se e-mail neodešle** a v logu je `[mailer] staging: příjemci mimo STAGING_EMAIL_ALLOWLIST — e-mail jim NEODEŠEL: j***@domena.cz`
  (adresa maskovaná). Má-li e-mail více příjemců, odejde jen povoleným. Totéž platí pro admin alerty (`platform-notify`, Resend HTTP API).
- Vstupenky na testovací nákupy proto kupujte na adresu z allowlistu (s plus-značkou lze odlišit nákupy: `tester+nakup1@firma.cz`).
- Odesílatel (`EMAIL_FROM`, `MAIL_FROM`) musí ležet na doméně ověřené v Resendu.

## Smoke test

```bash
STAGING_URL=https://tixly-staging.vercel.app \
RESEND_API_KEY=re_…            # klíč Resend účtu stagingu
STAGING_SMOKE_EMAIL=tester@firma.cz   # adresa z STAGING_EMAIL_ALLOWLIST
scripts/staging/smoke.sh [--dry-run] [--tour] [--skip-sandbox]
```

E-mailový krok založí dva účty a pro oba požádá o obnovu hesla: `tester+smoke-<čas>@firma.cz` (v allowlistu) a
`smoke-<čas>@blocked.invalid` (mimo). V seznamu odeslaných zpráv Resend API (`GET /emails`) pak ověří, že první
**odešla** a druhá **ne**. Scénář turné (`--tour`) čte obsah e-mailů (PDF vstupenek) z Mailpitu a posílá na adresy
`@tixly.test` — na Resend stagingu se nespouští (jen proti lokálnímu prostředí s `MAILPIT`).

## Nedokončené cesty (kolo 10)

Pro první ostrý provoz vypnuté přepínači (výchozí stav vypnuto, zapíná jen hodnota `1`, vkládá se při buildu):
`NEXT_PUBLIC_FEATURE_INSTALLMENTS` (splátky, BNPL), `NEXT_PUBLIC_FEATURE_SUBSCRIPTIONS` (předplatné, permanentky,
abonentky), `NEXT_PUBLIC_FEATURE_BENEFIT_CARDS` (benefitní karty). Na stagingu nenastavovat.

## Lokální ověření (bez Neonu a Resendu)

Resend nahrazuje simulátor `nextjs-boilerplate/tests/helpers/fake-resend.mjs` (SMTP + HTTP API se společným
seznamem odeslaných): `RESEND_API_BASE_URL=http://localhost:3996`, `SMTP_HOST=localhost`, `SMTP_PORT=2526`.
Testy: `tests/fix-r10-staging-email.test.ts`, `src/lib/env/staging-guard.test.ts`.
