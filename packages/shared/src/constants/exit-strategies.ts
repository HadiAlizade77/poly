import type { ExitStrategy, CloseReason } from '../types/position.js';

export const EXIT_STRATEGIES: ExitStrategy[] = [
  'resolution_only',
  'stop_loss',
  'time_based',
  'manual',
];

export const CLOSE_REASONS: CloseReason[] = [
  'resolution',
  'stop_loss',
  'time_exit',
  'manual',
  'risk_veto',
];
