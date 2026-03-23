/**
 * Unit tests for RiskGovernor.
 *
 * External dependencies are mocked so no DB or network is needed:
 *   - kill-switch.isActive
 *   - systemConfigService.getValue (→ null = use DEFAULTS)
 *   - prisma.aiDecision.findMany
 *   - riskEventService.create
 */
import { vi, describe, it, expect, beforeEach } from 'vitest';

// ─── Mocks (hoisted before imports) ──────────────────────────────────────────

vi.mock('../../../src/services/risk/kill-switch.js', () => ({
  isActive: vi.fn(),
}));

vi.mock('../../../src/config/database.js', () => ({
  default: {
    aiDecision: {
      findMany: vi.fn(),
    },
  },
}));

vi.mock('../../../src/services/system-config.service.js', () => ({
  getValue: vi.fn(),
}));

vi.mock('../../../src/services/risk-event.service.js', () => ({
  create: vi.fn(),
}));

vi.mock('../../../src/config/logger.js', () => ({
  default: { debug: vi.fn(), warn: vi.fn(), info: vi.fn(), error: vi.fn() },
}));

// ─── Imports (after mocks) ────────────────────────────────────────────────────

import { RiskGovernor, recordMarketTrade, type RiskCheckContext } from '../../../src/services/risk/governor.js';
import { isActive as isKillSwitchActive } from '../../../src/services/risk/kill-switch.js';
import prisma from '../../../src/config/database.js';
import * as riskEventService from '../../../src/services/risk-event.service.js';
import * as systemConfigService from '../../../src/services/system-config.service.js';
import type { Market, Position, Bankroll, MarketSnapshot } from '@prisma/client';
import type { DecisionOutput } from '../../../src/services/ai/decision-maker.js';
import type { ScoredDimensions } from '../../../src/services/decision-engine/scorer.interface.js';

// ─── Factories ─────────────────────────────────────────────────────────────────

let uid = 0;
function nextId() { return `id-${uid++}`; }

function makeMarket(overrides: Record<string, unknown> = {}): Market {
  return {
    id: nextId(),
    polymarket_id: `pm-${nextId()}`,
    title: 'Test Market',
    category: `cat-${nextId()}`,   // unique per call → no trade-rate/cooldown cross-test pollution
    status: 'active',
    is_tradeable: true,
    current_prices: { Yes: 0.65 },
    liquidity: 100_000,
    end_date: null,
    ...overrides,
  } as unknown as Market;
}

function makeDecision(overrides: Record<string, unknown> = {}): DecisionOutput {
  return {
    action: 'hold',
    direction: null,
    outcome_token: null,
    confidence: 0.5,
    size_hint: null,
    fair_value: null,
    estimated_edge: 0.05,     // 5% > 2% default minEdge
    reasoning: 'test decision',
    regime_assessment: null,
    model: 'claude-test',
    latencyMs: 500,           // < 8000ms maxLatency
    tokensUsed: 100,
    promptVersion: '1',
    usedFallback: false,
    fallback: false,
    ...overrides,
  } as unknown as DecisionOutput;
}

function makeBankroll(initial: number, total: number, active: number, deployed: number): Bankroll {
  return {
    id: nextId(),
    initial_deposit: String(initial),
    total_balance: String(total),
    active_balance: String(active),
    deployed_balance: String(deployed),
  } as unknown as Bankroll;
}

function makeSnapshot(
  ts: Date = new Date(),
  spread = 0.05,
  extra: Record<string, unknown> = {},
): MarketSnapshot {
  return {
    id: nextId(),
    market_id: 'market-1',
    timestamp: ts,
    prices: { Yes: 0.65 },
    spread,
    liquidity: 50_000,
    metadata: null,
    ...extra,
  } as unknown as MarketSnapshot;
}

function makeScores(overrides: ScoredDimensions = {}): ScoredDimensions {
  return {
    liquidity_quality: { value: 60, label: 'GOOD', detail: '' },
    ...overrides,
  };
}

