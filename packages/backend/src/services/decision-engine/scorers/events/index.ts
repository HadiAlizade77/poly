import { registerScorer } from '../../scorer-registry.js';
import type { ContextScorer } from '../../scorer.interface.js';
import { eventsLiquidityScorer, eventsTimeScorer } from '../shared/index.js';

export { baseRateScorer } from './base-rate.scorer.js';
export { scheduleSignalScorer } from './schedule-signal.scorer.js';
export { newsImpactScorer } from './news-impact.scorer.js';
export { crowdConfidenceScorer } from './crowd-confidence.scorer.js';

import { baseRateScorer } from './base-rate.scorer.js';
import { scheduleSignalScorer } from './schedule-signal.scorer.js';
import { newsImpactScorer } from './news-impact.scorer.js';
import { crowdConfidenceScorer } from './crowd-confidence.scorer.js';

export const eventsScorers: ContextScorer[] = [
  baseRateScorer,
  scheduleSignalScorer,
  newsImpactScorer,
  crowdConfidenceScorer,
  eventsLiquidityScorer,
  eventsTimeScorer,
];

export function registerEventsScorers(): void {
  for (const scorer of eventsScorers) {
    registerScorer(scorer);
  }
}
