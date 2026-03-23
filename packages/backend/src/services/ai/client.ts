/**
 * Claude API client.
 *
 * Wraps @anthropic-ai/sdk with:
 *   - Automatic retry (3 attempts, exponential backoff)
 *   - Per-day token budget enforcement
 *   - Structured response logging
 */
import Anthropic from '@anthropic-ai/sdk';
import logger from '../../config/logger.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_MODEL = 'claude-sonnet-4-6';
const MAX_RETRIES   = 3;
const BASE_DELAY_MS = 1_000;

// ─── Token budget (in-memory, resets at midnight UTC) ─────────────────────────

interface DailyUsage {
  date:        string; // YYYY-MM-DD UTC
  inputTokens: number;
  outputTokens: number;
  calls:       number;
}

let dailyUsage: DailyUsage = { date: todayUTC(), inputTokens: 0, outputTokens: 0, calls: 0 };

function todayUTC(): string {
  return new Date().toISOString().slice(0, 10);
}

function resetIfNewDay(): void {
  const today = todayUTC();
  if (dailyUsage.date !== today) {
    dailyUsage = { date: today, inputTokens: 0, outputTokens: 0, calls: 0 };
  }
}

export function getDailyUsage(): Readonly<DailyUsage> {
  resetIfNewDay();
  return dailyUsage;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export interface CompleteOptions {
  model?:         string;
  maxTokens?:     number;
  temperature?:   number;
  systemPrompt?:  string;
}

export interface CompleteResult {
  content:       string;
  inputTokens:   number;
  outputTokens:  number;
  totalTokens:   number;
  model:         string;
  latencyMs:     number;
}

export class AiClient {
  private readonly sdk: Anthropic;
  private readonly dailyTokenBudget: number;

  constructor(dailyTokenBudget = 500_000) {
    this.sdk              = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    this.dailyTokenBudget = dailyTokenBudget;
  }

  /**
   * Send a single user message and get a completion.
   * Throws if the daily token budget is exceeded.
   * Retries on 429/5xx with exponential backoff.
   */
  async complete(userMessage: string, options: CompleteOptions = {}): Promise<CompleteResult> {
    resetIfNewDay();

    if (dailyUsage.inputTokens + dailyUsage.outputTokens >= this.dailyTokenBudget) {
      throw new Error(`AI daily token budget exhausted (${this.dailyTokenBudget.toLocaleString()} tokens/day)`);
    }

    const model      = options.model ?? DEFAULT_MODEL;
    const maxTokens  = options.maxTokens ?? 1_024;
    const startMs    = Date.now();

    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await this.sdk.messages.create({
          model,
          max_tokens: maxTokens,
          ...(options.temperature !== undefined && { temperature: options.temperature }),
          ...(options.systemPrompt && { system: options.systemPrompt }),
          messages: [{ role: 'user', content: userMessage }],
        });

        const content      = response.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
        const inputTokens  = response.usage.input_tokens;
        const outputTokens = response.usage.output_tokens;
        const latencyMs    = Date.now() - startMs;

        // Track usage
        dailyUsage.inputTokens  += inputTokens;
        dailyUsage.outputTokens += outputTokens;
        dailyUsage.calls        += 1;

        logger.info('AiClient: completion', {
          model,
          inputTokens,
          outputTokens,
          latencyMs,
          dailyTotal: dailyUsage.inputTokens + dailyUsage.outputTokens,
          attempt,
        });

        return { content, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, model, latencyMs };
      } catch (err) {
        lastError = err as Error;

        const status = (err as { status?: number }).status;

        // Don't retry on client errors (except rate-limit 429)
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
          logger.error('AiClient: non-retryable error', { status, error: lastError.message });
          throw lastError;
        }

        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
          logger.warn('AiClient: retrying after error', { attempt, delay, error: lastError.message });
          await sleep(delay);
        }
      }
    }

    throw lastError ?? new Error('AI completion failed after retries');
  }
}

// ─── Module singleton ─────────────────────────────────────────────────────────

function getBudget(): number {
  const env = parseInt(process.env.AI_DAILY_TOKEN_BUDGET ?? '', 10);
  return isNaN(env) ? 500_000 : env;
}

export const aiClient = new AiClient(getBudget());

// ─── Helpers ──────────────────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
