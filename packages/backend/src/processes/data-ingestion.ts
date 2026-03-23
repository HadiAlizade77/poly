// ─── Data Ingestion PM2 Entry Point ─────────────────────────────────────────

import dotenv from 'dotenv';
dotenv.config();

import logger from '../config/logger.js';
import { prisma, disconnectDatabase } from '../config/database.js';
import { redis } from '../config/redis.js';
import { FeedManager } from '../services/data-ingestion/manager.js';
import { BinanceFeed } from '../services/data-ingestion/feeds/binance.feed.js';
import { NewsFeed } from '../services/data-ingestion/feeds/news.feed.js';
import { PollingFeed } from '../services/data-ingestion/feeds/polling.feed.js';
import { SportsOddsFeed } from '../services/data-ingestion/feeds/sports-odds.feed.js';

const manager = new FeedManager();

async function main(): Promise<void> {
  logger.info('─── Data Ingestion Service Starting ───');

  // Verify DB connectivity
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Database connected');

  // Verify Redis connectivity
  await redis.ping();
  logger.info('Redis connected');

  // Register all feeds
  manager.register(new BinanceFeed());
  manager.register(new NewsFeed());
  manager.register(new PollingFeed());
  manager.register(new SportsOddsFeed());

  // Start
  await manager.start();

  logger.info('─── Data Ingestion Service Running ───');

  // Log health every 60s
  setInterval(() => {
    const health = manager.getHealth();
    logger.info('Feed health check', { feeds: health });
  }, 60_000);
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} — shutting down data ingestion`);

  try {
    await manager.stop();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    logger.error('Error stopping feed manager', { error: msg });
  }

  try {
    await disconnectDatabase();
  } catch {
    // Already logged inside disconnectDatabase
  }

  try {
    redis.disconnect();
  } catch {
    // Best-effort
  }

  logger.info('Data ingestion shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err) => {
  logger.error('Data ingestion fatal error', { error: err instanceof Error ? err.message : String(err) });
  process.exit(1);
});
