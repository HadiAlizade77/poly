import { useEffect, useRef, useState, useCallback } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  Bitcoin,
  TrendingUp,
  TrendingDown,
  Activity,
  Play,
  Square,
  AlertTriangle,
  Clock,
  ArrowUpCircle,
  ArrowDownCircle,
  Info,
  Zap,
  X,
  Shield,
} from 'lucide-react'
import { toast } from 'sonner'
import {
  useBtcBotStatus,
  useBtcBotLogs,
  useBtcBotTrades,
  useStartBtcBot,
  useStopBtcBot,
  type BtcBotSignals,
  type BtcBotLogEntry,
  type BtcBotLogType,
  type BtcBotBotStatus,
  type BtcBotStatusData,
  type BtcBotWsStatusPayload,
  btcBotKeys,
} from '@/hooks/useBtcBot'
import { useSocket } from '@/hooks/useSocket'
import { useRiskAppetite } from '@/hooks/useRiskConfig'
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

function fmtTime(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
}

function fmtTimeShort(iso: string): string {
  const d = new Date(iso)
  return d.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit', hour12: false })
}

/** Parse a Decimal string or number from Prisma safely into a JS number */
function parseDecimal(v: string | number | null | undefined): number {
  if (v == null) return 0
  return typeof v === 'string' ? parseFloat(v) : v
}

/** Format MM:SS countdown from a future ISO date. Returns null if past. */
function useCountdown(isoDate: string | null | undefined): string | null {
  const [display, setDisplay] = useState<string | null>(null)

  useEffect(() => {
    if (!isoDate) { setDisplay(null); return }

    function update() {
      const diff = new Date(isoDate!).getTime() - Date.now()
      if (diff <= 0) { setDisplay('00:00'); return }
      const m = Math.floor(diff / 60_000)
      const s = Math.floor((diff % 60_000) / 1_000)
      setDisplay(`${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`)
    }
    update()
    const id = setInterval(update, 1_000)
    return () => clearInterval(id)
  }, [isoDate])

  return display
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

// ─── Log type icon ────────────────────────────────────────────────────────────

function LogIcon({ type }: { type: BtcBotLogType }) {
  switch (type) {
    case 'buy':
      return <ArrowUpCircle className="w-3.5 h-3.5 text-profit shrink-0" />
    case 'sell':
      return <ArrowDownCircle className="w-3.5 h-3.5 text-loss shrink-0" />
    case 'signal':
      return <Zap className="w-3.5 h-3.5 text-info shrink-0" />
    case 'error':
      return <X className="w-3.5 h-3.5 text-loss shrink-0" />
    case 'close':
    case 'flip':
      return <Activity className="w-3.5 h-3.5 text-warning shrink-0" />
    default:
      return <Info className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
  }
}

function logTextColor(type: BtcBotLogType): string {
  switch (type) {
    case 'buy': return 'text-profit'
    case 'sell': return 'text-loss'
    case 'signal': return 'text-info'
    case 'error': return 'text-loss'
    case 'close':
    case 'flip': return 'text-warning'
    default: return 'text-slate-300'
  }
}

// ─── Momentum bar ─────────────────────────────────────────────────────────────

function MomentumBar({ label, value }: { label: string; value: number }) {
  const pct = Math.min(100, Math.abs(value) * 500)
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
          <span className="font-numeric font-medium text-slate-200">{fmt(rsi, 1)}</span>
          <span className={cn('capitalize', signalColor)}>{signal}</span>
        </div>
      </div>
      <div className="relative h-3 bg-surface-2 rounded-full overflow-hidden">
        <div className="absolute left-0 top-0 h-full bg-profit/20" style={{ width: '30%' }} />
        <div className="absolute right-0 top-0 h-full bg-loss/20" style={{ width: '30%' }} />
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
          <span>-100 (Strong Down)</span>
          <span>+100 (Strong Up)</span>
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
          <div className="space-y-3">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Momentum</p>
            <MomentumBar label="1-min" value={signals.momentum_1m} />
            <MomentumBar label="3-min" value={signals.momentum_3m} />
            <MomentumBar label="5-min" value={signals.momentum_5m} />
          </div>

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">RSI</p>
            <RsiGauge rsi={signals.rsi} signal={signals.rsi_signal} />
          </div>

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

          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Composite Direction Score</p>
            <DirectionScoreDisplay score={signals.direction_score} />
          </div>

          <p className="text-xs text-muted-foreground text-right">
            Based on {signals.candle_count} candles
          </p>
        </>
      )}
    </div>
  )
}

