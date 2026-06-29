ALTER TABLE catalog.events ADD COLUMN IF NOT EXISTS max_tickets_per_buyer int;
ALTER TABLE catalog.ticket_types ADD COLUMN IF NOT EXISTS max_per_buyer int;
