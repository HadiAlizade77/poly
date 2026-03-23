// Re-export canonical types
export type { ContextScorer, ScorerInput, ScorerDimension, ScoredDimensions } from '../scorer.interface.js';

// ── Crypto ──────────────────────────────────────────────────────────────────
export { cryptoScorers, registerCryptoScorers } from './crypto/index.js';
export {
  exchangeDivergenceScorer,
  momentumScorer,
  meanReversionScorer,
  volatilityScorer,
  volumeScorer,
  exhaustionScorer,
  liquidityQualityScorer,
  timePressureScorer,
} from './crypto/index.js';

// ── Politics ────────────────────────────────────────────────────────────────
export { politicsScorers, registerPoliticsScorers } from './politics/index.js';
export {
  pollDivergenceScorer,
  sentimentShiftScorer,
  historicalBaseRateScorer,
  resolutionRiskScorer,
  crowdBiasScorer,
  informationVelocityScorer,
} from './politics/index.js';

// ── Sports ──────────────────────────────────────────────────────────────────
export { sportsScorers, registerSportsScorers } from './sports/index.js';
export {
  oddsDivergenceScorer,
  lineMovementScorer,
  injuryImpactScorer,
  publicBiasScorer,
  modelEdgeScorer,
} from './sports/index.js';

// ── Events ──────────────────────────────────────────────────────────────────
export { eventsScorers, registerEventsScorers } from './events/index.js';
export {
  baseRateScorer,
  scheduleSignalScorer,
  newsImpactScorer,
  crowdConfidenceScorer,
} from './events/index.js';

// ── Shared ──────────────────────────────────────────────────────────────────
export {
  createLiquidityQualityScorer,
  createTimePressureScorer,
} from './shared/index.js';

// ── Register All ────────────────────────────────────────────────────────────

import { registerCryptoScorers } from './crypto/index.js';
import { registerPoliticsScorers } from './politics/index.js';
import { registerSportsScorers } from './sports/index.js';
import { registerEventsScorers } from './events/index.js';

/**
 * Register all scorers across all categories into the scorer registry.
 * Call once at engine startup.
 */
export function registerAllScorers(): void {
  registerCryptoScorers();
  registerPoliticsScorers();
  registerSportsScorers();
  registerEventsScorers();
}
