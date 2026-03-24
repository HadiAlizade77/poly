/**
 * BTC 5-Min Scalper Bot — Momentum Scalp with Take-Profit Tiers
 *
 * Strategy: Enter early on momentum, take profit aggressively, cut losses
 * quickly, never force-close at bad prices.
 *
 * State machine per cycle:
 *   FLAT      -> signal UP   -> BUY YES  -> LONG_YES
 *   FLAT      -> signal DOWN -> BUY NO   -> LONG_NO
 *   LONG_YES  -> take-profit hit   -> CLOSE YES -> FLAT
 *   LONG_YES  -> stop-loss hit     -> CLOSE YES -> FLAT
 *   LONG_YES  -> signal weakened   -> CLOSE YES -> FLAT
 *   LONG_NO   -> take-profit hit   -> CLOSE NO  -> FLAT
 *   LONG_NO   -> stop-loss hit     -> CLOSE NO  -> FLAT
 *   LONG_NO   -> signal weakened   -> CLOSE NO  -> FLAT
 *
 * No flips — close to FLAT and re-evaluate on next cycle.
 *
 * One AI call per window (at window start). Intra-window trades are
 * deterministic based on signal thresholds + price-based TP/SL.
 *
 * Respects:
 *   - RISK_APPETITE from system_config
 *   - Sandbox/mock execution mode (via orderManager + positionManager)
 *   - Start/stop via system_config BTC_5MIN_BOT_ACTIVE
 *   - maxTradesPerWindow limit to prevent excessive trading
 *   - Lowered thresholds in sandbox mode for more active trading
 */
import type { Prisma } from '@prisma/client';
import logger from '../../config/logger.js';
import { redis } from '../../config/redis.js';
import prisma from '../../config/database.js';
import { emitBtcBotStatus, emitBtcBotTrade } from '../../websocket/emit.js';
import { aiClient } from '../ai/client.js';
import { computeSignals, type BtcSignals } from './signals.js';
import { findActiveBtcMarket, refreshPrices, type ActiveBtcMarket } from './market-finder.js';
import * as systemConfigService from '../system-config.service.js';
import * as bankrollService from '../bankroll.service.js';
import * as positionService from '../position.service.js';
import * as aiDecisionService from '../ai-decision.service.js';
import { orderManager } from '../execution/order-manager.js';
import { positionManager } from '../execution/position-manager.js';
import { PROMPT_VERSION } from '../ai/prompt-manager.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SIGNALS_REDIS_KEY  = 'btc-5min:latest-signals';
const SIGNALS_TTL_SEC    = 60;
const STATUS_REDIS_KEY   = 'btc-5min:status';
const STATUS_TTL_SEC     = 30;
const BOT_ACTIVE_KEY     = 'BTC_5MIN_BOT_ACTIVE';
const ACTIVITY_LOG_KEY   = 'btc-5min:activity-log';
const ACTIVITY_LOG_MAX   = 200;

/** Default max trades per 5-min window (prevents runaway trading). */
const DEFAULT_MAX_TRADES_PER_WINDOW = 5;

/** Don't enter positions in the last N ms of a window. */
const WINDOW_NO_ENTRY_MS = 20_000; // Don't open new positions in last 20s of window

/** Safety-close losing positions when window has less than this many ms remaining. */
const WINDOW_SAFETY_CLOSE_MS = 30_000;

/** Direction score threshold for sandbox mode (lower = more trades). */
const SANDBOX_DIRECTION_THRESHOLD = 12;
/** Direction score threshold for live mode. */
const LIVE_DIRECTION_THRESHOLD    = 20;

/** Default minimum hold time in ms before the bot can exit a position. */
const DEFAULT_MIN_HOLD_TIME_MS = 30_000;

/** Max price to buy a side — avoid entering when no edge. */
const MAX_ENTRY_PRICE = 0.65; // Don't buy a side priced above 65¢ (need 35%+ upside)

/** Mid-range avoidance: don't enter when both sides are in this band. */
const MID_RANGE_LOW  = 0.40;
const MID_RANGE_HIGH = 0.60;

// ─── Risk config types ───────────────────────────────────────────────────────

interface RiskLimits {
  maxSingleTrade: number;
  maxPositionSize: number;
  maxDailyLoss: number;
  maxConsecutiveLosses: number;
  minHoldTimeMs: number;
}

// ─── Take-profit / stop-loss tiers ──────────────────────────────────────────

/**
 * Returns take-profit and stop-loss percentage thresholds based on risk appetite.
 *
 * Lower risk = take profit sooner + tighter stop.
 * Higher risk = let it run + wider stop.
 */
function getTakeProfitAndStopLoss(riskAppetite: number): { takeProfitPct: number; stopLossPct: number } {
  if (riskAppetite <= 3) return { takeProfitPct: 0.10, stopLossPct: 0.05 };
  if (riskAppetite <= 6) return { takeProfitPct: 0.20, stopLossPct: 0.10 };
  if (riskAppetite <= 9) return { takeProfitPct: 0.35, stopLossPct: 0.15 };
  return { takeProfitPct: 0.50, stopLossPct: 0.20 };
}

// ─── Scalper state ───────────────────────────────────────────────────────────

type ScalperState = 'flat' | 'long_yes' | 'long_no';

// ─── AI response shape ───────────────────────────────────────────────────────

interface WindowAiResponse {
  bias:       'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning:  string;
}

// ─── Threshold helpers ───────────────────────────────────────────────────────

function computeThresholds(riskAppetite: number, isSandbox: boolean) {
  const appetiteScale = riskAppetite / 5; // 0.2 to 2.0

  // In sandbox mode, use much lower thresholds so the bot trades actively
  const baseEntry = isSandbox ? SANDBOX_DIRECTION_THRESHOLD : LIVE_DIRECTION_THRESHOLD;

  // Entry threshold: direction score must exceed +/-ENTRY to open a position
  const ENTRY_THRESHOLD = Math.max(5, baseEntry / appetiteScale);
  // Exit threshold (hysteresis): score must cross back past +/-3 to exit
  const EXIT_THRESHOLD = Math.max(2, 3 / appetiteScale);

  // Minimum hold time scales inversely with appetite
  const minHoldTimeMs = Math.round(DEFAULT_MIN_HOLD_TIME_MS / appetiteScale);

  return { ENTRY_THRESHOLD, EXIT_THRESHOLD, appetiteScale, minHoldTimeMs };
}

/**
 * Risk tier configuration for trade sizing.
 *
 * Each tier defines the min/base/max trade for a range of risk appetite levels.
 * maxBalancePct caps the trade at a percentage of the available balance.
 */
interface RiskTier {
  minTrade: number;
  baseTrade: number;
  maxBalancePct: number;
}

function getRiskTier(riskAppetite: number): RiskTier {
  if (riskAppetite >= 10) return { minTrade: 8, baseTrade: 15, maxBalancePct: 0.05 };
  if (riskAppetite >= 7)  return { minTrade: 5, baseTrade: 12, maxBalancePct: 0.03 };
  if (riskAppetite >= 4)  return { minTrade: 5, baseTrade: 8,  maxBalancePct: 0.02 };
  return                          { minTrade: 5, baseTrade: 5,  maxBalancePct: 0.01 };
}

