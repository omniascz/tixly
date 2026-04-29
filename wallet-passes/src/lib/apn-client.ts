/**
 * Real APN (Apple Push Notification service) HTTP/2 push client.
 *
 * Apple Wallet pass updates use a minimal APN push:
 *   POST https://api[.sandbox].push.apple.com/3/device/{deviceToken}
 *   Headers:
 *     apns-topic: {passTypeIdentifier}
 *     authorization: bearer {jwt}
 *     content-type: application/json
 *   Body: {}
 *
 * The push payload for pass updates is intentionally empty — Apple Wallet
 * handles the special case where `aps` is absent / empty by calling back to
 * the webServiceURL to fetch the updated pass bytes.
 *
 * Note: Apple's APN servers require HTTP/2. Node.js built-in `https` uses
 * HTTP/1.1 by default. For production use, the `node:http2` module or a
 * library such as `apn` / `@parse/node-apn` should be used. This file
 * provides a production-grade skeleton using `node:https` for environments
 * where HTTP/2 is handled transparently (e.g. behind an HTTP/2 proxy) AND
 * exports the injectable `SendApnPushFn` type so the real implementation can
 * be swapped in without changing callers.
 */

import * as https from "https";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export interface ApnPushResult {
  deviceToken: string;
  success: boolean;
  error?: string;
  statusCode?: number;
}

export interface ApnClientConfig {
  /** Key ID from Apple Developer console (kid in JWT header) */
  apnKeyId?: string;
  /** Team ID from Apple Developer console (iss in JWT payload) */
  apnTeamId?: string;
  /** EC P-256 private key — PEM string or base64-encoded PEM */
  apnPrivateKey?: string;
  /** pass.cz.{team}.{bundleId} — used as apns-topic header */
  passTypeIdentifier: string;
  environment: "production" | "sandbox";
}

/**
 * Injectable APN push function.
 * Receives a single device token and the pass type identifier.
 * Returns a result object — never throws.
 */
export type SendApnPushFn = (
  deviceToken: string,
  passTypeIdentifier: string
) => Promise<ApnPushResult>;

// ---------------------------------------------------------------------------
// JWT builder (ES256, Apple-compatible)
// ---------------------------------------------------------------------------

/**
 * Builds a minimal ES256 JWT for APN token-based auth.
 * Apple requires the JWT to be re-issued at most once per hour.
 */
function buildJwt(keyId: string, teamId: string, privateKeyPem: string): string {
  const { createSign } = require("crypto") as typeof import("crypto");

  const header = Buffer.from(JSON.stringify({ alg: "ES256", kid: keyId })).toString(
    "base64url"
  );
  const payload = Buffer.from(
    JSON.stringify({ iss: teamId, iat: Math.floor(Date.now() / 1000) })
  ).toString("base64url");

  const signingInput = `${header}.${payload}`;
  const signer = createSign("SHA256");
  signer.update(signingInput, "utf8");
  const derSig = signer.sign(privateKeyPem);

  // Convert DER ECDSA → raw r||s (64 bytes for P-256)
  const raw = derToRawEcdsaP256(derSig);
  return `${signingInput}.${raw.toString("base64url")}`;
}

/** DER SEQUENCE { INTEGER r, INTEGER s } → 64-byte r||s */
function derToRawEcdsaP256(der: Buffer): Buffer {
  if (der[0] !== 0x30) throw new Error("APN_JWT: expected DER SEQUENCE");
  let offset = 2;
  if ((der[1] ?? 0) > 0x80) offset += der[1]! & 0x7f;

  if (der[offset] !== 0x02) throw new Error("APN_JWT: expected INTEGER r");
  offset++;
  const rLen = der[offset++] ?? 0;
  const r = der.subarray(offset, offset + rLen);
  offset += rLen;

  if (der[offset] !== 0x02) throw new Error("APN_JWT: expected INTEGER s");
  offset++;
  const sLen = der[offset++] ?? 0;
  const s = der.subarray(offset, offset + sLen);

  return Buffer.concat([padOrTrim(r, 32), padOrTrim(s, 32)]);
}

