import { registerScorer } from '../../scorer-registry.js';
import type { ContextScorer } from '../../scorer.interface.js';
import { sportsLiquidityScorer, sportsTimeScorer } from '../shared/index.js';

export { oddsDivergenceScorer } from './odds-divergence.scorer.js';
export { lineMovementScorer } from './line-movement.scorer.js';
export { injuryImpactScorer } from './injury-impact.scorer.js';
export { publicBiasScorer } from './public-bias.scorer.js';
export { modelEdgeScorer } from './model-edge.scorer.js';

import { oddsDivergenceScorer } from './odds-divergence.scorer.js';
import { lineMovementScorer } from './line-movement.scorer.js';
import { injuryImpactScorer } from './injury-impact.scorer.js';
import { publicBiasScorer } from './public-bias.scorer.js';
import { modelEdgeScorer } from './model-edge.scorer.js';

export const sportsScorers: ContextScorer[] = [
  oddsDivergenceScorer,
  lineMovementScorer,
  injuryImpactScorer,
  publicBiasScorer,
  modelEdgeScorer,
  sportsLiquidityScorer,
  sportsTimeScorer,
];

export function registerSportsScorers(): void {
  for (const scorer of sportsScorers) {
    registerScorer(scorer);
  }
}
