import { formatDistanceToNow } from 'date-fns'
import { Bitcoin, TrendingUp, TrendingDown, Activity, Play, Square, AlertTriangle, Clock } from 'lucide-react'
import { toast } from 'sonner'
import {
  useBtcBotStatus,
  useStartBtcBot,
  useStopBtcBot,
  type BtcBotSignals,
} from '@/hooks/useBtcBot'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number, decimals = 2): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
}

function fmtPrice(n: number): string {
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}

function winRate(wins: number, total: number): string {
  if (total === 0) return '0.0'
  return ((wins / total) * 100).toFixed(1)
}

// ─── Pulsing active dot ───────────────────────────────────────────────────────

function ActiveDot() {
  return (
    <span className="relative flex h-2.5 w-2.5">
      <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-profit opacity-75" />
      <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-profit" />
    </span>
  )
}

// ─── Momentum bar ─────────────────────────────────────────────────────────────

function MomentumBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.abs(value) * 500) // scale: 0.2 = full bar
  const positive = value >= 0
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className={cn('font-numeric font-medium', positive ? 'text-profit' : 'text-loss')}>
          {positive ? '+' : ''}{fmt(value * 100, 3)}%
        </span>
      </div>
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', positive ? 'bg-profit' : 'bg-loss')}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}

// ─── RSI gauge ────────────────────────────────────────────────────────────────

