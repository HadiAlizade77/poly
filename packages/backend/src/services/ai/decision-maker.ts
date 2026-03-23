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
import { aiClient, DEFAULT_MODEL, hasApiKey } from './client.js';
import {
  getSystemPrompt,
  getUserPrompt,
  getScreeningSystemPrompt,
  getScreeningUserPrompt,
  PROMPT_VERSION,
} from './prompt-manager.js';
import { parseAiResponse, type ParsedDecision } from './response-parser.js';
import { deterministicFallback } from './deterministic-fallback.js';
import type { ScoredDimensions } from '../decision-engine/scorer.interface.js';

// ─── Types ───────────────────────────────────────────────────────────────────

export interface DecisionInput {
  dashboardText: string;
  category:      string;
  scores:        ScoredDimensions;
  riskAppetite?: number;
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
  const { dashboardText, category, scores, riskAppetite = 5 } = input;

  // Bail early if no API key configured (checks DB + env)
  if (!(await hasApiKey())) {
    logger.warn('DecisionMaker: No AI API key found (DB or env), using deterministic fallback');
    return toOutput(deterministicFallback(scores, category), {
      model: 'fallback', latencyMs: 0, tokensUsed: 0, promptVersion: PROMPT_VERSION,
    });
  }

  const systemPrompt = getSystemPrompt(category, riskAppetite);
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

// ─── Screening (Stage 1 — one cheap call per category) ──────────────────────

export interface ScreeningMarket {
  row:       number;
  title:     string;
  yesPrice:  number;
  noPrice:   number;
  spread:    number;
  liquidity: number;
  volume24h: number;
  expiry:    string | null;
}

export async function screenMarkets(
  category: string,
  markets: ScreeningMarket[],
  riskAppetite = 5,
): Promise<number[]> {
  if (markets.length === 0) return [];

  if (!(await hasApiKey())) {
    // No AI key — return all markets for deterministic evaluation
    return markets.map((m) => m.row);
  }

  // Build compact table
  const header = '#  | Title (truncated) | YES | NO | Spread | Liq($) | Vol24h($) | Expiry';
  const divider = '-'.repeat(header.length);
  const rows = markets.map((m) =>
    `${String(m.row).padStart(2)} | ${m.title.slice(0, 50).padEnd(50)} | ${m.yesPrice.toFixed(2)} | ${m.noPrice.toFixed(2)} | ${(m.spread * 100).toFixed(1)}% | ${Math.round(m.liquidity).toLocaleString().padStart(10)} | ${Math.round(m.volume24h).toLocaleString().padStart(10)} | ${m.expiry ?? 'none'}`,
  );
  const table = [header, divider, ...rows].join('\n');

  const systemPrompt = getScreeningSystemPrompt(riskAppetite);
  const userPrompt = getScreeningUserPrompt(category, table);

  try {
    const result = await aiClient.complete(userPrompt, {
      systemPrompt,
      maxTokens: 128,
      temperature: 0.1,
    });

    logger.info('Screener: batch screen', {
      category,
      candidates: markets.length,
      tokens: result.totalTokens,
      latencyMs: result.latencyMs,
    });

    // Parse response — expect a JSON array of row numbers
    // The AI sometimes wraps the array in prose; extract the first [...] we find
    const cleaned = result.content.replace(/```json?\s*/g, '').replace(/```/g, '').trim();
    const arrayMatch = cleaned.match(/\[[\d\s,]*\]/);
    if (arrayMatch) {
      const parsed = JSON.parse(arrayMatch[0]);
      if (Array.isArray(parsed)) {
        return parsed
          .filter((n): n is number => typeof n === 'number')
          .filter((n) => n >= 1 && n <= markets.length)
          .slice(0, 5);
      }
    }
    // If response is just "[]" or empty
    if (cleaned === '[]' || cleaned === '') return [];
    // Couldn't parse — log and return empty (conservative: skip all)
    logger.warn('Screener: unexpected response format, skipping all', { raw: cleaned.slice(0, 200) });
    return [];
  } catch (err) {
    logger.warn('Screener: failed, passing all markets through', {
      category,
      error: (err as Error).message,
    });
    // On failure, fall back to evaluating all markets
    return markets.map((m) => m.row);
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
