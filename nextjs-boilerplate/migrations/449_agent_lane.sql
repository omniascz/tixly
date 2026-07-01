-- 449: Agent Lane — legitimní kanál pro nákupní AI agenty
--
-- Ticketing je vůči agentic commerce nepřátelský (anti-bot blokuje i legitimní
-- agenty; SCA brání agentní autentizaci). Nikdo nemá sankcionovaný „ověřený agent,
-- ne scalper" kanál. Tixly: registrace agenta vázaného na OVĚŘENÉHO ČLOVĚKA +
-- delegovaný mandát (max cena/počet/akce/platnost) + fér-pravidla serverem.
-- Whitelisted agent vázaný na člověka = anti-scalping primitiv.
--
-- Reálné delegované platby (ACP / Mastercard Agent Pay tokeny) = na klíč (externí).

-- Registrovaný nákupní agent (vázaný na člověka-vlastníka).
CREATE TABLE IF NOT EXISTS platform.purchase_agents (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  name           text NOT NULL,
  api_key_hash   text NOT NULL,               -- sha256 API klíče agenta (klíč se ukáže jen jednou)
  status         text NOT NULL DEFAULT 'active',  -- active | revoked
  created_at     timestamptz NOT NULL DEFAULT now(),
  last_used_at   timestamptz
);
CREATE INDEX IF NOT EXISTS idx_purchase_agents_owner ON platform.purchase_agents(owner_user_id);

-- Delegovaný mandát: člověk povolí agentovi konkrétní rozsah nákupu.
CREATE TABLE IF NOT EXISTS platform.agent_mandates (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  agent_id        uuid NOT NULL REFERENCES platform.purchase_agents(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES identity.users(id) ON DELETE CASCADE,
  event_id        uuid REFERENCES catalog.events(id) ON DELETE CASCADE,  -- NULL = jakákoli akce
  max_price_minor bigint NOT NULL,             -- strop ceny na vstupenku
  max_qty         integer NOT NULL DEFAULT 1,  -- max počet vstupenek
  used_qty        integer NOT NULL DEFAULT 0,
  status          text NOT NULL DEFAULT 'active',  -- active | revoked | exhausted
  expires_at      timestamptz NOT NULL,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_agent_mandates_agent ON platform.agent_mandates(agent_id);
CREATE INDEX IF NOT EXISTS idx_agent_mandates_user ON platform.agent_mandates(user_id);