function computeTradeSize(
  balance: number,
  directionScore: number,
  entryPrice: number,
  riskAppetite: number,
  maxSingleTrade: number,
): number {
  const tier = getRiskTier(riskAppetite);

  // Score multiplier: how strong is the directional signal?
  // score 0-14 = 1.0x, score 15-24 = 1.0x, score 25-34 = 1.25x, score 35+ = 1.5x
  const scoreAbs = Math.abs(directionScore);
  const scoreMultiplier = scoreAbs >= 35 ? 1.5
    : scoreAbs >= 25 ? 1.25
    : 1.0;

  // Price edge multiplier: cheaper entry = more upside = bigger trade
  // < 0.25 = 1.75x, < 0.35 = 1.5x, < 0.45 = 1.2x, else 1.0x
  const priceEdgeMultiplier = entryPrice < 0.25 ? 1.75
    : entryPrice < 0.35 ? 1.5
    : entryPrice < 0.45 ? 1.2
    : 1.0;

  const rawSize = tier.baseTrade * scoreMultiplier * priceEdgeMultiplier;

  // Cap at balance percentage and maxSingleTrade from risk config
  const maxFromBalance = balance * tier.maxBalancePct;
  const finalSize = Math.max(tier.minTrade, Math.min(rawSize, maxFromBalance, maxSingleTrade));

  logger.info('Btc5MinBot: trade size calculation', {
    riskAppetite,
    tier: riskAppetite >= 10 ? 'maximum' : riskAppetite >= 7 ? 'aggressive' : riskAppetite >= 4 ? 'balanced' : 'conservative',
    baseTrade: tier.baseTrade,
    scoreAbs: scoreAbs.toFixed(1),
    scoreMultiplier,
    entryPrice: entryPrice.toFixed(3),
    priceEdgeMultiplier,
    rawSize: rawSize.toFixed(2),
    maxFromBalance: maxFromBalance.toFixed(2),
    maxSingleTrade,
    minTrade: tier.minTrade,
    finalSize: finalSize.toFixed(2),
  });

  return finalSize;
}

// ─── Bot ─────────────────────────────────────────────────────────────────────

export class Btc5MinBot {
  private running    = false;
  private intervalId: NodeJS.Timeout | null = null;
  private priceRefreshId: NodeJS.Timeout | null = null;
  private readonly cycleMs: number;
  /** Current market reference for fast price refresh */
  private currentMarket: ActiveBtcMarket | null = null;

  // Window tracking
  private currentWindowMarketId: string | null = null;
  private currentWindowEndTs: number | null = null;
  private currentPriceToBeat: number | null = null;
  private currentPositionId: string | null = null;
  private currentSide: 'YES' | 'NO' | null = null;
  private windowTradeCount  = 0;
  private maxTradesPerWindow = DEFAULT_MAX_TRADES_PER_WINDOW;
  private windowAiDecisionId: bigint | null = null;
  private lastKnownYesPrice = 0.5;
  private lastKnownNoPrice  = 0.5;

  // Position tracking for TP/SL
  private positionEnteredAt: number | null = null;
  private lastEntryPrice = 0;

  // Stats for current session
  private sessionTrades = 0;
  private sessionPnl    = 0;

  // Risk tracking
  private consecutiveLosses   = 0;
  private dailyPnl            = 0;
  private dailyPnlResetDate   = new Date().toDateString();
  private totalDeployed        = 0;  // sum of open position sizes

  // Last action description (for status cache)
  private lastAction     = 'INIT';
  private lastActionTime = new Date().toISOString();

  constructor(cycleMs = 10_000) {
    this.cycleMs = cycleMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    logger.info('Btc5MinBot: starting scalper', { cycleMs: this.cycleMs });
    void this.appendLog('info', 'Bot started');

    // Run first cycle immediately, then on interval
    void this.runCycle();
    this.intervalId = setInterval(() => void this.runCycle(), this.cycleMs);
    this.intervalId.unref();

    // Fast price refresh loop: fetch CLOB midpoints every 5s and emit to WebSocket
    this.priceRefreshId = setInterval(() => void this.refreshAndEmitPrices(), 5_000);
    this.priceRefreshId.unref();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }
    if (this.priceRefreshId) {
      clearInterval(this.priceRefreshId);
      this.priceRefreshId = null;
    }

