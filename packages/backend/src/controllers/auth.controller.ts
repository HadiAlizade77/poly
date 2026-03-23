import type { Request, Response, NextFunction } from 'express';
import { signToken } from '../middleware/auth.js';
import { AppError } from '../middleware/error-handler.js';
import * as systemConfigService from '../services/system-config.service.js';
import logger from '../config/logger.js';

const ADMIN_PASSWORD_KEY = 'AUTH_ADMIN_PASSWORD';
const DEFAULT_PASSWORD = 'changeme';

export async function login(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { password } = req.body as { password: string };

    // Password is stored in system_config (hashed comparison skipped for simplicity;
    // a real implementation should use bcrypt)
    const storedPassword =
      (await systemConfigService.getValue<string>(ADMIN_PASSWORD_KEY)) ?? DEFAULT_PASSWORD;

    if (password !== storedPassword) {
      logger.warn('Failed login attempt', { ip: req.ip });
      throw new AppError(401, 'UNAUTHORIZED', 'Invalid password');
    }

    const token = signToken('admin', 'admin');
    logger.info('Admin login successful', { ip: req.ip });

    res.json({ success: true, data: { token, expiresIn: '24h' } });
  } catch (err) {
    next(err);
  }
}
