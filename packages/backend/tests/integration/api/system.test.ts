import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, cleanDatabase } from './helpers.js';

const TEST_CONFIG_KEY = 'test_api_sys_config';

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── GET /api/health ──────────────────────────────────────────────────────────

describe('GET /api/health', () => {
  it('returns 200 with status ok', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.status).toBe('ok');
    expect(res.body.data).toHaveProperty('uptime');
    expect(res.body.data).toHaveProperty('timestamp');
    expect(res.body.data).toHaveProperty('environment');
  });

  it('responds with JSON content type', async () => {
    const res = await request(app).get('/api/health');
    expect(res.headers['content-type']).toMatch(/application\/json/);
  });
});

// ─── GET /api/config ──────────────────────────────────────────────────────────

describe('GET /api/config', () => {
  it('returns 200 with server config', async () => {
    const res = await request(app).get('/api/config');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data).toHaveProperty('port');
    expect(res.body.data).toHaveProperty('environment');
    expect(res.body.data).toHaveProperty('logLevel');
  });
});

// ─── GET /api/system-config ───────────────────────────────────────────────────

describe('GET /api/system-config', () => {
  it('returns 200 with list of all system configs', async () => {
    const res = await request(app).get('/api/system-config');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
  });
});

// ─── PUT /api/system-config/:key ──────────────────────────────────────────────

describe('PUT /api/system-config/:key', () => {
  it('creates a new system config', async () => {
    const res = await request(app)
      .put(`/api/system-config/${TEST_CONFIG_KEY}`)
      .send({ value: { cycles: 42 }, description: 'Test config' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.key).toBe(TEST_CONFIG_KEY);
    expect((res.body.data.value as { cycles: number }).cycles).toBe(42);
    expect(res.body.data.description).toBe('Test config');
  });

  it('updates existing config (upsert)', async () => {
    const res = await request(app)
      .put(`/api/system-config/${TEST_CONFIG_KEY}`)
      .send({ value: { cycles: 99 } });

    expect(res.status).toBe(200);
    expect((res.body.data.value as { cycles: number }).cycles).toBe(99);
  });
});

// ─── GET /api/system-config/:key ──────────────────────────────────────────────

describe('GET /api/system-config/:key', () => {
  it('returns config for a known key', async () => {
    // Ensure config exists first
    await request(app)
      .put(`/api/system-config/${TEST_CONFIG_KEY}`)
      .send({ value: 123 });

    const res = await request(app).get(`/api/system-config/${TEST_CONFIG_KEY}`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.key).toBe(TEST_CONFIG_KEY);
  });

  it('returns null data for unknown key', async () => {
    const res = await request(app).get('/api/system-config/no_such_key_xyz');

    expect(res.status).toBe(200);
    expect(res.body.data).toBeNull();
  });
});

// ─── DELETE /api/system-config/:key ──────────────────────────────────────────

describe('DELETE /api/system-config/:key', () => {
  it('deletes a config and returns 204', async () => {
    const key = 'test_api_sys_delete_me';
    await request(app).put(`/api/system-config/${key}`).send({ value: 'bye' });

    const res = await request(app).delete(`/api/system-config/${key}`);

    expect(res.status).toBe(204);

    // Verify it's gone
    const check = await request(app).get(`/api/system-config/${key}`);
    expect(check.body.data).toBeNull();
  });
});

// ─── Unknown routes ───────────────────────────────────────────────────────────

describe('Unknown routes', () => {
  it('returns 404 for unknown GET route', async () => {
    const res = await request(app).get('/api/does-not-exist');
    expect(res.status).toBe(404);
  });

  it('returns 404 for unknown POST route', async () => {
    const res = await request(app).post('/api/ghost-endpoint');
    expect(res.status).toBe(404);
  });
});
