/**
 * BTC 5-Min Scalper Bot
 *
 * Active multi-trade scalper that buys and sells multiple times within each
 * 5-minute window. Runs every 10 seconds.
 *
 * State machine per cycle:
 *   FLAT      -> signal UP   -> BUY YES  -> LONG_YES
 *   FLAT      -> signal DOWN -> BUY NO   -> LONG_NO
 *   LONG_YES  -> signal DOWN -> CLOSE YES, BUY NO -> LONG_NO  (flip)
 *   LONG_YES  -> neutral     -> CLOSE YES -> FLAT
 *   LONG_NO   -> signal UP   -> CLOSE NO, BUY YES -> LONG_YES (flip)
 *   LONG_NO   -> neutral     -> CLOSE NO -> FLAT
 *
 * One AI call per window (at window start). Intra-window trades are
 * deterministic based on signal thresholds.
 *
 * Respects:
 *   - RISK_APPETITE from system_config
 *   - Sandbox/mock execution mode (via orderManager + positionManager)
 *   - Start/stop via system_config BTC_5MIN_BOT_ACTIVE
 */
import type { Prisma } from '@prisma/client';
import logger from '../../config/logger.js';
import { redis } from '../../config/redis.js';
import prisma from '../../config/database.js';
import { aiClient } from '../ai/client.js';
import { computeSignals, type BtcSignals } from './signals.js';
import { findActiveBtcMarket, type ActiveBtcMarket } from './market-finder.js';
import * as systemConfigService from '../system-config.service.js';
import * as bankrollService from '../bankroll.service.js';
import * as positionService from '../position.service.js';
import * as aiDecisionService from '../ai-decision.service.js';
import { orderManager } from '../execution/order-manager.js';
import { positionManager } from '../execution/position-manager.js';
import { PROMPT_VERSION } from '../ai/prompt-manager.js';

// ─── Constants ────────────────────────────────────────────────────────────────

const SIGNALS_REDIS_KEY = 'btc-5min:latest-signals';
const SIGNALS_TTL_SEC   = 60;
const STATUS_REDIS_KEY  = 'btc-5min:status';
const STATUS_TTL_SEC    = 30;
const BOT_ACTIVE_KEY    = 'BTC_5MIN_BOT_ACTIVE';

/** Safety close: close any open position when the window has less than this many ms remaining. */
const WINDOW_SAFETY_CLOSE_MS = 30_000;

// ─── Scalper state ───────────────────────────────────────────────────────────

type ScalperState = 'flat' | 'long_yes' | 'long_no';

// ─── AI response shape ───────────────────────────────────────────────────────

interface WindowAiResponse {
  bias:       'bullish' | 'bearish' | 'neutral';
  confidence: number;
  reasoning:  string;
}

// ─── Threshold helpers ───────────────────────────────────────────────────────

function computeThresholds(riskAppetite: number) {
  const appetiteScale = riskAppetite / 5; // 0.2 to 2.0

  // Entry threshold: lower = more trades
  const ENTRY_THRESHOLD = Math.max(10, 30 / appetiteScale);
  // Flip threshold: even lower (committed to flipping when signal is clear)
  const FLIP_THRESHOLD = Math.max(5, 20 / appetiteScale);
  // Exit-to-flat threshold: close if score drops below this (in current direction)
  const EXIT_THRESHOLD = Math.max(3, 10 / appetiteScale);

  return { ENTRY_THRESHOLD, FLIP_THRESHOLD, EXIT_THRESHOLD, appetiteScale };
}

function computeTradeSize(
  balance: number,
  confidence: number,
  appetiteScale: number,
): number {
  // Base: 2% of balance per trade, scaled by appetite and confidence
  const basePct = 0.02 * appetiteScale; // 0.004 to 0.04
  const size = balance * basePct * confidence;
  // Floor $2, cap $50 per trade (these are quick scalps)
  return Math.max(2, Math.min(50 * appetiteScale, size));
}

// ─── Bot ─────────────────────────────────────────────────────────────────────

export class Btc5MinBot {
  private running    = false;
  private intervalId: NodeJS.Timeout | null = null;
  private readonly cycleMs: number;

  // Window tracking
  private currentWindowMarketId: string | null = null;
  private currentPositionId: string | null = null;
  private currentSide: 'YES' | 'NO' | null = null;
  private windowTradeCount  = 0;
  private windowAiDecisionId: bigint | null = null;
  private lastKnownYesPrice = 0.5;
  private lastKnownNoPrice  = 0.5;

