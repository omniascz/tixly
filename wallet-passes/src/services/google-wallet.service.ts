/**
 * Google Wallet service.
 *
 * Responsibilities:
 *  - Create an EventTicketClass for each event (idempotent).
 *  - Create an EventTicketObject per ticket.
 *  - Sign a Google Wallet JWT so the user can click "Add to Google Wallet".
 *  - PATCH the barcode value when a TOTP QR payload changes (resale / refresh).
 *
 * Authentication uses a Google Service Account (JSON key file) stored as a
 * base64-encoded string in GOOGLE_WALLET_SERVICE_ACCOUNT_JSON.
 *
 * All HTTP calls are made through an injected HttpClient interface so the
 * service is independently testable.
 */

import * as forge from "node-forge";
import type { GooglePassData } from "../types/wallet.js";

// ---------------------------------------------------------------------------
// Environment helpers
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

// ---------------------------------------------------------------------------
// Service account key shape
// ---------------------------------------------------------------------------

interface ServiceAccountKey {
  type: string;
  project_id: string;
  private_key_id: string;
  private_key: string; // PEM-encoded RSA private key
  client_email: string;
  client_id: string;
  auth_uri: string;
  token_uri: string;
}

// ---------------------------------------------------------------------------
// HTTP client interface
// ---------------------------------------------------------------------------

export interface GoogleHttpClient {
  get(
    url: string,
    headers: Record<string, string>
  ): Promise<{ statusCode: number; body: string }>;
  post(
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<{ statusCode: number; body: string }>;
  patch(
    url: string,
    headers: Record<string, string>,
    body: string
  ): Promise<{ statusCode: number; body: string }>;
}

// ---------------------------------------------------------------------------
// Google Wallet API base URL
// ---------------------------------------------------------------------------

const WALLET_API = "https://walletobjects.googleapis.com/walletobjects/v1";

// ---------------------------------------------------------------------------
// Google OAuth2 token exchange
// ---------------------------------------------------------------------------

/**
 * Exchanges a service-account self-signed JWT for a Google OAuth2 Bearer token.
 *
 * The JWT assertion flow (RFC 7523):
 *   1. Build a JWT with:
 *        header  = { alg: "RS256", typ: "JWT" }
 *        payload = { iss, scope, aud, iat, exp }
 *   2. POST to https://oauth2.googleapis.com/token with:
 *        grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=<JWT>
 *   3. Response contains { access_token, expires_in, token_type: "Bearer" }
 *
 * The access_token is valid for 3600 s. In production you should cache it.
 */
async function getAccessToken(
  serviceAccount: ServiceAccountKey,
  http: GoogleHttpClient
): Promise<string> {
  const scope = "https://www.googleapis.com/auth/wallet_object.issuer";
  const aud = "https://oauth2.googleapis.com/token";
  const now = Math.floor(Date.now() / 1000);

  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(
    JSON.stringify({
      iss: serviceAccount.client_email,
      scope,
      aud,
      iat: now,
      exp: now + 3600,
    })
  );

  const signingInput = `${header}.${payload}`;
  const signature = signRS256(signingInput, serviceAccount.private_key);
  const jwt = `${signingInput}.${signature}`;

  const body = `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`;
  const result = await http.post(
    "https://oauth2.googleapis.com/token",
    { "content-type": "application/x-www-form-urlencoded" },
    body
  );

  if (result.statusCode !== 200) {
    throw new Error(
      `GOOGLE_WALLET: token exchange failed HTTP ${result.statusCode}: ${result.body}`
    );
  }

  const json = JSON.parse(result.body) as { access_token: string };
  return json.access_token;
}

// ---------------------------------------------------------------------------
// RS256 signing helper
// ---------------------------------------------------------------------------

/**
 * Signs a UTF-8 string with an RSA private key using SHA-256 and returns
 * the base64url-encoded signature. Used both for the OAuth2 JWT assertion
 * and for the "Add to Google Wallet" JWT.
 *
 * node-forge handles PEM parsing and RSA-SHA256 PKCS#1 v1.5 signing natively.
 * The resulting DER signature is then base64url-encoded to produce the JWT
 * signature component.
 */
function signRS256(input: string, privatePem: string): string {
  const privateKey = forge.pki.privateKeyFromPem(privatePem) as forge.pki.rsa.PrivateKey;
  const md = forge.md.sha256.create();
  md.update(input, "utf8");
  // RSA sign returns binary string; convert to Buffer then to base64url
  const signatureBinary = privateKey.sign(md);
  return Buffer.from(signatureBinary, "binary").toString("base64url");
}

// ---------------------------------------------------------------------------
// Base64url helper
// ---------------------------------------------------------------------------

function b64url(str: string): string {
  return Buffer.from(str, "utf8").toString("base64url");
}

// ---------------------------------------------------------------------------
// EventTicketClass builder
// ---------------------------------------------------------------------------

/**
 * Builds a minimal Google Wallet EventTicketClass object.
 * One class is shared by all tickets for the same event.
 * Fields follow the Google Wallet REST API v1 schema.
 */
function buildEventTicketClass(
  issuerId: string,
  eventId: string,
  passData: GooglePassData
): Record<string, unknown> {
  return {
    id: `${issuerId}.${eventId}`,
    issuerName: "Tixly",
    eventName: {
      defaultValue: { language: "cs", value: passData.eventTitle },
    },
    venue: {
      name: { defaultValue: { language: "cs", value: passData.venueName } },
    },
    dateTime: {
      doorsOpen: `${passData.eventDate}T${passData.eventTime}:00`,
    },
    logo: {
      // Placeholder — replace with production CDN URL
      sourceUri: {
        uri: "https://static.tixly.cz/assets/logo-wallet.png",
      },
      contentDescription: {
        defaultValue: { language: "cs", value: "Tixly logo" },
      },
    },
    hexBackgroundColor: "#6366f1",
    reviewStatus: "underReview",
  };
}

// ---------------------------------------------------------------------------
// EventTicketObject builder
// ---------------------------------------------------------------------------

/**
 * Builds a Google Wallet EventTicketObject.
 * One object per ticket; references the shared EventTicketClass by classId.
 */
function buildEventTicketObject(
  issuerId: string,
  ticketId: string,
  passData: GooglePassData
): Record<string, unknown> {
  return {
    id: `${issuerId}.${ticketId}`,
    classId: `${issuerId}.${passData.eventId}`,
    state: "ACTIVE",
    ticketNumber: ticketId,
    ticketHolderName: passData.holderName,
    seatInfo: {
      seat: {
        defaultValue: {
          language: "cs",
          value: passData.seatNumber ?? passData.seatInfo,
        },
      },
      row: {
        defaultValue: { language: "cs", value: passData.row ?? "" },
      },
      section: {
        defaultValue: {
          language: "cs",
          value: passData.section ?? passData.seatInfo,
        },
      },
    },
    barcode: {
      type: "QR_CODE",
      value: passData.qrMessage,
      alternateText: ticketId,
    },
    textModulesData: [
      {
        header: "Typ vstupenky",
        body: passData.ticketType,
        id: "ticketType",
      },
    ],
    hexBackgroundColor: "#6366f1",
  };
}

// ---------------------------------------------------------------------------
// GoogleWalletService
// ---------------------------------------------------------------------------

export class GoogleWalletService {
  private readonly issuerId: string;
  private readonly serviceAccount: ServiceAccountKey;

