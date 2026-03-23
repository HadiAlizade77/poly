import type { Request, Response, NextFunction } from 'express';
import * as scorerConfigService from '../services/scorer-config.service.js';
import { sendList, sendItem } from '../utils/response.js';
import type { PaginatedResult } from '../services/utils/pagination.js';
import type { ScorerConfig } from '@prisma/client';

export async function listScorerConfigs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const category = req.query.category as string | undefined;
    const enabledOnly = req.query.enabled === 'true';

    let items: ScorerConfig[];
    if (enabledOnly) {
      items = await scorerConfigService.findEnabled(category);
    } else if (category !== undefined) {
      items = await scorerConfigService.findByCategory(category);
    } else {
      items = await scorerConfigService.findAll();
    }

    // Wrap as a pseudo-paginated result for consistent response shape
    const result: PaginatedResult<ScorerConfig> = {
      items,
      total: items.length,
      page: 1,
      pageSize: items.length,
      totalPages: 1,
    };
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getScorerConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const config = await scorerConfigService.findById(req.params.id);
    sendItem(res, config);
  } catch (err) {
    next(err);
  }
}

export async function upsertScorerConfig(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { category, scorer_name, parameters, description, is_enabled } = req.body as {
      category: string;
      scorer_name: string;
      parameters: Record<string, unknown>;
      description?: string;
      is_enabled?: boolean;
    };
    const config = await scorerConfigService.upsert(category, scorer_name, {
      parameters: parameters as Parameters<typeof scorerConfigService.upsert>[2]['parameters'],
      ...(description !== undefined && { description }),
      ...(is_enabled !== undefined && { is_enabled }),
    });
    sendItem(res, config);
  } catch (err) {
    next(err);
  }
}

export async function toggleScorer(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const config = await scorerConfigService.toggleEnabled(req.params.id);
    sendItem(res, config);
  } catch (err) {
    next(err);
  }
}
