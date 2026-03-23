import React from 'react'
import { useSearchParams } from 'react-router-dom'
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  Legend,
  ReferenceLine,
  BarChart,
  Bar,
} from 'recharts'
import { type ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow, format } from 'date-fns'
import {
  X,
  Brain,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Settings,
  ToggleLeft,
  ToggleRight,
  ChevronDown,
  ChevronRight,
  BarChart3,
} from 'lucide-react'
import { toast } from 'sonner'

import { useDecisions, useDecisionStats } from '@/hooks/useDecisions'
import { useMarkets } from '@/hooks/useMarkets'
import { useScorerConfigs, useToggleScorer } from '@/hooks/useScorers'
import { useBankrollHistory, useBankroll } from '@/hooks/useBankroll'
import { useAnalyticsSummary } from '@/hooks/useAnalytics'

import { DataTable } from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { PnlDisplay } from '@/components/ui/PnlDisplay'
import { LoadingPage } from '@/components/ui/LoadingSpinner'
import { cn } from '@/lib/utils'

import type {
  AIDecision,
  DecisionAction,
  RegimeAssessment,
  MarketCategory,
  ScorerConfig,
} from '@polymarket/shared'

// ─── tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { key: 'decisions', label: 'AI Decisions' },
  { key: 'scorers',   label: 'Scorers' },
  { key: 'analytics', label: 'Analytics' },
] as const

type TabKey = typeof TABS[number]['key']

// ─── chart theme ──────────────────────────────────────────────────────────────

const CHART_COLORS = {
  profit: '#22c55e',
  loss:   '#ef4444',
  info:   '#3b82f6',
  warn:   '#f59e0b',
  muted:  '#6b7280',
  grid:   '#1e1e2e',
  text:   '#9ca3af',
}

const CATEGORY_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
]

const tooltipStyle = {
  backgroundColor: '#12121a',
  border: '1px solid #1e1e2e',
  borderRadius: '6px',
  color: '#f1f5f9',
  fontSize: 12,
}

// ═══════════════════════════════════════════════════════════════════════════════
// DECISIONS TAB
// ═══════════════════════════════════════════════════════════════════════════════

const REGIME_STYLE: Record<
  RegimeAssessment,
  { variant: 'info' | 'success' | 'danger' | 'warning' | 'default'; label: string }
> = {
  quiet:       { variant: 'default',  label: 'Quiet' },
  trending:    { variant: 'success',  label: 'Trending' },
  panic:       { variant: 'danger',   label: 'Panic' },
  volatile:    { variant: 'warning',  label: 'Volatile' },
  untradeable: { variant: 'default',  label: 'Untradeable' },
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(Number(value) * 100)
  const color = pct >= 70 ? 'bg-profit' : pct >= 45 ? 'bg-warning' : 'bg-loss'
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', color)} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-numeric text-slate-300 w-7 text-right">{pct}%</span>
    </div>
  )
}

