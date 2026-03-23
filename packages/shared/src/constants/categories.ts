import type { MarketCategory } from '../types/market.js';

export const MARKET_CATEGORIES: MarketCategory[] = [
  'crypto',
  'politics',
  'sports',
  'events',
  'entertainment',
  'other',
];

export const CATEGORY_CYCLE_INTERVALS: Record<MarketCategory, number> = {
  crypto: 15_000,
  politics: 600_000,
  sports: 180_000,
  events: 600_000,
  entertainment: 1_800_000,
  other: 600_000,
};
