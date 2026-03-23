---
name: run-tests
description: >
  Run tests for the Polymarket platform. Supports unit, integration, and E2E tests.
  Use after implementing features or fixing bugs.
argument-hint: "[scope: unit|integration|e2e|all] [path-filter]"
allowed-tools: Bash, Read, Glob, Grep
---

# Run Tests

Run tests with scope: `$ARGUMENTS[0]`, filter: `$ARGUMENTS[1]`

## Test Commands

### Unit Tests (Backend)
```bash
cd packages/backend && npx vitest run tests/unit/$1 --reporter=verbose
```

### Unit Tests (Frontend)
```bash
cd packages/frontend && npx vitest run --reporter=verbose $1
```

### Integration Tests
```bash
cd packages/backend && npx vitest run tests/integration/$1 --reporter=verbose
```

### E2E Tests
```bash
cd packages/frontend && npx playwright test $1
```

### All Tests
```bash
npm run test
```

### Coverage Report
```bash
cd packages/backend && npx vitest run --coverage
cd packages/frontend && npx vitest run --coverage
```

## Test Infrastructure

- **Unit**: Vitest with `vi.mock()` for isolating dependencies
- **Integration**: Vitest + Supertest for API, Testcontainers for DB/Redis
- **E2E**: Playwright (Chromium, Firefox, WebKit)
- **Mocking**: MSW for external APIs (Polymarket, Binance, Claude)
- **Fixtures**: `packages/backend/tests/fixtures/`
- **Factories**: `packages/backend/tests/factories/`

## After Running

1. If tests fail, read the error output carefully
2. Fix failing tests before moving on
3. Check coverage hasn't dropped below thresholds (80% backend, 70% frontend)
4. For risk governor tests: ensure all 16 checks have edge case coverage
