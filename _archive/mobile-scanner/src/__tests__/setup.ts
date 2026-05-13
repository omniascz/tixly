// ---------------------------------------------------------------------------
// Global test setup
// Ensure globalThis.crypto is available (Node 19+ provides it; Node 18 needs
// the WebCrypto polyfill). Vitest runs in Node, so we wire it up here.
// ---------------------------------------------------------------------------
import { webcrypto } from "crypto";

if (!globalThis.crypto) {
  // @ts-expect-error — assign WebCrypto to global
  globalThis.crypto = webcrypto;
}

// Polyfill btoa / atob for Node < 20
if (typeof globalThis.btoa === "undefined") {
  globalThis.btoa = (str: string) => Buffer.from(str, "binary").toString("base64");
  globalThis.atob = (b64: string) => Buffer.from(b64, "base64").toString("binary");
}
