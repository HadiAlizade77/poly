// Shared utilities & errors
export * from './utils/pagination.js';
export * from './errors.js';

// Domain services — imported as namespaces so call-sites read clearly:
//   import { marketService } from '../services/index.js'
//   await marketService.findById(id)
export * as marketService from './market.service.js';
export * as marketSnapshotService from './market-snapshot.service.js';
export * as contextScoreService from './context-score.service.js';
export * as scorerConfigService from './scorer-config.service.js';
export * as aiDecisionService from './ai-decision.service.js';
export * as tradeFeedbackService from './trade-feedback.service.js';
export * as orderService from './order.service.js';
export * as tradeService from './trade.service.js';
export * as positionService from './position.service.js';
export * as positionHistoryService from './position-history.service.js';
export * as aiReviewService from './ai-review.service.js';
export * as riskEventService from './risk-event.service.js';
export * as alertService from './alert.service.js';
export * as bankrollService from './bankroll.service.js';
export * as systemConfigService from './system-config.service.js';
export * as auditLogService from './audit-log.service.js';
