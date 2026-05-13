/**
 * Seed data service — populates a sandbox tenant with deterministic test data
 * so developers can exercise API flows immediately after creating their tenant.
 *
 * Seeds include: sample events, tickets, users, orders, and a test API key.
 */
import type { SandboxDB } from './tenant.service.js';

export interface SeedResult {
  tenantId: string;
  eventsCreated: number;
  ticketsCreated: number;
  usersCreated: number;
  ordersCreated: number;
  apiKey: string;
}

export interface SeedScenario {
  name: string;
  description: string;
  eventCount: number;
  ticketsPerEvent: number;
  userCount: number;
  orderCount: number;
}

export const SCENARIOS: Record<string, SeedScenario> = {
  minimal: {
    name: 'minimal',
    description: 'Jedna akce s 10 vstupenkami, 2 uživatelé, 1 objednávka.',
    eventCount: 1, ticketsPerEvent: 10, userCount: 2, orderCount: 1,
  },
  standard: {
    name: 'standard',
    description: '5 akcí, každá se 100 vstupenkami, 20 uživatelů, 15 objednávek.',
    eventCount: 5, ticketsPerEvent: 100, userCount: 20, orderCount: 15,
  },
  stress: {
    name: 'stress',
    description: 'Velký dataset: 20 akcí × 500 vstupenek, 200 uživatelů, 300 objednávek.',
    eventCount: 20, ticketsPerEvent: 500, userCount: 200, orderCount: 300,
  },
};

// ---------------------------------------------------------------------------
// Main seed function
// ---------------------------------------------------------------------------

export async function seedTenant(
  tenantId: string,
  scenarioName: string,
  db: SandboxDB,
): Promise<SeedResult> {
  const scenario = SCENARIOS[scenarioName];
  if (!scenario) {
    throw new Error(`Unknown scenario: ${scenarioName}. Available: ${Object.keys(SCENARIOS).join(', ')}`);
  }

  // 1. Create events
  const eventIds: string[] = [];
  for (let i = 0; i < scenario.eventCount; i++) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO sandbox.seeded_events (tenant_id, name, venue, starts_at, price_hellers)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [tenantId, `Test Event ${i + 1}`, `Sandbox Venue ${i + 1}`,
       new Date(Date.now() + (i + 1) * 7 * 86400000).toISOString(),
       50000 + i * 10000],
    );
    eventIds.push(rows[0].id);
  }

  // 2. Create tickets
  let ticketsCreated = 0;
  for (const eventId of eventIds) {
    for (let j = 0; j < scenario.ticketsPerEvent; j++) {
      await db.execute(
        `INSERT INTO sandbox.seeded_tickets (tenant_id, event_id, seat_label, status)
         VALUES ($1, $2, $3, 'available')`,
        [tenantId, eventId, `A${j + 1}`],
      );
      ticketsCreated++;
    }
  }

  // 3. Create users
  const userIds: string[] = [];
  for (let i = 0; i < scenario.userCount; i++) {
    const { rows } = await db.query<{ id: string }>(
      `INSERT INTO sandbox.seeded_users (tenant_id, email, name)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [tenantId, `test${i + 1}@sandbox.example`, `Test User ${i + 1}`],
    );
    userIds.push(rows[0].id);
  }

  // 4. Create orders
  let ordersCreated = 0;
  for (let i = 0; i < scenario.orderCount && i < userIds.length * eventIds.length; i++) {
    const userId = userIds[i % userIds.length];
    const eventId = eventIds[i % eventIds.length];
    await db.execute(
      `INSERT INTO sandbox.seeded_orders (tenant_id, user_id, event_id, total_hellers, status)
       VALUES ($1, $2, $3, $4, 'paid')`,
      [tenantId, userId, eventId, 50000 + i * 1000],
    );
    ordersCreated++;
  }

  // 5. Generate API key
  const apiKey = 'sbx_api_' + Math.random().toString(36).slice(2) + Date.now().toString(36);
  await db.execute(
    `INSERT INTO sandbox.seeded_api_keys (tenant_id, api_key) VALUES ($1, $2)`,
    [tenantId, apiKey],
  );

  return {
    tenantId,
    eventsCreated: eventIds.length,
    ticketsCreated,
    usersCreated: userIds.length,
    ordersCreated,
    apiKey,
  };
}

// ---------------------------------------------------------------------------
// Reset — wipe all seeded data for a tenant
// ---------------------------------------------------------------------------

export async function resetTenant(tenantId: string, db: SandboxDB): Promise<void> {
  await db.execute(`DELETE FROM sandbox.seeded_orders WHERE tenant_id = $1`, [tenantId]);
  await db.execute(`DELETE FROM sandbox.seeded_tickets WHERE tenant_id = $1`, [tenantId]);
  await db.execute(`DELETE FROM sandbox.seeded_events WHERE tenant_id = $1`, [tenantId]);
  await db.execute(`DELETE FROM sandbox.seeded_users WHERE tenant_id = $1`, [tenantId]);
  await db.execute(`DELETE FROM sandbox.seeded_api_keys WHERE tenant_id = $1`, [tenantId]);
}

export function listScenarios(): SeedScenario[] {
  return Object.values(SCENARIOS);
}
