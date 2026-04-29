# White-Label Architektura — Tixly Multi-Tenant SaaS

> Verze: 1.0 | Datum: 2026-04-07 | Autor: Opus (úkol #59)  
> Navazuje na: rls-multitenancy, jwt-auth, platform-promoters, embed-widget, email-templates

---

## Kontext a výchozí stav

Existující architektura poskytuje tyto stavební bloky:

- `withTenantContext()` — PostgreSQL RLS s `SET LOCAL app.current_promoter_id/user_id/role`
- `platform.promoters` — obsahuje `id`, `slug`, `status`, `kyc_status`, `logo_url`, `brand_colors` (JSONB)
- JWT middleware (Edge Runtime) — validuje `iss=tixly`, `aud=tixly-api`
- Embed widget — iframe s postMessage, origin-verified komunikace
- Email renderer — Handlebars šablony, `base.html` s hardcoded Tixly brandingem
- Next.js boilerplate — `layout.tsx` čte `x-locale` header z middleware

Klíčové pozorování: `platform.promoters.brand_colors` JSONB pole již existuje, ale obsahuje pouze
`{ primary, secondary, accent }` — není plnohodnotný theme systém. Toto rozšíříme.

---

## 1. Domain Routing Strategie

### 1.1 Dvě formy přístupu

```
Forma A (Starter):  slavia.tixly.cz     — wildcard subdoména
Forma B (Pro/Ent):  vstupenky.slaviapraha.cz  — vlastní doména (CNAME)
```

### 1.2 Architektura rozlišení tenanta

Tenant rozlišení probíhá **výhradně v Next.js middleware** (Edge Runtime) — dříve než cokoliv dalšího.

**Algoritmus v middleware:**

```
1. Přečti request.headers.get('host')  [nikdy URL params — bezpečnost]
2. Normalizuj: lowercase, strip port
3. Pokus A: match *.tixly.cz → extract slug
4. Pokus B: lookup Redis klíč `domain:{host}` → vrátí promoter_id
5. Pokud nenalezeno: redirect na tixly.cz/404-tenant nebo vykresli fallback
6. Nastav response headers:
   - x-tenant-id: <promoter_id>
   - x-tenant-slug: <slug>
   - x-tenant-domain-type: subdomain | custom
```

**Proč Redis pro custom domains místo DB:** DB lookup v middleware znamená latenci 5–20 ms navíc
na každý request. Redis vrátí < 1 ms. Cache TTL = 5 minut. Invalidace při změně domény.

**Proč header propagace, ne URL params:** Konzistentní se stávajícím vzorem `x-locale` v layout.tsx.
URL params by kontaminovaly SEO a analytics.

### 1.3 Host Header Security

Middleware musí validovat host proti whitelistu před jakoukoliv logikou:

```typescript
// Povolené vzory — žádný jiný host nebude obsloužen jako tenant
const ALLOWED_HOST_PATTERNS = [
  /^[a-z0-9-]{2,63}\.tixly\.cz$/,   // subdomény
  /^[a-z0-9.-]{4,253}$/,                   // custom domains (ověřené v DB)
];

// Ochrana před Host Header Injection:
// 1. Strip X-Forwarded-Host (Cloudflare posílá skutečný host v CF-Worker)
// 2. Validuj proti whitelistu výše
// 3. Pro custom domains: pouze domény s verified_at IS NOT NULL v platform.custom_domains
// 4. Odmítni vše ostatní — vrať 400 (ne 404, aby útočník nezjistil existenci tenantu)
```

**Subdomain spoofing mitigace:** Cloudflare Workers jsou nasazeni před Next.js aplikací.
Aplikace důvěřuje pouze hostu přijatému od Cloudflare (skutečný SNI host). `X-Forwarded-Host` ignorován.

### 1.4 DNS Verifikace vlastní domény

**Flow pro Pro/Enterprise tenanta:**

```
1. Promotér zadá: vstupenky.slaviapraha.cz
2. Systém vygeneruje verification_token (crypto.randomUUID())
3. Uloží do platform.custom_domains (status='pending')
4. Zobrazí instrukci: přidej TXT záznam:
   _tixly-verify.vstupenky.slaviapraha.cz  TXT  "tixly-verify={token}"
5. Promotér klikne "Ověřit"
6. Backend zavolá dns.promises.resolveTxt('_tixly-verify.{domain}')
7. Pokud TXT odpovídá tokenu → verified_at = NOW(), status='verified'
8. Spustí SSL provisioning
```

**Retry policy:** Cron job každých 15 minut zkouší neverifikované domény (max 96 pokusů = 24 h).
Po 48 h bez verifikace → status='expired', nutno začít znovu.

### 1.5 SSL Certifikáty

**Rozhodnutí: Cloudflare for SaaS** (ne Let's Encrypt přímé)

Důvod: Let's Encrypt rate limit je 50 certifikátů/doménu/týden — blocker při růstu.
Cloudflare for SaaS:
- Promotér nastaví CNAME: `vstupenky.slaviapraha.cz → tenants.tixly.cz`
- Cloudflare automaticky vydá certifikát pro custom hostname
- Provisioning < 60 sekund
- Žádné rate limity

```typescript
// API flow:
POST https://api.cloudflare.com/client/v4/zones/{ZONE_ID}/custom_hostnames
{ "hostname": "vstupenky.slaviapraha.cz", "ssl": { "method": "http", "type": "dv" } }
→ vrátí custom_hostname_id → ulož do platform.custom_domains.cf_hostname_id
→ poll ssl.status každých 30s dokud 'active'
→ nastav ssl_provisioned_at = NOW()
```

**Fallback pro lokální dev:** `localhost:3000` vždy obsluhuje jako Tixly platform bez tenanta.

---

## 2. Theme Systém

### 2.1 Co je přizpůsobitelné (per-tier)

| Vlastnost | Starter | Pro | Enterprise |
|---|---|---|---|
| Logo URL | ✅ | ✅ | ✅ |
| Favicon URL | ❌ | ✅ | ✅ |
| Primary color | ✅ | ✅ | ✅ |
| Secondary color | ❌ | ✅ | ✅ |
| Accent color | ❌ | ✅ | ✅ |
| Font (Google Fonts) | ❌ | ✅ | ✅ |
| Hero image | ❌ | ✅ | ✅ |
| Footer text | ❌ | ✅ | ✅ |
| Custom CSS override | ❌ | ❌ | ✅ |
| E-mail šablony | ❌ | ❌ | ✅ |
| Custom SMTP | ❌ | ❌ | ✅ |
| Skrytí "Powered by" | ❌ | ❌ | ✅ |

### 2.2 Technologie: CSS Custom Properties (CSS Variables)

**Rozhodnutí: CSS Custom Properties vložené do `<head>` při SSR.**

Zamítnuté alternativy:
- **Tailwind config per-tenant:** Vyžaduje build-time znalost tenantu. Nelze dynamicky.
- **CSS-in-JS:** Runtime overhead, hydration problémy s RSC, komplexní SSR setup.
- **Inline styles:** Nepodporuje pseudo-selektory, media queries, hover states.

```tsx
// src/app/layout.tsx
export default async function RootLayout({ children }) {
  const tenantId = headers().get('x-tenant-id')
  const theme = tenantId ? await getTenantTheme(tenantId) : DEFAULT_THEME
  const cssVars = buildCssVars(theme)

  return (
    <html lang={lang}>
      <head>
        {/* Theme injected server-side — žádný FOUC */}
        <style id="tenant-theme" dangerouslySetInnerHTML={{ __html: cssVars }} />
        {theme.fontFamily && (
          <link rel="stylesheet"
            href={`https://fonts.googleapis.com/css2?family=${encodeURIComponent(theme.fontFamily)}:wght@400;500;600;700&display=swap`} />
        )}
        {theme.faviconUrl && <link rel="icon" href={theme.faviconUrl} />}
      </head>
      <body style={{ fontFamily: theme.fontFamily ? `'${theme.fontFamily}', sans-serif` : undefined }}>
        <Providers theme={theme}>{children}</Providers>
      </body>
    </html>
  )
}
```

```typescript
function buildCssVars(theme: TenantTheme): string {
  const vars: Record<string, string> = {
    '--color-primary':   theme.primaryColor   ?? '#6366f1',
    '--color-secondary': theme.secondaryColor ?? '#4f46e5',
    '--color-accent':    theme.accentColor    ?? '#f59e0b',
    '--font-family':     theme.fontFamily
      ? `'${theme.fontFamily}', sans-serif`
      : 'system-ui, sans-serif',
  }
  let css = `:root {\n${Object.entries(vars).map(([k,v]) => `  ${k}: ${v};`).join('\n')}\n}`

  // Enterprise: sanitizovaný custom CSS override (max 50 KB)
  if (theme.customCss) {
    css += `\n/* tenant-custom */\n${sanitizeCss(theme.customCss)}`
  }
  return css
}
```

### 2.3 Theme Caching

```
Request → middleware (host → x-tenant-id)
        → layout.tsx → getTenantTheme(tenantId)
              ↓
        Redis GET theme:{tenantId}
              ↓ HIT < 1ms    ↓ MISS
              return       PostgreSQL SELECT
                                 ↓
                           Redis SET theme:{tenantId} EX 600
                                 ↓
                           return theme
