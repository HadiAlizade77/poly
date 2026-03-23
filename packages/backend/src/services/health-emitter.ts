/**
 * Periodic system health broadcaster.
 * Publishes a rich status payload to the system:health WebSocket channel every 30 s.
 */
import prisma from '../config/database.js';
import { redis } from '../config/redis.js';
import logger from '../config/logger.js';
import { getIO } from '../websocket/server.js';
import { WS_CHANNELS } from '../websocket/channels.js';

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

  redisStatus = redis.status === 'ready' ? 'ok' : 'error';

  try {
    connections = getIO().sockets.sockets.size;
  } catch {
    // Socket.IO not yet initialized — treat as 0
  }

  const payload = {
    status: db === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    db,
    redis: redisStatus,
    connections,
  };

  try {
    getIO().emit(WS_CHANNELS.SYSTEM_HEALTH, payload);
  } catch {
    // Socket.IO not yet initialized — skip silently
  }
}

let intervalId: NodeJS.Timeout | null = null;

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
