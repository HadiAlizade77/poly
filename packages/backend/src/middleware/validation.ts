import type { RequestHandler } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { AppError } from './error-handler.js';

interface ValidateOptions {
  body?: ZodSchema;
  query?: ZodSchema;
  params?: ZodSchema;
}

export function validate(options: ValidateOptions): RequestHandler {
  return (req, _res, next) => {
    try {
      if (options.body) {
        req.body = options.body.parse(req.body) as unknown;
      }
      if (options.query) {
        req.query = options.query.parse(req.query) as typeof req.query;
      }
      if (options.params) {
        req.params = options.params.parse(req.params) as typeof req.params;
      }
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        next(
          new AppError(
            400,
            'VALIDATION_ERROR',
            'Validation failed',
            err.flatten().fieldErrors,
          ),
        );
      } else {
        next(err);
      }
    }
  };
}
