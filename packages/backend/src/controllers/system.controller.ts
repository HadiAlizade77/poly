import type { Request, Response, NextFunction } from 'express';
import * as systemConfigService from '../services/system-config.service.js';
import { sendItem } from '../utils/response.js';
import { config } from '../config/env.js';

export function getHealth(_req: Request, res: Response): void {
  res.json({
    success: true,
    data: {
      status: 'ok',
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
      environment: config.NODE_ENV,
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
