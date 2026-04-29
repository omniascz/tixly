-- Migration: 002_wallet_passes
-- Adds wallet pass storage for Apple Wallet (PKPass) and Google Wallet passes.
-- Depends on: 001_initial (tickets.tickets table must exist).

BEGIN;

-- ---------------------------------------------------------------------------
-- Enum: wallet platform
-- ---------------------------------------------------------------------------

CREATE TYPE wallet_platform AS ENUM ('apple', 'google');

-- ---------------------------------------------------------------------------
-- Table: wallet_passes
--
-- One row per (ticket, platform) combination.
-- A ticket can have both an Apple pass and a Google pass simultaneously.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS wallet_passes (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    ticket_id            uuid         NOT NULL
                                      REFERENCES tickets.tickets (id)
                                      ON DELETE CASCADE,
    platform             wallet_platform NOT NULL,

    -- Apple: "pass.cz.tixly.ticket"
    -- Google: empty string (auth uses service account JWT, not per-pass token)
    pass_type_identifier text         NOT NULL DEFAULT '',

    -- Apple: "ticket-{ticketId}" (unique across Apple passes)
    -- Google: "{issuerId}.{ticketId}"
    serial_number        text         NOT NULL,

    -- Apple only: random 20-byte hex token verified on every webservice request
    -- Google: empty string
    authentication_token text         NOT NULL DEFAULT '',

    -- Google only: "{issuerId}.{ticketId}" — identifies the EventTicketObject
    -- Apple: NULL
    google_object_id     text,

    -- Signed download URL for the .pkpass file (Apple) or pass landing page
    pass_url             text,

    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),

    -- One pass per (ticket, platform)
    CONSTRAINT wallet_passes_ticket_platform_unique UNIQUE (ticket_id, platform),
    -- serial_number is looked up on every Apple webservice request
    CONSTRAINT wallet_passes_serial_unique UNIQUE (serial_number)
);

-- Apple Wallet's "which serials changed since T?" query hits this index hard
CREATE INDEX IF NOT EXISTS wallet_passes_updated_at_idx
    ON wallet_passes (updated_at);

-- ---------------------------------------------------------------------------
-- Table: apple_pass_registrations
--
-- Tracks which Apple devices (identified by deviceLibraryIdentifier) have
-- registered to receive push updates for which passes (identified by
-- serial_number).  A single device can register multiple passes; a single
-- pass can be registered on multiple devices.
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS apple_pass_registrations (
    id                        uuid   PRIMARY KEY DEFAULT gen_random_uuid(),

    -- Apple-generated opaque device identifier
    device_library_identifier text   NOT NULL,

    -- APNs push token for this device (changes when app is reinstalled)
    push_token                text   NOT NULL,

    -- Must match wallet_passes.pass_type_identifier
    pass_type_identifier      text   NOT NULL,

    -- Must match wallet_passes.serial_number
    serial_number             text   NOT NULL
                                     REFERENCES wallet_passes (serial_number)
                                     ON DELETE CASCADE,

    registered_at             timestamptz NOT NULL DEFAULT now(),

    -- Each device registers each pass at most once
    CONSTRAINT apple_reg_device_serial_unique
        UNIQUE (device_library_identifier, serial_number)
);

-- APN push sends: look up all devices registered for a serial
CREATE INDEX IF NOT EXISTS apple_reg_serial_idx
    ON apple_pass_registrations (serial_number);

-- Registration list query: look up all serials for a device
CREATE INDEX IF NOT EXISTS apple_reg_device_idx
    ON apple_pass_registrations (device_library_identifier);

-- ---------------------------------------------------------------------------
-- Trigger: keep wallet_passes.updated_at current
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION wallet_passes_set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS wallet_passes_updated_at_trigger ON wallet_passes;
CREATE TRIGGER wallet_passes_updated_at_trigger
    BEFORE UPDATE ON wallet_passes
    FOR EACH ROW
    EXECUTE FUNCTION wallet_passes_set_updated_at();

COMMIT;
