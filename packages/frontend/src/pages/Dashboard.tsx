import { formatDistanceToNow } from 'date-fns'
import { useState } from 'react'
import {
  AlertTriangle, TrendingUp, Activity, Brain,
  Zap, Info, ChevronDown, ChevronRight,
  ShoppingCart, Wallet, Shield,
} from 'lucide-react'
import { useAppStore, type TradingState } from '@/stores/app.store'
import { useTradingState } from '@/hooks/useTradingState'
import { useBankroll } from '@/hooks/useBankroll'
import { useDecisions } from '@/hooks/useDecisions'
import { useAlerts } from '@/hooks/useAlerts'
import { usePositions } from '@/hooks/usePositions'
import { useHealth } from '@/hooks/useSystemConfig'
import { useSystemHealth } from '@/hooks/useSystemHealth'
import { useCredentials } from '@/hooks/useSettingsCredentials'
import { StatCard } from '@/components/ui/StatCard'
import { PnlDisplay } from '@/components/ui/PnlDisplay'
import { Badge } from '@/components/ui/Badge'
import { SeverityBadge } from '@/components/ui/StatusBadge'
import { cn } from '@/lib/utils'
import type { AIDecision, Alert } from '@polymarket/shared'
import { GettingStarted } from '@/components/onboarding/GettingStarted'

// ─── Engine status panel ───────────────────────────────────────────────────────

const PIPELINE_STEPS = [
  { icon: TrendingUp,   text: 'Scanner discovers active markets from Polymarket',       timing: 'every 60s'   },
  { icon: Activity,     text: 'Context scorers assess market conditions per category',   timing: 'continuous'  },
  { icon: Brain,        text: 'AI analyzes each market and decides trade or hold',        timing: 'every 5 min' },
  { icon: Shield,       text: 'Risk governor approves, reduces, or vetoes trades',        timing: 'per decision'},
  { icon: ShoppingCart, text: 'Executor places approved orders on Polymarket',            timing: 'immediate'   },
  { icon: Wallet,       text: 'Exit monitor manages open positions automatically',        timing: 'every 30s'   },
]

const ENGINE_PROCESSES = [
  { name: 'market-scanner',    label: 'Market Scanner',     desc: 'Fetches markets every 60s'   },
  { name: 'decision-engine',   label: 'AI Decision Engine', desc: 'Evaluates markets every 5min'},
  { name: 'execution-manager', label: 'Trade Executor',     desc: 'Places orders & monitors exits'},
]

function statusDotClass(status: string) {
  return cn(
    'w-2 h-2 rounded-full shrink-0',
    status === 'running' ? 'bg-profit' :
    status === 'errored' ? 'bg-loss animate-pulse' :
    'bg-slate-600'
  )
}

