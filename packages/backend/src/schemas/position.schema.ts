import { z } from 'zod';

const exitStrategyEnum = z.enum([
  'resolution_only', 'stop_loss', 'time_based', 'manual',
]);

export const exitStrategySchema = z.object({
  exit_strategy: exitStrategyEnum,
  stop_loss_price: z.string().optional(),
  time_exit_at: z.string().datetime().optional(),
});

export type ExitStrategyInput = z.infer<typeof exitStrategySchema>;
