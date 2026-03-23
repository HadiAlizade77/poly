import type { AIDecision } from '@polymarket/shared';

export const sampleDecision: AIDecision = {
  id: 'dec-001',
  market_id: 'mkt-001',
  category: 'crypto',
  timestamp: new Date('2024-06-01T12:00:00Z'),
  cycle_number: 1,
  dashboard_text: 'BTC showing strong momentum. Edge detected at 0.65 vs 0.60 fair value.',
  account_state: { balance: 10000, available: 8000 },
  trade_feedback: null,
  action: 'trade',
  direction: 'Yes',
  outcome_token: 'yes-token-001',
  confidence: 0.72,
  size_hint: 250,
  estimated_edge: 0.05,
  estimated_cost: 250,
  fair_value: 0.70,
  market_price: 0.65,
  reasoning: 'Strong crypto momentum regime with consistent polling data.',
  regime_assessment: 'trending',
  regime_confidence: 0.8,
  was_executed: false,
  veto_reason: null,
  order_id: null,
  model_used: 'claude-sonnet-4-6',
  latency_ms: 1200,
  tokens_used: 3500,
  prompt_version: 'v1.0.0',
};

export const sampleDecisionHold: AIDecision = {
  ...sampleDecision,
  id: 'dec-002',
  action: 'hold',
  direction: null,
  outcome_token: null,
  confidence: 0.3,
  size_hint: null,
  estimated_edge: null,
  reasoning: 'Insufficient edge. Market price too close to fair value.',
};

export function createDecision(overrides: Partial<AIDecision> = {}): AIDecision {
  return {
    ...sampleDecision,
    id: `dec-${Math.random().toString(36).slice(2, 7)}`,
    timestamp: new Date(),
    ...overrides,
  };
}
