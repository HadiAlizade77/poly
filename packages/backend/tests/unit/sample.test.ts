import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { AppError, errorHandler } from '../../src/middleware/error-handler.js';
import { validate } from '../../src/middleware/validation.js';
import { rateLimiter } from '../../src/middleware/rate-limit.js';

// ─── Helpers ────────────────────────────────────────────────────────────────

function mockReq(overrides: Partial<Request> = {}): Request {
  return {
    body: {},
    query: {},
    params: {},
    ip: '127.0.0.1',
    ...overrides,
  } as unknown as Request;
}

function mockRes(): Response {
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn().mockReturnThis(),
    setHeader: vi.fn().mockReturnThis(),
  } as unknown as Response;
  return res;
}

const next = vi.fn() as unknown as NextFunction;

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── AppError ───────────────────────────────────────────────────────────────

describe('AppError', () => {
  it('creates error with correct properties', () => {
    const err = new AppError(400, 'BAD_REQUEST', 'Bad input', { field: 'required' });
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('BAD_REQUEST');
    expect(err.message).toBe('Bad input');
    expect(err.details).toEqual({ field: 'required' });
    expect(err.name).toBe('AppError');
    expect(err).toBeInstanceOf(Error);
  });

  it('creates error without optional details', () => {
    const err = new AppError(404, 'NOT_FOUND', 'Not found');
    expect(err.details).toBeUndefined();
  });
});

// ─── errorHandler middleware ─────────────────────────────────────────────────

describe('errorHandler', () => {
  it('handles AppError and responds with the error status and shape', () => {
    const err = new AppError(422, 'VALIDATION_ERROR', 'Invalid input', { name: 'required' });
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(422);
    expect(res.json).toHaveBeenCalledWith({
      success: false,
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid input',
        details: { name: 'required' },
      },
    });
  });

  it('handles unknown Error as 500', () => {
    const err = new Error('Something broke');
    const req = mockReq();
    const res = mockRes();

    errorHandler(err, req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        success: false,
        error: expect.objectContaining({ code: 'INTERNAL_ERROR' }),
      }),
    );
  });

  it('handles non-Error thrown values as 500', () => {
    const req = mockReq();
    const res = mockRes();

    errorHandler('string error', req, res, next);

    expect(res.status).toHaveBeenCalledWith(500);
  });
});

// ─── validate middleware ─────────────────────────────────────────────────────

describe('validate', () => {
  const schema = z.object({ name: z.string().min(1) });

  it('calls next() when body is valid', () => {
    const req = mockReq({ body: { name: 'Alice' } });
    const res = mockRes();

    validate({ body: schema })(req, res, next);

    expect(next).toHaveBeenCalledWith(); // no args = no error
    expect(req.body).toEqual({ name: 'Alice' });
  });

  it('calls next(AppError) when body fails validation', () => {
    const req = mockReq({ body: {} });
    const res = mockRes();

    validate({ body: schema })(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(400);
    expect(err.code).toBe('VALIDATION_ERROR');
  });

  it('validates query params', () => {
    const querySchema = z.object({ page: z.coerce.number().min(1) });
    const req = mockReq({ query: { page: 'abc' } as unknown as Request['query'] });
    const res = mockRes();

    validate({ query: querySchema })(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
  });

  it('passes through when no schema is specified', () => {
    const req = mockReq({ body: { anything: true } });
    const res = mockRes();

    validate({})(req, res, next);

    expect(next).toHaveBeenCalledWith();
  });
});

// ─── rateLimiter middleware ──────────────────────────────────────────────────

describe('rateLimiter', () => {
  it('allows requests under the limit', () => {
    const limiter = rateLimiter({ windowMs: 60_000, maxRequests: 5 });
    const req = mockReq();
    const res = mockRes();

    limiter(req, res, next);

    expect(next).toHaveBeenCalledWith();
    expect(res.setHeader).toHaveBeenCalledWith('X-RateLimit-Limit', 5);
  });

  it('blocks requests that exceed the limit', () => {
    const limiter = rateLimiter({ windowMs: 60_000, maxRequests: 2 });
    const req = mockReq({ ip: '10.0.0.1' });
    const res = mockRes();

    // First two calls are within limit
    limiter(req, res, next);
    limiter(req, res, next);
    vi.clearAllMocks();

    // Third call exceeds limit
    limiter(req, res, next);

    expect(next).toHaveBeenCalledWith(expect.any(AppError));
    const err = (next as ReturnType<typeof vi.fn>).mock.calls[0][0] as AppError;
    expect(err.statusCode).toBe(429);
    expect(err.code).toBe('RATE_LIMIT_EXCEEDED');
  });

  it('tracks different IPs independently', () => {
    const limiter = rateLimiter({ windowMs: 60_000, maxRequests: 1 });
    const req1 = mockReq({ ip: '10.0.0.2' });
    const req2 = mockReq({ ip: '10.0.0.3' });
    const res = mockRes();

    limiter(req1, res, next);
    vi.clearAllMocks();

    // Different IP should be allowed
    limiter(req2, res, next);
    expect(next).toHaveBeenCalledWith();
  });

  it('uses custom key function', () => {
    const limiter = rateLimiter({
      maxRequests: 1,
      keyFn: (req) => req.headers['x-user-id'] as string,
    });
    const req = mockReq({
      ip: '127.0.0.1',
      headers: { 'x-user-id': 'user-abc' },
    } as unknown as Partial<Request>);
    const res = mockRes();

    limiter(req, res, next);
    vi.clearAllMocks();

    limiter(req, res, next);
    expect(next).toHaveBeenCalledWith(expect.any(AppError));
  });
});
