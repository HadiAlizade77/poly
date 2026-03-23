import type { Request, Response, NextFunction } from 'express';
import * as alertService from '../services/alert.service.js';
import { sendList, sendItem, parsePagination } from '../utils/response.js';
import type { AlertType, AlertSeverity } from '@prisma/client';

export async function listAlerts(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = parsePagination(req.query);

    if (req.query.unread === 'true') {
      const result = await alertService.findUnread({ page, pageSize });
      sendList(res, result);
      return;
    }

    const filter: alertService.AlertFilter = {
      ...(req.query.alertType && { alertType: req.query.alertType as AlertType }),
      ...(req.query.severity && { severity: req.query.severity as AlertSeverity }),
      ...(req.query.isRead !== undefined && { isRead: req.query.isRead === 'true' }),
      ...(req.query.isDismissed !== undefined && {
        isDismissed: req.query.isDismissed === 'true',
      }),
    };
    const result = await alertService.findMany(filter, { page, pageSize });
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}

export async function markAlertRead(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const alert = await alertService.markRead(BigInt(req.params.id));
    sendItem(res, alert);
  } catch (err) {
    next(err);
  }
}

export async function dismissAlert(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const alert = await alertService.dismiss(BigInt(req.params.id));
    sendItem(res, alert);
  } catch (err) {
    next(err);
  }
}

export async function markAllRead(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const count = await alertService.markAllRead();
    sendItem(res, { marked: count });
  } catch (err) {
    next(err);
  }
}

export async function getUnreadCount(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const count = await alertService.countUnread();
    sendItem(res, { count });
  } catch (err) {
    next(err);
  }
}
