/**
 * Raw types from the Polymarket Gamma API and CLOB API.
 * These mirror the actual API response shapes; we map them to our DB models in the scanner.
 */

// ─── Gamma API ────────────────────────────────────────────────────────────────

export interface PolymarketTag {
  id: number;
  label: string;
  slug: string;
  forceShow?: boolean;
}

export interface PolymarketToken {
  token_id: string;
  outcome: string;
  price: number;      // 0-1 probability
  winner?: boolean;
}

export interface PolymarketRewards {
  rates?: unknown[];
  min_size?: number;
  max_spread?: number;
}

export interface PolymarketMarket {
  condition_id: string;
  question_id?: string;
  question: string;
  description?: string;
  market_slug?: string;
  end_date_iso?: string;
  game_start_time?: string;
  tokens: PolymarketToken[];
  tags?: PolymarketTag[] | string[];
  active: boolean;
  closed: boolean;
  archived: boolean;
  new?: boolean;
  featured?: boolean;
  restricted?: boolean;
  volume?: string;
  volume_24hr?: string;
  liquidity?: string;
  minimum_order_size?: string;
  minimum_tick_size?: string;
  neg_risk?: boolean;
  neg_risk_market_id?: string;
  rewards?: PolymarketRewards;
  icon?: string;
  image?: string;
}

// ─── CLOB API ─────────────────────────────────────────────────────────────────

export interface ClobOrderBookLevel {
  price: string;
  size: string;
}

export interface ClobOrderBook {
  market: string;    // condition_id
  asset_id: string;  // token_id
  bids: ClobOrderBookLevel[];
  asks: ClobOrderBookLevel[];
  hash?: string;
  timestamp?: string;
}

// ─── WebSocket messages ───────────────────────────────────────────────────────

export interface WsPriceChangeEvent {
  event_type: 'price_change';
  asset_id: string;
  price: string;
  side: 'BUY' | 'SELL';
  size: string;
  market: string;      // condition_id
  outcome: string;
  timestamp: string;
}

export interface WsTradeEvent {
  event_type: 'trade';
  id: string;
  taker_order_id: string;
  market: string;
  asset_id: string;
  side: 'BUY' | 'SELL';
  size: string;
  fee_rate_bps: string;
  price: string;
  outcome: string;
  timestamp: string;
}

export type WsMarketEvent = WsPriceChangeEvent | WsTradeEvent;

// ─── Scanner config ───────────────────────────────────────────────────────────

export interface ScannerConfig {
  /** Full scan interval in milliseconds (default: 60 000) */
  intervalMs: number;
  /** Markets to fetch per batch (default: 100) */
  batchSize: number;
  /** Max pages to paginate when fetching all markets (default: 20) */
  maxPages: number;
  /** Operate in demo mode — no real API calls */
  demoMode: boolean;
  /** Number of synthetic markets to generate in demo mode */
  demoMarketCount: number;
  /** Redis channel to publish market update messages to */
  redisChannel: string;
}
