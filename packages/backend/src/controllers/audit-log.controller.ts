import type { Request, Response, NextFunction } from 'express';
import * as auditLogService from '../services/audit-log.service.js';
import { sendList, parsePagination } from '../utils/response.js';

export async function listAuditLogs(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const filter: auditLogService.AuditLogFilter = {
      ...(req.query.entityType && { entityType: String(req.query.entityType) }),
      ...(req.query.entityId && { entityId: String(req.query.entityId) }),
      ...(req.query.action && { action: String(req.query.action) }),
      ...(req.query.performedBy && { performedBy: String(req.query.performedBy) }),
      ...(req.query.since && { since: new Date(String(req.query.since)) }),
    };
    const result = await auditLogService.findMany(filter, { page, pageSize });
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}