    void this.appendLog('info', 'Bot stopped');
    logger.info('Btc5MinBot: stopped');
  }

  isRunning(): boolean {
    return this.running;
  }

  // ─── Main cycle ─────────────────────────────────────────────────────────────

  private async runCycle(): Promise<void> {
    try {
      // 1. Check if bot is enabled
      const active = await systemConfigService.getValue<boolean>(BOT_ACTIVE_KEY);
      if (!active) {
        logger.debug('Btc5MinBot: bot inactive (BTC_5MIN_BOT_ACTIVE=false), skipping cycle');
        return;
      }

      // 2. Compute signals — always cache them for frontend
      const signals = await computeSignals();

      if (signals) {
        logger.info('Btc5MinBot: signal computed', {
          directionScore: signals.direction_score.toFixed(1),
          suggestedSide:  signals.suggested_side ?? 'skip',
          trend:          signals.trend,
          confidence:     signals.confidence.toFixed(3),
          rsi:            signals.rsi.toFixed(1),
          momentum3m:     signals.momentum_3m.toFixed(3) + '%',
          currentPrice:   signals.current_price,
        });

        await redis.setex(
          SIGNALS_REDIS_KEY,
          SIGNALS_TTL_SEC,
          JSON.stringify(signals),
        );
      }

      // 3. Find active BTC 5-min market (real or synthetic in sandbox)
      const market = await findActiveBtcMarket();
      this.currentMarket = market; // store for fast price refresh loop

      if (!market) {
        // No market — close any leftover position from a vanished window
        if (this.currentPositionId) {
          logger.info('Btc5MinBot: market disappeared, closing leftover position');
          await this.closeCurrentPosition('window-expired-no-market');
        }
        this.resetWindowState();
        await this.cacheStatus(signals, null);
        logger.info('Btc5MinBot: no active BTC 5-min market found (real or synthetic)');
        return;
      }

      // Compute the window end timestamp for comparison
      const marketWindowEndTs = market.endDate
        ? Math.floor(market.endDate.getTime() / 1000)
        : null;

      logger.info('Btc5MinBot: market active', {
        id:          market.id,
        title:       market.title,
        isSynthetic: market.is_synthetic,
        upPrice:     market.yesPrice.toFixed(4),
        downPrice:   market.noPrice.toFixed(4),
        priceToBeat: market.priceToBeat ?? 'N/A',
        conditionId: market.conditionId ?? 'N/A',
        windowEnd:   market.endDate?.toISOString() ?? 'none',
      });

      // 4. Check sandbox mode for threshold adjustments
      const isSandbox = await systemConfigService.getValue<boolean>('SANDBOX_ACTIVE');

      // 5. If new window (different market ID or different window end time) OR synthetic refresh
      const isNewWindow =
        market.id !== this.currentWindowMarketId
        || (marketWindowEndTs !== null && marketWindowEndTs !== this.currentWindowEndTs)
        || (market.is_synthetic && this.shouldRefreshSyntheticWindow());

      if (isNewWindow) {
        await this.onNewWindow(market, signals);
      }

      // 6. Update market prices
      this.lastKnownYesPrice = market.yesPrice;
      this.lastKnownNoPrice  = market.noPrice;

      // 7. Window expiry management — price-aware safety close
      if (market.endDate && this.currentPositionId) {
        const msRemaining = market.endDate.getTime() - Date.now();
        if (msRemaining < WINDOW_SAFETY_CLOSE_MS) {
          // Check if position is profitable or losing
          const currentPrice = this.currentSide === 'YES'
            ? this.lastKnownYesPrice
            : this.lastKnownNoPrice;
          const pnlPct = this.lastEntryPrice > 0
            ? (currentPrice - this.lastEntryPrice) / this.lastEntryPrice
            : 0;

          if (pnlPct < 0) {
            // LOSING — cut before resolution makes it worse
            const sideLabel = this.currentSide === 'YES' ? 'Up' : 'Down';
            logger.info('Btc5MinBot: window expiring, closing LOSING position', {
              msRemaining,
              positionId: this.currentPositionId,
              side: `${sideLabel} (${this.currentSide})`,
              entryPrice: this.lastEntryPrice,
              currentPrice,
              pnlPct: (pnlPct * 100).toFixed(1) + '%',
            });
            await this.closeCurrentPosition('window-expiry-loss-cut');
            this.lastAction     = `SAFETY CLOSE ${sideLabel} (losing ${(pnlPct * 100).toFixed(1)}%, window expiring)`;
            this.lastActionTime = new Date().toISOString();
            void this.appendLog('close', `Safety close ${sideLabel} — losing ${(pnlPct * 100).toFixed(1)}%, window expiring`, {
              side: this.currentSide, sideLabel, msRemaining, pnlPct,
            });
            await this.cacheStatus(signals, market);
            return;
          } else {
            // PROFITABLE — let it ride to resolution
            const sideLabel = this.currentSide === 'YES' ? 'Up' : 'Down';
            logger.info('Btc5MinBot: window expiring but position profitable, letting it ride', {
              msRemaining,
              side: `${sideLabel} (${this.currentSide})`,
              entryPrice: this.lastEntryPrice,
              currentPrice,
              pnlPct: (pnlPct * 100).toFixed(1) + '%',
            });
            this.lastAction = `HOLD ${sideLabel} (winning +${(pnlPct * 100).toFixed(1)}%, riding to resolution)`;
          }
        }
      }

      // 8. Cannot trade without signals
      if (!signals) {
        logger.info('Btc5MinBot: no signals available, skipping trade logic');
        await this.cacheStatus(null, market);
        return;
      }

      // 9. Cannot trade without an AI decision for this window
      if (!this.windowAiDecisionId) {
        logger.info('Btc5MinBot: no AI decision for this window, skipping trade logic');
        await this.cacheStatus(signals, market);
        return;
      }

      // 10. Check max trades per window
      if (this.windowTradeCount >= this.maxTradesPerWindow) {
        logger.info('Btc5MinBot: max trades per window reached', {
          windowTradeCount: this.windowTradeCount,
          maxTradesPerWindow: this.maxTradesPerWindow,
        });
        this.lastAction = `MAX TRADES (${this.windowTradeCount}/${this.maxTradesPerWindow})`;
        await this.cacheStatus(signals, market);
        return;
      }

      // 11. Load risk appetite, bankroll, and risk_config limits
      const [riskAppetite, bankroll, cryptoRiskConfig, globalRiskConfig] = await Promise.all([
        systemConfigService.getValue<number>('RISK_APPETITE').then((v) => v ?? 5),
        bankrollService.get(),
        prisma.riskConfig.findFirst({
          where: { scope: 'category', scope_value: 'crypto' },
        }),
        prisma.riskConfig.findFirst({
          where: { scope: 'global' },
        }),
      ]);

      // Merge global + crypto-specific risk parameters (crypto overrides global)
      const riskParams: Record<string, number> = {
        ...(globalRiskConfig?.parameters as Record<string, number> ?? {}),
        ...(cryptoRiskConfig?.parameters as Record<string, number> ?? {}),
      };

      const riskLimits: RiskLimits = {
        maxSingleTrade:       riskParams.max_single_trade ?? 30,
        maxPositionSize:      riskParams.max_position_size ?? 50,
        maxDailyLoss:         riskParams.max_daily_loss ?? 100,
        maxConsecutiveLosses: riskParams.max_consecutive_losses ?? 5,
        minHoldTimeMs:        DEFAULT_MIN_HOLD_TIME_MS,
      };

      const availableBalance = bankroll ? Number(bankroll.active_balance) : 0;
      if (availableBalance <= 0) {
        logger.info('Btc5MinBot: no available balance, skipping');
        await this.cacheStatus(signals, market);
        return;
      }

      const { ENTRY_THRESHOLD, EXIT_THRESHOLD, appetiteScale, minHoldTimeMs } =
        computeThresholds(riskAppetite, !!isSandbox);

      // Override risk limits with appetite-scaled values
      riskLimits.minHoldTimeMs = minHoldTimeMs;

      // Get TP/SL thresholds based on risk appetite
      const { takeProfitPct, stopLossPct } = getTakeProfitAndStopLoss(riskAppetite);

      // Reset daily PnL tracking at the start of each new day
      const today = new Date().toDateString();
      if (this.dailyPnlResetDate !== today) {
        this.dailyPnl = 0;
        this.dailyPnlResetDate = today;
        this.consecutiveLosses = 0;
      }

      // Log risk config being used this cycle
      logger.info('Btc5MinBot: risk config', {
        riskAppetite,
        appetiteScale,
        maxSingleTrade: riskLimits.maxSingleTrade,
        maxPositionSize: riskLimits.maxPositionSize,
        maxDailyLoss: riskLimits.maxDailyLoss,
        maxConsecutiveLosses: riskLimits.maxConsecutiveLosses,
        minHoldTimeMs: riskLimits.minHoldTimeMs,
        takeProfitPct: (takeProfitPct * 100).toFixed(0) + '%',
        stopLossPct: (stopLossPct * 100).toFixed(0) + '%',
        entryThreshold: ENTRY_THRESHOLD,
        exitThreshold: EXIT_THRESHOLD,
        dailyPnl: this.dailyPnl,
        consecutiveLosses: this.consecutiveLosses,
      });

      // Check daily loss limit — skip trading if exceeded
      if (this.dailyPnl < 0 && Math.abs(this.dailyPnl) >= riskLimits.maxDailyLoss) {
        logger.info('Btc5MinBot: daily loss limit reached, skipping trades', {
          dailyPnl: this.dailyPnl,
          maxDailyLoss: riskLimits.maxDailyLoss,
        });
        this.lastAction = `DAILY LOSS LIMIT ($${Math.abs(this.dailyPnl).toFixed(2)} >= $${riskLimits.maxDailyLoss})`;
        await this.cacheStatus(signals, market);
        return;
      }

      // Check consecutive losses — skip trading if exceeded
      if (this.consecutiveLosses >= riskLimits.maxConsecutiveLosses) {
        logger.info('Btc5MinBot: consecutive loss limit reached, skipping trades', {
          consecutiveLosses: this.consecutiveLosses,
          maxConsecutiveLosses: riskLimits.maxConsecutiveLosses,
        });
        this.lastAction = `CONSECUTIVE LOSS LIMIT (${this.consecutiveLosses} >= ${riskLimits.maxConsecutiveLosses})`;
        await this.cacheStatus(signals, market);
        return;
      }

      const score = signals.direction_score;
      const state = this.getState();

      // Compute time remaining in window for entry filter
      const msRemaining = market.endDate
        ? market.endDate.getTime() - Date.now()
        : Infinity;

      logger.info('Btc5MinBot: evaluating state machine', {
        state,
        score:           score.toFixed(1),
        entryThreshold:  ENTRY_THRESHOLD.toFixed(1),
        exitThreshold:   EXIT_THRESHOLD.toFixed(1),
        isSandbox:       !!isSandbox,
        windowTrades:    `${this.windowTradeCount}/${this.maxTradesPerWindow}`,
        balance:         availableBalance.toFixed(2),
        msRemaining:     msRemaining === Infinity ? 'N/A' : msRemaining,
      });

      // 12. Check minimum hold time — don't exit within min hold time
      const holdTimeMs = this.positionEnteredAt
        ? Date.now() - this.positionEnteredAt
        : Infinity;
      const canExit = holdTimeMs >= riskLimits.minHoldTimeMs;

      // 13. Compute price-based PnL for TP/SL
      let pricePnlPct = 0;
      if (this.lastEntryPrice > 0 && this.currentPositionId) {
        const currentPrice = this.currentSide === 'YES'
          ? this.lastKnownYesPrice
          : this.lastKnownNoPrice;
        pricePnlPct = (currentPrice - this.lastEntryPrice) / this.lastEntryPrice;
      }

      logger.info('Btc5MinBot: position tracking', {
        holdTimeMs:     holdTimeMs === Infinity ? 'N/A' : holdTimeMs,
        canExit,
        entryPrice:     this.lastEntryPrice || 'N/A',
        pricePnlPct:    this.currentPositionId ? (pricePnlPct * 100).toFixed(1) + '%' : 'N/A',
        takeProfitAt:   this.currentPositionId ? '+' + (takeProfitPct * 100).toFixed(0) + '%' : 'N/A',
        stopLossAt:     this.currentPositionId ? '-' + (stopLossPct * 100).toFixed(0) + '%' : 'N/A',
      });

      // 13b. Log priceToBeat comparison each cycle so we know the reference price
      //      and whether BTC is currently above or below it.
      const ptb = this.currentPriceToBeat;
      const btcNow = signals.current_price;
      if (ptb != null) {
        const delta = btcNow - ptb;
        const deltaPct = (delta / ptb) * 100;
        const direction = delta >= 0 ? 'ABOVE (favors YES/Up)' : 'BELOW (favors NO/Down)';
        logger.info('Btc5MinBot: priceToBeat comparison', {
          priceToBeat:  `$${ptb.toFixed(2)}`,
          currentPrice: `$${btcNow.toFixed(2)}`,
          delta:        `${delta >= 0 ? '+' : ''}$${delta.toFixed(2)}`,
          deltaPct:     `${deltaPct >= 0 ? '+' : ''}${deltaPct.toFixed(3)}%`,
          direction,
        });
      } else {
        logger.debug('Btc5MinBot: priceToBeat not yet available for this window');
      }

      // 14. Check maxPositionSize — read deployed from bankroll DB (source of truth)
      const currentDeployed = bankroll ? Number(bankroll.deployed_balance) : 0;
      const canOpenNew = currentDeployed < riskLimits.maxPositionSize;

      // 15. State machine decision
      switch (state) {
        case 'flat': {
          // --- Entry filters ---
          // Time filter: don't enter in the last 60s of a window
          if (msRemaining < WINDOW_NO_ENTRY_MS) {
            this.lastAction = `FLAT (too late, ${Math.round(msRemaining / 1000)}s left)`;
            logger.info('Btc5MinBot: FLAT — too late to enter', { msRemaining });
            break;
          }

          // Position size limit
          if (!canOpenNew) {
            this.lastAction = `POSITION LIMIT ($${currentDeployed.toFixed(2)} >= $${riskLimits.maxPositionSize})`;
            logger.info('Btc5MinBot: FLAT — position size limit reached', {
              totalDeployed: currentDeployed,
              maxPositionSize: riskLimits.maxPositionSize,
            });
            break;
          }

          // (mid-range filter removed — the bot should trade early in the window
          // when prices are near 50/50 and the score gives a directional signal)

          // Compute priceToBeat-adjusted score.
          //
          // The Chainlink reference price tells us where BTC started this window.
          // If BTC is currently ABOVE priceToBeat the window is already trending Up,
          // which corroborates a bullish signal — add up to +5 points to the score.
          // If BTC is BELOW priceToBeat the window is trending Down, corroborating
          // a bearish signal — subtract up to 5 points (making bearish entries easier).
          // When priceToBeat is unavailable the score is unchanged.
          let adjustedScore = score;
          const ptbForEntry = this.currentPriceToBeat;
          if (ptbForEntry != null && btcNow > 0) {
            // deltaPct: +1 = 1% above reference, -1 = 1% below reference
            const ptbDeltaPct = ((btcNow - ptbForEntry) / ptbForEntry) * 100;
            // Scale: each 0.1% move adds ±1 point, capped at ±5
            const ptbBonus = Math.max(-5, Math.min(5, ptbDeltaPct * 10));
            adjustedScore = score + ptbBonus;
            logger.info('Btc5MinBot: priceToBeat score adjustment', {
              rawScore:      score.toFixed(1),
              ptbDeltaPct:   `${ptbDeltaPct >= 0 ? '+' : ''}${ptbDeltaPct.toFixed(3)}%`,
              ptbBonus:      `${ptbBonus >= 0 ? '+' : ''}${ptbBonus.toFixed(2)}`,
              adjustedScore: adjustedScore.toFixed(1),
            });
          }

          if (adjustedScore > ENTRY_THRESHOLD) {
            // --- Buy YES (bullish) ---
            // Price filter: only buy YES if yesPrice < 0.60
            if (market.yesPrice >= MAX_ENTRY_PRICE) {
              this.lastAction = `FLAT (YES too expensive: ${(market.yesPrice * 100).toFixed(0)}c)`;
              logger.info('Btc5MinBot: FLAT — YES price too high for entry', {
                yesPrice: market.yesPrice, maxEntry: MAX_ENTRY_PRICE,
              });
              break;
            }

            // Momentum logged but not required — direction score already incorporates it

            const size = computeTradeSize(availableBalance, score, market.yesPrice, riskAppetite, riskLimits.maxSingleTrade);
            const tpTarget = market.yesPrice * (1 + takeProfitPct);
            const slTarget = market.yesPrice * (1 - stopLossPct);
            logger.info('Btc5MinBot: FLAT -> BUY YES decision', {
              score, threshold: ENTRY_THRESHOLD, size: size.toFixed(2),
              entry: market.yesPrice, takeProfit: tpTarget.toFixed(3), stopLoss: slTarget.toFixed(3),
            });
            const posId = await this.executeTrade(market, 'YES', size, this.windowAiDecisionId!);
            if (posId) {
              this.currentPositionId = posId;
              this.currentSide       = 'YES';
              this.positionEnteredAt = Date.now();
              this.lastEntryPrice    = market.yesPrice;
              this.windowTradeCount++;
              this.sessionTrades++;
              this.totalDeployed    += size;
              this.lastAction     = `BUY YES ($${size.toFixed(2)}) TP@${(tpTarget * 100).toFixed(0)}c SL@${(slTarget * 100).toFixed(0)}c`;
              this.lastActionTime = new Date().toISOString();
              void this.appendLog('buy', `BUY YES — $${size.toFixed(2)} @ ${(market.yesPrice * 100).toFixed(1)}c | TP ${(tpTarget * 100).toFixed(0)}c SL ${(slTarget * 100).toFixed(0)}c`, {
                score: score.toFixed(0), size, price: market.yesPrice, takeProfit: tpTarget, stopLoss: slTarget,
              });
            }
          } else if (score < -ENTRY_THRESHOLD) {
            // --- Buy NO (bearish) ---
            // Price filter: only buy NO if noPrice < 0.60
            if (market.noPrice >= MAX_ENTRY_PRICE) {
              this.lastAction = `FLAT (NO too expensive: ${(market.noPrice * 100).toFixed(0)}c)`;
              logger.info('Btc5MinBot: FLAT — NO price too high for entry', {
                noPrice: market.noPrice, maxEntry: MAX_ENTRY_PRICE,
              });
              break;
            }

            // Momentum logged but not required — direction score already incorporates it

            const size = computeTradeSize(availableBalance, score, market.noPrice, riskAppetite, riskLimits.maxSingleTrade);
            const tpTarget = market.noPrice * (1 + takeProfitPct);
            const slTarget = market.noPrice * (1 - stopLossPct);
            logger.info('Btc5MinBot: FLAT -> BUY NO decision', {
              score, threshold: -ENTRY_THRESHOLD, size: size.toFixed(2),
              entry: market.noPrice, takeProfit: tpTarget.toFixed(3), stopLoss: slTarget.toFixed(3),
            });
            const posId = await this.executeTrade(market, 'NO', size, this.windowAiDecisionId!);
            if (posId) {
              this.currentPositionId = posId;
              this.currentSide       = 'NO';
              this.positionEnteredAt = Date.now();
              this.lastEntryPrice    = market.noPrice;
              this.windowTradeCount++;
              this.sessionTrades++;
              this.totalDeployed    += size;
              this.lastAction     = `BUY NO ($${size.toFixed(2)}) TP@${(tpTarget * 100).toFixed(0)}c SL@${(slTarget * 100).toFixed(0)}c`;
              this.lastActionTime = new Date().toISOString();
              void this.appendLog('buy', `BUY NO — $${size.toFixed(2)} @ ${(market.noPrice * 100).toFixed(1)}c | TP ${(tpTarget * 100).toFixed(0)}c SL ${(slTarget * 100).toFixed(0)}c`, {
                score: score.toFixed(0), size, price: market.noPrice, takeProfit: tpTarget, stopLoss: slTarget,
              });
            }
          } else {
            this.lastAction = `FLAT (score=${score.toFixed(0)}, need >${ENTRY_THRESHOLD.toFixed(0)})`;
            void this.appendLog('hold', `Holding FLAT — score ${score.toFixed(0)}, threshold +/-${ENTRY_THRESHOLD.toFixed(0)}`, { score: score.toFixed(0) });
            logger.info('Btc5MinBot: HOLD FLAT — score below threshold', {
              score: score.toFixed(1),
              threshold: ENTRY_THRESHOLD.toFixed(1),
            });
          }
          break;
        }

        case 'long_yes': {
          // Must enforce minimum hold time before any exit (unless stop-loss hit hard)
          if (!canExit && pricePnlPct > -stopLossPct) {
            this.lastAction = `HOLD YES (min hold ${Math.round(holdTimeMs / 1000)}s/${riskLimits.minHoldTimeMs / 1000}s)`;
            logger.info('Btc5MinBot: HOLD LONG_YES — minimum hold time', {
              score: score.toFixed(1), holdTimeMs, minHoldMs: riskLimits.minHoldTimeMs,
            });
          } else if (pricePnlPct >= takeProfitPct) {
            // TAKE PROFIT — price moved in our favor
            const currentPrice = this.lastKnownYesPrice;
            logger.info('Btc5MinBot: LONG_YES -> TAKE PROFIT', {
              entryPrice: this.lastEntryPrice,
              currentPrice,
              pnlPct: (pricePnlPct * 100).toFixed(1) + '%',
              target: (takeProfitPct * 100).toFixed(0) + '%',
            });
            await this.closeCurrentPosition('take-profit');
            this.lastAction     = `TAKE PROFIT YES +${(pricePnlPct * 100).toFixed(1)}% (entry=${(this.lastEntryPrice * 100).toFixed(0)}c now=${(currentPrice * 100).toFixed(0)}c)`;
            this.lastActionTime = new Date().toISOString();
            void this.appendLog('close', `TAKE PROFIT YES +${(pricePnlPct * 100).toFixed(1)}% — entry ${(this.lastEntryPrice * 100).toFixed(0)}c -> ${(currentPrice * 100).toFixed(0)}c`, {
              entryPrice: this.lastEntryPrice, currentPrice, pnlPct: pricePnlPct,
            });
          } else if (pricePnlPct <= -stopLossPct) {
            // STOP LOSS — cut the loser
            const currentPrice = this.lastKnownYesPrice;
            logger.info('Btc5MinBot: LONG_YES -> STOP LOSS', {
              entryPrice: this.lastEntryPrice,
              currentPrice,
              pnlPct: (pricePnlPct * 100).toFixed(1) + '%',
              stopAt: (-stopLossPct * 100).toFixed(0) + '%',
            });
            await this.closeCurrentPosition('stop-loss');
            this.lastAction     = `STOP LOSS YES ${(pricePnlPct * 100).toFixed(1)}% (entry=${(this.lastEntryPrice * 100).toFixed(0)}c now=${(currentPrice * 100).toFixed(0)}c)`;
            this.lastActionTime = new Date().toISOString();
            void this.appendLog('close', `STOP LOSS YES ${(pricePnlPct * 100).toFixed(1)}% — entry ${(this.lastEntryPrice * 100).toFixed(0)}c -> ${(currentPrice * 100).toFixed(0)}c`, {
              entryPrice: this.lastEntryPrice, currentPrice, pnlPct: pricePnlPct,
            });
          } else if (canExit && score < EXIT_THRESHOLD) {
            // Signal weakened — exit to flat (no flip)
            logger.info('Btc5MinBot: LONG_YES -> FLAT (signal weakened)', {
              score: score.toFixed(1), exitThreshold: EXIT_THRESHOLD.toFixed(1),
              pnlPct: (pricePnlPct * 100).toFixed(1) + '%',
            });
            await this.closeCurrentPosition('signal-weakened');
            this.lastAction     = `CLOSE YES -> FLAT (score=${score.toFixed(0)}, pnl=${(pricePnlPct * 100).toFixed(1)}%)`;
            this.lastActionTime = new Date().toISOString();
            void this.appendLog('close', `CLOSE YES -> FLAT — score weakened to ${score.toFixed(0)}, pnl ${(pricePnlPct * 100).toFixed(1)}%`, {
              score: score.toFixed(0), pnlPct: pricePnlPct,
            });
          } else {
            // Still holding — log TP/SL levels
            this.lastAction = `HOLD YES (pnl=${(pricePnlPct * 100).toFixed(1)}%, TP@+${(takeProfitPct * 100).toFixed(0)}% SL@-${(stopLossPct * 100).toFixed(0)}%)`;
            logger.info('Btc5MinBot: HOLD LONG_YES — within TP/SL range', {
              score: score.toFixed(1),
              pnlPct: (pricePnlPct * 100).toFixed(1) + '%',
              takeProfitPct: (takeProfitPct * 100).toFixed(0) + '%',
              stopLossPct: (stopLossPct * 100).toFixed(0) + '%',
            });
          }
          break;
        }

        case 'long_no': {
          // Must enforce minimum hold time before any exit (unless stop-loss hit hard)
          if (!canExit && pricePnlPct > -stopLossPct) {
            this.lastAction = `HOLD NO (min hold ${Math.round(holdTimeMs / 1000)}s/${riskLimits.minHoldTimeMs / 1000}s)`;
            logger.info('Btc5MinBot: HOLD LONG_NO — minimum hold time', {
              score: score.toFixed(1), holdTimeMs, minHoldMs: riskLimits.minHoldTimeMs,
            });
          } else if (pricePnlPct >= takeProfitPct) {
            // TAKE PROFIT — price moved in our favor
            const currentPrice = this.lastKnownNoPrice;
            logger.info('Btc5MinBot: LONG_NO -> TAKE PROFIT', {
              entryPrice: this.lastEntryPrice,
              currentPrice,
              pnlPct: (pricePnlPct * 100).toFixed(1) + '%',
              target: (takeProfitPct * 100).toFixed(0) + '%',
            });
            await this.closeCurrentPosition('take-profit');
            this.lastAction     = `TAKE PROFIT NO +${(pricePnlPct * 100).toFixed(1)}% (entry=${(this.lastEntryPrice * 100).toFixed(0)}c now=${(currentPrice * 100).toFixed(0)}c)`;
            this.lastActionTime = new Date().toISOString();
            void this.appendLog('close', `TAKE PROFIT NO +${(pricePnlPct * 100).toFixed(1)}% — entry ${(this.lastEntryPrice * 100).toFixed(0)}c -> ${(currentPrice * 100).toFixed(0)}c`, {
              entryPrice: this.lastEntryPrice, currentPrice, pnlPct: pricePnlPct,
            });
          } else if (pricePnlPct <= -stopLossPct) {
            // STOP LOSS — cut the loser
            const currentPrice = this.lastKnownNoPrice;
            logger.info('Btc5MinBot: LONG_NO -> STOP LOSS', {
              entryPrice: this.lastEntryPrice,
              currentPrice,
              pnlPct: (pricePnlPct * 100).toFixed(1) + '%',
              stopAt: (-stopLossPct * 100).toFixed(0) + '%',
            });
            await this.closeCurrentPosition('stop-loss');
            this.lastAction     = `STOP LOSS NO ${(pricePnlPct * 100).toFixed(1)}% (entry=${(this.lastEntryPrice * 100).toFixed(0)}c now=${(currentPrice * 100).toFixed(0)}c)`;
            this.lastActionTime = new Date().toISOString();
            void this.appendLog('close', `STOP LOSS NO ${(pricePnlPct * 100).toFixed(1)}% — entry ${(this.lastEntryPrice * 100).toFixed(0)}c -> ${(currentPrice * 100).toFixed(0)}c`, {
              entryPrice: this.lastEntryPrice, currentPrice, pnlPct: pricePnlPct,
            });
          } else if (canExit && score > -EXIT_THRESHOLD) {
            // Signal weakened — exit to flat (no flip)
            logger.info('Btc5MinBot: LONG_NO -> FLAT (signal weakened)', {
              score: score.toFixed(1), exitThreshold: (-EXIT_THRESHOLD).toFixed(1),
              pnlPct: (pricePnlPct * 100).toFixed(1) + '%',
            });
            await this.closeCurrentPosition('signal-weakened');
            this.lastAction     = `CLOSE NO -> FLAT (score=${score.toFixed(0)}, pnl=${(pricePnlPct * 100).toFixed(1)}%)`;
            this.lastActionTime = new Date().toISOString();
            void this.appendLog('close', `CLOSE NO -> FLAT — score weakened to ${score.toFixed(0)}, pnl ${(pricePnlPct * 100).toFixed(1)}%`, {
              score: score.toFixed(0), pnlPct: pricePnlPct,
            });
          } else {
            // Still holding — log TP/SL levels
            this.lastAction = `HOLD NO (pnl=${(pricePnlPct * 100).toFixed(1)}%, TP@+${(takeProfitPct * 100).toFixed(0)}% SL@-${(stopLossPct * 100).toFixed(0)}%)`;
            logger.info('Btc5MinBot: HOLD LONG_NO — within TP/SL range', {
              score: score.toFixed(1),
              pnlPct: (pricePnlPct * 100).toFixed(1) + '%',
              takeProfitPct: (takeProfitPct * 100).toFixed(0) + '%',
              stopLossPct: (stopLossPct * 100).toFixed(0) + '%',
            });
          }
          break;
        }
      }

      // 16. Cache status to Redis
      await this.cacheStatus(signals, market);
    } catch (err) {
      logger.error('Btc5MinBot: cycle error', { error: (err as Error).message });
    }
  }

  // ─── Synthetic window refresh ──────────────────────────────────────────────

  /**
   * For synthetic markets, detect if the window should be treated as new.
   * Synthetic markets always have end_date = now + 5 min, so they
   * "roll over" every cycle. We treat it as a new window if the
   * previous window's trade count has been reached or no AI decision exists.
   */
  private shouldRefreshSyntheticWindow(): boolean {
    // If we have no AI decision, we need a new window
    if (!this.windowAiDecisionId) return true;

    // If max trades reached, start a new window
    if (this.windowTradeCount >= this.maxTradesPerWindow) return true;

    // Otherwise keep the current window going
    return false;
  }

  // ─── Window transition ────────────────────────────────────────────────────

  private async onNewWindow(
    market: ActiveBtcMarket,
    signals: BtcSignals | null,
  ): Promise<void> {
    const windowEndTs = market.endDate
      ? Math.floor(market.endDate.getTime() / 1000)
      : null;

    logger.info('Btc5MinBot: === NEW WINDOW ===', {
      previousMarketId: this.currentWindowMarketId,
      newMarketId:      market.id,
      title:            market.title,
      isSynthetic:      market.is_synthetic,
      priceToBeat:      market.priceToBeat ?? 'N/A',
      conditionId:      market.conditionId ?? 'N/A',
      windowEnd:        market.endDate?.toISOString() ?? 'unknown',
      outcomes:         'Up (YES) / Down (NO)',
    });

    const priceToBeatStr = market.priceToBeat
      ? `$${market.priceToBeat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : 'N/A';

    void this.appendLog(
      'signal',
      `New window: ${market.title} | Up=${market.yesPrice.toFixed(3)} Down=${market.noPrice.toFixed(3)} | priceToBeat=${priceToBeatStr}${market.is_synthetic ? ' [SYNTHETIC]' : ''}`,
      {
        marketId: market.id,
        isSynthetic: market.is_synthetic,
        priceToBeat: market.priceToBeat,
        conditionId: market.conditionId,
      },
    );

    // Close any leftover position from previous window
    if (this.currentPositionId) {
      logger.info('Btc5MinBot: closing leftover position from previous window', {
        positionId: this.currentPositionId,
        side:       this.currentSide,
      });
      await this.closeCurrentPosition('window-transition');
    }

    // Resolve priceToBeat — prefer what Gamma/DB gave us; fall back to the
    // current BTC price from signals if still unavailable (e.g. window is
    // brand-new and no candle exists at eventStartTime yet).
    const resolvedPriceToBeat: number | null =
      market.priceToBeat != null
        ? market.priceToBeat
        : (signals?.current_price ?? null);

    if (resolvedPriceToBeat == null) {
      logger.warn('Btc5MinBot: priceToBeat unavailable — no candle data and no signals price');
    } else {
      const source = market.priceToBeat != null ? 'gamma/db-candle' : 'signals.current_price (fallback)';
      logger.info('Btc5MinBot: priceToBeat resolved', {
        priceToBeat: `$${resolvedPriceToBeat.toFixed(2)}`,
        source,
      });
    }

    // Reset window state
    this.currentWindowMarketId = market.id;
    this.currentWindowEndTs    = windowEndTs;
    this.currentPriceToBeat    = resolvedPriceToBeat;
    this.currentPositionId     = null;
    this.currentSide           = null;
    this.windowTradeCount      = 0;
    this.windowAiDecisionId    = null;
    this.lastEntryPrice        = 0;

    // For synthetic markets, ensure a market record exists in the DB
    // so that orders/positions can reference it via foreign key.
    if (market.is_synthetic) {
      await this.ensureMarketRecord(market);
    }

    // Make ONE AI call for this window
    if (signals) {
      await this.makeWindowAiCall(market, signals);
    }
  }

  /**
   * Upsert a market record in the markets table so that
   * orders, positions, and AI decisions can reference it via foreign key.
   * Works for both real Gamma markets and synthetic sandbox markets.
   */
  private async ensureMarketRecord(market: ActiveBtcMarket): Promise<void> {
    try {
      const existing = await prisma.market.findUnique({ where: { id: market.id } });
      if (existing) {
        // Update end_date and prices
        await prisma.market.update({
          where: { id: market.id },
          data: {
            end_date:       market.endDate,
            current_prices: {
              [market.yesTokenId]: market.yesPrice,
              [market.noTokenId]:  market.noPrice,
            } as Prisma.InputJsonValue,
          },
        });
        return;
      }

      const isSynthetic = market.is_synthetic;
      await prisma.market.create({
        data: {
          id:                  market.id,
          polymarket_id:       market.polymarket_id,
          title:               market.title,
          description:         isSynthetic
            ? 'Synthetic BTC 5-minute scalper market for sandbox/demo mode'
            : `Real Polymarket BTC 5-min market — ${market.title}`,
          category:            'crypto',
          subcategory:         isSynthetic ? 'btc_5min_synthetic' : 'btc_5min',
          status:              'active',
          is_tradeable:        true,
          resolution_criteria: 'Resolves Up if BTC price is higher after the 5-minute window',
          outcomes:            [
            { name: 'Up', token_id: market.yesTokenId },
            { name: 'Down', token_id: market.noTokenId },
          ] as Prisma.InputJsonValue,
          current_prices:      {
            [market.yesTokenId]: market.yesPrice,
            [market.noTokenId]:  market.noPrice,
          } as Prisma.InputJsonValue,
          end_date:            market.endDate,
          liquidity:           market.liquidity,
          volume_24h:          market.volume24h,
          tags:                isSynthetic
            ? ['btc', 'synthetic', 'sandbox', '5min']
            : ['btc', '5min', 'recurring', 'polymarket'],
        },
      });

      logger.info('Btc5MinBot: market record created in DB', {
        marketId:    market.id,
        title:       market.title,
        isSynthetic,
      });
    } catch (err) {
      logger.warn('Btc5MinBot: failed to upsert market record', {
        error: (err as Error).message,
      });
    }
  }

  private async makeWindowAiCall(
    market: ActiveBtcMarket,
    signals: BtcSignals,
  ): Promise<void> {
    try {
      const [riskAppetite, bankroll, allPositions] = await Promise.all([
        systemConfigService.getValue<number>('RISK_APPETITE').then((v) => v ?? 5),
        bankrollService.get(),
        positionService.findAll(),
      ]);

      const availableBalance = bankroll ? Number(bankroll.active_balance) : 0;

      const systemPrompt = buildSystemPrompt(riskAppetite);
      const userPrompt   = buildUserPrompt(signals, market, availableBalance, allPositions.length);

      const aiResponse = await callWindowAi(systemPrompt, userPrompt, signals);

      logger.info('Btc5MinBot: window AI decision', {
        bias:       aiResponse.bias,
        confidence: aiResponse.confidence,
        reasoning:  aiResponse.reasoning,
      });

      // Persist AI decision record — use market data directly (no DB lookup needed
      // since the market may only exist on Polymarket, not in our local DB)
      const direction = aiResponse.bias === 'bearish' ? 'sell' : 'buy';
      const outcomeToken = aiResponse.bias === 'bearish'
        ? market.noTokenId
        : market.yesTokenId;

      // Ensure market record exists in DB for foreign key
      await this.ensureMarketRecord(market);

      const aiRecord = await aiDecisionService.create({
        market_id:         market.id,
        category:          'crypto',
        action:            aiResponse.bias === 'neutral' ? 'hold' : 'trade',
        direction:         direction as 'buy' | 'sell',
        outcome_token:     outcomeToken,
        confidence:        String(Math.max(0.80, aiResponse.confidence).toFixed(4)),
        size_hint:         null,
        fair_value:        String(market.yesPrice.toFixed(4)),
        estimated_edge:    String((Math.abs(signals.direction_score) / 200).toFixed(6)),
        reasoning:         `[Scalper window${market.is_synthetic ? ' SYNTHETIC' : ''}] ${aiResponse.reasoning}`,
        regime_assessment: `btc-5min-scalper | score=${signals.direction_score.toFixed(0)} | ${signals.trend}${market.is_synthetic ? ' | synthetic' : ''}`,
        model_used:        'btc-5min-scalper',
        latency_ms:        0,
        tokens_used:       0,
        prompt_version:    PROMPT_VERSION,
        dashboard_text:    userPrompt,
        account_state:     { balance: availableBalance, positions: allPositions.length } as Prisma.InputJsonValue,
      } as Parameters<typeof aiDecisionService.create>[0]);

      this.windowAiDecisionId = aiRecord.id;
      void this.appendLog('signal', `AI bias: ${aiResponse.bias} (${Math.round(aiResponse.confidence * 100)}%) — ${aiResponse.reasoning.slice(0, 100)}`, {
        bias: aiResponse.bias, confidence: aiResponse.confidence,
      });
      logger.info('Btc5MinBot: window AI decision persisted', {
        decisionId: aiRecord.id.toString(),
      });
    } catch (err) {
      logger.error('Btc5MinBot: window AI call failed', {
        error: (err as Error).message,
      });
      // Create a fallback decision so we can still trade deterministically
      await this.createFallbackDecision(market, signals);
    }
  }

  private async createFallbackDecision(
    market: ActiveBtcMarket,
    signals: BtcSignals,
  ): Promise<void> {
    try {
      // Ensure market record exists in DB for foreign key
      await this.ensureMarketRecord(market);

      const aiRecord = await aiDecisionService.create({
        market_id:         market.id,
        category:          'crypto',
        action:            'trade',
        direction:         'buy',
        outcome_token:     market.yesTokenId,
        confidence:        String((0.80).toFixed(4)),
        size_hint:         null,
        fair_value:        String(market.yesPrice.toFixed(4)),
        estimated_edge:    String((Math.abs(signals.direction_score) / 200).toFixed(6)),
        reasoning:         '[Scalper fallback] AI call failed, using signal-based trading',
        regime_assessment: `btc-5min-scalper-fallback | score=${signals.direction_score.toFixed(0)}`,
        model_used:        'btc-5min-scalper-fallback',
        latency_ms:        0,
        tokens_used:       0,
        prompt_version:    PROMPT_VERSION,
        dashboard_text:    'AI unavailable — fallback to signals',
        account_state:     {} as Prisma.InputJsonValue,
      } as Parameters<typeof aiDecisionService.create>[0]);

      this.windowAiDecisionId = aiRecord.id;
    } catch (err) {
      logger.error('Btc5MinBot: fallback decision creation failed', {
        error: (err as Error).message,
      });
    }
  }

  // ─── Trade execution ────────────────────────────────────────────────────────

  private async executeTrade(
    market: ActiveBtcMarket,
    side: 'YES' | 'NO',
    sizeUsd: number,
    decisionId: bigint,
  ): Promise<string | null> {
    const tokenId = side === 'YES' ? market.yesTokenId : market.noTokenId;
    const price   = side === 'YES' ? market.yesPrice   : market.noPrice;

    try {
      // Place order through existing order manager (respects mock/live mode)
      const { order } = await orderManager.placeOrder({
        marketId:      market.id,
        decisionId,
        side:          'buy',
        outcomeToken:  tokenId,
        price,
        sizeUsd,
        orderType:     'limit',
        confidence:    0.8,
        estimatedEdge: null,
        regime:        'btc-5min-scalper',
      });

      if (order.status === 'filled') {
        // Open position via position manager (handles bankroll adjustment)
        const position = await positionManager.openPosition({
          marketId:     market.id,
          outcomeToken: tokenId,
          side:         'long',
          size:         sizeUsd,
          entryPrice:   Number(order.avg_fill_price ?? price),
          fees:         sizeUsd * 0.001,
          decisionId,
          exitStrategy: 'resolution_only',
        });

        const entryPrice = Number(order.avg_fill_price ?? price);

        logger.info('Btc5MinBot: trade executed', {
          positionId: position.id,
          marketId:   market.id,
          side,
          sizeUsd,
          entryPrice,
        });

        // Publish trade event to WebSocket clients
        emitBtcBotTrade({
          type:      'trade',
          side,
          price:     entryPrice,
          size:      sizeUsd,
          action:    'BUY',
          timestamp: new Date().toISOString(),
        });

        return position.id;
      }

      logger.info('Btc5MinBot: order not filled', {
        orderId: order.id,
        status:  order.status,
        side,
      });
      return null;
    } catch (err) {
      logger.error('Btc5MinBot: trade execution failed', {
        marketId: market.id,
        side,
        sizeUsd,
        error:   (err as Error).message,
      });
      return null;
    }
  }

  private async closeCurrentPosition(reason: string): Promise<void> {
    if (!this.currentPositionId) return;

    try {
      const position = await positionService.findById(this.currentPositionId);

      // Use current market price for the exit
      const exitPrice = this.currentSide === 'YES'
        ? this.lastKnownYesPrice
        : this.lastKnownNoPrice;

      const entryPrice = Number(position.avg_entry_price);
      const size       = Number(position.size);
      const pnl        = (exitPrice - entryPrice) * size - Number(position.total_fees);
      this.sessionPnl += pnl;

      // Track daily PnL and consecutive losses
      this.dailyPnl += pnl;
      if (pnl < 0) {
        this.consecutiveLosses++;
      } else {
        this.consecutiveLosses = 0;
      }

      await positionManager.closePosition({
        positionId:  this.currentPositionId,
        exitPrice,
        closeReason: 'manual',
        regime:      reason,
      });

      logger.info('Btc5MinBot: position closed', {
        positionId: this.currentPositionId,
        side:       this.currentSide,
        entryPrice,
        exitPrice,
        pnl,
        reason,
      });
    } catch (err) {
      logger.error('Btc5MinBot: failed to close position', {
        positionId: this.currentPositionId,
        error:      (err as Error).message,
      });
    }

    // Release deployed capital
    if (this.currentPositionId) {
      try {
        const pos = await positionService.findById(this.currentPositionId).catch(() => null);
        if (pos) this.totalDeployed = Math.max(0, this.totalDeployed - Number(pos.size));
      } catch { /* non-fatal */ }
    }

    this.currentPositionId = null;
    this.currentSide       = null;
    this.positionEnteredAt = null;
    this.lastEntryPrice    = 0;
  }

  // ─── State helpers ──────────────────────────────────────────────────────────

  private getState(): ScalperState {
    if (!this.currentPositionId || !this.currentSide) return 'flat';
    return this.currentSide === 'YES' ? 'long_yes' : 'long_no';
  }

  private resetWindowState(): void {
    this.currentWindowMarketId = null;
    this.currentWindowEndTs    = null;
    this.currentPriceToBeat    = null;
    this.currentPositionId     = null;
    this.currentSide           = null;
    this.windowTradeCount      = 0;
    this.windowAiDecisionId    = null;
    this.positionEnteredAt     = null;
    this.lastEntryPrice        = 0;
  }

  // ─── Activity log ────────────────────────────────────────────────────────────

  private async appendLog(
    type: 'buy' | 'sell' | 'hold' | 'signal' | 'close' | 'info' | 'error',
    message: string,
    meta?: Record<string, unknown>,
  ): Promise<void> {
    try {
      const entry = JSON.stringify({
        id:        `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        timestamp: new Date().toISOString(),
        type,
        message,
        ...(meta ? { meta } : {}),
      });
      // lpush = newest first; ltrim to keep max entries
      await redis.lpush(ACTIVITY_LOG_KEY, entry);
      await redis.ltrim(ACTIVITY_LOG_KEY, 0, ACTIVITY_LOG_MAX - 1);
    } catch (err) {
      logger.warn('Btc5MinBot: failed to append activity log', {
        error: (err as Error).message,
      });
    }
  }

  // ─── Fast price refresh (runs every 5s between main cycles) ────────────────

  private async refreshAndEmitPrices(): Promise<void> {
    if (!this.currentMarket || this.currentMarket.is_synthetic) return;
    if (!this.currentMarket.yesTokenId || !this.currentMarket.noTokenId) return;

    try {
      const updated = await refreshPrices(this.currentMarket);
      this.currentMarket = updated;
      this.lastKnownYesPrice = updated.yesPrice;
      this.lastKnownNoPrice = updated.noPrice;

      // Update Redis cache with fresh prices for REST API consumers
      const statusPayload = {
        signals: null,
        activeMarket: {
          id:          updated.id,
          title:       updated.title,
          endDate:     updated.endDate ? updated.endDate.toISOString() : null,
          yesPrice:    updated.yesPrice,
          noPrice:     updated.noPrice,
          yesTokenId:  updated.yesTokenId,
          noTokenId:   updated.noTokenId,
          conditionId: updated.conditionId ?? null,
          priceToBeat: updated.priceToBeat ?? null,
          isSynthetic: updated.is_synthetic,
        },
        state:            this.getState(),
        windowTradeCount: this.windowTradeCount,
        sessionTrades:    this.sessionTrades,
        sessionPnl:       this.sessionPnl,
        lastAction:       this.lastAction,
        lastActionTime:   this.lastActionTime,
        timestamp:        new Date().toISOString(),
      };

      // Update Redis cache so REST API returns fresh prices too
      await redis.setex(STATUS_REDIS_KEY, STATUS_TTL_SEC, JSON.stringify({
        ...statusPayload,
        currentPositionId: this.currentPositionId,
      }));

      // Emit to WebSocket
      emitBtcBotStatus(statusPayload);
    } catch {
      // Non-fatal — skip this refresh
    }
  }

  // ─── Redis status cache ─────────────────────────────────────────────────────

  private async cacheStatus(
    signals: BtcSignals | null,
    market: ActiveBtcMarket | null,
  ): Promise<void> {
    const activeMarket = market
      ? {
          id:           market.id,
          title:        market.title,
          endDate:      market.endDate ? market.endDate.toISOString() : null,
          yesPrice:     market.yesPrice,
          noPrice:      market.noPrice,
          yesTokenId:   market.yesTokenId,
          noTokenId:    market.noTokenId,
          conditionId:  market.conditionId ?? null,
          priceToBeat:  market.priceToBeat ?? null,
          isSynthetic:  market.is_synthetic,
        }
      : null;

    const statusPayload = {
      signals,
      activeMarket,
      state:            this.getState(),
      windowTradeCount: this.windowTradeCount,
      sessionTrades:    this.sessionTrades,
      sessionPnl:       this.sessionPnl,
      lastAction:       this.lastAction,
      lastActionTime:   this.lastActionTime,
      timestamp:        new Date().toISOString(),
    };

    try {
      await redis.setex(
        STATUS_REDIS_KEY,
        STATUS_TTL_SEC,
        JSON.stringify({
          ...statusPayload,
          currentPositionId: this.currentPositionId,
        }),
      );
    } catch (err) {
      logger.warn('Btc5MinBot: failed to cache status', {
        error: (err as Error).message,
      });
    }

    // Publish to WebSocket clients via Redis bridge (bot runs in its own process)
    emitBtcBotStatus(statusPayload);
  }
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildSystemPrompt(riskAppetite: number): string {
  return `You are a BTC 5-minute scalper bot. Given technical signals, provide a directional bias for the current 5-minute window.
Respond with ONLY JSON: {"bias":"bullish"|"bearish"|"neutral","confidence":0.0-1.0,"reasoning":"one sentence"}
bullish = Bitcoin will go UP in this window. bearish = Bitcoin will go DOWN.
This bias is used for multiple scalp trades within the window.
Only give a directional bias when signals clearly align. Say neutral when uncertain.
RISK APPETITE: ${riskAppetite}/10`;
}

