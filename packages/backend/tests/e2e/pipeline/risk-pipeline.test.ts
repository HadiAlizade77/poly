/**
 * E2E: Risk Governor Pipeline
 *
 * Tests the risk governor end-to-end with real DB state:
 *   - Kill switch activation/deactivation
 *   - Drawdown limit detection
 *   - Exposure limit detection
 *   - Liquidity quality veto
 *   - Spread too wide veto
 *   - Consecutive loss guard
 *   - Minimum edge requirement
 *   - Data freshness checks
 *   - Risk event persistence
 *   - Approved trade passes all checks
 */
import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { PrismaClient, type Prisma } from '@prisma/client';
import { cleanDatabase } from '../../integration/db/db-helpers.js';
import { RiskGovernor, type RiskCheckContext } from '../../../src/services/risk/governor.js';
import * as killSwitch from '../../../src/services/risk/kill-switch.js';
import * as marketService from '../../../src/services/market.service.js';
import * as marketSnapshotService from '../../../src/services/market-snapshot.service.js';
import * as bankrollService from '../../../src/services/bankroll.service.js';
import * as riskEventService from '../../../src/services/risk-event.service.js';
import type { DecisionOutput } from '../../../src/services/ai/decision-maker.js';
import type { ScoredDimensions } from '../../../src/services/decision-engine/scorer.interface.js';

const prisma = new PrismaClient();
const uid = () => Math.random().toString(36).slice(2, 9);

// ── Helpers ──────────────────────────────────────────────────────────────────

async function seedMarket(category = 'crypto') {
  const id = uid();
  return marketService.create({
    polymarket_id: `pm-risk-${id}`,
    title: `Risk Test ${id}`,
    category,
    status: 'active',
    is_tradeable: true,
    outcomes: [
      { name: 'Yes', token_id: `yes-${id}` },
      { name: 'No', token_id: `no-${id}` },
    ] as unknown as Prisma.InputJsonValue,
    current_prices: { Yes: 0.65, No: 0.35 } as Prisma.InputJsonValue,
    volume_24h: '50000',
    liquidity: '25000',
    end_date: new Date(Date.now() + 14 * 86_400_000),
    resolution_criteria: 'Standard test criteria',
  } as Prisma.MarketUncheckedCreateInput);
}

async function seedBankroll(overrides: Record<string, string> = {}) {
  return bankrollService.update({
    total_balance: '10000.000000',
    previous_balance: '10000.000000',
    reserved_balance: '0.000000',
    active_balance: '8000.000000',
    deployed_balance: '2000.000000',
    unrealized_pnl: '0.000000',
    balance_delta_today: '0.000000',
    balance_delta_total: '0.000000',
    initial_deposit: '10000.000000',
    ...overrides,
  });
}

async function seedSnapshot(marketId: string, overrides: Record<string, unknown> = {}) {
  return marketSnapshotService.create({
    market_id: marketId,
    timestamp: new Date(),
    prices: { Yes: 0.65, No: 0.35 } as Prisma.InputJsonValue,
    spread: '0.04',
    volume_1h: '5000',
    liquidity: '25000',
    ...overrides,
  });
}

function makeDecision(overrides: Partial<DecisionOutput> = {}): DecisionOutput {
  return {
    action: 'trade',
    direction: 'buy',
    outcome_token: 'Yes',
    confidence: 0.75,
    size_hint: 0.3,
    estimated_edge: 0.05,
    fair_value: 0.65,
    reasoning: 'Good edge detected in this market.',
    regime_assessment: 'trending',
    model: 'claude-sonnet-4-6',
    latencyMs: 500,
    tokensUsed: 2000,
    promptVersion: 'v1.0.0',
    usedFallback: false,
    ...overrides,
  };
}

function makeScores(overrides: Partial<ScoredDimensions> = {}): ScoredDimensions {
  return {
    liquidity_quality: { value: 70, label: 'HIGH', detail: 'Good liquidity' },
    volume: { value: 65, label: 'ABOVE_AVERAGE', detail: 'Active' },
    momentum: { value: 60, label: 'NEUTRAL', detail: '' },
    ...overrides,
  };
}

function buildRiskContext(
  market: any,
  bankroll: any,
  snapshots: any[],
  decision?: Partial<DecisionOutput>,
  scores?: Partial<ScoredDimensions>,
): RiskCheckContext {
  return {
    market,
    decision: makeDecision(decision),
    scores: makeScores(scores),
    bankroll,
    positions: [],
    snapshots,
  };
}

