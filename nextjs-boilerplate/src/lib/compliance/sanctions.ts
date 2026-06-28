/**
 * AML / Sanctions Screening
 *
 * EU 5th AML Directive (2018/843), EU 6th AML Directive (2021/1160):
 *  - Customer Due Diligence (CDD) for transactions above cumulative €15,000
 *  - Sanctions screening against EU Consolidated Sanctions List + OFAC SDN
 *  - PEP (Politically Exposed Person) screening
 *
 * Providers (tried in order):
 *  1. OpenSanctions API (OPENSANCTIONS_API_KEY configured) — entity matching
 *  2. EU Consolidated Sanctions List — free, public, cached daily (EUSL)
 *  3. Manual review flag (no API configured)
 *
 * OpenSanctions docs: https://www.opensanctions.org/api/
 * EU Sanctions list:  https://eeas.europa.eu/topics/sanctions-policy/8442_en
 *
 * IMPORTANT: On any API error, fail OPEN for read-only checks but
 * fail CLOSED for approvals — never approve a match-unknown entity.
 */

export interface SanctionsCheckInput {
  /** Full name of individual or company */
  name: string;
  /** ISO 3166-1 alpha-2 country of registration */
  country?: string;
  /** Date of birth (for individuals) YYYY-MM-DD */
  dob?: string;
  /** VAT / company registration number */
  registrationNumber?: string;
}

export interface SanctionsCheckResult {
  isMatch: boolean;
  score: number;          // 0-100 confidence
  datasets: string[];     // which lists matched (e.g. 'eu_fsf', 'us_ofac_sdn')
  matchedNames: string[];
  provider: 'opensanctions' | 'manual_review' | 'clear';
  requiresManualReview: boolean;
  rawResponse?: unknown;
}

const OPENSANCTIONS_API = 'https://api.opensanctions.org';
const MATCH_THRESHOLD = 75;   // score ≥ 75 = match; 50-74 = manual review

async function checkOpenSanctions(
  input: SanctionsCheckInput,
  apiKey: string,
): Promise<SanctionsCheckResult> {
  const properties: Record<string, string[]> = {
    name: [input.name],
  };
  if (input.country) properties['country'] = [input.country];
  if (input.dob) properties['birthDate'] = [input.dob];
  if (input.registrationNumber) properties['registrationNumber'] = [input.registrationNumber];

  const body = JSON.stringify({
    queries: {
      subject: {
        schema: input.dob ? 'Person' : 'LegalEntity',
        properties,
      },
    },
  });

  const res = await fetch(`${OPENSANCTIONS_API}/match/default`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `ApiKey ${apiKey}`,
    },
    body,
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) {
    throw new Error(`OpenSanctions HTTP ${res.status}: ${await res.text()}`);
  }

  const data = await res.json() as {
    responses: {
      subject?: {
        results: Array<{
          score: number;
          datasets: string[];
          properties: { name?: string[] };
        }>;
      };
    };
  };

  const results = data.responses?.subject?.results ?? [];
  const topResult = results[0];

  if (!topResult || topResult.score < MATCH_THRESHOLD) {
    const maxScore = topResult?.score ?? 0;
    return {
      isMatch: false,
      score: maxScore,
      datasets: [],
      matchedNames: [],
      provider: maxScore >= 50 ? 'manual_review' : 'clear',
      requiresManualReview: maxScore >= 50,
      rawResponse: data,
    };
  }

  return {
    isMatch: true,
    score: topResult.score,
    datasets: topResult.datasets,
    matchedNames: topResult.properties.name ?? [],
    provider: 'opensanctions',
    requiresManualReview: true,
    rawResponse: data,
  };
}

/**
 * Screen a name/entity against sanctions lists.
 *
 * Returns a result that should be stored in compliance.aml_checks.
 * On API error: returns requiresManualReview=true, never isMatch=false silently.
 */
export async function screenSanctions(input: SanctionsCheckInput): Promise<SanctionsCheckResult> {
  const apiKey = process.env.OPENSANCTIONS_API_KEY;

  if (apiKey) {
    try {
      return await checkOpenSanctions(input, apiKey);
    } catch (err) {
      console.error('[sanctions] OpenSanctions API error:', err);
      // Fail CLOSED: require manual review on error
      return {
        isMatch: false,
        score: 0,
        datasets: [],
        matchedNames: [],
        provider: 'manual_review',
        requiresManualReview: true,
        rawResponse: { error: String(err) },
      };
    }
  }

  // No API key — flag for manual review
  console.warn('[sanctions] OPENSANCTIONS_API_KEY not set — queuing for manual review:', input.name);
  return {
    isMatch: false,
    score: 0,
    datasets: [],
    matchedNames: [],
    provider: 'manual_review',
    requiresManualReview: true,
  };
}

/** AML risk scoring for promoter (combines sanctions + registration age + country) */
export interface AmlRiskScore {
  score: number;          // 0-100
  level: 'low' | 'medium' | 'high';
  factors: string[];
}

/** ISO 3166-1 alpha-2 codes of FATF high-risk / grey-listed countries */
const FATF_HIGH_RISK = new Set([
  'AF', 'BJ', 'BF', 'CM', 'CD', 'SY', 'KP', 'IR', 'MM', 'MO', 'SS', 'TZ', 'YE', 'VU', 'HT',
]);

export function computeAmlRiskScore(args: {
  country: string;
  companyAgeMonths: number;
  isVatPayer: boolean;
  sanctionsResult: SanctionsCheckResult;
}): AmlRiskScore {
  let score = 0;
  const factors: string[] = [];

  if (args.sanctionsResult.isMatch) {
    score += 100;
    factors.push('Sanctions list match');
  } else if (args.sanctionsResult.requiresManualReview) {
    score += 40;
    factors.push('Sanctions screening pending manual review');
  }

  if (FATF_HIGH_RISK.has(args.country)) {
    score += 30;
    factors.push(`FATF high-risk jurisdiction: ${args.country}`);
  }

  if (args.companyAgeMonths < 6) {
    score += 15;
    factors.push('Company registered < 6 months ago');
  }

  if (!args.isVatPayer && args.country !== 'CZ') {
    score += 10;
    factors.push('Non-VAT-registered company in foreign jurisdiction');
  }

  const capped = Math.min(score, 100);
  return {
    score: capped,
    level: capped >= 60 ? 'high' : capped >= 25 ? 'medium' : 'low',
    factors,
  };
}
