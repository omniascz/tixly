/**
 * Apple Wallet (PKPass) service.
 *
 * Responsibilities:
 *  - Generate a signed .pkpass ZIP buffer for a given ticket.
 *  - Send APN push notifications so devices re-fetch an updated pass.
 *  - Handle device registration / unregistration from Apple Wallet.
 *  - Answer Apple's "what serials have changed since T?" polling request.
 *
 * External dependencies are injected via interfaces so this class is
 * independently testable without a real DB or HTTP stack.
 */

import { createHash, randomBytes } from "crypto";
import * as forge from "node-forge";
import JSZip from "jszip";
import type { ApplePassData, ApplePassRegistration } from "../types/wallet.js";

// ---------------------------------------------------------------------------
// Environment helpers (fail-fast at instantiation time if missing)
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// ---------------------------------------------------------------------------
// DB adapter interface
// ---------------------------------------------------------------------------

export interface AppleWalletDBAdapter {
  getRegistrations(serialNumber: string): Promise<ApplePassRegistration[]>;
  upsertRegistration(
    reg: Omit<ApplePassRegistration, "id">
  ): Promise<void>;
  deleteRegistration(
    deviceLibraryIdentifier: string,
    serialNumber: string
  ): Promise<void>;
  getUpdatedSerials(
    passTypeIdentifier: string,
    deviceLibraryIdentifier: string,
    since: Date
  ): Promise<string[]>;
  getAuthToken(serialNumber: string): Promise<string | null>;
}

// ---------------------------------------------------------------------------
// HTTP client interface (for APN push — injected for testability)
// ---------------------------------------------------------------------------