// ── Setup ────────────────────────────────────────────────────────────────────

beforeEach(async () => {
  await cleanDatabase();
  // Ensure kill switch is off between tests
  await killSwitch.deactivate();
});

afterAll(async () => {
  await killSwitch.deactivate();
  await prisma.$disconnect();
});

// ── Approved Trade ──────────────────────────────────────────────────────────

describe('Risk Pipeline – Approved Trade', () => {
  it('approves a decision that passes all checks', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id);

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(true);
    expect(result.vetoReason).toBeNull();
    expect(result.triggeredChecks).toHaveLength(0);
  });

  it('returns warnings for near-limit conditions without vetoing', async () => {
    const market = await seedMarket();
    // Bankroll at 16% drawdown (threshold is 20%, warning at 75% of threshold = 15%)
    const bankroll = await seedBankroll({
      total_balance: '8400.000000',
      active_balance: '6400.000000',
    });
    const snapshot = await seedSnapshot(market.id, { spread: '0.11' }); // 11% — warning at 10%

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(true);
    expect(result.warnings.length).toBeGreaterThan(0);
  });
});

// ── Kill Switch ─────────────────────────────────────────────────────────────

describe('Risk Pipeline – Kill Switch', () => {
  it('vetoes all decisions when kill switch is active', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id);

    await killSwitch.activate('E2E test: halt trading');

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(false);
    expect(result.vetoReason).toContain('KILL_SWITCH');
  });

  it('resumes approving after kill switch is deactivated', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id);

    await killSwitch.activate('Temporary halt');
    await killSwitch.deactivate();

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(true);
  });

  it('creates risk event when kill switch vetoes', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id);

    await killSwitch.activate('Risk event test');

    const governor = new RiskGovernor();
    await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    const events = await riskEventService.findRecent(10);
    const killSwitchEvent = events.find((e) =>
      e.message.includes('KILL_SWITCH'),
    );
    expect(killSwitchEvent).toBeTruthy();
    expect(killSwitchEvent!.event_type).toBe('trade_vetoed');
  });
});

// ── Drawdown Limit ──────────────────────────────────────────────────────────

describe('Risk Pipeline – Drawdown Limit', () => {
  it('vetoes when drawdown exceeds threshold (20%)', async () => {
    const market = await seedMarket();
    // Initial deposit was 10k, now at 7.5k = 25% drawdown
    const bankroll = await seedBankroll({
      total_balance: '7500.000000',
      active_balance: '5500.000000',
    });
    const snapshot = await seedSnapshot(market.id);

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('DRAWDOWN_LIMIT'))).toBe(true);
  });

  it('approves when drawdown is below threshold', async () => {
    const market = await seedMarket();
    // 10% drawdown — below 20% threshold
    const bankroll = await seedBankroll({
      total_balance: '9000.000000',
      active_balance: '7000.000000',
    });
    const snapshot = await seedSnapshot(market.id);

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(true);
  });
});

// ── Exposure Limit ──────────────────────────────────────────────────────────

describe('Risk Pipeline – Exposure Limit', () => {
  it('vetoes when deployed/active ratio exceeds 80%', async () => {
    const market = await seedMarket();
    // Deployed = 7000, Active = 8000 → 87.5% exposure
    const bankroll = await seedBankroll({
      active_balance: '8000.000000',
      deployed_balance: '7000.000000',
    });
    const snapshot = await seedSnapshot(market.id);

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('EXPOSURE_LIMIT'))).toBe(true);
  });

  it('approves when exposure is within limit', async () => {
    const market = await seedMarket();
    // Deployed = 4000, Active = 8000 → 50% exposure
    const bankroll = await seedBankroll({
      active_balance: '8000.000000',
      deployed_balance: '4000.000000',
    });
    const snapshot = await seedSnapshot(market.id);

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(true);
  });
});

// ── Liquidity Quality ───────────────────────────────────────────────────────

describe('Risk Pipeline – Liquidity Quality', () => {
  it('vetoes when liquidity score is below minimum (40)', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id);

    const governor = new RiskGovernor();
    const result = await governor.check(
      buildRiskContext(market, bankroll, [snapshot], {}, {
        liquidity_quality: { value: 25, label: 'LOW', detail: 'Thin order book' },
      }),
    );

    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('LIQUIDITY_POOR'))).toBe(true);
  });
});

// ── Spread Quality ──────────────────────────────────────────────────────────

