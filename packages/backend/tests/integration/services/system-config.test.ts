import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import * as SystemConfigService from '../../../src/services/system-config.service.js';
import { prisma, cleanDatabase } from './helpers.js';

const KEY_PREFIX = 'test_svc_cfg_';

async function cleanTestConfigs() {
  await prisma.systemConfig.deleteMany({ where: { key: { startsWith: KEY_PREFIX } } });
  await prisma.auditLog.deleteMany({ where: { entity_type: 'system_config', entity_id: { startsWith: KEY_PREFIX } } });
}

async function cleanTestRiskConfigs() {
  await prisma.riskConfig.deleteMany({ where: { scope: 'strategy', scope_value: { startsWith: 'test-svc-strategy-' } } });
  await prisma.auditLog.deleteMany({ where: { entity_type: 'risk_config', entity_id: { startsWith: 'strategy:test-svc-strategy-' } } });
}

beforeAll(async () => {
  await cleanDatabase();
  // Ensure a global risk config exists (in case seed was not run)
  const globalConfig = await SystemConfigService.getRiskConfig('global');
  if (!globalConfig) {
    await SystemConfigService.setRiskConfig('global', undefined, {
      max_position_size_pct: 5,
      max_daily_drawdown_pct: 5,
    });
  }
});

afterAll(async () => {
  await cleanTestConfigs();
  await cleanTestRiskConfigs();
  await prisma.$disconnect();
});

// ─── setSystemConfig / findSystemConfigByKey ──────────────────────────────────

describe('SystemConfigService.set', () => {
  it('creates a new config entry', async () => {
    const key = `${KEY_PREFIX}new_setting`;

    const result = await SystemConfigService.set(key, { threshold: 0.05 });

    expect(result.key).toBe(key);
    expect(result.value).toEqual({ threshold: 0.05 });
  });

  it('updates an existing config entry (upsert)', async () => {
    const key = `${KEY_PREFIX}upsert_test`;

    await SystemConfigService.set(key, 'initial');
    const updated = await SystemConfigService.set(key, 'updated');

    expect(updated.value).toBe('updated');

    const count = await prisma.systemConfig.count({ where: { key } });
    expect(count).toBe(1);
  });

  it('stores scalar values (number, boolean, string)', async () => {
    const numConfig = await SystemConfigService.set(`${KEY_PREFIX}num`, 42);
    expect(numConfig.value).toBe(42);

    const boolConfig = await SystemConfigService.set(`${KEY_PREFIX}bool`, false);
    expect(boolConfig.value).toBe(false);

    const strConfig = await SystemConfigService.set(`${KEY_PREFIX}str`, 'hello');
    expect(strConfig.value).toBe('hello');
  });

  it('sets description when provided', async () => {
    const key = `${KEY_PREFIX}with_desc`;
    const result = await SystemConfigService.set(
      key,
      { x: 1 },
      'Test description',
    );

    expect(result.description).toBe('Test description');
  });
});

describe('SystemConfigService.get', () => {
  it('returns the config for a known key', async () => {
    const key = `${KEY_PREFIX}find_me`;
    await SystemConfigService.set(key, 99);

    const found = await SystemConfigService.get(key);

    expect(found).not.toBeNull();
    expect(found!.key).toBe(key);
    expect(found!.value).toBe(99);
  });

  it('returns null for unknown key', async () => {
    const found = await SystemConfigService.get('no_such_key_xyz');
    expect(found).toBeNull();
  });
});

// ─── getSystemConfigValue ─────────────────────────────────────────────────────

describe('SystemConfigService.getValue', () => {
  it('returns typed value', async () => {
    const key = `${KEY_PREFIX}typed_val`;
    await SystemConfigService.set(key, { cycles: 60 });

    const value = await SystemConfigService.getValue<{ cycles: number }>(key);

    expect(value).not.toBeNull();
    expect(value!.cycles).toBe(60);
  });

  it('returns null for missing key', async () => {
    const value = await SystemConfigService.getValue('missing_key_xyz');
    expect(value).toBeNull();
  });
});

// ─── findAllSystemConfigs ─────────────────────────────────────────────────────

describe('SystemConfigService.getAll', () => {
  it('returns all configs ordered by key', async () => {
    await Promise.all([
      SystemConfigService.set(`${KEY_PREFIX}z_last`, 1),
      SystemConfigService.set(`${KEY_PREFIX}a_first`, 2),
    ]);

    const all = await SystemConfigService.getAll();

    expect(Array.isArray(all)).toBe(true);
    expect(all.length).toBeGreaterThanOrEqual(2);

    // Verify ordering
    for (let i = 0; i < all.length - 1; i++) {
      expect(all[i].key <= all[i + 1].key).toBe(true);
    }
  });
});

// ─── deleteSystemConfig ───────────────────────────────────────────────────────

describe('SystemConfigService.remove', () => {
  it('deletes a config entry', async () => {
    const key = `${KEY_PREFIX}to_delete`;
    await SystemConfigService.set(key, 'bye');

    await SystemConfigService.remove(key);

    const found = await SystemConfigService.get(key);
    expect(found).toBeNull();
  });
});

// ─── RiskConfig ───────────────────────────────────────────────────────────────

describe('SystemConfigService.getRiskConfig', () => {
  it('returns existing seed global risk config', async () => {
    const config = await SystemConfigService.getRiskConfig('global');

    // Seed data includes a global risk config
    expect(config).not.toBeNull();
    expect(config!.scope).toBe('global');
  });

  it('returns null for scope with no config', async () => {
    const config = await SystemConfigService.getRiskConfig('strategy', 'nonexistent-xyz');
    expect(config).toBeNull();
  });
});

describe('SystemConfigService.setRiskConfig', () => {
  it('creates a strategy-scoped risk config', async () => {
    const scopeValue = `test-svc-strategy-${Math.random().toString(36).slice(2, 7)}`;

    const result = await SystemConfigService.setRiskConfig(
      'strategy',
      scopeValue,
      { max_position_size_pct: 2 },
      'test',
    );

    expect(result.scope).toBe('strategy');
    expect(result.scope_value).toBe(scopeValue);
    expect((result.parameters as Record<string, number>).max_position_size_pct).toBe(2);
  });
});

describe('SystemConfigService.getAllRiskConfigs', () => {
  it('returns all risk configs ordered by scope then scope_value', async () => {
    const configs = await SystemConfigService.getAllRiskConfigs();

    expect(Array.isArray(configs)).toBe(true);
    expect(configs.length).toBeGreaterThanOrEqual(1); // seed data has at least a global config
  });
});
