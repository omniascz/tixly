-- 483_scan_logs_writable.sql — kolo 2 / V4: každý sken u brány se zapíše do tickets.scan_logs
--
-- Audit V4: `logScan failed` 25×, scan_logs 0 řádků. Příčiny (ověřeno testem, logs/r2/5_v4_RED.txt):
--  1) scanned_by_device_id uuid NOT NULL — webový skener deviceId neposílá, API přijímá
--     libovolný řetězec (např. 'gate-1-tablet') → NOT NULL / 22P02.
--  2) CHECK scan_result připouštěl jen 'ok','duplicate','revoked','invalid','expired', ale skener
--     zapisuje (a live-ops čte) 'admitted','already_used','denied' → porušení CHECK u KAŽDÉHO skenu.
-- Oprava: zařízení volitelné (uuid, je-li id UUID) + device_label pro textová id; CHECK rozšířen
-- o slovník, který kód skutečně zapisuje i čte (staré hodnoty ponechány kvůli historickým řádkům).
-- Idempotentní.

BEGIN;

ALTER TABLE tickets.scan_logs ALTER COLUMN scanned_by_device_id DROP NOT NULL;
ALTER TABLE tickets.scan_logs ADD COLUMN IF NOT EXISTS device_label text;

ALTER TABLE tickets.scan_logs DROP CONSTRAINT IF EXISTS scan_logs_scan_result_check;
ALTER TABLE tickets.scan_logs ADD CONSTRAINT scan_logs_scan_result_check
  CHECK (scan_result = ANY (ARRAY['ok','duplicate','revoked','invalid','expired',
                                  'admitted','already_used','denied']));

COMMIT;
