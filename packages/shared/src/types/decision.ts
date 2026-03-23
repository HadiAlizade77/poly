export type DecisionAction = 'trade' | 'hold';

export type RegimeAssessment = 'quiet' | 'trending' | 'panic' | 'volatile' | 'untradeable';

export interface AIDecision {
  id: string;
  market_id: string;
  category: string;
  timestamp: Date;
  cycle_number: number | null;
  dashboard_text: string;
  account_state: Record<string, unknown>;
  trade_feedback: Record<string, unknown> | null;
  action: DecisionAction;
  direction: string | null;
  outcome_token: string | null;
  confidence: number;
  size_hint: number | null;
  estimated_edge: number | null;
  estimated_cost: number | null;
  fair_value: number | null;
  market_price: number | null;
  reasoning: string;
  regime_assessment: RegimeAssessment | null;
  regime_confidence: number | null;
  was_executed: boolean;
  veto_reason: string | null;
  order_id: string | null;
  model_used: string;
  latency_ms: number | null;
  tokens_used: number | null;
  prompt_version: string | null;
}
