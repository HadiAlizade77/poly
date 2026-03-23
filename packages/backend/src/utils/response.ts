import type { Response } from 'express';
import type { PaginatedResult } from '../services/utils/pagination.js';

export function sendList<T>(res: Response, result: PaginatedResult<T>): void {
  res.json({
    success: true,
    data: result.items,
    meta: {
      page: result.page,
      pageSize: result.pageSize,
      total: result.total,
      totalPages: result.totalPages,
    },
  });
}

export function sendItem<T>(res: Response, data: T, status = 200): void {
  res.status(status).json({ success: true, data });
}

export function sendNoContent(res: Response): void {
  res.status(204).end();
}

/** Parse page/pageSize from Express query params. */
export function parsePagination(query: Record<string, unknown>): {
  page: number;
  pageSize: number;
} {
  const page = Math.max(1, Number(query.page) || 1);
  const pageSize = Math.min(100, Math.max(1, Number(query.pageSize) || 20));
  return { page, pageSize };
}
