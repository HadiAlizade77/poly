import { z } from 'zod';

export const upsertScorerConfigSchema = z.object({
  category: z.string().min(1),
  scorer_name: z.string().min(1),
  parameters: z.record(z.unknown()),
  description: z.string().optional(),
  is_enabled: z.boolean().optional(),
});

export const updateScorerConfigSchema = upsertScorerConfigSchema.partial().omit({
  category: true,
  scorer_name: true,
});

export type UpsertScorerConfigInput = z.infer<typeof upsertScorerConfigSchema>;
