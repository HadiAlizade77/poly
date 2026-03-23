export type OrderSide = 'buy' | 'sell';
export type OrderType = 'limit' | 'market';
export type OrderStatus = 'pending' | 'open' | 'partial' | 'filled' | 'cancelled' | 'failed' | 'expired';
export type MakerTaker = 'maker' | 'taker' | 'mixed';

export interface Order {
  id: string;
  decision_id: string | null;
  market_id: string;
  polymarket_order_id: string | null;
  side: OrderSide;
  outcome_token: string;
  order_type: OrderType;
  price: number;
  size: number;
  filled_size: number;
  avg_fill_price: number | null;
  status: OrderStatus;
  maker_or_taker: MakerTaker | null;
  fees_paid: number;
  placement_latency_ms: number | null;
  error_message: string | null;
  created_at: Date;
  updated_at: Date;
  filled_at: Date | null;
  cancelled_at: Date | null;
}
