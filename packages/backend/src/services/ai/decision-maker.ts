/**
 * Decision maker — main AI call pipeline.
 *
 * Flow:
 *   1. Build system + user prompts
 *   2. Call Claude via aiClient
 *   3. Parse + validate response
 *   4. Fall back to deterministic logic on error
 *   5. Return structured decision + metadata
 */
import logger from '../../config/logger.js';
import { aiClient, DEFAULT_MODEL } from './client.js';
import { getSystemPrompt, getUserPrompt, PROMPT_VERSION } from './prompt-manager.js';
import { parseAiResponse, type ParsedDecision } from './response-parser.js';
import { deterministicFallback } from './deterministic-fallback.js';
import type { ScoredDimensions } from '../decision-engine/scorer.interface.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DecisionInput {
  dashboardText: string;
  category:      string;
  scores:        ScoredDimensions;
}

export interface DecisionOutput extends ParsedDecision {
  model:         string;
  latencyMs:     number;
  tokensUsed:    number;
  promptVersion: string;
  usedFallback:  boolean;
}

// ─── Decision maker ──────────────────────────────────────────────────────────

export async function makeDecision(input: DecisionInput): Promise<DecisionOutput> {
  const { dashboardText, category, scores } = input;

  // Bail early if no API key configured
  if (!process.env.ANTHROPIC_API_KEY) {
    logger.warn('DecisionMaker: ANTHROPIC_API_KEY not set, using deterministic fallback');
    return toOutput(deterministicFallback(scores, category), {
      model: 'fallback', latencyMs: 0, tokensUsed: 0, promptVersion: PROMPT_VERSION,
    });
  }

  const systemPrompt = getSystemPrompt(category);
  const userPrompt   = getUserPrompt(dashboardText);

  try {
    const result = await aiClient.complete(userPrompt, {
      systemPrompt,
      maxTokens:   1_024,
      temperature: 0.2, // low temperature for consistent JSON
    });

    const parsed = parseAiResponse(result.content);

    logger.info('DecisionMaker: AI decision', {
      category,
      action:     parsed.action,
      confidence: parsed.confidence,
      latencyMs:  result.latencyMs,
      tokens:     result.totalTokens,
    });

    return toOutput(parsed, {
      model:         result.model,
      latencyMs:     result.latencyMs,
      tokensUsed:    result.totalTokens,
      promptVersion: PROMPT_VERSION,
      usedFallback:  false,
    });
  } catch (err) {
    logger.warn('DecisionMaker: AI call failed, using deterministic fallback', {
      category,
      error: (err as Error).message,
    });

    return toOutput(deterministicFallback(scores, category), {
      model: DEFAULT_MODEL, latencyMs: 0, tokensUsed: 0, promptVersion: PROMPT_VERSION,
    });
  }
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function toOutput(
  decision: ParsedDecision & { fallback?: boolean },
  meta: { model: string; latencyMs: number; tokensUsed: number; promptVersion: string; usedFallback?: boolean },
): DecisionOutput {
  return {
    ...decision,
    model:         meta.model,
    latencyMs:     meta.latencyMs,
    tokensUsed:    meta.tokensUsed,
    promptVersion: meta.promptVersion,
    usedFallback:  meta.usedFallback ?? decision.fallback ?? false,
  };
}
