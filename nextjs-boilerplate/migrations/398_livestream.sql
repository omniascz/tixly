-- Migration 398: Livestream / online event support
--
-- Přidává streamovací metadata na catalog.events a volitelné
-- stream_access na catalog.ticket_types.
--
-- streaming_url     — URL přehrávače (YouTube embed, Vimeo embed, nebo přímý RTMP/HLS)
-- streaming_provider— 'youtube' | 'vimeo' | 'zoom' | 'custom'
-- stream_chat_url   — volitelný odkaz na live chat / Q&A (Slido, YouTube chat…)
-- stream_recording_url — URL záznamu (vyplní promotér po skončení streamu)
-- stream_replay_days— počet dní od date_end, kdy je záznam přístupný (0 = žádný replay)

ALTER TABLE catalog.events
  ADD COLUMN IF NOT EXISTS streaming_url          TEXT,
  ADD COLUMN IF NOT EXISTS streaming_provider     TEXT CHECK (streaming_provider IN ('youtube','vimeo','zoom','custom')),
  ADD COLUMN IF NOT EXISTS stream_chat_url        TEXT,
  ADD COLUMN IF NOT EXISTS stream_recording_url   TEXT,
  ADD COLUMN IF NOT EXISTS stream_replay_days     INTEGER NOT NULL DEFAULT 0;

-- ticket_types.stream_access: co konkrétní typ vstupenky zahrnuje
--   'live'           = přístup ke streamu pouze za živého vysílání
--   'live_and_replay'= live + replay po dobu stream_replay_days
--   'none'           = tato vstupenka stream neobsahuje (fyzická vstupenka na hybridní akci)
ALTER TABLE catalog.ticket_types
  ADD COLUMN IF NOT EXISTS stream_access TEXT NOT NULL DEFAULT 'live'
    CHECK (stream_access IN ('live', 'live_and_replay', 'none'));

-- Index pro rychlé nalezení aktivních streamů (cron / event-page)
CREATE INDEX IF NOT EXISTS events_streaming_idx
  ON catalog.events (date_start, streaming_url)
  WHERE streaming_url IS NOT NULL;