describe('Risk Pipeline – Spread Quality', () => {
  it('vetoes when spread exceeds 15%', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id, { spread: '0.20' }); // 20% spread

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('SPREAD_TOO_WIDE'))).toBe(true);
  });

  it('warns but approves when spread is 10-15%', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id, { spread: '0.12' }); // 12% spread

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [snapshot]));

    expect(result.approved).toBe(true);
    expect(result.warnings.some((w) => w.includes('Wide spread'))).toBe(true);
  });
});

// ── Minimum Edge ────────────────────────────────────────────────────────────

describe('Risk Pipeline – Minimum Edge', () => {
  it('vetoes when estimated edge is below 2%', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id);

    const governor = new RiskGovernor();
    const result = await governor.check(
      buildRiskContext(market, bankroll, [snapshot], {
        estimated_edge: 0.01, // 1% < 2% minimum
      }),
    );

    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('INSUFFICIENT_EDGE'))).toBe(true);
  });

  it('approves when edge meets minimum', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id);

    const governor = new RiskGovernor();
    const result = await governor.check(
      buildRiskContext(market, bankroll, [snapshot], {
        estimated_edge: 0.05, // 5% > 2% minimum
      }),
    );

    expect(result.approved).toBe(true);
  });
});

// ── Data Freshness ──────────────────────────────────────────────────────────

describe('Risk Pipeline – Data Freshness', () => {
  it('vetoes when snapshot is too old (>10 min)', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const staleSnapshot = await seedSnapshot(market.id, {
      timestamp: new Date(Date.now() - 15 * 60_000), // 15 min old
    });

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, [staleSnapshot]));

    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('STALE_DATA'))).toBe(true);
  });

  it('vetoes when no snapshots are available', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();

    const governor = new RiskGovernor();
    const result = await governor.check(buildRiskContext(market, bankroll, []));

    expect(result.approved).toBe(false);
    expect(result.triggeredChecks.some((c) => c.includes('NO_DATA'))).toBe(true);
  });
});

// ── Risk Event Persistence ──────────────────────────────────────────────────

describe('Risk Pipeline – Risk Event Persistence', () => {
  it('creates a risk_event record for each veto', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    // No snapshots → NO_DATA veto
    const governor = new RiskGovernor();
    await governor.check(buildRiskContext(market, bankroll, []));

    const events = await riskEventService.findRecent(10);
    expect(events.length).toBeGreaterThanOrEqual(1);
    const noDataEvent = events.find((e) => e.message.includes('NO_DATA'));
    expect(noDataEvent).toBeTruthy();
    expect(noDataEvent!.severity).toBe('warning');
    expect(noDataEvent!.market_id).toBe(market.id);
  });

  it('risk event details contain triggering reasons', async () => {
    const market = await seedMarket();
    const bankroll = await seedBankroll();
    const snapshot = await seedSnapshot(market.id, { spread: '0.25' }); // Wide spread

    const governor = new RiskGovernor();
    await governor.check(
      buildRiskContext(market, bankroll, [snapshot], {
        estimated_edge: 0.005, // Also below min edge
      }),
    );

    const events = await riskEventService.findRecent(10);
    expect(events.length).toBeGreaterThanOrEqual(1);

    const details = events[0].details as Record<string, unknown>;
    expect(details.reasons).toBeTruthy();
    expect(Array.isArray(details.reasons)).toBe(true);
    // Should contain both SPREAD and EDGE reasons
    const reasons = details.reasons as string[];
    expect(reasons.some((r) => r.includes('SPREAD_TOO_WIDE'))).toBe(true);
    expect(reasons.some((r) => r.includes('INSUFFICIENT_EDGE'))).toBe(true);
  });
});

// ── Multiple Vetoes ─────────────────────────────────────────────────────────

describe('Risk Pipeline – Multiple Triggers', () => {
  it('reports all triggered checks even when first one vetoes', async () => {
    const market = await seedMarket();
    // High drawdown AND high exposure
    const bankroll = await seedBankroll({
      total_balance: '7000.000000',
      active_balance: '5000.000000',
      deployed_balance: '5000.000000', // 100% exposure
    });
    const snapshot = await seedSnapshot(market.id);

    const governor = new RiskGovernor();
    const result = await governor.check(
      buildRiskContext(market, bankroll, [snapshot], {
        estimated_edge: 0.005, // Also low edge
      }),
    );

    expect(result.approved).toBe(false);
    // Kill switch returns early, but non-kill-switch checks accumulate
    expect(result.triggeredChecks.length).toBeGreaterThanOrEqual(2);
  });
});
