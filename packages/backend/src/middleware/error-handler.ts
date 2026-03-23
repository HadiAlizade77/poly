import type { ErrorRequestHandler, Request, Response, NextFunction } from 'express';
import logger from '../config/logger.js';
import { NotFoundError, UniqueConstraintError } from '../services/errors.js';

export class AppError extends Error {
  constructor(
    public statusCode: number,
    public code: string,
    message: string,
    public details?: unknown,
  ) {
    super(message);
    this.name = 'AppError';
    Error.captureStackTrace(this, this.constructor);
  }
}

export const errorHandler: ErrorRequestHandler = (
  err: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void => {
  // JSON body parse errors from Express
  if (err instanceof SyntaxError && 'body' in err) {
    res.status(400).json({
      success: false,
      error: { code: 'BAD_REQUEST', message: 'Invalid JSON body' },
    });
    return;
  }

  if (err instanceof NotFoundError) {
    res.status(404).json({
      success: false,
      error: { code: 'NOT_FOUND', message: err.message },
    });
    return;
  }

  if (err instanceof UniqueConstraintError) {
    res.status(409).json({
      success: false,
      error: { code: 'CONFLICT', message: err.message, details: { fields: err.fields } },
    });
    return;
  }

  if (err instanceof AppError) {
    logger.warn('App error', {
      code: err.code,
      message: err.message,
      statusCode: err.statusCode,
    });
    res.status(err.statusCode).json({
      success: false,
      error: {
        code: err.code,
        message: err.message,
        details: err.details,
      },
    });
    return;
  }

  const error = err instanceof Error ? err : new Error(String(err));
  logger.error('Unhandled error', { error: error.message, stack: error.stack });

  res.status(500).json({
    success: false,
    error: {
      code: 'INTERNAL_ERROR',
      message: 'An internal server error occurred',
    },
  });
};
