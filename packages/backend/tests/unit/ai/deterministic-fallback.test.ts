import { describe, it, expect } from 'vitest';
import { deterministicFallback } from '../../../src/services/ai/deterministic-fallback.js';
import type { ScoredDimensions } from '../../../src/services/decision-engine/scorer.interface.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeScores(values: Record<string, number>): ScoredDimensions {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      { value, label: 'TEST', detail: `${name}=${value}` },
    ]),
  );
}

// Thresholds from deterministic-fallback.ts:
const MIN_COMPOSITE_FOR_TRADE = 72;
const MIN_SCORER_COUNT = 3;

// ─── Basic behaviour ──────────────────────────────────────────────────────────

describe('deterministicFallback – basic behaviour', () => {
  it('always sets fallback: true', () => {
    const result = deterministicFallback({}, 'crypto');
    expect(result.fallback).toBe(true);
  });

  it('returns action=hold when scores object is empty', () => {
    const result = deterministicFallback({}, 'crypto');
    expect(result.action).toBe('hold');
    expect(result.direction).toBeNull();
  });

  it('returns action=hold with a single scorer (< MIN_SCORER_COUNT)', () => {
    const result = deterministicFallback(makeScores({ momentum: 90 }), 'crypto');
    expect(result.action).toBe('hold');
  });

  it('returns action=hold with two scorers even if both are high', () => {
    const result = deterministicFallback(makeScores({ momentum: 90, volume: 85 }), 'crypto');
    expect(result.action).toBe('hold');
  });

  it('returns action=hold with low composite (< 72) even with 5 scorers', () => {
    const result = deterministicFallback(
      makeScores({ a: 50, b: 50, c: 50, d: 50, e: 50 }),
      'crypto',
    );
    expect(result.action).toBe('hold');
    expect(result.confidence).toBe(0.3);
  });
});

// ─── Trade threshold ──────────────────────────────────────────────────────────

describe('deterministicFallback – trade threshold', () => {
  it('returns action=trade when composite >= 72 AND scorers >= 3', () => {
    // Composite = (80+80+80)/3 = 80 >= 72, count=3 >= 3
    const result = deterministicFallback(makeScores({ a: 80, b: 80, c: 80 }), 'crypto');
    expect(result.action).toBe('trade');
    expect(result.direction).toBe('buy');
    expect(result.outcome_token).toBe('YES');
  });

  it('returns action=trade with composite exactly at boundary (72) with 3+ scorers', () => {
    // Composite = (72+72+72)/3 = 72 exactly
    const result = deterministicFallback(makeScores({ a: 72, b: 72, c: 72 }), 'crypto');
    expect(result.action).toBe('trade');
  });

  it('returns action=hold when composite is just below threshold (71.9)', () => {
    // (71+71+71+73)/4 = 286/4 = 71.5 < 72
    const result = deterministicFallback(makeScores({ a: 71, b: 71, c: 71, d: 73 }), 'crypto');
    expect(result.action).toBe('hold');
  });

  it('returns action=trade with 3 scorers and composite=80', () => {
    const result = deterministicFallback(makeScores({ x: 90, y: 75, z: 75 }), 'crypto');
    // composite = (90+75+75)/3 = 80 >= 72
    expect(result.action).toBe('trade');
  });

  it('returns action=hold when composite is high but scorer count is 2 (< 3)', () => {
    const result = deterministicFallback(makeScores({ a: 95, b: 95 }), 'crypto');
    expect(result.action).toBe('hold');
  });
});

// ─── Trade decision shape ─────────────────────────────────────────────────────

describe('deterministicFallback – trade decision fields', () => {
  const tradeScores = makeScores({ a: 80, b: 80, c: 80 });

  it('trade result has confidence=0.4 (deliberately low)', () => {
    const result = deterministicFallback(tradeScores, 'crypto');
    expect(result.confidence).toBe(0.4);
  });

  it('trade result has size_hint=0.05 (minimum size)', () => {
    const result = deterministicFallback(tradeScores, 'crypto');
    expect(result.size_hint).toBe(0.05);
  });

  it('trade result has fair_value=null and estimated_edge=null', () => {
    const result = deterministicFallback(tradeScores, 'crypto');
    expect(result.fair_value).toBeNull();
    expect(result.estimated_edge).toBeNull();
  });

  it('trade reasoning mentions composite and scorer count', () => {
    const result = deterministicFallback(tradeScores, 'crypto');
    expect(result.reasoning).toContain('composite=');
    expect(result.reasoning).toContain('3');
  });

  it('regime_assessment includes the category name', () => {
    const result = deterministicFallback(tradeScores, 'crypto');
    expect(result.regime_assessment).toContain('crypto');
  });
});

// ─── Hold decision shape ──────────────────────────────────────────────────────

describe('deterministicFallback – hold decision fields', () => {
  it('hold result has confidence=0.3', () => {
    const result = deterministicFallback({}, 'politics');
    expect(result.confidence).toBe(0.3);
  });

  it('hold result has direction=null and outcome_token=null', () => {
    const result = deterministicFallback({}, 'politics');
    expect(result.direction).toBeNull();
    expect(result.outcome_token).toBeNull();
  });

  it('hold reasoning mentions composite value', () => {
    const result = deterministicFallback(makeScores({ a: 60, b: 60, c: 60 }), 'politics');
    expect(result.reasoning).toContain('composite=');
    expect(result.reasoning).toContain('60');
  });

  it('hold regime_assessment includes the category', () => {
    const result = deterministicFallback(makeScores({ a: 60 }), 'sports');
    expect(result.regime_assessment).toContain('sports');
  });
});

// ─── Composite calculation ────────────────────────────────────────────────────

describe('deterministicFallback – composite calculation', () => {
  it('composite is the simple average of all scorer values', () => {
    // All scorers are 80 → composite=80 ≥ 72, count=3 ≥ 3 → trade
    const result = deterministicFallback(makeScores({ a: 80, b: 80, c: 80 }), 'crypto');
    expect(result.reasoning).toContain('80');
  });

  it('composite with mixed high and low scores', () => {
    // (100 + 100 + 100 + 100)/4 = 100 → trade
    const result = deterministicFallback(makeScores({ a: 100, b: 100, c: 100, d: 100 }), 'crypto');
    expect(result.action).toBe('trade');
  });

  it('empty scores defaults composite to 50 (neutral fallback)', () => {
    // Default composite is 50 in computeComposite (from source)
    const result = deterministicFallback({}, 'events');
    expect(result.action).toBe('hold'); // 50 < 72 → hold
    expect(result.reasoning).toContain('50');
  });
});

// ─── Category pass-through ────────────────────────────────────────────────────

describe('deterministicFallback – category handling', () => {
  it.each(['crypto', 'politics', 'sports', 'events', 'entertainment', 'other'])(
    'works correctly for category=%s',
    (category) => {
      const result = deterministicFallback({}, category);
      expect(result.fallback).toBe(true);
      expect(result.regime_assessment).toContain(category);
    },
  );
});
