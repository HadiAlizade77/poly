/**
 * All WebSocket room/channel names used across the platform.
 * Services emit to these rooms; clients subscribe by joining them.
 */
export const WS_CHANNELS = {
  MARKET_UPDATE: 'market:update',
  SCORE_UPDATE: 'score:update',
  DECISION_NEW: 'decision:new',
  ORDER_UPDATE: 'order:update',
  POSITION_UPDATE: 'position:update',
  RISK_EVENT: 'risk:event',
  ALERT_NEW: 'alert:new',
  BANKROLL_UPDATE: 'bankroll:update',
  SYSTEM_HEALTH: 'system:health',
  TRADING_STATE: 'trading:state',
} as const;

export type WsChannel = (typeof WS_CHANNELS)[keyof typeof WS_CHANNELS];

/** Shape of each event payload, keyed by channel. */
export interface WsEventMap {
  'market:update': { marketId: string; data: unknown };
  'score:update': { marketId: string; category: string; scores: unknown };
  'decision:new': { decisionId: string; marketId: string; action: string; data: unknown };
  'order:update': { orderId: string; status: string; data: unknown };
  'position:update': { positionId: string; marketId: string; data: unknown };
  'risk:event': { eventType: string; severity: string; data: unknown };
  'alert:new': { alertId: string; alertType: string; severity: string; data: unknown };
  'bankroll:update': { data: unknown };
  'system:health': { status: string; uptime: number; timestamp: string };
  'trading:state': { state: string; timestamp: string };
}
