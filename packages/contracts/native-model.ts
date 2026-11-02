import { z } from 'zod';
export const nativeResultMaximumBytes = 4 * 1024 * 1024;

/** Accepted limits, not harness-selected defaults. Output includes reasoning. */
export const nativeModelLimitsSchema = z.object({
  contextTokens: z.number().int().positive(),
  inputTokens: z.number().int().positive().optional(),
  maxOutputTokens: z.number().int().positive(),
});
export type NativeModelLimits = z.infer<typeof nativeModelLimitsSchema>;