/** Build a context that passes all checks by default. */
function makeCleanCtx(overrides: Partial<RiskCheckContext> = {}): RiskCheckContext {
  const market = overrides.market ?? makeMarket();
  return {
    market,
    decision: makeDecision(),
    scores: makeScores(),
    bankroll: makeBankroll(10_000, 9_500, 9_500, 2_000), // 5% drawdown, ~21% exposure
    positions: [] as Position[],
    snapshots: [makeSnapshot()],                           // fresh, spread=5%
    ...overrides,
  };
}

// ─── Test setup ───────────────────────────────────────────────────────────────

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isKillSwitchActive).mockResolvedValue(false);
  vi.mocked(systemConfigService.getValue).mockResolvedValue(null); // use DEFAULTS
  vi.mocked(prisma.aiDecision.findMany).mockResolvedValue([]);
  vi.mocked(riskEventService.create).mockResolvedValue(undefined as never);
});

// ─── Happy path ───────────────────────────────────────────────────────────────

describe('RiskGovernor – approved path', () => {
  it('approves a clean context where all checks pass', async () => {
    const governor = new RiskGovernor();
    const result = await governor.check(makeCleanCtx());
    expect(result.approved).toBe(true);
    expect(result.vetoReason).toBeNull();
    expect(result.triggeredChecks).toHaveLength(0);
  });

  it('does not call riskEventService.create when approved', async () => {
    const governor = new RiskGovernor();
    await governor.check(makeCleanCtx());
    expect(riskEventService.create).not.toHaveBeenCalled();
  });

  it('approved result can have warnings without being vetoed', async () => {
    const governor = new RiskGovernor();
    // Spread 12% triggers warning but not veto (veto threshold is >15%)
    const result = await governor.check(makeCleanCtx({ snapshots: [makeSnapshot(new Date(), 0.12)] }));
    expect(result.approved).toBe(true);
    expect(result.warnings.some((w) => w.includes('spread'))).toBe(true);
  });
});

// ─── Check 1: Kill switch ─────────────────────────────────────────────────────

describe('RiskGovernor – check 1: kill switch', () => {
  it('vetoes immediately when kill switch is active', async () => {
    vi.mocked(isKillSwitchActive).mockResolvedValue(true);
    const governor = new RiskGovernor();
    const result = await governor.check(makeCleanCtx());
    expect(result.approved).toBe(false);
    expect(result.vetoReason).toContain('KILL_SWITCH_ACTIVE');
  });

  it('short-circuits: no further checks run after kill switch', async () => {
    vi.mocked(isKillSwitchActive).mockResolvedValue(true);
    // Bank with critical drawdown — but kill switch should veto first
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ bankroll: makeBankroll(10_000, 0, 0, 0) });
    const result = await governor.check(ctx);
    expect(result.vetoReason).toContain('KILL_SWITCH_ACTIVE');
    expect(result.triggeredChecks).toHaveLength(1);
  });

  it('passes when kill switch is inactive', async () => {
    vi.mocked(isKillSwitchActive).mockResolvedValue(false);
    const governor = new RiskGovernor();
    const result = await governor.check(makeCleanCtx());
    expect(result.approved).toBe(true);
  });
});

// ─── Check 2: Drawdown limit ──────────────────────────────────────────────────

