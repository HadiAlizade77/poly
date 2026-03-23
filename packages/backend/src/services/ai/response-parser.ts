/**
 * AI response parser.
 *
 * Extracts and validates the JSON decision blob from Claude's response text.
 * Claude sometimes wraps JSON in markdown code fences — we strip those.
 */
import { z } from 'zod';

// ─── Schema ───────────────────────────────────────────────────────────────────

export const AiDecisionSchema = z.object({
  action: z.enum(['trade', 'hold']),
  direction: z.enum(['buy', 'sell']).nullable().optional(),
  outcome_token: z.string().nullable().optional(),
  confidence: z.number().min(0).max(1),
  size_hint: z.number().min(0.01).max(1).nullable().optional(),
  fair_value: z.number().min(0).max(1).nullable().optional(),
  estimated_edge: z.number().min(-1).max(1).nullable().optional(),
  reasoning: z.string().min(1),
  regime_assessment: z.string().nullable().optional(),
});

export type ParsedDecision = z.infer<typeof AiDecisionSchema>;

// ─── Parser ───────────────────────────────────────────────────────────────────

/**
 * Extract a JSON object from raw AI text.
 * Handles markdown code fences, extra prose, etc.
 */
function extractJson(text: string): string {
  // Strip markdown code fences
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch?.[1]) return fenceMatch[1].trim();

  // Try to find raw JSON object
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (jsonMatch) return jsonMatch[0].trim();

  return text.trim();
}

/**
 * Parse and validate Claude's response text into a typed decision.
 * Throws a descriptive error if parsing or validation fails.
 */
export function parseAiResponse(rawText: string): ParsedDecision {
  const jsonStr = extractJson(rawText);

  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonStr);
  } catch {
    throw new Error(`AI response is not valid JSON: ${jsonStr.slice(0, 200)}`);
  }

  const result = AiDecisionSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`AI response validation failed: ${issues}`);
  }

  // Enforce: if action=trade, direction must be present
  if (result.data.action === 'trade' && !result.data.direction) {
    throw new Error('AI responded with action=trade but no direction');
  }

  return result.data;
}
