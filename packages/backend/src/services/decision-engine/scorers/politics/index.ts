import { registerScorer } from '../../scorer-registry.js';
import type { ContextScorer } from '../../scorer.interface.js';
import { politicsLiquidityScorer, politicsTimeScorer } from '../shared/index.js';

export { pollDivergenceScorer } from './poll-divergence.scorer.js';
export { sentimentShiftScorer } from './sentiment-shift.scorer.js';
export { historicalBaseRateScorer } from './historical-base-rate.scorer.js';
export { resolutionRiskScorer } from './resolution-risk.scorer.js';
export { crowdBiasScorer } from './crowd-bias.scorer.js';
export { informationVelocityScorer } from './information-velocity.scorer.js';

import { pollDivergenceScorer } from './poll-divergence.scorer.js';
import { sentimentShiftScorer } from './sentiment-shift.scorer.js';
import { historicalBaseRateScorer } from './historical-base-rate.scorer.js';
import { resolutionRiskScorer } from './resolution-risk.scorer.js';
import { crowdBiasScorer } from './crowd-bias.scorer.js';
import { informationVelocityScorer } from './information-velocity.scorer.js';

export const politicsScorers: ContextScorer[] = [
  pollDivergenceScorer,
  sentimentShiftScorer,
  historicalBaseRateScorer,
  resolutionRiskScorer,
  crowdBiasScorer,
  informationVelocityScorer,
  politicsLiquidityScorer,
  politicsTimeScorer,
];

export function registerPoliticsScorers(): void {
  for (const scorer of politicsScorers) {
    registerScorer(scorer);
  }
}
