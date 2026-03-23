/**
 * Decision Engine — per-category market evaluation loop.
 *
 * Each cycle:
 *   1. Get active tradeable markets for this category
 *   2. For each market: gather snapshots + external data
 *   3. Run all enabled scorers → collect ScorerDimension results
 *   4. Store scores in context_scores table
 *   5. Build plain-text dashboard (→ dashboard_text on context_scores)
 *   6. AI decision call (Claude via makeDecision; deterministic fallback if unavailable)
 *   7. Risk governor check (10+ checks; records RiskEvent on veto)
 *   8. Execute if approved   [PLACEHOLDER — skipped until order executor is wired]
 *
 * One engine instance per category; the PM2 process starts all four.
 */
import type { Market, MarketSnapshot, ExternalDataPoint, TradeFeedback, Prisma } from '@prisma/client';
import logger from '../../config/logger.js';
import * as marketService from '../market.service.js';
import * as marketSnapshotService from '../market-snapshot.service.js';
import * as contextScoreService from '../context-score.service.js';
import * as bankrollService from '../bankroll.service.js';
import * as positionService from '../position.service.js';
import * as tradeFeedbackService from '../trade-feedback.service.js';
import * as aiDecisionService from '../ai-decision.service.js';
import * as systemConfigService from '../system-config.service.js';
import { scorerRegistry } from './scorer-registry.js';
import { buildDashboard } from './dashboard-builder/builder.js';
import type { ScorerInput, ScoredDimensions } from './scorer.interface.js';
import { makeDecision, screenMarkets, type ScreeningMarket } from '../ai/decision-maker.js';
import { buildSessionFeedback } from './feedback/builder.js';
import { PROMPT_VERSION } from '../ai/prompt-manager.js';
import { riskGovernor, recordMarketTrade } from '../risk/governor.js';
import { executionEngine } from '../execution/engine.js';
import { getState as getTradingState } from '../trading-state.service.js';
import prisma from '../../config/database.js';

// ─── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_INTERVAL_MS    = 300_000; // 5 minutes
const SNAPSHOT_LOOKBACK      = 20;      // snapshots per market
const EXTERNAL_DATA_LOOKBACK = 50;      // external data points per market
const MAX_MARKETS_PER_CYCLE  = 20;      // limit AI calls per cycle to control costs
// MIN_LIQUIDITY and MIN_VOLUME_24H are now computed per-cycle based on risk appetite
const BASE_MIN_LIQUIDITY     = 5_000;   // base value at appetite=5
const BASE_MIN_VOLUME_24H    = 100;     // base value at appetite=5
const CATEGORIES = ['crypto', 'politics', 'sports', 'events', 'entertainment'] as const;
export type EngineCategory = typeof CATEGORIES[number];

// ─── Engine ───────────────────────────────────────────────────────────────────

export class DecisionEngine {
  private readonly category: EngineCategory;
  private intervalMs: number;
  private intervalId: NodeJS.Timeout | null = null;
  private running = false;

  constructor(category: EngineCategory, intervalMs = DEFAULT_INTERVAL_MS) {
    this.category   = category;
    this.intervalMs = intervalMs;
  }

  // ─── Lifecycle ──────────────────────────────────────────────────────────────

  start(): void {
    if (this.running) return;
    void this.startAsync();
  }

  private async startAsync(): Promise<void> {
    if (this.running) return;
    this.running = true;

    // Read per-category interval from system_config
    try {
      const key      = `DECISION_ENGINE_INTERVAL_MS_${this.category.toUpperCase()}`;
      const fallback = 'DECISION_ENGINE_INTERVAL_MS';
      const specific = await systemConfigService.getValue<number>(key);
      const global   = await systemConfigService.getValue<number>(fallback);
      const resolved = specific ?? global;
      if (resolved && resolved > 0) this.intervalMs = resolved;
    } catch {
      // DB unavailable at startup — use default
    }

    logger.info('DecisionEngine: starting', {
      category:   this.category,
      intervalMs: this.intervalMs,
    });

    void this.runCycle();
    this.intervalId = setInterval(() => void this.runCycle(), this.intervalMs);
    this.intervalId.unref();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;
    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    logger.info('DecisionEngine: stopped', { category: this.category });
  }

  // ─── Main cycle ─────────────────────────────────────────────────────────────

