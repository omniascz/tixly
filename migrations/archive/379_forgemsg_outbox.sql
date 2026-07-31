-- ForgeMsg integration — transactional outbox + per-promoter credentials.
--
-- Tixly emits ticketing domain events into forgemsg_outbox (cheap, in the same
-- tx as the business write). A dispatcher cron POSTs pending rows to ForgeMsg's
-- /api/v1/ticketing/events/batch and marks them sent/failed with retry — so a
-- ForgeMsg outage never blocks or loses an event.
--
-- Each promoter (theater) maps to its own ForgeMsg org via forgemsg_credentials;
-- events without a per-promoter key fall back to the platform default (env).

BEGIN;

CREATE TABLE IF NOT EXISTS public.forgemsg_outbox (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  promoter_id uuid,                                   -- target ForgeMsg org (null = platform default)
  event_type  text NOT NULL,                          -- order_paid | cart_abandoned | event_upsert | …
  payload     jsonb NOT NULL,                          -- ForgeMsg ticketing event body
  status      text NOT NULL DEFAULT 'pending',         -- pending | sent | failed
  attempts    int  NOT NULL DEFAULT 0,
  last_error  text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  sent_at     timestamptz
);

-- Dispatcher reads pending oldest-first; partial index keeps it cheap.
CREATE INDEX IF NOT EXISTS forgemsg_outbox_pending_idx
  ON public.forgemsg_outbox (created_at)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS forgemsg_outbox_promoter_idx
  ON public.forgemsg_outbox (promoter_id, status);

CREATE TABLE IF NOT EXISTS public.forgemsg_credentials (
  promoter_id uuid PRIMARY KEY,
  api_key     text NOT NULL,
  api_url     text,                                    -- override base URL (null = env default)
  enabled     boolean NOT NULL DEFAULT true,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

COMMIT;
