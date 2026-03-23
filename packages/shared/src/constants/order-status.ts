import type { OrderStatus } from '../types/order.js';

export const ORDER_STATUSES: OrderStatus[] = [
  'pending',
  'open',
  'partial',
  'filled',
  'cancelled',
  'failed',
  'expired',
];

export const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['pending', 'open', 'partial'];
export const TERMINAL_ORDER_STATUSES: OrderStatus[] = ['filled', 'cancelled', 'failed', 'expired'];
