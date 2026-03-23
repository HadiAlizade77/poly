import { formatDistanceToNow } from 'date-fns'
import {
  Database,
  Server,
  Wifi,
  Clock,
  Radio,
  RefreshCw,
  Users,
  Cpu,
  RotateCcw,
  Timer,
} from 'lucide-react'
import {
  useSystemHealth,
  formatUptime,
  feedStaleness,
  type ServiceStatus,
  type FeedStatus,
} from '@/hooks/useSystemHealth'
import { useAppStore } from '@/stores/app.store'
import { cn } from '@/lib/utils'
import { Badge } from '@/components/ui/Badge'
import { LoadingPage } from '@/components/ui/LoadingSpinner'
import { PageHeader } from '@/components/ui/PageHeader'

// ─── type helpers ─────────────────────────────────────────────────────────────

type StatusLevel = 'ok' | 'degraded' | 'error' | 'unknown'

function svcStatusLevel(s: ServiceStatus['status']): StatusLevel {
  if (s === 'running') return 'ok'
  if (s === 'stopped') return 'unknown'
  if (s === 'errored') return 'error'
  return 'unknown'
}

function statusVariant(s: StatusLevel): 'success' | 'warning' | 'danger' | 'default' {
  if (s === 'ok') return 'success'
  if (s === 'degraded') return 'warning'
  if (s === 'error') return 'danger'
  return 'default'
}

function svcBadgeVariant(s: ServiceStatus['status']): 'success' | 'danger' | 'default' {
  if (s === 'running') return 'success'
  if (s === 'errored') return 'danger'
  return 'default'
}

// ─── sub-components ───────────────────────────────────────────────────────────

function StatusDot({ status }: { status: StatusLevel }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        status === 'ok' && 'bg-profit',
        status === 'degraded' && 'bg-warning animate-pulse',
        status === 'error' && 'bg-loss',
        status === 'unknown' && 'bg-slate-600',
      )}
    />
  )
}

function InfraCard({
  label,
  status,
  icon: Icon,
  latencyMs,
  sub,
}: {
  label: string
  status: StatusLevel
  icon: React.ComponentType<{ className?: string }>
  latencyMs?: number
  sub?: string
}) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4 flex items-start gap-3">
      <div
        className={cn(
          'w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5',
          status === 'ok' && 'bg-profit/15',
          status === 'degraded' && 'bg-warning/15',
          status === 'error' && 'bg-loss/15',
          status === 'unknown' && 'bg-surface-2',
        )}
      >
        <Icon
          className={cn(
            'w-4 h-4',
            status === 'ok' && 'text-profit',
            status === 'degraded' && 'text-warning',
            status === 'error' && 'text-loss',
            status === 'unknown' && 'text-muted-foreground',
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-200">{label}</span>
          <Badge variant={statusVariant(status)}>
            {status === 'ok' ? 'Connected' : status === 'error' ? 'Error' : status === 'degraded' ? 'Degraded' : 'Unknown'}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          {latencyMs != null && (
            <span className="font-numeric text-slate-300">{latencyMs} ms</span>
          )}
          {sub && <span>{sub}</span>}
        </div>
      </div>
    </div>
  )
}