export interface HttpClient {
  post(
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<{ statusCode: number; body: string }>;
}

// ---------------------------------------------------------------------------
// Minimal 1×1 transparent PNG (binary-safe, no external assets needed)
// ---------------------------------------------------------------------------

/**
 * Returns a Buffer containing a valid 1×1 px transparent PNG.
 * Apple Wallet requires icon.png, logo.png etc. to be present in the ZIP;
 * these placeholder bytes satisfy the format check. Real images are swapped
 * in during the production asset-pipeline build step.
 *
 * The byte sequence below is a hand-crafted minimal PNG:
 *   - 8-byte PNG signature
 *   - IHDR chunk (1×1, 8-bit RGBA)
 *   - IDAT chunk (deflate-compressed single transparent pixel)
 *   - IEND chunk
 */
function minimalPng(): Buffer {
  // prettier-ignore
  return Buffer.from([
    // PNG signature
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    // IHDR: width=1, height=1, bitDepth=8, colorType=6 (RGBA), compression=0, filter=0, interlace=0
    0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
    0x00, 0x00, 0x00, 0x01,
    0x00, 0x00, 0x00, 0x01,
    0x08, 0x06, 0x00, 0x00, 0x00,
    0x1f, 0x15, 0xc4, 0x89,
    // IDAT: compressed single RGBA pixel (0,0,0,0 = transparent)
    0x00, 0x00, 0x00, 0x0b,
    0x49, 0x44, 0x41, 0x54,
    0x78, 0x9c, 0x62, 0x00, 0x00, 0x00, 0x02, 0x00, 0x01,
    0xe5, 0x27, 0xde, 0xfc,
    // IEND
    0x00, 0x00, 0x00, 0x00,
    0x49, 0x45, 0x4e, 0x44,
    0xae, 0x42, 0x60, 0x82,
  ]);
}

// ---------------------------------------------------------------------------
// pass.json builder
// ---------------------------------------------------------------------------

interface PassJson {
  formatVersion: number;
  passTypeIdentifier: string;
  teamIdentifier: string;
  serialNumber: string;
  authenticationToken: string;
  webServiceURL: string;
  description: string;
  organizationName: string;
  eventTicket: {
    primaryFields: Array<{ key: string; label: string; value: string }>;
    secondaryFields: Array<{ key: string; label: string; value: string }>;
    auxiliaryFields: Array<{ key: string; label: string; value: string }>;
    backFields: Array<{ key: string; label: string; value: string }>;
  };
  barcode: {
    message: string;
    format: string;
    messageEncoding: string;
  };
  foregroundColor: string;
  backgroundColor: string;
  logoText: string;
}

function buildPassJson(
  ticketId: string,
  authToken: string,
  passData: ApplePassData,
  passTypeIdentifier: string,
  teamIdentifier: string,
  webServiceURL: string
): PassJson {
  return {
    formatVersion: 1,
    passTypeIdentifier,
    teamIdentifier,
    serialNumber: `ticket-${ticketId}`,
    authenticationToken: authToken,
    webServiceURL,
    description: passData.eventTitle,
    organizationName: "Tixly",
    eventTicket: {
      primaryFields: [
        { key: "event", label: "Akce", value: passData.eventTitle },
      ],
      secondaryFields: [
        { key: "date", label: "Datum", value: passData.eventDate },
        { key: "venue", label: "Místo", value: passData.venueName },
      ],
      auxiliaryFields: [
        { key: "seat", label: "Místo/sekce", value: passData.seatInfo },
        { key: "holder", label: "Držitel", value: passData.holderName },
      ],
      backFields: [
        { key: "ticketId", label: "ID vstupenky", value: ticketId },
        {
          key: "terms",
          label: "Podmínky",
          value: "Vstupenka je nepřenosná a platí pouze pro uvedenou akci a sedadlo. Jakákoliv manipulace s QR kódem je zakázána.",
        },
        { key: "ticketType", label: "Typ vstupenky", value: passData.ticketType },
        { key: "time", label: "Čas", value: passData.eventTime },
      ],
    },
    barcode: {
      message: passData.qrMessage,
      format: "PKBarcodeFormatQR",
      messageEncoding: "iso-8859-1",
    },
    foregroundColor: "rgb(255, 255, 255)",
    backgroundColor: "rgb(99, 102, 241)",
    logoText: "Tixly",
  };
}

// ---------------------------------------------------------------------------
// PKCS#7 / CMS SignedData signature
// ---------------------------------------------------------------------------

/**
 * Signs a manifest.json Buffer using a PKCS#12 certificate bundle and
 * returns a detached CMS SignedData structure as DER-encoded bytes.
 *
 * Apple Wallet requires a PKCS#7 CMS SignedData detached signature
 * (i.e. the content is NOT embedded in the SignedData structure itself —
 * only the digest over the content is included). Apple verifies:
 *   1. The signing cert chain up to the Apple WWDR intermediate CA.
 *   2. The signed attributes include a content-type and message-digest.
 *   3. The digest matches manifest.json exactly.
 *
 * Implementation notes (node-forge):
 *  - forge.pkcs12.pkcs12FromAsn1 parses the P12 bundle.
 *  - forge.pkcs7.createSignedData() builds the CMS SignedData.
 *  - p7.sign({ detached: true }) produces a detached signature — the
 *    manifest content is hashed but not stored in the structure.
 *  - forge.asn1.toDer(p7.toAsn1()) serialises to DER bytes.
 */
function signManifest(manifestBuf: Buffer, p12Base64: string, p12Password: string): Buffer {
  // Decode P12 from base64 → binary string → ASN.1 → Pkcs12 object
  const p12Der = forge.util.decode64(p12Base64);
  const p12Asn1 = forge.asn1.fromDer(p12Der);
  const p12 = forge.pkcs12.pkcs12FromAsn1(p12Asn1, p12Password);

  // Extract private key and certificate (and any intermediate chain certs)
  const keyBags = p12.getBags({ bagType: forge.pki.oids.pkcs8ShroudedKeyBag });
  const certBags = p12.getBags({ bagType: forge.pki.oids.certBag });

  const keyBag = keyBags[forge.pki.oids.pkcs8ShroudedKeyBag]?.[0];
  if (!keyBag?.key) {
    throw new Error("APPLE_WALLET_SIGN: private key not found in P12 bundle");
  }

  const allCertBags = certBags[forge.pki.oids.certBag] ?? [];
  if (allCertBags.length === 0) {
    throw new Error("APPLE_WALLET_SIGN: no certificates found in P12 bundle");
  }

  // The first cert is the signing (leaf) cert; remaining are chain certs
  const signingCertBag = allCertBags[0];
  if (!signingCertBag?.cert) {
    throw new Error("APPLE_WALLET_SIGN: signing certificate is undefined");
  }
  const signingCert = signingCertBag.cert;
  const chainCerts = allCertBags
    .slice(1)
    .map((b) => b.cert)
    .filter((c): c is forge.pki.Certificate => c !== undefined);

  // Build CMS SignedData
  const p7 = forge.pkcs7.createSignedData();

  // Set the content that will be signed (manifest.json bytes as binary string)
  p7.content = forge.util.createBuffer(manifestBuf.toString("binary"));

  // Add the signing certificate and any intermediate chain certs
  p7.addCertificate(signingCert);
  for (const chainCert of chainCerts) {
    p7.addCertificate(chainCert);
  }

  // Add a signer entry: references the leaf cert, uses SHA-1 (Apple requirement)
  p7.addSigner({
    key: keyBag.key,
    certificate: signingCert,
    digestAlgorithm: forge.pki.oids.sha1,
    // authenticatedAttributes carry content-type and message-digest OIDs
    authenticatedAttributes: [
      { type: forge.pki.oids.contentType, value: forge.pki.oids.data },
      { type: forge.pki.oids.messageDigest },
    ],
  });

  // sign({ detached: true }) → digest is computed but manifest bytes are
  // NOT embedded inside the SignedData encapContentInfo — Apple requires this.
  p7.sign({ detached: true });

  // Serialise the SignedData ASN.1 structure to DER-encoded bytes
  const derStr = forge.asn1.toDer(p7.toAsn1()).getBytes();
  return Buffer.from(derStr, "binary");
}

// ---------------------------------------------------------------------------
// APN JWT builder
// ---------------------------------------------------------------------------

/**
 * Builds a short-lived ES256 JWT for authenticating to the APNs HTTP/2 endpoint.
 *
 * Apple documentation: https://developer.apple.com/documentation/usernotifications/establishing-a-token-based-connection-to-apns
 *
 * Anatomy of the JWT:
 *   header  = { alg: "ES256", kid: "<APPLE_APN_KEY_ID>" }
 *   payload = { iss: "<APPLE_APN_TEAM_ID>", iat: <unix_seconds> }
 *
 * The private key is an EC P-256 key stored as base64-encoded PEM in the
 * APPLE_APN_KEY_BASE64 environment variable (the .p8 file content).
 */
function buildApnJwt(keyBase64: string, keyId: string, teamId: string): string {
  const header = Buffer.from(
    JSON.stringify({ alg: "ES256", kid: keyId })
  ).toString("base64url");

  const payload = Buffer.from(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })
  ).toString("base64url");

  const signingInput = `${header}.${payload}`;

  // Decode base64 → PEM string → EC private key via node-forge
  const pemStr = Buffer.from(keyBase64, "base64").toString("utf8");
  const privateKey = forge.pki.privateKeyFromPem(pemStr) as forge.pki.rsa.PrivateKey;

  // node-forge doesn't have a direct ECDSA sign utility at the top level;
  // we use the underlying forge.pki.ed25519 path isn't correct for P-256.
  // Instead we delegate to Node.js native crypto for ES256 signing.
  // This mixed approach (forge for P12/PKCS#7, native crypto for ES256) is
  // intentional: forge ECDSA support is limited, but its PKCS#12/PKCS#7
  // support is mature.
  const { createSign } = require("crypto") as typeof import("crypto");
  const signer = createSign("SHA256");
  signer.update(signingInput, "utf8");

  // Re-export from forge's key representation to PEM so native crypto can use it
  const privatePem = forge.pki.privateKeyToPem(privateKey);
  const derSignature = signer.sign(privatePem);

  // Node crypto returns DER-encoded ECDSA signature; convert to raw r||s (64 bytes)
  const rawSignature = derToRawEcdsaSignature(derSignature);
  const signatureB64 = rawSignature.toString("base64url");

  return `${signingInput}.${signatureB64}`;
}

