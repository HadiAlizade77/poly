import type { Request, Response, NextFunction } from 'express';
import * as positionService from '../services/position.service.js';
import * as positionHistoryService from '../services/position-history.service.js';
import { sendItem } from '../utils/response.js';
import type { ExitStrategy, CloseReason } from '@prisma/client';
import prisma from '../config/database.js';
import type { PaginatedResult } from '../services/utils/pagination.js';
import type { Position } from '@prisma/client';
import { create as createAuditLog } from '../services/audit-log.service.js';

export async function listPositions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const positions = await positionService.findAll();
    const result: PaginatedResult<Position> = {
      items: positions,
      total: positions.length,
      page: 1,
      pageSize: positions.length,
      totalPages: 1,
    };
    res.json({ success: true, data: result.items, meta: { total: result.total } });
  } catch (err) {
    next(err);
  }
}

export async function getPosition(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const position = await positionService.findById(req.params.id);
    sendItem(res, position);
  } catch (err) {
    next(err);
  }
}

export async function updateExitStrategy(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { exit_strategy, stop_loss_price, time_exit_at } = req.body as {
      exit_strategy: ExitStrategy;
      stop_loss_price?: string;
      time_exit_at?: string;
    };
    const position = await positionService.setExitStrategy(
      req.params.id,
      exit_strategy,
      stop_loss_price,
      time_exit_at ? new Date(time_exit_at) : undefined,
    );
    sendItem(res, position);
  } catch (err) {
    next(err);
  }
}

export async function closePosition(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const position = await positionService.findById(req.params.id);
    const { close_reason } = req.body as { close_reason: CloseReason };

    // Archive to position_history then delete — done in a transaction
    await prisma.$transaction(async (tx) => {
      const p = position as Record<string, unknown>;
      await (tx as typeof prisma).positionHistory.create({
        data: {
          market_id: p.market_id as string,
          outcome_token: p.outcome_token as string,
          side: p.side as 'long' | 'short',
          size: p.size as string,
          avg_entry_price: p.avg_entry_price as string,
          realized_pnl: p.realized_pnl as string,
          total_fees: p.total_fees as string,
          decision_id: p.decision_id as bigint | null,
          opened_at: p.opened_at as Date,
          close_reason,
        },
      });
      await (tx as typeof prisma).position.delete({
        where: { id: p.id as string },
      });
    });

    void createAuditLog(
      'position_closed_manual',
      'position',
      req.params.id,
      { close_reason, side: (position as Record<string, unknown>).side, outcome_token: (position as Record<string, unknown>).outcome_token },
      'user',
    ).catch(() => {});

    res.status(204).end();
  } catch (err) {
    next(err);
  }
}
