import {
  type Market,
  type MarketCategory,
  type MarketStatus,
  type Prisma,
} from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';
import { emitMarketUpdate } from '../websocket/emit.js';

export interface MarketFilter {
  category?: MarketCategory;
  status?: MarketStatus;
  isTradeable?: boolean;
  search?: string;
}

export async function findMany(
  filter: MarketFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<Market>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.MarketWhereInput = {
    ...(filter.category !== undefined && { category: filter.category }),
    ...(filter.status !== undefined && { status: filter.status }),
    ...(filter.isTradeable !== undefined && { is_tradeable: filter.isTradeable }),
    ...(filter.search !== undefined && {
      title: { contains: filter.search, mode: 'insensitive' as const },
    }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.market.findMany({ where, skip, take, orderBy: { updated_at: 'desc' } }),
    prisma.market.count({ where }),
  ]);

  return buildPaginatedResult(items as Market[], total, page, pageSize);
}

export async function findById(id: string): Promise<Market> {
  const record = await prisma.market.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('Market', id);
  return record as Market;
}

export async function findByPolymarketId(polymarketId: string): Promise<Market | null> {
  return prisma.market.findUnique({
    where: { polymarket_id: polymarketId },
  }) as Promise<Market | null>;
}

export async function findByCategory(
  category: MarketCategory,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<Market>> {
  return findMany({ category }, pagination);
}

export async function findTradeable(
  category?: MarketCategory,
): Promise<Market[]> {
  return prisma.market.findMany({
    where: {
      status: 'active',
      is_tradeable: true,
      ...(category !== undefined && { category }),
    },
    orderBy: { volume_24h: 'desc' },
  }) as Promise<Market[]>;
}

export async function create(
  data: Prisma.MarketUncheckedCreateInput,
): Promise<Market> {
  const result = await withPrismaError('Market', () =>
    prisma.market.create({ data }) as Promise<Market>,
  );
  emitMarketUpdate(result.id, result);
  return result;
}

export async function update(
  id: string,
  data: Prisma.MarketUncheckedUpdateInput,
): Promise<Market> {
  const result = await withPrismaError('Market', () =>
    prisma.market.update({ where: { id }, data }) as Promise<Market>,
  );
  emitMarketUpdate(result.id, result);
  return result;
}

export async function upsert(
  polymarketId: string,
  create: Prisma.MarketUncheckedCreateInput,
  update: Prisma.MarketUncheckedUpdateInput,
): Promise<Market> {
  const result = await withPrismaError('Market', () =>
    prisma.market.upsert({
      where: { polymarket_id: polymarketId },
      create,
      update,
    }) as Promise<Market>,
  );
  emitMarketUpdate(result.id, result);
  return result;
}

export async function remove(id: string): Promise<Market> {
  return withPrismaError('Market', () =>
    prisma.market.delete({ where: { id } }) as Promise<Market>,
  );
}

export async function setStatus(
  id: string,
  status: MarketStatus,
  exclusionReason?: string,
): Promise<Market> {
  const result = await withPrismaError('Market', () =>
    prisma.market.update({
      where: { id },
      data: {
        status,
        ...(exclusionReason !== undefined && { exclusion_reason: exclusionReason }),
      },
    }) as Promise<Market>,
  );
  emitMarketUpdate(result.id, result);
  return result;
}
