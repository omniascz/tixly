/**
 * Apple Wallet .pkpass builder.
 *
 * Produkční `.pkpass` = ZIP s těmito soubory:
 *   - pass.json (popis pasu, viz PassKit Web Service Reference)
 *   - icon.png, icon@2x.png, logo.png (vizuální)
 *   - manifest.json (SHA1 hash KAŽDÉHO souboru jako mapping name → hex)
 *   - signature (PKCS#7 detached sig binární manifest.json přes Pass Type ID cert + Apple WWDR)
 *
 * Konfigurace v `.env.local`:
 *   APPLE_PASS_TYPE_IDENTIFIER=pass.cz.divadlovceletne.ticket  (z Apple Developer)
 *   APPLE_TEAM_IDENTIFIER=ABC123XYZ4                          (10-znakový Team ID)
 *   APPLE_PASS_CERT_PEM=...                                   (pass type ID cert)
 *   APPLE_PASS_KEY_PEM=...                                    (private key, NEZAŠIFROVANÝ)
 *   APPLE_WWDR_CERT_PEM=...                                   (Apple WWDR intermediate)
 *
 * Bez certifikátů vrátíme unsigned `.pkpass` — iOS ho odmítne ale obsah je validní
 * pro testování pipeline / náhled obsahu.
 *
 * Nutné kroky pro produkci:
 *   1. Apple Developer Account ($99/yr)
 *   2. Vytvořit Pass Type ID v developer.apple.com → Identifiers
 *   3. Stáhnout certifikát (.cer) + WWDR (.cer)
 *   4. Konvertovat na PEM přes `openssl`
 *   5. Doplnit do env, deploy
 */

import { createHash, createSign } from 'crypto';
import { Buffer } from 'node:buffer';
import { createZip, type ZipFile } from './zip-store';

export interface PassData {
  ticketId: string;
  eventTitle: string;
  eventDateIso: string;
  ticketTypeName: string;
  holderName: string | null;
  holderEmail: string;
  venueName: string | null;
  qrPayload: string;
  organizationName: string;
  brandColorHex?: string | null;
  brandLogoUrl?: string | null;
  seatLabel?: string | null;
}

const PASS_TYPE_IDENTIFIER =
  process.env.APPLE_PASS_TYPE_IDENTIFIER ?? 'pass.cz.tixly.event-ticket';
const TEAM_IDENTIFIER = process.env.APPLE_TEAM_IDENTIFIER ?? 'TIXLYTEAMID';

function hexToRgb(hex: string | null | undefined): string {
  if (!hex || !/^#[0-9a-f]{6}$/i.test(hex)) return 'rgb(15, 23, 42)';
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex)!;
  return `rgb(${parseInt(m[1]!, 16)}, ${parseInt(m[2]!, 16)}, ${parseInt(m[3]!, 16)})`;
}

export function buildPassJson(p: PassData): Record<string, unknown> {
  const auxFields: Record<string, unknown>[] = [
    { key: 'type', label: 'Typ', value: p.ticketTypeName },
  ];
  if (p.holderName) {
    auxFields.push({ key: 'holder', label: 'Jméno', value: p.holderName });
  }
  if (p.seatLabel) {
    auxFields.push({ key: 'seat', label: 'Sedadlo', value: p.seatLabel });
  }

  return {
    formatVersion: 1,
    passTypeIdentifier: PASS_TYPE_IDENTIFIER,
    teamIdentifier: TEAM_IDENTIFIER,
    organizationName: p.organizationName,
    serialNumber: p.ticketId,
    description: `${p.eventTitle} – ${p.ticketTypeName}`,
    eventTicket: {
      primaryFields: [{ key: 'event', label: 'Akce', value: p.eventTitle }],
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
      auxiliaryFields: auxFields,
      backFields: [
        { key: 'email', label: 'E-mail', value: p.holderEmail },
        { key: 'ticketId', label: 'Ticket ID', value: p.ticketId },
        {
          key: 'terms',
          label: 'Podmínky',
          value:
            'Vstupenka je nepřenosná po check-inu. Refund podle podmínek pořadatele.',
        },
      ],
    },
    barcodes: [
      {
        format: 'PKBarcodeFormatQR',
        message: p.qrPayload,
        messageEncoding: 'iso-8859-1',
        altText: p.ticketId.slice(0, 8),
      },
    ],
    backgroundColor: hexToRgb(p.brandColorHex),
    foregroundColor: 'rgb(255, 255, 255)',
    labelColor: 'rgb(220, 220, 230)',
    locations: [],
    logoText: p.organizationName,
  };
}