  // Stats for current session
  private sessionTrades = 0;
  private sessionPnl    = 0;

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

    // Run first cycle immediately, then on interval
    void this.runCycle();
    this.intervalId = setInterval(() => void this.runCycle(), this.cycleMs);
    this.intervalId.unref();
  }

  stop(): void {
    if (!this.running) return;
    this.running = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

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
        await redis.setex(
          SIGNALS_REDIS_KEY,
          SIGNALS_TTL_SEC,
          JSON.stringify(signals),
        );
      }

      // 3. Find active BTC 5-min market
      const market = await findActiveBtcMarket();

      if (!market) {
        // No market — close any leftover position from a vanished window
        if (this.currentPositionId) {
          logger.info('Btc5MinBot: market disappeared, closing leftover position');
          await this.closeCurrentPosition('window-expired-no-market');
        }
        this.resetWindowState();
        await this.cacheStatus(signals, null);
        logger.debug('Btc5MinBot: no active BTC 5-min market found');
        return;
      }

      // 4. If new window (different market_id): handle window transition
      if (market.id !== this.currentWindowMarketId) {
        await this.onNewWindow(market, signals);
      }

      // 5. Update market prices
      this.lastKnownYesPrice = market.yesPrice;
      this.lastKnownNoPrice  = market.noPrice;

      // 6. Check if window about to expire (<30s) — close positions for safety
      if (market.endDate) {
        const msRemaining = market.endDate.getTime() - Date.now();
        if (msRemaining < WINDOW_SAFETY_CLOSE_MS && this.currentPositionId) {
          logger.info('Btc5MinBot: window expiring soon, closing position', {
            msRemaining,
            positionId: this.currentPositionId,
          });
          await this.closeCurrentPosition('window-expiry-safety');
          this.lastAction     = 'SAFETY CLOSE (window expiring)';
          this.lastActionTime = new Date().toISOString();
          await this.cacheStatus(signals, market);
          return;
        }
      }

      // 7. Cannot trade without signals
      if (!signals) {
        await this.cacheStatus(null, market);
        return;
      }

      // 8. Cannot trade without an AI decision for this window
      if (!this.windowAiDecisionId) {
        logger.debug('Btc5MinBot: no AI decision for this window, skipping trade logic');
        await this.cacheStatus(signals, market);
        return;
      }

      // 9. Load risk appetite and bankroll
      const [riskAppetite, bankroll] = await Promise.all([
        systemConfigService.getValue<number>('RISK_APPETITE').then((v) => v ?? 5),
        bankrollService.get(),
      ]);

      const availableBalance = bankroll ? Number(bankroll.active_balance) : 0;
      if (availableBalance <= 0) {
        logger.debug('Btc5MinBot: no available balance, skipping');
        await this.cacheStatus(signals, market);
        return;
      }

      const { ENTRY_THRESHOLD, FLIP_THRESHOLD, EXIT_THRESHOLD, appetiteScale } =
        computeThresholds(riskAppetite);

      const score = signals.direction_score;
      const state = this.getState();

      // 10. State machine decision
      switch (state) {
        case 'flat': {
          if (score > ENTRY_THRESHOLD) {
            // Buy YES (bullish)
            const size = computeTradeSize(availableBalance, signals.confidence, appetiteScale);
            const posId = await this.executeTrade(market, 'YES', size, this.windowAiDecisionId);
            if (posId) {
              this.currentPositionId = posId;
              this.currentSide       = 'YES';
              this.windowTradeCount++;
              this.sessionTrades++;
              this.lastAction     = `BUY YES ($${size.toFixed(2)})`;
              this.lastActionTime = new Date().toISOString();
              logger.info('Btc5MinBot: FLAT -> BUY YES', {
                score, threshold: ENTRY_THRESHOLD, size, positionId: posId,
              });
            }
          } else if (score < -ENTRY_THRESHOLD) {
            // Buy NO (bearish)
            const size = computeTradeSize(availableBalance, signals.confidence, appetiteScale);
            const posId = await this.executeTrade(market, 'NO', size, this.windowAiDecisionId);
            if (posId) {
              this.currentPositionId = posId;
              this.currentSide       = 'NO';
              this.windowTradeCount++;
              this.sessionTrades++;
              this.lastAction     = `BUY NO ($${size.toFixed(2)})`;
              this.lastActionTime = new Date().toISOString();
              logger.info('Btc5MinBot: FLAT -> BUY NO', {
                score, threshold: -ENTRY_THRESHOLD, size, positionId: posId,
              });
            }
          } else {
            this.lastAction = `FLAT (score=${score.toFixed(0)}, need >${ENTRY_THRESHOLD.toFixed(0)})`;
          }
          break;
        }

        case 'long_yes': {
          if (score > EXIT_THRESHOLD) {
            // Still bullish — hold
            this.lastAction = `HOLD YES (score=${score.toFixed(0)})`;
          } else if (score < -FLIP_THRESHOLD) {
            // Signal flipped to bearish — close YES and buy NO
            logger.info('Btc5MinBot: LONG_YES -> FLIP to LONG_NO', {
              score, flipThreshold: -FLIP_THRESHOLD,
            });
            await this.closeCurrentPosition('signal-flip-to-bearish');

            const size = computeTradeSize(availableBalance, signals.confidence, appetiteScale);
            const posId = await this.executeTrade(market, 'NO', size, this.windowAiDecisionId);
            if (posId) {
              this.currentPositionId = posId;
              this.currentSide       = 'NO';
              this.windowTradeCount++;
              this.sessionTrades++;
              this.lastAction     = `FLIP: CLOSE YES -> BUY NO ($${size.toFixed(2)})`;
              this.lastActionTime = new Date().toISOString();
            } else {
              this.lastAction     = 'FLIP: CLOSE YES -> BUY NO FAILED (went flat)';
              this.lastActionTime = new Date().toISOString();
            }
          } else {
            // Neutral — exit to flat
            logger.info('Btc5MinBot: LONG_YES -> FLAT (signal neutral)', {
              score, exitThreshold: EXIT_THRESHOLD,
            });
            await this.closeCurrentPosition('signal-neutral');
            this.lastAction     = `CLOSE YES -> FLAT (score=${score.toFixed(0)})`;
            this.lastActionTime = new Date().toISOString();
          }
          break;
        }

        case 'long_no': {
          if (score < -EXIT_THRESHOLD) {
            // Still bearish — hold
            this.lastAction = `HOLD NO (score=${score.toFixed(0)})`;
          } else if (score > FLIP_THRESHOLD) {
            // Signal flipped to bullish — close NO and buy YES
            logger.info('Btc5MinBot: LONG_NO -> FLIP to LONG_YES', {
              score, flipThreshold: FLIP_THRESHOLD,
            });
            await this.closeCurrentPosition('signal-flip-to-bullish');

            const size = computeTradeSize(availableBalance, signals.confidence, appetiteScale);
            const posId = await this.executeTrade(market, 'YES', size, this.windowAiDecisionId);
            if (posId) {
              this.currentPositionId = posId;
              this.currentSide       = 'YES';
              this.windowTradeCount++;
              this.sessionTrades++;
              this.lastAction     = `FLIP: CLOSE NO -> BUY YES ($${size.toFixed(2)})`;
              this.lastActionTime = new Date().toISOString();
            } else {
              this.lastAction     = 'FLIP: CLOSE NO -> BUY YES FAILED (went flat)';
              this.lastActionTime = new Date().toISOString();
            }
          } else {
            // Neutral — exit to flat
            logger.info('Btc5MinBot: LONG_NO -> FLAT (signal neutral)', {
              score, exitThreshold: -EXIT_THRESHOLD,
            });
            await this.closeCurrentPosition('signal-neutral');
            this.lastAction     = `CLOSE NO -> FLAT (score=${score.toFixed(0)})`;
            this.lastActionTime = new Date().toISOString();
          }
          break;
        }
      }

      // 11. Cache status to Redis
      await this.cacheStatus(signals, market);
    } catch (err) {
      logger.error('Btc5MinBot: cycle error', { error: (err as Error).message });
    }
  }

  // ─── Window transition ────────────────────────────────────────────────────

  private async onNewWindow(
    market: ActiveBtcMarket,
    signals: BtcSignals | null,
  ): Promise<void> {
    logger.info('Btc5MinBot: new window detected', {
      previousMarketId: this.currentWindowMarketId,
      newMarketId:      market.id,
      title:            market.title,
    });

    // Close any leftover position from previous window
    if (this.currentPositionId) {
      logger.info('Btc5MinBot: closing leftover position from previous window', {
        positionId: this.currentPositionId,
        side:       this.currentSide,
      });
      await this.closeCurrentPosition('window-transition');
    }

    // Reset window state
    this.currentWindowMarketId = market.id;
    this.currentPositionId     = null;
    this.currentSide           = null;
    this.windowTradeCount      = 0;
    this.windowAiDecisionId    = null;

    // Make ONE AI call for this window
    if (signals) {
      await this.makeWindowAiCall(market, signals);
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
      const fullMarket = await prisma.market.findUnique({ where: { id: market.id } });
      if (!fullMarket) {
        logger.warn('Btc5MinBot: market disappeared from DB during AI call', {
          marketId: market.id,
        });
        return;
      }

      const direction = aiResponse.bias === 'bearish' ? 'sell' : 'buy';
      const outcomeToken = aiResponse.bias === 'bearish'
        ? market.noTokenId
        : market.yesTokenId;

      const aiRecord = await aiDecisionService.create({
        market_id:         market.id,
        category:          fullMarket.category,
        action:            aiResponse.bias === 'neutral' ? 'hold' : 'trade',
        direction:         direction as 'buy' | 'sell',
        outcome_token:     outcomeToken,
        confidence:        String(Math.max(0.80, aiResponse.confidence).toFixed(4)),
        size_hint:         null,
        fair_value:        String(market.yesPrice.toFixed(4)),
        estimated_edge:    String((Math.abs(signals.direction_score) / 200).toFixed(6)),
        reasoning:         `[Scalper window] ${aiResponse.reasoning}`,
        regime_assessment: `btc-5min-scalper | score=${signals.direction_score.toFixed(0)} | ${signals.trend}`,
        model_used:        'btc-5min-scalper',
        latency_ms:        0,
        tokens_used:       0,
        prompt_version:    PROMPT_VERSION,
        dashboard_text:    userPrompt,
        account_state:     { balance: availableBalance, positions: allPositions.length } as Prisma.InputJsonValue,
      } as Parameters<typeof aiDecisionService.create>[0]);

      this.windowAiDecisionId = aiRecord.id;
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
      const fullMarket = await prisma.market.findUnique({ where: { id: market.id } });
      if (!fullMarket) return;

      const aiRecord = await aiDecisionService.create({
        market_id:         market.id,
        category:          fullMarket.category,
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
          fees:         sizeUsd * 0.002,
          decisionId,
          exitStrategy: 'resolution_only',
        });

        logger.info('Btc5MinBot: trade executed', {
          positionId: position.id,
          marketId:   market.id,
          side,
          sizeUsd,
          entryPrice: Number(order.avg_fill_price ?? price),
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

    this.currentPositionId = null;
    this.currentSide       = null;
  }

  // ─── State helpers ──────────────────────────────────────────────────────────

  private getState(): ScalperState {
    if (!this.currentPositionId || !this.currentSide) return 'flat';
    return this.currentSide === 'YES' ? 'long_yes' : 'long_no';
  }

  private resetWindowState(): void {
    this.currentWindowMarketId = null;
    this.currentPositionId     = null;
    this.currentSide           = null;
    this.windowTradeCount      = 0;
    this.windowAiDecisionId    = null;
  }

  // ─── Redis status cache ─────────────────────────────────────────────────────

  private async cacheStatus(
    signals: BtcSignals | null,
    market: ActiveBtcMarket | null,
  ): Promise<void> {
    try {
      await redis.setex(
        STATUS_REDIS_KEY,
        STATUS_TTL_SEC,
        JSON.stringify({
          signals,
          activeMarket: market
            ? {
                id:       market.id,
                title:    market.title,
                endDate:  market.endDate,
                yesPrice: market.yesPrice,
                noPrice:  market.noPrice,
              }
            : null,
          state:            this.getState(),
          currentPositionId: this.currentPositionId,
          windowTradeCount: this.windowTradeCount,
          sessionTrades:    this.sessionTrades,
          sessionPnl:       this.sessionPnl,
          lastAction:       this.lastAction,
          lastActionTime:   this.lastActionTime,
        }),
      );
    } catch (err) {
      logger.warn('Btc5MinBot: failed to cache status', {
        error: (err as Error).message,
      });
    }
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
