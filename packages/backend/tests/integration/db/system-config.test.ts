import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { prisma, cleanDatabase } from './db-helpers.js';

beforeEach(async () => {
  await cleanDatabase();
});

afterAll(async () => {
  await prisma.$disconnect();
});

// ─── CREATE ──────────────────────────────────────────────────────────────────

describe('SystemConfig CREATE', () => {
  it('creates a config entry with a JSON value', async () => {
    const config = await prisma.systemConfig.create({
      data: {
        key: 'scorer_cycle_intervals',
        value: { crypto: 60, politics: 300, sports: 120 },
        description: 'Per-category scoring cycle timing in seconds',
      },
    });

    expect(config.id).toBeTruthy();
    expect(config.key).toBe('scorer_cycle_intervals');
    expect(config.value).toEqual({ crypto: 60, politics: 300, sports: 120 });
    expect(config.description).toBe('Per-category scoring cycle timing in seconds');
    expect(config.updated_at).toBeInstanceOf(Date);
  });

  it('creates a config entry with a scalar value', async () => {
    const config = await prisma.systemConfig.create({
      data: { key: 'feedback_window_hours', value: 8 },
    });

    expect(config.value).toBe(8);
  });

  it('creates a config entry with a boolean value', async () => {
    const config = await prisma.systemConfig.create({
      data: { key: 'kill_switch_enabled', value: false },
    });

    expect(config.value).toBe(false);
  });

  it('rejects duplicate key (unique constraint)', async () => {
    await prisma.systemConfig.create({ data: { key: 'my-key', value: 1 } });

    await expect(
      prisma.systemConfig.create({ data: { key: 'my-key', value: 2 } }),
    ).rejects.toMatchObject({ code: 'P2002' });
  });
});

// ─── READ ────────────────────────────────────────────────────────────────────

describe('SystemConfig READ', () => {
  it('finds config by key', async () => {
    await prisma.systemConfig.create({ data: { key: 'max_position_size', value: 0.05 } });

    const config = await prisma.systemConfig.findUnique({ where: { key: 'max_position_size' } });

    expect(config).not.toBeNull();
    expect(config!.value).toBe(0.05);
  });

  it('returns null for unknown key', async () => {
    const config = await prisma.systemConfig.findUnique({ where: { key: 'nonexistent' } });
    expect(config).toBeNull();
  });

  it('returns all config entries', async () => {
    await prisma.systemConfig.createMany({
      data: [
        { key: 'key_a', value: 'val_a' },
        { key: 'key_b', value: 'val_b' },
        { key: 'key_c', value: 'val_c' },
      ],
    });

    const all = await prisma.systemConfig.findMany();
    expect(all.length).toBe(3);
  });

  it('paginates config entries', async () => {
    await prisma.systemConfig.createMany({
      data: Array.from({ length: 5 }, (_, i) => ({ key: `key_${i}`, value: i })),
    });

    const page = await prisma.systemConfig.findMany({ take: 2, skip: 0 });
    expect(page.length).toBe(2);
  });
});

// ─── UPDATE ──────────────────────────────────────────────────────────────────

describe('SystemConfig UPDATE', () => {
  it('updates a config value', async () => {
    await prisma.systemConfig.create({
      data: { key: 'kill_switch_enabled', value: false },
    });

    const updated = await prisma.systemConfig.update({
      where: { key: 'kill_switch_enabled' },
      data: { value: true },
    });

    expect(updated.value).toBe(true);
  });

  it('updates the description', async () => {
    await prisma.systemConfig.create({
      data: { key: 'some_setting', value: 42, description: 'Old description' },
    });

    const updated = await prisma.systemConfig.update({
      where: { key: 'some_setting' },
      data: { description: 'Updated description' },
    });

    expect(updated.description).toBe('Updated description');
  });

  it('upserts a config entry', async () => {
    const first = await prisma.systemConfig.upsert({
      where: { key: 'upsert_key' },
      create: { key: 'upsert_key', value: 'initial' },
      update: { value: 'initial' },
    });
    expect(first.value).toBe('initial');

    const second = await prisma.systemConfig.upsert({
      where: { key: 'upsert_key' },
      create: { key: 'upsert_key', value: 'should_not_create' },
      update: { value: 'updated' },
    });
    expect(second.value).toBe('updated');

    const count = await prisma.systemConfig.count({ where: { key: 'upsert_key' } });
    expect(count).toBe(1);
  });
});

// ─── DELETE ──────────────────────────────────────────────────────────────────

describe('SystemConfig DELETE', () => {
  it('deletes a config entry by key', async () => {
    await prisma.systemConfig.create({ data: { key: 'to_delete', value: 'x' } });

    await prisma.systemConfig.delete({ where: { key: 'to_delete' } });

    expect(await prisma.systemConfig.findUnique({ where: { key: 'to_delete' } })).toBeNull();
  });

  it('deletes all config entries', async () => {
    await prisma.systemConfig.createMany({
      data: [
        { key: 'del_a', value: 1 },
        { key: 'del_b', value: 2 },
      ],
    });

    await prisma.systemConfig.deleteMany();
    expect(await prisma.systemConfig.count()).toBe(0);
  });
});

// ─── RiskConfig ───────────────────────────────────────────────────────────────

describe('RiskConfig', () => {
  it('creates a global risk config', async () => {
    const config = await prisma.riskConfig.create({
      data: {
        scope: 'global',
        parameters: {
          max_daily_loss_pct: 5,
          max_position_size_pct: 5,
          max_total_exposure_pct: 50,
        },
        updated_by: 'system',
      },
    });

    expect(config.scope).toBe('global');
    expect(config.scope_value).toBeNull();
    expect(config.updated_by).toBe('system');
  });

  it('creates category-scoped risk config', async () => {
    const config = await prisma.riskConfig.create({
      data: {
        scope: 'category',
        scope_value: 'crypto',
        parameters: { max_position_size_pct: 3 },
      },
    });

    expect(config.scope).toBe('category');
    expect(config.scope_value).toBe('crypto');
  });

  it('finds risk config by scope', async () => {
    await prisma.riskConfig.create({ data: { scope: 'global', parameters: {} } });
    await prisma.riskConfig.create({ data: { scope: 'category', scope_value: 'crypto', parameters: {} } });

    const global = await prisma.riskConfig.findMany({ where: { scope: 'global' } });
    expect(global.length).toBe(1);
  });

  it('updates risk parameters', async () => {
    const config = await prisma.riskConfig.create({
      data: { scope: 'global', parameters: { max_daily_loss_pct: 5 } },
    });

    const updated = await prisma.riskConfig.update({
      where: { id: config.id },
      data: { parameters: { max_daily_loss_pct: 3 }, updated_by: 'admin' },
    });

    expect((updated.parameters as { max_daily_loss_pct: number }).max_daily_loss_pct).toBe(3);
    expect(updated.updated_by).toBe('admin');
  });
});
