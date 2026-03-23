/**
 * PM2 entry point for the Decision Engine process.
 *
 * Starts one DecisionEngine per category. Each engine runs its own
 * configurable interval loop independently.
 *
 * Categories active by default: crypto, politics, sports, events, entertainment
 * Disable via DECISION_ENGINE_CATEGORIES env var (comma-separated):
 *   DECISION_ENGINE_CATEGORIES=crypto,politics
 */
import 'dotenv/config';
import logger from '../config/logger.js';
import { disconnectDatabase } from '../config/database.js';
import { redis } from '../config/redis.js';
import { DecisionEngine, type EngineCategory } from '../services/decision-engine/engine.js';

const ALL_CATEGORIES: EngineCategory[] = ['crypto', 'politics', 'sports', 'events', 'entertainment'];

function resolveCategories(): EngineCategory[] {
  const env = process.env.DECISION_ENGINE_CATEGORIES;
  if (!env) return ALL_CATEGORIES;
  return env
    .split(',')
    .map((s) => s.trim().toLowerCase())
    .filter((s): s is EngineCategory => ALL_CATEGORIES.includes(s as EngineCategory));
}

const categories  = resolveCategories();
const engines     = categories.map((cat) => new DecisionEngine(cat));

// ─── Start ────────────────────────────────────────────────────────────────────

logger.info('Decision Engine process starting', {
  pid:        process.pid,
  categories,
});

for (const engine of engines) {
  engine.start();
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Decision Engine: received ${signal}, shutting down`);

  for (const engine of engines) {
    engine.stop();
  }

  try {
    await disconnectDatabase();
    redis.disconnect();
    logger.info('Decision Engine: shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Decision Engine: error during shutdown', {
      error: (err as Error).message,
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Decision Engine: uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Decision Engine: unhandled rejection', { reason: String(reason) });
  process.exit(1);
});
