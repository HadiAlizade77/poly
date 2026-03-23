---
name: setup-service
description: >
  Scaffold a new backend service/process for the Polymarket platform.
  Use when creating a new PM2-managed service like market-scanner, data-ingestion, strategy-runner, etc.
argument-hint: "[service-name]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Setup Backend Service

Create a new backend service named `$ARGUMENTS` for the Polymarket AI Trading Platform.

## Project Context

- Monorepo at `packages/backend/src/services/`
- TypeScript with strict mode
- Each service is a PM2-managed process with its own entry point
- Services communicate via Redis pub/sub and shared PostgreSQL (Prisma)
- Logging via Winston with structured JSON output
- All config loaded from `system_config` DB table, editable from UI

## Scaffolding Steps

1. Create directory: `packages/backend/src/services/$0/`
2. Create the service entry point (`index.ts`) with:
   - Graceful shutdown handler (SIGTERM/SIGINT)
   - Redis connection setup (ioredis)
   - Prisma client initialization
   - Winston logger with child context (`{ service: '$0' }`)
   - Health heartbeat publishing to Redis every 60s
   - Main loop or event listener pattern
3. Create the core logic module(s) in separate files
4. Add PM2 entry to `ecosystem.config.js`:
   ```js
   { name: '$0', script: 'dist/services/$0/index.js', max_memory_restart: '256M' }
   ```
5. Add a barrel `index.ts` that re-exports public API
6. Create test directory: `packages/backend/tests/unit/$0/`
7. Create a basic test file with Vitest

## Service Template Pattern

```typescript
import { PrismaClient } from '@prisma/client';
import Redis from 'ioredis';
import { createLogger } from '../../config/logger';

const logger = createLogger({ service: '$0' });
const prisma = new PrismaClient();
const redis = new Redis(process.env.REDIS_URL);

async function main() {
  logger.info('Starting $0 service');
  // Main loop or event subscription here
}

async function shutdown() {
  logger.info('Shutting down $0 gracefully');
  await prisma.$disconnect();
  redis.disconnect();
  process.exit(0);
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((err) => {
  logger.error('Fatal error in $0', { error: err });
  process.exit(1);
});
```

## After Scaffolding

- Wire up Redis pub/sub channels the service needs
- Add the service to Docker health checks if applicable
- Register any REST endpoints in the API server if it exposes an HTTP interface
