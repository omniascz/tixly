/**
 * Transit partner handler registry.
 *
 * Slug → handler. Slug matchne `partnerSlug` v transit_combos table
 * + IssueTransitPassInput.partnerSlug. Default partneři:
 *   - 'dpp'       — Prague DPP/Lítačka
 *   - 'idos-brno' — Brno KORDIS / IDS JMK
 *
 * Pro další města (Ostrava DPO, Plzeň PMDP, Liberec ČSAD) přidej file +
 * mapping. Stejný pattern: env-driven creds, throw on missing, POST vendor,
 * return { qrPayload, validationSignature }.
 */
export { createDppPass } from './dpp';
export { createIdosBrnoPass } from './idos-brno';
