import { z } from 'zod';

const riskScopeEnum = z.enum(['global', 'category', 'strategy', 'market']);

export const riskConfigSchema = z.object({
  scope: riskScopeEnum,
  scope_value: z.string().optional(),
  parameters: z.record(z.unknown()),
  updated_by: z.string().optional(),
});

export type RiskConfigInput = z.infer<typeof riskConfigSchema>;
