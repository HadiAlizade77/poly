export const CRYPTO_SCORERS = [
  'exchange_divergence',
  'momentum',
  'mean_reversion',
  'volatility',
  'volume',
  'exhaustion',
  'liquidity_quality',
  'time_pressure',
] as const;

export const POLITICS_SCORERS = [
  'poll_divergence',
  'sentiment_shift',
  'historical_base_rate',
  'resolution_risk',
  'crowd_bias',
  'information_velocity',
] as const;

export const SPORTS_SCORERS = [
  'odds_divergence',
  'line_movement',
  'injury_impact',
  'public_bias',
  'model_edge',
] as const;

export const EVENT_SCORERS = [
  'base_rate',
  'schedule_signal',
  'news_impact',
  'crowd_confidence',
] as const;

export const SHARED_SCORERS = [
  'liquidity_quality',
  'time_scorer',
] as const;
