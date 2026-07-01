/**
 * EUDI peněženka — verifier framework (OpenID4VP se selektivním zveřejněním).
 *
 * „Na klíč": bez EUDI_VERIFIER_URL + EUDI_CLIENT_ID vrací `null` config a volající
 * endpointy fail-closed (503). Po nastavení reálného verifieru (např. EU reference
 * implementation nebo národní verifier) se aktivuje bez dalšího zásahu do kódu.
 *
 * Princip: požádáme peněženku jen o MINIMUM claimů (age_over_18 / same_device /
 * residency) — ne o identitu. Zpět dostaneme pseudonym subjektu + boolean claims.
 * Žádné PII se neukládá (GDPR-native anti-scalping identita).
 */

export interface EudiConfig {
  verifierUrl: string;
  clientId: string;
}

/** Vrátí config jen když je EUDI nastavené; jinak null (→ endpoint fail-closed 503). */
export function eudiConfig(): EudiConfig | null {
  const verifierUrl = process.env.EUDI_VERIFIER_URL;
  const clientId = process.env.EUDI_CLIENT_ID;
  if (!verifierUrl || !clientId) return null;
  return { verifierUrl, clientId };
}

/** Které důkazy akce vyžaduje (z catalog.events.eudi_required). */
export interface RequestedProofs {
  age18?: boolean;
  samePerson?: boolean;
  residency?: string | null; // ISO kód země pro presale, nebo null
}

/** Ověřené claims — jen booleany / pseudonym, nikdy PII. */
export interface VerifiedClaims {
  age_over_18?: boolean;
  same_device?: boolean;
  residency?: string | null;
}

export interface PresentationResult {
  verified: boolean;
  subjectPseudonym: string | null;
  claims: VerifiedClaims;
  reason?: string;
}

/**
 * Presentation Definition (OpenID4VP / DIF PE) — žádá o MINIMUM claimů se
 * selektivním zveřejněním. Peněženka odhalí jen tyto atributy, ne identitu.
 */
export function buildPresentationDefinition(proofs: RequestedProofs, nonce: string): Record<string, unknown> {
  const fields: Array<Record<string, unknown>> = [];
  if (proofs.age18) {
    fields.push({ path: ['$.age_over_18'], filter: { type: 'boolean', const: true }, intent_to_retain: false });
  }
  if (proofs.residency) {
    fields.push({ path: ['$.resident_country'], filter: { type: 'string', const: proofs.residency }, intent_to_retain: false });
  }
  // same_device / same_person řešíme vazbou na device-bound credential (holder binding),
  // ne samostatným atributem — proto tu jen značka pro verifier.
  return {
    id: `tixly-${nonce}`,
    input_descriptors: [
      {
        id: 'eu.europa.ec.eudi.pid.1',
        name: 'Ověření (selektivní zveřejnění)',
        purpose: 'Ověření věku/rezidence pro vstupenku — bez odhalení identity.',
        constraints: {
          limit_disclosure: 'required',
          fields: fields.length ? fields : [{ path: ['$.issuance_date'], intent_to_retain: false }],
        },
      },
    ],
  };
}

/**
 * Ověří VP token (presentation response) proti nakonfigurovanému verifieru.
 * Framework: bez reálného verifieru (config null) sem endpoint vůbec nedojde.
 */
export async function verifyPresentation(
  cfg: EudiConfig,
  vpToken: string,
  nonce: string,
): Promise<PresentationResult> {
  const res = await fetch(`${cfg.verifierUrl.replace(/\/$/, '')}/verify`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ client_id: cfg.clientId, vp_token: vpToken, nonce }),
  });
  if (!res.ok) {
    return { verified: false, subjectPseudonym: null, claims: {}, reason: `VERIFIER_HTTP_${res.status}` };
  }
  const data = (await res.json()) as {
    valid?: boolean;
    subject?: string;
    claims?: VerifiedClaims;
    reason?: string;
  };
  return {
    verified: data.valid === true,
    subjectPseudonym: data.subject ?? null,
    claims: data.claims ?? {},
    reason: data.reason,
  };
}
