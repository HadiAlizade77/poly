import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, uid, cleanDatabase } from './helpers.js';

const TEST_CATEGORY = 'test-api-scorer';
const TEST_SCORER = `scorer_${uid()}`;

let scorerId: string;

beforeAll(async () => {
  await cleanDatabase();
  const sc = await prisma.scorerConfig.create({
    data: {
      category: TEST_CATEGORY,
      scorer_name: TEST_SCORER,
      parameters: { weight: 1.0 },
      is_enabled: true,
    },
  });
  scorerId = sc.id;
});

afterAll(async () => {
  await prisma.scorerConfig.deleteMany({ where: { category: TEST_CATEGORY } });
  await prisma.$disconnect();
});

// ─── GET /api/scorers ─────────────────────────────────────────────────────────

describe('GET /api/scorers', () => {
  it('returns 200 with list of scorer configs', async () => {
    const res = await request(app).get('/api/scorers');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('filters by category', async () => {
    const res = await request(app).get(`/api/scorers?category=${TEST_CATEGORY}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((s: { category: string }) => s.category === TEST_CATEGORY)).toBe(true);
    expect(res.body.data.length).toBeGreaterThanOrEqual(1);
  });

  it('filters enabled only', async () => {
    const res = await request(app).get('/api/scorers?enabled=true');

    expect(res.status).toBe(200);
    expect(res.body.data.every((s: { is_enabled: boolean }) => s.is_enabled === true)).toBe(true);
  });
});

// ─── GET /api/scorers/:id ─────────────────────────────────────────────────────

describe('GET /api/scorers/:id', () => {
  it('returns scorer config by id', async () => {
    const res = await request(app).get(`/api/scorers/${scorerId}`);

    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(scorerId);
    expect(res.body.data.category).toBe(TEST_CATEGORY);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).get('/api/scorers/00000000-0000-0000-0000-000000000000');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── PUT /api/scorers ─────────────────────────────────────────────────────────

describe('PUT /api/scorers', () => {
  it('upserts a scorer config', async () => {
    const newName = `scorer_${uid()}`;
    const res = await request(app)
      .put('/api/scorers')
      .send({
        category: TEST_CATEGORY,
        scorer_name: newName,
        parameters: { weight: 0.5, threshold: 0.3 },
        is_enabled: true,
      });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.scorer_name).toBe(newName);
    expect(res.body.data.category).toBe(TEST_CATEGORY);
  });

  it('updates on second call with same category+name', async () => {
    const name = `scorer_upsert_${uid()}`;
    await request(app).put('/api/scorers').send({
      category: TEST_CATEGORY,
      scorer_name: name,
      parameters: { weight: 1.0 },
    });
    const res = await request(app).put('/api/scorers').send({
      category: TEST_CATEGORY,
      scorer_name: name,
      parameters: { weight: 2.0 },
    });

    expect(res.status).toBe(200);
    expect((res.body.data.parameters as { weight: number }).weight).toBe(2.0);
  });

  it('returns 400 when required fields are missing', async () => {
    const res = await request(app).put('/api/scorers').send({ category: TEST_CATEGORY });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});

// ─── PATCH /api/scorers/:id/toggle ───────────────────────────────────────────

describe('PATCH /api/scorers/:id/toggle', () => {
  it('toggles the is_enabled flag', async () => {
    const before = await prisma.scorerConfig.findUnique({ where: { id: scorerId } });
    const wasBefore = (before as { is_enabled: boolean }).is_enabled;

    const res = await request(app).patch(`/api/scorers/${scorerId}/toggle`);

    expect(res.status).toBe(200);
    expect(res.body.data.is_enabled).toBe(!wasBefore);

    // Toggle back to original
    await request(app).patch(`/api/scorers/${scorerId}/toggle`);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).patch('/api/scorers/00000000-0000-0000-0000-000000000000/toggle');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});
