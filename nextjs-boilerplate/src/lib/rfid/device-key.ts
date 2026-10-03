import { randomBytes } from 'crypto';

/**
 * Vygeneruje unikátní API klíč pro RFID čtečku.
 *
 * Funkce dřív žila jako export přímo v app/api/rfid/scan/route.ts. Next.js
 * z route souborů povoluje jen předepsané exporty (HTTP metody, `dynamic`,
 * `revalidate` a spol.), takže na ni `tsc` hlásil chybu v generovaných typech
 * — build ji nezachytil jen proto, že má vypnutou validaci typů.
 */
export function generateRfidDeviceKey(): string {
  return `tixly_rfid_${randomBytes(24).toString('hex')}`;
}
