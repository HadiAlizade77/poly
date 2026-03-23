import { PrismaClient, Prisma } from '@prisma/client';

export const prisma = new PrismaClient();

/**
 * Truncate all test tables atomically using TRUNCATE CASCADE.
 * This handles the circular FK between orders ↔ ai_decisions and all other
 * FK relationships correctly, regardless of table order.
 * Call in beforeEach of each DB integration test file to ensure isolation.
 */
export async function cleanDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      trades, position_history, positions, risk_events,
      orders, ai_decisions, context_scores, market_snapshots,
      markets, bankroll_history, bankroll, system_config,
      risk_config, scorer_configs, alerts, trade_feedback,
      ai_reviews, external_data_points, audit_log
    RESTART IDENTITY CASCADE
  `);
}

/** Build a minimal valid Market create input. */
export function marketInput(
  overrides: Partial<Prisma.MarketCreateInput> = {},
): Prisma.MarketCreateInput {
  const uid = Math.random().toString(36).slice(2, 9);
  return {
    polymarket_id: `pm-${uid}`,
    title: `Test Market ${uid}`,
    category: 'crypto',
    outcomes: [
      { name: 'Yes', token_id: `yes-${uid}` },
      { name: 'No', token_id: `no-${uid}` },
    ],
    ...overrides,
  };
}

/** Assert the given async function throws a Prisma unique-constraint error (P2002). */
export async function expectUniqueViolation(fn: () => Promise<unknown>): Promise<void> {
  await expect(fn()).rejects.toMatchObject({
    code: 'P2002',
  });
}

/** Assert the given async function throws a Prisma FK / not-found error (P2003 or P2025). */
export async function expectFkViolation(fn: () => Promise<unknown>): Promise<void> {
  await expect(fn()).rejects.toSatisfy(
    (e: unknown) =>
      e instanceof Prisma.PrismaClientKnownRequestError &&
      ['P2003', 'P2025'].includes(e.code),
  );
}

export { Prisma };
