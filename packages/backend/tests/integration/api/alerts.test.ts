import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import request from 'supertest';
import { app, prisma, cleanDatabase } from './helpers.js';

const createdIds: bigint[] = [];

async function createAlert(overrides: Record<string, unknown> = {}) {
  const alert = await prisma.alert.create({
    data: {
      alert_type: 'system',
      severity: 'info',
      title: 'API Test Alert',
      message: 'Created for API integration tests',
      ...overrides,
    },
  });
  createdIds.push(alert.id);
  return alert;
}

beforeAll(async () => {
  await cleanDatabase();
  // Create test alerts
  await createAlert({ title: 'Unread Alert 1' });
  await createAlert({ title: 'Unread Alert 2' });
  await createAlert({ alert_type: 'trade', severity: 'warning', title: 'Trade Alert' });
});

afterAll(async () => {
  if (createdIds.length > 0) {
    await prisma.alert.deleteMany({ where: { id: { in: createdIds } } });
  }
  await prisma.$disconnect();
});

// ─── GET /api/alerts ──────────────────────────────────────────────────────────

describe('GET /api/alerts', () => {
  it('returns 200 with paginated list', async () => {
    const res = await request(app).get('/api/alerts');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(Array.isArray(res.body.data)).toBe(true);
    expect(res.body.meta).toHaveProperty('total');
    expect(res.body.meta.total).toBeGreaterThanOrEqual(3);
  });

  it('filters by alertType', async () => {
    const res = await request(app).get('/api/alerts?alertType=trade');

    expect(res.status).toBe(200);
    expect(res.body.data.every((a: { alert_type: string }) => a.alert_type === 'trade')).toBe(true);
  });

  it('filters by severity', async () => {
    const res = await request(app).get('/api/alerts?severity=warning');

    expect(res.status).toBe(200);
    expect(res.body.data.every((a: { severity: string }) => a.severity === 'warning')).toBe(true);
  });

  it('filters unread alerts (isRead=false)', async () => {
    const res = await request(app).get('/api/alerts?isRead=false');

    expect(res.status).toBe(200);
    expect(res.body.data.every((a: { is_read: boolean }) => a.is_read === false)).toBe(true);
  });

  it('returns only unread non-dismissed when ?unread=true', async () => {
    const res = await request(app).get('/api/alerts?unread=true');

    expect(res.status).toBe(200);
    expect(
      res.body.data.every((a: { is_read: boolean; is_dismissed: boolean }) => !a.is_read && !a.is_dismissed),
    ).toBe(true);
  });

  it('paginates results', async () => {
    const res = await request(app).get('/api/alerts?page=1&pageSize=2');

    expect(res.status).toBe(200);
    expect(res.body.data.length).toBeLessThanOrEqual(2);
    expect(res.body.meta.page).toBe(1);
    expect(res.body.meta.pageSize).toBe(2);
  });
});

// ─── GET /api/alerts/unread-count ────────────────────────────────────────────

describe('GET /api/alerts/unread-count', () => {
  it('returns 200 with numeric count', async () => {
    const res = await request(app).get('/api/alerts/unread-count');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.count).toBe('number');
    expect(res.body.data.count).toBeGreaterThanOrEqual(2); // at least our 2 unread test alerts
  });
});

// ─── PATCH /api/alerts/:id/read ───────────────────────────────────────────────

describe('PATCH /api/alerts/:id/read', () => {
  it('marks alert as read', async () => {
    const alert = await createAlert({ title: 'To Be Read via API' });
    const id = String(alert.id);

    const res = await request(app).patch(`/api/alerts/${id}/read`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.is_read).toBe(true);
    expect(res.body.data.read_at).not.toBeNull();
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).patch('/api/alerts/999999999999/read');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── PATCH /api/alerts/:id/dismiss ───────────────────────────────────────────

describe('PATCH /api/alerts/:id/dismiss', () => {
  it('marks alert as dismissed', async () => {
    const alert = await createAlert({ title: 'To Be Dismissed via API' });
    const id = String(alert.id);

    const res = await request(app).patch(`/api/alerts/${id}/dismiss`);

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(res.body.data.is_dismissed).toBe(true);
  });

  it('returns 404 for unknown id', async () => {
    const res = await request(app).patch('/api/alerts/999999999999/dismiss');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });
});

// ─── PATCH /api/alerts/mark-all-read ─────────────────────────────────────────

describe('PATCH /api/alerts/mark-all-read', () => {
  it('marks all unread alerts as read and returns count', async () => {
    // Ensure there are some unread alerts
    await createAlert({ title: 'Batch Read Test 1' });
    await createAlert({ title: 'Batch Read Test 2' });

    const res = await request(app).patch('/api/alerts/mark-all-read');

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(typeof res.body.data.marked).toBe('number');
    expect(res.body.data.marked).toBeGreaterThanOrEqual(0);

    // After marking all read, count should be 0
    const countRes = await request(app).get('/api/alerts/unread-count');
    expect(countRes.body.data.count).toBe(0);
  });
});