/**
 * Converts a DER-encoded ECDSA signature (ASN.1 SEQUENCE of two INTEGERs r, s)
 * to the raw 64-byte concatenated form r||s required by JWA ES256.
 *
 * DER SEQUENCE layout:
 *   30 <len>
 *     02 <rLen> <r bytes>  ← r integer (may have leading 0x00 padding)
 *     02 <sLen> <s bytes>  ← s integer
 *
 * Each of r and s must be exactly 32 bytes for P-256 (zero-padded on the left,
 * leading 0x00 padding byte stripped).
 */
function derToRawEcdsaSignature(der: Buffer): Buffer {
  if (der[0] !== 0x30) {
    throw new Error("APN_JWT: expected DER SEQUENCE tag 0x30");
  }
  let offset = 2; // skip 0x30 + length byte (assume length < 128)
  if ((der[1] ?? 0) > 0x80) {
    // Long-form length encoding: skip extra length bytes
    offset += (der[1]! & 0x7f);
  }

  // Parse r
  if (der[offset] !== 0x02) {
    throw new Error("APN_JWT: expected INTEGER tag 0x02 for r");
  }
  offset++;
  const rLen = der[offset++] ?? 0;
  const r = der.subarray(offset, offset + rLen);
  offset += rLen;

  // Parse s
  if (der[offset] !== 0x02) {
    throw new Error("APN_JWT: expected INTEGER tag 0x02 for s");
  }
  offset++;
  const sLen = der[offset++] ?? 0;
  const s = der.subarray(offset, offset + sLen);

  // Normalise to 32-byte big-endian integers (strip leading 0x00, left-pad with 0x00)
  const rPadded = padOrTrim(r, 32);
  const sPadded = padOrTrim(s, 32);

  return Buffer.concat([rPadded, sPadded]);
}

