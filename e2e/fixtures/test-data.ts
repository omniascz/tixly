/**
 * Test data fixtures for E2E smoke tests.
 * All data uses staging-safe values (GoPay sandbox payment method).
 */

export const PROMOTER_ID = process.env.TEST_PROMOTER_ID ?? 'test-promoter-uuid-staging';

export function createEventPayload(suffix = Date.now()) {
  const startsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  const endsAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000 + 3 * 60 * 60 * 1000).toISOString();

  return {
    title: `Smoke Test Event ${suffix}`,
    description: 'Automated smoke test event — do not purchase',
    promoterId: PROMOTER_ID,
    venue: {
      name: 'Testovací Hala',
      city: 'Praha',
      address: 'Testovací 1, 110 00 Praha',
    },
    startsAt,
    endsAt,
    capacity: 10,
    ticketTypes: [
      {
        name: 'Standardní vstupenka',
        price: 100_00, // 100 Kč in haléře
        capacity: 10,
      },
    ],
  };
}

export const GOPAY_SANDBOX_CARD = {
  number: '4123456789012346',
  expiry: '12/30',
  cvv: '123',
};

export function createOrderPayload(eventId: string, ticketTypeId: string) {
  return {
    eventId,
    items: [
      {
        ticketTypeId,
        quantity: 1,
      },
    ],
    buyer: {
      email: `smoke-test-${Date.now()}@test.tixly.cz`,
      firstName: 'Smoke',
      lastName: 'Test',
    },
    paymentMethod: 'gopay_sandbox',
    returnUrl: `${process.env.BASE_URL ?? 'http://localhost:3000'}/order/callback`,
    notifyUrl: `${process.env.BASE_URL ?? 'http://localhost:3000'}/api/gopay/webhook`,
  };
}
