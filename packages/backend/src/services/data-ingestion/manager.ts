// ─── Feed Manager ───────────────────────────────────────────────────────────

import type { Prisma } from '@prisma/client';
import logger from '../../config/logger.js';
import type { FeedModule, NormalizedDataPoint } from './feed.interface.js';
import { prisma } from '../../config/database.js';

const HEALTH_CHECK_INTERVAL_MS = 30_000; // 30s
const STALE_THRESHOLD_MS = 120_000; // 2 min without messages = stale

export class FeedManager {
  private feeds: FeedModule[] = [];
  private healthTimer: ReturnType<typeof setInterval> | null = null;
  private running = false;

  /**
   * Register a feed module with the manager.
   */
  register(feed: FeedModule): void {
    if (this.running) {
      throw new Error('Cannot register feeds after manager has started');
    }
    this.feeds.push(feed);
    logger.info('Feed registered', { feed: feed.name });
  }

  /**
   * Connect all enabled feeds, set up data persistence, and start health monitoring.
   */
  async start(): Promise<void> {
    this.running = true;

    const enabled = this.feeds.filter((f) => f.isEnabled());
    logger.info('Starting feed manager', {
      total: this.feeds.length,
      enabled: enabled.length,
      disabled: this.feeds.filter((f) => !f.isEnabled()).map((f) => f.name),
    });

    // Wire up data handler on every feed (persist to DB)
    for (const feed of this.feeds) {
      feed.onData((data) => {
        void this.persistDataPoint(data);
      });
    }

    // Connect enabled feeds concurrently, don't let one failure block others
    const results = await Promise.allSettled(
      enabled.map(async (feed) => {
        try {
          await feed.connect();
          logger.info('Feed connected', { feed: feed.name });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Feed failed to connect', { feed: feed.name, error: msg });
        }
      }),
    );

    const succeeded = results.filter((r) => r.status === 'fulfilled').length;
    logger.info('Feed startup complete', { succeeded, failed: results.length - succeeded });

    // Start health monitor
    this.healthTimer = setInterval(() => {
      this.checkHealth();
    }, HEALTH_CHECK_INTERVAL_MS);
  }

  /**
   * Gracefully disconnect all feeds and stop monitoring.
   */
  async stop(): Promise<void> {
    this.running = false;

    if (this.healthTimer) {
      clearInterval(this.healthTimer);
      this.healthTimer = null;
    }

    logger.info('Stopping all feeds...');

    await Promise.allSettled(
      this.feeds.map(async (feed) => {
        try {
          await feed.disconnect();
          logger.info('Feed disconnected', { feed: feed.name });
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Feed disconnect error', { feed: feed.name, error: msg });
        }
      }),
    );

    logger.info('Feed manager stopped');
  }

  /**
   * Get health status of all feeds.
   */
  getHealth(): Record<string, ReturnType<FeedModule['health']>> {
    const result: Record<string, ReturnType<FeedModule['health']>> = {};
    for (const feed of this.feeds) {
      result[feed.name] = feed.health();
    }
    return result;
  }

  /**
   * Get list of registered feeds.
   */
  getFeeds(): Array<{ name: string; enabled: boolean; health: ReturnType<FeedModule['health']> }> {
    return this.feeds.map((f) => ({
      name: f.name,
      enabled: f.isEnabled(),
      health: f.health(),
    }));
  }

  private checkHealth(): void {
    const now = Date.now();

    for (const feed of this.feeds) {
      if (!feed.isEnabled()) continue;

      const h = feed.health();

      // Check for stale feeds
      if (h.connected && h.lastMessageAt) {
        const age = now - h.lastMessageAt.getTime();
        if (age > STALE_THRESHOLD_MS) {
          logger.warn('Feed stale — no messages received recently', {
            feed: feed.name,
            lastMessageAge: Math.round(age / 1000),
          });
        }
      }

      // Check for disconnected feeds — attempt reconnect
      if (!h.connected) {
        logger.warn('Feed disconnected — attempting reconnect', { feed: feed.name });
        void feed.connect().catch((err) => {
          const msg = err instanceof Error ? err.message : String(err);
          logger.error('Feed reconnect failed', { feed: feed.name, error: msg });
        });
      }

      if (h.status === 'degraded') {
        logger.warn('Feed degraded', { feed: feed.name, errorCount: h.errorCount });
      }
    }
  }

  private async persistDataPoint(data: NormalizedDataPoint): Promise<void> {
    try {
      await prisma.externalDataPoint.create({
        data: {
          source: data.source,
          data_type: data.data_type,
          symbol: data.symbol,
          timestamp: data.timestamp,
          value: data.value as Prisma.InputJsonValue,
          metadata: (data.metadata ?? undefined) as Prisma.InputJsonValue | undefined,
        },
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      logger.error('Failed to persist data point', {
        source: data.source,
        data_type: data.data_type,
        error: msg,
      });
    }
  }
}
