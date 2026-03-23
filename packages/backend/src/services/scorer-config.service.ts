import { type ScorerConfig, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';

export async function findAll(): Promise<ScorerConfig[]> {
  return prisma.scorerConfig.findMany({
    orderBy: [{ category: 'asc' }, { scorer_name: 'asc' }],
  }) as Promise<ScorerConfig[]>;
}

export async function findByCategory(category: string): Promise<ScorerConfig[]> {
  return prisma.scorerConfig.findMany({
    where: { category },
    orderBy: { scorer_name: 'asc' },
  }) as Promise<ScorerConfig[]>;
}

export async function findEnabled(category?: string): Promise<ScorerConfig[]> {
  return prisma.scorerConfig.findMany({
    where: { is_enabled: true, ...(category !== undefined && { category }) },
    orderBy: [{ category: 'asc' }, { scorer_name: 'asc' }],
  }) as Promise<ScorerConfig[]>;
}

export async function findById(id: string): Promise<ScorerConfig> {
  const record = await prisma.scorerConfig.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('ScorerConfig', id);
  return record as ScorerConfig;
}

export async function findByCategoryAndName(
  category: string,
  scorerName: string,
): Promise<ScorerConfig | null> {
  return prisma.scorerConfig.findUnique({
    where: { category_scorer_name: { category, scorer_name: scorerName } },
  }) as Promise<ScorerConfig | null>;
}

export async function create(
  data: Prisma.ScorerConfigUncheckedCreateInput,
): Promise<ScorerConfig> {
  return withPrismaError('ScorerConfig', () =>
    prisma.scorerConfig.create({ data }) as Promise<ScorerConfig>,
  );
}

export async function update(
  id: string,
  data: Prisma.ScorerConfigUncheckedUpdateInput,
): Promise<ScorerConfig> {
  return withPrismaError('ScorerConfig', () =>
    prisma.scorerConfig.update({ where: { id }, data }) as Promise<ScorerConfig>,
  );
}

export async function upsert(
  category: string,
  scorerName: string,
  data: Omit<Prisma.ScorerConfigUncheckedCreateInput, 'category' | 'scorer_name'>,
): Promise<ScorerConfig> {
  return withPrismaError('ScorerConfig', () =>
    prisma.scorerConfig.upsert({
      where: { category_scorer_name: { category, scorer_name: scorerName } },
      create: { category, scorer_name: scorerName, ...data },
      update: data,
    }) as Promise<ScorerConfig>,
  );
}

export async function toggleEnabled(id: string): Promise<ScorerConfig> {
  const existing = await findById(id);
  return prisma.scorerConfig.update({
    where: { id },
    data: { is_enabled: !(existing as { is_enabled: boolean }).is_enabled },
  }) as Promise<ScorerConfig>;
}

export async function remove(id: string): Promise<ScorerConfig> {
  return withPrismaError('ScorerConfig', () =>
    prisma.scorerConfig.delete({ where: { id } }) as Promise<ScorerConfig>,
  );
}
