import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as PositionService from '../../../src/services/position.service.js';
import { UniqueConstraintError, NotFoundError } from '../../../src/services/errors.js';
import { prisma, uid, mkMarketInput, deleteTestMarkets, cleanDatabase } from './helpers.js';

const PREFIX = 'test-pos-svc-';

let marketId: string;
let market2Id: string;

beforeAll(async () => {
  await cleanDatabase();
  const [m1, m2] = await Promise.all([
    prisma.market.create({ data: mkMarketInput(`${PREFIX}m1-${uid()}`) }),
    prisma.market.create({ data: mkMarketInput(`${PREFIX}m2-${uid()}`) }),
  ]);
  marketId = m1.id;
  market2Id = m2.id;
});

afterAll(async () => {
  await deleteTestMarkets(PREFIX);
  await prisma.$disconnect();
});

function posInput(mId: string, token = 'yes-token', overrides = {}) {
  return {
    market_id: mId,
    outcome_token: token,
    side: 'long' as const,
    size: 100,
    avg_entry_price: 0.65,
    ...overrides,
  };
}

// ─── create ──────────────────────────────────────────────────────────────────

describe('PositionService.create', () => {
  it('creates a long position with defaults', async () => {
    const p = await PositionService.create(posInput(marketId, `yes-${uid()}`));

    expect(p.id).toBeTruthy();
    expect(p.market_id).toBe(marketId);
    expect(p.side).toBe('long');
    expect(p.exit_strategy).toBe('resolution_only');
    expect(Number(p.realized_pnl)).toBe(0);
    expect(Number(p.total_fees)).toBe(0);
  });

  it('throws UniqueConstraintError for duplicate (market_id, outcome_token)', async () => {
    const token = `dup-token-${uid()}`;
    await PositionService.create(posInput(marketId, token));

    await expect(
      PositionService.create(posInput(marketId, token)),
    ).rejects.toBeInstanceOf(UniqueConstraintError);
  });
});

// ─── findOpen / findAll ───────────────────────────────────────────────────────

describe('PositionService.findOpen', () => {
  it('returns all current open positions', async () => {
    await PositionService.create(posInput(marketId, `open-${uid()}`));

    const positions = await PositionService.findOpen();
    expect(Array.isArray(positions)).toBe(true);
    expect(positions.length).toBeGreaterThanOrEqual(1);
  });
});

// ─── findByMarket ─────────────────────────────────────────────────────────────

describe('PositionService.findByMarket', () => {
  it('returns only positions for the given market', async () => {
    await PositionService.create(posInput(marketId, `m1a-${uid()}`));
    await PositionService.create(posInput(market2Id, `m2a-${uid()}`));

    const m1Positions = await PositionService.findByMarket(marketId);
    expect(m1Positions.every((p) => p.market_id === marketId)).toBe(true);
  });

  it('returns empty array for market with no positions', async () => {
    const emptyMarket = await prisma.market.create({
      data: mkMarketInput(`${PREFIX}empty-${uid()}`),
    });
    const positions = await PositionService.findByMarket(emptyMarket.id);
    expect(positions).toHaveLength(0);
  });
});

// ─── findByMarketAndToken ─────────────────────────────────────────────────────

describe('PositionService.findByMarketAndToken', () => {
  it('returns position for known market+token pair', async () => {
    const token = `find-tok-${uid()}`;
    await PositionService.create(posInput(marketId, token));

    const found = await PositionService.findByMarketAndToken(marketId, token);
    expect(found).not.toBeNull();
    expect(found!.outcome_token).toBe(token);
  });

  it('returns null for unknown pair', async () => {
    const result = await PositionService.findByMarketAndToken(marketId, 'ghost-token-xyz');
    expect(result).toBeNull();
  });
});

// ─── updatePrice ──────────────────────────────────────────────────────────────

describe('PositionService.updatePrice', () => {
  it('updates current_price and unrealized_pnl', async () => {
    const token = `price-tok-${uid()}`;
    const pos = await PositionService.create(posInput(marketId, token));

    const updated = await PositionService.updatePrice(pos.id, '0.72', '7.00');

    expect(Number(updated.current_price)).toBeCloseTo(0.72);
    expect(Number(updated.unrealized_pnl)).toBeCloseTo(7.0);
  });
});

// ─── upsert ───────────────────────────────────────────────────────────────────

describe('PositionService.upsert', () => {
  it('creates on first call, updates on second', async () => {
    const token = `ups-tok-${uid()}`;

    const first = await PositionService.upsert(
      marketId,
      token,
      posInput(marketId, token),
      { size: 200 },
    );
    expect(Number(first.size)).toBe(100); // created with size=100

    const second = await PositionService.upsert(
      marketId,
      token,
      posInput(marketId, token),
      { size: 200 },
    );
    expect(Number(second.size)).toBe(200); // updated to 200

    const count = await prisma.position.count({
      where: { market_id: marketId, outcome_token: token },
    });
    expect(count).toBe(1);
  });
});

// ─── setExitStrategy ──────────────────────────────────────────────────────────

describe('PositionService.setExitStrategy', () => {
  it('sets stop_loss strategy with price', async () => {
    const token = `exit-tok-${uid()}`;
    const pos = await PositionService.create(posInput(marketId, token));

    const updated = await PositionService.setExitStrategy(pos.id, 'stop_loss', '0.50');

    expect(updated.exit_strategy).toBe('stop_loss');
    expect(Number(updated.stop_loss_price)).toBeCloseTo(0.50);
  });

  it('sets time_based strategy with exit time', async () => {
    const token = `time-tok-${uid()}`;
    const pos = await PositionService.create(posInput(marketId, token));
    const exitAt = new Date('2026-12-31T23:59:59Z');

    const updated = await PositionService.setExitStrategy(pos.id, 'time_based', undefined, exitAt);

    expect(updated.exit_strategy).toBe('time_based');
    expect(updated.time_exit_at).toBeInstanceOf(Date);
  });

  it('throws NotFoundError for unknown position id', async () => {
    await expect(
      PositionService.setExitStrategy('00000000-0000-0000-0000-000000000000', 'manual'),
    ).rejects.toBeInstanceOf(NotFoundError);
  });
});