function RsiGauge({ rsi, signal }: { rsi: number; signal: BtcBotSignals['rsi_signal'] }) {
  const pct = Math.min(100, Math.max(0, rsi))
  const color =
    rsi >= 70 ? 'bg-loss' :
    rsi <= 30 ? 'bg-profit' :
    'bg-info'

  const signalColor =
    signal === 'overbought' ? 'text-loss' :
    signal === 'oversold' ? 'text-profit' :
    'text-muted-foreground'

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">RSI</span>
        <div className="flex items-center gap-2">
          <span className={cn('font-numeric font-medium text-slate-200')}>{fmt(rsi, 1)}</span>
          <span className={cn('capitalize', signalColor)}>{signal}</span>
        </div>
      </div>
      {/* Bar with zone markers */}
      <div className="relative h-3 bg-surface-2 rounded-full overflow-hidden">
        {/* Oversold zone */}
        <div className="absolute left-0 top-0 h-full bg-profit/20" style={{ width: '30%' }} />
        {/* Overbought zone */}
        <div className="absolute right-0 top-0 h-full bg-loss/20" style={{ width: '30%' }} />
        {/* RSI indicator */}
        <div
          className={cn('absolute top-0 h-full w-1.5 rounded-full transition-all', color)}
          style={{ left: `calc(${pct}% - 3px)` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span>0 — Oversold</span>
        <span>50</span>
        <span>Overbought — 100</span>
      </div>
    </div>
  )
}

// ─── Direction score display ──────────────────────────────────────────────────

function DirectionScoreDisplay({ score }: { score: number }) {
  const abs = Math.abs(score)
  const positive = score >= 0
  const color =
    abs >= 60 ? (positive ? 'text-profit' : 'text-loss') :
    abs >= 30 ? 'text-warning' :
    'text-muted-foreground'

  const barPct = Math.min(100, (abs / 100) * 100)

  return (
    <div className="flex flex-col items-center gap-2">
      <div className={cn('text-5xl font-numeric font-bold tabular-nums', color)}>
        {positive && score > 0 ? '+' : ''}{fmt(score, 1)}
      </div>
      <div className="w-full space-y-1">
        <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', positive ? 'bg-profit' : 'bg-loss')}
            style={{ width: `${barPct}%` }}
          />
        </div>
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>-100 (Strong NO)</span>
          <span>+100 (Strong YES)</span>
        </div>
      </div>
    </div>
  )
}

// ─── Signal panel ─────────────────────────────────────────────────────────────

function SignalPanel({ signals, active }: { signals: BtcBotSignals | null; active: boolean }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4 space-y-5">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-slate-200">Live Signals</h2>
        </div>
        <div className="flex items-center gap-2">
          {active ? <ActiveDot /> : <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />}
          <span className={cn('text-xs', active ? 'text-profit' : 'text-muted-foreground')}>
            {active ? 'Active' : 'Inactive'}
          </span>
        </div>
      </div>

      {!signals ? (
        <div className="py-6 text-center text-sm text-muted-foreground">
          No signal data yet. Start the bot to begin receiving signals.
        </div>
      ) : (
        <>
          {/* Momentum */}
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Momentum</p>
            <MomentumBar label="1-min" value={signals.momentum_1m} />
            <MomentumBar label="3-min" value={signals.momentum_3m} />
            <MomentumBar label="5-min" value={signals.momentum_5m} />
          </div>

          {/* RSI */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">RSI</p>
            <RsiGauge rsi={signals.rsi} signal={signals.rsi_signal} />
          </div>

          {/* Volume + VWAP row */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-2 rounded-md px-3 py-2.5 space-y-0.5">
              <p className="text-xs text-muted-foreground">Volume</p>
              <div className="flex items-center gap-2">
                <span className="font-numeric font-semibold text-slate-200">
                  {fmt(signals.volume_ratio, 2)}x avg
                </span>
                {signals.volume_surge && (
                  <Badge variant="warning">Surge</Badge>
                )}
              </div>
            </div>
            <div className="bg-surface-2 rounded-md px-3 py-2.5 space-y-0.5">
              <p className="text-xs text-muted-foreground">vs VWAP</p>
              <div className="flex items-center gap-2">
                <span className="font-numeric font-semibold text-slate-200">
                  ${fmtPrice(signals.vwap)}
                </span>
                <Badge variant={signals.price_vs_vwap === 'above' ? 'success' : signals.price_vs_vwap === 'below' ? 'danger' : 'default'}>
                  {signals.price_vs_vwap}
                </Badge>
              </div>
            </div>
          </div>

          {/* Direction score */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Composite Direction Score</p>
            <DirectionScoreDisplay score={signals.direction_score} />
          </div>

          {/* Candles note */}
          <p className="text-xs text-muted-foreground text-right">
            Based on {signals.candle_count} candles
          </p>
        </>
      )}
    </div>
  )
}

// ─── Market panel ─────────────────────────────────────────────────────────────

function MarketPanel({
  botStatus,
}: {
  botStatus: {
    activeMarket: { id: string; title: string; endDate: string; yesPrice: number; noPrice: number } | null
    tradedThisWindow: boolean
    windowsTradedCount: number
  }
}) {
  const { activeMarket, tradedThisWindow, windowsTradedCount } = botStatus

  return (
    <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Bitcoin className="w-4 h-4 text-warning" />
        <h2 className="text-sm font-medium text-slate-200">Active Market</h2>
      </div>

      {!activeMarket ? (
        <div className="py-8 flex flex-col items-center gap-3 text-center">
          <div className="relative">
            <Clock className="w-8 h-8 text-muted-foreground animate-pulse" />
          </div>
          <p className="text-sm text-muted-foreground">Waiting for next 5-min window…</p>
          <p className="text-xs text-muted-foreground">The bot scans for BTC markets every 5 minutes</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-sm text-slate-200 leading-snug">{activeMarket.title}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{activeMarket.id}</p>
          </div>

          {/* YES / NO prices */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-profit/10 border border-profit/20 rounded-md px-3 py-2.5 text-center">
              <p className="text-xs text-profit mb-0.5">YES</p>
              <p className="font-numeric font-bold text-profit text-lg">{(activeMarket.yesPrice * 100).toFixed(1)}¢</p>
            </div>
            <div className="bg-loss/10 border border-loss/20 rounded-md px-3 py-2.5 text-center">
              <p className="text-xs text-loss mb-0.5">NO</p>
              <p className="font-numeric font-bold text-loss text-lg">{(activeMarket.noPrice * 100).toFixed(1)}¢</p>
            </div>
          </div>

          {/* Expiry */}
          <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <Clock className="w-3.5 h-3.5" />
            <span>Resolves {formatDistanceToNow(new Date(activeMarket.endDate), { addSuffix: true })}</span>
          </div>
        </>
      )}

      {/* Trade status */}
      <div className="border-t border-border pt-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Window status</span>
          <Badge variant={tradedThisWindow ? 'success' : 'default'}>
            {tradedThisWindow ? 'Traded this window' : 'Ready to trade'}
          </Badge>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Windows traded</span>
          <span className="font-numeric text-slate-300">{windowsTradedCount}</span>
        </div>
      </div>
    </div>
  )
}

// ─── Last decision card ───────────────────────────────────────────────────────

function LastDecisionCard({
  decision,
}: {
  decision: {
    action: string
    direction?: string
    confidence: number
    reasoning: string
    timestamp: string
  } | null
}) {
  if (!decision) {
    return (
      <div className="bg-surface rounded-lg border border-border p-4">
        <h2 className="text-sm font-medium text-slate-200 mb-3">Last AI Decision</h2>
        <p className="text-sm text-muted-foreground">No decisions made yet.</p>
      </div>
    )
  }

  const confidencePct = Math.round(decision.confidence * 100)
  const actionVariant: 'success' | 'default' | 'info' =
    decision.action === 'trade' ? 'success' : 'default'

  return (
    <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-200">Last AI Decision</h2>
        <span className="text-xs text-muted-foreground">
          {formatDistanceToNow(new Date(decision.timestamp), { addSuffix: true })}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant={actionVariant} className="capitalize">
          {decision.action}
        </Badge>
        {decision.direction && (
          <Badge variant={decision.direction === 'buy' ? 'success' : 'danger'} className="uppercase">
            {decision.direction === 'buy' ? 'YES' : 'NO'}
          </Badge>
        )}
      </div>

      {/* Confidence bar */}
      <div className="space-y-1.5">
        <div className="flex justify-between text-xs">
          <span className="text-muted-foreground">Confidence</span>
          <span className={cn(
            'font-numeric font-medium',
            confidencePct >= 70 ? 'text-profit' :
            confidencePct >= 40 ? 'text-warning' :
            'text-muted-foreground'
          )}>
            {confidencePct}%
          </span>
        </div>
        <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
          <div
            className={cn(
              'h-full rounded-full transition-all',
              confidencePct >= 70 ? 'bg-profit' :
              confidencePct >= 40 ? 'bg-warning' :
              'bg-slate-600'
            )}
            style={{ width: `${confidencePct}%` }}
          />
        </div>
      </div>

      {/* Reasoning */}
      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reasoning</p>
        <p className="text-sm text-slate-300 leading-relaxed">{decision.reasoning}</p>
      </div>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BtcBot() {
  const { data, isLoading } = useBtcBotStatus()
  const startBot = useStartBtcBot()
  const stopBot = useStopBtcBot()

  const active = data?.active ?? false
  const signals = data?.latest_signals ?? null
  const botStatus = data?.bot_status ?? {
    signals: null,
    activeMarket: null,
    tradedThisWindow: false,
    windowsTradedCount: 0,
  }
  const stats = data?.stats ?? { total_trades: 0, wins: 0, losses: 0, pnl: 0 }
  const lastDecision = data?.last_decision ?? null

  const totalTrades = stats.total_trades
  const wr = winRate(stats.wins, totalTrades)

  const handleToggle = () => {
    if (active) {
      stopBot.mutate(undefined, {
        onSuccess: () => toast.success('BTC Bot stopped'),
        onError: () => toast.error('Failed to stop BTC Bot'),
      })
    } else {
      startBot.mutate(undefined, {
        onSuccess: () => toast.success('BTC Bot started'),
        onError: () => toast.error('Failed to start BTC Bot'),
      })
    }
  }

  const isPending = startBot.isPending || stopBot.isPending

  return (
    <div className="space-y-6">
      {/* Header */}
      <PageHeader
        title="BTC 5-Min Bot"
        subtitle="Real-time Bitcoin price direction bot targeting 5-minute resolution markets"
        actions={
          <button
            onClick={handleToggle}
            disabled={isPending || isLoading}
            className={cn(
              'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors disabled:opacity-50',
              active
                ? 'bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25'
                : 'bg-profit/15 text-profit border border-profit/30 hover:bg-profit/25'
            )}
          >
            {active
              ? <Square className="w-4 h-4" />
              : <Play className="w-4 h-4" />}
            {isPending
              ? (active ? 'Stopping…' : 'Starting…')
              : (active ? 'Stop Bot' : 'Start Bot')}
          </button>
        }
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="BTC Price"
          loading={isLoading}
          value={
            signals ? (
              <span className={cn(
                'font-numeric',
                signals.trend === 'up' ? 'text-profit' :
                signals.trend === 'down' ? 'text-loss' :
                'text-slate-100'
              )}>
                ${fmtPrice(signals.current_price)}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
          subValue={
            signals && (
              <span className="flex items-center gap-1">
                {signals.trend === 'up'
                  ? <TrendingUp className="w-3.5 h-3.5 text-profit" />
                  : signals.trend === 'down'
                  ? <TrendingDown className="w-3.5 h-3.5 text-loss" />
                  : null}
                <span className="capitalize">{signals.trend}</span>
              </span>
            )
          }
        />

        <StatCard
          label="Direction Score"
          loading={isLoading}
          value={
            signals ? (
              <span className={cn(
                'font-numeric',
                signals.direction_score > 0 ? 'text-profit' :
                signals.direction_score < 0 ? 'text-loss' :
                'text-slate-100'
              )}>
                {signals.direction_score > 0 ? '+' : ''}{fmt(signals.direction_score, 1)}
              </span>
            ) : (
              <span className="text-muted-foreground">—</span>
            )
          }
          subValue={
            signals ? (
              <span>Suggests <span className={cn(
                'font-medium',
                signals.suggested_side === 'YES' ? 'text-profit' : 'text-loss'
              )}>{signals.suggested_side}</span></span>
            ) : undefined
          }
        />

        <StatCard
          label="Win Rate"
          loading={isLoading}
          value={
            <span className={cn(
              'font-numeric',
              Number(wr) >= 50 ? 'text-profit' : totalTrades === 0 ? 'text-slate-100' : 'text-loss'
            )}>
              {wr}%
            </span>
          }
          subValue={
            <span className="font-numeric">
              {stats.wins}W / {stats.losses}L
            </span>
          }
        />

        <StatCard
          label="Session P&L"
          loading={isLoading}
          value={
            <span className={cn(
              'font-numeric',
              stats.pnl > 0 ? 'text-profit' :
              stats.pnl < 0 ? 'text-loss' :
              'text-slate-100'
            )}>
              {stats.pnl >= 0 ? '+' : ''}${fmt(stats.pnl)}
            </span>
          }
          subValue={<span className="font-numeric">{totalTrades} trade{totalTrades !== 1 ? 's' : ''}</span>}
        />
      </div>

      {/* Bot inactive warning */}
      {!active && !isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Bot is stopped. Signals shown are the last recorded values. Start the bot to resume live trading.</span>
        </div>
      )}

      {/* Signal + Market panels */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <SignalPanel signals={signals} active={active} />
        </div>
        <div className="lg:col-span-2">
          <MarketPanel botStatus={botStatus} />
        </div>
      </div>

      {/* Last decision */}
      <LastDecisionCard decision={lastDecision} />
    </div>
  )
}
