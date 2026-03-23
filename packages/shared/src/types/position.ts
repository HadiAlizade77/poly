export type PositionSide = 'long' | 'short';
export type ExitStrategy = 'resolution_only' | 'stop_loss' | 'time_based' | 'manual';
export type CloseReason = 'resolution' | 'stop_loss' | 'time_exit' | 'manual' | 'risk_veto';

export interface Position {
  id: string;
  market_id: string;
  outcome_token: string;
  side: PositionSide;
  size: number;
  avg_entry_price: number;
  current_price: number | null;
  unrealized_pnl: number | null;
  realized_pnl: number;
  total_fees: number;
  decision_id: string | null;
  exit_strategy: ExitStrategy;
  stop_loss_price: number | null;
  time_exit_at: Date | null;
  opened_at: Date;
  updated_at: Date;
}

export interface PositionHistory {
  id: string;
  market_id: string;
  outcome_token: string;
  side: PositionSide;
  size: number;
  avg_entry_price: number;
  avg_exit_price: number | null;
  realized_pnl: number;
  total_fees: number;
  decision_id: string | null;
  regime_at_entry: string | null;
  regime_at_exit: string | null;
  resolution_outcome: string | null;
  opened_at: Date;
  closed_at: Date;
  close_reason: CloseReason;
}
