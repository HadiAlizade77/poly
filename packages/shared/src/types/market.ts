export type MarketCategory = 'crypto' | 'politics' | 'sports' | 'events' | 'entertainment' | 'other';

export type MarketStatus = 'active' | 'closed' | 'resolved' | 'paused' | 'excluded';

export interface MarketOutcome {
  name: string;
  token_id: string;
}

export interface Market {
  id: string;
  polymarket_id: string;
  slug: string | null;
  title: string;
  description: string | null;
  category: MarketCategory;
  subcategory: string | null;
  status: MarketStatus;
  resolution_source: string | null;
  resolution_criteria: string | null;
  outcomes: MarketOutcome[];
  current_prices: Record<string, number> | null;
  volume_24h: number | null;
  liquidity: number | null;
  end_date: Date | null;
  resolved_outcome: string | null;
  tags: string[];
  metadata: Record<string, unknown> | null;
  is_tradeable: boolean;
  exclusion_reason: string | null;
  first_seen_at: Date;
  updated_at: Date;
}
