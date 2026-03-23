import type { Request, RequestHandler } from 'express';
import { AppError } from './error-handler.js';

interface RateLimitOptions {
  windowMs?: number;
  maxRequests?: number;
  keyFn?: (req: Request) => string;
}

interface Window {
  count: number;
  resetAt: number;
}

export function rateLimiter(options: RateLimitOptions = {}): RequestHandler {
  const {
    windowMs = 60_000,
    maxRequests = 100,
    keyFn = (req) => req.ip ?? 'unknown',
  } = options;

  const store = new Map<string, Window>();

  // Clean up expired windows periodically
  const cleanup = setInterval(() => {
    const now = Date.now();
    for (const [key, win] of store) {
      if (win.resetAt <= now) store.delete(key);
    }
  }, 60_000);
  cleanup.unref();

  return (req, res, next) => {
    const key = keyFn(req);
    const now = Date.now();
    let win = store.get(key);

    if (!win || win.resetAt <= now) {
      win = { count: 0, resetAt: now + windowMs };
      store.set(key, win);
    }

    win.count++;

    res.setHeader('X-RateLimit-Limit', maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, maxRequests - win.count));
    res.setHeader('X-RateLimit-Reset', Math.ceil(win.resetAt / 1000));

    if (win.count > maxRequests) {
      next(new AppError(429, 'RATE_LIMIT_EXCEEDED', 'Too many requests, please slow down'));
      return;
    }

    next();
  };
}