describe('RiskGovernor – check 2: drawdown', () => {
  it('vetoes when drawdown exceeds 20%', async () => {
    const governor = new RiskGovernor();
    // initial=10000, total=7000 → drawdown = 30% > 20%
    const ctx = makeCleanCtx({ bankroll: makeBankroll(10_000, 7_000, 7_000, 1_000) });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.vetoReason).toContain('DRAWDOWN_LIMIT');
  });

  it('passes when drawdown is below 20%', async () => {
    const governor = new RiskGovernor();
    // initial=10000, total=9000 → drawdown = 10% < 20%
    const ctx = makeCleanCtx({ bankroll: makeBankroll(10_000, 9_000, 9_000, 1_000) });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(true);
  });

  it('warns when drawdown exceeds 75% of limit (15%)', async () => {
    const governor = new RiskGovernor();
    // drawdown = 17% → 17/20 = 85% of limit → warning
    const ctx = makeCleanCtx({ bankroll: makeBankroll(10_000, 8_300, 8_300, 1_000) });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(true);
    expect(result.warnings.some((w) => w.includes('Drawdown'))).toBe(true);
  });

  it('does not check drawdown when bankroll is null', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ bankroll: null });
    const result = await governor.check(ctx);
    // Should still pass (other checks may apply, but not drawdown)
    expect(result.triggeredChecks.some((c) => c.includes('DRAWDOWN'))).toBe(false);
  });
});

// ─── Check 3: Exposure limit ──────────────────────────────────────────────────

describe('RiskGovernor – check 3: exposure', () => {
  it('vetoes when exposure exceeds 80%', async () => {
    const governor = new RiskGovernor();
    // active=10000, deployed=9000 → 90% > 80%
    const ctx = makeCleanCtx({ bankroll: makeBankroll(10_000, 10_000, 10_000, 9_000) });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('EXPOSURE_LIMIT'))).toBe(true);
  });

  it('passes when exposure is below 80%', async () => {
    const governor = new RiskGovernor();
    // active=10000, deployed=5000 → 50% < 80%
    const ctx = makeCleanCtx({ bankroll: makeBankroll(10_000, 10_000, 10_000, 5_000) });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(true);
  });
});

// ─── Check 4: Consecutive losses ─────────────────────────────────────────────

describe('RiskGovernor – check 4: consecutive losses', () => {
  it('vetoes when 5+ consecutive vetoed decisions exist', async () => {
    vi.mocked(prisma.aiDecision.findMany).mockResolvedValue(
      Array.from({ length: 5 }, () => ({ action: 'trade', veto_reason: 'some veto' })) as never,
    );
    const governor = new RiskGovernor();
    const result = await governor.check(makeCleanCtx());
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('CONSECUTIVE_LOSSES'))).toBe(true);
  });

  it('passes when fewer than 5 consecutive vetoes', async () => {
    vi.mocked(prisma.aiDecision.findMany).mockResolvedValue(
      [
        { action: 'trade', veto_reason: 'veto' },
        { action: 'trade', veto_reason: 'veto' },
        { action: 'trade', veto_reason: null }, // breaks the streak
        { action: 'trade', veto_reason: 'veto' },
      ] as never,
    );
    const governor = new RiskGovernor();
    const result = await governor.check(makeCleanCtx());
    expect(result.approved).toBe(true);
  });

  it('passes when no prior decisions exist', async () => {
    vi.mocked(prisma.aiDecision.findMany).mockResolvedValue([] as never);
    const governor = new RiskGovernor();
    const result = await governor.check(makeCleanCtx());
    expect(result.approved).toBe(true);
  });
});

// ─── Check 5: Trade rate limit ────────────────────────────────────────────────

describe('RiskGovernor – check 5: trade rate limit', () => {
  it('vetoes when 10+ trades in the last minute for the same category', async () => {
    const category = `rate-test-${nextId()}`;
    const market = makeMarket({ category });
    // Record 10 trades for this category
    for (let i = 0; i < 10; i++) {
      recordMarketTrade(`market-unused-${i}-${nextId()}`, category);
    }
    const governor = new RiskGovernor();
    const result = await governor.check(makeCleanCtx({ market }));
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('TRADE_RATE_LIMIT'))).toBe(true);
  });

  it('passes when trade count is below limit for a fresh category', async () => {
    const category = `fresh-cat-${nextId()}`;
    const market = makeMarket({ category });
    const governor = new RiskGovernor();
    const result = await governor.check(makeCleanCtx({ market }));
    expect(result.approved).toBe(true);
  });
});

