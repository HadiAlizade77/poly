import { registerScorer } from '../../scorer-registry.js';
import type { ContextScorer } from '../../scorer.interface.js';

export { exchangeDivergenceScorer } from './exchange-divergence.scorer.js';
export { momentumScorer } from './momentum.scorer.js';
export { meanReversionScorer } from './mean-reversion.scorer.js';
export { volatilityScorer } from './volatility.scorer.js';
export { volumeScorer } from './volume.scorer.js';
export { exhaustionScorer } from './exhaustion.scorer.js';
export { liquidityQualityScorer } from './liquidity-quality.scorer.js';
export { timePressureScorer } from './time-pressure.scorer.js';

import { exchangeDivergenceScorer } from './exchange-divergence.scorer.js';
import { momentumScorer } from './momentum.scorer.js';
import { meanReversionScorer } from './mean-reversion.scorer.js';
import { volatilityScorer } from './volatility.scorer.js';
import { volumeScorer } from './volume.scorer.js';
import { exhaustionScorer } from './exhaustion.scorer.js';
import { liquidityQualityScorer } from './liquidity-quality.scorer.js';
import { timePressureScorer } from './time-pressure.scorer.js';

/** All crypto context scorers. */
export const cryptoScorers: ContextScorer[] = [
  exchangeDivergenceScorer,
  momentumScorer,
  meanReversionScorer,
  volatilityScorer,
  volumeScorer,
  exhaustionScorer,
  liquidityQualityScorer,
  timePressureScorer,
];

/** Self-register all crypto scorers into the scorer registry. */
export function registerCryptoScorers(): void {
  for (const scorer of cryptoScorers) {
    registerScorer(scorer);
  }
}
