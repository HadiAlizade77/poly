/**
 * Periodic system health broadcaster.
 * Publishes a rich status payload to the system:health WebSocket channel every 30 s.
 * Probes DB (SELECT 1), Redis (ping), and counts active Socket.IO connections.
 */
import prisma from '../config/database.js';
import { redis } from '../config/redis.js';
import logger from '../config/logger.js';
import { getIO } from './server.js';
import { WS_CHANNELS } from './channels.js';

const INTERVAL_MS = 30_000;

async function publishHealthStatus(): Promise<void> {
  let db: 'ok' | 'error' = 'ok';
  let redisStatus: 'ok' | 'error' = 'ok';
  let connections = 0;

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }

  try {
    await redis.ping();
    redisStatus = 'ok';
  } catch {
    redisStatus = 'error';
  }

  try {
    connections = getIO().sockets.sockets.size;
  } catch {
    // Socket.IO not yet initialized — treat as 0
  }

  const mem = process.memoryUsage();
  const payload = {
    status: db === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    db,
    redis: redisStatus,
    connections,
    memory: {
      heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
      heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
      rssMb: Math.round(mem.rss / 1024 / 1024),
    },
  };

  try {
    getIO().emit(WS_CHANNELS.SYSTEM_HEALTH, payload);
  } catch {
    // Socket.IO not yet initialized — skip silently
  }
}

let intervalId: NodeJS.Timeout | null = null;

/** Exposed for testing — trigger a single health publish immediately. */
export { publishHealthStatus };

export function startHealthEmitter(): void {
  if (intervalId !== null) return;
  intervalId = setInterval(() => {
    void publishHealthStatus().catch((err: Error) => {
      logger.error('Health emitter error', { error: err.message });
    });
  }, INTERVAL_MS);
  intervalId.unref(); // Don't keep the process alive solely for this timer
  logger.info('System health emitter started', { intervalMs: INTERVAL_MS });
}

export function stopHealthEmitter(): void {
  if (intervalId !== null) {
    clearInterval(intervalId);
    intervalId = null;
  }
}