function DecisionDrawer({ d, onClose, marketMap }: { d: AIDecision; onClose: () => void; marketMap: Map<string, string> }) {
  const regime = d.regime_assessment ? REGIME_STYLE[d.regime_assessment] : null

  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-lg bg-surface border-l border-border overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-surface z-10">
          <div className="flex items-center gap-2">
            <Brain className="w-4 h-4 text-info" />
            <span className="text-sm font-medium text-slate-200">Decision Detail</span>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-surface-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Action + meta */}
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={d.action === 'trade' ? 'success' : 'default'}>
                  {d.action.toUpperCase()}
                </Badge>
                {d.direction && <Badge variant="outline">{d.direction}</Badge>}
                {regime && <Badge variant={regime.variant}>{regime.label}</Badge>}
                {d.was_executed ? (
                  <Badge variant="success">
                    <CheckCircle className="w-3 h-3 inline mr-1" />Executed
                  </Badge>
                ) : d.veto_reason ? (
                  <Badge variant="danger">
                    <XCircle className="w-3 h-3 inline mr-1" />Vetoed
                  </Badge>
                ) : null}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {format(new Date(d.timestamp), 'MMM d, yyyy HH:mm:ss')}
                {d.cycle_number != null && ` · Cycle #${d.cycle_number}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">Confidence</p>
              <p className="text-lg font-numeric font-semibold text-slate-100">
                {Math.round(d.confidence * 100)}%
              </p>
            </div>
          </div>

          {/* Market context */}
          {d.market_id && (
            <div className="bg-surface-2 rounded-md px-3 py-2">
              <p className="text-xs text-muted-foreground mb-0.5">Market</p>
              <p className="text-sm text-slate-200">{marketMap.get(d.market_id) ?? d.market_id}</p>
              <p className="text-xs text-muted-foreground capitalize mt-0.5">{d.category}</p>
            </div>
          )}

          {/* Veto reason */}
          {d.veto_reason && (
            <div className="bg-loss/10 border border-loss/20 rounded-md p-3">
              <div className="flex items-center gap-1.5 text-loss text-xs font-medium mb-1">
                <AlertTriangle className="w-3.5 h-3.5" />
                Veto Reason
              </div>
              <p className="text-sm text-slate-300">{d.veto_reason}</p>
            </div>
          )}

          {/* Dashboard text */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Summary
            </p>
            <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">
              {d.dashboard_text}
            </p>
          </div>

          {/* Reasoning */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
              Reasoning
            </p>
            <div className="bg-surface-2 rounded-md p-3 text-sm text-slate-300 leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap">
              {d.reasoning}
            </div>
          </div>

          {/* Edge / cost / fair value */}
          {(d.estimated_edge != null || d.estimated_cost != null || d.fair_value != null) && (
            <div className="grid grid-cols-3 gap-3">
              {[
                {
                  label: 'Est. Edge',
                  value:
                    d.estimated_edge != null
                      ? `${(Number(d.estimated_edge) * 100).toFixed(2)}%`
                      : '—',
                },
                {
                  label: 'Est. Cost',
                  value:
                    d.estimated_cost != null
                      ? `$${Number(d.estimated_cost).toFixed(2)}`
                      : '—',
                },
                {
                  label: 'Fair Value',
                  value:
                    d.fair_value != null
                      ? `${(Number(d.fair_value) * 100).toFixed(1)}¢`
                      : '—',
                },
              ].map(({ label, value }) => (
                <div key={label} className="bg-surface-2 rounded px-3 py-2">
                  <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                  <p className="font-numeric text-slate-200 text-sm">{value}</p>
                </div>
              ))}
            </div>
          )}

          {/* Trade feedback */}
          {d.trade_feedback && Object.keys(d.trade_feedback).length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Trade Feedback
              </p>
              <pre className="bg-surface-2 rounded-md p-3 text-xs text-slate-300 overflow-x-auto">
                {JSON.stringify(d.trade_feedback, null, 2)}
              </pre>
            </div>
          )}

          {/* Meta */}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
            <p>
              Model: <span className="text-slate-300">{d.model_used}</span>
            </p>
            {d.latency_ms != null && (
              <p>
                Latency:{' '}
                <span className="font-numeric text-slate-300">{d.latency_ms} ms</span>
              </p>
            )}
            {d.tokens_used != null && (
              <p>
                Tokens:{' '}
                <span className="font-numeric text-slate-300">
                  {d.tokens_used.toLocaleString()}
                </span>
              </p>
            )}
            {d.prompt_version && (
              <p>
                Prompt: <span className="text-slate-300">{d.prompt_version}</span>
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function makeDecisionColumns(marketMap: Map<string, string>): ColumnDef<AIDecision, unknown>[] {
  return [
  {
    id: 'timestamp',
    accessorKey: 'timestamp',
    header: 'Time',
    size: 140,
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground whitespace-nowrap">
        {formatDistanceToNow(new Date(getValue() as Date), { addSuffix: true })}
      </span>
    ),
  },
  {
    id: 'market',
    header: 'Market',
    size: 200,
    cell: ({ row }) => {
      const title = marketMap.get(row.original.market_id)
      return (
        <div className="max-w-[180px]">
          <p className="text-sm text-slate-200 truncate">{title ?? 'Unknown market'}</p>
          <p className="text-xs text-muted-foreground capitalize">{row.original.category}</p>
        </div>
      )
    },
  },
  {
    id: 'action',
    accessorKey: 'action',
    header: 'Action',
    size: 80,
    cell: ({ getValue }) => {
      const a = getValue() as DecisionAction
      return (
        <Badge variant={a === 'trade' ? 'success' : 'default'}>{a.toUpperCase()}</Badge>
      )
    },
  },
  {
    id: 'direction',
    accessorKey: 'direction',
    header: 'Direction',
    size: 80,
    cell: ({ getValue }) => {
      const v = getValue() as string | null
      return v ? (
        <span className="text-sm text-slate-300">{v}</span>
      ) : (
        <span className="text-muted-foreground">—</span>
      )
    },
  },
  {
    id: 'confidence',
    accessorKey: 'confidence',
    header: 'Confidence',
    size: 130,
    cell: ({ getValue }) => <ConfidenceBar value={getValue() as number} />,
  },
  {
    id: 'regime',
    accessorKey: 'regime_assessment',
    header: 'Regime',
    size: 100,
    cell: ({ getValue }) => {
      const v = getValue() as RegimeAssessment | null
      if (!v) return <span className="text-muted-foreground">—</span>
      const style = REGIME_STYLE[v]
      if (!style) return <Badge variant="default">{v}</Badge>
      const { variant, label } = style
      return <Badge variant={variant}>{label}</Badge>
    },
  },
  {
    id: 'executed',
    accessorKey: 'was_executed',
    header: 'Executed',
    size: 80,
    cell: ({ row }) => {
      if (row.original.was_executed) return <Badge variant="success">Yes</Badge>
      if (row.original.veto_reason) return <Badge variant="danger">Vetoed</Badge>
      return <Badge variant="default">No</Badge>
    },
  },
]}

const ACTION_FILTERS = [
  { value: '', label: 'All Actions' },
  { value: 'trade', label: 'Trade' },
  { value: 'hold', label: 'Hold' },
]

function DecisionsTab() {
  const [actionFilter, setActionFilter] = React.useState('')
  const [categoryFilter, setCategoryFilter] = React.useState('')
  const [marketFilter, setMarketFilter] = React.useState('')
  const [selected, setSelected] = React.useState<AIDecision | null>(null)

  const { data: decisions, isLoading } = useDecisions({
    action: actionFilter || undefined,
  })
  const { data: stats, isLoading: statsLoading } = useDecisionStats()
  const { data: markets } = useMarkets()

  const marketMap = React.useMemo(() => {
    if (!markets) return new Map<string, string>()
    return new Map(markets.map((m) => [m.id, m.title]))
  }, [markets])

  const filtered = React.useMemo(() => {
    if (!decisions) return []
    return decisions.filter((d) => {
      if (categoryFilter && d.category.toLowerCase() !== categoryFilter.toLowerCase()) return false
      if (marketFilter && d.market_id !== marketFilter) return false
      return true
    })
  }, [decisions, categoryFilter, marketFilter])

  const categories = React.useMemo(() => {
    if (!decisions) return []
    return [...new Set(decisions.map((d) => d.category))].sort()
  }, [decisions])

  const uniqueMarkets = React.useMemo(() => {
    if (!decisions) return []
    const ids = [...new Set(decisions.map((d) => d.market_id))].filter(Boolean)
    return ids
      .map((id) => ({ id, title: marketMap.get(id) ?? id }))
      .sort((a, b) => a.title.localeCompare(b.title))
  }, [decisions, marketMap])

  const decisionColumns = React.useMemo(() => makeDecisionColumns(marketMap), [marketMap])

  const tradeRate =
    stats && stats.total > 0 ? (stats.trades / stats.total) * 100 : null
  const vetoRate =
    stats && stats.trades > 0 ? (stats.vetoed / stats.trades) * 100 : null

  return (
    <div className="space-y-5">
      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Decisions" loading={statsLoading} value={stats?.total ?? '—'} />
        <StatCard
          label="Trade Rate"
          loading={statsLoading}
          value={tradeRate != null ? `${tradeRate.toFixed(1)}%` : '—'}
          subValue={
            stats ? `${stats.trades} trades, ${stats.holds} holds` : undefined
          }
        />
        <StatCard
          label="Avg Confidence"
          loading={statsLoading}
          value={
            stats?.avg_confidence != null
              ? `${(Number(stats.avg_confidence) * 100).toFixed(1)}%`
              : '—'
          }
        />
        <StatCard
          label="Veto Rate"
          loading={statsLoading}
          value={vetoRate != null ? `${vetoRate.toFixed(1)}%` : '—'}
          subValue={stats ? `${stats.vetoed} vetoed` : undefined}
        />
      </div>

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={actionFilter}
          onChange={(e) => setActionFilter(e.target.value)}
          className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-info"
        >
          {ACTION_FILTERS.map(({ value, label }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-info"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
        <select
          value={marketFilter}
          onChange={(e) => setMarketFilter(e.target.value)}
          className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-info"
        >
          <option value="">All Markets</option>
          {uniqueMarkets.map(({ id, title }) => (
            <option key={id} value={id}>{title}</option>
          ))}
        </select>
        {(actionFilter || categoryFilter || marketFilter) && (
          <button
            onClick={() => {
              setActionFilter('')
              setCategoryFilter('')
              setMarketFilter('')
            }}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-slate-200 hover:bg-surface-2 rounded-md transition-colors"
          >
            Clear filters
          </button>
        )}
      </div>

      {filtered.length === 0 && !isLoading ? (
        <EmptyState
          icon={<Brain className="w-6 h-6 text-muted-foreground" />}
          title="No decisions found"
          message="Decisions will appear here once the AI engine starts running."
        />
      ) : (
        <DataTable
          columns={decisionColumns}
          data={filtered}
          loading={isLoading}
          pageSize={30}
          getRowId={(row) => row.id}
          onRowClick={(row) => setSelected(row.original)}
          emptyMessage="No decisions match the current filters"
        />
      )}

      {selected && (
        <DecisionDrawer d={selected} onClose={() => setSelected(null)} marketMap={marketMap} />
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// SCORERS TAB
// ═══════════════════════════════════════════════════════════════════════════════

const SCORER_CATEGORIES: { value: MarketCategory | 'all'; label: string }[] = [
  { value: 'all',           label: 'All' },
  { value: 'crypto',        label: 'Crypto' },
  { value: 'politics',      label: 'Politics' },
  { value: 'sports',        label: 'Sports' },
  { value: 'events',        label: 'Events' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'other',         label: 'Other' },
]

function ParamValue({ value }: { value: unknown }) {
  if (value === null || value === undefined)
    return <span className="text-muted-foreground">—</span>
  if (typeof value === 'boolean')
    return (
      <Badge variant={value ? 'success' : 'default'}>{String(value)}</Badge>
    )
  if (typeof value === 'object')
    return (
      <span className="font-mono text-xs text-info">{JSON.stringify(value)}</span>
    )
  return <span className="font-mono text-slate-300">{String(value)}</span>
}

function ScorerCard({ config }: { config: ScorerConfig }) {
  const [expanded, setExpanded] = React.useState(false)
  const toggle = useToggleScorer()

  const handleToggle = () => {
    toggle.mutate(config.id, {
      onSuccess: () =>
        toast.success(
          `${config.scorer_name} ${config.is_enabled ? 'disabled' : 'enabled'}`,
        ),
      onError: () => toast.error('Failed to toggle scorer'),
    })
  }

  const paramEntries = Object.entries(config.parameters ?? {})
  const hasDimensions = false

  return (
    <div
      className={cn(
        'bg-surface rounded-lg border transition-colors',
        config.is_enabled ? 'border-border' : 'border-border opacity-60',
      )}
    >
      {/* Header row */}
      <div className="flex items-center gap-3 p-4">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded ? (
            <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
          ) : (
            <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />
          )}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">
              {config.scorer_name}
            </p>
            {config.description && (
              <p className="text-xs text-muted-foreground truncate">
                {config.description}
              </p>
            )}
          </div>
        </button>

        <div className="flex items-center gap-2 shrink-0">
          <Badge variant={config.is_enabled ? 'success' : 'default'}>
            {config.is_enabled ? 'Enabled' : 'Disabled'}
          </Badge>
          <button
            onClick={handleToggle}
            disabled={toggle.isPending}
            className="text-slate-400 hover:text-slate-200 transition-colors disabled:opacity-50"
            aria-label={config.is_enabled ? 'Disable scorer' : 'Enable scorer'}
          >
            {config.is_enabled ? (
              <ToggleRight className="w-6 h-6 text-profit" />
            ) : (
              <ToggleLeft className="w-6 h-6" />
            )}
          </button>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {/* Parameters */}
          {paramEntries.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Parameters
              </p>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {paramEntries.map(([k, v]) => (
                  <div key={k} className="bg-surface-2 rounded px-3 py-2">
                    <p className="text-xs text-muted-foreground mb-0.5 truncate">{k}</p>
                    <ParamValue value={v} />
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Score dimension bars (shown when live data available) */}
          {hasDimensions && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">
                Latest Scores
              </p>
              {/* ScoreSummary would be wired here once useContextScores returns data */}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Category:{' '}
            <span className="text-slate-300">{config.category}</span>
            {' · '}
            Updated:{' '}
            <span className="text-slate-300">
              {new Date(config.updated_at).toLocaleDateString()}
            </span>
          </p>
        </div>
      )}
    </div>
  )
}

function ScorersTab() {
  const [category, setCategory] = React.useState<MarketCategory | 'all'>('all')

  const { data: configs, isLoading } = useScorerConfigs(
    category === 'all' ? undefined : category,
  )

  return (
    <div className="space-y-4">
      {/* Enabled count */}
      {configs && (
        <p className="text-xs text-muted-foreground">
          {configs.filter((c) => c.is_enabled).length} / {configs.length} enabled
        </p>
      )}

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {SCORER_CATEGORIES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setCategory(value)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              category === value
                ? 'bg-info/20 text-info'
                : 'text-muted-foreground hover:text-slate-300 hover:bg-surface-2',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {isLoading ? (
        <LoadingPage />
      ) : !configs || configs.length === 0 ? (
        <EmptyState
          icon={<Settings className="w-6 h-6 text-muted-foreground" />}
          title="No scorers configured"
          message={`No scoring modules found${category !== 'all' ? ` for ${category}` : ''}. Scorers are configured server-side.`}
        />
      ) : (
        <div className="space-y-2">
          {configs.map((config) => (
            <ScorerCard key={config.id} config={config} />
          ))}
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// ANALYTICS TAB
// ═══════════════════════════════════════════════════════════════════════════════

function PnlHistoryChart() {
  const { data: history, isLoading } = useBankrollHistory()

  if (isLoading) return <LoadingPage />
  if (!history || history.length === 0) {
    return (
      <EmptyState
        title="No history yet"
        message="Balance history will appear once trading begins."
      />
    )
  }

  const chartData = history.map((h) => ({
    date:     format(new Date(h.date), 'MMM d'),
    balance:  h.closing_balance,
    pnl:      h.trading_pnl,
    winRate:
      h.win_rate != null ? +(Number(h.win_rate) * 100).toFixed(1) : null,
  }))

  const firstBalance = chartData[0]?.balance ?? 0
  const lastBalance  = chartData[chartData.length - 1]?.balance ?? 0
  const totalPnl     = lastBalance - firstBalance

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-muted-foreground">Total change</p>
        <PnlDisplay value={totalPnl} showIcon size="sm" />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
          <XAxis
            dataKey="date"
            tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
          />
          <YAxis
            tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) =>
              `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
            }
            width={70}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number) => [
              `$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`,
              'Balance',
            ]}
            labelStyle={{ color: CHART_COLORS.text }}
          />
          <ReferenceLine y={firstBalance} stroke={CHART_COLORS.muted} strokeDasharray="4 2" />
          <Line
            type="monotone"
            dataKey="balance"
            stroke={totalPnl >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss}
            strokeWidth={2}
            dot={false}
            activeDot={{
              r: 4,
              fill: totalPnl >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss,
            }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

function DailyPnlChart() {
  const { data: history, isLoading } = useBankrollHistory()

  if (isLoading || !history || history.length === 0) return null

  const chartData = history.map((h) => ({
    date: format(new Date(h.date), 'MMM d'),
    pnl:  +Number(h.trading_pnl).toFixed(2),
  }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="date"
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${v}`}
          width={55}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number) => [`$${value.toFixed(2)}`, 'Daily P&L']}
          labelStyle={{ color: CHART_COLORS.text }}
        />
        <ReferenceLine y={0} stroke={CHART_COLORS.muted} />
        <Line
          type="monotone"
          dataKey="pnl"
          stroke={CHART_COLORS.info}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function CategoryPieChart() {
  const { data: summary, isLoading } = useAnalyticsSummary()

  if (isLoading) return <LoadingPage />
  if (
    !summary ||
    !summary.by_category ||
    Object.keys(summary.by_category).length === 0
  ) {
    return (
      <EmptyState
        title="No category data"
        message="Category breakdown appears once trades execute."
      />
    )
  }

  const data = Object.entries(summary.by_category).map(([name, stats]) => ({
    name,
    value: stats.trades,
    pnl:   stats.pnl,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={3}
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number, _name: string, entry) => [
            `${value} trades · $${(entry.payload as { pnl: number }).pnl.toFixed(2)} P&L`,
          ]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => (
            <span style={{ color: CHART_COLORS.text, fontSize: 11 }}>{value}</span>
          )}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

function ConfidenceOutcomeChart() {
  const { data: decisions, isLoading } = useDecisions()

  if (isLoading) return <LoadingPage />

  const tradeDecisions =
    decisions?.filter((d) => d.action === 'trade' && d.was_executed) ?? []

  if (tradeDecisions.length === 0) {
    return (
      <EmptyState
        title="No executed trades"
        message="Scatter plot populates after trades execute."
      />
    )
  }

  const data = tradeDecisions.map((d) => ({
    confidence: +(Number(d.confidence) * 100).toFixed(1),
    edge:
      d.estimated_edge != null
        ? +(Number(d.estimated_edge) * 100).toFixed(2)
        : 0,
    executed: d.was_executed ? 1 : 0,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="confidence"
          name="Confidence"
          unit="%"
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          label={{
            value: 'Confidence %',
            position: 'insideBottom',
            offset: -2,
            fill: CHART_COLORS.text,
            fontSize: 11,
          }}
        />
        <YAxis
          dataKey="edge"
          name="Edge"
          unit="%"
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={45}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ strokeDasharray: '3 3', stroke: CHART_COLORS.muted }}
          formatter={(value: number, name: string) => [`${value}%`, name]}
        />
        <ReferenceLine y={0} stroke={CHART_COLORS.muted} strokeDasharray="4 2" />
        <Scatter data={data} fill={CHART_COLORS.info} opacity={0.7} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

function WinRateChart() {
  const { data: history, isLoading } = useBankrollHistory()

  if (isLoading || !history || history.length === 0) return null

  const chartData = history
    .filter((h) => h.win_rate != null)
    .map((h) => ({
      date:    format(new Date(h.date), 'MMM d'),
      winRate: +(Number(h.win_rate!) * 100).toFixed(1),
    }))

  if (chartData.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="date"
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
          width={40}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number) => [`${value}%`, 'Win Rate']}
          labelStyle={{ color: CHART_COLORS.text }}
        />
        <ReferenceLine y={50} stroke={CHART_COLORS.muted} strokeDasharray="4 2" />
        <Line
          type="monotone"
          dataKey="winRate"
          stroke={CHART_COLORS.warn}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

function ConfidenceCalibrationChart() {
  const { data: decisions, isLoading } = useDecisions()

  if (isLoading) return <LoadingPage />

  const executed =
    decisions?.filter((d) => d.action === 'trade' && d.was_executed) ?? []

  if (executed.length === 0) {
    return (
      <EmptyState
        title="No executed trades"
        message="Calibration chart populates after trades execute."
      />
    )
  }

  type Bucket = { bucket: string; winRate: number; count: number }
  const bucketMap: Record<string, { wins: number; total: number }> = {}
  for (const d of executed) {
    const pct   = Math.floor(Number(d.confidence) * 10) * 10
    const label = `${pct}–${pct + 10}%`
    if (!bucketMap[label]) bucketMap[label] = { wins: 0, total: 0 }
    bucketMap[label].total++
    if (Number(d.estimated_edge ?? 0) > 0) bucketMap[label].wins++
  }

  const data: Bucket[] = Object.entries(bucketMap)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([bucket, { wins, total }]) => ({
      bucket,
      winRate: total > 0 ? +((wins / total) * 100).toFixed(1) : 0,
      count:   total,
    }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="bucket"
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
        />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
          width={40}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number, _name: string, entry) => [
            `${value}% win rate · ${(entry.payload as Bucket).count} trades`,
          ]}
          labelStyle={{ color: CHART_COLORS.text }}
        />
        <ReferenceLine y={50} stroke={CHART_COLORS.muted} strokeDasharray="4 2" />
        <Bar dataKey="winRate" fill={CHART_COLORS.info} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium text-slate-200 mb-4">{title}</h2>
      {children}
    </div>
  )
}

function AnalyticsTab() {
  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary()
  const { data: bankroll, isLoading: bankrollLoading } = useBankroll()

  const winRate =
    summary?.win_rate != null
      ? `${(Number(summary.win_rate) * 100).toFixed(1)}%`
      : '—'
  const avgPnl =
    summary?.avg_pnl_per_trade != null ? summary.avg_pnl_per_trade : null

  return (
    <div className="space-y-6">
      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Trades"
          loading={summaryLoading}
          value={summary?.total_trades ?? '—'}
          subValue={
            summary
              ? `${summary.winning_trades}W / ${summary.losing_trades}L`
              : undefined
          }
        />
        <StatCard label="Win Rate" loading={summaryLoading} value={winRate} />
        <StatCard
          label="Total P&L"
          loading={summaryLoading}
          value={
            summary ? (
              <PnlDisplay value={summary.total_pnl} size="lg" showIcon />
            ) : (
              '—'
            )
          }
          subValue={
            avgPnl != null ? (
              <span className="text-xs">
                avg <PnlDisplay value={avgPnl} size="sm" /> / trade
              </span>
            ) : undefined
          }
        />
        <StatCard
          label="Total Balance"
          loading={bankrollLoading}
          value={
            bankroll
              ? `$${Number(bankroll.total_balance).toLocaleString('en-US', {
                  minimumFractionDigits: 2,
                  maximumFractionDigits: 2,
                })}`
              : '—'
          }
          subValue={
            bankroll ? (
              <PnlDisplay value={bankroll.balance_delta_today} size="sm" showIcon />
            ) : undefined
          }
        />
      </div>

      {/* Charts row 1 — P&L history (full width) */}
      <ChartCard title="Portfolio Balance History">
        <PnlHistoryChart />
      </ChartCard>

      {/* Charts row 2 — Daily P&L + Win rate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Daily P&L">
          <DailyPnlChart />
        </ChartCard>
        <ChartCard title="Win Rate Over Time">
          <WinRateChart />
        </ChartCard>
      </div>

      {/* Charts row 3 — Category breakdown + Confidence scatter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Trades by Category">
          <CategoryPieChart />
        </ChartCard>
        <ChartCard title="Confidence vs Estimated Edge">
          <ConfidenceOutcomeChart />
        </ChartCard>
      </div>

      {/* Charts row 4 — Confidence calibration */}
      <ChartCard title="Confidence Calibration (Win Rate by Confidence Bucket)">
        <ConfidenceCalibrationChart />
      </ChartCard>

      {/* Best / Worst trade */}
      {summary &&
        (summary.best_trade_pnl != null || summary.worst_trade_pnl != null) && (
          <div className="grid grid-cols-2 gap-4">
            <StatCard
              label="Best Trade"
              loading={false}
              value={
                summary.best_trade_pnl != null ? (
                  <PnlDisplay value={summary.best_trade_pnl} size="lg" showIcon />
                ) : (
                  '—'
                )
              }
            />
            <StatCard
              label="Worst Trade"
              loading={false}
              value={
                summary.worst_trade_pnl != null ? (
                  <PnlDisplay value={summary.worst_trade_pnl} size="lg" showIcon />
                ) : (
                  '—'
                )
              }
            />
          </div>
        )}

      {/* Fees summary footer */}
      {summary && (
        <div className="bg-surface rounded-lg border border-border px-4 py-3 flex flex-wrap gap-6 text-xs text-muted-foreground">
          <span>
            Total fees paid:{' '}
            <span className="font-numeric text-slate-300">
              ${Number(summary.total_fees).toFixed(4)}
            </span>
          </span>
          {summary.avg_hold_time_hours != null && (
            <span>
              Avg hold time:{' '}
              <span className="font-numeric text-slate-300">
                {Number(summary.avg_hold_time_hours).toFixed(1)}h
              </span>
            </span>
          )}
          <span className="ml-auto">
            <BarChart3 className="w-3.5 h-3.5 inline mr-1" />
            {summary.total_trades} total trades analyzed
          </span>
        </div>
      )}
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════════
// PAGE
// ═══════════════════════════════════════════════════════════════════════════════

const SUBTITLES: Record<TabKey, string> = {
  decisions: 'Decision log from the AI trading engine',
  scorers:   'AI scoring modules that assess market conditions',
  analytics: 'Performance metrics and trade history analysis',
}

export default function Intelligence() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = (searchParams.get('tab') ?? 'decisions') as TabKey

  const setTab = (key: TabKey) => {
    setSearchParams({ tab: key }, { replace: true })
  }

  // For the Scorers tab badge we need live counts — fetch regardless of active tab
  // so the badge is available when the user looks at other tabs too. We hoist the
  // useScorerConfigs call here at page level (without a category filter) purely for
  // the badge; the ScorersTab also calls it internally for its own filtered view.
  const { data: allScorerConfigs } = useScorerConfigs(undefined)
  const enabledCount = allScorerConfigs?.filter((c) => c.is_enabled).length ?? 0
  const totalCount   = allScorerConfigs?.length ?? 0

  return (
    <div className="space-y-4">
      <PageHeader
        title="Intelligence"
        subtitle={SUBTITLES[activeTab]}
      />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border pb-0">
        {TABS.map(({ key, label }) => {
          const isActive = activeTab === key
          const badge =
            key === 'scorers' && totalCount > 0
              ? `${enabledCount}/${totalCount}`
              : undefined

          return (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={cn(
                'px-4 py-2 text-sm font-medium whitespace-nowrap border-b-2 transition-colors -mb-px',
                isActive
                  ? 'border-info text-info'
                  : 'border-transparent text-muted-foreground hover:text-slate-300 hover:border-border',
              )}
            >
              {label}
              {badge && (
                <span className="ml-1.5 text-xs font-numeric text-muted-foreground">
                  {badge}
                </span>
              )}
            </button>
          )
        })}
      </div>

      {/* Tab content */}
      {activeTab === 'decisions' && <DecisionsTab />}
      {activeTab === 'scorers'   && <ScorersTab />}
      {activeTab === 'analytics' && <AnalyticsTab />}
    </div>
  )
}
