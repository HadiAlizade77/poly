/**
 * Periodic system health broadcaster.
 * Publishes a rich status payload to the system:health WebSocket channel every 30 s.
 */
import { execSync } from 'child_process';
import prisma from '../config/database.js';
import { redis } from '../config/redis.js';
import logger from '../config/logger.js';
import { getIO } from '../websocket/server.js';
import { WS_CHANNELS } from '../websocket/channels.js';

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

export interface ServiceStatus {
  name: string;
  status: 'running' | 'stopped' | 'errored' | 'unknown';
  uptimeSeconds?: number;
  memoryMb?: number;
  restartCount?: number;
}

/**
 * Maps a PM2 process status string to the ServiceStatus union the frontend expects.
 */
function mapPm2Status(pm2Status: string): ServiceStatus['status'] {
  switch (pm2Status) {
    case 'online':
      return 'running';
    case 'stopped':
    case 'stopping':
      return 'stopped';
    case 'errored':
    case 'error':
      return 'errored';
    default:
      return 'unknown';
  }
}

/**
 * Queries PM2 for all process info via `pm2 jlist` and maps it to ServiceStatus[].
 *
 * For 'api-server' specifically: if PM2 doesn't report it (e.g. running via
 * `tsx watch` during development), the current process itself is used as a
 * fallback and reported as 'running'.
 *
 * If PM2 is not installed or errors for any reason every service is returned
 * as 'unknown' so the frontend degrades gracefully.
 */
export function getPm2Services(): ServiceStatus[] {
  // Build a lookup keyed by PM2 process name.
  const pm2Map = new Map<string, ServiceStatus>();

  try {
    const raw = execSync('pm2 jlist', { timeout: 5_000, env: { ...process.env, PATH: process.env.PATH || '/usr/local/bin:/usr/bin:/bin' } }).toString();
    const processes = JSON.parse(raw) as Array<{
      name: string;
      pm2_env?: {
        status?: string;
        pm_uptime?: number;
        restart_time?: number;
      };
      monit?: {
        memory?: number;
      };
    }>;

    for (const proc of processes) {
      const name = proc.name;
      if (!name) continue;

      const status = mapPm2Status(proc.pm2_env?.status ?? '');

      // pm_uptime is the epoch ms when the process was last started.
      const uptimeSeconds =
        proc.pm2_env?.pm_uptime != null
          ? Math.floor((Date.now() - proc.pm2_env.pm_uptime) / 1_000)
          : undefined;

      // monit.memory is in bytes.
      const memoryMb =
        proc.monit?.memory != null
          ? Math.round(proc.monit.memory / 1_048_576)
          : undefined;

      const restartCount = proc.pm2_env?.restart_time;

      pm2Map.set(name, {
        name,
        status,
        uptimeSeconds: uptimeSeconds != null && uptimeSeconds >= 0 ? uptimeSeconds : undefined,
        memoryMb,
        restartCount,
      });
    }
  } catch (err) {
    // pm2 not available, not running, or JSON parse failed — return all unknown.
    logger.warn('getPm2Services: could not query pm2', {
      error: err instanceof Error ? err.message : String(err),
    });
    return PM2_SERVICE_NAMES.map((name) => ({ name, status: 'unknown' as const }));
  }

  // Build the final list in the canonical order the frontend expects.
  return PM2_SERVICE_NAMES.map((name) => {
    if (pm2Map.has(name)) {
      return pm2Map.get(name)!;
    }

    // api-server may be running as the current process (tsx watch in dev).
    if (name === 'api-server') {
      return {
        name,
        status: 'running' as const,
        uptimeSeconds: Math.floor(process.uptime()),
        memoryMb: Math.round(process.memoryUsage().rss / 1_048_576),
        restartCount: 0,
      };
    }

    // Any other service not found in PM2 is genuinely unknown.
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

  redisStatus = redis.status === 'ready' ? 'ok' : 'error';

  try {
    connections = getIO().sockets.sockets.size;
  } catch {
    // Socket.IO not yet initialized — treat as 0
  }

  const services = getPm2Services();

  const payload = {
    status: db === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded',
    uptime: process.uptime(),
    timestamp: new Date().toISOString(),
    db,
    redis: redisStatus,
    connections,
    services,
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
