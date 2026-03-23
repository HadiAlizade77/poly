import { type Position, type ExitStrategy, type Prisma } from '@prisma/client';
import prisma from '../config/database.js';
import { withPrismaError, NotFoundError } from './errors.js';
import { emitPositionUpdate } from '../websocket/emit.js';

export async function findAll(): Promise<Position[]> {
  return prisma.position.findMany({ orderBy: { opened_at: 'desc' } }) as Promise<
    Position[]
  >;
}

export async function findOpen(): Promise<Position[]> {
  // All positions in the table are "open" — closed positions move to position_history
  return findAll();
}

export async function findById(id: string): Promise<Position> {
  const record = await prisma.position.findUnique({ where: { id } });
  if (!record) throw new NotFoundError('Position', id);
  return record as Position;
}

export async function findByMarket(marketId: string): Promise<Position[]> {
  return prisma.position.findMany({ where: { market_id: marketId } }) as Promise<
    Position[]
  >;
}

export async function findByMarketAndToken(
  marketId: string,
  outcomeToken: string,
): Promise<Position | null> {
  return prisma.position.findUnique({
    where: {
      market_id_outcome_token: { market_id: marketId, outcome_token: outcomeToken },
    },
  }) as Promise<Position | null>;
}

export async function create(
  data: Prisma.PositionUncheckedCreateInput,
): Promise<Position> {
  const result = await withPrismaError('Position', () =>
    prisma.position.create({ data }) as Promise<Position>,
  );
  emitPositionUpdate(result.id, result.market_id, result);
  return result;
}

export async function update(
  id: string,
  data: Prisma.PositionUncheckedUpdateInput,
): Promise<Position> {
  const result = await withPrismaError('Position', () =>
    prisma.position.update({ where: { id }, data }) as Promise<Position>,
  );
  emitPositionUpdate(result.id, result.market_id, result);
  return result;
}

export async function upsert(
  marketId: string,
  outcomeToken: string,
  create: Prisma.PositionUncheckedCreateInput,
  updateData: Prisma.PositionUncheckedUpdateInput,
): Promise<Position> {
  const result = await withPrismaError('Position', () =>
    prisma.position.upsert({
      where: {
        market_id_outcome_token: { market_id: marketId, outcome_token: outcomeToken },
      },
      create,
      update: updateData,
    }) as Promise<Position>,
  );
  emitPositionUpdate(result.id, result.market_id, result);
  return result;
}

export async function updatePrice(
  id: string,
  currentPrice: string,
  unrealizedPnl: string,
): Promise<Position> {
  const result = await withPrismaError('Position', () =>
    prisma.position.update({
      where: { id },
      data: { current_price: currentPrice, unrealized_pnl: unrealizedPnl },
    }) as Promise<Position>,
  );
  emitPositionUpdate(result.id, result.market_id, result);
  return result;
}

export async function setExitStrategy(
  id: string,
  exitStrategy: ExitStrategy,
  stopLossPrice?: string,
  timeExitAt?: Date,
): Promise<Position> {
  return withPrismaError('Position', () =>
    prisma.position.update({
      where: { id },
      data: {
        exit_strategy: exitStrategy,
        ...(stopLossPrice !== undefined && { stop_loss_price: stopLossPrice }),
        ...(timeExitAt !== undefined && { time_exit_at: timeExitAt }),
      },
    }) as Promise<Position>,
  );
}

export async function remove(id: string): Promise<Position> {
  return withPrismaError('Position', () =>
    prisma.position.delete({ where: { id } }) as Promise<Position>,
  );
}
