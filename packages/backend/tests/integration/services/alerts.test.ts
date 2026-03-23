import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as AlertService from '../../../src/services/alert.service.js';
import { NotFoundError } from '../../../src/services/errors.js';
import { prisma, cleanDatabase } from './helpers.js';

// Track created alert IDs so we can clean up precisely
const createdIds: bigint[] = [];

async function cleanTestAlerts() {
  if (createdIds.length > 0) {
    await prisma.alert.deleteMany({ where: { id: { in: createdIds } } });
    createdIds.length = 0;
  }
}

async function createAlert(overrides = {}) {
  const alert = await AlertService.create({
    alert_type: 'system',
    severity: 'info',
    title: 'Test Alert',
    message: 'Integration test alert',
    ...overrides,
  });
  createdIds.push(alert.id);
  return alert;
}

beforeAll(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await cleanTestAlerts();
  await prisma.$disconnect();
});

// ─── create ──────────────────────────────────────────────────────────────────

describe('AlertService.create', () => {
  it('creates an alert with defaults', async () => {
    const alert = await createAlert();

    expect(alert.id).toBeTruthy();
    expect(alert.alert_type).toBe('system');
    expect(alert.severity).toBe('info');
    expect(alert.is_read).toBe(false);
    expect(alert.is_dismissed).toBe(false);
    expect(alert.created_at).toBeInstanceOf(Date);
    expect(alert.read_at).toBeNull();
  });

  it('creates alerts of different types', async () => {
    const tradeAlert = await createAlert({ alert_type: 'trade', severity: 'warning', title: 'Trade Alert' });
    const riskAlert = await createAlert({ alert_type: 'risk', severity: 'critical', title: 'Risk Alert' });

    expect(tradeAlert.alert_type).toBe('trade');
    expect(riskAlert.severity).toBe('critical');
  });

  it('stores optional data payload', async () => {
    const alert = await createAlert({ data: { market_id: 'abc', edge: 0.05 } });

    expect(alert.data).toEqual({ market_id: 'abc', edge: 0.05 });
  });
});

// ─── findById ─────────────────────────────────────────────────────────────────

describe('AlertService.findById', () => {
  it('returns alert by bigint id', async () => {
    const created = await createAlert({ title: 'Findable Alert' });
    const found = await AlertService.findById(created.id);

    expect(found.id).toBe(created.id);
    expect(found.title).toBe('Findable Alert');
  });

  it('throws NotFoundError for unknown id', async () => {
    await expect(AlertService.findById(BigInt(999999999))).rejects.toBeInstanceOf(NotFoundError);
  });
});

// ─── findMany ─────────────────────────────────────────────────────────────────

describe('AlertService.findMany', () => {
  it('returns paginated result', async () => {
    await createAlert();
    const result = await AlertService.findMany({}, { page: 1, pageSize: 5 });

    expect(Array.isArray(result.items)).toBe(true);
    expect(result.items.length).toBeLessThanOrEqual(5);
    expect(result).toHaveProperty('total');
    expect(result).toHaveProperty('totalPages');
  });

  it('filters by alert_type', async () => {
    await createAlert({ alert_type: 'ai', title: 'AI alert' });

    const result = await AlertService.findMany({ alertType: 'ai' });
    expect(result.items.every((a) => a.alert_type === 'ai')).toBe(true);
  });

  it('filters by severity', async () => {
    await createAlert({ severity: 'error', title: 'Error Alert' });

    const result = await AlertService.findMany({ severity: 'error' });
    expect(result.items.every((a) => a.severity === 'error')).toBe(true);
  });

  it('filters unread alerts (isRead=false)', async () => {
    const result = await AlertService.findMany({ isRead: false });
    expect(result.items.every((a) => a.is_read === false)).toBe(true);
  });
});

// ─── findUnread ───────────────────────────────────────────────────────────────

describe('AlertService.findUnread', () => {
  it('returns only unread, non-dismissed alerts', async () => {
    await createAlert({ title: 'Unread 1' });
    await createAlert({ title: 'Unread 2' });

    const result = await AlertService.findUnread();

    expect(result.items.every((a) => !a.is_read && !a.is_dismissed)).toBe(true);
    expect(result.total).toBeGreaterThanOrEqual(2);
  });

  it('paginates unread alerts', async () => {
    const page = await AlertService.findUnread({ page: 1, pageSize: 2 });
    expect(page.items.length).toBeLessThanOrEqual(2);
    expect(page.pageSize).toBe(2);
  });
});

// ─── countUnread ──────────────────────────────────────────────────────────────

describe('AlertService.countUnread', () => {
  it('returns count of unread non-dismissed alerts', async () => {
    const before = await AlertService.countUnread();

    await createAlert({ title: 'Count Test' });
    const after = await AlertService.countUnread();

    expect(after).toBe(before + 1);
  });
});

// ─── markRead ─────────────────────────────────────────────────────────────────

describe('AlertService.markRead', () => {
  it('marks alert as read and sets read_at', async () => {
    const alert = await createAlert({ title: 'To Be Read' });
    expect(alert.is_read).toBe(false);

    const updated = await AlertService.markRead(alert.id);

    expect(updated.is_read).toBe(true);
    expect(updated.read_at).toBeInstanceOf(Date);
  });

  it('unread count decreases after markRead', async () => {
    const alert = await createAlert({ title: 'Countdown Alert' });
    const before = await AlertService.countUnread();

    await AlertService.markRead(alert.id);
    const after = await AlertService.countUnread();

    expect(after).toBe(before - 1);
  });
});

// ─── dismiss ──────────────────────────────────────────────────────────────────

describe('AlertService.dismiss', () => {
  it('marks alert as dismissed', async () => {
    const alert = await createAlert({ title: 'Dismiss Me' });

    const updated = await AlertService.dismiss(alert.id);

    expect(updated.is_dismissed).toBe(true);
  });

  it('dismissed alert is excluded from findUnread', async () => {
    const alert = await createAlert({ title: 'Dismissed Unread' });
    await AlertService.dismiss(alert.id);

    const unread = await AlertService.findUnread();
    expect(unread.items.every((a) => a.id !== alert.id)).toBe(true);
  });
});

// ─── markAllRead ──────────────────────────────────────────────────────────────

describe('AlertService.markAllRead', () => {
  it('marks all unread alerts as read and returns count', async () => {
    await createAlert({ title: 'Batch Read 1' });
    await createAlert({ title: 'Batch Read 2' });

    const count = await AlertService.markAllRead();

    expect(count).toBeGreaterThanOrEqual(2);
    expect(await AlertService.countUnread()).toBe(0);
  });
});