function padOrTrim(buf: Buffer, len: number): Buffer {
  let start = 0;
  while (start < buf.length - 1 && buf[start] === 0x00) start++;
  const stripped = buf.subarray(start);
  if (stripped.length === len) return Buffer.from(stripped);
  const out = Buffer.alloc(len, 0);
  stripped.copy(out, len - stripped.length);
  return out;
}

// ---------------------------------------------------------------------------
// HTTPS request helper
// ---------------------------------------------------------------------------

function httpsPost(
  url: string,
  headers: Record<string, string>,
  body: string
): Promise<{ statusCode: number; body: string }> {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const options: https.RequestOptions = {
      hostname: parsed.hostname,
      port: parsed.port ? parseInt(parsed.port, 10) : 443,
      path: parsed.pathname + parsed.search,
      method: "POST",
      headers: {
        ...headers,
        "content-length": Buffer.byteLength(body).toString(),
      },
    };

    const req = https.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on("data", (chunk: Buffer) => chunks.push(chunk));
      res.on("end", () => {
        resolve({
          statusCode: res.statusCode ?? 0,
          body: Buffer.concat(chunks).toString("utf8"),
        });
      });
    });

    req.on("error", reject);
    req.write(body);
    req.end();
  });
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

/**
 * Creates a SendApnPushFn that authenticates with Apple's APN servers using
 * token-based authentication (ES256 JWT) and sends an empty pass-update push.
 *
 * Credentials are read from:
 *   config.apnKeyId     || APPLE_APN_KEY_ID     env var
 *   config.apnTeamId    || APPLE_APN_TEAM_ID    env var
 *   config.apnPrivateKey || APPLE_APN_KEY_BASE64 env var (base64-encoded PEM)
 */
export function createApnPushClient(config: ApnClientConfig): SendApnPushFn {
  const keyId =
    config.apnKeyId ?? process.env["APPLE_APN_KEY_ID"] ?? "";
  const teamId =
    config.apnTeamId ?? process.env["APPLE_APN_TEAM_ID"] ?? "";
  const rawKey =
    config.apnPrivateKey ?? process.env["APPLE_APN_KEY_BASE64"] ?? "";

  // Accept both raw PEM and base64-encoded PEM
  const privateKeyPem = rawKey.startsWith("-----BEGIN")
    ? rawKey
    : Buffer.from(rawKey, "base64").toString("utf8");

  const apnHost =
    config.environment === "production"
      ? "https://api.push.apple.com"
      : "https://api.sandbox.push.apple.com";

  return async function sendApnPush(
    deviceToken: string,
    passTypeIdentifier: string
  ): Promise<ApnPushResult> {
    try {
      const jwt = buildJwt(keyId, teamId, privateKeyPem);
      const url = `${apnHost}/3/device/${deviceToken}`;
      const result = await httpsPost(
        url,
        {
          authorization: `bearer ${jwt}`,
          "apns-topic": passTypeIdentifier,
          "apns-push-type": "background",
          "content-type": "application/json",
        },
        "{}"
      );

      const success = result.statusCode >= 200 && result.statusCode < 300;
      return {
        deviceToken,
        success,
        statusCode: result.statusCode,
        error: success ? undefined : result.body || `HTTP ${result.statusCode}`,
      };
    } catch (err) {
      return {
        deviceToken,
        success: false,
        error: err instanceof Error ? err.message : String(err),
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Batch push
// ---------------------------------------------------------------------------

/**
 * Sends APN push notifications to multiple device tokens concurrently.
 *
 * - Each push is attempted independently; a failure on one device does not
 *   abort the others.
 * - Returns aggregate counts and per-device results.
 */
export async function sendBatchApnPush(
  deviceTokens: string[],
  passTypeIdentifier: string,
  sendFn: SendApnPushFn
): Promise<{ sent: number; failed: number; results: ApnPushResult[] }> {
  if (deviceTokens.length === 0) {
    return { sent: 0, failed: 0, results: [] };
  }

  const results = await Promise.all(
    deviceTokens.map((token) => sendFn(token, passTypeIdentifier))
  );

  const sent = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  return { sent, failed, results };
}
