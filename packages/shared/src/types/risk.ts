export type RiskEventType =
  | 'trade_vetoed'
  | 'size_reduced'
  | 'category_paused'
  | 'global_stop'
  | 'drawdown_limit'
  | 'exposure_limit'
  | 'liquidity_warning'
  | 'latency_warning'
  | 'anomaly_detected';

export type Severity = 'info' | 'warning' | 'critical';

export interface RiskEvent {
  id: string;
  event_type: RiskEventType;
  timestamp: Date;
  severity: Severity;
  decision_id: string | null;
  market_id: string | null;
  details: Record<string, unknown>;
  message: string;
  auto_resolved: boolean;
  resolved_at: Date | null;
}

export interface RiskConfig {
  kill_switch_enabled: boolean;
  max_daily_loss: number;
  max_position_size: number;
  max_total_exposure: number;
  max_single_trade: number;
  max_consecutive_losses: number;
  cooldown_after_loss_streak_minutes: number;
  min_liquidity: number;
  max_spread: number;
  max_latency_ms: number;
  max_data_age_seconds: number;
}
