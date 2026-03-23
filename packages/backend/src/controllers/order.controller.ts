import type { Request, Response, NextFunction } from 'express';
import * as orderService from '../services/order.service.js';
import { sendList, sendItem, parsePagination } from '../utils/response.js';
import type { OrderStatus, OrderSide } from '@prisma/client';

export async function listOrders(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const { page, pageSize } = parsePagination(req.query);
    const filter: orderService.OrderFilter = {
      ...(req.query.marketId && { marketId: String(req.query.marketId) }),
      ...(req.query.status && { status: req.query.status as OrderStatus }),
      ...(req.query.side && { side: req.query.side as OrderSide }),
    };
    const result = await orderService.findMany(filter, { page, pageSize });
    sendList(res, result);
  } catch (err) {
    next(err);
  }
}

export async function getOrder(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const order = await orderService.findById(req.params.id);
    sendItem(res, order);
  } catch (err) {
    next(err);
  }
}

export async function updateOrderStatus(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const {
      status,
      polymarket_order_id,
      filled_size,
      avg_fill_price,
      error_message,
      filled_at,
      cancelled_at,
    } = req.body as {
      status: OrderStatus;
      polymarket_order_id?: string;
      filled_size?: string;
      avg_fill_price?: string;
      error_message?: string;
      filled_at?: string;
      cancelled_at?: string;
    };

    const order = await orderService.updateStatus(req.params.id, status, {
      ...(polymarket_order_id !== undefined && { polymarketOrderId: polymarket_order_id }),
      ...(filled_size !== undefined && { filledSize: filled_size }),
      ...(avg_fill_price !== undefined && { avgFillPrice: avg_fill_price }),
      ...(error_message !== undefined && { errorMessage: error_message }),
      ...(filled_at !== undefined && { filledAt: new Date(filled_at) }),
      ...(cancelled_at !== undefined && { cancelledAt: new Date(cancelled_at) }),
    });
    sendItem(res, order);
  } catch (err) {
    next(err);
  }
}