/**
 * 1×1 transparentní PNG (67 B) — Apple vyžaduje icon/logo soubory, placeholder
 * stačí pro unsigned demo. V produkci nahradit reálným brandem (29×29 / 87×87).
 */
const PLACEHOLDER_PNG = Buffer.from(
  '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
  'hex',
);

interface BuildResult {
  buffer: Buffer;
  signed: boolean;
  note: string | null;
}

/**
 * Vyrobí `.pkpass` ZIP. Pokud chybí APPLE_PASS_CERT_PEM / KEY_PEM / WWDR_CERT_PEM,
 * vrátí unsigned bundle (manifest.json validní, signature je prázdný 1-byte placeholder).
 *
 * S kompletními env proměnnými podepíše manifest.json přes PKCS#7 detached signaturu.
 */
export function buildPkpass(p: PassData): BuildResult {
  const passJson = Buffer.from(JSON.stringify(buildPassJson(p), null, 2), 'utf-8');

  const files: ZipFile[] = [
    { name: 'pass.json', data: passJson },
    { name: 'icon.png', data: PLACEHOLDER_PNG },
    { name: 'icon@2x.png', data: PLACEHOLDER_PNG },
    { name: 'logo.png', data: PLACEHOLDER_PNG },
  ];

  // manifest.json: SHA1 každého souboru (kromě manifest.json a signature samotných)
  const manifest: Record<string, string> = {};
  for (const f of files) {
    manifest[f.name] = createHash('sha1').update(f.data).digest('hex');
  }
  const manifestBuf = Buffer.from(JSON.stringify(manifest), 'utf-8');

  // Signature
  let signature: Buffer;
  let signed = false;
  let note: string | null = null;

  const certPem = process.env.APPLE_PASS_CERT_PEM?.replace(/\\n/g, '\n');
  const keyPem = process.env.APPLE_PASS_KEY_PEM?.replace(/\\n/g, '\n');
  const wwdrPem = process.env.APPLE_WWDR_CERT_PEM?.replace(/\\n/g, '\n');

  if (certPem && keyPem && wwdrPem) {
    try {
      // PKCS#7 detached signature via node:crypto.createSign('SHA1')
      // — Real Apple Wallet vyžaduje plný PKCS#7 SignedData ASN.1; zde
      // vrátíme jen raw RSA-SHA1 signaturu jako approximation pro
      // dev pipeline. Pro produkci nahradit voláním openssl smime nebo
      // node-forge.
      const signer = createSign('RSA-SHA1');
      signer.update(manifestBuf);
      signer.end();
      signature = signer.sign(keyPem);
      signed = true;
      note = 'Signature je raw RSA-SHA1; produkčně přepiš na PKCS#7 SignedData přes node-forge.';
    } catch (e) {
      signature = Buffer.from([0]);
      note = `Sign selhal: ${e instanceof Error ? e.message : String(e)}`;
    }
  } else {
    signature = Buffer.from([0]); // placeholder, iOS odmítne
    note =
      'Unsigned pass — doplň APPLE_PASS_CERT_PEM, APPLE_PASS_KEY_PEM, APPLE_WWDR_CERT_PEM pro fungování v iOS.';
  }

  files.push({ name: 'manifest.json', data: manifestBuf });
  files.push({ name: 'signature', data: signature });

  return {
    buffer: createZip(files),
    signed,
    note,
  };
}
