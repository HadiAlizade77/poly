import express, { type Express } from 'express';
import { errorHandler } from '../../src/middleware/error-handler.js';
import routes from '../../src/routes/index.js';

/**
 * Creates a minimal Express app for integration testing.
 * Does NOT start a server, connect to the database, or connect to Redis.
 */
export function createTestApp(): Express {
  const app = express();

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Mount routes
  app.use('/api', routes);

  // Error handler — must be last
  app.use(errorHandler);

  return app;
}
