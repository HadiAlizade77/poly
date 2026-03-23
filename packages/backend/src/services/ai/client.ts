/**
 * AI client for trading decisions.
 *
 * Supports two providers:
 *   - anthropic: Direct Anthropic SDK
 *   - openrouter: OpenRouter API (OpenAI-compatible format)
 *
 * Loads credentials from DB (system_config) with env fallback.
 * Includes retry, daily token budget, and structured logging.
 */
import Anthropic from '@anthropic-ai/sdk';
import logger from '../../config/logger.js';
import * as systemConfigService from '../system-config.service.js';

// ─── Constants ────────────────────────────────────────────────────────────────

export const DEFAULT_MODEL = 'anthropic/claude-sonnet-4-6';
const MAX_RETRIES   = 3;
const BASE_DELAY_MS = 1_000;
const OPENROUTER_URL = 'https://openrouter.ai/api/v1/chat/completions';

// ─── Token budget (in-memory, resets at midnight UTC) ─────────────────────────

interface DailyUsage {
  date:        string;
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

// ─── Resolve credentials from DB → env fallback ─────────────────────────────

interface AiCredentials {
  apiKey: string;
  model: string;
  provider: 'anthropic' | 'openrouter';
}

let cachedCredentials: AiCredentials | null = null;
let credentialsCachedAt = 0;
const CREDENTIALS_TTL_MS = 30_000;

async function resolveCredentials(): Promise<AiCredentials> {
  if (cachedCredentials && Date.now() - credentialsCachedAt < CREDENTIALS_TTL_MS) {
    return cachedCredentials;
  }

  const aiConfig = await systemConfigService.getValue<{
    provider?: string;
    model?: string;
  }>('ai_config').catch(() => null);

  const openrouterKeyDb = await systemConfigService.getValue<string>('openrouter_api_key').catch(() => null);
  const anthropicKeyDb  = await systemConfigService.getValue<string>('anthropic_api_key').catch(() => null);

  const openrouterKey = openrouterKeyDb || process.env.OPENROUTER_API_KEY || '';
  const anthropicKey  = anthropicKeyDb  || process.env.ANTHROPIC_API_KEY  || '';

  const provider = (aiConfig?.provider as 'anthropic' | 'openrouter') ??
    (openrouterKey ? 'openrouter' : 'anthropic');

  const model = aiConfig?.model || process.env.AI_MODEL || DEFAULT_MODEL;

  const apiKey = provider === 'openrouter' ? openrouterKey : anthropicKey;

  cachedCredentials = { apiKey, model, provider };
  credentialsCachedAt = Date.now();

  return cachedCredentials;
}

export async function hasApiKey(): Promise<boolean> {
  const creds = await resolveCredentials();
  return Boolean(creds.apiKey);
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
  private anthropicSdk: Anthropic | null = null;
  private anthropicKey: string | undefined;
  private readonly dailyTokenBudget: number;

  constructor(dailyTokenBudget = 500_000) {
    this.dailyTokenBudget = dailyTokenBudget;
  }

  private getAnthropicSdk(apiKey: string): Anthropic {
    if (this.anthropicSdk && this.anthropicKey === apiKey) return this.anthropicSdk;
    this.anthropicSdk = new Anthropic({ apiKey });
    this.anthropicKey = apiKey;
    return this.anthropicSdk;
  }

  async complete(userMessage: string, options: CompleteOptions = {}): Promise<CompleteResult> {
    resetIfNewDay();

    if (dailyUsage.inputTokens + dailyUsage.outputTokens >= this.dailyTokenBudget) {
      throw new Error(`AI daily token budget exhausted (${this.dailyTokenBudget.toLocaleString()} tokens/day)`);
    }

    const creds = await resolveCredentials();

    if (creds.provider === 'openrouter') {
      return this.completeViaOpenRouter(userMessage, options, creds);
    }
    return this.completeViaAnthropic(userMessage, options, creds);
  }

  // ─── Anthropic (direct SDK) ────────────────────────────────────────────────

  private async completeViaAnthropic(
    userMessage: string,
    options: CompleteOptions,
    creds: AiCredentials,
  ): Promise<CompleteResult> {
    const sdk       = this.getAnthropicSdk(creds.apiKey);
    const model     = options.model ?? creds.model;
    const maxTokens = options.maxTokens ?? 1_024;
    const startMs   = Date.now();
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const response = await sdk.messages.create({
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

        this.trackUsage(inputTokens, outputTokens, model, 'anthropic', latencyMs, attempt);

        return { content, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, model, latencyMs };
      } catch (err) {
        lastError = err as Error;
        const status = (err as { status?: number }).status;
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) throw lastError;
        if (attempt < MAX_RETRIES) await sleep(BASE_DELAY_MS * 2 ** (attempt - 1));
      }
    }
    throw lastError ?? new Error('AI completion failed after retries');
  }