function buildUserPrompt(
  signals:   BtcSignals,
  market:    ActiveBtcMarket,
  balance:   number,
  positions: number,
): string {
  const expiryStr = market.endDate ? formatExpiry(market.endDate) : 'unknown';

  return `BTC Signals:
- Price: $${signals.current_price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} | Trend: ${signals.trend}
- Momentum: 1m=${signals.momentum_1m.toFixed(2)}%, 3m=${signals.momentum_3m.toFixed(2)}%, 5m=${signals.momentum_5m.toFixed(2)}%
- RSI(14): ${signals.rsi.toFixed(1)} (${signals.rsi_signal})
- Volume: ${signals.volume_ratio.toFixed(2)}x avg${signals.volume_surge ? ' (SURGE)' : ''}
- VWAP: $${signals.vwap.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} (price ${signals.price_vs_vwap})
- Direction Score: ${signals.direction_score.toFixed(0)}/100 | Suggested: ${signals.suggested_side ?? 'skip'}

Market: "${market.title}"
- YES: ${market.yesPrice.toFixed(3)} | NO: ${market.noPrice.toFixed(3)}
- Liquidity: $${market.liquidity.toLocaleString()} | Expiry: ${expiryStr}

Account: $${balance.toFixed(2)} available | ${positions} open positions

This is a SCALPER window. Provide a directional bias for multiple quick trades.`;
}

