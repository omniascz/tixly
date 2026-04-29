/**
 * Kafka consumer for `ticket.totp_rotated` events.
 *
 * This is a pure handler — wiring to an actual Kafka client
 * (kafkajs / redpanda) lives in the platform bootstrap and is out of scope.
 *
 * Event shape:
 *   { ticketId: string, rotatedAt: string (ISO) }
 */

import type { WalletService } from "./wallet.service.js";

export interface TotpRotatedEvent {
  ticketId: string;
  rotatedAt: string;
}

export async function handleTotpRotatedEvent(
  event: TotpRotatedEvent,
  walletService: WalletService,
): Promise<{ apple: { ok: boolean }; google: { ok: boolean } }> {
  const result = await walletService.pushTotpRotationUpdate(event.ticketId);
  return {
    apple: { ok: result.apple.ok },
    google: { ok: result.google.ok },
  };
}
