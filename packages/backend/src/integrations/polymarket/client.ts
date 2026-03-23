/**
 * Polymarket REST API client.
 *
 * In demo mode (no API key) all calls return deterministic synthetic markets
 * so the scanner works end-to-end without real credentials.
 *
 * Endpoints:
 *   Gamma API  — https://gamma-api.polymarket.com  (market metadata)
 *   CLOB API   — https://clob.polymarket.com       (order books / prices)
 */
import axios, { type AxiosInstance, type AxiosError } from 'axios';
import logger from '../../config/logger.js';
import type { PolymarketMarket, ClobOrderBook } from './types.js';
import { DEMO_MARKETS } from './demo-data.js';

const GAMMA_BASE = process.env.POLYMARKET_GAMMA_URL ?? 'https://gamma-api.polymarket.com';
const CLOB_BASE  = process.env.POLYMARKET_API_URL   ?? 'https://clob.polymarket.com';

// ─── Retry helper ─────────────────────────────────────────────────────────────

async function withRetry<T>(fn: () => Promise<T>, retries = 3, baseDelay = 500): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = (err as AxiosError)?.response?.status ?? 0;
      // Don't retry on 4xx client errors (except 429 rate limit)
      if (status >= 400 && status < 500 && status !== 429) throw err;
      if (attempt < retries) {
        const delay = baseDelay * 2 ** (attempt - 1);
        logger.warn('Polymarket API retrying', { attempt, delay, status });
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw lastErr;
}

// ─── Client ───────────────────────────────────────────────────────────────────

export class PolymarketClient {
  private readonly gamma: AxiosInstance;
  private readonly clob: AxiosInstance;
  readonly demoMode: boolean;

  constructor(apiKey?: string) {
    this.demoMode = !apiKey;

    const headers = apiKey ? { 'POLY-API-KEY': apiKey } : {};

    this.gamma = axios.create({
      baseURL: GAMMA_BASE,
      timeout: 15_000,
      headers,
    });

    this.clob = axios.create({
      baseURL: CLOB_BASE,
      timeout: 15_000,
      headers,
    });

    if (this.demoMode) {
      logger.info('PolymarketClient: running in DEMO mode (no API key)');
    }
  }

  /**
   * Fetch one page of active markets.
   */
  async getActiveMarkets(offset = 0, limit = 100): Promise<PolymarketMarket[]> {
    if (this.demoMode) {
      return DEMO_MARKETS.slice(offset, offset + limit);
    }

    const res = await withRetry(() =>
      this.gamma.get<GammaMarketRaw[]>('/markets', {
        params: { active: true, archived: false, closed: false, offset, limit },
      }),
    );

    const raw = Array.isArray(res.data) ? res.data : [];
    return raw.map(normalizeGammaMarket).filter((m): m is PolymarketMarket => m !== null);
  }

  /**
   * Fetch ALL active markets, paginating automatically up to `maxPages`.
   */
  async getAllActiveMarkets(maxPages = 20): Promise<PolymarketMarket[]> {
    if (this.demoMode) return [...DEMO_MARKETS];

    const markets: PolymarketMarket[] = [];
    let offset = 0;
    const limit = 100;

    for (let page = 0; page < maxPages; page++) {
      const batch = await this.getActiveMarkets(offset, limit);
      if (batch.length === 0) break;
      markets.push(...batch);
      if (batch.length < limit) break;
      offset += limit;
    }

    logger.info('PolymarketClient: fetched markets', { count: markets.length });
    return markets;
  }

