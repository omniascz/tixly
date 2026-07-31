-- =============================================================================
-- Migration 167: Fan Social Graph
-- Feature #188: Sociální vrstva pro kupující — friend graph, activity feed,
--              sociální discovery („Petr a 3 přátelé plánují jít na X").
--              Naše #65 (artist-follows) řeší fanoušek→entita; tato vrstva
--              řeší fanoušek↔fanoušek.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS social_graph;

-- Veřejný / přátelský / soukromý profil. Pokud řádek neexistuje, použij default.
CREATE TABLE IF NOT EXISTS social_graph.user_profiles (
  user_id              UUID PRIMARY KEY,
  display_name         TEXT NOT NULL,
  avatar_url           TEXT,
  profile_visibility   TEXT NOT NULL DEFAULT 'public'
                         CHECK (profile_visibility IN ('public', 'friends', 'private')),
  activity_visibility  TEXT NOT NULL DEFAULT 'friends'
                         CHECK (activity_visibility IN ('public', 'friends', 'private')),
  allow_friend_requests BOOLEAN NOT NULL DEFAULT true,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Žádost o přátelství. Status pending → accepted vytvoří řádek ve friendships.
CREATE TABLE IF NOT EXISTS social_graph.friend_requests (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  from_user_id         UUID NOT NULL,
  to_user_id           UUID NOT NULL,
  status               TEXT NOT NULL DEFAULT 'pending'
                         CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  message              TEXT,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  responded_at         TIMESTAMPTZ,
  CHECK (from_user_id <> to_user_id)
);

-- Pouze jedna pending request mezi dvěma uživateli ve stejném směru.
CREATE UNIQUE INDEX idx_friend_requests_unique_pending
  ON social_graph.friend_requests(from_user_id, to_user_id)
  WHERE status = 'pending';

CREATE INDEX idx_friend_requests_to_pending
  ON social_graph.friend_requests(to_user_id) WHERE status = 'pending';

-- Vzájemné přátelství. Kanonické pořadí (user_a < user_b) zaručuje unikátnost.
CREATE TABLE IF NOT EXISTS social_graph.friendships (
  user_a               UUID NOT NULL,
  user_b               UUID NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_a, user_b),
  CHECK (user_a < user_b)
);

CREATE INDEX idx_friendships_user_b ON social_graph.friendships(user_b);

-- Bloky: user_id zablokoval blocked_user_id. Asymetrické.
-- Blok ruší existující přátelství i pending requesty (řešeno v service).
CREATE TABLE IF NOT EXISTS social_graph.blocks (
  user_id              UUID NOT NULL,
  blocked_user_id      UUID NOT NULL,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (user_id, blocked_user_id),
  CHECK (user_id <> blocked_user_id)
);

CREATE INDEX idx_blocks_blocked ON social_graph.blocks(blocked_user_id);

-- Activity feed: záznam každé akce uživatele, která se může objevit přátelům.
-- visibility = override profile.activity_visibility pro tento jeden záznam.
CREATE TABLE IF NOT EXISTS social_graph.activities (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id              UUID NOT NULL,
  activity_type        TEXT NOT NULL
                         CHECK (activity_type IN (
                           'planning_to_attend',
                           'attending',
                           'attended',
                           'reviewed',
                           'shared'
                         )),
  event_id             UUID NOT NULL,
  event_title          TEXT NOT NULL,            -- denormalizováno pro feed display
  event_starts_at      TIMESTAMPTZ NOT NULL,     -- denormalizováno pro discovery filter
  visibility           TEXT NOT NULL DEFAULT 'friends'
                         CHECK (visibility IN ('public', 'friends', 'private')),
  metadata             JSONB,                    -- např. rating, comment_id, share_url
  created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Jedinečný plán/účast jednoho usera na jedné akci v daném typu (idempotence).
CREATE UNIQUE INDEX idx_activities_unique_user_event_type
  ON social_graph.activities(user_id, event_id, activity_type);

CREATE INDEX idx_activities_user_created ON social_graph.activities(user_id, created_at DESC);
CREATE INDEX idx_activities_event ON social_graph.activities(event_id);
CREATE INDEX idx_activities_starts_at ON social_graph.activities(event_starts_at);

-- Marker pro „nepřečtené" položky ve feed
CREATE TABLE IF NOT EXISTS social_graph.feed_views (
  user_id              UUID PRIMARY KEY,
  last_viewed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