```

**Invalidace:**
- Promotér uloží theme → API handler: `redis.del('theme:{tenantId}')`
- Kafka event `promoter.theme.updated` → consumer invaliduje cache (multi-region)
- Fallback: TTL 10 minut = eventual consistency bez explicitní invalidace

---

## 3. Datový Model

### Migrace: `029_white_label.sql`

```sql
-- ── platform.tenant_themes ──────────────────────────────────────────────────
CREATE TABLE platform.tenant_themes (
  promoter_id       UUID PRIMARY KEY REFERENCES platform.promoters(id) ON DELETE CASCADE,
  logo_url          TEXT,
  favicon_url       TEXT,
  hero_image_url    TEXT,
  primary_color     CHAR(7),
  secondary_color   CHAR(7),
  accent_color      CHAR(7),
  font_family       TEXT,                    -- Google Fonts název (whitelist 50)
  footer_text       TEXT,                    -- max 500 znaků, Pro+
  powered_by_hidden BOOLEAN NOT NULL DEFAULT FALSE,
  custom_css        TEXT,                    -- max 50 KB, Enterprise, sanitizováno
  plan_tier         TEXT NOT NULL DEFAULT 'starter'
                    CHECK (plan_tier IN ('starter', 'pro', 'enterprise')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_tenant_themes_updated ON platform.tenant_themes(updated_at DESC);

-- ── platform.custom_domains ─────────────────────────────────────────────────
CREATE TABLE platform.custom_domains (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id       UUID NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  domain            TEXT NOT NULL,
  domain_type       TEXT NOT NULL DEFAULT 'custom'
                    CHECK (domain_type IN ('custom', 'subdomain')),
  verification_token TEXT NOT NULL DEFAULT encode(gen_random_bytes(32), 'hex'),
  verified_at       TIMESTAMPTZ,
  verification_attempts INT NOT NULL DEFAULT 0,
  last_verification_attempt TIMESTAMPTZ,
  cf_hostname_id    TEXT,
  ssl_status        TEXT NOT NULL DEFAULT 'pending'
                    CHECK (ssl_status IN ('pending', 'provisioning', 'active', 'failed')),
  ssl_provisioned_at TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'pending'
                    CHECK (status IN ('pending', 'verified', 'active', 'expired', 'disabled')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT custom_domains_domain_unique UNIQUE (domain)
);

-- Kritický index — hit na každý request v middleware
CREATE UNIQUE INDEX idx_custom_domains_domain_active
  ON platform.custom_domains(domain)
  WHERE status = 'active';

CREATE INDEX idx_custom_domains_pending
  ON platform.custom_domains(last_verification_attempt)
  WHERE status = 'pending' AND verified_at IS NULL;

-- ── platform.email_sender_configs ───────────────────────────────────────────
CREATE TABLE platform.email_sender_configs (
  promoter_id             UUID PRIMARY KEY REFERENCES platform.promoters(id) ON DELETE CASCADE,
  from_email              TEXT NOT NULL,
  from_name               TEXT NOT NULL,
  reply_to                TEXT,
  provider                TEXT NOT NULL CHECK (provider IN ('sendgrid', 'mailgun', 'ses', 'smtp')),
  api_key_encrypted       TEXT,              -- AES-256-GCM
  smtp_host               TEXT,
  smtp_port               INT,
  smtp_user               TEXT,
  smtp_password_encrypted TEXT,              -- AES-256-GCM
  dns_verified_at         TIMESTAMPTZ,
  test_sent_at            TIMESTAMPTZ,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

**Propojení s existující `platform.promoters`:**
- `platform.promoters.brand_colors` JSONB → migrace 030 přesune do `tenant_themes`
- `platform.promoters.slug` → subdoména `{slug}.tixly.cz`
- Stávající `logo_url` na promoters zůstane jako deprecated (zpětná kompatibilita)

---

## 4. Izolace a Bezpečnost

### 4.1 Vrstvená obrana

```
Vrstva 1: Cloudflare WAF — blokuje podezřelé requesty na hostname-level
Vrstva 2: Next.js Middleware — rozlišení tenanta z host headeru, odmítnutí neznámých hostů
Vrstva 3: Server Components/API — čtou x-tenant-id z headers(), NIKDY z URL/body
Vrstva 4: PostgreSQL RLS — withTenantContext() garantuje DB-level izolaci
Vrstva 5: Redis Key Isolation — prefix theme:{promoterId}:*, session:{promoterId}:*
```

### 4.2 Kritické pravidlo

> **Tenant ID nikdy neplyne z klientsky kontrolovaného vstupu.**
> Vždy: host header → middleware → `x-tenant-id` server header.

### 4.3 Domain Whitelist enforcement

```typescript
async function resolveTenant(host: string): Promise<TenantResolution | null> {
  // 1. Subdoména tixly.cz
  const subdomainMatch = host.match(/^([a-z0-9][a-z0-9-]{0,61}[a-z0-9])\.tixly\.cz$/)
  if (subdomainMatch) {
    const slug = subdomainMatch[1]
    if (RESERVED_SLUGS.has(slug)) return null  // 'api', 'admin', 'cdn', 'www'
    const promoterId = await redis.get(`slug:${slug}`)
    return promoterId ? { promoterId, type: 'subdomain' } : null
  }
  // 2. Custom doména — pouze active + ssl_status='active'
  const promoterId = await redis.get(`domain:${host}`)
  if (promoterId) return { promoterId, type: 'custom' }
  // 3. Neznámý host — odmítni (400, ne 404)
  return null
}
```

---

## 5. Omezení Per-Plan

### Starter (výchozí po registraci)
- Subdomína `{slug}.tixly.cz` pouze
- Theme: logo + primary_color
- "Powered by Tixly" vždy viditelné
- Sdílený SMTP (`no-reply@tixly.cz`)

### Pro (podmínka: kyc_status = 'verified')
- Vlastní doména s SSL
- Full color palette, Google Font, hero image, footer text
- Sdílený SMTP, ale přizpůsobitelný from_name

### Enterprise (smluvní)
- Custom CSS override (sanitizováno, max 50 KB)
- White-label e-mailové šablony
- Vlastní SMTP/SendGrid/Mailgun per-tenant
- Vlastní from_email (DNS SPF/DKIM verifikace)
- `powered_by_hidden = true`

```typescript
function validateThemeForPlan(theme: Partial<TenantThemeInput>, plan: PlanTier): void {
  const ALLOWED: Record<PlanTier, Set<keyof TenantThemeInput>> = {
    starter:    new Set(['logoUrl', 'primaryColor']),
    pro:        new Set(['logoUrl', 'faviconUrl', 'primaryColor', 'secondaryColor',
                         'accentColor', 'fontFamily', 'heroImageUrl', 'footerText']),
    enterprise: new Set(['logoUrl', 'faviconUrl', 'primaryColor', 'secondaryColor',
                         'accentColor', 'fontFamily', 'heroImageUrl', 'footerText',
                         'customCss', 'poweredByHidden']),
  }
  for (const [key, value] of Object.entries(theme)) {
    if (value !== undefined && !ALLOWED[plan].has(key as keyof TenantThemeInput)) {
      throw new PlatformError('PLAN_FEATURE_NOT_AVAILABLE',
        `Feature '${key}' requires plan upgrade from '${plan}'`)
    }
  }
}
```

---

## 6. White-Label E-mailové Šablony

### 6.1 Template Inheritance

```
base.html (Handlebars parametrizovaný)
  └─ renderTenantEmail() — injectuje TenantEmailBranding
        └─ order-confirmation.html, ticket-delivery.html, ...
```

```typescript
interface TenantEmailBranding {
  logoUrl: string | null
  primaryColor: string
  fromName: string
  footerText: string | null
  poweredByHidden: boolean
  customHeaderHtml?: string   // Enterprise, max 200 znaků sanitizovaného HTML
  customFooterHtml?: string
}

export function renderTenantEmail(
  templateName: EmailTemplate,
  variables: Record<string, unknown>,
  branding: TenantEmailBranding,
): EmailRenderResult {
  // base.html vars: {{tenantName}}, {{tenantLogoUrl}}, {{headerGradient}},
  //                 {{footerText}}, {{poweredBy}}
  return renderEmail(templateName, { ...variables, branding })
}
```

**Proč ne plně customizovatelné HTML:** Bezpečnostní důvod — promotér by mohl injektovat
phishing obsah. Enterprise dostane pouze omezené HTML bloky (DOMPurify server-side).

### 6.2 Custom SMTP — Strategy Pattern

```typescript
async function sendEmail(to, subject, html, text, promoterId): Promise<void> {
  const config = await getEmailSenderConfig(promoterId)  // Redis cache

  if (config?.provider === 'sendgrid') {
    await sendViaSendGrid(to, subject, html, text, {
      apiKey: decrypt(config.apiKeyEncrypted),
      from: config.fromEmail, fromName: config.fromName,
    })
  } else if (config?.provider === 'mailgun') {
    await sendViaMailgun(/* ... */)
  } else {
    await sendViaSharedSendGrid(to, subject, html, text, {
      fromName: config?.fromName ?? 'Tixly',
    })
  }
}
```

Credentials v DB šifrované **AES-256-GCM** (klíč v `EMAIL_ENCRYPTION_KEY` env var).

---

## 7. Embedding (Booking Widget)

### Zachovat iframe architekturu

Zamítnuté alternativy:
- Shadow DOM — nestačí pro platební flow (popup/redirect)
- Web Components — compatibility issues, zbytečná komplexita
- **Iframe** ✅ — přirozená security boundary, platební flow bezpečný

### Rozšíření pro White-Label

```html
<div data-tixly-event="evt_abc123"
     data-tixly-tenant="slavia"
     data-tixly-locale="cs">
</div>
<script src="https://cdn.tixly.cz/widget.js" async></script>
```

```typescript
// widget-loader.ts
const tenant = container.getAttribute('data-tixly-tenant')
  ?? container.getAttribute('data-tenant')  // zpětná kompatibilita

const src = tenant
  ? `https://${tenant}.tixly.cz/widget/${eventId}?${params}`
  : `${TIXLY_BASE_URL}/widget/${eventId}?${params}`
```

**Theme v widgetu plyne automaticky** — widget iframe běží na `{tenant}.tixly.cz`,
middleware detekuje tenanta z host headeru → inject CSS variables. Žádná extra konfigurace.

---

## 8. Implementační Plán pro #60

### Sekvence

```
Sprint 1 (blocker):
  [A] migrations/029_white_label.sql
  [A] middleware.ts — host → x-tenant-id
  [A] tenant-theme.ts — getTenantTheme() + Redis cache

Sprint 2 (paralelně po Sprint 1):
  [B1] layout.tsx — CSS variable injection + Google Fonts
  [B2] API: CRUD /api/platform/themes
  [B3] DNS verifikace cron job

Sprint 3 (paralelně po Sprint 2):
  [C1] Cloudflare for SaaS integrace
  [C2] renderTenantEmail() + base.html parametrizace
  [C3] validateThemeForPlan() enforcement

Sprint 4:
  [D1] Widget data-tixly-tenant rozšíření
  [D2] Enterprise custom CSS sanitizer
  [D3] Enterprise vlastní SMTP
  [D4] Migrace stávajících promoters.brand_colors → tenant_themes
```

### Soubory pro #60

**Nové:**
- `migrations/029_white_label.sql`
- `src/lib/white-label/tenant-theme.ts`
- `src/lib/white-label/domain-resolver.ts`
- `src/lib/white-label/css-sanitizer.ts`
- `src/lib/white-label/plan-enforcement.ts`
- `src/lib/white-label/email-sender.ts`
- `src/app/api/platform/themes/route.ts`
- `src/app/api/platform/themes/domains/route.ts`
- `src/app/api/platform/themes/domains/[id]/verify/route.ts`
- `src/jobs/verify-domains.ts`

**Upravit existující:**
- `src/middleware.ts` — tenant rozlišení
- `src/app/layout.tsx` — theme injection
- `email-templates/shared/email-renderer.ts` — renderTenantEmail()
- `email-templates/shared/base.html` — Handlebars parametrizace
- `embed-widget/src/lib/widget-loader.ts` — data-tixly-tenant

### Odhadované testy pro #60

| Oblast | Unit | Integration |
|---|---|---|
| getTenantTheme() + Redis cache | 8 | — |
| buildCssVars() + sanitizeCss() | 10 | — |
| validateThemeForPlan() per tier | 12 | — |
| Host header resolution + security | 10 | — |
| DNS verifikace flow | 6 | 4 |
| renderTenantEmail() branding | 8 | — |
| Custom SMTP strategy pattern | 6 | — |
| Theme CRUD API | — | 6 |
| Cross-tenant isolation | — | 4 |
| Widget tenant resolution | 4 | — |
| **Celkem** | **~64** | **~18** |

**Celkem pro #60: ~82 testů**

---

## 9. Trade-offs a Rizika

### Výkon
Redis HIT < 1 ms per request. Pro high-traffic tenant (10 k req/min): Redis cluster nutný.
Stale-while-revalidate: při TTL expiry vrátit stale a refreshnout na pozadí.

### DNS komplexita
- Promotér přidá TXT na špatnou subdoménu → admin panel zobrazí live DNS lookup výsledek
- DNS TTL 3600 s → v UI: "DNS propagace může trvat 15 minut – 48 hodin"
- Cron loguje každý pokus do `platform.admin_actions`

### SSL provisioning
- Cloudflare for SaaS: typicky 30–120 s
- Při selhání: retry 3× s exponential backoff, pak alert do admin
- Fallback: redirect na `{slug}.tixly.cz` dokud ssl_status != 'active'

### Cache invalidace
- Preview v promotér adminu: přímý DB dotaz (bez cache) → okamžité zobrazení
- Zákazníci: eventual consistency do 10 minut

### SEO
- Custom doména: tenant kontroluje vlastní SEO, nedědí domain authority tixly.cz
- Subdoména: dědí DA tixly.cz, Google indexuje jako součást platformy
- JSON-LD Event structured data musí obsahovat správnou URL domény tenanta
- robots.txt: per-tenant konfigurace (Starter: platform default, Pro/Enterprise: customizable)

### GDPR
- Custom doména + SSL: DPA (Data Processing Agreement) nutná — template v Enterprise onboardingu
- Custom SMTP: promotér zodpovídá za GDPR souhlas na marketing emaily

---

## 10. Klíčová rozhodnutí — Souhrn

| Oblast | Rozhodnutí | Důvod |
|---|---|---|
| Domain routing | Host header v middleware → Redis → x-tenant-id | < 1 ms, bez URL kontaminace |
| SSL | Cloudflare for SaaS | Žádné Let's Encrypt rate limity |
| DNS verifikace | TXT challenge | Standard, bez potřeby přístupu k DNS provideru |
| Theme technologie | CSS Custom Properties, SSR inject | Nulový FOUC, žádný runtime overhead |
| Theme cache | Redis TTL 10 min + explicitní invalidace | Výkon + eventual consistency |
| Datový model | 3 nové tabulky v platform schema | Čisté oddělení od ticketing dat |
| Izolace | Tenant ID vždy z host headeru, nikdy z klienta | Defense in depth nad RLS |
| E-mail | Template inheritance + strategy pattern SMTP | Bezpečné + extensible |
| Widget | Zachovat iframe | Bezpečnostní boundary pro platební flow |
| Custom CSS | Sanitizace + max 50 KB (Enterprise only) | Anti-phishing, anti-XSS |
