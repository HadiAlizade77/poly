/**
 * Market Scanner service.
 *
 * On each tick:
 *  1. Fetch active markets from Polymarket (or demo data)
 *  2. Upsert each market into the `markets` table, classifying new ones by keyword
 *  3. Take a price/spread snapshot into `market_snapshots`
 *  4. Emit Socket.IO market:update events via the websocket emit helpers
 *  5. Publish to Redis pub/sub so other backend services can react
 *
 * The scanner also listens on the Polymarket WebSocket for real-time price
 * changes between full scans and writes incremental snapshots.
 */
import type { Market, Prisma } from '@prisma/client';
import logger from '../../config/logger.js';
import { redis } from '../../config/redis.js';
import { PolymarketClient } from '../../integrations/polymarket/client.js';
import { PolymarketWebSocket } from '../../integrations/polymarket/websocket.js';
import type { PolymarketMarket, ScannerConfig } from '../../integrations/polymarket/types.js';
import { classifyMarket } from './classifier.js';
import * as marketService from '../market.service.js';
import * as marketSnapshotService from '../market-snapshot.service.js';
import * as systemConfigService from '../system-config.service.js';
import { emitMarketUpdate } from '../../websocket/emit.js';

const DEFAULT_CONFIG: ScannerConfig = {
  intervalMs:        30_000,  // full scan every 30 s (overridden by system_config)
  batchSize:         100,
  maxPages:          20,
  demoMode:          !process.env.POLYMARKET_API_KEY,
  demoMarketCount:   20,
  redisChannel:      'market:updates',
};

// ─── Snapshot helpers ─────────────────────────────────────────────────────────

function extractPrices(market: PolymarketMarket): Record<string, number> {
  return Object.fromEntries(
    market.tokens.map((t) => [t.outcome, t.price]),
  );
}

function computeSpread(market: PolymarketMarket): string | null {
  if (market.tokens.length < 2) return null;
  const prices = market.tokens.map((t) => t.price).sort((a, b) => a - b);
  const spread = prices[prices.length - 1] - prices[0];
  return spread.toFixed(6);
}

// ─── Market mapper ────────────────────────────────────────────────────────────

function toUpsertPayload(
  pm: PolymarketMarket,
  category: Market['category'],
): {
  create: Prisma.MarketUncheckedCreateInput;
  update: Prisma.MarketUncheckedUpdateInput;
} {
  const tags = (pm.tags ?? []).map((t) =>
    typeof t === 'string' ? t : (t as { label?: string }).label ?? '',
  );

  const outcomes = pm.tokens.map((t) => ({ tokenId: t.token_id, outcome: t.outcome }));
  const currentPrices = extractPrices(pm);

  const shared = {
    slug:          pm.market_slug ?? null,
    title:         pm.question,
    description:   pm.description ?? null,
    status:        (pm.closed ? 'closed' : pm.archived ? 'excluded' : 'active') as Market['status'],
    outcomes:      outcomes as Prisma.InputJsonValue,
    current_prices: currentPrices as Prisma.InputJsonValue,
    volume_24h:    pm.volume_24hr ? pm.volume_24hr : null,
    liquidity:     pm.liquidity ?? null,
    end_date:      pm.end_date_iso ? new Date(pm.end_date_iso) : null,
    tags,
    is_tradeable:  pm.active && !pm.closed && !pm.archived,
  };

  return {
    create: { ...shared, category, polymarket_id: pm.condition_id },
    update: shared,
  };
}

// ─── Scanner ─────────────────────────────────────────────────────────────────

export class MarketScanner {
  private readonly client: PolymarketClient;
  private readonly ws: PolymarketWebSocket;
  private readonly cfg: ScannerConfig;
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  /** Map condition_id → internal Market.id for snapshot writes */
  private marketIdCache = new Map<string, string>();

  constructor(config: Partial<ScannerConfig> = {}) {
    this.cfg = { ...DEFAULT_CONFIG, ...config };
    this.client = new PolymarketClient(process.env.POLYMARKET_API_KEY);
    this.ws     = new PolymarketWebSocket({ demoMode: this.cfg.demoMode });
  }

