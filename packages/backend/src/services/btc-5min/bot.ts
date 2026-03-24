/**
 * BTC 5-Min Scalper Bot — "Binary Resolution Rider" Strategy V4
 *
 * KEY INSIGHT: These are binary markets resolving to 0 or 1. The math:
 *   Entry at 50¢ → need >50% win rate to profit
 *   Entry at 60¢ → need >60% (too hard)
 *   Entry at 40¢ → need only >40% (easy with priceToBeat signal)
 *
 * Therefore: ENTER EARLY at ~50¢ using priceToBeat as direction signal,
 * then HOLD TO RESOLUTION. No stop-loss (causes whipsaw in volatile markets),
 * no take-profit (binary payout maximizes gains). Let the market resolve.
 *
 * Strategy:
 *   1. Wait 15-30s into window (let BTC establish initial direction vs priceToBeat)
 *   2. If BTC > priceToBeat + $15: BUY UP at ~50¢ (cheap entry)
 *      If BTC < priceToBeat - $15: BUY DOWN at ~50¢
 *      If within $15: SKIP (no edge, it's a coin flip)
 *   3. HOLD TO RESOLUTION — no stop-loss, no take-profit
 *      Exception: emergency exit if BTC crosses hard through priceToBeat wrong way (>$50 delta)
 *   4. ONE trade per window max — if wrong, accept the loss, wait for next window
 *   5. Position size scales with priceToBeat delta magnitude and risk appetite
 *
 * Why no stop-loss? Live testing showed -20% and -35% stops fire constantly
 * from normal market noise. These markets swing ±30% within seconds. Stops
 * just guarantee frequent small losses instead of letting binary payouts work.
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

/** ONE trade per window. If wrong, accept the loss. No re-entries. */
const DEFAULT_MAX_TRADES_PER_WINDOW = 1;

/** 5-minute window duration in ms. */
const WINDOW_DURATION_MS = 300_000;

/** Enter between 15s and 240s into the window (sweet spot for cheap entry + directional info). */
const WINDOW_ENTRY_MIN_MS = 15_000;  // Wait at least 15s for BTC to show direction
const WINDOW_ENTRY_MAX_MS = 240_000; // Don't enter in last 60s (too late, prices already extreme)

/** Emergency exit: if BTC crosses this far through priceToBeat on the WRONG side, cut loss.
 *  Otherwise, hold to resolution. */
const EMERGENCY_EXIT_DELTA = 50; // $50 wrong-side delta triggers exit

/** Minimum priceToBeat delta (in $) to consider entering. Below this = coin flip, skip. */
const MIN_PTB_DELTA = 15;

/** Maximum entry price — don't buy a side above 58¢ (need cheap entry for binary math). */
const MAX_ENTRY_PRICE = 0.58;

/** No fixed stop-loss — hold to resolution. Emergency exit only on extreme wrong-side delta. */

/** Minimum hold time (short — mainly to prevent immediate exit on same cycle). */
const DEFAULT_MIN_HOLD_TIME_MS = 10_000;

// ─── Risk config types ───────────────────────────────────────────────────────

interface RiskLimits {
  maxSingleTrade: number;
  maxPositionSize: number;
  maxDailyLoss: number;
  maxConsecutiveLosses: number;
  minHoldTimeMs: number;
}

// ─── Trade sizing ────────────────────────────────────────────────────────────

/**
 * Risk tier configuration for trade sizing.
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

/**
 * Compute trade size. No longer depends on direction_score — sizing is based
 * on risk appetite tier and entry price edge only.
 */
