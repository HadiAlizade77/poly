---
name: add-api-endpoint
description: >
  Add a new REST API endpoint to the Express server.
  Use when creating routes for markets, strategies, signals, orders, trades, positions, risk, bankroll, AI, alerts, analytics, or backtest.
argument-hint: "[HTTP method] [path] [description]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Add API Endpoint

Create endpoint: `$ARGUMENTS[0] $ARGUMENTS[1]` — $ARGUMENTS[2]

## Project Context

- Express server in `packages/backend/src/server.ts`
- Routes: `packages/backend/src/routes/{resource}.routes.ts`
- Controllers: `packages/backend/src/controllers/{resource}.controller.ts`
- Validation via Zod schemas in middleware
- Auth via JWT middleware (all routes except GET /api/health)
- Error handling via centralized error-handler middleware
- Prisma for DB queries
- Audit log for config changes

## Scaffolding Steps

1. **Route file** (`{resource}.routes.ts`):
   - Add route with appropriate HTTP method
   - Apply auth middleware
   - Apply Zod validation middleware for request body/params/query
   - Call controller method

2. **Controller** (`{resource}.controller.ts`):
   - Async handler with try/catch
   - Parse validated input from `req.body` / `req.params` / `req.query`
   - Call Prisma for DB operations
   - Return consistent JSON response: `{ success: true, data: ... }` or `{ success: false, error: ... }`
   - For mutations: write to `audit_log` table

3. **Zod schemas** (in route or shared schemas):
   - Request body schema
   - Query params schema (for GET with filters)
   - URL params schema

4. **Register route** in `packages/backend/src/routes/index.ts`

5. **Integration test** in `packages/backend/tests/integration/api/{resource}.test.ts`:
   - Success case with valid input
   - Validation error with invalid input
   - Auth check (401 without token)
   - Pagination/filtering if applicable

## Response Format

```typescript
// Success
{ success: true, data: T }
{ success: true, data: T[], pagination: { total, page, pageSize, totalPages } }

// Error
{ success: false, error: { code: string, message: string, details?: any } }
```

## Validation Pattern

```typescript
import { z } from 'zod';

const createSchema = z.object({
  body: z.object({ /* fields */ }),
  params: z.object({ id: z.string().uuid() }),
  query: z.object({ page: z.coerce.number().optional() }),
});
```
