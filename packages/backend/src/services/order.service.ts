import {
  type Order,
  type OrderStatus,
  type OrderSide,
  type Prisma,
} from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';
import { emitOrderUpdate } from '../websocket/emit.js';
import {
  buildPaginatedResult,
  getPaginationArgs,
  type PaginatedResult,
  type PaginationParams,
} from './utils/pagination.js';

export interface OrderFilter {
  marketId?: string;
  status?: OrderStatus;
  side?: OrderSide;
  decisionId?: bigint;
}

export async function findMany(
  filter: OrderFilter = {},
  pagination: PaginationParams = {},
): Promise<PaginatedResult<Order>> {
  const { skip, take, page, pageSize } = getPaginationArgs(pagination);

  const where: Prisma.OrderWhereInput = {
    ...(filter.marketId !== undefined && { market_id: filter.marketId }),
    ...(filter.status !== undefined && { status: filter.status }),
    ...(filter.side !== undefined && { side: filter.side }),
    ...(filter.decisionId !== undefined && { decision_id: filter.decisionId }),
  };

  const [items, total] = await prisma.$transaction([
    prisma.order.findMany({ where, skip, take, orderBy: { created_at: 'desc' } }),
    prisma.order.count({ where }),
  ]);

  return buildPaginatedResult(items as Order[], total, page, pageSize);
}

export async function findById(id: string): Promise<Order> {
  const record = await prisma.order.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('Order', id);
  return record as Order;
}

export async function findByMarket(
  marketId: string,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<Order>> {
  return findMany({ marketId }, pagination);
}

export async function findByStatus(
  status: OrderStatus,
  pagination: PaginationParams = {},
): Promise<PaginatedResult<Order>> {
  return findMany({ status }, pagination);
}

export async function findOpen(): Promise<Order[]> {
  return prisma.order.findMany({
    where: { status: { in: ['pending', 'open', 'partial'] } },
    orderBy: { created_at: 'asc' },
  }) as Promise<Order[]>;
}

export async function create(data: Prisma.OrderUncheckedCreateInput): Promise<Order> {
  const result = await withPrismaError('Order', () =>
    prisma.order.create({ data }) as Promise<Order>,
  );
  emitOrderUpdate(result.id, result.status, result);
  return result;
}

export async function update(
  id: string,
  data: Prisma.OrderUncheckedUpdateInput,
): Promise<Order> {
  const result = await withPrismaError('Order', () =>
    prisma.order.update({ where: { id }, data }) as Promise<Order>,
  );
  emitOrderUpdate(result.id, result.status, result);
  return result;
}

export async function updateStatus(
  id: string,
  status: OrderStatus,
  extra?: Partial<{
    polymarketOrderId: string;
    filledSize: string;
    avgFillPrice: string;
    errorMessage: string;
    filledAt: Date;
    cancelledAt: Date;
  }>,
): Promise<Order> {
  const result = await withPrismaError('Order', () =>
    prisma.order.update({
      where: { id },
      data: {
        status,
        ...(extra?.polymarketOrderId !== undefined && {
          polymarket_order_id: extra.polymarketOrderId,
        }),
        ...(extra?.filledSize !== undefined && { filled_size: extra.filledSize }),
        ...(extra?.avgFillPrice !== undefined && { avg_fill_price: extra.avgFillPrice }),
        ...(extra?.errorMessage !== undefined && { error_message: extra.errorMessage }),
        ...(extra?.filledAt !== undefined && { filled_at: extra.filledAt }),
        ...(extra?.cancelledAt !== undefined && { cancelled_at: extra.cancelledAt }),
      },
    }) as Promise<Order>,
  );
  emitOrderUpdate(result.id, result.status, result);
  return result;
}

export async function remove(id: string): Promise<Order> {
  return withPrismaError('Order', () =>
    prisma.order.delete({ where: { id } }) as Promise<Order>,
  );
}