/** Strip leading zero bytes and left-pad to exactly `len` bytes. */
function padOrTrim(buf: Buffer, len: number): Buffer {
  // Strip leading zeros (DER may add 0x00 to keep sign bit positive)
  let start = 0;
  while (start < buf.length - 1 && buf[start] === 0x00) start++;
  const stripped = buf.subarray(start);
  if (stripped.length === len) return Buffer.from(stripped);
  if (stripped.length > len) {
    throw new Error(`APN_JWT: integer too large (${stripped.length} > ${len})`);
  }
  const padded = Buffer.alloc(len, 0);
  stripped.copy(padded, len - stripped.length);
  return padded;
}

// ---------------------------------------------------------------------------
// AppleWalletService
// ---------------------------------------------------------------------------

export class AppleWalletService {
  private readonly passTypeIdentifier: string;
  private readonly teamIdentifier: string;
  private readonly webServiceURL: string;
  private readonly certP12Base64: string;
  private readonly certPassword: string;
  private readonly apnKeyBase64: string;
  private readonly apnKeyId: string;
  private readonly apnTeamId: string;

  constructor(
    private readonly db: AppleWalletDBAdapter,
    private readonly http: HttpClient
  ) {
    this.passTypeIdentifier =
      process.env["APPLE_PASS_TYPE_IDENTIFIER"] ?? "pass.cz.tixly.ticket";
    this.teamIdentifier = requireEnv("APPLE_TEAM_ID");
    this.webServiceURL =
      process.env["APPLE_WALLET_WEB_SERVICE_URL"] ??
      "https://api.tixly.cz/api/wallet/apple";
    this.certP12Base64 = requireEnv("APPLE_PASS_CERT_P12_BASE64");
    this.certPassword = requireEnv("APPLE_PASS_CERT_PASSWORD");
    this.apnKeyBase64 = requireEnv("APPLE_APN_KEY_BASE64");
    this.apnKeyId = requireEnv("APPLE_APN_KEY_ID");
    this.apnTeamId = requireEnv("APPLE_APN_TEAM_ID");
  }

