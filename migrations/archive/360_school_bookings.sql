-- 360_school_bookings.sql
-- Školní skupinové objednávky
-- Tabulka orders.school_bookings pro správu školních/skupinových rezervací s fakturací,
-- kontaktními údaji školy, věkovou skupinou a skupinovým QR tokenem pro odbavení

BEGIN;

CREATE TABLE IF NOT EXISTS orders.school_bookings (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_id              UUID NOT NULL REFERENCES catalog.events(id),
  promoter_id           UUID NOT NULL REFERENCES platform.promoters(id),
  contact_name          TEXT NOT NULL,
  contact_email         TEXT NOT NULL,
  school_name           TEXT NOT NULL,
  school_ico            TEXT,
  school_dic            TEXT,
  billing_address       TEXT,
  student_count         INT NOT NULL CHECK (student_count >= 1),
  teacher_count         INT NOT NULL DEFAULT 0,
  age_group             TEXT CHECK (age_group IN ('ZŠ 1.stupeň','ZŠ 2.stupeň','SŠ','VŠ','jiné')),
  ticket_type_id        UUID REFERENCES catalog.ticket_types(id),
  unit_price_halire     INT NOT NULL CHECK (unit_price_halire >= 0),
  total_price_halire    INT NOT NULL CHECK (total_price_halire >= 0),
  status                TEXT NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','confirmed','paid','cancelled')),
  payment_method        TEXT NOT NULL DEFAULT 'invoice'
                          CHECK (payment_method IN ('invoice','bank_transfer','cash','card_terminal')),
  group_qr_token        TEXT UNIQUE DEFAULT encode(gen_random_bytes(16),'hex'),
  notes                 TEXT,
  order_id              UUID REFERENCES orders.orders(id),
  educational_materials_sent_at TIMESTAMPTZ,
  created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_school_bookings_event ON orders.school_bookings(event_id);
CREATE INDEX IF NOT EXISTS idx_school_bookings_promoter ON orders.school_bookings(promoter_id);

COMMIT;
