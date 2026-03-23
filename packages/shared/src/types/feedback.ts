export interface TradeFeedbackSummary {
  trades_today: number;
  wins: number;
  losses: number;
  net_pnl: number;
  streak: string;
  patterns_detected: string[];
  directional_bias: string | null;
  avg_confidence_on_wins: number | null;
  avg_confidence_on_losses: number | null;
  recent_trades: RecentTradeInfo[];
}

export interface RecentTradeInfo {
  market: string;
  direction: string;
  result: 'win' | 'loss' | 'pending';
  pnl: number;
  minutes_ago: number;
}

export interface TradeFeedback {
  id: string;
  category: string;
  session_date: string;
  timestamp: Date;
  feedback_summary: TradeFeedbackSummary;
  feedback_text: string;
}
