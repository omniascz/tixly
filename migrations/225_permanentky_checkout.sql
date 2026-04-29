-- =============================================================================
-- Migration 225: Permanentky checkout integrace
-- Propojení orders ↔ permanentky packages + rezervace při checkoutu
-- =============================================================================

-- Propojení orders ↔ permanentky packages
CREATE TABLE IF NOT EXISTS order_packages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id UUID NOT NULL,
  package_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1 CHECK (quantity > 0),
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (order_id, package_id)
);
CREATE INDEX idx_order_packages_order ON order_packages(order_id);
CREATE INDEX idx_order_packages_package ON order_packages(package_id);

-- Rezervace balíčků při checkoutu (s expirací)
CREATE TABLE IF NOT EXISTS permanentky_reservations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id UUID NOT NULL,
  order_id UUID NOT NULL,
  quantity INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'reserved' CHECK (status IN ('reserved','active','cancelled','expired')),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (NOW() + INTERVAL '15 minutes'),
  activated_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_perm_res_order ON permanentky_reservations(order_id);
CREATE INDEX idx_perm_res_package ON permanentky_reservations(package_id);
CREATE INDEX idx_perm_res_expires ON permanentky_reservations(expires_at) WHERE status = 'reserved';
