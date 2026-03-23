// Re-export the canonical interface from the decision-engine root.
// Scorers should import from here or from '../scorer.interface.js'.
export type {
  ContextScorer,
  ScorerInput,
  ScorerDimension,
  ScoredDimensions,
} from '../scorer.interface.js';