  private async runCycle(): Promise<void> {
    // ── 0. Check trading state ─────────────────────────────────────────────
    const tradingState = await getTradingState();
    if (tradingState === 'stopped' || tradingState === 'paused_all') {
      logger.debug('DecisionEngine: skipping cycle — trading state is ' + tradingState, {
        category: this.category,
      });
      return;
    }

    const startMs = Date.now();
    logger.info('DecisionEngine: cycle started', { category: this.category });

    // ── 1. Load risk appetite and compute quality thresholds ──────────────
    const riskAppetite = (await systemConfigService.getValue<number>('RISK_APPETITE')) ?? 5;
    const appetiteScale = riskAppetite / 5; // 1.0 at default, 2.0 at max, 0.2 at min
    const minLiquidity = Math.max(1_000, BASE_MIN_LIQUIDITY / appetiteScale);
    const minVolume24h = Math.max(10, BASE_MIN_VOLUME_24H / appetiteScale);

    // ── 2. Fetch active tradeable markets (pre-filtered for quality) ───────
    const allMarkets = await marketService.findTradeable(
      this.category as Market['category'],
    );

    // Filter out illiquid/dead markets to avoid wasting AI tokens
    const markets = allMarkets
      .filter((m) => {
        const liq = Number(m.liquidity ?? 0);
        const vol = Number(m.volume_24h ?? 0);
        return liq >= minLiquidity && vol >= minVolume24h;
      })
      .slice(0, MAX_MARKETS_PER_CYCLE);

    if (markets.length === 0) {
      logger.info('DecisionEngine: no tradeable markets above quality threshold', {
        category: this.category,
        totalActive: allMarkets.length,
      });
      return;
    }

    // ── 3. Load shared account state once per cycle ──────────────────────────
    const [bankroll, allPositions, feedbackPage] = await Promise.all([
      bankrollService.get(),
      positionService.findAll(),
      tradeFeedbackService.findByCategory(this.category, { page: 1, pageSize: 5 }),
    ]);
    const recentFeedback = feedbackPage.items;

    // ── 4. Get enabled scorers ────────────────────────────────────────────────
    const scorers = await scorerRegistry.getEnabledScorers(this.category);

    logger.info('DecisionEngine: processing markets', {
      category: this.category,
      markets:  markets.length,
      scorers:  scorers.length,
    });

    // ── 5. Stage 1 — AI screening (one cheap call for all markets) ──────────
    const screeningInput: ScreeningMarket[] = markets.map((m, i) => {
      const prices = (m.current_prices ?? {}) as Record<string, number>;
      const priceValues = Object.values(prices);
      const yesPrice = priceValues[0] ?? 0.5;
      const noPrice  = priceValues[1] ?? (1 - yesPrice);
      return {
        row:       i + 1,
        title:     m.title,
        yesPrice,
        noPrice,
        spread:    Math.abs(1 - yesPrice - noPrice),
        liquidity: Number(m.liquidity ?? 0),
        volume24h: Number(m.volume_24h ?? 0),
        expiry:    m.end_date ? new Date(m.end_date).toISOString().slice(0, 10) : null,
      };
    });

    const selectedRows = await screenMarkets(
      this.category,
      screeningInput,
      riskAppetite,
    );

    const selectedMarkets = selectedRows
      .map((row) => markets[row - 1])
      .filter(Boolean);

    logger.info('DecisionEngine: screening result', {
      category:   this.category,
      screened:   markets.length,
      selected:   selectedMarkets.length,
      rows:       selectedRows,
    });

    // ── 6. Stage 2 — deep analysis only on selected markets ────────────────
    for (const market of selectedMarkets) {
      try {
        await this.processMarket(market, scorers, bankroll, allPositions, recentFeedback, riskAppetite);
      } catch (err) {
        logger.error('DecisionEngine: market processing failed', {
          category: this.category,
          marketId: market.id,
          error:    (err as Error).message,
        });
      }
    }

    logger.info('DecisionEngine: cycle complete', {
      category:   this.category,
      markets:    markets.length,
      durationMs: Date.now() - startMs,
    });
  }

  // ─── Per-market processing ─────────────────────────────────────────────────

