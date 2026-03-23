/**
 * PM2 entry point for the Market Scanner process.
 *
 * Lifecycle:
 *   start → connect DB + Redis → start scanner loop → run until SIGTERM/SIGINT
 *
 * The process runs independently of the Express API server.
 * It shares the same PostgreSQL database and Redis instance.
 *
 * Demo mode is automatic when POLYMARKET_API_KEY is absent.
 */
import 'dotenv/config';
import logger from '../config/logger.js';
import { disconnectDatabase } from '../config/database.js';
import { redis } from '../config/redis.js';
import { MarketScanner } from '../services/market-scanner/scanner.js';

const scanner = new MarketScanner({
  intervalMs:        parseInt(process.env.SCANNER_INTERVAL_MS ?? '60000', 10),
  batchSize:         parseInt(process.env.SCANNER_BATCH_SIZE  ?? '100',   10),
  maxPages:          parseInt(process.env.SCANNER_MAX_PAGES   ?? '20',    10),
  demoMode:          !process.env.POLYMARKET_API_KEY,
});

// ─── Start ────────────────────────────────────────────────────────────────────

logger.info('Market Scanner process starting', {
  pid:      process.pid,
  demoMode: !process.env.POLYMARKET_API_KEY,
});

scanner.start();

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Market Scanner: received ${signal}, shutting down`);

  scanner.stop();

  try {
    await disconnectDatabase();
    redis.disconnect();
    logger.info('Market Scanner: shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Market Scanner: error during shutdown', {
      error: (err as Error).message,
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Market Scanner: uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Market Scanner: unhandled rejection', { reason: String(reason) });
  process.exit(1);
});
