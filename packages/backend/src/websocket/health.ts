/**
 * Periodic system health broadcaster.
 * Publishes a rich status payload to the system:health WebSocket channel every 30 s.
 * Probes DB (SELECT 1), Redis (ping), and counts active Socket.IO connections.
 */
import { execSync } from 'child_process';
import prisma from '../config/database.js';
import { redis } from '../config/redis.js';
import logger from '../config/logger.js';
import { getIO } from './server.js';
import { WS_CHANNELS } from './channels.js';

const INTERVAL_MS = 30_000;

// The 7 PM2-managed service names the frontend expects.
const PM2_SERVICE_NAMES = [
  'api-server',
  'market-scanner',
  'data-ingestion',
  'decision-engine',
  'execution-manager',
  'ai-reviewer',
  'scheduler',
] as const;

interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'errored' | 'unknown';
  uptimeSeconds?: number;
  memoryMb?: number;
  restartCount?: number;
}

function mapPm2Status(s: string): ServiceStatus['status'] {
  switch (s) {
    case 'online': return 'running';
    case 'stopped': case 'stopping': return 'stopped';
    case 'errored': case 'error': return 'errored';
    default: return 'unknown';
  }
}

function getPm2Services(): ServiceStatus[] {
  const pm2Map = new Map<string, ServiceStatus>();
  try {
    const raw = execSync('pm2 jlist', {
      timeout: 5_000,
      env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin' },
    }).toString();
    const procs = JSON.parse(raw) as Array<{
      name: string;
      pm2_env?: { status?: string; pm_uptime?: number; restart_time?: number };
      monit?: { memory?: number };
    }>;
    for (const p of procs) {
      if (!p.name) continue;
      const uptimeSeconds = p.pm2_env?.pm_uptime != null
        ? Math.floor((Date.now() - p.pm2_env.pm_uptime) / 1_000) : undefined;
      pm2Map.set(p.name, {
        name: p.name,
        status: mapPm2Status(p.pm2_env?.status ?? ''),
        uptimeSeconds: uptimeSeconds != null && uptimeSeconds >= 0 ? uptimeSeconds : undefined,
        memoryMb: p.monit?.memory != null ? Math.round(p.monit.memory / 1_048_576) : undefined,
        restartCount: p.pm2_env?.restart_time,
      });
    }
  } catch (err) {
    logger.warn('getPm2Services: could not query pm2', {
      error: err instanceof Error ? err.message : String(err),
    });
    return PM2_SERVICE_NAMES.map((name) => ({ name, status: 'unknown' as const }));
  }

  return PM2_SERVICE_NAMES.map((name) => {
    if (pm2Map.has(name)) return pm2Map.get(name)!;
    if (name === 'api-server') {
      return {
        name, status: 'running' as const,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
        restartCount: 0,
      };
    }
    return { name, status: 'unknown' as const };
  });
}

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
  const services = getPm2Services();
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
    services,
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
