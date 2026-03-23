import {
  type SystemConfig,
  type RiskConfig,
  type RiskScope,
  type Prisma,
} from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError } from './errors.js';
import { create as createAuditLog } from './audit-log.service.js';

// ─── System Config ────────────────────────────────────────────────────────────

export async function getAll(): Promise<SystemConfig[]> {
  return prisma.systemConfig.findMany({ orderBy: { key: 'asc' } }) as Promise<
    SystemConfig[]
  >;
}

export async function get(key: string): Promise<SystemConfig | null> {
  return prisma.systemConfig.findUnique({ where: { key } }) as Promise<
    SystemConfig | null
  >;
}

export async function getValue<T = unknown>(key: string): Promise<T | null> {
  const record = await prisma.systemConfig.findUnique({ where: { key } });
  if (!record) return null;
  return (record as unknown as { value: T }).value;
}

export async function set(
  key: string,
  value: unknown,
  description?: string,
  updatedBy?: string,
): Promise<SystemConfig> {
  const result = await withPrismaError('SystemConfig', () =>
    prisma.systemConfig.upsert({
      where: { key },
      create: {
        key,
        value: value as Prisma.InputJsonValue,
        ...(description !== undefined && { description }),
      },
      update: {
        value: value as Prisma.InputJsonValue,
        ...(description !== undefined && { description }),
      },
    }) as Promise<SystemConfig>,
  );

  await createAuditLog('set_system_config', 'system_config', key, { value }, updatedBy);

  return result;
}

export async function remove(key: string): Promise<SystemConfig> {
  return withPrismaError('SystemConfig', () =>
    prisma.systemConfig.delete({ where: { key } }) as Promise<SystemConfig>,
  );
}

// ─── Risk Config ──────────────────────────────────────────────────────────────

export async function getAllRiskConfigs(): Promise<RiskConfig[]> {
  return prisma.riskConfig.findMany({
    orderBy: [{ scope: 'asc' }, { scope_value: 'asc' }],
  }) as Promise<RiskConfig[]>;
}

export async function getRiskConfig(
  scope: RiskScope,
  scopeValue?: string,
): Promise<RiskConfig | null> {
  return prisma.riskConfig.findFirst({
    where: { scope, scope_value: scopeValue ?? null },
  }) as Promise<RiskConfig | null>;
}

export async function setRiskConfig(
  scope: RiskScope,
  scopeValue: string | undefined,
  parameters: unknown,
  updatedBy?: string,
): Promise<RiskConfig> {
  const existing = await prisma.riskConfig.findFirst({
    where: { scope, scope_value: scopeValue ?? null },
  });

  const result: RiskConfig = existing
    ? ((await prisma.riskConfig.update({
        where: { id: (existing as { id: string }).id },
        data: {
          parameters: parameters as Prisma.InputJsonValue,
          ...(updatedBy !== undefined && { updated_by: updatedBy }),
        },
      })) as RiskConfig)
    : ((await prisma.riskConfig.create({
        data: {
          scope,
          scope_value: scopeValue ?? null,
          parameters: parameters as Prisma.InputJsonValue,
          ...(updatedBy !== undefined && { updated_by: updatedBy }),
        },
      })) as RiskConfig);

  await createAuditLog(
    'set_risk_config',
    'risk_config',
    `${scope}:${scopeValue ?? 'global'}`,
    { parameters },
    updatedBy,
  );

  return result;
}

export async function deleteRiskConfig(id: string): Promise<RiskConfig> {
  return withPrismaError('RiskConfig', () =>
    prisma.riskConfig.delete({ where: { id } }) as Promise<RiskConfig>,
  );
}
