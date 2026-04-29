import { verifyDomain } from '../services/domain.service';
import type { DomainDeps } from '../services/domain.service';

// Cron job: spouštěj každých 15 minut
// Kontroluje pending domény a pokouší se verifikovat DNS

export async function runDomainVerificationJob(deps: DomainDeps): Promise<void> {
  const pendingDomains = await deps.db.query<Record<string, unknown>>(
    `SELECT id, promoter_id, domain, verification_token, verification_attempts
     FROM platform.custom_domains
     WHERE status = 'pending'
       AND verified_at IS NULL
       AND verification_attempts < 96
       AND (last_verification_attempt IS NULL
            OR last_verification_attempt < NOW() - INTERVAL '15 minutes')
     LIMIT 50`,
  );

  for (const row of pendingDomains) {
    try {
      await verifyDomain(row['id'] as string, row['promoter_id'] as string, deps);
    } catch {
      // Log and continue — jeden failed attempt nesmí zastavit ostatní
    }
  }

  // Expiruj staré pokusy (> 48h)
  await deps.db.execute(
    `UPDATE platform.custom_domains
     SET status = 'expired', updated_at = NOW()
     WHERE status = 'pending'
       AND verified_at IS NULL
       AND created_at < NOW() - INTERVAL '48 hours'`,
  );
}