function formatExpiry(date: Date): string {
  const diffMs  = date.getTime() - Date.now();
  const diffMin = Math.round(diffMs / 60_000);
  if (diffMin <= 0)   return 'expired';
  if (diffMin < 60)   return `${diffMin}m`;
  const diffH = Math.round(diffMin / 60);
  return `${diffH}h`;
}

// ─── AI call with fallback ────────────────────────────────────────────────────

async function callWindowAi(
  systemPrompt: string,
  userPrompt:   string,
  signals:      BtcSignals,
): Promise<WindowAiResponse> {
  try {
    const result = await aiClient.complete(userPrompt, {
      systemPrompt,
      maxTokens:   256,
      temperature: 0.15,
    });

    return parseAiResponse(result.content, signals);
  } catch (err) {
    logger.warn('Btc5MinBot: AI call failed, falling back to signals', {
      error: (err as Error).message,
    });
    return fallbackFromSignals(signals);
  }
}

function parseAiResponse(raw: string, signals: BtcSignals): WindowAiResponse {
  // Strip markdown fences
  const fenceMatch = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
  const jsonStr    = fenceMatch?.[1]?.trim() ?? raw.match(/\{[\s\S]*\}/)?.[0]?.trim() ?? raw.trim();

  try {
    const parsed = JSON.parse(jsonStr) as Record<string, unknown>;

    const bias = parsed.bias === 'bullish' ? 'bullish'
      : parsed.bias === 'bearish' ? 'bearish'
      : 'neutral';

    const confidence = typeof parsed.confidence === 'number'
      ? Math.max(0, Math.min(1, parsed.confidence))
      : signals.confidence;

    const reasoning = typeof parsed.reasoning === 'string'
      ? parsed.reasoning
      : 'AI window bias';

    return { bias, confidence, reasoning };
  } catch {
    logger.warn('Btc5MinBot: failed to parse AI JSON, using signal fallback', {
      raw: raw.slice(0, 200),
    });
    return fallbackFromSignals(signals);
  }
}

function fallbackFromSignals(signals: BtcSignals): WindowAiResponse {
  if (signals.suggested_side === 'YES') {
    return {
      bias:       'bullish',
      confidence: signals.confidence,
      reasoning:  `Signal fallback: score=${signals.direction_score.toFixed(0)}, trend=${signals.trend}`,
    };
  }
  if (signals.suggested_side === 'NO') {
    return {
      bias:       'bearish',
      confidence: signals.confidence,
      reasoning:  `Signal fallback: score=${signals.direction_score.toFixed(0)}, trend=${signals.trend}`,
    };
  }
  return {
    bias:       'neutral',
    confidence: signals.confidence,
    reasoning:  'Signals inconclusive',
  };
}

// ─── Module singleton ─────────────────────────────────────────────────────────

export const btc5MinBot = new Btc5MinBot();