function ServiceCard({ svc }: { svc: ServiceStatus }) {
  const level = svcStatusLevel(svc.status)
  const dotColor = {
    running: 'bg-profit',
    stopped: 'bg-slate-600',
    errored: 'bg-loss animate-pulse',
    unknown: 'bg-slate-600',
  }[svc.status]

  return (
    <div
      className={cn(
        'bg-surface rounded-lg border p-4 space-y-3 transition-colors',
        level === 'ok' && 'border-border',
        level === 'error' && 'border-loss/30',
        level === 'unknown' && 'border-border opacity-70',
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
          <span className="text-sm font-mono font-medium text-slate-200 truncate">{svc.name}</span>
        </div>
        <Badge variant={svcBadgeVariant(svc.status)}>
          {svc.status === 'running' ? 'Running' : svc.status === 'errored' ? 'Errored' : svc.status === 'stopped' ? 'Stopped' : 'Unknown'}
        </Badge>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-surface-2 rounded px-2 py-1.5">
          <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
            <Timer className="w-3 h-3" />
            <span>Uptime</span>
          </div>
          <span className="font-numeric text-slate-300">
            {svc.uptimeSeconds != null ? formatUptime(svc.uptimeSeconds) : '—'}
          </span>
        </div>
        <div className="bg-surface-2 rounded px-2 py-1.5">
          <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
            <Cpu className="w-3 h-3" />
            <span>Memory</span>
          </div>
          <span className="font-numeric text-slate-300">
            {svc.memoryMb != null ? `${svc.memoryMb} MB` : '—'}
          </span>
        </div>
        <div className="bg-surface-2 rounded px-2 py-1.5">
          <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
            <RotateCcw className="w-3 h-3" />
            <span>Restarts</span>
          </div>
          <span className={cn('font-numeric', (svc.restartCount ?? 0) > 3 ? 'text-warning' : 'text-slate-300')}>
            {svc.restartCount ?? 0}
          </span>
        </div>
      </div>

      {svc.detail && (
        <p className="text-xs text-muted-foreground truncate">{svc.detail}</p>
      )}
    </div>
  )
}

function FeedRow({ feed }: { feed: FeedStatus }) {
  const staleness = feedStaleness(feed.lastFetchAt)

  const dotClass = {
    ok: 'bg-profit',
    stale: 'bg-warning animate-pulse',
    dead: 'bg-loss',
  }[staleness]

  const badgeVariant: 'success' | 'warning' | 'danger' =
    staleness === 'ok' ? 'success' : staleness === 'stale' ? 'warning' : 'danger'

  const badgeLabel =
    staleness === 'ok' ? 'Live' : staleness === 'stale' ? 'Stale' : 'No data'

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <span className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} />
      <span className="text-sm text-slate-300 flex-1">{feed.name}</span>
      <div className="flex items-center gap-3">
        {feed.latencyMs != null && (
          <span className="text-xs font-numeric text-muted-foreground">{feed.latencyMs} ms</span>
        )}
        {feed.lastFetchAt ? (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {formatDistanceToNow(new Date(feed.lastFetchAt), { addSuffix: true })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground hidden sm:inline">never</span>
        )}
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
      </div>
    </div>
  )
}

function MemoryBar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const barColor = pct > 80 ? 'bg-loss' : pct > 60 ? 'bg-warning' : 'bg-profit'
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-numeric text-slate-300">{used} / {total} MB ({pct}%)</span>
      </div>
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Health() {
  const { health, lastUpdated } = useSystemHealth()
  const connectionStatus = useAppStore((s) => s.connectionStatus)

  if (!health) return <LoadingPage />

  const overallLevel: StatusLevel = health.status === 'ok' ? 'ok' : health.status === 'degraded' ? 'degraded' : 'error'

  const erroredServices = health.services?.filter((s) => s.status === 'errored').length ?? 0
  const staleFeeds = health.feeds?.filter((f) => feedStaleness(f.lastFetchAt) !== 'ok').length ?? 0

  return (
    <div className="space-y-6">
      <PageHeader
        title="System Health"
        subtitle={
          lastUpdated
            ? `Live · last event ${formatDistanceToNow(lastUpdated, { addSuffix: true })}`
            : 'Waiting for first WebSocket event…'
        }
        actions={
          <span className="flex items-center gap-1.5 text-xs text-muted-foreground">
            <RefreshCw className="w-3.5 h-3.5" />
            Auto-refreshes every 30 s
          </span>
        }
      />

      {/* Overall banner */}
      <div
        className={cn(
          'rounded-lg border px-4 py-3 flex items-center gap-3',
          overallLevel === 'ok' && 'bg-profit/10 border-profit/30',
          overallLevel === 'degraded' && 'bg-warning/10 border-warning/30',
          overallLevel === 'error' && 'bg-loss/10 border-loss/30',
        )}
      >
        <StatusDot status={overallLevel} />
        <span
          className={cn(
            'text-sm font-semibold',
            overallLevel === 'ok' && 'text-profit',
            overallLevel === 'degraded' && 'text-warning',
            overallLevel === 'error' && 'text-loss',
          )}
        >
          {overallLevel === 'ok'
            ? 'All systems operational'
            : overallLevel === 'degraded'
            ? `System degraded — ${erroredServices} service${erroredServices !== 1 ? 's' : ''} errored, ${staleFeeds} feed${staleFeeds !== 1 ? 's' : ''} stale`
            : 'Critical — system errors detected'}
        </span>
      </div>

      {/* Infrastructure */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Infrastructure</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <InfraCard
            label="PostgreSQL"
            status={health.db === 'ok' ? 'ok' : 'error'}
            icon={Database}
            latencyMs={health.dbLatencyMs}
            sub="Primary database"
          />
          <InfraCard
            label="Redis"
            status={health.redis === 'ok' ? 'ok' : 'error'}
            icon={Server}
            latencyMs={health.redisLatencyMs}
            sub="Cache & pub/sub"
          />
          <InfraCard
            label="WebSocket"
            status={connectionStatus === 'connected' ? 'ok' : connectionStatus === 'connecting' ? 'degraded' : 'error'}
            icon={Wifi}
            sub={`${health.connections} client${health.connections !== 1 ? 's' : ''} connected`}
          />
          <InfraCard
            label="API Server"
            status="ok"
            icon={Clock}
            sub={`Uptime ${formatUptime(health.uptime)}`}
          />
        </div>
      </div>

      {/* Memory */}
      {health.memory && (
        <div className="bg-surface rounded-lg border border-border p-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">Memory</h2>
          <div className="space-y-3">
            <MemoryBar
              label="Heap"
              used={health.memory.heapUsedMb}
              total={health.memory.heapTotalMb}
            />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">RSS (resident set)</span>
              <span className="font-numeric text-slate-300">{health.memory.rssMb} MB</span>
            </div>
          </div>
        </div>
      )}

      {/* PM2 services */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Services (PM2) — {health.services?.filter((s) => s.status === 'running').length ?? 0} / {health.services?.length ?? 0} running
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {health.services?.map((svc) => <ServiceCard key={svc.name} svc={svc} />)}
        </div>
      </div>

      {/* Data feeds */}
      <div className="bg-surface rounded-lg border border-border">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Radio className="w-4 h-4 text-info" />
          <h2 className="text-sm font-medium text-slate-200">Data Feeds</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            stale &gt;5 min · dead &gt;15 min
          </span>
        </div>
        <div className="px-4">
          {health.feeds?.map((feed) => <FeedRow key={feed.name} feed={feed} />)}
        </div>
      </div>

      {/* Footer */}
      <div className="bg-surface rounded-lg border border-border px-4 py-3 flex flex-wrap gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          <span>{health.connections} WS client{health.connections !== 1 ? 's' : ''}</span>
        </div>
        {health.environment && (
          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" />
            <span>Env: <span className="text-slate-300 uppercase">{health.environment}</span></span>
          </div>
        )}
        <div className="ml-auto font-numeric">
          {health.timestamp ? new Date(health.timestamp).toLocaleTimeString() : '—'}
        </div>
      </div>
    </div>
  )
}
