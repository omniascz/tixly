// Stub for @tixly/pdf-ticket/services/ticket-email.service.js
// Used by Vitest alias so order-completed/route.ts can be transformed.
// Tests override this via vi.mock('@tixly/pdf-ticket/services/ticket-email.service.js', ...).

export async function sendTicketConfirmationEmail(..._args: unknown[]): Promise<{ sent: boolean }> {
  throw new Error('@tixly/pdf-ticket stub: replace with vi.mock in tests');
}
