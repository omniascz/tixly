-- Slevové typy vstupenek — označení typu jako vyžadující průkaz/ověření.
--
-- ticket_types už podporuje různé ceny per typ (Plné, Studentská, Senior).
-- Tato migrace přidává metadata pro:
--   - typ slevy (pro UI label + ikonu)
--   - vyžaduje verification (na vstupu ukázat ISIC, OP, ZTP/P, rodný list)
--   - hint text pro buyer i scanner

BEGIN;

ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS discount_kind TEXT
    CHECK (discount_kind IS NULL OR discount_kind IN (
      'full',           -- plné vstupné (default, nikdy nevyžaduje ID)
      'student',        -- studentská — ISIC nebo ITIC nebo studijní průkaz
      'senior',         -- senior 65+ — OP
      'child',          -- dětská (do 12/15 let) — rodný list / OP rodiče
      'youth',          -- mládež 12-18
      'ztp',            -- ZTP / ZTP-P — průkaz ZTP
      'ztp_companion',  -- doprovod ZTP (typicky zdarma)
      'family',         -- rodinná (2 dospělí + 2 děti, bundle)
      'group',          -- skupinová (10+ osob)
      'staff',          -- pracovník instituce
      'season_member', -- držitel sezónní permanentky
      'school'          -- školní výprava
    ));

ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS requires_verification BOOLEAN NOT NULL DEFAULT FALSE;

ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS verification_hint TEXT;

COMMENT ON COLUMN catalog.ticket_types.discount_kind IS
  'Typ slevy — pro UI ikonu a label. NULL = neoznačeno (běžné cena).';
COMMENT ON COLUMN catalog.ticket_types.requires_verification IS
  'TRUE = u vstupu musí kupec ukázat průkaz (ISIC, OP, ZTP, rodný list). Scanner aplikuje warning.';
COMMENT ON COLUMN catalog.ticket_types.verification_hint IS
  'Custom text pro buyer + scanner např. „Ukáž ISIC nebo studijní průkaz na vstupu".';

COMMIT;
