export type WSChannel =
  | 'market:update'
  | 'market:snapshot'
  | 'score:update'
  | 'decision:new'
  | 'order:update'
  | 'position:update'
  | 'risk:event'
  | 'alert:new'
  | 'bankroll:update'
  | 'system:health';

export interface WSMessage<T = unknown> {
  channel: WSChannel;
  timestamp: Date;
  data: T;
}
