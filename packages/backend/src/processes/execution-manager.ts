// ─── Execution Manager PM2 Entry Point ──────────────────────────────────────
//
// Runs the exit monitor and exposes the execution engine for use by the
// decision engine process. In standalone mode, it only monitors positions
// for exit conditions. Actual order execution is triggered by the decision
// engine calling executionEngine.execute().

import dotenv from 'dotenv';
dotenv.config();

import logger from '../config/logger.js';
import { prisma, disconnectDatabase } from '../config/database.js';
import { redis } from '../config/redis.js';
import { exitMonitor } from '../services/execution/exit-monitor.js';

const EXIT_CHECK_INTERVAL_MS = parseInt(
  process.env.EXIT_CHECK_INTERVAL_MS ?? '30000',
  10,
);

async function main(): Promise<void> {
  logger.info('─── Execution Manager Starting ───');

  // Verify DB connectivity
  await prisma.$queryRaw`SELECT 1`;
  logger.info('Database connected');

  // Verify Redis connectivity
  await redis.ping();
  logger.info('Redis connected');

  // Log execution mode
  const mode = process.env.EXECUTION_MODE ?? 'mock';
  logger.info(`Execution mode: ${mode}`);

  if (mode === 'live') {
    logger.warn('⚠ LIVE EXECUTION MODE — real orders will be placed on Polymarket');
  }

  // Start exit monitor
  const monitor = new (await import('../services/execution/exit-monitor.js')).ExitMonitor(
    EXIT_CHECK_INTERVAL_MS,
  );
  monitor.start();

  logger.info('─── Execution Manager Running ───', {
    exitCheckIntervalMs: EXIT_CHECK_INTERVAL_MS,
    mode,
  });

  // Health log every 60s
  setInterval(async () => {
    try {
      const positions = await prisma.position.count();
      const openOrders = await prisma.order.count({
        where: { status: { in: ['pending', 'open', 'partial'] } },
      });
      logger.info('Execution health', { openPositions: positions, openOrders, mode });
    } catch (err) {
      logger.error('Health check failed', { error: (err as Error).message });
    }
  }, 60_000);
}

// ─── Graceful Shutdown ────────────────────────────────────────────────────────

async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal} — shutting down execution manager`);

  exitMonitor.stop();

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

  logger.info('Execution manager shutdown complete');
  process.exit(0);
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

main().catch((err) => {
  logger.error('Execution manager fatal error', {
    error: err instanceof Error ? err.message : String(err),
  });
  process.exit(1);
});
