CREATE SCHEMA IF NOT EXISTS newsletter;

CREATE TABLE newsletter.subscribers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  promoter_id UUID NOT NULL,
  email TEXT NOT NULL,
  first_name TEXT,
  status TEXT NOT NULL DEFAULT 'pending',
  tags TEXT[] DEFAULT '{}',
  source TEXT,
  confirmed_at TIMESTAMPTZ,
  unsubscribed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE (promoter_id, email)
);
CREATE INDEX idx_newsletter_subscribers_status ON newsletter.subscribers(promoter_id, status);
CREATE INDEX idx_newsletter_subscribers_tags ON newsletter.subscribers USING GIN(tags);

CREATE TABLE newsletter.tokens (
  token TEXT PRIMARY KEY,
  subscriber_id UUID NOT NULL REFERENCES newsletter.subscribers(id) ON DELETE CASCADE,
  type TEXT NOT NULL,  -- 'confirm' | 'unsubscribe'
  expires_at TIMESTAMPTZ NOT NULL,
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX idx_newsletter_tokens_subscriber ON newsletter.tokens(subscriber_id);
