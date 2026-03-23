export interface ScorerDimension {
  value: number;
  label: string;
  detail: string;
  metadata?: Record<string, unknown>;
}

export interface ContextScoreRecord {
  id: string;
  market_id: string;
  category: string;
  timestamp: Date;
  scores: Record<string, ScorerDimension>;
  raw_indicators: Record<string, unknown> | null;
  dashboard_text: string | null;
}

export interface ScorerConfig {
  id: string;
  category: string;
  scorer_name: string;
  description: string | null;
  is_enabled: boolean;
  parameters: Record<string, unknown>;
  created_at: Date;
  updated_at: Date;
}
