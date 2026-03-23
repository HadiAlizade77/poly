import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import * as systemConfigService from '../services/system-config.service.js';
import { sendItem } from '../utils/response.js';
import { redis } from '../config/redis.js';
import logger from '../config/logger.js';

// ─── Credential key constants ─────────────────────────────────────────────────

const CREDENTIAL_KEYS = [
  'polymarket_api_key',
  'polymarket_secret',
  'polymarket_passphrase',
  'polymarket_wallet',
  'polymarket_private_key',
  'anthropic_api_key',
  'openrouter_api_key',
  'news_api_key',
  'odds_api_key',
  'polygon_rpc_url',
] as const;

type CredentialKey = (typeof CREDENTIAL_KEYS)[number];

const ENV_KEY_MAP: Record<CredentialKey, string> = {
  polymarket_api_key: 'POLYMARKET_API_KEY',
  polymarket_secret: 'POLYMARKET_SECRET',
  polymarket_passphrase: 'POLYMARKET_PASSPHRASE',
  polymarket_wallet: 'POLYMARKET_WALLET',
  polymarket_private_key: 'POLYMARKET_PRIVATE_KEY',
  anthropic_api_key: 'ANTHROPIC_API_KEY',
  openrouter_api_key: 'OPENROUTER_API_KEY',
  news_api_key: 'NEWS_API_KEY',
  odds_api_key: 'ODDS_API_KEY',
  polygon_rpc_url: 'POLYGON_RPC_URL',
};

// ─── AI config key constants ──────────────────────────────────────────────────

const AI_CONFIG_KEY = 'ai_config';

interface AiConfig {
  provider: 'anthropic' | 'openrouter';
  model: string;
  temperature: number;
  max_tokens: number;
}

const AI_CONFIG_DEFAULTS: AiConfig = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  temperature: 0.7,
  max_tokens: 4096,
};

// ─── OpenRouter cache ─────────────────────────────────────────────────────────

const OPENROUTER_CACHE_KEY = 'cache:openrouter:models';
const OPENROUTER_CACHE_TTL_SECONDS = 3600; // 1 hour

// ─── Helpers ──────────────────────────────────────────────────────────────────

function maskSecret(value: string): string {
  if (!value || value.length < 8) return '****';
  return `${value.slice(0, 4)}...${value.slice(-4)}`;
}

async function getCredentialValue(key: CredentialKey): Promise<string> {
  // Prefer DB value, fall back to env
  const record = await systemConfigService.getValue<string>(key);
  if (record) return record;
  return process.env[ENV_KEY_MAP[key]] ?? '';
}

// ─── Hardcoded fallback model list ────────────────────────────────────────────

const FALLBACK_MODELS = [
  {
    id: 'anthropic/claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    context_length: 200000,
    pricing: { prompt: '0.000003', completion: '0.000015' },
  },
  {
    id: 'anthropic/claude-opus-4',
    name: 'Claude Opus 4',
    context_length: 200000,
    pricing: { prompt: '0.000015', completion: '0.000075' },
  },
  {
    id: 'anthropic/claude-haiku-3-5',
    name: 'Claude Haiku 3.5',
    context_length: 200000,
    pricing: { prompt: '0.0000008', completion: '0.000004' },
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    context_length: 128000,
    pricing: { prompt: '0.000005', completion: '0.000015' },
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    context_length: 128000,
    pricing: { prompt: '0.00000015', completion: '0.0000006' },
  },
  {
    id: 'google/gemini-pro-1.5',
    name: 'Gemini Pro 1.5',
    context_length: 1000000,
    pricing: { prompt: '0.0000025', completion: '0.0000075' },
  },
  {
    id: 'meta-llama/llama-3.1-405b-instruct',
    name: 'Llama 3.1 405B Instruct',
    context_length: 131072,
    pricing: { prompt: '0.000003', completion: '0.000003' },
  },
  {
    id: 'mistralai/mistral-large',
    name: 'Mistral Large',
    context_length: 128000,
    pricing: { prompt: '0.000003', completion: '0.000009' },
  },
];

// ─── Controllers ──────────────────────────────────────────────────────────────

export async function getCredentials(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const result: Record<string, string> = {};

    await Promise.all(
      CREDENTIAL_KEYS.map(async (key) => {
        const value = await getCredentialValue(key);
        result[key] = value ? maskSecret(value) : '';
      }),
    );

    sendItem(res, result);
  } catch (err) {
    next(err);
  }
}

