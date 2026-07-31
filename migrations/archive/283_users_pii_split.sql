-- 283_users_pii_split.sql
-- P1: PII split na first_name + last_name pro CZ trh.
-- ČNB / AML / ČÚS / ISDOC / DPH doklad vyžadují separate fields.
--
-- Backfill heuristika:
--   - Jednoslovný name → first_name = name, last_name = NULL
--   - Vícesloví → first_name = vše kromě posledního, last_name = poslední slovo
--   - Edge cases (tituly, suffixy) → manual review pomocí Pohoda/účetní

BEGIN;

ALTER TABLE identity.users
  ADD COLUMN IF NOT EXISTS first_name text,
  ADD COLUMN IF NOT EXISTS last_name  text;

UPDATE identity.users
   SET first_name = CASE
         WHEN position(' ' IN name) > 0
         THEN substring(name FROM 1 FOR position(' ' IN reverse(name)) - 1 + (length(name) - position(' ' IN reverse(name))))
         ELSE name
       END,
       last_name = CASE
         WHEN position(' ' IN name) > 0
         THEN reverse(substring(reverse(name) FROM 1 FOR position(' ' IN reverse(name)) - 1))
         ELSE NULL
       END
 WHERE first_name IS NULL;

-- Simpler heuristic that actually compiles cleanly:
UPDATE identity.users
   SET first_name = COALESCE(
         NULLIF(substring(name FROM '^(.*?)\s+\S+$'), ''),
         name
       ),
       last_name = NULLIF(substring(name FROM '\s+(\S+)$'), '');

COMMENT ON COLUMN identity.users.first_name IS 'Jméno (CZ PII split). Backfilled z name heuristikou.';
COMMENT ON COLUMN identity.users.last_name IS 'Příjmení (CZ PII split). NULL pokud single-word name.';

-- Stejně pro newsletter_subscribers (pokud má name)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'marketing' AND table_name = 'newsletter_subscribers' AND column_name = 'name') THEN
    ALTER TABLE marketing.newsletter_subscribers
      ADD COLUMN IF NOT EXISTS first_name text,
      ADD COLUMN IF NOT EXISTS last_name  text;
    UPDATE marketing.newsletter_subscribers
       SET first_name = COALESCE(NULLIF(substring(name FROM '^(.*?)\s+\S+$'), ''), name),
           last_name = NULLIF(substring(name FROM '\s+(\S+)$'), '')
     WHERE name IS NOT NULL AND first_name IS NULL;
  END IF;
END $$;

-- tickets.tickets.holder_name → také
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'tickets' AND table_name = 'tickets' AND column_name = 'holder_name') THEN
    ALTER TABLE tickets.tickets
      ADD COLUMN IF NOT EXISTS holder_first_name text,
      ADD COLUMN IF NOT EXISTS holder_last_name  text;
    UPDATE tickets.tickets
       SET holder_first_name = COALESCE(NULLIF(substring(holder_name FROM '^(.*?)\s+\S+$'), ''), holder_name),
           holder_last_name = NULLIF(substring(holder_name FROM '\s+(\S+)$'), '')
     WHERE holder_name IS NOT NULL AND holder_first_name IS NULL;
  END IF;
END $$;

-- orders.invoices.customer_name → také
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'orders' AND table_name = 'invoices' AND column_name = 'customer_name') THEN
    ALTER TABLE orders.invoices
      ADD COLUMN IF NOT EXISTS customer_first_name text,
      ADD COLUMN IF NOT EXISTS customer_last_name  text;
    UPDATE orders.invoices
       SET customer_first_name = COALESCE(NULLIF(substring(customer_name FROM '^(.*?)\s+\S+$'), ''), customer_name),
           customer_last_name = NULLIF(substring(customer_name FROM '\s+(\S+)$'), '')
     WHERE customer_name IS NOT NULL AND customer_first_name IS NULL;
  END IF;
END $$;

-- subscriptions.holders.holder_name → také
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
              WHERE table_schema = 'subscriptions' AND table_name = 'holders' AND column_name = 'holder_name') THEN
    ALTER TABLE subscriptions.holders
      ADD COLUMN IF NOT EXISTS holder_first_name text,
      ADD COLUMN IF NOT EXISTS holder_last_name  text;
    UPDATE subscriptions.holders
       SET holder_first_name = COALESCE(NULLIF(substring(holder_name FROM '^(.*?)\s+\S+$'), ''), holder_name),
           holder_last_name = NULLIF(substring(holder_name FROM '\s+(\S+)$'), '')
     WHERE holder_first_name IS NULL;
  END IF;
END $$;

COMMIT;