function HowItWorks() {
  const [expanded, setExpanded] = useState(false)

  return (
    <div>
      <button
        onClick={() => setExpanded(v => !v)}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-slate-300 transition-colors"
      >
        {expanded
          ? <ChevronDown className="w-3.5 h-3.5" />
          : <ChevronRight className="w-3.5 h-3.5" />}
        How the automated pipeline works
      </button>
      {expanded && (
        <div className="mt-3 space-y-2 pl-1">
          {PIPELINE_STEPS.map((step, i) => (
            <div key={i} className="flex items-center gap-3">
              <div className="flex items-center justify-center w-5 h-5 rounded-full bg-surface-2 shrink-0">
                <span className="text-xs font-numeric text-muted-foreground">{i + 1}</span>
              </div>
              <step.icon className="w-4 h-4 text-muted-foreground shrink-0" />
              <span className="text-xs text-slate-300 flex-1">{step.text}</span>
              <span className="text-xs text-muted-foreground shrink-0">{step.timing}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

const TRADING_STATE_BADGE: Record<TradingState, { variant: 'success' | 'danger' | 'warning' | 'default'; label: string }> = {
  running:       { variant: 'success', label: 'RUNNING' },
  stopped:       { variant: 'danger',  label: 'STOPPED' },
  paused_all:    { variant: 'warning', label: 'PAUSED' },
  paused_sells:  { variant: 'warning', label: 'SELLS PAUSED' },
}

function EngineStatusPanel() {
  const { health } = useSystemHealth()
  const { data: creds } = useCredentials()
  const tradingState = useAppStore((s) => s.tradingState)

  // Ensure trading state is loaded from backend
  useTradingState()

  const hasApiKey = Boolean(creds?.polymarket_api_key && creds.polymarket_api_key.length > 0)
  const mode = hasApiKey ? 'live' : 'demo'
  const stateBadge = TRADING_STATE_BADGE[tradingState]

  const getServiceStatus = (name: string): string => {
    const svc = health?.services?.find(s => s.name === name)
    return svc?.status ?? 'unknown'
  }

  return (
    <div className="bg-surface rounded-lg border border-border">
      <div className="flex items-center justify-between px-4 py-3 border-b border-border">
        <div className="flex items-center gap-2">
          <Zap className="w-4 h-4 text-info" />
          <h2 className="text-sm font-medium text-slate-200">Automated Trading Engine</h2>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant={stateBadge.variant}>{stateBadge.label}</Badge>
          <Badge variant={mode === 'live' ? 'warning' : 'default'}>
            {mode === 'live' ? 'LIVE' : 'DEMO'}
          </Badge>
        </div>
      </div>

      <div className="p-4 space-y-4">
        {/* Process status grid */}
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
          {ENGINE_PROCESSES.map(p => {
            const status = getServiceStatus(p.name)
            return (
              <div key={p.name} className="flex items-center gap-2 bg-surface-2 rounded-md px-3 py-2">
                <span className={statusDotClass(status)} />
                <div className="min-w-0">
                  <p className="text-xs font-medium text-slate-300 truncate">{p.label}</p>
                  <p className="text-xs text-muted-foreground truncate">{p.desc}</p>
                </div>
              </div>
            )
          })}
        </div>

        {/* How it works — collapsible */}
        <HowItWorks />

        {/* Mode explanation */}
        {mode === 'demo' && (
          <div className="flex items-center gap-2 bg-info/10 border border-info/20 rounded-md px-3 py-2 text-xs text-info">
            <Info className="w-4 h-4 shrink-0" />
            <span>
              Running in demo mode with simulated markets. Add your Polymarket API key in{' '}
              Settings to trade with real funds.
            </span>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Regime / decision helpers ────────────────────────────────────────────────

const REGIME_COLORS: Record<string, string> = {
  quiet: 'text-info',
  trending: 'text-profit',
  panic: 'text-loss',
  volatile: 'text-warning',
  untradeable: 'text-muted-foreground',
}

function DecisionRow({ d }: { d: AIDecision }) {
  return (
    <div data-testid="decision-row" className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <div
        className={cn(
          'mt-0.5 w-2 h-2 rounded-full shrink-0',
          d.action === 'trade' ? 'bg-profit' : 'bg-muted'
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-200 font-medium truncate">{d.category}</span>
          <Badge variant={d.action === 'trade' ? 'success' : 'default'}>
            {d.action.toUpperCase()}
          </Badge>
          {d.regime_assessment && (
            <span className={cn('text-xs', REGIME_COLORS[d.regime_assessment])}>
              {d.regime_assessment}
            </span>
          )}
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{d.dashboard_text}</p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatDistanceToNow(new Date(d.timestamp), { addSuffix: true })}
      </span>
    </div>
  )
}

function AlertRow({ a }: { a: Alert }) {
  return (
    <div className="flex items-start gap-3 py-2.5 border-b border-border last:border-0">
      <AlertTriangle
        className={cn(
          'w-4 h-4 mt-0.5 shrink-0',
          a.severity === 'critical' || a.severity === 'error' ? 'text-loss' : 'text-warning'
        )}
      />
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-sm text-slate-200 font-medium truncate">{a.title}</span>
          <SeverityBadge severity={a.severity} />
        </div>
        <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">{a.message}</p>
      </div>
      <span className="text-xs text-muted-foreground shrink-0">
        {formatDistanceToNow(new Date(a.created_at), { addSuffix: true })}
      </span>
    </div>
  )
}

export default function Dashboard() {
  const { data: bankroll, isLoading: bankrollLoading } = useBankroll()
  const { data: decisions, isLoading: decisionsLoading } = useDecisions({ limit: 10 })
  const { data: alerts } = useAlerts({ limit: 5 })
  const { data: positions } = usePositions()
  const { data: health } = useHealth()

  const totalPnl = bankroll?.balance_delta_total ?? 0
  const dailyPnl = bankroll?.balance_delta_today ?? 0
  const unrealizedPnl = bankroll?.unrealized_pnl ?? 0
  const winRate = null // derived from decision stats

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Dashboard</h1>
        <p className="text-sm text-muted-foreground mt-0.5">Portfolio overview and recent activity</p>
      </div>

      <GettingStarted />

      <EngineStatusPanel />

      {/* Stat row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Balance"
          loading={bankrollLoading}
          value={
            bankroll ? (
              <span className="font-numeric">
                ${Number(bankroll.total_balance).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
              </span>
            ) : '—'
          }
          subValue={bankroll && (
            <span className="text-xs text-muted-foreground">
              ${Number(bankroll.active_balance).toLocaleString('en-US', { maximumFractionDigits: 2 })} available
            </span>
          )}
        />
        <StatCard
          label="Daily P&L"
          loading={bankrollLoading}
          value={<PnlDisplay value={dailyPnl} size="lg" showIcon />}
          subValue={<span className="text-xs">unrealized: <PnlDisplay value={unrealizedPnl} size="sm" /></span>}
        />
        <StatCard
          label="Total P&L"
          loading={bankrollLoading}
          value={<PnlDisplay value={totalPnl} size="lg" showIcon />}
        />
        <StatCard
          label="Open Positions"
          loading={false}
          value={positions?.length ?? '—'}
          subValue={winRate != null ? `${(winRate * 100).toFixed(1)}% win rate` : undefined}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Recent Decisions */}
        <div className="bg-surface rounded-lg border border-border">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Brain className="w-4 h-4 text-info" />
            <h2 className="text-sm font-medium text-slate-200">Recent AI Decisions</h2>
          </div>
          <div className="px-4">
            {decisionsLoading ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="py-2.5 border-b border-border last:border-0">
                  <div className="h-4 bg-surface-2 rounded animate-pulse w-3/4 mb-1" />
                  <div className="h-3 bg-surface-2 rounded animate-pulse w-1/2" />
                </div>
              ))
            ) : decisions?.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No decisions yet</p>
            ) : (
              decisions?.slice(0, 8).map((d) => <DecisionRow key={d.id} d={d} />)
            )}
          </div>
        </div>

        {/* Recent Alerts */}
        <div className="bg-surface rounded-lg border border-border">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <AlertTriangle className="w-4 h-4 text-warning" />
            <h2 className="text-sm font-medium text-slate-200">Recent Alerts</h2>
          </div>
          <div className="px-4">
            {!alerts ? (
              Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="py-2.5 border-b border-border last:border-0">
                  <div className="h-4 bg-surface-2 rounded animate-pulse w-3/4 mb-1" />
                  <div className="h-3 bg-surface-2 rounded animate-pulse w-1/2" />
                </div>
              ))
            ) : alerts.length === 0 ? (
              <p className="py-6 text-center text-sm text-muted-foreground">No alerts</p>
            ) : (
              alerts.map((a) => <AlertRow key={a.id} a={a} />)
            )}
          </div>
        </div>
      </div>

      {/* System Health */}
      {health?.status && (
        <div className="bg-surface rounded-lg border border-border">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Activity className="w-4 h-4 text-profit" />
            <h2 className="text-sm font-medium text-slate-200">System Health</h2>
            <Badge
              variant={health.status === 'ok' ? 'success' : health.status === 'degraded' ? 'warning' : 'danger'}
              className="ml-auto"
            >
              {health.status.toUpperCase()}
            </Badge>
          </div>
          <div className="px-4 py-3 flex flex-wrap gap-4">
            {health.services && Object.entries(health.services).map(([name, status]) => (
              <div key={name} className="flex items-center gap-1.5">
                <span
                  className={cn(
                    'w-2 h-2 rounded-full',
                    status === 'ok' ? 'bg-profit' : status === 'degraded' ? 'bg-warning' : 'bg-loss'
                  )}
                />
                <span className="text-xs text-muted-foreground">{name}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Open Positions summary */}
      {positions && positions.length > 0 && (
        <div className="bg-surface rounded-lg border border-border">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <TrendingUp className="w-4 h-4 text-info" />
            <h2 className="text-sm font-medium text-slate-200">Open Positions</h2>
            <span className="ml-auto text-xs text-muted-foreground">{positions.length} total</span>
          </div>
          <div className="px-4 py-3 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {positions.slice(0, 6).map((p) => (
              <div key={p.id} className="bg-surface-2 rounded-md px-3 py-2 text-sm">
                <div className="flex items-center justify-between mb-1">
                  <span className="font-mono text-xs text-muted-foreground truncate">{p.outcome_token}</span>
                  <Badge variant={p.side === 'long' ? 'success' : 'danger'}>{p.side}</Badge>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-muted-foreground text-xs">size: <span className="font-numeric text-slate-300">{Number(p.size).toFixed(4)}</span></span>
                  {p.unrealized_pnl != null && (
                    <PnlDisplay value={p.unrealized_pnl} size="sm" />
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
