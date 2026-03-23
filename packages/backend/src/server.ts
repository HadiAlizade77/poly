import 'dotenv/config';

// Make BigInt JSON-serializable (Prisma autoincrement IDs are BigInt)
(BigInt.prototype as unknown as { toJSON: () => string }).toJSON = function (): string {
  return this.toString();
};

// Make Prisma Decimal JSON-serializable as numbers (not strings)
import { Prisma } from '@prisma/client';
(Prisma.Decimal.prototype as unknown as { toJSON: () => number }).toJSON = function (): number {
  return parseFloat(this.toString());
};

import express from 'express';
import { createServer } from 'http';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { config } from './config/env.js';
import logger from './config/logger.js';
import { disconnectDatabase } from './config/database.js';
import { redis } from './config/redis.js';
import { errorHandler } from './middleware/error-handler.js';
import { rateLimiter } from './middleware/rate-limit.js';
import routes from './routes/index.js';
import { initWebSocket } from './websocket/server.js';
import { startHealthEmitter, stopHealthEmitter } from './websocket/health.js';

const app = express();

// Security middleware
app.use(helmet());
app.use(
  cors({
    origin: config.CORS_ORIGINS.split(',').map((o) => o.trim()),
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  }),
);
app.use(compression());

// Body parsing
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Rate limiting
app.use(rateLimiter({ windowMs: 60_000, maxRequests: 1000 }));

// Routes
app.use('/api', routes);

// Error handler — must be last
app.use(errorHandler);

// HTTP + WebSocket server
const httpServer = createServer(app);
initWebSocket(httpServer);
startHealthEmitter();

// Start listening
httpServer.listen(config.PORT, () => {
  logger.info('Server started', {
    port: config.PORT,
    environment: config.NODE_ENV,
  });
});

// Graceful shutdown
async function shutdown(signal: string): Promise<void> {
  logger.info(`Received ${signal}, shutting down gracefully`);

  httpServer.close(async () => {
    try {
      stopHealthEmitter();
      await disconnectDatabase();
      redis.disconnect();
      logger.info('Shutdown complete');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: (err as Error).message });
      process.exit(1);
    }
  });

  // Force exit after 10s
  setTimeout(() => {
    logger.error('Forced shutdown after timeout');
    process.exit(1);
  }, 10_000).unref();
}

process.on('SIGTERM', () => void shutdown('SIGTERM'));
process.on('SIGINT', () => void shutdown('SIGINT'));

process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception', { error: err.message, stack: err.stack });
  process.exit(1);
});

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled rejection', { reason: String(reason) });
  process.exit(1);
});

export { app, httpServer };
