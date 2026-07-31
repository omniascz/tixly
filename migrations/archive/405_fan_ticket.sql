-- Migration 405: Tixly Fan Ticket — prémiová sběratelská digitální vstupenka
-- Analogie k Eventim FanTicket, ale 100 % digitální.
-- Promotér nahraje artwork (event poster / fotka) → PDF vstupenka vypadá jako plakát.

ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS fan_ticket_enabled  boolean NOT NULL DEFAULT false;
ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS fan_artwork_url      text;
