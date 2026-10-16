#!/usr/bin/env bash
# Kolo 10 / krok 4: server v režimu TIXLY_ENV=staging. Lokální hodnoty z fix.app.env, přepsané proměnnými
# předanými volajícím (STG_*). Jen localhost / hostitelé .invalid — nikdy produkce.
cd /c/Users/omnia/Documents/tixly/nextjs-boilerplate || exit 1
set -a; . ./fix.app.env; set +a
export TIXLY_ENV=staging
export DATABASE_URL="$STG_DB" DATABASE_URL_DIRECT="$STG_DB" DATABASE_URL_SUPER="$STG_DB_OWNER" DATABASE_URL_OPS="$STG_DB_OWNER"
export STAGING_EMAIL_ALLOWLIST="${STG_ALLOWLIST-}"
export SMTP_HOST="${STG_SMTP_HOST:-localhost}" SMTP_PORT="${STG_SMTP_PORT:-2526}" SMTP_USER=resend SMTP_PASS="${STG_RESEND_KEY:-re_test_r10}" SMTP_SECURE=false
export RESEND_API_KEY="${STG_RESEND_KEY:-re_test_r10}" RESEND_API_BASE_URL="${STG_RESEND_API:-http://localhost:3996}"
export EMAIL_FROM='Tixly STAGING <noreply@staging.example>' MAIL_FROM='Tixly STAGING <noreply@staging.example>'
export KV_URL=redis://localhost:56679 KV_REST_API_URL=http://localhost:9 ARES_BASE_URL=http://localhost:3997
exec npx next start -p 3200
