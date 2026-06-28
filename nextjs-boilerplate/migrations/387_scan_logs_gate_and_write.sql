-- Migration 387: Add gate_id to scan_logs + ensure scan_logs has denied_reason
-- scan_logs was only being read (export), never written. This migration adds gate_id
-- and the validate route will now write every scan attempt to scan_logs.

ALTER TABLE tickets.scan_logs
  ADD COLUMN IF NOT EXISTS gate_id UUID REFERENCES catalog.venue_gates(id),
  ADD COLUMN IF NOT EXISTS denied_reason TEXT;

CREATE INDEX IF NOT EXISTS scan_logs_event_gate_idx
  ON tickets.scan_logs (event_id, gate_id)
  WHERE gate_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS scan_logs_event_result_idx
  ON tickets.scan_logs (event_id, scan_result);

COMMENT ON COLUMN tickets.scan_logs.gate_id IS
  'Fyzická brána (venue_gates) ze které sken přišel — NULL pro web-based scanner bez přiřazené brány';
COMMENT ON COLUMN tickets.scan_logs.denied_reason IS
  'Kód důvodu odepření vstupu (already_used, revoked, wrong_zone_or_day, totp_mismatch, ...)';
