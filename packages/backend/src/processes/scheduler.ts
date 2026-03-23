/**
 * PM2 entry point for the Scheduler process.
 *
 * Starts the cron-based job scheduler. Runs as a long-lived process
 * managed by PM2 alongside the API server and data services.
 *
 * Jobs scheduled (all UTC):
 *   00:05  daily-review — bankroll snapshot + trade feedback summaries
 *   02:00  backup       — placeholder (future: pg_dump to remote storage)
 *   03:00  cleanup      — prune old snapshots, scores, external data
 *
 * Override any job via SCHEDULER_TRIGGER_ON_START env var (comma-separated
 * job names) to run them immediately at boot, useful for testing.
 */
import 'dotenv/config';
import logger from '../config/logger.js';
import { disconnectDatabase } from '../config/database.js';
import { redis } from '../config/redis.js';
import { scheduler } from '../services/scheduler/scheduler.js';

// ─── Start ────────────────────────────────────────────────────────────────────

logger.info('Scheduler process starting', { pid: process.pid });

scheduler.start();

// Optional: run specific jobs immediately at start (useful for testing)
const triggerOnStart = process.env.SCHEDULER_TRIGGER_ON_START;
if (triggerOnStart) {
  const jobNames = triggerOnStart.split(',').map((s) => s.trim());
  for (const name of jobNames) {
    logger.info(`Scheduler: triggering job at start`, { name });
    scheduler.trigger(name).catch((err) => {
      logger.error('Scheduler: triggered job failed', { name, error: (err as Error).message });
    });
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Scheduler: received ${signal}, shutting down`);

  scheduler.stop();

  try {
    await disconnectDatabase();
    redis.disconnect();
    logger.info('Scheduler: shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Scheduler: error during shutdown', { error: (err as Error).message });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Scheduler: uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Scheduler: unhandled rejection', { reason: String(reason) });
  process.exit(1);
});
