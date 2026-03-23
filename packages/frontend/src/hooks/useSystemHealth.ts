/**
 * Canonical hook name for system health — combines REST polling with WebSocket updates.
 * Components should import from here rather than useHealthSocket directly.
 */
export {
  useHealthSocket as useSystemHealth,
  formatUptime,
  feedStaleness,
} from './useHealthSocket'

export type {
  SystemHealthPayload,
  ServiceStatus,
  FeedStatus,
  HealthMemory,
} from './useHealthSocket'
