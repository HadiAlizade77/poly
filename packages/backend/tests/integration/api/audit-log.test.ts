import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, cleanDatabase } from './helpers.js';
import * as auditLogService from '../../../src/services/audit-log.service.js';

const ENTITY_TYPE = 'market';
const ENTITY_ID = 'aud-test-entity-001';
const PERFORMER = 'test-user';
const ACTION_A = 'created';
const ACTION_B = 'updated';

beforeAll(async () => {
  await cleanDatabase();

  // Seed a few audit log entries
  await auditLogService.create(ACTION_A, ENTITY_TYPE, ENTITY_ID, { title: 'Created' }, PERFORMER);
  await auditLogService.create(ACTION_B, ENTITY_TYPE, ENTITY_ID, { title: 'Updated' }, PERFORMER);
  await auditLogService.create(ACTION_A, 'order', 'order-ent-001', { size: 100 }, 'other-user');
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── GET /api/audit-log ────────────────────────────────────────────────────────

describe('GET /api/audit-log', () => {
  it('returns 200 with paginated list shape', async () => {
    const res = await request(app).get('/api/audit-log');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toMatchObject({
      page: 1,
      total: expect.any(Number),
      totalPages: expect.any(Number),
    });
  });

  it('returns all 3 seeded entries with no filter', async () => {
    const res = await request(app).get('/api/audit-log');

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('filters by entityType', async () => {
    const res = await request(app).get(`/api/audit-log?entityType=${ENTITY_TYPE}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((e: { entity_type: string }) => e.entity_type === ENTITY_TYPE)).toBe(true);
    expect(res.body.meta.total).toBe(2);
  });

  it('filters by entityId', async () => {
    const res = await request(app).get(`/api/audit-log?entityId=${ENTITY_ID}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(2);
    expect(res.body.data.every((e: { entity_id: string }) => e.entity_id === ENTITY_ID)).toBe(true);
  });

  it('filters by action', async () => {
    const res = await request(app).get(`/api/audit-log?action=${ACTION_A}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((e: { action: string }) => e.action === ACTION_A)).toBe(true);
    expect(res.body.meta.total).toBe(2); // 'created' appears twice (market + order)
  });

  it('filters by performedBy', async () => {
    const res = await request(app).get(`/api/audit-log?performedBy=${PERFORMER}`);

    expect(res.status).toBe(200);
    expect(res.body.data.every((e: { performed_by: string }) => e.performed_by === PERFORMER)).toBe(true);
    expect(res.body.meta.total).toBe(2);
  });

  it('filters by since (future) returns empty', async () => {
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app).get(`/api/audit-log?since=${future}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
  });

  it('filters by since (past) returns seeded entries', async () => {
    const past = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const res = await request(app).get(`/api/audit-log?since=${past}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('combines entityType + action filters', async () => {
    const res = await request(app).get(`/api/audit-log?entityType=${ENTITY_TYPE}&action=${ACTION_A}`);

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(1);
    expect(res.body.data[0].entity_type).toBe(ENTITY_TYPE);
    expect(res.body.data[0].action).toBe(ACTION_A);
  });

  it('paginates results', async () => {
    const res = await request(app).get('/api/audit-log?page=1&pageSize=2');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.pageSize).toBe(2);
  });

  it('returns empty list when no entries match filter', async () => {
    const res = await request(app).get('/api/audit-log?entityId=nonexistent-id-xyz');

    expect(res.status).toBe(200);
    expect(res.body.meta.total).toBe(0);
    expect(res.body.data).toHaveLength(0);
  });
});
