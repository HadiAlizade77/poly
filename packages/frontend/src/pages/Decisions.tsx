import React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow, format } from 'date-fns'
import { X, Brain, CheckCircle, XCircle, AlertTriangle } from 'lucide-react'
import { useDecisions, useDecisionStats } from '@/hooks/useDecisions'
import { DataTable } from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'
import type { AIDecision, DecisionAction, RegimeAssessment } from '@polymarket/shared'

// ─── helpers ─────────────────────────────────────────────────────────────────

const REGIME_STYLE: Record<RegimeAssessment, { variant: 'info' | 'success' | 'danger' | 'warning' | 'default'; label: string }> = {
  quiet:       { variant: 'default',  label: 'Quiet' },
  trending:    { variant: 'success',  label: 'Trending' },
  panic:       { variant: 'danger',   label: 'Panic' },
  volatile:    { variant: 'warning',  label: 'Volatile' },
  untradeable: { variant: 'default',  label: 'Untradeable' },
}

function ConfidenceBar({ value }: { value: number }) {
  const pct = Math.round(value * 100)
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

// ─── detail drawer ────────────────────────────────────────────────────────────

function DecisionDrawer({ d, onClose }: { d: AIDecision; onClose: () => void }) {
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
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-surface-2">
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
                {d.was_executed
                  ? <Badge variant="success"><CheckCircle className="w-3 h-3 inline mr-1" />Executed</Badge>
                  : d.veto_reason
                  ? <Badge variant="danger"><XCircle className="w-3 h-3 inline mr-1" />Vetoed</Badge>
                  : null}
              </div>
              <p className="text-xs text-muted-foreground mt-1">
                {format(new Date(d.timestamp), 'MMM d, yyyy HH:mm:ss')}
                {d.cycle_number != null && ` · Cycle #${d.cycle_number}`}
              </p>
            </div>
            <div className="text-right shrink-0">
              <p className="text-xs text-muted-foreground">Confidence</p>
              <p className="text-lg font-numeric font-semibold text-slate-100">{Math.round(d.confidence * 100)}%</p>
            </div>
          </div>

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
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Summary</p>
            <p className="text-sm text-slate-200 leading-relaxed whitespace-pre-wrap">{d.dashboard_text}</p>
          </div>

          {/* Reasoning */}
          <div>
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Reasoning</p>
            <div className="bg-surface-2 rounded-md p-3 text-sm text-slate-300 leading-relaxed max-h-60 overflow-y-auto whitespace-pre-wrap">
              {d.reasoning}
            </div>
          </div>

          {/* Edge / cost / fair value */}
          {(d.estimated_edge != null || d.estimated_cost != null || d.fair_value != null) && (
            <div className="grid grid-cols-3 gap-3">
              {[
                { label: 'Est. Edge', value: d.estimated_edge != null ? `${(d.estimated_edge * 100).toFixed(2)}%` : '—' },
                { label: 'Est. Cost', value: d.estimated_cost != null ? `$${d.estimated_cost.toFixed(2)}` : '—' },
                { label: 'Fair Value', value: d.fair_value != null ? `${(d.fair_value * 100).toFixed(1)}¢` : '—' },
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Trade Feedback</p>
              <pre className="bg-surface-2 rounded-md p-3 text-xs text-slate-300 overflow-x-auto">
                {JSON.stringify(d.trade_feedback, null, 2)}
              </pre>
            </div>
          )}

          {/* Meta */}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
            <p>Model: <span className="text-slate-300">{d.model_used}</span></p>
            {d.latency_ms != null && <p>Latency: <span className="font-numeric text-slate-300">{d.latency_ms} ms</span></p>}
            {d.tokens_used != null && <p>Tokens: <span className="font-numeric text-slate-300">{d.tokens_used.toLocaleString()}</span></p>}
            {d.prompt_version && <p>Prompt: <span className="text-slate-300">{d.prompt_version}</span></p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── table columns ────────────────────────────────────────────────────────────

const columns: ColumnDef<AIDecision, unknown>[] = [
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
    id: 'category',
    accessorKey: 'category',
    header: 'Category',
    size: 110,
    cell: ({ getValue }) => (
      <span className="text-sm text-slate-300 capitalize">{getValue() as string}</span>
    ),
  },
  {
    id: 'action',
    accessorKey: 'action',
    header: 'Action',
    size: 80,
    cell: ({ getValue }) => {
      const a = getValue() as DecisionAction
      return <Badge variant={a === 'trade' ? 'success' : 'default'}>{a.toUpperCase()}</Badge>
    },
  },
  {
    id: 'direction',
    accessorKey: 'direction',
    header: 'Direction',
    size: 80,
    cell: ({ getValue }) => {
      const v = getValue() as string | null
      return v ? <span className="text-sm text-slate-300">{v}</span> : <span className="text-muted-foreground">—</span>
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
      const { variant, label } = REGIME_STYLE[v]
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
]

// ─── page ─────────────────────────────────────────────────────────────────────

const ACTION_FILTERS = [
  { value: '', label: 'All Actions' },
  { value: 'trade', label: 'Trade' },
  { value: 'hold', label: 'Hold' },
]

export default function Decisions() {
  const [actionFilter, setActionFilter] = React.useState('')
  const [categoryFilter, setCategoryFilter] = React.useState('')
  const [selected, setSelected] = React.useState<AIDecision | null>(null)

  const { data: decisions, isLoading } = useDecisions({
    action: actionFilter || undefined,
  })
  const { data: stats, isLoading: statsLoading } = useDecisionStats()

  const filtered = React.useMemo(() => {
    if (!decisions) return []
    if (!categoryFilter) return decisions
    return decisions.filter((d) => d.category.toLowerCase() === categoryFilter.toLowerCase())
  }, [decisions, categoryFilter])

  const categories = React.useMemo(() => {
    if (!decisions) return []
    return [...new Set(decisions.map((d) => d.category))].sort()
  }, [decisions])

  const tradeRate = stats && stats.total > 0 ? (stats.trades / stats.total) * 100 : null
  const vetoRate = stats && stats.trades > 0 ? (stats.vetoed / stats.trades) * 100 : null

  return (
    <div className="space-y-5">
      <PageHeader
        title="AI Decisions"
        subtitle="Decision log from the AI trading engine"
      />

      {/* Stats row */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Decisions" loading={statsLoading} value={stats?.total ?? '—'} />
        <StatCard
          label="Trade Rate"
          loading={statsLoading}
          value={tradeRate != null ? `${tradeRate.toFixed(1)}%` : '—'}
          subValue={stats ? `${stats.trades} trades, ${stats.holds} holds` : undefined}
        />
        <StatCard
          label="Avg Confidence"
          loading={statsLoading}
          value={stats?.avg_confidence != null ? `${(stats.avg_confidence * 100).toFixed(1)}%` : '—'}
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
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        <select
          value={categoryFilter}
          onChange={(e) => setCategoryFilter(e.target.value)}
          className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-info"
        >
          <option value="">All Categories</option>
          {categories.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </select>
        {(actionFilter || categoryFilter) && (
          <button
            onClick={() => { setActionFilter(''); setCategoryFilter('') }}
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
          columns={columns}
          data={filtered}
          loading={isLoading}
          pageSize={30}
          getRowId={(row) => row.id}
          onRowClick={(row) => setSelected(row.original)}
          emptyMessage="No decisions match the current filters"
        />
      )}

      {selected && <DecisionDrawer d={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}
