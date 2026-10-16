-- 507_offline_scan_sync.sql
--   Kolo 14 / krok 1 — skener bez internetu (C-50): synchronizace offline odbavení.
--
-- POUŽITO: tickets.scan_logs (audit každého skenu, jen INSERT — triggery zakazují UPDATE/DELETE), scan_result 'duplicate'.
-- NOVĚ:    client_scan_id = ID skenu ze zařízení (idempotence: opakované odeslání téhož skenu nevytvoří druhý záznam),
--          offline = sken proběhl bez internetu (scanned_at = čas na zařízení), offline_result = verdikt zařízení.
--          Druhé offline odbavení téže vstupenky (jiný skener) se po synchronizaci zapíše jako 'duplicate'.
-- Idempotentní.

ALTER TABLE tickets.scan_logs ADD COLUMN IF NOT EXISTS client_scan_id uuid;
ALTER TABLE tickets.scan_logs ADD COLUMN IF NOT EXISTS offline boolean NOT NULL DEFAULT false;
ALTER TABLE tickets.scan_logs ADD COLUMN IF NOT EXISTS offline_result text;

CREATE UNIQUE INDEX IF NOT EXISTS scan_logs_client_scan_id_uq
  ON tickets.scan_logs (client_scan_id) WHERE client_scan_id IS NOT NULL;

-- report termínu: počet duplicitních offline vstupů
CREATE INDEX IF NOT EXISTS scan_logs_event_offline_dup_idx
  ON tickets.scan_logs (event_id) WHERE offline AND scan_result = 'duplicate';
