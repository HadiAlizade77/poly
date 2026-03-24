/**
 * BTC 5-Min Market Finder — Targets REAL Polymarket 5-minute BTC Up/Down markets.
 *
 * Primary path: Fetches active markets from the Gamma API using the known slug
 * pattern `btc-updown-5m-<unix_timestamp>` where timestamps align to 5-minute
 * boundaries (divisible by 300).
 *
 * Fallback path: If the Gamma API is unreachable AND no real market is found,
 * generates a synthetic market from Binance candle data (sandbox/demo mode).
 */
import { createHash } from 'crypto';
import prisma from '../../config/database.js';
import logger from '../../config/logger.js';
import * as systemConfigService from '../system-config.service.js';

/** Generate a deterministic UUID from a string (slug-based, for DB storage). */
function slugToUuid(slug: string): string {
  const hash = createHash('sha256').update(slug).digest('hex');
  // Format as UUID v4-ish: 8-4-4-4-12
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-${hash.slice(12, 16)}-${hash.slice(16, 20)}-${hash.slice(20, 32)}`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ActiveBtcMarket {
  id: string;
  polymarket_id: string;
  title: string;
  yesPrice: number;
  noPrice: number;
  yesTokenId: string;
  noTokenId: string;
  endDate: Date | null;
  liquidity: number;
  volume24h: number;
  /** True when this market is synthesised locally (not a real Polymarket listing). */
  is_synthetic: boolean;
  /** Chainlink BTC/USD reference price at window open. */
  priceToBeat?: number;
  /** CLOB condition ID for the market. */
  conditionId?: string;
}

// ─── Gamma API response shapes ──────────────────────────────────────────────

interface GammaMarket {
  conditionId: string;
  clobTokenIds: string[];
  outcomes: string[];
  outcomePrices: string[];
  acceptingOrders: boolean;
  /**
   * ISO-8601 timestamp of when the window opened and the Chainlink reference
   * price snapshot was taken (e.g. "2026-03-24T12:45:00Z").
   */
  eventStartTime?: string;
  [key: string]: unknown;
}

interface GammaEvent {
  id: string;
  slug: string;
  title: string;
  markets: GammaMarket[];
  /**
   * ISO-8601 timestamp of when the window opened (same as
   * markets[0].eventStartTime — duplicated at event level).
   */
  startTime?: string;
  [key: string]: unknown;
}

// ─── Constants ──────────────────────────────────────────────────────────────

const GAMMA_API_BASE = 'https://gamma-api.polymarket.com';
const WINDOW_SECONDS = 300; // 5 minutes
const MIN_REMAINING_FOR_CURRENT_WINDOW_MS = 30_000; // 30 seconds

/** How long to keep a cached window before refetching (in ms). */
const CACHE_TTL_MS = 5_000;

// ─── In-memory cache ────────────────────────────────────────────────────────

interface CachedWindow {
  market: ActiveBtcMarket;
  windowEndTs: number;
  fetchedAt: number;
}

let cachedWindow: CachedWindow | null = null;

// ─── Synthetic market state ─────────────────────────────────────────────────

const SYNTHETIC_MARKET_ID       = '00000000-0000-0000-0000-b7c5a1059401';
const SYNTHETIC_POLYMARKET_ID   = 'synthetic-btc-5min-sandbox';
const SYNTHETIC_YES_TOKEN       = 'syn-btc-5min-yes';
const SYNTHETIC_NO_TOKEN        = 'syn-btc-5min-no';

// ─── Main export ────────────────────────────────────────────────────────────

export async function findActiveBtcMarket(): Promise<ActiveBtcMarket | null> {
  // 1. Try real Gamma API (primary path)
  const realMarket = await findRealBtcMarketFromGamma();
  if (realMarket) {
    // Always refresh prices to get the latest from Gamma, even if market
    // structure came from cache.
    return refreshPrices(realMarket);
  }

  // 2. No real market found — check if we're in sandbox mode for synthetic fallback
  const isSandbox = await systemConfigService.getValue<boolean>('SANDBOX_ACTIVE');
  if (!isSandbox) {
    logger.info('BtcMarketFinder: no active BTC 5-min market found and sandbox is off');
    return null;
  }

  // 3. Build a synthetic market from current BTC price data
  return buildSyntheticMarket();
}

// ─── Real market search via Gamma API ───────────────────────────────────────

async function findRealBtcMarketFromGamma(): Promise<ActiveBtcMarket | null> {
  const now = Math.floor(Date.now() / 1000);
  // Slug timestamp = window START time (not end). E.g. slug 1774353600 = window 12:00-12:05.
  // floor to the previous 5-min boundary to get the CURRENT active window's start.
  const currentWindowStart = Math.floor(now / WINDOW_SECONDS) * WINDOW_SECONDS;
  const windowEndTs = currentWindowStart + WINDOW_SECONDS;
  const msRemainingInCurrentWindow = (windowEndTs - now) * 1000;

  // Check cache first — reuse if same window and not stale
  if (cachedWindow
    && cachedWindow.windowEndTs === currentWindowStart
    && (Date.now() - cachedWindow.fetchedAt) < CACHE_TTL_MS) {
    logger.debug('BtcMarketFinder: serving from cache', {
      windowStart: currentWindowStart,
      msRemaining: msRemainingInCurrentWindow,
    });
    return cachedWindow.market;
  }

  // Determine which window slugs to try (slug = window START timestamp)
  const slugsToTry: number[] = [currentWindowStart];

  // If current window has less than 30s remaining, also try the next window
  if (msRemainingInCurrentWindow < MIN_REMAINING_FOR_CURRENT_WINDOW_MS) {
    const nextWindowStart = currentWindowStart + WINDOW_SECONDS;
    slugsToTry.push(nextWindowStart);
    logger.debug('BtcMarketFinder: current window expiring soon, also checking next', {
      currentWindowStart,
      nextWindowStart,
      msRemaining: msRemainingInCurrentWindow,
    });
  }

  // Try each window in order
  for (const slugTs of slugsToTry) {
    const market = await fetchWindowFromGamma(slugTs);
    if (market) {
      // Cache the result
      cachedWindow = {
        market,
        windowEndTs: slugTs,
        fetchedAt: Date.now(),
      };
      return market;
    }
  }

  // All windows failed
  cachedWindow = null;
  return null;
}

// ─── Fetch a single window from Gamma API ───────────────────────────────────

async function fetchWindowFromGamma(windowStartTs: number): Promise<ActiveBtcMarket | null> {
  const slug = `btc-updown-5m-${windowStartTs}`;
  const url = `${GAMMA_API_BASE}/events?slug=${slug}`;

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'Accept': 'application/json' },
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      logger.debug('BtcMarketFinder: Gamma API non-OK response', {
        slug,
        status: response.status,
        statusText: response.statusText,
      });
      return null;
    }

    const data = await response.json() as GammaEvent[] | GammaEvent;

    // Gamma returns an array of events; pick the first match
    const events = Array.isArray(data) ? data : [data];
    if (events.length === 0) {
      logger.debug('BtcMarketFinder: no events returned for slug', { slug });
      return null;
    }

    const event = events[0];

    // Validate the event has at least one market
    if (!event.markets || event.markets.length === 0) {
      logger.debug('BtcMarketFinder: event has no markets', { slug, eventId: event.id });
      return null;
    }

    const gammaMarket = event.markets[0];

    // Validate the market is accepting orders
    if (!gammaMarket.acceptingOrders) {
      logger.debug('BtcMarketFinder: market not accepting orders', {
        slug,
        conditionId: gammaMarket.conditionId,
      });
      return null;
    }

    // Parse outcomes — Polymarket uses "Up"/"Down" (not YES/NO)
    // Map: Up = YES (index 0), Down = NO (index 1)
    // NOTE: Gamma API may return these as JSON strings OR arrays
    const rawOutcomes = gammaMarket.outcomes ?? [];
    const rawPrices = gammaMarket.outcomePrices ?? [];
    const rawTokenIds = gammaMarket.clobTokenIds ?? [];

    const outcomes: string[] = typeof rawOutcomes === 'string' ? JSON.parse(rawOutcomes) : rawOutcomes;
    const prices: string[] = typeof rawPrices === 'string' ? JSON.parse(rawPrices) : rawPrices;
    const tokenIds: string[] = typeof rawTokenIds === 'string' ? JSON.parse(rawTokenIds) : rawTokenIds;

    // Find the Up and Down indices
    const upIndex = outcomes.findIndex(
      (o: string) => o.toLowerCase() === 'up',
    );
    const downIndex = outcomes.findIndex(
      (o: string) => o.toLowerCase() === 'down',
    );

    // Fallback to positional if labels aren't found
    const yesIdx = upIndex >= 0 ? upIndex : 0;
    const noIdx = downIndex >= 0 ? downIndex : 1;

    const yesPrice = prices[yesIdx] ? parseFloat(prices[yesIdx]) : 0.5;
    const noPrice = prices[noIdx] ? parseFloat(prices[noIdx]) : 0.5;
    const yesTokenId = tokenIds[yesIdx] ?? '';
    const noTokenId = tokenIds[noIdx] ?? '';

    // Parse priceToBeat — the Chainlink BTC/USD reference price at window open.
    //
    // Gamma does NOT expose this field directly in the API response.  The
    // reference price is snapshotted at the moment the window opens, which
    // is captured in market.eventStartTime (== event.startTime).  We look up
    // the nearest BTC/USDT 1-min candle from our local DB at that timestamp.
    // If no candle is available (e.g. window is brand-new), we leave it
    // undefined — bot.ts will substitute signals.current_price at window open.
    const windowOpenTime: Date | null = (() => {
      const isoStr = gammaMarket.eventStartTime ?? (event.startTime as string | undefined);
      if (!isoStr) return null;
      const d = new Date(isoStr);
      return isNaN(d.getTime()) ? null : d;
    })();

    let priceToBeat: number | undefined;
    if (windowOpenTime) {
      try {
        // Find the closest 1-min candle at or just before the window open.
        const candle = await prisma.externalDataPoint.findFirst({
          where: {
            source:    'binance',
            data_type: 'kline_1m',
            symbol:    'btcusdt',
            timestamp: { lte: windowOpenTime },
          },
          orderBy: { timestamp: 'desc' },
        });
        if (candle) {
          const v = candle.value as Record<string, unknown>;
          const closePrice = Number(v.close ?? v.c ?? 0);
          if (closePrice > 0) priceToBeat = closePrice;
        }
      } catch {
        // Non-fatal — priceToBeat stays undefined; bot.ts will fall back
      }
    }

    // endDate = window START + 5 minutes (slug is the start time, not end)
    const endDate = new Date((windowStartTs + WINDOW_SECONDS) * 1000);

    const market: ActiveBtcMarket = {
      id: slugToUuid(slug),
      polymarket_id: slug,
      title: event.title ?? `BTC Up/Down 5m — ${endDate.toISOString()}`,
      yesPrice,
      noPrice,
      yesTokenId,
      noTokenId,
      endDate,
      liquidity: 0,     // Gamma does not expose liquidity directly
      volume24h: 0,     // Gamma does not expose 24h volume directly
      is_synthetic: false,
      priceToBeat,
      conditionId: gammaMarket.conditionId,
    };

    logger.info('BtcMarketFinder: found real Gamma market', {
      slug,
      eventId: event.id,
      title: market.title,
      yesPrice: yesPrice.toFixed(4),
      noPrice: noPrice.toFixed(4),
      priceToBeat: priceToBeat != null ? `$${priceToBeat.toFixed(2)}` : 'pending (no candle at window open)',
      windowOpenTime: windowOpenTime?.toISOString() ?? 'unknown',
      conditionId: gammaMarket.conditionId,
      yesTokenId: yesTokenId.slice(0, 12) + '...',
      noTokenId: noTokenId.slice(0, 12) + '...',
      windowEnd: endDate.toISOString(),
      acceptingOrders: gammaMarket.acceptingOrders,
    });

    return market;
  } catch (err) {
    if ((err as Error).name === 'AbortError') {
      logger.warn('BtcMarketFinder: Gamma API request timed out', { slug });
    } else {
      logger.warn('BtcMarketFinder: Gamma API request failed', {
        slug,
        error: (err as Error).message,
      });
    }
    return null;
  }
}

// ─── Synthetic market builder (fallback) ────────────────────────────────────

async function buildSyntheticMarket(): Promise<ActiveBtcMarket | null> {
  // Fetch the latest BTC price from external_data_points (kline_1m or trade)
  const latestCandle = await prisma.externalDataPoint.findFirst({
    where: {
      source:    'binance',
      data_type: 'kline_1m',
      symbol:    'btcusdt',
    },
    orderBy: { timestamp: 'desc' },
  });

  if (!latestCandle) {
    logger.info('BtcMarketFinder: no BTC price data available for synthetic market');
    return null;
  }

  const value = latestCandle.value as Record<string, unknown>;
  const currentPrice = Number(value.close ?? value.c ?? 0);

  if (currentPrice <= 0) {
    logger.warn('BtcMarketFinder: invalid BTC price for synthetic market', { value });
    return null;
  }

  // Fetch the candle from ~5 minutes ago to determine trend
  const fiveMinAgo = new Date(Date.now() - 5 * 60_000);
  const olderCandle = await prisma.externalDataPoint.findFirst({
    where: {
      source:    'binance',
      data_type: 'kline_1m',
      symbol:    'btcusdt',
      timestamp: { lte: fiveMinAgo },
    },
    orderBy: { timestamp: 'desc' },
  });

  const olderValue = olderCandle?.value as Record<string, unknown> | undefined;
  const olderPrice = Number(olderValue?.close ?? olderValue?.c ?? currentPrice);

  // Generate YES/NO prices based on BTC price movement
  const priceDelta = olderPrice > 0 ? (currentPrice - olderPrice) / olderPrice : 0;

  // Map the 5-min momentum to a YES probability: 0.50 baseline, +/-0.15 max swing
  const momentumBias = Math.max(-0.15, Math.min(0.15, priceDelta * 50));
  const yesPrice     = Math.max(0.05, Math.min(0.95, 0.50 + momentumBias));
  const noPrice      = Math.max(0.05, Math.min(0.95, 1 - yesPrice));

  const endDate = new Date(Date.now() + 5 * 60_000);

  logger.info('BtcMarketFinder: created synthetic demo market', {
    btcPrice: currentPrice,
    olderPrice,
    priceDelta: (priceDelta * 100).toFixed(4) + '%',
    yesPrice: yesPrice.toFixed(4),
    noPrice:  noPrice.toFixed(4),
    endDate:  endDate.toISOString(),
  });

  return {
    id:            SYNTHETIC_MARKET_ID,
    polymarket_id: SYNTHETIC_POLYMARKET_ID,
    title:         'Will BTC go up in the next 5 minutes? (Synthetic)',
    yesPrice,
    noPrice,
    yesTokenId:    SYNTHETIC_YES_TOKEN,
    noTokenId:     SYNTHETIC_NO_TOKEN,
    endDate,
    liquidity:     10_000,
    volume24h:     5_000,
    is_synthetic:  true,
    priceToBeat:   currentPrice,
  };
}

// ─── Price refresh ──────────────────────────────────────────────────────────
//
// Fetches prices from BOTH the Gamma API (outcomePrices — what Polymarket
// displays on their website) and the CLOB midpoint. Uses Gamma as the primary
// source since it matches the Polymarket UI. Falls back to CLOB if Gamma fails.

const CLOB_API_BASE = 'https://clob.polymarket.com';

export async function refreshPrices(market: ActiveBtcMarket): Promise<ActiveBtcMarket> {
  if (market.is_synthetic) return market;
  if (!market.yesTokenId || !market.noTokenId) return market;

  let newYes = market.yesPrice;
  let newNo = market.noPrice;
  let source = 'cache';

  // Primary: CLOB midpoint — real-time orderbook prices that update per-second.
  // Gamma API caches outcomePrices and is often minutes stale.
  try {
    const [yesRes, noRes] = await Promise.all([
      fetch(`${CLOB_API_BASE}/midpoint?token_id=${market.yesTokenId}`, {
        signal: AbortSignal.timeout(2000),
      }),
      fetch(`${CLOB_API_BASE}/midpoint?token_id=${market.noTokenId}`, {
        signal: AbortSignal.timeout(2000),
      }),
    ]);

    if (yesRes.ok) {
      const yesData = await yesRes.json() as Record<string, string>;
      if (yesData.mid) { newYes = parseFloat(yesData.mid); source = 'clob'; }
    }
    if (noRes.ok) {
      const noData = await noRes.json() as Record<string, string>;
      if (noData.mid) { newNo = parseFloat(noData.mid); source = 'clob'; }
    }
  } catch {
    // CLOB failed — return cached prices
  }

  if (newYes !== market.yesPrice || newNo !== market.noPrice) {
    logger.debug('BtcMarketFinder: prices refreshed', {
      source,
      oldUp: market.yesPrice.toFixed(4),
      newUp: newYes.toFixed(4),
      oldDown: market.noPrice.toFixed(4),
      newDown: newNo.toFixed(4),
    });
  }

  return { ...market, yesPrice: newYes, noPrice: newNo };
}

// ─── Exports for testing ────────────────────────────────────────────────────

/** Clear the in-memory cache (useful for tests). */
export function clearCache(): void {
  cachedWindow = null;
}

/** Exposed for tests: compute the current window start timestamp (= slug). */
export function computeCurrentWindowEnd(): number {
  const now = Math.floor(Date.now() / 1000);
  return Math.floor(now / WINDOW_SECONDS) * WINDOW_SECONDS;
}

/** Exposed for tests: compute the slug for a given window end timestamp. */
export function computeSlug(windowEndTs: number): string {
  return `btc-updown-5m-${windowEndTs}`;
}
