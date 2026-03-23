import type { Request, Response, NextFunction } from 'express';
import * as marketService from '../services/market.service.js';
import { sendList, sendItem, parsePagination } from '../utils/response.js';
import type { MarketCategory, MarketStatus } from '@prisma/client';

export async function listMarkets(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const filter: marketService.MarketFilter = {
      ...(req.query.category && { category: req.query.category as MarketCategory }),
      ...(req.query.status && { status: req.query.status as MarketStatus }),
      ...(req.query.isTradeable !== undefined && {
        isTradeable: req.query.isTradeable === 'true',
      }),
      ...(req.query.search && { search: String(req.query.search) }),
    };
    const result = await marketService.findMany(filter, { page, pageSize });
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getMarket(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const market = await marketService.findById(req.params.id);
    sendItem(res, market);
  } catch (err) {
    next(err);
  }
}

export async function createMarket(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const market = await marketService.create(req.body as Parameters<typeof marketService.create>[0]);
    sendItem(res, market, 201);
  } catch (err) {
    next(err);
  }
}

export async function updateMarket(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const market = await marketService.update(
      req.params.id,
      req.body as Parameters<typeof marketService.update>[1],
    );
    sendItem(res, market);
  } catch (err) {
    next(err);
  }
}

export async function setMarketStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { status, exclusion_reason } = req.body as {
      status: MarketStatus;
      exclusion_reason?: string;
    };
    const market = await marketService.setStatus(req.params.id, status, exclusion_reason);
    sendItem(res, market);
  } catch (err) {
    next(err);
  }
}
