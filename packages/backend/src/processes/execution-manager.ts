// ─── Execution Manager PM2 Entry Point ──────────────────────────────────────
//
// Runs the exit monitor and exposes the execution engine for use by the
// decision engine process. In standalone mode, it only monitors positions
// for exit conditions. Actual order execution is triggered by the decision
// engine calling executionEngine.execute().

import 'dotenv/config';
import logger from '../config/logger.js';
import { prisma, disconnectDatabase } from '../config/database.js';
import { redis } from '../config/redis.js';
import { ExitMonitor } from '../services/execution/exit-monitor.js';

const EXIT_CHECK_INTERVAL_MS = parseInt(
  process.env.EXIT_CHECK_INTERVAL_MS ?? '30000',
  10,
);

const monitor = new ExitMonitor(EXIT_CHECK_INTERVAL_MS);

// ─── Start ────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  logger.info('Execution Manager process starting', {
    pid: process.pid,
    exitCheckIntervalMs: EXIT_CHECK_INTERVAL_MS,
  });

  // Verify DB connectivity
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Execution Manager: database connected');

  // Verify Redis connectivity
  await redis.ping();
  logger.info('Execution Manager: Redis connected');

  // Log execution mode
  const mode = process.env.EXECUTION_MODE ?? 'mock';
  logger.info(`Execution Manager: execution mode is ${mode}`);

  if (mode === 'live') {
    logger.warn('LIVE EXECUTION MODE — real orders will be placed on Polymarket');
  }

  // Start exit monitor
  monitor.start();

  logger.info('Execution Manager: running', {
    exitCheckIntervalMs: EXIT_CHECK_INTERVAL_MS,
    mode,
  });

  // Health log every 60s
  setInterval(async () => {
    try {
      const openPositions = await prisma.position.count();
      const openOrders = await prisma.order.count({
        where: { status: { in: ['pending', 'open', 'partial'] } },
      });
      logger.info('Execution Manager: health', { openPositions, openOrders, mode });
    } catch (err) {
      logger.error('Execution Manager: health check failed', {
        error: (err as Error).message,
      });
    }
  }, 60_000);
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Execution Manager: received ${signal}, shutting down`);

  monitor.stop();

  try {
    await disconnectDatabase();
    redis.disconnect();
    logger.info('Execution Manager: shutdown complete');
    process.exit(0);
  } catch (err) {
    logger.error('Execution Manager: error during shutdown', {
      error: (err as Error).message,
    });
    process.exit(1);
  }
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT',  () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Execution Manager: uncaught exception', {
    error: err.message,
    stack: err.stack,
  });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Execution Manager: unhandled rejection', { reason: String(reason) });
  process.exit(1);
});

main().catch((err) => {
  logger.error('Execution Manager: fatal error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
