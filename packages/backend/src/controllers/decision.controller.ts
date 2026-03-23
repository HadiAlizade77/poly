import type { Request, Response, NextFunction } from 'express';
import * as aiDecisionService from '../services/ai-decision.service.js';
import { sendList, sendItem, parsePagination } from '../utils/response.js';
import type { DecisionAction } from '@prisma/client';

export async function listDecisions(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const filter: aiDecisionService.AiDecisionFilter = {
      ...(req.query.marketId && { marketId: String(req.query.marketId) }),
      ...(req.query.category && { category: String(req.query.category) }),
      ...(req.query.action && { action: req.query.action as DecisionAction }),
      ...(req.query.wasExecuted !== undefined && {
        wasExecuted: req.query.wasExecuted === 'true',
      }),
      ...(req.query.since && { since: new Date(String(req.query.since)) }),
      ...(req.query.until && { until: new Date(String(req.query.until)) }),
    };
    const result = await aiDecisionService.findMany(filter, { page, pageSize });
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getDecision(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const decision = await aiDecisionService.findById(BigInt(req.params.id));
    sendItem(res, decision);
  } catch (err) {
    next(err);
  }
}

export async function getDecisionStats(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const since = req.query.since ? new Date(String(req.query.since)) : undefined;
    const stats = await aiDecisionService.getStats(since);
    sendItem(res, stats);
  } catch (err) {
    next(err);
  }
}
