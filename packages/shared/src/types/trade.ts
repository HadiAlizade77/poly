export interface Trade {
  id: string;
  order_id: string;
  market_id: string;
  decision_id: string | null;
  side: 'buy' | 'sell';
  outcome_token: string;
  size: number;
  entry_price: number;
  fees: number;
  net_cost: number;
  regime_at_entry: string | null;
  confidence_at_entry: number | null;
  edge_at_entry: number | null;
  executed_at: Date;
}