// ─── Check 6: Liquidity quality ───────────────────────────────────────────────

describe('RiskGovernor – check 6: liquidity quality', () => {
  it('vetoes when liquidity_quality score < 40', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({
      scores: makeScores({ liquidity_quality: { value: 25, label: 'POOR', detail: '' } }),
    });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('LIQUIDITY_POOR'))).toBe(true);
  });

  it('passes when liquidity_quality score = 40 (at boundary)', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({
      scores: makeScores({ liquidity_quality: { value: 40, label: 'FAIR', detail: '' } }),
    });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(true);
  });

  it('does not veto when liquidity_quality score is absent', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ scores: {} });
    const result = await governor.check(ctx);
    expect(result.triggeredChecks.some((c) => c.includes('LIQUIDITY_POOR'))).toBe(false);
  });
});

// ─── Check 7: Spread quality ──────────────────────────────────────────────────

describe('RiskGovernor – check 7: spread quality', () => {
  it('vetoes when spread > 15%', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ snapshots: [makeSnapshot(new Date(), 0.20)] }); // 20% spread
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('SPREAD_TOO_WIDE'))).toBe(true);
  });

  it('warns (does not veto) when spread is 11–15%', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ snapshots: [makeSnapshot(new Date(), 0.12)] }); // 12%
    const result = await governor.check(ctx);
    expect(result.approved).toBe(true);
    expect(result.warnings.some((w) => w.includes('spread'))).toBe(true);
  });

  it('passes when spread is within acceptable range (< 10%)', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ snapshots: [makeSnapshot(new Date(), 0.05)] }); // 5%
    const result = await governor.check(ctx);
    expect(result.triggeredChecks.some((c) => c.includes('SPREAD'))).toBe(false);
  });
});

// ─── Check 8: AI decision latency ─────────────────────────────────────────────

describe('RiskGovernor – check 8: AI latency', () => {
  it('warns (does not veto) when latency > 8000ms and not using fallback', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({
      decision: makeDecision({ latencyMs: 10_000, usedFallback: false }),
    });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(true);
    expect(result.warnings.some((w) => w.includes('latency'))).toBe(true);
  });

  it('does not warn for high latency when usedFallback=true', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({
      decision: makeDecision({ latencyMs: 10_000, usedFallback: true }),
    });
    const result = await governor.check(ctx);
    expect(result.warnings.some((w) => w.includes('latency'))).toBe(false);
  });

  it('passes without warning when latency is under 8000ms', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ decision: makeDecision({ latencyMs: 500 }) });
    const result = await governor.check(ctx);
    expect(result.warnings.some((w) => w.includes('latency'))).toBe(false);
  });
});

// ─── Check 9: Per-market cooldown ─────────────────────────────────────────────

describe('RiskGovernor – check 9: market cooldown', () => {
  it('vetoes when a trade was recorded on the same market recently', async () => {
    const marketId = `cooldown-mkt-${nextId()}`;
    const category = `cooldown-cat-${nextId()}`;
    recordMarketTrade(marketId, category);

    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ market: makeMarket({ id: marketId, category }) });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('MARKET_COOLDOWN'))).toBe(true);
  });

  it('passes for a fresh market with no prior trades', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ market: makeMarket({ id: `fresh-mkt-${nextId()}` }) });
    const result = await governor.check(ctx);
    expect(result.triggeredChecks.some((c) => c.includes('MARKET_COOLDOWN'))).toBe(false);
  });
});

// ─── Check 10: Minimum edge ───────────────────────────────────────────────────

