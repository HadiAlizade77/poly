export interface Bankroll {
  id: string;
  total_balance: number;
  previous_balance: number;
  reserved_balance: number;
  active_balance: number;
  deployed_balance: number;
  unrealized_pnl: number;
  balance_delta_today: number;
  balance_delta_total: number;
  initial_deposit: number;
  updated_at: Date;
}

export interface BankrollHistory {
  id: string;
  date: string;
  opening_balance: number;
  closing_balance: number;
  deposits: number;
  withdrawals: number;
  trading_pnl: number;
  fees_total: number;
  trades_count: number;
  win_rate: number | null;
}
