import { z } from 'zod';

const orderStatusEnum = z.enum([
  'pending', 'open', 'partial', 'filled', 'cancelled', 'failed', 'expired',
]);

export const updateOrderStatusSchema = z.object({
  status: orderStatusEnum,
  polymarket_order_id: z.string().optional(),
  filled_size: z.string().optional(),
  avg_fill_price: z.string().optional(),
  error_message: z.string().optional(),
  filled_at: z.string().datetime().optional(),
  cancelled_at: z.string().datetime().optional(),
});

export type UpdateOrderStatusInput = z.infer<typeof updateOrderStatusSchema>;