  constructor(private readonly http: GoogleHttpClient) {
    this.issuerId = requireEnv("GOOGLE_WALLET_ISSUER_ID");

    const saJson = requireEnv("GOOGLE_WALLET_SERVICE_ACCOUNT_JSON");
    try {
      this.serviceAccount = JSON.parse(
        Buffer.from(saJson, "base64").toString("utf8")
      ) as ServiceAccountKey;
    } catch {
      throw new Error(
        "GOOGLE_WALLET: GOOGLE_WALLET_SERVICE_ACCOUNT_JSON is not valid base64-encoded JSON"
      );
    }
  }

  // -------------------------------------------------------------------------
  // generatePassJWT
  // -------------------------------------------------------------------------

  /**
   * Creates (or ensures existence of) the EventTicketClass for the event,
   * then creates the EventTicketObject for the ticket, and finally builds a
   * signed Google Wallet JWT that the client uses to show the
   * "Add to Google Wallet" button.
   *
   * Google Wallet JWT structure (RS256):
   *   header  = { alg: "RS256", typ: "JWT" }
   *   payload = {
   *     iss:     "<client_email>",
   *     aud:     "google",
   *     origins: ["https://tixly.cz"],
   *     typ:     "savetowallet",
   *     payload: {
   *       eventTicketObjects: [{ id: "{issuerId}.{ticketId}" }]
   *     }
   *   }
   *
   * The JWT is signed with the service account's RSA private key using RS256.
   * The resulting JWT string is passed to:
   *   https://pay.google.com/gp/v/save/{jwt}
   *
   * Reference: https://developers.google.com/wallet/tickets/events/web/create-pass
   */
  async generatePassJWT(ticketId: string, passData: GooglePassData): Promise<string> {
    const accessToken = await getAccessToken(this.serviceAccount, this.http);

    // Ensure EventTicketClass exists (idempotent — returns 409 if already created)
    await this.ensureEventTicketClass(passData, accessToken);

    // Create the EventTicketObject
    const ticketObject = buildEventTicketObject(this.issuerId, ticketId, passData);
    const createUrl = `${WALLET_API}/eventTicketObject`;
    const createResult = await this.http.post(
      createUrl,
      {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      JSON.stringify(ticketObject)
    );

    // 409 Conflict = object already exists (idempotent re-issue)
    if (createResult.statusCode !== 200 && createResult.statusCode !== 409) {
      throw new Error(
        `GOOGLE_WALLET: failed to create EventTicketObject HTTP ${createResult.statusCode}: ${createResult.body}`
      );
    }

    // Build the "Add to Google Wallet" JWT
    return this.buildSaveToWalletJwt(ticketId);
  }

  // -------------------------------------------------------------------------
  // updatePassBarcode
  // -------------------------------------------------------------------------

  /**
   * PATCHes the barcode.value of an existing EventTicketObject.
   * Called when a TOTP secret changes (resale transfer or manual refresh).
   *
   * Google Wallet API PATCH uses JSON merge-patch semantics — only the fields
   * included in the request body are updated; all other fields remain unchanged.
   *
   * Endpoint: PATCH /walletobjects/v1/eventTicketObject/{objectId}
   * Ref: https://developers.google.com/wallet/reference/rest/v1/eventticketobject/patch
   */
  async updatePassBarcode(ticketId: string, newQRPayload: string): Promise<void> {
    const objectId = encodeURIComponent(`${this.issuerId}.${ticketId}`);
    const url = `${WALLET_API}/eventTicketObject/${objectId}`;

    const accessToken = await getAccessToken(this.serviceAccount, this.http);

    const patchBody = JSON.stringify({
      barcode: {
        type: "QR_CODE",
        value: newQRPayload,
        alternateText: ticketId,
      },
    });

    const result = await this.http.patch(
      url,
      {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      patchBody
    );

    if (result.statusCode !== 200) {
      throw new Error(
        `GOOGLE_WALLET: barcode PATCH failed HTTP ${result.statusCode}: ${result.body}`
      );
    }
  }

  // -------------------------------------------------------------------------
  // generateAddToWalletUrl
  // -------------------------------------------------------------------------

  /**
   * Returns the "Add to Google Wallet" deep-link URL for a given JWT.
   * The user clicks this link on Android / in Chrome to add the pass.
   */
  generateAddToWalletUrl(jwt: string): string {
    return `https://pay.google.com/gp/v/save/${jwt}`;
  }

  // -------------------------------------------------------------------------
  // Private helpers
  // -------------------------------------------------------------------------

  private async ensureEventTicketClass(
    passData: GooglePassData,
    accessToken: string
  ): Promise<void> {
    const classId = encodeURIComponent(`${this.issuerId}.${passData.eventId}`);
    const getUrl = `${WALLET_API}/eventTicketClass/${classId}`;

    const existing = await this.http.get(getUrl, {
      authorization: `Bearer ${accessToken}`,
    });

    if (existing.statusCode === 200) {
      // Class already exists — nothing to do
      return;
    }

    if (existing.statusCode !== 404) {
      throw new Error(
        `GOOGLE_WALLET: GET EventTicketClass HTTP ${existing.statusCode}: ${existing.body}`
      );
    }

    // Create the class
    const ticketClass = buildEventTicketClass(
      this.issuerId,
      passData.eventId,
      passData
    );
    const createUrl = `${WALLET_API}/eventTicketClass`;
    const result = await this.http.post(
      createUrl,
      {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
      },
      JSON.stringify(ticketClass)
    );

    if (result.statusCode !== 200) {
      throw new Error(
        `GOOGLE_WALLET: CREATE EventTicketClass HTTP ${result.statusCode}: ${result.body}`
      );
    }
  }

  /**
   * Builds and signs the Google Wallet "save to wallet" JWT.
   *
   * The JWT payload references the already-created EventTicketObject by ID.
   * Google's servers fetch the object details directly from the Wallet API,
   * so the JWT only needs to carry the object ID — not the full object.
   *
   * Signing: RS256 with the service account's private key.
   */
  private buildSaveToWalletJwt(ticketId: string): string {
    const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = b64url(
      JSON.stringify({
        iss: this.serviceAccount.client_email,
        aud: "google",
        origins: ["https://tixly.cz"],
        typ: "savetowallet",
        payload: {
          eventTicketObjects: [{ id: `${this.issuerId}.${ticketId}` }],
        },
      })
    );

    const signingInput = `${header}.${payload}`;
    const signature = signRS256(signingInput, this.serviceAccount.private_key);
    return `${signingInput}.${signature}`;
  }
}
