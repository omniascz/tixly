-- 446: EUDI peněženka — ověřený fanoušek bez sběru dat (selektivní zveřejnění)
--
-- EU Digital Identity Wallet (eIDAS 2.0, mandát 12/2026) umožní dokázat „18+",
-- „stejná osoba u vstupu" nebo „rezident" BEZ odhalení identity. Diferenciátor,
-- který US hráči (data-harvesting + biometrie) v EU nepostaví.
--
-- Framework „na klíč": aktivuje se po nastavení EUDI verifier configu
-- (EUDI_VERIFIER_URL, EUDI_CLIENT_ID). Do té doby endpointy fail-closed (503).

-- Které EUDI důkazy akce vyžaduje (selektivní zveřejnění). NULL = nevyžaduje nic.
-- Tvar: {"age18":true,"samePerson":true,"residency":"CZ"}
ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS eudi_required jsonb;

COMMENT ON COLUMN catalog.events.eudi_required IS
  'EUDI peněženka — které důkazy akce vyžaduje (selektivní zveřejnění), NULL = žádné.';

-- Výsledky ověření — ŽÁDNÉ PII, jen pseudonym subjektu + jaké claims prošly.
CREATE TABLE IF NOT EXISTS identity.eudi_verifications (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  request_id       text NOT NULL UNIQUE,          -- nonce/state OpenID4VP
  event_id         uuid REFERENCES catalog.events(id) ON DELETE CASCADE,
  order_id         uuid,                           -- volitelně navázané na objednávku
  user_id          uuid,                           -- přihlášený buyer (volitelně)
  subject_pseudonym text,                          -- pseudonymní ID subjektu (NE PII)
  claims           jsonb NOT NULL DEFAULT '{}'::jsonb,  -- {age_over_18, same_device, residency}
  status           text NOT NULL DEFAULT 'pending',    -- pending|verified|failed|expired
  created_at       timestamptz NOT NULL DEFAULT now(),
  verified_at      timestamptz,
  expires_at       timestamptz NOT NULL DEFAULT now() + interval '10 minutes'
);

CREATE INDEX IF NOT EXISTS idx_eudi_ver_order ON identity.eudi_verifications(order_id);
CREATE INDEX IF NOT EXISTS idx_eudi_ver_event ON identity.eudi_verifications(event_id);
