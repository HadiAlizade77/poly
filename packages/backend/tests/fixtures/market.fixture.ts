import type { Market } from '@polymarket/shared';

export const sampleMarket: Market = {
  id: 'mkt-001',
  polymarket_id: 'pm-btc-100k-2024',
  slug: 'will-btc-exceed-100k-2024',
  title: 'Will BTC exceed $100k by end of 2024?',
  description: 'Resolves YES if BTC closes above $100,000 on any day before Jan 1 2025.',
  category: 'crypto',
  subcategory: 'bitcoin',
  status: 'active',
  resolution_source: 'Coinbase',
  resolution_criteria: 'BTC/USD daily close above $100,000',
  outcomes: [
    { name: 'Yes', token_id: 'yes-token-001' },
    { name: 'No', token_id: 'no-token-001' },
  ],
  current_prices: { Yes: 0.65, No: 0.35 },
  volume_24h: 125000,
  liquidity: 50000,
  end_date: new Date('2024-12-31T23:59:59Z'),
  resolved_outcome: null,
  tags: ['crypto', 'bitcoin', 'price'],
  metadata: {},
  is_tradeable: true,
  exclusion_reason: null,
  first_seen_at: new Date('2024-01-01T00:00:00Z'),
  updated_at: new Date('2024-06-01T12:00:00Z'),
};

export const sampleMarketClosed: Market = {
  ...sampleMarket,
  id: 'mkt-002',
  polymarket_id: 'pm-btc-50k-2023',
  title: 'Will BTC exceed $50k by end of 2023?',
  status: 'resolved',
  resolved_outcome: 'Yes',
  is_tradeable: false,
};

export function createMarket(overrides: Partial<Market> = {}): Market {
  return {
    ...sampleMarket,
    id: `mkt-${Math.random().toString(36).slice(2, 7)}`,
    ...overrides,
  };
}
