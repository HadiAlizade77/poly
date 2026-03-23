import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, cleanDatabase } from './helpers.js';

const TEST_SCOPE_VALUE = 'test-api-risk-strategy';

beforeAll(async () => {
  await cleanDatabase();
  // Ensure a global risk config exists
  const existing = await prisma.riskConfig.findFirst({ where: { scope: 'global', scope_value: null } });
  if (!existing) {
    await prisma.riskConfig.create({
      data: { scope: 'global', scope_value: null, parameters: { max_position_size_pct: 5 } },
    });
  }
  // Clean any test-specific configs
  await prisma.riskConfig.deleteMany({ where: { scope: 'strategy', scope_value: TEST_SCOPE_VALUE } });
});

afterAll(async () => {
  await prisma.riskConfig.deleteMany({ where: { scope: 'strategy', scope_value: TEST_SCOPE_VALUE } });
  await prisma.$disconnect();
});

// ─── GET /api/risk/events ─────────────────────────────────────────────────────

describe('GET /api/risk/events', () => {
  it('returns 200 with paginated risk events', async () => {
    const res = await request(app).get('/api/risk/events');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
  });

  it('accepts page/pageSize query params', async () => {
    const res = await request(app).get('/api/risk/events?page=1&pageSize=5');

    expect(res.status).toBe(200);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(5);
  });
});

// ─── GET /api/risk/config ─────────────────────────────────────────────────────

describe('GET /api/risk/config', () => {
  it('returns all risk configs when no scope filter', async () => {
    const res = await request(app).get('/api/risk/config');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('returns specific config when scope=global', async () => {
    const res = await request(app).get('/api/risk/config?scope=global');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    // Single config or null
    if (res.body.data !== null) {
      expect(res.body.data.scope).toBe('global');
    }
  });
});

// ─── PUT /api/risk/config ─────────────────────────────────────────────────────

describe('PUT /api/risk/config', () => {
  it('creates or updates a risk config', async () => {
    const res = await request(app)
      .put('/api/risk/config')
      .send({
        scope: 'strategy',
        scope_value: TEST_SCOPE_VALUE,
        parameters: { max_position_size_pct: 2, max_daily_drawdown_pct: 3 },
        updated_by: 'test',
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.scope).toBe('strategy');
    expect(res.body.data.scope_value).toBe(TEST_SCOPE_VALUE);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).put('/api/risk/config').send({ scope_value: 'test' });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns 400 for invalid scope enum', async () => {
    const res = await request(app).put('/api/risk/config').send({
      scope: 'invalid_scope',
      parameters: {},
    });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── GET /api/risk/kill-switch ────────────────────────────────────────────────

describe('GET /api/risk/kill-switch', () => {
  it('returns kill switch status', async () => {
    const res = await request(app).get('/api/risk/kill-switch');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('kill_switch_enabled');
    expect(typeof res.body.data.kill_switch_enabled).toBe('boolean');
  });
});

// ─── PATCH /api/risk/kill-switch ──────────────────────────────────────────────

describe('PATCH /api/risk/kill-switch', () => {
  it('toggles the kill switch and returns new state', async () => {
    const before = await request(app).get('/api/risk/kill-switch');
    const wasBefore = before.body.data.kill_switch_enabled as boolean;

    const res = await request(app).patch('/api/risk/kill-switch');

    expect(res.status).toBe(200);
    expect(res.body.data.kill_switch_enabled).toBe(!wasBefore);

    // Restore original state
    await request(app).patch('/api/risk/kill-switch');
  });
});
