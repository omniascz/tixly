-- Migration 226: Apple Wallet device registrations and pass update log
-- Part of B12 — Apple Wallet real DB + APN push adapters

-- ---------------------------------------------------------------------------
-- Apple Wallet device registrations
-- Stores the mapping between a device push token and a registered pass.
-- Apple Wallet calls POST /v1/devices/{device}/registrations/{passType}/{serial}
-- to create/update this record and DELETE to remove it.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wallet_device_registrations (
  id                       UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  device_library_identifier TEXT       NOT NULL,
  pass_type_identifier      TEXT       NOT NULL,
  serial_number             TEXT       NOT NULL,
  push_token                TEXT       NOT NULL,
  registered_at             TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (device_library_identifier, pass_type_identifier, serial_number)
);

-- Index used by getRegistrations(serialNumber) — fetch all devices for a pass
CREATE INDEX IF NOT EXISTS idx_wallet_reg_serial
  ON wallet_device_registrations (serial_number);

-- Index used by getDevicesForPass — push fan-out
CREATE INDEX IF NOT EXISTS idx_wallet_reg_pass
  ON wallet_device_registrations (pass_type_identifier, serial_number);

-- Index used by getRegisteredPasses / getUpdatedSerials — device query
CREATE INDEX IF NOT EXISTS idx_wallet_reg_device
  ON wallet_device_registrations (device_library_identifier, pass_type_identifier);

-- ---------------------------------------------------------------------------
-- Pass update log
-- Immutable log of every time a pass changes, used by the
-- GET /v1/devices/{device}/registrations/{passType}?passesUpdatedSince=...
-- endpoint to return only the serial numbers that changed after a given time.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wallet_pass_updates (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  pass_type_identifier TEXT        NOT NULL,
  serial_number        TEXT        NOT NULL,
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index used by getUpdatedSerials / getRegisteredPasses with updatedSince filter
CREATE INDEX IF NOT EXISTS idx_wallet_updates_pass
  ON wallet_pass_updates (pass_type_identifier, updated_at DESC);

-- Index for joining with registrations on serial_number
CREATE INDEX IF NOT EXISTS idx_wallet_updates_serial
  ON wallet_pass_updates (serial_number);

-- ---------------------------------------------------------------------------
-- Pass data store
-- Holds the auth token and metadata for each issued pass.
-- Used by getAuthToken() to validate Apple Wallet requests and by
-- getPassData() / updatePassData() for pass content management.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wallet_passes_data (
  id                   UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  serial_number        TEXT        NOT NULL,
  pass_type_identifier TEXT        NOT NULL,
  auth_token           TEXT        NOT NULL,
  last_updated         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  data                 JSONB       NOT NULL DEFAULT '{}',
  UNIQUE (pass_type_identifier, serial_number)
);

CREATE INDEX IF NOT EXISTS idx_wallet_passes_data_serial
  ON wallet_passes_data (serial_number);