  /**
   * Fetch a single market by condition_id (Gamma API).
   */
  async getMarket(conditionId: string): Promise<PolymarketMarket | null> {
    if (this.demoMode) {
      return DEMO_MARKETS.find((m) => m.condition_id === conditionId) ?? null;
    }

    try {
      const res = await withRetry(() =>
        this.gamma.get<GammaMarketRaw>(`/markets/${conditionId}`),
      );
      return normalizeGammaMarket(res.data);
    } catch (err) {
      logger.warn('PolymarketClient: getMarket failed', {
        conditionId,
        error: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * Fetch the mid-price for a single token (CLOB API).
   * Returns a number 0-1 or null on failure.
   */
  async getPrice(tokenId: string): Promise<number | null> {
    if (this.demoMode) {
      return parseFloat((0.3 + Math.random() * 0.4).toFixed(4));
    }

    try {
      const res = await withRetry(() =>
        this.clob.get<{ price: string }>('/price', {
          params: { token_id: tokenId, side: 'BUY' },
        }),
      );
      return parseFloat(res.data.price);
    } catch (err) {
      logger.warn('PolymarketClient: getPrice failed', {
        tokenId,
        error: (err as Error).message,
      });
      return null;
    }
  }

  /**
   * Fetch order book for a single token (CLOB API).
   */
  async getOrderBook(tokenId: string): Promise<ClobOrderBook | null> {
    if (this.demoMode) {
      return buildDemoOrderBook(tokenId);
    }

    try {
      const res = await withRetry(() =>
        this.clob.get<ClobOrderBook>(`/book`, { params: { token_id: tokenId } }),
      );
      return res.data;
    } catch (err) {
      logger.warn('PolymarketClient: order book fetch failed', {
        tokenId,
        error: (err as Error).message,
      });
      return null;
    }
  }
}

// ─── Gamma API normalizer ─────────────────────────────────────────────────────
//
// The Gamma API (/markets) returns a different shape from the CLOB API and from
// what PolymarketMarket expects. This function bridges the gap.

interface GammaMarketRaw {
  id?: string;
  conditionId?: string;
  questionID?: string;
  question?: string;
  description?: string;
  slug?: string;
  endDate?: string;
  endDateIso?: string;
  outcomes?: string;        // JSON array string: '["Yes","No"]'
  outcomePrices?: string;   // JSON array string: '["0.6","0.4"]'
  clobTokenIds?: string;    // JSON array string: '["tokenId1","tokenId2"]'
  volume?: string | number;
  volume24hr?: string | number;
  liquidity?: string | number;
  active?: boolean;
  closed?: boolean;
  archived?: boolean;
  negRisk?: boolean;
  neg_risk?: boolean;
  tags?: unknown[];
  [key: string]: unknown;
}

function normalizeGammaMarket(raw: GammaMarketRaw): PolymarketMarket | null {
  const conditionId = raw.conditionId ?? raw.condition_id as string | undefined;
  if (!conditionId || !raw.question) return null;

  // Parse JSON-string arrays from the Gamma API
  let outcomes: string[] = [];
  let prices: number[] = [];
  let tokenIds: string[] = [];

  try { outcomes = JSON.parse(raw.outcomes ?? '[]') as string[]; } catch { /* skip */ }
  try {
    const p = JSON.parse(raw.outcomePrices ?? '[]') as (string | number)[];
    prices = p.map(Number);
  } catch { /* skip */ }
  try { tokenIds = JSON.parse(raw.clobTokenIds ?? '[]') as string[]; } catch { /* skip */ }

  const tokens = outcomes.map((outcome, i) => ({
    token_id: tokenIds[i] ?? '',
    outcome,
    price: prices[i] ?? 0,
  }));

  return {
    condition_id: conditionId,
    question_id:  raw.questionID ?? raw.question_id as string | undefined,
    question:     raw.question,
    description:  raw.description,
    market_slug:  raw.slug ?? raw.market_slug as string | undefined,
    end_date_iso: raw.endDate ?? raw.endDateIso ?? raw.end_date_iso as string | undefined,
    tokens,
    tags:         raw.tags as PolymarketMarket['tags'],
    active:       raw.active ?? true,
    closed:       raw.closed ?? false,
    archived:     raw.archived ?? false,
    neg_risk:     raw.negRisk ?? raw.neg_risk ?? false,
    volume_24hr:  raw.volume24hr !== undefined ? String(raw.volume24hr) : undefined,
    liquidity:    raw.liquidity  !== undefined ? String(raw.liquidity)  : undefined,
  };
}

// ─── Demo helpers ──────────────────────────────────────────────────────────────

function buildDemoOrderBook(tokenId: string): ClobOrderBook {
  const mid = 0.45 + Math.random() * 0.1; // 0.45 – 0.55
  return {
    market: `demo-market-${tokenId.slice(0, 8)}`,
    asset_id: tokenId,
    bids: [
      { price: (mid - 0.01).toFixed(4), size: String(50 + Math.floor(Math.random() * 200)) },
      { price: (mid - 0.02).toFixed(4), size: String(30 + Math.floor(Math.random() * 100)) },
    ],
    asks: [
      { price: (mid + 0.01).toFixed(4), size: String(50 + Math.floor(Math.random() * 200)) },
      { price: (mid + 0.02).toFixed(4), size: String(30 + Math.floor(Math.random() * 100)) },
    ],
    timestamp: new Date().toISOString(),
  };
}
