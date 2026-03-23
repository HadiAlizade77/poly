import { publish, subscribe } from './redis.js';
import logger from '../config/logger.js';

export const CHANNELS = {
  MARKET_UPDATE: 'market:update',
  MARKET_SCAN_COMPLETE: 'market:scan-complete',
  SIGNAL_GENERATED: 'signal:generated',
  TRADE_EXECUTED: 'trade:executed',
  ORDER_PLACED: 'order:placed',
  ORDER_UPDATE: 'order:update',
  ORDER_CANCELLED: 'order:cancelled',
  POSITION_UPDATE: 'position:update',
  RISK_ALERT: 'risk:alert',
  BANKROLL_UPDATE: 'bankroll:update',
  AI_DECISION: 'ai:decision',
  AI_REVIEW_COMPLETE: 'ai:review-complete',
  REGIME_CHANGE: 'regime:change',
  SYSTEM_ALERT: 'system:alert',
} as const;

export type Channel = (typeof CHANNELS)[keyof typeof CHANNELS];

/**
 * Emit an event to a channel.
 */
export async function emit(channel: Channel, data: unknown): Promise<void> {
  await publish(channel, data);
}

/**
 * Register a handler for a channel.
 * Returns a cleanup function to unsubscribe.
 */
export async function on(
  channel: Channel,
  handler: (data: unknown) => void | Promise<void>,
): Promise<() => Promise<void>> {
  const unsubscribe = await subscribe(channel, handler);
  logger.info('PubSub handler registered', { channel });
  return unsubscribe;
}
