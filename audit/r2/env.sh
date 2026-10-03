# Kolo 2: prostredi pro auditni E2E skripty proti fix infrastrukture (source).
export AUDIT_OWNER_URL=postgresql://neondb_owner:fixowner@localhost:55632/e2e
export AUDIT_APP_URL=postgresql://tixly_app:fixapp@localhost:55632/e2e
export MAILPIT=http://localhost:58225
export FAKE_GOPAY=http://localhost:3998
export AUDIT_BASE=http://localhost:3200
export AUDIT_LOG_PREFIX=r2_
export AUDIT_STATE=./state.r2.json
export INTERNAL_SERVICE_TOKEN=fix-internal-token-0123456789abcdef
