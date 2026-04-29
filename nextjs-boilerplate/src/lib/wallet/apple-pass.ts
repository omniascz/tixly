/**
 * Apple Wallet pass.json builder.
 *
 * The actual .pkpass file is a ZIP containing:
 *   - pass.json (this builder)
 *   - icon.png, logo.png, strip.png (visual assets)
 *   - manifest.json (SHA1 of every file)
 *   - signature (PKCS#7 detached sig of manifest using Pass Type ID cert)
 *
 * Production: needs Apple Pass Type ID certificate (Apple Developer account, ~$99/yr).
 * Demo: returns pass.json structure only (unsigned). Frontend can offer it as preview;
 * mobile import will fail without sig but content is valid.
 */

export interface PassData {
  ticketId: string;
  eventTitle: string;
  eventDateIso: string;
  ticketTypeName: string;
  holderName: string | null;
  holderEmail: string;
  venueName: string | null;
  qrPayload: string; // typically `tixly://ticket/{ticketId}` or signed JWT
  organizationName: string;
}

const PASS_TYPE_IDENTIFIER = process.env.APPLE_PASS_TYPE_IDENTIFIER ?? 'pass.cz.tixly.event-ticket';
const TEAM_IDENTIFIER = process.env.APPLE_TEAM_IDENTIFIER ?? 'TIXLYTEAMID';

export function buildPassJson(p: PassData): Record<string, unknown> {
  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_IDENTIFIER,
    teamIdentifier: TEAM_IDENTIFIER,
    organizationName: p.organizationName,
    serialNumber: p.ticketId,
    description: `${p.eventTitle} – ${p.ticketTypeName}`,
    eventTicket: {
      primaryFields: [
        { key: 'event', label: 'Akce', value: p.eventTitle },
      ],
      secondaryFields: [
        {
          key: 'date',
          label: 'Termín',
          value: p.eventDateIso,
          dateStyle: 'PKDateStyleMedium',
          timeStyle: 'PKDateStyleShort',
        },
        ...(p.venueName ? [{ key: 'venue', label: 'Místo', value: p.venueName }] : []),
      ],
      auxiliaryFields: [
        { key: 'type', label: 'Typ', value: p.ticketTypeName },
        ...(p.holderName ? [{ key: 'holder', label: 'Jméno', value: p.holderName }] : []),
      ],
      backFields: [
        { key: 'email', label: 'E-mail', value: p.holderEmail },
        { key: 'ticketId', label: 'Ticket ID', value: p.ticketId },
        {
          key: 'terms',
          label: 'Podmínky',
          value: 'Vstupenka je nepřenosná po check-inu. Refund podle podmínek pořadatele.',
        },
      ],
    },
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: p.qrPayload,
        messageEncoding: 'iso-8859-1',
        altText: p.ticketId,
      },
    ],
    backgroundColor: 'rgb(15, 23, 42)',
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(148, 163, 184)',
    locations: [],
    logoText: p.organizationName,
  };
}
