/**
 * DSA (Digital Services Act) — EU 2022/2065
 *
 * Tixly qualifies as a "small online marketplace" (<45M EU users).
 * Light obligations apply:
 *   - Art. 16: content reporting mechanism ✅ (this file)
 *   - Art. 11: single point of contact for EU authorities ✅
 *   - Art. 12: single point of contact for member-state law enforcement ✅
 *   - Art. 20: internal complaint-handling system ✅
 *   - Art. 21: out-of-court dispute settlement ✅
 *   - NOT required: transparency reports, systemic risk audits (>45M threshold)
 */

/** DSA illegal content categories (Art. 16 + Annex references) */
export const DSA_CATEGORIES = [
  { key: 'counterfeit_tickets',       label: 'Counterfeit / fraudulent tickets',        article: 'EU 2019/1150 Art. 3' },
  { key: 'price_gouging',             label: 'Illegal ticket resale / price gouging',   article: 'National consumer law' },
  { key: 'misleading_info',           label: 'Misleading event / artist information',   article: 'CRD 2019/2161 Art. 6' },
  { key: 'illegal_hate_speech',       label: 'Illegal hate speech in event content',    article: 'Framework Decision 2008/913/JHA' },
  { key: 'csam',                      label: 'Child sexual abuse material (CSAM)',       article: 'Directive 2011/93/EU' },
  { key: 'terrorist_content',         label: 'Terrorist or extremist content',          article: 'Regulation 2021/784' },
  { key: 'sanctions_violation',       label: 'Sanctioned promoter / entity',            article: 'EU sanctions regulation' },
  { key: 'privacy_violation',         label: 'Unlawful personal data processing',       article: 'GDPR Art. 17' },
  { key: 'other_illegal',             label: 'Other illegal content or activity',       article: null },
] as const;

export type DsaCategory = (typeof DSA_CATEGORIES)[number]['key'];

/** DSA single point of contact — EU authorities (Art. 11) */
export const DSA_CONTACT = {
  email:    'dsa@tixly.cz',
  language: ['cs', 'sk', 'en'],
  address:  'Tixly s.r.o., Praha, Czech Republic',
  /** EU Digital Services Coordinator for CZ: Czech Telecommunication Office */
  dsc_url:  'https://www.ctu.cz/en',
};

/** Out-of-court dispute settlement (Art. 21) */
export const DSA_DISPUTE_BODY = {
  name:  'Czech Trade Inspection Authority (ČOI)',
  url:   'https://www.coi.cz/en/',
  eu_odr_url: 'https://ec.europa.eu/consumers/odr/',
};

export interface DsaReportInput {
  reporterUserId?: string;
  reporterEmail?: string;
  targetType: 'event' | 'promoter' | 'ticket_type' | 'listing';
  targetId?: string;
  category: DsaCategory;
  description: string;
  evidenceUrl?: string;
  ipAddress?: string;
}

export function maskIp(ip: string): string {
  if (ip.includes(':')) {
    // IPv6: keep first 4 groups, zero the rest
    const parts = ip.split(':');
    return parts.slice(0, 4).join(':') + '::';
  }
  // IPv4: zero last octet
  return ip.replace(/\.\d+$/, '.0');
}

export function hashIp(ip: string): string {
  const { createHash } = require('crypto') as typeof import('crypto');
  return createHash('sha256').update(ip + (process.env.HMAC_SECRET ?? '')).digest('hex');
}
