import React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow } from 'date-fns'
import { Shield, Power, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { useRiskConfig, useRiskEvents, useToggleKillSwitch } from '@/hooks/useRiskConfig'
import { useBankroll } from '@/hooks/useBankroll'
import { useAppStore } from '@/stores/app.store'
import { DataTable } from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import { StatCard } from '@/components/ui/StatCard'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'
import type { RiskEvent, RiskEventType, Severity } from '@polymarket/shared'

// ─── severity helpers ─────────────────────────────────────────────────────────

const SEVERITY_VARIANT: Record<Severity, 'info' | 'warning' | 'danger'> = {
  info:     'info',
  warning:  'warning',
  critical: 'danger',
}

const EVENT_TYPE_LABELS: Record<RiskEventType, string> = {
  trade_vetoed:      'Trade Vetoed',
  size_reduced:      'Size Reduced',
  category_paused:   'Category Paused',
  global_stop:       'Global Stop',
  drawdown_limit:    'Drawdown Limit',
  exposure_limit:    'Exposure Limit',
  liquidity_warning: 'Liquidity Warning',
  latency_warning:   'Latency Warning',
  anomaly_detected:  'Anomaly Detected',
}

// ─── exposure gauge ───────────────────────────────────────────────────────────

function ExposureGauge({
  label,
  current,
  limit,
  unit = '$',
  decimals = 0,
}: {
  label: string
  current: number
  limit: number
  unit?: string
  decimals?: number
}) {
  const pct = limit > 0 ? Math.min(100, (current / limit) * 100) : 0
  const barColor = pct >= 90 ? 'bg-loss' : pct >= 70 ? 'bg-warning' : 'bg-profit'
  const fmt = (v: number) =>
    unit === '$'
      ? `$${v.toLocaleString('en-US', { maximumFractionDigits: decimals })}`
      : `${(v * 100).toFixed(1)}%`

  return (
    <div className="bg-surface rounded-lg border border-border p-4 space-y-3">
      <div className="flex items-center justify-between text-sm">
        <span className="text-slate-300 font-medium">{label}</span>
        <span
          className={cn(
            'text-xs font-medium',
            pct >= 90 ? 'text-loss' : pct >= 70 ? 'text-warning' : 'text-profit',
          )}
        >
          {Math.round(pct)}%
        </span>
      </div>
      <div className="h-3 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', barColor)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <div className="flex justify-between text-xs text-muted-foreground">
        <span className="font-numeric text-slate-300">{fmt(current)}</span>
        <span>limit: <span className="font-numeric">{fmt(limit)}</span></span>
      </div>
    </div>
  )
}

// ─── kill switch card ─────────────────────────────────────────────────────────

function KillSwitchCard() {
  const { killSwitchEnabled, toggleKillSwitch } = useAppStore()
  const toggle = useToggleKillSwitch()

  const handleToggle = () => {
    const next = !killSwitchEnabled
    toggle.mutate(next, {
      onSuccess: () => {
        toggleKillSwitch()
        toast[next ? 'warning' : 'success'](next ? 'Kill switch ENABLED' : 'Kill switch disabled')
      },
      onError: () => toast.error('Failed to update kill switch'),
    })
  }

  return (
    <div
      className={cn(
        'rounded-lg border p-4 flex items-center justify-between gap-4',
        killSwitchEnabled ? 'bg-loss/10 border-loss/30' : 'bg-surface border-border',
      )}
    >
      <div className="flex items-center gap-3">
        <div className={cn('p-2 rounded-md', killSwitchEnabled ? 'bg-loss/20' : 'bg-surface-2')}>
          <Power className={cn('w-5 h-5', killSwitchEnabled ? 'text-loss' : 'text-muted-foreground')} />
        </div>
        <div>
          <p className={cn('font-semibold text-sm', killSwitchEnabled ? 'text-loss' : 'text-slate-200')}>
            Kill Switch — {killSwitchEnabled ? 'ENABLED' : 'Disabled'}
          </p>
          <p className="text-xs text-muted-foreground">
            {killSwitchEnabled ? 'All trading is halted' : 'Trading active'}
          </p>
        </div>
      </div>
      <button
        onClick={handleToggle}
        disabled={toggle.isPending}
        className={cn(
          'px-4 py-2 rounded-md text-sm font-medium transition-colors shrink-0 border',
          killSwitchEnabled
            ? 'bg-surface-2 text-slate-300 hover:bg-surface border-border'
            : 'bg-loss/20 text-loss hover:bg-loss/30 border-loss/30',
        )}
      >
        {toggle.isPending ? 'Updating…' : killSwitchEnabled ? 'Disable' : 'Enable'}
      </button>
    </div>
  )
}

// ─── event table ──────────────────────────────────────────────────────────────

const eventColumns: ColumnDef<RiskEvent, unknown>[] = [
  {
    id: 'timestamp',
    accessorKey: 'timestamp',
    header: 'Time',
    size: 130,
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">
        {formatDistanceToNow(new Date(getValue() as Date), { addSuffix: true })}
      </span>
    ),
  },
  {
    id: 'severity',
    accessorKey: 'severity',
    header: 'Severity',
    size: 95,
    cell: ({ getValue }) => {
      const s = getValue() as Severity
      return <Badge variant={SEVERITY_VARIANT[s]}>{s.toUpperCase()}</Badge>
    },
  },
  {
    id: 'event_type',
    accessorKey: 'event_type',
    header: 'Event',
    size: 150,
    cell: ({ getValue }) => (
      <span className="text-sm text-slate-200">
        {EVENT_TYPE_LABELS[getValue() as RiskEventType] ?? getValue() as string}
      </span>
    ),
  },
  {
    id: 'message',
    accessorKey: 'message',
    header: 'Message',
    cell: ({ getValue }) => (
      <span className="text-sm text-slate-300 truncate block max-w-xs">
        {getValue() as string}
      </span>
    ),
  },
  {
    id: 'auto_resolved',
    accessorKey: 'auto_resolved',
    header: 'Resolved',
    size: 90,
    cell: ({ getValue }) =>
      getValue()
        ? <Badge variant="success">Auto</Badge>
        : <Badge variant="default">Pending</Badge>,
  },
]

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Risk() {
  const [severityFilter, setSeverityFilter] = React.useState<Severity | ''>('')
  const [typeFilter, setTypeFilter] = React.useState<RiskEventType | ''>('')

  const { data: config, isLoading: configLoading } = useRiskConfig()
  const { data: events, isLoading: eventsLoading } = useRiskEvents()
  const { data: bankroll } = useBankroll()

  const filteredEvents = React.useMemo(() => {
    if (!events) return []
    return events.filter((e) => {
      if (severityFilter && e.severity !== severityFilter) return false
      if (typeFilter && e.event_type !== typeFilter) return false
      return true
    })
  }, [events, severityFilter, typeFilter])

  // Compute current exposure metrics from bankroll
  const currentExposure    = bankroll?.deployed_balance ?? 0
  const currentDailyLoss   = Math.max(0, -(bankroll?.balance_delta_today ?? 0))

  // Recent critical event count
  const criticalCount = events?.filter((e) => e.severity === 'critical' && !e.auto_resolved).length ?? 0
  const warningCount  = events?.filter((e) => e.severity === 'warning').length ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="Risk Management"
        subtitle="Real-time exposure monitoring and circuit breakers"
      />

      {/* Kill switch */}
      <KillSwitchCard />

      {/* Alert summary */}
      {criticalCount > 0 && (
        <div className="flex items-center gap-3 bg-loss/10 border border-loss/30 rounded-lg px-4 py-3">
          <AlertTriangle className="w-4 h-4 text-loss shrink-0" />
          <span className="text-sm text-loss font-medium">
            {criticalCount} unresolved critical risk event{criticalCount !== 1 ? 's' : ''}
          </span>
        </div>
      )}

      {/* Stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Events"
          loading={eventsLoading}
          value={events?.length ?? '—'}
        />
        <StatCard
          label="Critical"
          loading={eventsLoading}
          value={<span className={cn('font-numeric', criticalCount > 0 ? 'text-loss' : '')}>{criticalCount}</span>}
        />
        <StatCard
          label="Warnings"
          loading={eventsLoading}
          value={<span className={cn('font-numeric', warningCount > 0 ? 'text-warning' : '')}>{warningCount}</span>}
        />
        <StatCard
          label="Auto-Resolved"
          loading={eventsLoading}
          value={events?.filter((e) => e.auto_resolved).length ?? '—'}
        />
      </div>

      {/* Exposure gauges */}
      {config && !configLoading && (
        <div>
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
            Exposure vs Limits
          </h2>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            <ExposureGauge
              label="Total Exposure"
              current={currentExposure}
              limit={config.max_total_exposure}
            />
            <ExposureGauge
              label="Daily Loss"
              current={currentDailyLoss}
              limit={config.max_daily_loss}
            />
            <ExposureGauge
              label="Max Spread"
              current={0}
              limit={config.max_spread}
              unit="%"
              decimals={1}
            />
          </div>
        </div>
      )}

      {/* Risk config summary */}
      {config && (
        <div className="bg-surface rounded-lg border border-border">
          <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
            <Shield className="w-4 h-4 text-info" />
            <h2 className="text-sm font-medium text-slate-200">Active Limits</h2>
          </div>
          <div className="p-4 grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
            {([
              { label: 'Max Daily Loss',         value: `$${config.max_daily_loss.toLocaleString()}` },
              { label: 'Max Position Size',      value: `${(config.max_position_size * 100).toFixed(0)}%` },
              { label: 'Max Total Exposure',     value: `$${config.max_total_exposure.toLocaleString()}` },
              { label: 'Max Single Trade',       value: `$${config.max_single_trade.toLocaleString()}` },
              { label: 'Consec. Losses',         value: config.max_consecutive_losses },
              { label: 'Cooldown',               value: `${config.cooldown_after_loss_streak_minutes}m` },
              { label: 'Min Liquidity',          value: `$${config.min_liquidity.toLocaleString()}` },
              { label: 'Max Latency',            value: `${config.max_latency_ms}ms` },
            ] as { label: string; value: string | number }[]).map(({ label, value }) => (
              <div key={label} className="bg-surface-2 rounded px-3 py-2">
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                <p className="font-numeric text-slate-200 text-sm">{value}</p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Event log */}
      <div>
        <div className="flex items-center justify-between mb-3 flex-wrap gap-3">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Risk Event Log
          </h2>
          <div className="flex gap-2 flex-wrap">
            <select
              value={severityFilter}
              onChange={(e) => setSeverityFilter(e.target.value as Severity | '')}
              className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-info"
            >
              <option value="">All Severities</option>
              <option value="info">Info</option>
              <option value="warning">Warning</option>
              <option value="critical">Critical</option>
            </select>
            <select
              value={typeFilter}
              onChange={(e) => setTypeFilter(e.target.value as RiskEventType | '')}
              className="bg-surface border border-border rounded-md px-3 py-1.5 text-sm text-slate-200 focus:outline-none focus:border-info"
            >
              <option value="">All Types</option>
              {(Object.keys(EVENT_TYPE_LABELS) as RiskEventType[]).map((t) => (
                <option key={t} value={t}>{EVENT_TYPE_LABELS[t]}</option>
              ))}
            </select>
            {(severityFilter || typeFilter) && (
              <button
                onClick={() => { setSeverityFilter(''); setTypeFilter('') }}
                className="px-3 py-1.5 text-sm text-muted-foreground hover:text-slate-200 hover:bg-surface-2 rounded-md transition-colors"
              >
                Clear
              </button>
            )}
          </div>
        </div>
        <DataTable
          columns={eventColumns}
          data={filteredEvents}
          loading={eventsLoading}
          pageSize={20}
          getRowId={(row) => row.id}
          emptyMessage="No risk events match current filters"
        />
      </div>
    </div>
  )
}
