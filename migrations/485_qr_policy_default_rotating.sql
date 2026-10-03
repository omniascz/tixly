-- 485_qr_policy_default_rotating.sql — kolo 2: výchozí QR politika = rotující TOTP
--
-- Audit (e2e_03:V0): výchozí catalog.events.qr_policy = 'static_allowed' → u brány stačilo UUID
-- vstupenky (opsatelné z PDF/screenshotu). Nově výchozí 'rotating_24h': TOTP je u brány povinný
-- od 24 h před začátkem po celou akci; PDF zůstává ke stažení. Statický QR ('static_allowed')
-- jen jako EXPLICITNÍ volba pořadatele (API / nastavení akce).
-- Existující akce se NEMĚNÍ (prodané PDF vstupenky by u brány přestaly platit) — viz report.
-- Idempotentní.
ALTER TABLE catalog.events ALTER COLUMN qr_policy SET DEFAULT 'rotating_24h';
