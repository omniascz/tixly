-- Migration 100: Corporate benefits SaaS vertical
CREATE SCHEMA IF NOT EXISTS benefits;

CREATE TABLE benefits.employers (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name           VARCHAR(200) NOT NULL,
  ico            VARCHAR(20) NOT NULL UNIQUE,
  billing_email  VARCHAR(200) NOT NULL,
  plan           VARCHAR(20) NOT NULL CHECK (plan IN ('starter','growth','enterprise')),
  contact_phone  VARCHAR(30),
  is_active      BOOLEAN NOT NULL DEFAULT TRUE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE benefits.employees (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id UUID NOT NULL REFERENCES benefits.employers(id),
  email       VARCHAR(200) NOT NULL,
  name        VARCHAR(200) NOT NULL,
  external_id VARCHAR(100),
  department  VARCHAR(100),
  is_active   BOOLEAN NOT NULL DEFAULT TRUE,
  joined_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at     TIMESTAMPTZ,
  UNIQUE(employer_id, email)
);

CREATE TABLE benefits.programs (
  id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employer_id             UUID NOT NULL REFERENCES benefits.employers(id),
  name                    VARCHAR(200) NOT NULL,
  monthly_credit_hellers  INTEGER NOT NULL CHECK (monthly_credit_hellers >= 0),
  allowed_categories      TEXT[] NOT NULL,
  rollover_months         INTEGER NOT NULL DEFAULT 0 CHECK (rollover_months >= 0),
  is_active               BOOLEAN NOT NULL DEFAULT TRUE,
  created_at              TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE benefits.allocations (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  program_id        UUID NOT NULL REFERENCES benefits.programs(id),
  employee_id       UUID NOT NULL REFERENCES benefits.employees(id),
  month             VARCHAR(7) NOT NULL,  -- YYYY-MM
  allocated_hellers INTEGER NOT NULL CHECK (allocated_hellers >= 0),
  expires_at        TIMESTAMPTZ NOT NULL,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(program_id, employee_id, month)
);

CREATE TABLE benefits.transactions (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  employee_id    UUID NOT NULL REFERENCES benefits.employees(id),
  allocation_id  UUID REFERENCES benefits.allocations(id),
  type           VARCHAR(20) NOT NULL CHECK (type IN ('credit','debit','refund','expiration')),
  category       VARCHAR(20),
  amount_hellers INTEGER NOT NULL,
  description    TEXT NOT NULL,
  merchant_id    UUID,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX ON benefits.employees (employer_id, is_active);
CREATE INDEX ON benefits.allocations (employee_id, expires_at);
CREATE INDEX ON benefits.allocations (program_id, month);
CREATE INDEX ON benefits.transactions (employee_id, created_at DESC);
CREATE INDEX ON benefits.transactions (allocation_id, type);