export async function setCredentials(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as Partial<Record<CredentialKey, string>>;
    const updatedBy = req.user?.sub;

    await Promise.all(
      CREDENTIAL_KEYS.filter((key) => body[key] !== undefined && body[key] !== '').map(
        async (key) => {
          const value = body[key] as string;
          await systemConfigService.set(key, value, `API credential: ${key}`, updatedBy);
          // Update running process environment immediately
          process.env[ENV_KEY_MAP[key]] = value;
        },
      ),
    );

    logger.info('Credentials updated', {
      fields: CREDENTIAL_KEYS.filter((k) => body[k] !== undefined && body[k] !== ''),
      updatedBy,
    });

    sendItem(res, { message: 'Credentials updated successfully' });
  } catch (err) {
    next(err);
  }
}

export async function getAiConfig(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const stored = await systemConfigService.getValue<Partial<AiConfig>>(AI_CONFIG_KEY);

    const aiConfig: AiConfig = {
      ...AI_CONFIG_DEFAULTS,
      ...(stored ?? {}),
    };

    sendItem(res, aiConfig);
  } catch (err) {
    next(err);
  }
}

export async function setAiConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const body = req.body as Partial<AiConfig>;
    const updatedBy = req.user?.sub;

    // Merge with existing config to allow partial updates
    const existing =
      (await systemConfigService.getValue<Partial<AiConfig>>(AI_CONFIG_KEY)) ?? {};

    const merged: AiConfig = {
      ...AI_CONFIG_DEFAULTS,
      ...existing,
      ...body,
    };

    await systemConfigService.set(AI_CONFIG_KEY, merged, 'AI model configuration', updatedBy);

    logger.info('AI config updated', { config: merged, updatedBy });

    sendItem(res, { message: 'AI configuration updated successfully', config: merged });
  } catch (err) {
    next(err);
  }
}

interface OpenRouterModel {
  id: string;
  name: string;
  context_length: number;
  pricing: {
    prompt: string;
    completion: string;
  };
}

export async function getOpenRouterModels(
  _req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    // Check Redis cache first
    const cached = await redis.get(OPENROUTER_CACHE_KEY);
    if (cached) {
      sendItem(res, JSON.parse(cached) as OpenRouterModel[]);
      return;
    }

    // Resolve API key: DB first, then env
    const apiKeyFromDb = await systemConfigService.getValue<string>('openrouter_api_key');
    const openrouterApiKey = apiKeyFromDb || process.env['OPENROUTER_API_KEY'];

    if (!openrouterApiKey) {
      // No key available — return fallback list
      sendItem(res, FALLBACK_MODELS);
      return;
    }

    // Fetch from OpenRouter
    const response = await fetch('https://openrouter.ai/api/v1/models', {
      headers: {
        Authorization: `Bearer ${openrouterApiKey}`,
        'Content-Type': 'application/json',
      },
    });

    if (!response.ok) {
      logger.warn('OpenRouter models fetch failed, using fallback', {
        status: response.status,
      });
      sendItem(res, FALLBACK_MODELS);
      return;
    }

    const raw = (await response.json()) as {
      data: Array<{
        id: string;
        name: string;
        context_length: number;
        pricing?: { prompt?: string; completion?: string };
      }>;
    };

    const models: OpenRouterModel[] = (raw.data ?? []).map((m) => ({
      id: m.id,
      name: m.name,
      context_length: m.context_length ?? 0,
      pricing: {
        prompt: m.pricing?.prompt ?? '0',
        completion: m.pricing?.completion ?? '0',
      },
    }));

    // Cache for 1 hour
    await redis.setex(OPENROUTER_CACHE_KEY, OPENROUTER_CACHE_TTL_SECONDS, JSON.stringify(models));

    sendItem(res, models);
  } catch (err) {
    logger.warn('OpenRouter models fetch error, using fallback', {
      error: (err as Error).message,
    });
    // On any unexpected error, return the fallback list rather than 500
    try {
      sendItem(res, FALLBACK_MODELS);
    } catch (sendErr) {
      next(sendErr);
    }
  }
}

// ─── Zod schemas (exported for route validation) ──────────────────────────────

export const credentialsBodySchema = z
  .object({
    polymarket_api_key: z.string().optional(),
    polymarket_secret: z.string().optional(),
    polymarket_passphrase: z.string().optional(),
    polymarket_wallet: z.string().optional(),
    polymarket_private_key: z.string().optional(),
    anthropic_api_key: z.string().optional(),
    openrouter_api_key: z.string().optional(),
    news_api_key: z.string().optional(),
    odds_api_key: z.string().optional(),
    polygon_rpc_url: z.string().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, {
    message: 'At least one credential field must be provided',
  });

export const aiConfigBodySchema = z.object({
  provider: z.enum(['anthropic', 'openrouter']).optional(),
  model: z.string().min(1).optional(),
  temperature: z.number().min(0).max(2).optional(),
  max_tokens: z.number().int().min(1).max(200000).optional(),
});
