-- Migration 419: Artist public pages — rozšíření lineups.artists pro veřejné stránky
-- lineups.artists existuje (promoter-owned). Přidáme public flag a slug uniqueness.

-- Make artists discoverable publicly (promoter can opt-in)
ALTER TABLE lineups.artists ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT false;

-- Public pages: artist slug is already there. We just need a cross-promoter view.
-- Create a public-facing materialized index for discovery (updated when artist.public=true)

-- Also link artists to events publicly (lineups.event_artists already exists)
-- Add public flag to event_artists
ALTER TABLE lineups.event_artists ADD COLUMN IF NOT EXISTS public boolean NOT NULL DEFAULT true;

-- Public RLS: select when artist.public=true
CREATE POLICY artists_public_select ON lineups.artists
  FOR SELECT USING (
    public = true
    OR promoter_id::text = current_setting('app.current_promoter_id', true)
    OR current_setting('app.is_platform_admin', true) = 'true'
  );
