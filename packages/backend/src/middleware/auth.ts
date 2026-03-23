import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config/env.js';
import logger from '../config/logger.js';
import { AppError } from './error-handler.js';

export interface JwtPayload {
  sub: string;
  role: 'admin' | 'viewer';
  iat?: number;
  exp?: number;
}

// Augment Express Request to carry the decoded token
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload;
    }
  }
}

/** Verifies the Bearer token from the Authorization header. */
export function authenticate(req: Request, _res: Response, next: NextFunction): void {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return next(new AppError(401, 'UNAUTHORIZED', 'Missing or invalid Authorization header'));
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.user = payload;
    next();
  } catch (err) {
    logger.debug('JWT verification failed', { error: (err as Error).message });
    next(new AppError(401, 'UNAUTHORIZED', 'Invalid or expired token'));
  }
}

/** Requires the authenticated user to have the `admin` role. */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (req.user?.role !== 'admin') {
    return next(new AppError(403, 'FORBIDDEN', 'Admin role required'));
  }
  next();
}

/** Sign a JWT token for a given subject and role. */
export function signToken(sub: string, role: JwtPayload['role']): string {
  return jwt.sign({ sub, role }, config.JWT_SECRET, { expiresIn: '24h' });
}
