-- Migration 030: Sport season ticket holders + multi-game packages

-- Season ticket holders — permanentka na celou sezónu
CREATE TABLE sport.season_ticket_holders (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id       UUID NOT NULL,
  league_id         UUID NOT NULL,        -- FK → sport.leagues.id (logický, bez FK constraint)
  user_id           UUID NOT NULL,        -- FK → identity.users
  seat_id           VARCHAR(50),          -- konkrétní sedadlo (ze seat_map), NULL = general
  zone              VARCHAR(50),          -- zóna (Tribune A, Tribune B, VIP, ...)
  season_label      VARCHAR(20) NOT NULL, -- "2026/27"
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'suspended', 'cancelled', 'expired')),
  renewal_preference TEXT NOT NULL DEFAULT 'auto'
                    CHECK (renewal_preference IN ('auto', 'manual', 'cancel')),
  priority_level    INT NOT NULL DEFAULT 1,  -- 1=standard, 2=premium, 3=founding member
  payment_method_id TEXT,                -- GoPay ON_DEMAND token
  price_hellers     INT NOT NULL,         -- roční cena v halířích
  valid_from        DATE NOT NULL,
  valid_until       DATE NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_sport_season_holder_seat UNIQUE (league_id, seat_id, season_label)
    DEFERRABLE INITIALLY DEFERRED
);

CREATE INDEX idx_sport_season_holders_league  ON sport.season_ticket_holders (league_id, season_label);
CREATE INDEX idx_sport_season_holders_user    ON sport.season_ticket_holders (user_id);
CREATE INDEX idx_sport_season_holders_status  ON sport.season_ticket_holders (status, valid_until);

-- Multi-game packages — výběr X zápasů z Y
CREATE TABLE sport.multi_game_packages (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id       UUID NOT NULL,
  league_id         UUID NOT NULL,
  name              TEXT NOT NULL,        -- "10-game flex pack", "Weekend package"
  season_label      VARCHAR(20) NOT NULL,
  games_total       INT NOT NULL CHECK (games_total > 0),   -- celkový počet her v lize
  games_included    INT NOT NULL CHECK (games_included > 0), -- kolik her v balíčku
  zone              VARCHAR(50),
  price_hellers     INT NOT NULL CHECK (price_hellers > 0),
  sale_start        TIMESTAMPTZ,
  sale_end          TIMESTAMPTZ,
  status            TEXT NOT NULL DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'sold_out')),
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (games_included <= games_total)
);

CREATE INDEX idx_sport_packages_league ON sport.multi_game_packages (league_id, status);

-- Konkrétní výběr her zákazníkem
CREATE TABLE sport.package_game_selections (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  package_id  UUID NOT NULL,             -- FK → sport.multi_game_packages
  user_id     UUID NOT NULL,
  event_id    UUID NOT NULL,             -- FK → catalog.events (sport event)
  order_id    UUID,                      -- FK → orders.orders (po zaplacení)
  status      TEXT NOT NULL DEFAULT 'selected'
              CHECK (status IN ('selected', 'confirmed', 'cancelled')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_package_game_selection UNIQUE (package_id, user_id, event_id)
);

CREATE INDEX idx_sport_package_selections_user ON sport.package_game_selections (user_id, package_id);

-- Priority seating windows — season ticket holders nakupují dříve
CREATE TABLE sport.priority_windows (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  league_id       UUID NOT NULL,
  event_id        UUID NOT NULL,
  priority_level  INT NOT NULL,          -- 1, 2, 3 (odpovídá season_ticket_holders.priority_level)
  window_start    TIMESTAMPTZ NOT NULL,
  window_end      TIMESTAMPTZ NOT NULL,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_priority_window UNIQUE (event_id, priority_level)
);

CREATE INDEX idx_sport_priority_windows_event ON sport.priority_windows (event_id, window_start);
