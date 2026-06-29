-- Migration 439: Hardwarová POS integrace
-- Thermal tiskárna (Zebra/Boca) — ZPL nebo PDF přes IP adresu

-- ─── POS terminály ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform.pos_terminals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id uuid NOT NULL REFERENCES platform.promoters(id) ON DELETE CASCADE,
  name text NOT NULL,
  printer_type text NOT NULL DEFAULT 'zebra',
  printer_ip text,
  printer_port int NOT NULL DEFAULT 9100,
  paper_width_mm int NOT NULL DEFAULT 104,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_terminals_promoter_idx ON platform.pos_terminals (promoter_id);

ALTER TABLE platform.pos_terminals ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_terminals_promoter ON platform.pos_terminals
  FOR ALL
  USING (promoter_id::text = current_setting('app.current_promoter_id', true));

CREATE POLICY pos_terminals_admin ON platform.pos_terminals
  FOR ALL
  USING (current_setting('app.is_platform_admin', true) = 'true');

-- ─── Print jobs ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS platform.pos_print_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id uuid NOT NULL REFERENCES platform.pos_terminals(id) ON DELETE CASCADE,
  order_id uuid NOT NULL REFERENCES orders.orders(id),
  ticket_ids uuid[] NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  format text NOT NULL DEFAULT 'zpl',
  payload text,
  printed_at timestamptz,
  error_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS pos_print_jobs_terminal_idx ON platform.pos_print_jobs (terminal_id, created_at DESC);

CREATE INDEX IF NOT EXISTS pos_print_jobs_order_idx ON platform.pos_print_jobs (order_id);

ALTER TABLE platform.pos_print_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY pos_print_jobs_promoter ON platform.pos_print_jobs
  FOR ALL
  USING (
    terminal_id IN (
      SELECT id FROM platform.pos_terminals
      WHERE promoter_id::text = current_setting('app.current_promoter_id', true)
    )
  );

CREATE POLICY pos_print_jobs_admin ON platform.pos_print_jobs
  FOR ALL
  USING (current_setting('app.is_platform_admin', true) = 'true');
