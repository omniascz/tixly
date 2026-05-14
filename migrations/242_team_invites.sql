-- Team Sub-Accounts — rozšíření role enum o specializované role.
-- Existující tabulka platform.team_invites + platform.promoter_members zůstává.

BEGIN;

-- Box office (pokladní prodej) a accreditation_manager (správa akreditací).
-- 'gate' už existuje pro scanner / vstupní personál.
ALTER TYPE platform.member_role ADD VALUE IF NOT EXISTS 'box_office';
ALTER TYPE platform.member_role ADD VALUE IF NOT EXISTS 'accreditation_manager';

COMMIT;
