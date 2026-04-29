-- =============================================================================
-- Tixly — Owner Account Seed
--
-- Run once on a fresh database after applying all migrations (001-090).
-- Creates the owner's user, promoter organization, fee schedule, payout settings,
-- and marks onboarding as complete for single-tenant launch.
--
-- BEFORE RUNNING:
--   1. Change email, name, phone, IČO, DIČ, IBAN, SWIFT, website
--   2. Generate password hash:
--      node scripts/generate-password-hash.js "YOUR_PASSWORD"
--   3. Run:
--      psql $DATABASE_URL < scripts/seed-owner.sql
--
-- All INSERT statements use ON CONFLICT so the script is safe to re-run.
-- =============================================================================

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Create the owner user in identity.users
-- ---------------------------------------------------------------------------
INSERT INTO identity.users (
  id,
  email,
  name,
  password_hash,
  email_verified_at,
  phone_verified_at,
  gdpr_consent_at,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-4000-a000-000000000001'::UUID,
  'admin@tixly.cz',           -- CHANGE THIS to your email
  'Admin Tixly',              -- CHANGE THIS to your name
  '$2b$12$717vz6ZuAMviXtxs1m7k.u0BfzuVlEaD9Q/AHxwtmRawpL3HFvB0K',             -- CHANGE: generate with: node scripts/generate-password-hash.js "yourpassword"
  NOW(),
  NOW(),
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  email = EXCLUDED.email,
  name = EXCLUDED.name,
  password_hash = EXCLUDED.password_hash,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 2. Create the promoter (owner organization) in platform.promoters
-- ---------------------------------------------------------------------------
INSERT INTO platform.promoters (
  id,
  name,
  legal_name,
  ico,
  dic,
  email,
  phone,
  website,
  status,
  kyc_status,
  kyc_verified_at,
  bank_account_iban,
  bank_account_swift,
  default_currency,
  timezone,
  created_at,
  updated_at
)
VALUES (
  '00000000-0000-4000-a000-000000000010'::UUID,
  'Tixly Events',             -- CHANGE THIS to your org name
  'Tixly s.r.o.',             -- CHANGE THIS to your legal name
  '12345678',                       -- CHANGE THIS to your IČO (8 digits)
  'CZ12345678',                     -- CHANGE THIS to your DIČ (or NULL)
  'admin@tixly.cz',           -- CHANGE THIS to your org email
  '+420600000000',                  -- CHANGE THIS to your phone
  'https://tixly.cz',         -- CHANGE THIS to your website
  'active',                         -- Skip KYC — owner is auto-verified
  'verified',
  NOW(),
  'CZ0000000000000000000000',       -- CHANGE THIS to your IBAN
  'FIOBCZPP',                       -- CHANGE THIS to your SWIFT/BIC
  'CZK',
  'Europe/Prague',
  NOW(),
  NOW()
)
ON CONFLICT (id) DO UPDATE SET
  name = EXCLUDED.name,
  legal_name = EXCLUDED.legal_name,
  ico = EXCLUDED.ico,
  dic = EXCLUDED.dic,
  email = EXCLUDED.email,
  phone = EXCLUDED.phone,
  website = EXCLUDED.website,
  status = EXCLUDED.status,
  kyc_status = EXCLUDED.kyc_status,
  kyc_verified_at = EXCLUDED.kyc_verified_at,
  bank_account_iban = EXCLUDED.bank_account_iban,
  bank_account_swift = EXCLUDED.bank_account_swift,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 3. Link user to promoter as owner in platform.promoter_members
-- ---------------------------------------------------------------------------
INSERT INTO platform.promoter_members (
  promoter_id,
  user_id,
  role,
  status,
  invited_at,
  activated_at,
  created_at
)
VALUES (
  '00000000-0000-4000-a000-000000000010'::UUID,
  '00000000-0000-4000-a000-000000000001'::UUID,
  'owner'::platform.member_role,
  'active'::platform.member_status,
  NOW(),
  NOW(),
  NOW()
)
ON CONFLICT (promoter_id, user_id) DO UPDATE SET
  role = EXCLUDED.role,
  status = EXCLUDED.status,
  activated_at = NOW(),
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 4. Create default fee schedule in platform.fee_schedules
-- Owner pays 0% fee to themselves
-- ---------------------------------------------------------------------------
INSERT INTO platform.fee_schedules (
  id,
  promoter_id,
  name,
  percentage_fee,
  fixed_fee,
  min_fee,
  max_fee,
  valid_from,
  is_active,
  created_at
)
VALUES (
  '00000000-0000-4000-a000-000000000020'::UUID,
  '00000000-0000-4000-a000-000000000010'::UUID,
  'Owner — 0% fee',
  0,            -- 0% percentage
  0,            -- 0 Kč fixed
  NULL,
  NULL,
  NOW(),
  TRUE,
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- ---------------------------------------------------------------------------
-- 5. Create payout settings in platform.payout_settings
-- Owner manages own payouts manually with no rolling reserve
-- ---------------------------------------------------------------------------
INSERT INTO platform.payout_settings (
  promoter_id,
  payout_cycle,
  rolling_reserve_pct,
  reserve_release_days,
  min_payout_amount,
  updated_at
)
VALUES (
  '00000000-0000-4000-a000-000000000010'::UUID,
  'manual',     -- Owner manages own payouts
  0,            -- No rolling reserve for owner
  30,
  0,            -- No minimum payout amount
  NOW()
)
ON CONFLICT (promoter_id) DO UPDATE SET
  payout_cycle = EXCLUDED.payout_cycle,
  rolling_reserve_pct = EXCLUDED.rolling_reserve_pct,
  reserve_release_days = EXCLUDED.reserve_release_days,
  min_payout_amount = EXCLUDED.min_payout_amount,
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- 6. Mark onboarding as complete in platform.onboarding_progress
-- All steps marked TRUE since owner is auto-verified
-- ---------------------------------------------------------------------------
INSERT INTO platform.onboarding_progress (
  promoter_id,
  step_account,
  step_profile,
  step_kyc,
  step_activated,
  completed_at,
  updated_at
)
VALUES (
  '00000000-0000-4000-a000-000000000010'::UUID,
  TRUE,
  TRUE,
  TRUE,
  TRUE,
  NOW(),
  NOW()
)
ON CONFLICT (promoter_id) DO UPDATE SET
  step_account = TRUE,
  step_profile = TRUE,
  step_kyc = TRUE,
  step_activated = TRUE,
  completed_at = NOW(),
  updated_at = NOW();

-- ---------------------------------------------------------------------------
-- Verification
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  user_count INTEGER;
  promoter_count INTEGER;
  member_count INTEGER;
  fee_count INTEGER;
  payout_settings_count INTEGER;
  onboarding_count INTEGER;
BEGIN
  SELECT COUNT(*) INTO user_count
  FROM identity.users
  WHERE id = '00000000-0000-4000-a000-000000000001'::UUID;

  SELECT COUNT(*) INTO promoter_count
  FROM platform.promoters
  WHERE id = '00000000-0000-4000-a000-000000000010'::UUID;

  SELECT COUNT(*) INTO member_count
  FROM platform.promoter_members
  WHERE promoter_id = '00000000-0000-4000-a000-000000000010'::UUID
    AND user_id = '00000000-0000-4000-a000-000000000001'::UUID;

  SELECT COUNT(*) INTO fee_count
  FROM platform.fee_schedules
  WHERE promoter_id = '00000000-0000-4000-a000-000000000010'::UUID
    AND is_active = TRUE;

  SELECT COUNT(*) INTO payout_settings_count
  FROM platform.payout_settings
  WHERE promoter_id = '00000000-0000-4000-a000-000000000010'::UUID;

  SELECT COUNT(*) INTO onboarding_count
  FROM platform.onboarding_progress
  WHERE promoter_id = '00000000-0000-4000-a000-000000000010'::UUID
    AND step_activated = TRUE;

  RAISE NOTICE 'Owner account seed verification:';
  RAISE NOTICE '  ✓ User created: %', CASE WHEN user_count = 1 THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE '  ✓ Promoter created: %', CASE WHEN promoter_count = 1 THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE '  ✓ Member linked: %', CASE WHEN member_count = 1 THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE '  ✓ Fee schedule active: %', CASE WHEN fee_count = 1 THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE '  ✓ Payout settings created: %', CASE WHEN payout_settings_count = 1 THEN 'YES' ELSE 'NO' END;
  RAISE NOTICE '  ✓ Onboarding completed: %', CASE WHEN onboarding_count = 1 THEN 'YES' ELSE 'NO' END;

  IF user_count = 1 AND promoter_count = 1 AND member_count = 1
     AND fee_count = 1 AND payout_settings_count = 1 AND onboarding_count = 1
  THEN
    RAISE NOTICE 'All checks passed!';
  ELSE
    RAISE WARNING 'Some checks failed. Please review the seed data.';
  END IF;
END;
$$;

COMMIT;
