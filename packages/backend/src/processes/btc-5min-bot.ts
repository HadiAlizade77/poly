/**
 * PM2 entry point for the BTC 5-Min Bot process.
 *
 * Lifecycle:
 *   start → connect DB + Redis → start bot loop → run until SIGTERM/SIGINT
 *
 * The bot checks BTC_5MIN_BOT_ACTIVE in system_config every cycle.
 * It only places trades when that flag is true.
 */
import 'dotenv/config';
import logger from '../config/logger.js';
import { disconnectDatabase } from '../config/database.js';
import { redis } from '../config/redis.js';
import { Btc5MinBot } from '../services/btc-5min/bot.js';

const bot = new Btc5MinBot(
  parseInt(process.env.BTC_5MIN_CYCLE_MS ?? '10000', 10),
);

// ─── Start ────────────────────────────────────────────────────────────────────

logger.info('BTC 5-Min Bot process starting (scalper mode)', {
  pid:     process.pid,
  cycleMs: parseInt(process.env.BTC_5MIN_CYCLE_MS ?? '10000', 10),
});

bot.start();

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`BTC 5-Min Bot: received ${signal}, shutting down`);

  bot.stop();

  try {
    await disconnectDatabase();
    redis.disconnect();
    logger.info('BTC 5-Min Bot: shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('BTC 5-Min Bot: error during shutdown', {
      error: (err as Error).message,
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('BTC 5-Min Bot: uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('BTC 5-Min Bot: unhandled rejection', { reason: String(reason) });
  process.exit(1);
});