  // ─── Lifecycle ─────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    void this.startAsync();
  }

  private async startAsync(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Read interval from system_config if available
    try {
      const cfgValue = await systemConfigService.getValue<number>('SCANNER_INTERVAL_MS');
      if (cfgValue !== null && cfgValue > 0) {
        (this.cfg as { intervalMs: number }).intervalMs = cfgValue;
      }
    } catch {
      // system_config unavailable — use default
    }

    logger.info('MarketScanner: starting', {
      demoMode:   this.cfg.demoMode,
      intervalMs: this.cfg.intervalMs,
    });

    // Wire WebSocket price updates → incremental snapshots
    this.ws.on('priceChange', (event) => {
      const marketDbId = this.marketIdCache.get(event.market);
      if (!marketDbId) return;

      void marketSnapshotService.create({
        market_id: marketDbId,
        timestamp: new Date(event.timestamp),
        prices:    { [event.outcome]: parseFloat(event.price) } as Prisma.InputJsonValue,
        metadata:  { source: 'ws', asset_id: event.asset_id } as Prisma.InputJsonValue,
      }).catch((err: Error) =>
        logger.warn('MarketScanner: WS snapshot write failed', { error: err.message }),
      );
    });

    this.ws.connect();

    // Run immediately then on interval
    void this.scan();
    this.intervalId = setInterval(() => void this.scan(), this.cfg.intervalMs);
    this.intervalId.unref();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    this.ws.disconnect();
    logger.info('MarketScanner: stopped');
  }

  // ─── Scan loop ─────────────────────────────────────────────────────────────

  private async scan(): Promise<void> {
    const startMs = Date.now();
    logger.info('MarketScanner: scan started');

    let fetched  = 0;
    let upserted = 0;
    let snapped  = 0;

    try {
      const markets = await this.client.getAllActiveMarkets(this.cfg.maxPages);
      fetched = markets.length;

      const newTokenIds: string[] = [];

      for (const pm of markets) {
        try {
          const category = classifyMarket(
            pm.question,
            pm.description,
            pm.tags as Array<string | { label?: string; slug?: string }>,
          );

          const { create, update } = toUpsertPayload(pm, category);
          const market = await marketService.upsert(pm.condition_id, create, update);
          upserted++;

          // Cache condition_id → DB uuid for snapshot writes
          this.marketIdCache.set(pm.condition_id, market.id);

          // Subscribe to WS updates for this market's tokens
          for (const token of pm.tokens) {
            if (!this.ws.listenerCount('priceChange')) continue;
            newTokenIds.push(token.token_id);
          }

          // Write full snapshot
          const snapshot = await this.writeSnapshot(pm, market.id);
          if (snapshot) snapped++;

          // Socket.IO real-time update (frontend clients)
          emitMarketUpdate(market.id, market);

          // Redis pub/sub (backend services — strategy engine etc.)
          await this.publishToRedis(pm, market);
        } catch (err) {
          logger.warn('MarketScanner: failed to process market', {
            conditionId: pm.condition_id,
            error: (err as Error).message,
          });
        }
      }

      // Subscribe any new token IDs to the WS feed
      if (newTokenIds.length > 0) {
        this.ws.subscribe(newTokenIds);
      }

      logger.info('MarketScanner: scan complete', {
        fetched,
        upserted,
        snapped,
        durationMs: Date.now() - startMs,
      });
    } catch (err) {
      logger.error('MarketScanner: scan failed', {
        error: (err as Error).message,
        durationMs: Date.now() - startMs,
      });
    }
  }

  private async writeSnapshot(
    pm: PolymarketMarket,
    marketDbId: string,
  ): Promise<boolean> {
    try {
      await marketSnapshotService.create({
        market_id: marketDbId,
        timestamp: new Date(),
        prices:    extractPrices(pm) as Prisma.InputJsonValue,
        spread:    computeSpread(pm),
        volume_1h: null,
        liquidity: pm.liquidity ?? null,
        metadata:  { source: this.cfg.demoMode ? 'demo' : 'gamma' } as Prisma.InputJsonValue,
      });
      return true;
    } catch (err) {
      logger.warn('MarketScanner: snapshot write failed', {
        marketDbId,
        error: (err as Error).message,
      });
      return false;
    }
  }

  private async publishToRedis(pm: PolymarketMarket, market: Market): Promise<void> {
    try {
      const payload = JSON.stringify({
        event:       'market:update',
        marketId:    market.id,
        polyId:      pm.condition_id,
        category:    market.category,
        status:      market.status,
        prices:      extractPrices(pm),
        volume24h:   pm.volume_24hr ?? null,
        liquidity:   pm.liquidity ?? null,
        isTradeable: market.is_tradeable,
        timestamp:   new Date().toISOString(),
      });
      await redis.publish(this.cfg.redisChannel, payload);
    } catch (err) {
      logger.warn('MarketScanner: Redis publish failed', { error: (err as Error).message });
    }
  }
}
