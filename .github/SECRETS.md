# GitHub Secrets — co nastavit

Jdi do: **GitHub repo → Settings → Secrets and variables → Actions**

## Secrets pro Deploy (environment: production)

| Secret | Kde vzít |
|--------|----------|
| `VERCEL_TOKEN` | vercel.com → Account Settings → Tokens |
| `VERCEL_ORG_ID` | vercel.com → Settings → General → Team ID |
| `VERCEL_PROJECT_ID` | vercel.com → Project → Settings → General |
| `DATABASE_URL` | Railway / Supabase / vlastní VPS — connection string |

## Secrets pro Deploy (environment: staging)

Stejné jako production, ale pro staging Vercel projekt a staging DB.

## Volitelné (pro budoucí integrace)

| Secret | Kdy |
|--------|-----|
| `GOPAY_CLIENT_SECRET` | Po získání IČO + GoPay účtu |
| `MAILGUN_API_KEY` | Při přechodu z Mailhog na produkční email |
| `APPLE_CERT_P12_BASE64` | Pro Apple Wallet push notifikace |

## Branch protection (nastavit ručně na GitHubu)

**main:**
- ✅ Require status checks: `lint`, `build`, všechny `test` joby
- ✅ Require branches to be up to date
- ✅ Require pull request before merging (1 approval)
- ✅ Do not allow bypassing above settings

**develop:**
- ✅ Require status checks: `lint`, všechny `test` joby
- ✅ Allow force push: OFF
