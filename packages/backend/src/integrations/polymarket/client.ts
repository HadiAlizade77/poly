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
      this.gamma.get<PolymarketMarket[]>('/markets', {
        params: { active: true, archived: false, closed: false, offset, limit },
      }),
    );

    return Array.isArray(res.data) ? res.data : [];
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
        this.gamma.get<PolymarketMarket>(`/markets/${conditionId}`),
      );
      return res.data;
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
