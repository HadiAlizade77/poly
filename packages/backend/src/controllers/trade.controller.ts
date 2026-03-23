import type { Request, Response, NextFunction } from 'express';
import * as tradeService from '../services/trade.service.js';
import { sendList, sendItem, parsePagination } from '../utils/response.js';
import type { OrderSide } from '@prisma/client';

export async function listTrades(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const filter: tradeService.TradeFilter = {
      ...(req.query.marketId && { marketId: String(req.query.marketId) }),
      ...(req.query.orderId && { orderId: String(req.query.orderId) }),
      ...(req.query.side && { side: req.query.side as OrderSide }),
      ...(req.query.since && { since: new Date(String(req.query.since)) }),
      ...(req.query.until && { until: new Date(String(req.query.until)) }),
    };
    const result = await tradeService.findMany(filter, { page, pageSize });
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getTrade(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const trade = await tradeService.findById(req.params.id);
    sendItem(res, trade);
  } catch (err) {
    next(err);
  }
}

export async function getTradeStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const since = req.query.since ? new Date(String(req.query.since)) : undefined;
    const trades = await tradeService.getRecentTrades(Number(req.query.limit) || 50);
    sendItem(res, { recentTrades: trades, since });
  } catch (err) {
    next(err);
  }
}