function computeTradeSize(
  balance: number,
  entryPrice: number,
  riskAppetite: number,
  maxSingleTrade: number,
): number {
  const tier = getRiskTier(riskAppetite);

  // Price edge multiplier: cheaper entry = more upside = bigger trade
  // < 0.25 = 1.75x, < 0.35 = 1.5x, < 0.45 = 1.2x, else 1.0x
  const priceEdgeMultiplier = entryPrice < 0.25 ? 1.75
    : entryPrice < 0.35 ? 1.5
    : entryPrice < 0.45 ? 1.2
    : 1.0;

  const rawSize = tier.baseTrade * priceEdgeMultiplier;

  // Cap at balance percentage and maxSingleTrade from risk config
  const maxFromBalance = balance * tier.maxBalancePct;
  const finalSize = Math.max(tier.minTrade, Math.min(rawSize, maxFromBalance, maxSingleTrade));

  logger.info('Btc5MinBot: trade size calculation', {
    riskAppetite,
    tier: riskAppetite >= 10 ? 'maximum' : riskAppetite >= 7 ? 'aggressive' : riskAppetite >= 4 ? 'balanced' : 'conservative',
    baseTrade: tier.baseTrade,
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

// ─── Scalper state ───────────────────────────────────────────────────────────

type ScalperState = 'flat' | 'long_yes' | 'long_no';

// ─── AI response shape ───────────────────────────────────────────────────────

interface WindowAiResponse {
  bias:       'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning:  string;
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

  /** If true, bot was stopped out this window and will NOT re-enter. */
  private stoppedOutThisWindow = false;

  // Stats for current session
  private sessionTrades = 0;
  private sessionPnl    = 0;

  // Risk tracking
  private consecutiveLosses   = 0;
  private dailyPnl            = 0;
  private dailyPnlResetDate   = new Date().toDateString();
  private totalDeployed        = 0;

  // Last action description (for status cache)
  private lastAction     = 'INIT';
  private lastActionTime = new Date().toISOString();

  constructor(cycleMs = 10_000) {
    this.cycleMs = cycleMs;
  }

  start(): void {
    if (this.running) return;
    this.running = true;

    logger.info('Btc5MinBot: starting scalper (Follow The Market strategy)', { cycleMs: this.cycleMs });
    void this.appendLog('info', 'Bot started (Follow The Market strategy v2)');

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
      this.currentMarket = market;

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

      // 4. Check sandbox mode
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

      // 7. Window expiry — V4 strategy: HOLD TO RESOLUTION
      //    Don't close positions at window end. The binary payout IS the strategy.
      //    Position will be closed by onNewWindow() when the next window starts.
      if (market.endDate && this.currentPositionId) {
        const msRemaining = market.endDate.getTime() - Date.now();
        if (msRemaining < 30_000) {
          const sideLabel = this.currentSide === 'YES' ? 'Up' : 'Down';
          const currentPrice = this.currentSide === 'YES'
            ? this.lastKnownYesPrice : this.lastKnownNoPrice;
          logger.info('Btc5MinBot: window closing, holding to resolution', {
            msRemaining: Math.round(msRemaining / 1000) + 's',
            side: sideLabel, currentPrice, entryPrice: this.lastEntryPrice,
          });
          this.lastAction = `HOLDING ${sideLabel} to resolution (${Math.round(msRemaining / 1000)}s left, price=${(currentPrice * 100).toFixed(0)}c)`;
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

      // Log risk config being used this cycle
      logger.info('Btc5MinBot: risk config', {
        riskAppetite,
        maxSingleTrade: riskLimits.maxSingleTrade,
        maxPositionSize: riskLimits.maxPositionSize,
        maxDailyLoss: riskLimits.maxDailyLoss,
        maxConsecutiveLosses: riskLimits.maxConsecutiveLosses,
        minHoldTimeMs: riskLimits.minHoldTimeMs,
        strategy: 'binary-resolution-rider-v4',
        emergencyExitDelta: `$${EMERGENCY_EXIT_DELTA}`,
        minPtbDelta: `$${MIN_PTB_DELTA}`,
        dailyPnl: this.dailyPnl,
        consecutiveLosses: this.consecutiveLosses,
        stoppedOutThisWindow: this.stoppedOutThisWindow,
      });

      // Reset daily PnL tracking at the start of each new day
      const today = new Date().toDateString();
      if (this.dailyPnlResetDate !== today) {
        this.dailyPnl = 0;
        this.dailyPnlResetDate = today;
        this.consecutiveLosses = 0;
      }

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

      const state = this.getState();

      // Compute time remaining in window for entry filter
      const msRemaining = market.endDate
        ? market.endDate.getTime() - Date.now()
        : Infinity;

      // Compute time elapsed in window
      const msElapsed = msRemaining === Infinity
        ? Infinity
        : WINDOW_DURATION_MS - msRemaining;

      logger.info('Btc5MinBot: evaluating state machine', {
        state,
        isSandbox:       !!isSandbox,
        windowTrades:    `${this.windowTradeCount}/${this.maxTradesPerWindow}`,
        balance:         availableBalance.toFixed(2),
        msRemaining:     msRemaining === Infinity ? 'N/A' : msRemaining,
        msElapsed:       msElapsed === Infinity ? 'N/A' : msElapsed,
        stoppedOut:      this.stoppedOutThisWindow,
        yesPrice:        market.yesPrice.toFixed(3),
        noPrice:         market.noPrice.toFixed(3),
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
        strategy:       'hold-to-resolution (emergency exit at $' + EMERGENCY_EXIT_DELTA + ' wrong-side)',
      });

      // 13b. Log priceToBeat comparison each cycle
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

      // 15. State machine — "Binary Resolution Rider" V4
      //     Enter early at cheap prices using priceToBeat delta as sole signal.
      //     Hold to resolution. No TP/SL — binary payout handles it.
      //     Emergency exit only if BTC moves $50+ wrong side of priceToBeat.
      const ptbDelta = (ptb != null && btcNow > 0) ? btcNow - ptb! : 0;
      const absDelta = Math.abs(ptbDelta);

      switch (state) {
        case 'flat': {
          // Already traded this window? Don't re-enter.
          if (this.stoppedOutThisWindow || this.windowTradeCount >= this.maxTradesPerWindow) {
            this.lastAction = `FLAT (already traded this window, waiting for next)`;
            break;
          }

          // Timing: enter between 15s and 240s into the window
          if (msElapsed !== Infinity && msElapsed < WINDOW_ENTRY_MIN_MS) {
            this.lastAction = `FLAT (waiting ${Math.round((WINDOW_ENTRY_MIN_MS - msElapsed) / 1000)}s for BTC direction)`;
            break;
          }
          if (msRemaining < (WINDOW_DURATION_MS - WINDOW_ENTRY_MAX_MS)) {
            this.lastAction = `FLAT (too late, ${Math.round(msRemaining / 1000)}s left)`;
            break;
          }

          // Position limit
          if (!canOpenNew) {
            this.lastAction = `POSITION LIMIT ($${currentDeployed.toFixed(0)} >= $${riskLimits.maxPositionSize})`;
            break;
          }

          // Need priceToBeat to make a decision
          if (ptb == null) {
            this.lastAction = `FLAT (priceToBeat not available)`;
            break;
          }

          // Need minimum delta to have edge — below this it's a coin flip
          if (absDelta < MIN_PTB_DELTA) {
            this.lastAction = `FLAT (BTC delta $${ptbDelta.toFixed(0)} too small, need >$${MIN_PTB_DELTA})`;
            logger.info('Btc5MinBot: FLAT — delta too small, coin flip territory', {
              btcPrice: btcNow.toFixed(2), priceToBeat: ptb.toFixed(2),
              delta: `$${ptbDelta.toFixed(0)}`, minDelta: `$${MIN_PTB_DELTA}`,
            });
            break;
          }

          // ENTRY DECISION based purely on BTC vs priceToBeat
          if (ptbDelta > 0 && market.yesPrice <= MAX_ENTRY_PRICE) {
            // BTC is ABOVE priceToBeat → market should resolve UP → BUY UP (YES)
            const size = computeTradeSize(availableBalance, market.yesPrice, riskAppetite, riskLimits.maxSingleTrade);
            logger.info('Btc5MinBot: FLAT -> BUY UP (BTC above PtB)', {
              btcPrice: btcNow.toFixed(2), priceToBeat: ptb.toFixed(2),
              delta: `+$${ptbDelta.toFixed(0)}`, yesPrice: market.yesPrice.toFixed(3),
              size: size.toFixed(2), strategy: 'hold-to-resolution',
            });
            const posId = await this.executeTrade(market, 'YES', size, this.windowAiDecisionId!);
            if (posId) {
              this.currentPositionId = posId;
              this.currentSide = 'YES';
              this.positionEnteredAt = Date.now();
              this.lastEntryPrice = market.yesPrice;
              this.windowTradeCount++;
              this.sessionTrades++;
              this.lastAction = `BUY UP ($${size.toFixed(2)}) @ ${(market.yesPrice * 100).toFixed(0)}c | BTC +$${ptbDelta.toFixed(0)} above PtB | HOLD TO RESOLUTION`;
              this.lastActionTime = new Date().toISOString();
              void this.appendLog('buy', `BUY UP — $${size.toFixed(2)} @ ${(market.yesPrice * 100).toFixed(1)}c | BTC +$${ptbDelta.toFixed(0)} above PtB=$${ptb.toFixed(0)} | holding to resolution`, {
                size, price: market.yesPrice, btcDelta: ptbDelta,
              });
            }
          } else if (ptbDelta < 0 && market.noPrice <= MAX_ENTRY_PRICE) {
            // BTC is BELOW priceToBeat → market should resolve DOWN → BUY DOWN (NO)
            const size = computeTradeSize(availableBalance, market.noPrice, riskAppetite, riskLimits.maxSingleTrade);
            logger.info('Btc5MinBot: FLAT -> BUY DOWN (BTC below PtB)', {
              btcPrice: btcNow.toFixed(2), priceToBeat: ptb.toFixed(2),
              delta: `-$${Math.abs(ptbDelta).toFixed(0)}`, noPrice: market.noPrice.toFixed(3),
              size: size.toFixed(2), strategy: 'hold-to-resolution',
            });
            const posId = await this.executeTrade(market, 'NO', size, this.windowAiDecisionId!);
            if (posId) {
              this.currentPositionId = posId;
              this.currentSide = 'NO';
              this.positionEnteredAt = Date.now();
              this.lastEntryPrice = market.noPrice;
              this.windowTradeCount++;
              this.sessionTrades++;
              this.lastAction = `BUY DOWN ($${size.toFixed(2)}) @ ${(market.noPrice * 100).toFixed(0)}c | BTC -$${Math.abs(ptbDelta).toFixed(0)} below PtB | HOLD TO RESOLUTION`;
              this.lastActionTime = new Date().toISOString();
              void this.appendLog('buy', `BUY DOWN — $${size.toFixed(2)} @ ${(market.noPrice * 100).toFixed(1)}c | BTC -$${Math.abs(ptbDelta).toFixed(0)} below PtB=$${ptb.toFixed(0)} | holding to resolution`, {
                size, price: market.noPrice, btcDelta: ptbDelta,
              });
            }
          } else {
            // Price too expensive or delta direction doesn't match available side
            this.lastAction = `FLAT (Up=${(market.yesPrice * 100).toFixed(0)}c Dn=${(market.noPrice * 100).toFixed(0)}c | BTC delta $${ptbDelta.toFixed(0)} | max entry ${(MAX_ENTRY_PRICE * 100).toFixed(0)}c)`;
          }
          break;
        }

        case 'long_yes': {
          // HOLD TO RESOLUTION — only exit on emergency (BTC crosses hard wrong way)
          const currentYes = this.lastKnownYesPrice;

          // Emergency exit: BTC fell far below priceToBeat (wrong side)
          if (ptb != null && btcNow < ptb - EMERGENCY_EXIT_DELTA && canExit) {
            logger.info('Btc5MinBot: LONG_YES -> EMERGENCY EXIT (BTC crashed below PtB)', {
              btcPrice: btcNow.toFixed(2), priceToBeat: ptb.toFixed(2),
              delta: `$${(btcNow - ptb).toFixed(0)}`, threshold: `-$${EMERGENCY_EXIT_DELTA}`,
              currentYes, entryPrice: this.lastEntryPrice,
            });
            await this.closeCurrentPosition('emergency-exit');
            this.stoppedOutThisWindow = true;
            this.lastAction = `EMERGENCY EXIT UP (BTC -$${Math.abs(btcNow - ptb).toFixed(0)} below PtB)`;
            this.lastActionTime = new Date().toISOString();
            void this.appendLog('close', `EMERGENCY EXIT UP — BTC $${btcNow.toFixed(0)} is $${Math.abs(btcNow - ptb).toFixed(0)} below PtB $${ptb.toFixed(0)} | cut loss`, {
              btcPrice: btcNow, priceToBeat: ptb, delta: btcNow - ptb,
            });
          } else {
            // Hold — let binary resolution do its work
            const pnlStr = this.lastEntryPrice > 0 ? `${(pricePnlPct * 100).toFixed(1)}%` : 'N/A';
            const deltaStr = ptb != null ? `BTC ${ptbDelta >= 0 ? '+' : ''}$${ptbDelta.toFixed(0)} vs PtB` : '';
            this.lastAction = `HOLD UP (${pnlStr}) ${deltaStr} | riding to resolution`;
            logger.info('Btc5MinBot: HOLD LONG_YES — riding to resolution', {
              pnlPct: pnlStr, currentYes, entryPrice: this.lastEntryPrice,
              btcDelta: ptbDelta.toFixed(0), msRemaining,
            });
          }
          break;
        }

        case 'long_no': {
          // HOLD TO RESOLUTION — only exit on emergency (BTC crosses hard wrong way)
          const currentNo = this.lastKnownNoPrice;

          // Emergency exit: BTC rose far above priceToBeat (wrong side)
          if (ptb != null && btcNow > ptb + EMERGENCY_EXIT_DELTA && canExit) {
            logger.info('Btc5MinBot: LONG_NO -> EMERGENCY EXIT (BTC surged above PtB)', {
              btcPrice: btcNow.toFixed(2), priceToBeat: ptb.toFixed(2),
              delta: `+$${(btcNow - ptb).toFixed(0)}`, threshold: `+$${EMERGENCY_EXIT_DELTA}`,
              currentNo, entryPrice: this.lastEntryPrice,
            });
            await this.closeCurrentPosition('emergency-exit');
            this.stoppedOutThisWindow = true;
            this.lastAction = `EMERGENCY EXIT DOWN (BTC +$${(btcNow - ptb).toFixed(0)} above PtB)`;
            this.lastActionTime = new Date().toISOString();
            void this.appendLog('close', `EMERGENCY EXIT DOWN — BTC $${btcNow.toFixed(0)} is $${(btcNow - ptb).toFixed(0)} above PtB $${ptb.toFixed(0)} | cut loss`, {
              btcPrice: btcNow, priceToBeat: ptb, delta: btcNow - ptb,
            });
          } else {
            // Hold — let binary resolution do its work
            const pnlStr = this.lastEntryPrice > 0 ? `${(pricePnlPct * 100).toFixed(1)}%` : 'N/A';
            const deltaStr = ptb != null ? `BTC ${ptbDelta >= 0 ? '+' : ''}$${ptbDelta.toFixed(0)} vs PtB` : '';
            this.lastAction = `HOLD DOWN (${pnlStr}) ${deltaStr} | riding to resolution`;
            logger.info('Btc5MinBot: HOLD LONG_NO — riding to resolution', {
              pnlPct: pnlStr, currentNo, entryPrice: this.lastEntryPrice,
              btcDelta: ptbDelta.toFixed(0), msRemaining,
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
   */
  private shouldRefreshSyntheticWindow(): boolean {
    if (!this.windowAiDecisionId) return true;
    if (this.windowTradeCount >= this.maxTradesPerWindow) return true;
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
      strategy:         'Follow The Market v2',
    });

    const priceToBeatStr = market.priceToBeat
      ? `$${market.priceToBeat.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
      : 'N/A';

    void this.appendLog(
      'signal',
      `New window: ${market.title} | Up=${market.yesPrice.toFixed(3)} Down=${market.noPrice.toFixed(3)} | priceToBeat=${priceToBeatStr}${market.is_synthetic ? ' [SYNTHETIC]' : ''} | Strategy: Follow The Market`,
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
    // current BTC price from signals if still unavailable
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

    // Reset window state (including stoppedOutThisWindow)
    this.currentWindowMarketId = market.id;
    this.currentWindowEndTs    = windowEndTs;
    this.currentPriceToBeat    = resolvedPriceToBeat;
    this.currentPositionId     = null;
    this.currentSide           = null;
    this.windowTradeCount      = 0;
    this.windowAiDecisionId    = null;
    this.lastEntryPrice        = 0;
    this.stoppedOutThisWindow  = false;

    // For synthetic markets, ensure a market record exists in the DB
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
   */
  private async ensureMarketRecord(market: ActiveBtcMarket): Promise<void> {
    try {
      const existing = await prisma.market.findUnique({ where: { id: market.id } });
      if (existing) {
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

      // Persist AI decision record
      const direction = aiResponse.bias === 'bearish' ? 'sell' : 'buy';
      const outcomeToken = aiResponse.bias === 'bearish'
        ? market.noTokenId
        : market.yesTokenId;

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
        reasoning:         `[Follow The Market v2${market.is_synthetic ? ' SYNTHETIC' : ''}] ${aiResponse.reasoning}`,
        regime_assessment: `btc-5min-follow-market | trend=${signals.trend}${market.is_synthetic ? ' | synthetic' : ''}`,
        model_used:        'btc-5min-follow-market',
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
      await this.createFallbackDecision(market, signals);
    }
  }

  private async createFallbackDecision(
    market: ActiveBtcMarket,
    signals: BtcSignals,
  ): Promise<void> {
    try {
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
        reasoning:         '[Follow The Market fallback] AI call failed, using market-price-based trading',
        regime_assessment: `btc-5min-follow-market-fallback | trend=${signals.trend}`,
        model_used:        'btc-5min-follow-market-fallback',
        latency_ms:        0,
        tokens_used:       0,
        prompt_version:    PROMPT_VERSION,
        dashboard_text:    'AI unavailable — fallback to market prices',
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
        regime:        'btc-5min-follow-market',
      });

      if (order.status === 'filled') {
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
    this.stoppedOutThisWindow  = false;
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

      await redis.setex(STATUS_REDIS_KEY, STATUS_TTL_SEC, JSON.stringify({
        ...statusPayload,
        currentPositionId: this.currentPositionId,
      }));

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

    emitBtcBotStatus(statusPayload);
  }
}

// ─── Prompt builders ─────────────────────────────────────────────────────────

function buildSystemPrompt(riskAppetite: number): string {
  return `You are a BTC 5-minute scalper bot using a "Follow The Market" strategy.
Given technical signals and market prices, provide a directional bias for the current 5-minute window.
Respond with ONLY JSON: {"bias":"bullish"|"bearish"|"neutral","confidence":0.0-1.0,"reasoning":"one sentence"}
The bot enters ONLY when the market itself shows direction (one side priced > 58c) AND BTC price confirms vs priceToBeat.
Your bias helps with sizing and confidence, not entry/exit decisions.
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
- YES/Up: ${market.yesPrice.toFixed(3)} | NO/Down: ${market.noPrice.toFixed(3)}
- priceToBeat: ${market.priceToBeat != null ? `$${market.priceToBeat.toFixed(2)}` : 'N/A'}
- Liquidity: $${market.liquidity.toLocaleString()} | Expiry: ${expiryStr}

Strategy: Follow The Market — enter when one side > 58c and BTC confirms vs priceToBeat.
Account: $${balance.toFixed(2)} available | ${positions} open positions`;
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
