// Stub for @tixly/crypto
// Used by Vitest alias so ticket-issuer.ts can be transformed.
// Tests override this via vi.mock('@tixly/crypto', ...).

export interface EncryptedSecret {
  encrypted: Buffer;
  iv: Buffer;
}

export async function encryptSecret(_secret: Buffer, _ticketId: string): Promise<EncryptedSecret> {
  throw new Error('@tixly/crypto stub: replace with vi.mock in tests');
}

export async function decryptSecret(_encryptedWithTag: Buffer, _iv: Buffer, _ticketId: string): Promise<Buffer> {
  throw new Error('@tixly/crypto stub: replace with vi.mock in tests');
}
