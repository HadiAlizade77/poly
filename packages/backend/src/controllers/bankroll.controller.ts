import type { Request, Response, NextFunction } from 'express';
import * as bankrollService from '../services/bankroll.service.js';
import { sendList, sendItem, parsePagination } from '../utils/response.js';

export async function getBankroll(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const bankroll = await bankrollService.get();
    sendItem(res, bankroll);
  } catch (err) {
    next(err);
  }
}

export async function updateBankroll(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const bankroll = await bankrollService.update(
      req.body as Parameters<typeof bankrollService.update>[0],
    );
    sendItem(res, bankroll);
  } catch (err) {
    next(err);
  }
}

export async function getBankrollHistory(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = parsePagination(req.query);

    if (req.query.from && req.query.to) {
      const items = await bankrollService.getHistoryByDateRange(
        new Date(String(req.query.from)),
        new Date(String(req.query.to)),
      );
      res.json({
        success: true,
        data: items,
        meta: { total: items.length },
      });
      return;
    }

    const result = await bankrollService.getHistory({ page, pageSize });
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}