describe('RiskGovernor – check 10: minimum edge', () => {
  it('vetoes when estimated_edge < 2%', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ decision: makeDecision({ estimated_edge: 0.01 }) }); // 1%
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('INSUFFICIENT_EDGE'))).toBe(true);
  });

  it('passes when estimated_edge = 2% (at boundary)', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ decision: makeDecision({ estimated_edge: 0.02 }) });
    const result = await governor.check(ctx);
    expect(result.triggeredChecks.some((c) => c.includes('INSUFFICIENT_EDGE'))).toBe(false);
  });

  it('passes when estimated_edge is null (no edge estimate)', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({
      decision: makeDecision({ estimated_edge: null, action: 'hold' }),
    });
    const result = await governor.check(ctx);
    expect(result.triggeredChecks.some((c) => c.includes('EDGE'))).toBe(false);
  });

  it('vetoes action=trade with no edge estimate and confidence < 0.65', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({
      decision: makeDecision({
        action: 'trade',
        direction: 'buy',
        estimated_edge: null,
        confidence: 0.60,
        usedFallback: false,
      }),
    });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('NO_EDGE_ESTIMATE'))).toBe(true);
  });

  it('passes action=trade with no edge estimate when confidence >= 0.65', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({
      decision: makeDecision({
        action: 'trade',
        direction: 'buy',
        estimated_edge: null,
        confidence: 0.70,
        usedFallback: false,
      }),
    });
    const result = await governor.check(ctx);
    expect(result.triggeredChecks.some((c) => c.includes('EDGE'))).toBe(false);
  });
});

// ─── Check 11: Data freshness ─────────────────────────────────────────────────

describe('RiskGovernor – check 11: data freshness', () => {
  it('vetoes when no snapshots are present', async () => {
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ snapshots: [] });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('NO_DATA'))).toBe(true);
  });

  it('vetoes when snapshot is older than 10 minutes', async () => {
    const governor = new RiskGovernor();
    const staleTs = new Date(Date.now() - 11 * 60_000); // 11 min ago
    const ctx = makeCleanCtx({ snapshots: [makeSnapshot(staleTs)] });
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('STALE_DATA'))).toBe(true);
  });

  it('passes when snapshot is fresh (within 10 minutes)', async () => {
    const governor = new RiskGovernor();
    const freshTs = new Date(Date.now() - 2 * 60_000); // 2 min ago
    const ctx = makeCleanCtx({ snapshots: [makeSnapshot(freshTs)] });
    const result = await governor.check(ctx);
    expect(result.triggeredChecks.some((c) => c.includes('DATA'))).toBe(false);
  });
});

// ─── Risk event recording ─────────────────────────────────────────────────────

describe('RiskGovernor – risk event recording', () => {
  it('calls riskEventService.create when vetoing', async () => {
    vi.mocked(isKillSwitchActive).mockResolvedValue(true);
    const governor = new RiskGovernor();
    await governor.check(makeCleanCtx());
    expect(riskEventService.create).toHaveBeenCalledTimes(1);
    expect(vi.mocked(riskEventService.create).mock.calls[0][0]).toMatchObject({
      event_type: 'trade_vetoed',
    });
  });

  it('does not call riskEventService.create when approved', async () => {
    const governor = new RiskGovernor();
    await governor.check(makeCleanCtx());
    expect(riskEventService.create).not.toHaveBeenCalled();
  });

  it('still returns a veto result even if riskEventService.create throws', async () => {
    vi.mocked(riskEventService.create).mockRejectedValue(new Error('DB down'));
    const governor = new RiskGovernor();
    const ctx = makeCleanCtx({ snapshots: [] }); // NO_DATA veto
    const result = await governor.check(ctx);
    expect(result.approved).toBe(false);
    expect(result.vetoReason).toContain('NO_DATA');
  });
});

// ─── recordMarketTrade ─────────────────────────────────────────────────────────

describe('recordMarketTrade', () => {
  it('is exported and callable without errors', () => {
    expect(() => recordMarketTrade(`export-mkt-${nextId()}`, `export-cat-${nextId()}`)).not.toThrow();
  });
});
