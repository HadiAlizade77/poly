import { z } from 'zod';

export const setSystemConfigSchema = z.object({
  value: z.unknown(),
  description: z.string().optional(),
});

export type SetSystemConfigInput = z.infer<typeof setSystemConfigSchema>;
