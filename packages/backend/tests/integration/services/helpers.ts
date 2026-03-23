/**
 * Shared helpers for service-layer integration tests.
 *
 * CLEANUP STRATEGY: every test file uses a unique TEST prefix so it can
 * delete only its own records in afterAll without touching seed data.
 */
import { PrismaClient } from '@prisma/client';
export { cleanDatabase } from '../db/db-helpers.js';

export const prisma = new PrismaClient();

/** Generate a unique suffix for polymarket_ids / config keys to avoid conflicts. */
export const uid = () => Math.random().toString(36).slice(2, 9);

/** Minimal valid market create payload. */
export function mkMarketInput(pmId: string, overrides = {}) {
  return {
    polymarket_id: pmId,
    title: `Test Market ${pmId}`,
    category: 'crypto' as const,
    outcomes: [
      { name: 'Yes', token_id: `yes-${pmId}` },
      { name: 'No', token_id: `no-${pmId}` },
    ],
    ...overrides,
  };
}

/** Delete test markets whose polymarket_id starts with the given prefix (cascades via FK). */
export async function deleteTestMarkets(prefix: string) {
  // Delete child rows first to satisfy FK constraints
  const markets = await prisma.market.findMany({
    where: { polymarket_id: { startsWith: prefix } },
    select: { id: true },
  });
  const ids = markets.map((m) => m.id);
  if (ids.length === 0) return;

  await prisma.trade.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.positionHistory.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.position.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.riskEvent.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.order.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.aiDecision.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.contextScore.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.marketSnapshot.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.market.deleteMany({ where: { id: { in: ids } } });
}
