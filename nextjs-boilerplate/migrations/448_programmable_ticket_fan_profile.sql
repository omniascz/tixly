-- 448: Programovatelný lístek + přenosný fanouškovský profil (bez kryptoměn)
--
-- 1) Fan-owned profil napříč pořadateli: fanoušek ovládá svá data, jedeme přes
--    mnoho CZ pořadatelů → cross-event graf je unfair advantage vs single-venue.
-- 2) Programmable rights na typu vstupenky: podmíněné upgrady, časované kredity,
--    auto-přeprodej za nominál při no-show. Na plain DB + Wallet, ne NFT.

-- Fan-owned profil (fanoušek vlastní a ovládá).
CREATE TABLE IF NOT EXISTS identity.fan_profiles (
  user_id            uuid PRIMARY KEY REFERENCES identity.users(id) ON DELETE CASCADE,
  display_name       text,
  favorite_genres    jsonb NOT NULL DEFAULT '[]'::jsonb,    -- ["rock","divadlo",...]
  accessibility_prefs jsonb NOT NULL DEFAULT '{}'::jsonb,    -- {stepFree:true, captions:true, ...}
  marketing_consent  jsonb NOT NULL DEFAULT '{}'::jsonb,     -- {email:false, sms:false, profiling:false}
  portable           boolean NOT NULL DEFAULT true,          -- fanoušek povolil sdílení napříč pořadateli
  updated_at         timestamptz NOT NULL DEFAULT now()
);

-- Programmable rights na typu vstupenky (rights-engine je vyhodnotí).
-- Tvar např: {"timeBoxedCredit":{"amountMinor":10000,"currency":"CZK","fromScan":true,"validMinutes":120},
--             "autoResaleIfUnscanned":true, "conditionalUpgrade":{"toTicketTypeId":"...","ifCapacityBelowPct":60}}
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS programmable_rights jsonb;

COMMENT ON COLUMN catalog.ticket_types.programmable_rights IS
  'Programmable rights lístku (časované kredity, auto-resale, podmíněné upgrady). NULL = žádné.';