  // ─── OpenRouter (fetch-based) ──────────────────────────────────────────────

  private async completeViaOpenRouter(
    userMessage: string,
    options: CompleteOptions,
    creds: AiCredentials,
  ): Promise<CompleteResult> {
    const model     = options.model ?? creds.model;
    const maxTokens = options.maxTokens ?? 1_024;
    const startMs   = Date.now();
    let lastError: Error | null = null;

    const messages: Array<{ role: string; content: string }> = [];
    if (options.systemPrompt) {
      messages.push({ role: 'system', content: options.systemPrompt });
    }
    messages.push({ role: 'user', content: userMessage });

    for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
      try {
        const res = await fetch(OPENROUTER_URL, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${creds.apiKey}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://polymarket-trader.local',
            'X-Title': 'Polymarket AI Trader',
          },
          body: JSON.stringify({
            model,
            max_tokens: maxTokens,
            ...(options.temperature !== undefined && { temperature: options.temperature }),
            messages,
          }),
        });

        if (!res.ok) {
          const body = await res.text().catch(() => '');
          const err = new Error(`OpenRouter ${res.status}: ${body.slice(0, 200)}`);
          (err as Error & { status: number }).status = res.status;
          throw err;
        }

        const data = await res.json() as {
          choices: Array<{ message: { content: string } }>;
          usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
          model?: string;
        };

        const content      = data.choices?.[0]?.message?.content ?? '';
        const inputTokens  = data.usage?.prompt_tokens ?? 0;
        const outputTokens = data.usage?.completion_tokens ?? 0;
        const latencyMs    = Date.now() - startMs;

        this.trackUsage(inputTokens, outputTokens, model, 'openrouter', latencyMs, attempt);

        return { content, inputTokens, outputTokens, totalTokens: inputTokens + outputTokens, model, latencyMs };
      } catch (err) {
        lastError = err as Error;
        const status = (err as { status?: number }).status;
        if (status !== undefined && status >= 400 && status < 500 && status !== 429) {
          logger.error('AiClient: non-retryable OpenRouter error', { status, error: lastError.message });
          throw lastError;
        }
        if (attempt < MAX_RETRIES) {
          const delay = BASE_DELAY_MS * 2 ** (attempt - 1);
          logger.warn('AiClient: retrying OpenRouter', { attempt, delay, error: lastError.message });
          await sleep(delay);
        }
      }
    }
    throw lastError ?? new Error('OpenRouter completion failed after retries');
  }

  // ─── Shared helpers ────────────────────────────────────────────────────────

  private trackUsage(
    inputTokens: number,
    outputTokens: number,
    model: string,
    provider: string,
    latencyMs: number,
    attempt: number,
  ): void {
    dailyUsage.inputTokens  += inputTokens;
    dailyUsage.outputTokens += outputTokens;
    dailyUsage.calls        += 1;

    logger.info('AiClient: completion', {
      model,
      provider,
      inputTokens,
      outputTokens,
      latencyMs,
      dailyTotal: dailyUsage.inputTokens + dailyUsage.outputTokens,
      attempt,
    });
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
