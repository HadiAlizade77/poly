import request from 'supertest';
import { PrismaClient } from '@prisma/client';
import { createTestApp } from '../setup.js';
export { cleanDatabase } from '../db/db-helpers.js';

export const app = createTestApp();
export const prisma = new PrismaClient();
export const uid = () => Math.random().toString(36).slice(2, 9);

/** Get a JWT token using the default admin password. */
let _cachedToken: string | null = null;
export async function getAuthToken(): Promise<string> {
  if (_cachedToken) return _cachedToken;
  const res = await request(app).post('/api/auth/login').send({ password: 'changeme' });
  if (res.status !== 200) throw new Error(`Login failed: ${JSON.stringify(res.body)}`);
  _cachedToken = res.body.data.token as string;
  return _cachedToken;
}

/** Build a minimal Market create input. */
export function mkMarketInput(pmId: string, overrides: Record<string, unknown> = {}) {
  return {
    polymarket_id: pmId,
    title: `Test Market ${pmId}`,
    category: 'crypto',
    outcomes: { Yes: 0.65, No: 0.35 },
    current_prices: { Yes: 0.65, No: 0.35 },
    ...overrides,
  };
}

/** Delete markets created during a test run (matched by polymarket_id prefix). */
export async function deleteTestMarkets(prefix: string) {
  const markets = await prisma.market.findMany({
    where: { polymarket_id: { startsWith: prefix } },
    select: { id: true },
  });
  if (markets.length === 0) return;
  const ids = markets.map((m) => m.id);
  await prisma.position.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.contextScore.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.aiDecision.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.order.deleteMany({ where: { market_id: { in: ids } } });
  await prisma.market.deleteMany({ where: { id: { in: ids } } });
}
