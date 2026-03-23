import { z } from 'zod';

const categoryEnum = z.enum(['crypto', 'politics', 'sports', 'events', 'entertainment', 'other']);
const statusEnum = z.enum(['active', 'closed', 'resolved', 'paused', 'excluded']);

export const createMarketSchema = z.object({
  polymarket_id: z.string().min(1),
  title: z.string().min(1),
  category: categoryEnum,
  outcomes: z.record(z.unknown()),
  slug: z.string().optional(),
  description: z.string().optional(),
  subcategory: z.string().optional(),
  status: statusEnum.optional(),
  resolution_source: z.string().optional(),
  resolution_criteria: z.string().optional(),
  current_prices: z.record(z.unknown()).optional(),
  volume_24h: z.string().optional(),
  liquidity: z.string().optional(),
  end_date: z.string().datetime().optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  is_tradeable: z.boolean().optional(),
  exclusion_reason: z.string().optional(),
});

export const updateMarketSchema = createMarketSchema.partial().omit({ polymarket_id: true });

export const marketStatusSchema = z.object({
  status: statusEnum,
  exclusion_reason: z.string().optional(),
});

export type CreateMarketInput = z.infer<typeof createMarketSchema>;
export type UpdateMarketInput = z.infer<typeof updateMarketSchema>;
export type MarketStatusInput = z.infer<typeof marketStatusSchema>;