  // -------------------------------------------------------------------------
  // generatePass
  // -------------------------------------------------------------------------

  /**
   * Generates a signed .pkpass file (ZIP) for the given ticket.
   *
   * Steps:
   *  1. Build pass.json with current QR payload.
   *  2. Assemble all required image assets (1×1 px placeholder PNGs).
   *  3. Compute SHA-1 hashes of every file → manifest.json.
   *  4. Sign manifest.json with the P12 certificate → signature (DER bytes).
   *  5. ZIP everything → return as Buffer.
   *
   * The caller is responsible for streaming the Buffer as:
   *   Content-Type: application/vnd.apple.pkpass
   *   Content-Disposition: attachment; filename="ticket-{ticketId}.pkpass"
   */
  async generatePass(ticketId: string, passData: ApplePassData): Promise<Buffer> {
    const authToken = randomBytes(20).toString("hex"); // 40-char hex = 20 bytes

    const passJson = buildPassJson(
      ticketId,
      authToken,
      passData,
      this.passTypeIdentifier,
      this.teamIdentifier,
      this.webServiceURL
    );
    const passJsonBuf = Buffer.from(JSON.stringify(passJson, null, 2), "utf8");

    // Image assets — placeholder 1×1 PNG; replace with real assets at build time
    const png = minimalPng();
    const assets: Record<string, Buffer> = {
      "pass.json": passJsonBuf,
      "icon.png": png,
      "icon@2x.png": png,
      "logo.png": png,
      "logo@2x.png": png,
      "strip.png": png,
    };

    // Build manifest: { "filename": "<sha1 hex>", ... }
    const manifest: Record<string, string> = {};
    for (const [filename, buf] of Object.entries(assets)) {
      manifest[filename] = createHash("sha1").update(buf).digest("hex");
    }
    const manifestBuf = Buffer.from(JSON.stringify(manifest, null, 2), "utf8");

    // Sign manifest with P12 certificate → PKCS#7 CMS SignedData (DER)
    const signatureBuf = signManifest(
      manifestBuf,
      this.certP12Base64,
      this.certPassword
    );

    // Assemble ZIP (.pkpass)
    const zip = new JSZip();
    for (const [filename, buf] of Object.entries(assets)) {
      zip.file(filename, buf);
    }
    zip.file("manifest.json", manifestBuf);
    zip.file("signature", signatureBuf);

    const zipBuffer = await zip.generateAsync({
      type: "nodebuffer",
      compression: "STORE", // Apple Wallet spec requires STORE (no compression)
    });

    return zipBuffer;
  }

  // -------------------------------------------------------------------------
  // sendPushUpdate
  // -------------------------------------------------------------------------

