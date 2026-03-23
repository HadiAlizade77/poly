import type { Request, Response, NextFunction } from 'express';
import * as systemConfigService from '../services/system-config.service.js';
import { sendItem } from '../utils/response.js';
import { config } from '../config/env.js';
import { NotFoundError } from '../services/errors.js';
import prisma from '../config/database.js';
import { redis } from '../config/redis.js';
import { getPm2Services } from '../services/health-emitter.js';

export async function getHealth(_req: Request, res: Response): Promise<void> {
  let db: 'ok' | 'error' = 'ok';
  let redisStatus: 'ok' | 'error' = 'ok';

  try {
    await prisma.$queryRaw`SELECT 1`;
  } catch {
    db = 'error';
  }

  redisStatus = redis.status === 'ready' ? 'ok' : 'error';

  const mem = process.memoryUsage();
  const services = getPm2Services();

  res.json({
    success: true,
    data: {
      status: db === 'ok' && redisStatus === 'ok' ? 'ok' : 'degraded',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
      db,
      redis: redisStatus,
      connections: 0,
      memory: {
        heapUsedMb: Math.round(mem.heapUsed / 1024 / 1024),
        heapTotalMb: Math.round(mem.heapTotal / 1024 / 1024),
        rssMb: Math.round(mem.rss / 1024 / 1024),
      },
      services,
    },
  });
}

export function getConfig(_req: Request, res: Response): void {
  res.json({
    success: true,
    data: {
      port: config.PORT,
      environment: config.NODE_ENV,
      logLevel: config.LOG_LEVEL,
    },
  });
}

export async function getSystemConfigs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (req.params.key) {
      const record = await systemConfigService.get(req.params.key);
      if (!record) throw new NotFoundError('SystemConfig', req.params.key);
      sendItem(res, record);
      return;
    }
    const configs = await systemConfigService.getAll();
    sendItem(res, configs);
  } catch (err) {
    next(err);
  }
}

export async function setSystemConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { value, description } = req.body as { value: unknown; description?: string };
    const record = await systemConfigService.set(
      req.params.key,
      value,
      description,
    );
    sendItem(res, record);
  } catch (err) {
    next(err);
  }
}

export async function deleteSystemConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    await systemConfigService.remove(req.params.key);
    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
