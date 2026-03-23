/**
 * Scorer registry — singleton map of registered ContextScorer implementations.
 *
 * Scorers self-register on module import. The engine queries the registry
 * + the DB scorer_configs table to get the enabled set for each category.
 */
import type { ContextScorer } from './scorer.interface.js';
import * as scorerConfigService from '../scorer-config.service.js';
import logger from '../../config/logger.js';

class ScorerRegistry {
  /** category → scorer name → scorer implementation */
  private readonly scorers = new Map<string, Map<string, ContextScorer>>();

  /**
   * Register a scorer. Idempotent — re-registering the same name+category
   * overwrites the previous entry.
   */
  register(scorer: ContextScorer): void {
    if (!this.scorers.has(scorer.category)) {
      this.scorers.set(scorer.category, new Map());
    }
    this.scorers.get(scorer.category)!.set(scorer.name, scorer);
    logger.debug('ScorerRegistry: registered scorer', {
      name:     scorer.name,
      category: scorer.category,
    });
  }

  /**
   * Return all registered scorers for a category (regardless of enabled state).
   */
  getScorersForCategory(category: string): ContextScorer[] {
    return [...(this.scorers.get(category)?.values() ?? [])];
  }

  /**
   * Return only the scorers that are marked is_enabled = true in scorer_configs.
   * Scorers that have no DB config row are included by default (opt-out model).
   */
  async getEnabledScorers(category: string): Promise<ContextScorer[]> {
    const all = this.getScorersForCategory(category);
    if (all.length === 0) return [];

    // Fetch DB config rows for this category
    const dbConfigs = await scorerConfigService.findByCategory(category);
    const disabledNames = new Set(
      dbConfigs
        .filter((cfg) => !(cfg as { is_enabled: boolean }).is_enabled)
        .map((cfg) => (cfg as { scorer_name: string }).scorer_name),
    );

    return all.filter((s) => !disabledNames.has(s.name));
  }

  /**
   * Retrieve the config parameters for a specific scorer from the DB.
   * Returns {} if no row exists.
   */
  async getScorerConfig(category: string, name: string): Promise<Record<string, unknown>> {
    const row = await scorerConfigService.findByCategoryAndName(category, name);
    if (!row) return {};
    return ((row as { parameters: unknown }).parameters ?? {}) as Record<string, unknown>;
  }

  /** List all registered categories. */
  getCategories(): string[] {
    return [...this.scorers.keys()];
  }

  /** Total count of registered scorers across all categories. */
  size(): number {
    let count = 0;
    for (const m of this.scorers.values()) count += m.size;
    return count;
  }
}

/** Module-level singleton — import and use directly. */
export const scorerRegistry = new ScorerRegistry();

/** Convenience re-export for scorer implementors. */
export function registerScorer(scorer: ContextScorer): void {
  scorerRegistry.register(scorer);
}
