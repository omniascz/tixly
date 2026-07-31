-- Migration 384: Proaktivní autentizace — povinné ověření telefonu při nákupu
--
-- Promotér může per-event zapnout `require_phone_verified`. Pokud je aktivní,
-- checkout odmítne nákup kupci bez ověřeného tel. čísla (phone_verified_at IS NULL).
-- Silný anti-scalping signál: boti a scalpeři typicky neprochází SMS verifikací.

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS require_phone_verified BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN catalog.events.require_phone_verified IS
  'Pokud TRUE, checkout vyžaduje phone_verified_at IS NOT NULL na identity.users. Anti-scalping gate.';
