# AUDIT session 3: prostredi pro E2E skripty (source). Porty se lisi od session 1 (55432 obsadil cizi kontejner).
export AUDIT_OWNER_URL=postgresql://neondb_owner:auditowner@localhost:55532/e2e
export MAILPIT=http://localhost:58125
export FAKE_GOPAY=http://localhost:3999
export AUDIT_BASE=http://localhost:3100
export AUDIT_LOG_PREFIX=s3_
export AUDIT_STATE=./state.s3.json
export INTERNAL_SERVICE_TOKEN=audit-internal-token-0123456789abcdef
export AUDIT_APP_URL=postgresql://tixly_app:auditapp@localhost:55532/e2e