  private async processMarket(
    market: Market,
    scorers: Awaited<ReturnType<typeof scorerRegistry.getEnabledScorers>>,
    bankroll: Awaited<ReturnType<typeof bankrollService.get>>,
    allPositions: Awaited<ReturnType<typeof positionService.findAll>>,
    recentFeedback: TradeFeedback[],
    riskAppetite: number,
  ): Promise<void> {
    // ── Gather data ──────────────────────────────────────────────────────────
    const [snapshotPage, externalDataRaw] = await Promise.all([
      marketSnapshotService.findByMarket(
        { marketId: market.id },
        { page: 1, pageSize: SNAPSHOT_LOOKBACK },
      ),
      fetchExternalData(scorers.flatMap((s) => s.getRequiredData()), EXTERNAL_DATA_LOOKBACK),
    ]);

    const snapshots: MarketSnapshot[] = snapshotPage.items as MarketSnapshot[];
    const positions = allPositions.filter(
      (p) => (p as { market_id: string }).market_id === market.id,
    );

    // ── Run scorers ──────────────────────────────────────────────────────────
    const scores: ScoredDimensions = {};
    const rawIndicators: Record<string, unknown> = {};

    for (const scorer of scorers) {
      try {
        const config = await scorerRegistry.getScorerConfig(this.category, scorer.name);
        const input: ScorerInput = {
          market,
          snapshots,
          externalData: externalDataRaw,
          config,
        };
        const dim = scorer.score(input);
        scores[scorer.name] = dim;
        if (dim.metadata) rawIndicators[scorer.name] = dim.metadata;
      } catch (err) {
        logger.warn('DecisionEngine: scorer failed', {
          scorer:   scorer.name,
          marketId: market.id,
          error:    (err as Error).message,
        });
      }
    }

    // ── Build dashboard text ─────────────────────────────────────────────────
    const sessionFeedback = await buildSessionFeedback(this.category).then((fb) => fb.summaryText).catch(() => undefined);
    const dashboardText = buildDashboard({
      market,
      scores,
      snapshots,
      bankroll,
      positions,
      recentFeedback,
      sessionFeedback,
    });

    // ── Store context_scores ─────────────────────────────────────────────────
    await contextScoreService.create({
      market_id:      market.id,
      category:       this.category,
      scores:         scores as unknown as Prisma.InputJsonValue,
      raw_indicators: rawIndicators as Prisma.InputJsonValue,
      dashboard_text: dashboardText,
    });

    // ── AI decision ──────────────────────────────────────────────────────────
    const accountState = {
      balance:   bankroll ? Number((bankroll as { total_balance: unknown }).total_balance) : 0,
      positions: allPositions.length,
    };

    const decision = await makeDecision({
      dashboardText,
      category: this.category,
      scores,
      riskAppetite,
    });

    // Persist AI decision record
    const aiRecord = await aiDecisionService.create({
      market_id:         market.id,
      category:          this.category,
      action:            decision.action,
      direction:         decision.direction ?? null,
      outcome_token:     decision.outcome_token ?? null,
      confidence:        String(decision.confidence.toFixed(4)),
      size_hint:         decision.size_hint != null ? String(decision.size_hint.toFixed(4)) : null,
      fair_value:        decision.fair_value != null ? String(decision.fair_value.toFixed(4)) : null,
      estimated_edge:    decision.estimated_edge != null ? String(decision.estimated_edge.toFixed(6)) : null,
      reasoning:         decision.reasoning,
      regime_assessment: decision.regime_assessment ?? null,
      model_used:        decision.model,
      latency_ms:        decision.latencyMs,
      tokens_used:       decision.tokensUsed,
      prompt_version:    decision.promptVersion ?? PROMPT_VERSION,
      dashboard_text:    dashboardText,
      account_state:     accountState as Prisma.InputJsonValue,
    } as Parameters<typeof aiDecisionService.create>[0]);

    // ── Skip execution if AI says hold ───────────────────────────────────────
    if (decision.action === 'hold') {
      logger.debug('DecisionEngine: AI decision=hold', { marketId: market.id });
      return;
    }

    // ── Risk governor ────────────────────────────────────────────────────────
    const riskResult = await riskGovernor.check({
      market,
      decision,
      scores,
      bankroll,
      positions,
      snapshots,
    });

    if (!riskResult.approved) {
      logger.info('DecisionEngine: trade vetoed by risk governor', {
        marketId:    market.id,
        vetoReason:  riskResult.vetoReason,
      });

      // Mark decision as vetoed
      await aiDecisionService.markVetoed(aiRecord.id, riskResult.vetoReason ?? 'risk governor');
      return;
    }

    if (riskResult.warnings.length > 0) {
      logger.warn('DecisionEngine: risk warnings (trade approved with caveats)', {
        marketId: market.id,
        warnings: riskResult.warnings,
      });
    }

    // ── Execute trade via execution engine ─────────────────────────────────
    try {
      const execResult = await executionEngine.execute({
        market,
        decision,
        decisionId: aiRecord.id,
        bankroll: bankroll!,
        positions,
      });

      if (execResult.executed) {
        logger.info('DecisionEngine: trade executed', {
          marketId:   market.id,
          orderId:    execResult.orderId,
          positionId: execResult.positionId,
          sizeUsd:    execResult.sizing?.sizeUsd,
          reason:     execResult.reason,
        });
        // Record trade for cooldown + rate tracking
        recordMarketTrade(market.id, this.category);
      } else {
        logger.info('DecisionEngine: execution skipped', {
          marketId: market.id,
          reason:   execResult.reason,
        });
      }
    } catch (execErr) {
      logger.error('DecisionEngine: execution failed', {
        marketId: market.id,
        error:    (execErr as Error).message,
      });
    }
  }
}

// ─── External data fetch ───────────────────────────────────────────────────────

async function fetchExternalData(
  requiredTypes: string[],
  limit: number,
): Promise<ExternalDataPoint[]> {
  if (requiredTypes.length === 0) return [];
  const unique = [...new Set(requiredTypes)];
  return prisma.externalDataPoint.findMany({
    where: { data_type: { in: unique } },
    orderBy: { timestamp: 'desc' },
    take: limit,
  }) as Promise<ExternalDataPoint[]>;
}