  /**
   * Sends a "pass has changed" APN push to all devices that have registered
   * the pass for the given ticketId.
   *
   * The push payload is intentionally empty (`{ "aps": {} }`) — Apple Wallet
   * handles this special case by calling back to the webServiceURL to fetch
   * the updated pass. The actual QR payload update happens through that
   * subsequent GET /v1/passes/{passType}/{serial} request.
   *
   * APN endpoint (HTTP/2):
   *   Production: https://api.push.apple.com/3/device/{deviceToken}
   *   Sandbox:    https://api.sandbox.push.apple.com/3/device/{deviceToken}
   */
  async sendPushUpdate(ticketId: string): Promise<void> {
    const serialNumber = `ticket-${ticketId}`;
    const registrations = await this.db.getRegistrations(serialNumber);
    if (registrations.length === 0) return;

    // Build a fresh APN JWT (valid for ~1 hour; we re-create per batch for simplicity)
    const jwt = buildApnJwt(this.apnKeyBase64, this.apnKeyId, this.apnTeamId);

    const apnHost =
      process.env["APPLE_APN_SANDBOX"] === "true"
        ? "https://api.sandbox.push.apple.com"
        : "https://api.push.apple.com";

    const pushPayload = JSON.stringify({ aps: {} });

    await Promise.all(
      registrations.map(async (reg) => {
        const url = `${apnHost}/3/device/${reg.pushToken}`;
        const headers: Record<string, string> = {
          authorization: `bearer ${jwt}`,
          "apns-topic": this.passTypeIdentifier,
          "apns-push-type": "background",
          "content-type": "application/json",
        };
        const result = await this.http.post(url, headers, pushPayload);
        if (result.statusCode !== 200) {
          // Log but don't throw — a single device failure shouldn't abort others
          console.warn(
            `APN push failed for token ${reg.pushToken}: HTTP ${result.statusCode} — ${result.body}`
          );
        }
      })
    );
  }

  // -------------------------------------------------------------------------
  // handleRegistration
  // -------------------------------------------------------------------------

  /**
   * Called by Apple Wallet via POST /v1/devices/{deviceId}/registrations/{passType}/{serial}.
   * Validates the authenticationToken from the Authorization header, then
   * stores (or updates) the device's push token in the DB.
   */
  async handleRegistration(
    deviceLibraryIdentifier: string,
    passTypeIdentifier: string,
    serialNumber: string,
    authToken: string,
    pushToken: string
  ): Promise<void> {
    // Verify that the authenticationToken matches what we stored for this pass
    const storedToken = await this.db.getAuthToken(serialNumber);
    if (storedToken === null) {
      throw new Error(`APPLE_REG: unknown serial ${serialNumber}`);
    }
    if (storedToken !== authToken) {
      throw new Error(`APPLE_REG: invalid authToken for serial ${serialNumber}`);
    }

    await this.db.upsertRegistration({
      deviceLibraryIdentifier,
      pushToken,
      passTypeIdentifier,
      serialNumber,
      registeredAt: new Date(),
    });
  }

  // -------------------------------------------------------------------------
  // handleUnregistration
  // -------------------------------------------------------------------------

  /**
   * Called by Apple Wallet via DELETE /v1/devices/{deviceId}/registrations/{passType}/{serial}.
   * Removes the push token registration so the device no longer receives updates.
   */
  async handleUnregistration(
    deviceLibraryIdentifier: string,
    _passTypeIdentifier: string,
    serialNumber: string
  ): Promise<void> {
    await this.db.deleteRegistration(deviceLibraryIdentifier, serialNumber);
  }

  // -------------------------------------------------------------------------
  // getUpdatedPassSerials
  // -------------------------------------------------------------------------

  /**
   * Called by Apple Wallet via GET /v1/devices/{deviceId}/registrations/{passType}?passesUpdatedSince=...
   * Returns the serial numbers of passes that have changed since the given ISO timestamp.
   * Apple then fetches the updated pass bytes via GET /v1/passes/{passType}/{serial}.
   */
  async getUpdatedPassSerials(
    deviceLibraryIdentifier: string,
    passTypeIdentifier: string,
    passesUpdatedSince?: string
  ): Promise<{ serialNumbers: string[]; lastUpdated: string }> {
    // Default: epoch 0 → return everything registered to this device
    const since = passesUpdatedSince
      ? new Date(passesUpdatedSince)
      : new Date(0);

    const serialNumbers = await this.db.getUpdatedSerials(
      passTypeIdentifier,
      deviceLibraryIdentifier,
      since
    );

    return {
      serialNumbers,
      lastUpdated: new Date().toISOString(),
    };
  }
}