// ─── Active market panel with live countdown ──────────────────────────────────

function MarketPanel({ botStatus }: { botStatus: BtcBotBotStatus }) {
  const { activeMarket, windowTradeCount } = botStatus
  const countdown = useCountdown(activeMarket?.endDate)

  const yesPrice = activeMarket?.yesPrice ?? 0
  const noPrice = activeMarket?.noPrice ?? 0

  // Use refs for previous prices to avoid stale closure issues in effects.
  const prevYesRef = useRef<number>(yesPrice)
  const prevNoRef = useRef<number>(noPrice)
  const yesTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const noTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [yesFlash, setYesFlash] = useState<'up' | 'down' | null>(null)
  const [noFlash, setNoFlash] = useState<'up' | 'down' | null>(null)
  const [yesDir, setYesDir] = useState<'up' | 'down' | null>(null)
  const [noDir, setNoDir] = useState<'up' | 'down' | null>(null)

  useEffect(() => {
    const prev = prevYesRef.current
    if (yesPrice !== 0 && prev !== 0 && yesPrice !== prev) {
      const dir = yesPrice > prev ? 'up' : 'down'
      if (yesTimerRef.current) clearTimeout(yesTimerRef.current)
      setYesFlash(dir)
      setYesDir(dir)
      yesTimerRef.current = setTimeout(() => setYesFlash(null), 600)
    }
    prevYesRef.current = yesPrice
    return () => { if (yesTimerRef.current) clearTimeout(yesTimerRef.current) }
  }, [yesPrice])

  useEffect(() => {
    const prev = prevNoRef.current
    if (noPrice !== 0 && prev !== 0 && noPrice !== prev) {
      const dir = noPrice > prev ? 'up' : 'down'
      if (noTimerRef.current) clearTimeout(noTimerRef.current)
      setNoFlash(dir)
      setNoDir(dir)
      noTimerRef.current = setTimeout(() => setNoFlash(null), 600)
    }
    prevNoRef.current = noPrice
    return () => { if (noTimerRef.current) clearTimeout(noTimerRef.current) }
  }, [noPrice])

  const countdownColor =
    countdown && countdown !== '00:00'
      ? parseInt(countdown.split(':')[0]) === 0 && parseInt(countdown.split(':')[1]) <= 30
        ? 'text-loss'
        : parseInt(countdown.split(':')[1]) <= 90 && parseInt(countdown.split(':')[0]) === 0
        ? 'text-warning'
        : 'text-profit'
      : 'text-muted-foreground'

  return (
    <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Bitcoin className="w-4 h-4 text-warning" />
        <h2 className="text-sm font-medium text-slate-200">Active Market</h2>
      </div>

      {!activeMarket ? (
        <div className="py-8 flex flex-col items-center gap-3 text-center">
          <Clock className="w-8 h-8 text-muted-foreground animate-pulse" />
          <p className="text-sm text-muted-foreground">Waiting for next 5-min window…</p>
          <p className="text-xs text-muted-foreground">The bot scans for BTC markets every 5 minutes</p>
        </div>
      ) : (
        <>
          <div className="space-y-2">
            <p className="text-sm text-slate-200 leading-snug">{activeMarket.title}</p>
            <p className="text-xs text-muted-foreground font-mono truncate">{activeMarket.id}</p>
          </div>

          {/* Countdown timer — prominent */}
          <div className="flex items-center justify-between bg-surface-2 rounded-md px-3 py-2.5">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <Clock className="w-3.5 h-3.5" />
              <span>Window closes in</span>
            </div>
            <span className={cn('font-numeric font-bold text-xl tabular-nums', countdownColor)}>
              {countdown ?? '--:--'}
            </span>
          </div>

          {/* Up / Down prices with flash animation and direction arrows */}
          <div className="grid grid-cols-2 gap-3">
            <div className={cn(
              'border rounded-md px-3 py-2.5 text-center transition-colors duration-300',
              yesFlash === 'up'
                ? 'bg-profit/30 border-profit/50'
                : yesFlash === 'down'
                ? 'bg-red-500/20 border-red-500/40'
                : 'bg-profit/10 border-profit/20',
            )}>
              <p className="text-xs text-profit mb-0.5">Up</p>
              <div className="flex items-center justify-center gap-1">
                {yesDir === 'up' && <TrendingUp className="w-3.5 h-3.5 text-profit shrink-0" />}
                {yesDir === 'down' && <TrendingDown className="w-3.5 h-3.5 text-loss shrink-0" />}
                <p className="font-numeric font-bold text-profit text-lg tabular-nums">
                  {(activeMarket.yesPrice * 100).toFixed(1)}¢
                </p>
              </div>
            </div>
            <div className={cn(
              'border rounded-md px-3 py-2.5 text-center transition-colors duration-300',
              noFlash === 'up'
                ? 'bg-profit/20 border-profit/40'
                : noFlash === 'down'
                ? 'bg-red-500/30 border-red-500/50'
                : 'bg-loss/10 border-loss/20',
            )}>
              <p className="text-xs text-loss mb-0.5">Down</p>
              <div className="flex items-center justify-center gap-1">
                {noDir === 'up' && <TrendingUp className="w-3.5 h-3.5 text-profit shrink-0" />}
                {noDir === 'down' && <TrendingDown className="w-3.5 h-3.5 text-loss shrink-0" />}
                <p className="font-numeric font-bold text-loss text-lg tabular-nums">
                  {(activeMarket.noPrice * 100).toFixed(1)}¢
                </p>
              </div>
            </div>
          </div>

          {/* priceToBeat if present */}
          {'priceToBeat' in activeMarket && (activeMarket as Record<string, unknown>).priceToBeat != null && (
            <div className="flex items-center justify-between text-xs bg-surface-2 rounded-md px-3 py-2">
              <span className="text-muted-foreground">Price to beat</span>
              <span className="font-numeric font-semibold text-warning">
                ${fmtPrice((activeMarket as Record<string, unknown>).priceToBeat as number)}
              </span>
            </div>
          )}
        </>
      )}

      {/* Trade status footer */}
      <div className="border-t border-border pt-3 space-y-2">
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Window trades</span>
          <Badge variant={windowTradeCount > 0 ? 'success' : 'default'}>
            {windowTradeCount > 0 ? `${windowTradeCount} traded` : 'Ready to trade'}
          </Badge>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Session trades</span>
          <span className="font-numeric text-slate-300">{botStatus.sessionTrades ?? 0}</span>
        </div>
        <div className="flex items-center justify-between text-xs">
          <span className="text-muted-foreground">Session P&L</span>
          <span className={cn(
            'font-numeric font-medium',
            (botStatus.sessionPnl ?? 0) > 0 ? 'text-profit' :
            (botStatus.sessionPnl ?? 0) < 0 ? 'text-loss' :
            'text-slate-300'
          )}>
            {(botStatus.sessionPnl ?? 0) >= 0 ? '+' : ''}${fmt(botStatus.sessionPnl ?? 0)}
          </span>
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
    confidence: number | string
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

  const confNum = parseDecimal(decision.confidence)
  const confidencePct = Math.round(confNum * 100)
  const actionVariant: 'success' | 'default' | 'info' =
    decision.action === 'trade' ? 'success' : 'default'

  return (
    <div className="bg-surface rounded-lg border border-border p-4 space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-medium text-slate-200">Last AI Decision</h2>
        <span className="text-xs text-muted-foreground font-numeric">
          {fmtTime(decision.timestamp)}
        </span>
      </div>

      <div className="flex flex-wrap gap-2">
        <Badge variant={actionVariant} className="capitalize">
          {decision.action}
        </Badge>
        {decision.direction && (
          <Badge variant={decision.direction === 'buy' ? 'success' : 'danger'} className="uppercase">
            {decision.direction === 'buy' ? 'Up' : 'Down'}
          </Badge>
        )}
      </div>

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

      <div className="space-y-1.5">
        <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Reasoning</p>
        <p className="text-sm text-slate-300 leading-relaxed">{decision.reasoning}</p>
      </div>
    </div>
  )
}

// ─── Activity log panel ───────────────────────────────────────────────────────

function ActivityLog({ active }: { active: boolean }) {
  const { data, isLoading } = useBtcBotLogs()
  const scrollRef = useRef<HTMLDivElement>(null)
  const logs: BtcBotLogEntry[] = data?.log ?? []

  // Auto-scroll to bottom (newest entry) whenever log updates
  useEffect(() => {
    const el = scrollRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [logs.length])

  return (
    <div className="bg-surface rounded-lg border border-border flex flex-col" style={{ minHeight: '320px', maxHeight: '420px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Activity className="w-4 h-4 text-muted-foreground" />
          <h2 className="text-sm font-medium text-slate-200">Activity Log</h2>
          {data?.count != null && (
            <span className="text-xs text-muted-foreground">({data.count})</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {active ? <ActiveDot /> : <span className="w-2.5 h-2.5 rounded-full bg-slate-600" />}
          <span className={cn('text-xs', active ? 'text-profit' : 'text-muted-foreground')}>
            {active ? 'Live' : 'Stopped'}
          </span>
        </div>
      </div>

      {/* Scrollable log body */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 space-y-0.5">
        {isLoading ? (
          <div className="py-8 flex justify-center">
            <div className="w-5 h-5 border-2 border-profit/40 border-t-profit rounded-full animate-spin" />
          </div>
        ) : logs.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No activity yet. Start the bot to see logs.
          </div>
        ) : (
          logs.map((entry) => (
            <div
              key={entry.id}
              className="flex items-start gap-2 py-1.5 px-2 rounded hover:bg-surface-2 transition-colors group"
            >
              <LogIcon type={entry.type} />
              <span className="font-numeric text-xs text-muted-foreground shrink-0 pt-px">
                {fmtTime(entry.timestamp)}
              </span>
              <span className={cn('text-xs leading-relaxed', logTextColor(entry.type))}>
                {entry.message}
              </span>
            </div>
          ))
        )}
      </div>
    </div>
  )
}

// ─── Trade history panel ───────────────────────────────────────────────────────

function TradeHistory() {
  const { data, isLoading } = useBtcBotTrades()
  const trades = data?.trades ?? []
  const decisions = data?.ai_decisions ?? []

  // Session totals derived from trades
  const sessionPnl = trades.reduce((sum, t) => sum + (t.pnl ?? 0), 0)
  const wins = trades.filter((t) => (t.pnl ?? 0) > 0).length
  const losses = trades.filter((t) => (t.pnl ?? 0) < 0).length

  return (
    <div className="bg-surface rounded-lg border border-border flex flex-col" style={{ minHeight: '320px', maxHeight: '420px' }}>
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border shrink-0">
        <div className="flex items-center gap-2">
          <Bitcoin className="w-4 h-4 text-warning" />
          <h2 className="text-sm font-medium text-slate-200">Trade History</h2>
        </div>
        <span className="text-xs text-muted-foreground">{trades.length} trades</span>
      </div>

      {/* Table */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="py-8 flex justify-center">
            <div className="w-5 h-5 border-2 border-profit/40 border-t-profit rounded-full animate-spin" />
          </div>
        ) : trades.length === 0 ? (
          <div className="py-8 text-center text-sm text-muted-foreground">
            No trades executed yet this session.
          </div>
        ) : (
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Time</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">Side</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Price</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">Size</th>
                <th className="text-right px-3 py-2 text-muted-foreground font-medium">P&L</th>
                <th className="text-left px-3 py-2 text-muted-foreground font-medium">AI Reasoning</th>
              </tr>
            </thead>
            <tbody>
              {trades.map((trade, i) => {
                const pnl = trade.pnl ?? null
                const pnlNum = pnl != null ? parseDecimal(pnl) : null
                const confNum = trade.confidence != null ? parseDecimal(trade.confidence) : null
                // Normalize side label — backend may send YES/NO token IDs or buy/sell strings
                const sideLabel =
                  trade.order_side === 'buy' ? 'Up' :
                  trade.order_side === 'sell' ? 'Down' :
                  trade.side?.toUpperCase() ?? '—'
                const sideVariant: 'success' | 'danger' =
                  (trade.order_side === 'buy' || trade.side?.toLowerCase().includes('yes')) ? 'success' : 'danger'

                return (
                  <tr key={i} className="border-b border-border/50 hover:bg-surface-2 transition-colors">
                    <td className="px-3 py-2 font-numeric text-slate-400">
                      {fmtTimeShort(trade.timestamp)}
                    </td>
                    <td className="px-3 py-2">
                      <Badge variant={sideVariant}>{sideLabel}</Badge>
                    </td>
                    <td className="px-3 py-2 text-right font-numeric text-slate-200">
                      ${fmtPrice(trade.price)}
                    </td>
                    <td className="px-3 py-2 text-right font-numeric text-slate-200">
                      ${fmt(trade.size)}
                    </td>
                    <td className={cn(
                      'px-3 py-2 text-right font-numeric font-medium',
                      pnlNum == null ? 'text-muted-foreground' :
                      pnlNum > 0 ? 'text-profit' :
                      pnlNum < 0 ? 'text-loss' :
                      'text-slate-400'
                    )}>
                      {pnlNum == null
                        ? '—'
                        : `${pnlNum >= 0 ? '+' : ''}$${fmt(pnlNum)}`}
                    </td>
                    <td className="px-3 py-2 text-slate-400 max-w-[180px]">
                      {confNum != null && (
                        <span className="font-numeric text-muted-foreground mr-1.5">
                          {Math.round(confNum * 100)}%
                        </span>
                      )}
                      <span className="truncate block" title={trade.ai_reasoning ?? ''}>
                        {trade.ai_reasoning
                          ? trade.ai_reasoning.slice(0, 60) + (trade.ai_reasoning.length > 60 ? '…' : '')
                          : '—'}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        )}
      </div>

      {/* Session totals footer */}
      {trades.length > 0 && (
        <div className="border-t border-border px-4 py-2.5 shrink-0 flex items-center justify-between gap-6 text-xs">
          <div className="flex items-center gap-4">
            <span className="text-muted-foreground">Session totals</span>
            <span className="text-profit font-numeric">{wins}W</span>
            <span className="text-loss font-numeric">{losses}L</span>
            <span className="text-muted-foreground font-numeric">
              {trades.length > 0 ? ((wins / trades.length) * 100).toFixed(0) : 0}% WR
            </span>
          </div>
          <span className={cn(
            'font-numeric font-semibold',
            sessionPnl > 0 ? 'text-profit' :
            sessionPnl < 0 ? 'text-loss' :
            'text-slate-400'
          )}>
            {sessionPnl >= 0 ? '+' : ''}${fmt(sessionPnl)} P&L
          </span>
        </div>
      )}

      {/* AI decisions sub-section when no executed trades but decisions exist */}
      {trades.length === 0 && decisions.length > 0 && (
        <div className="border-t border-border px-4 py-3 text-xs text-muted-foreground">
          {decisions.length} AI decision{decisions.length !== 1 ? 's' : ''} logged (no executed trades yet)
        </div>
      )}
    </div>
  )
}

// ─── BTC price stat card with flash on change ─────────────────────────────────

function BtcPriceValue({ price, trend }: { price: number | null; trend: BtcBotSignals['trend'] | null }) {
  // Use a ref for the previous price so comparisons are always against the
  // latest committed value and we never hit stale closure issues.
  const prevPriceRef = useRef<number>(price ?? 0)
  const [flash, setFlash] = useState<'up' | 'down' | null>(null)
  const flashTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    if (price == null) return
    const prev = prevPriceRef.current
    if (prev !== 0 && price !== prev) {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
      setFlash(price > prev ? 'up' : 'down')
      flashTimerRef.current = setTimeout(() => setFlash(null), 600)
    }
    prevPriceRef.current = price
    return () => {
      if (flashTimerRef.current) clearTimeout(flashTimerRef.current)
    }
  }, [price])

  if (price == null) return <span className="text-muted-foreground">—</span>

  return (
    <span className={cn(
      'font-numeric inline-flex items-center gap-1 rounded px-1 transition-colors duration-300',
      flash === 'up' ? 'bg-profit/20' : flash === 'down' ? 'bg-red-500/20' : '',
      trend === 'up' ? 'text-profit' : trend === 'down' ? 'text-loss' : 'text-slate-100',
    )}>
      {flash === 'up' && <TrendingUp className="w-3.5 h-3.5" />}
      {flash === 'down' && <TrendingDown className="w-3.5 h-3.5" />}
      ${fmtPrice(price)}
    </span>
  )
}

// ─── Risk appetite badge ──────────────────────────────────────────────────────

function riskLabel(level: number): string {
  if (level <= 3) return 'Conservative'
  if (level <= 6) return 'Balanced'
  if (level <= 9) return 'Aggressive'
  return 'Maximum'
}

function riskColor(level: number): string {
  if (level <= 3) return 'text-profit'
  if (level <= 6) return 'text-warning'
  if (level <= 9) return 'text-orange-400'
  return 'text-loss'
}

function riskBorderColor(level: number): string {
  if (level <= 3) return 'border-profit/30 bg-profit/5'
  if (level <= 6) return 'border-warning/30 bg-warning/5'
  if (level <= 9) return 'border-orange-400/30 bg-orange-400/5'
  return 'border-loss/30 bg-loss/5'
}

function RiskAppetiteBadge({ appetite }: { appetite: number }) {
  const filled = Math.round(appetite)
  const color = riskColor(appetite)
  const borderColor = riskBorderColor(appetite)

  return (
    <div className={cn('flex items-center gap-2 px-3 py-1.5 rounded-md border text-xs', borderColor)}>
      <Shield className={cn('w-3.5 h-3.5 shrink-0', color)} />
      <span className="text-muted-foreground">Risk:</span>
      <span className={cn('font-numeric font-semibold', color)}>{filled}/10</span>
      <span className="font-mono tracking-tight">
        {Array.from({ length: 10 }, (_, i) => (
          <span key={i} className={i < filled ? color : 'text-surface-2'}>
            {i < filled ? '█' : '░'}
          </span>
        ))}
      </span>
      <span className={cn('font-medium', color)}>{riskLabel(appetite)}</span>
    </div>
  )
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function BtcBot() {
  const queryClient = useQueryClient()
  const { on } = useSocket()
  const { data, isLoading } = useBtcBotStatus()
  const startBot = useStartBtcBot()
  const stopBot = useStopBtcBot()
  const { data: appetite } = useRiskAppetite()

  // Subscribe to real-time WebSocket updates.
  // The btc-bot:status WS event fires every 10 seconds with the bot's internal
  // state. Its shape differs from the REST response: it has `signals` (not
  // `latest_signals`) and the bot_status fields at the top level. We must
  // re-map them to match BtcBotStatusData so cached query data stays coherent.
  useEffect(() => {
    const off = on<BtcBotWsStatusPayload>('btc-bot:status', (ws) => {
      // eslint-disable-next-line no-console
      console.log('[BTC-WS] Up=' + ws.activeMarket?.yesPrice + ' Down=' + ws.activeMarket?.noPrice)
      queryClient.setQueryData(btcBotKeys.status, (old: BtcBotStatusData | undefined): BtcBotStatusData => {
        const botStatus: BtcBotBotStatus = {
          signals: ws.signals ?? old?.bot_status?.signals ?? null,
          activeMarket: ws.activeMarket,
          state: ws.state,
          currentPositionId: old?.bot_status?.currentPositionId ?? null,
          windowTradeCount: ws.windowTradeCount,
          sessionTrades: ws.sessionTrades,
          sessionPnl: ws.sessionPnl,
          lastAction: ws.lastAction,
          lastActionTime: ws.lastActionTime,
        }
        return {
          active: old?.active ?? true,
          latest_signals: ws.signals ?? old?.latest_signals ?? null,
          bot_status: botStatus,
          stats: old?.stats ?? { total_trades: 0, wins: 0, losses: 0, pnl: 0 },
          last_decision: old?.last_decision ?? null,
        }
      })
    })
    return off
  }, [on, queryClient])

  const active = data?.active ?? false
  const signals = data?.latest_signals ?? null
  const botStatus = data?.bot_status ?? {
    signals: null,
    activeMarket: null,
    state: 'flat' as const,
    currentPositionId: null,
    windowTradeCount: 0,
    sessionTrades: 0,
    sessionPnl: 0,
    lastAction: null,
    lastActionTime: null,
  }
  const stats = data?.stats ?? { total_trades: 0, wins: 0, losses: 0, pnl: 0 }
  const lastDecision = data?.last_decision ?? null

  const totalTrades = stats.total_trades
  const wr = winRate(stats.wins, totalTrades)

  const handleToggle = useCallback(() => {
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
  }, [active, startBot, stopBot])

  const isPending = startBot.isPending || stopBot.isPending

  return (
    <div className="space-y-6">
      {/* ── Header ── */}
      <PageHeader
        title="BTC 5-Min Bot"
        subtitle="Real-time Bitcoin price direction bot targeting 5-minute resolution markets"
        actions={
          <div className="flex items-center gap-3">
            {appetite != null && <RiskAppetiteBadge appetite={appetite} />}
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
              {active ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
              {isPending
                ? (active ? 'Stopping…' : 'Starting…')
                : (active ? 'Stop Bot' : 'Start Bot')}
            </button>
          </div>
        }
      />

      {/* ── Row 1: Stat cards ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="BTC Price"
          loading={isLoading}
          value={
            <BtcPriceValue
              price={signals?.current_price ?? null}
              trend={signals?.trend ?? null}
            />
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
              )}>{signals.suggested_side === 'YES' ? 'Up' : 'Down'}</span></span>
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

      {/* ── Bot inactive warning ── */}
      {!active && !isLoading && (
        <div className="flex items-center gap-2 rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 text-sm text-warning">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          <span>Bot is stopped. Signals shown are the last recorded values. Start the bot to resume live trading.</span>
        </div>
      )}

      {/* ── Row 2: Signal panel + Active market ── */}
      <div className="grid grid-cols-1 lg:grid-cols-5 gap-4">
        <div className="lg:col-span-3">
          <SignalPanel signals={signals} active={active} />
        </div>
        <div className="lg:col-span-2">
          <MarketPanel botStatus={botStatus} />
        </div>
      </div>

      {/* ── Last AI decision ── */}
      <LastDecisionCard decision={lastDecision} />

      {/* ── Row 3: Activity log + Trade history ── */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <ActivityLog active={active} />
        <TradeHistory />
      </div>
    </div>
  )
}
