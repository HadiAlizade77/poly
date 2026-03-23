import { useState, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { formatDistanceToNow } from 'date-fns'
import {
  ScrollText,
  Brain,
  ShoppingCart,
  Wallet,
  Shield,
  Power,
  Settings,
  Pause,
  Play,
  Trash2,
  ChevronDown,
  ChevronRight,
  RefreshCw,
  AlertTriangle,
  Activity,
} from 'lucide-react'
import { api } from '@/lib/api'
import { useSocket } from '@/hooks/useSocket'
import { Badge } from '@/components/ui/Badge'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'

// ─── Types ────────────────────────────────────────────────────────────────────

type EntityType =
  | 'ai_decision'
  | 'order'
  | 'trade'
  | 'position'
  | 'risk_event'
  | 'risk_config'
  | 'alert'
  | 'scorer_config'
  | 'bankroll'
  | 'system_config'

type ActionType =
  | 'ai_decision_trade'
  | 'ai_decision_hold'
  | 'ai_decision_vetoed'
  | 'ai_decision_executed'
  | 'order_created'
  | 'order_filled'
  | 'order_failed'
  | 'order_cancelled'
  | 'order_pending'
  | 'order_open'
  | 'order_expired'
  | 'trade_executed'
  | 'position_opened'
  | 'position_closed'
  | 'position_closed_manual'
  | 'risk_event'
  | 'kill_switch_toggled'
  | 'set_trading_state'
  | 'set_system_config'
  | 'set_risk_config'
  | 'risk_auto_tuned'
  | 'alert_created'
  | 'scorer_created'
  | 'scorer_toggled'
  | 'bankroll_updated'
  | 'bankroll_balance_set'
  | (string & {})

type Level = 'info' | 'success' | 'warning' | 'error'

interface AuditEntry {
  id: string
  timestamp: string
  action: ActionType
  entity_type: EntityType
  entity_id: string
  changes: Record<string, unknown>
  performed_by: string
}

interface AuditLogResponse {
  data: AuditEntry[]
  meta: {
    page: number
    pageSize: number
    total: number
    totalPages: number
  }
}

// ─── Action display config ────────────────────────────────────────────────────

interface ActionConfig {
  icon: React.ComponentType<{ className?: string }>
  label: string
  level: Level
}

const ACTION_CONFIG: Record<string, ActionConfig> = {
  ai_decision_trade:    { icon: Brain,        label: 'AI Decision: TRADE',      level: 'success' },
  ai_decision_hold:     { icon: Brain,        label: 'AI Decision: HOLD',       level: 'info'    },
  ai_decision_vetoed:   { icon: Shield,       label: 'Decision Vetoed',         level: 'warning' },
  ai_decision_executed: { icon: Brain,        label: 'Decision Executed',       level: 'success' },
  order_created:        { icon: ShoppingCart, label: 'Order Created',           level: 'info'    },
  order_filled:         { icon: ShoppingCart, label: 'Order Filled',            level: 'success' },
  order_failed:         { icon: ShoppingCart, label: 'Order Failed',            level: 'error'   },
  order_cancelled:      { icon: ShoppingCart, label: 'Order Cancelled',         level: 'info'    },
  order_pending:        { icon: ShoppingCart, label: 'Order Pending',           level: 'info'    },
  order_open:           { icon: ShoppingCart, label: 'Order Open',              level: 'info'    },
  order_expired:        { icon: ShoppingCart, label: 'Order Expired',           level: 'warning' },
  trade_executed:       { icon: ShoppingCart, label: 'Trade Executed',          level: 'success' },
  position_opened:      { icon: Wallet,       label: 'Position Opened',         level: 'success' },
  position_closed:      { icon: Wallet,       label: 'Position Closed',         level: 'info'    },
  position_closed_manual: { icon: Wallet,     label: 'Position Closed (Manual)', level: 'info'   },
  risk_event:           { icon: Shield,       label: 'Risk Event',              level: 'warning' },
  kill_switch_toggled:  { icon: Power,        label: 'Kill Switch Toggled',     level: 'warning' },
  set_trading_state:    { icon: Power,        label: 'Trading State Changed',   level: 'info'    },
  set_system_config:    { icon: Settings,     label: 'Config Updated',          level: 'info'    },
  set_risk_config:      { icon: Shield,       label: 'Risk Config Updated',     level: 'info'    },
  risk_auto_tuned:      { icon: Shield,       label: 'Risk Auto-Tuned',         level: 'info'    },
  alert_created:        { icon: AlertTriangle, label: 'Alert Created',          level: 'warning' },
  scorer_created:       { icon: Brain,        label: 'Scorer Created',          level: 'info'    },
  scorer_toggled:       { icon: Brain,        label: 'Scorer Toggled',          level: 'info'    },
  bankroll_updated:     { icon: Activity,     label: 'Bankroll Updated',        level: 'info'    },
  bankroll_balance_set: { icon: Activity,     label: 'Balance Set',             level: 'info'    },
}

const FALLBACK_CONFIG: ActionConfig = {
  icon: ScrollText,
  label: 'Event',
  level: 'info',
}

// ─── Entity type filter pills config ─────────────────────────────────────────

const ENTITY_FILTERS: { value: EntityType | ''; label: string }[] = [
  { value: '',               label: 'All'          },
  { value: 'ai_decision',   label: 'AI Decisions' },
  { value: 'order',         label: 'Orders'       },
  { value: 'trade',         label: 'Trades'       },
  { value: 'position',      label: 'Positions'    },
  { value: 'risk_event',    label: 'Risk Events'  },
  { value: 'risk_config',   label: 'Risk Config'  },
  { value: 'alert',         label: 'Alerts'       },
  { value: 'scorer_config', label: 'Scorers'      },
  { value: 'bankroll',      label: 'Bankroll'     },
  { value: 'system_config', label: 'System'       },
]

// ─── Level styling ────────────────────────────────────────────────────────────

const levelColor: Record<Level, string> = {
  info:    'text-slate-400',
  success: 'text-profit',
  warning: 'text-warning',
  error:   'text-loss',
}

const levelDot: Record<Level, string> = {
  info:    'bg-slate-500',
  success: 'bg-profit',
  warning: 'bg-warning',
  error:   'bg-loss',
}

const levelBadgeVariant: Record<Level, 'default' | 'success' | 'danger' | 'warning' | 'info'> = {
  info:    'default',
  success: 'success',
  warning: 'warning',
  error:   'danger',
}

// ─── Detail string builder ────────────────────────────────────────────────────

function buildDetailString(action: ActionType, changes: Record<string, unknown>): string | undefined {
  if (!changes || Object.keys(changes).length === 0) return undefined

  switch (action) {
    case 'ai_decision_trade':
    case 'ai_decision_hold':
    case 'ai_decision_executed': {
      const parts: string[] = []
      if (changes.category) parts.push(`Category: ${changes.category}`)
      if (changes.confidence != null) parts.push(`Confidence: ${Number(changes.confidence).toFixed(2)}`)
      if (changes.reasoning && typeof changes.reasoning === 'string') {
        parts.push(changes.reasoning.slice(0, 100) + (changes.reasoning.length > 100 ? '...' : ''))
      }
      return parts.join(' | ') || undefined
    }
    case 'ai_decision_vetoed': {
      const parts: string[] = []
      if (changes.category) parts.push(`Category: ${changes.category}`)
      const reason = changes.vetoReason ?? changes.veto_reason ?? changes.reason ?? changes.message
      if (reason) parts.push(String(reason).slice(0, 120))
      return parts.join(' | ') || undefined
    }
    case 'order_created':
    case 'order_filled':
    case 'order_pending': {
      const parts: string[] = []
      if (changes.side) parts.push(String(changes.side).toUpperCase())
      if (changes.outcome_token) parts.push(String(changes.outcome_token))
      if (changes.price != null) parts.push(`@ $${Number(changes.price).toFixed(4)}`)
      if (changes.size != null) parts.push(`size: ${Number(changes.size).toFixed(4)}`)
      return parts.join(' ') || undefined
    }
    case 'order_failed': {
      const reason = changes.error ?? changes.reason ?? changes.message
      return reason ? `Failed: ${String(reason).slice(0, 100)}` : undefined
    }
    case 'order_cancelled': {
      const reason = changes.reason ?? changes.message
      return reason ? `Reason: ${String(reason).slice(0, 100)}` : undefined
    }
    case 'trade_executed': {
      const parts: string[] = []
      if (changes.side) parts.push(String(changes.side).toUpperCase())
      if (changes.outcome_token) parts.push(String(changes.outcome_token))
      if (changes.entry_price != null) parts.push(`@ $${Number(changes.entry_price).toFixed(4)}`)
      if (changes.size != null) parts.push(`size: ${Number(changes.size).toFixed(4)}`)
      if (changes.fees != null) parts.push(`fees: $${Number(changes.fees).toFixed(4)}`)
      return parts.join(' ') || undefined
    }
    case 'position_opened':
    case 'position_closed':
    case 'position_closed_manual': {
      const parts: string[] = []
      if (changes.side) parts.push(String(changes.side).toUpperCase())
      if (changes.outcome_token) parts.push(String(changes.outcome_token))
      if (changes.close_reason) parts.push(`reason: ${changes.close_reason}`)
      if (changes.realized_pnl != null) parts.push(`P&L: $${Number(changes.realized_pnl).toFixed(4)}`)
      if (changes.entry_price != null && changes.exit_price != null)
        parts.push(`${Number(changes.entry_price).toFixed(4)} → ${Number(changes.exit_price).toFixed(4)}`)
      return parts.join(' ') || undefined
    }
    case 'risk_event': {
      const msg = changes.message ?? changes.event_type ?? changes.type
      const severity = changes.severity ? ` [${changes.severity}]` : ''
      return msg ? `${String(msg).slice(0, 120)}${severity}` : undefined
    }
    case 'kill_switch_toggled': {
      return changes.enabled ? 'Kill switch ENABLED' : 'Kill switch DISABLED'
    }
    case 'set_trading_state': {
      const parts: string[] = []
      if (changes.oldState) parts.push(`${changes.oldState}`)
      if (changes.newState) parts.push(`→ ${changes.newState}`)
      if (changes.reason) parts.push(`(${changes.reason})`)
      return parts.length > 0 ? parts.join(' ') : undefined
    }
    case 'risk_auto_tuned': {
      const parts: string[] = []
      if (changes.balance != null) parts.push(`Balance: $${Number(changes.balance).toFixed(2)}`)
      if (changes.tier) parts.push(`Tier: ${changes.tier}`)
      return parts.join(' | ') || undefined
    }
    case 'alert_created': {
      const parts: string[] = []
      if (changes.severity) parts.push(`[${String(changes.severity).toUpperCase()}]`)
      if (changes.title) parts.push(String(changes.title))
      if (changes.message) parts.push(String(changes.message).slice(0, 80))
      return parts.join(' ') || undefined
    }
    case 'scorer_created':
    case 'scorer_toggled': {
      const parts: string[] = []
      if (changes.category) parts.push(String(changes.category))
      if (changes.scorer_name) parts.push(String(changes.scorer_name))
      if (changes.is_enabled != null) parts.push(changes.is_enabled ? 'enabled' : 'disabled')
      return parts.join(' | ') || undefined
    }
    case 'bankroll_updated':
    case 'bankroll_balance_set': {
      const parts: string[] = []
      if (changes.total_balance != null) parts.push(`Total: $${Number(changes.total_balance).toFixed(2)}`)
      if (changes.active_balance != null) parts.push(`Active: $${Number(changes.active_balance).toFixed(2)}`)
      if (changes.balance != null) parts.push(`Set to: $${Number(changes.balance).toFixed(2)}`)
      return parts.join(' | ') || undefined
    }
    case 'set_system_config':
    case 'set_risk_config': {
      // Show the value if it's a simple key like TRADING_STATE or KILL_SWITCH_ENABLED
      if (changes.value != null && Object.keys(changes).length <= 2) {
        return `Value: ${String(changes.value)}`
      }
      const keys = Object.keys(changes)
      if (keys.length === 0) return undefined
      return `Updated: ${keys.slice(0, 4).join(', ')}${keys.length > 4 ? ` +${keys.length - 4} more` : ''}`
    }
    default:
      return undefined
  }
}

// ─── WebSocket channels that trigger a refetch ────────────────────────────────

const WS_CHANNELS = [
  'decision:new',
  'order:update',
  'position:update',
  'risk:event',
  'alert:new',
  'trading:state',
]

// ─── Skeleton loader ──────────────────────────────────────────────────────────

function ActivitySkeleton() {
  return (
    <div className="bg-surface rounded-lg border border-border divide-y divide-border">
      {Array.from({ length: 8 }).map((_, i) => (
        <div key={i} className="px-4 py-3 flex items-start gap-3 animate-pulse">
          <div className="w-1.5 h-1.5 rounded-full bg-slate-700 mt-2 shrink-0" />
          <div className="w-4 h-4 rounded bg-slate-700 mt-0.5 shrink-0" />
          <div className="flex-1 space-y-1.5">
            <div className="h-3.5 bg-slate-700 rounded w-2/5" />
            <div className="h-2.5 bg-slate-800 rounded w-3/5" />
          </div>
          <div className="h-2.5 bg-slate-800 rounded w-16 shrink-0" />
        </div>
      ))}
    </div>
  )
}

// ─── Page component ───────────────────────────────────────────────────────────

export default function ActivityLog() {
  const queryClient = useQueryClient()
  const { on } = useSocket()

  const [paused, setPaused] = useState(false)
  const [cleared, setCleared] = useState(false)
  const [entityFilter, setEntityFilter] = useState<EntityType | ''>('')
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [page, setPage] = useState(1)

  // ── Fetch persisted audit log from API ──
  const {
    data: queryResult,
    isLoading,
    isError,
    isFetching,
    refetch,
  } = useQuery<AuditEntry[]>({
    queryKey: ['audit-log', entityFilter, page],
    queryFn: () => {
      const params = new URLSearchParams()
      params.set('page', String(page))
      params.set('pageSize', '100')
      if (entityFilter) params.set('entityType', entityFilter)
      return api.get<AuditEntry[]>(`/api/audit-log?${params.toString()}`)
    },
    refetchInterval: paused ? false : 15_000,
    staleTime: 10_000,
  })

  const entries = cleared ? [] : (queryResult ?? [])

  // ── WebSocket: invalidate query on any relevant event ──
  useEffect(() => {
    const unsubscribers: (() => void)[] = []

    for (const channel of WS_CHANNELS) {
      const unsub = on(channel, () => {
        if (paused) return
        // Refetch instead of trying to transform WS payload format
        queryClient.invalidateQueries({ queryKey: ['audit-log'] })
      })
      unsubscribers.push(unsub)
    }

    return () => unsubscribers.forEach((fn) => fn())
  }, [on, queryClient, paused])

  // Reset cleared flag when filter or page changes (user wants fresh data)
  useEffect(() => {
    setCleared(false)
  }, [entityFilter, page])

  // Entity type counts for filter pills
  const entityCounts = useMemo(() => {
    const counts: Partial<Record<EntityType, number>> = {}
    for (const e of queryResult ?? []) {
      counts[e.entity_type] = (counts[e.entity_type] ?? 0) + 1
    }
    return counts
  }, [queryResult])

  const totalFromQuery = entries.length

  return (
    <div className="space-y-4">
      <PageHeader
        title="Activity Log"
        subtitle={
          isLoading
            ? 'Loading events...'
            : isError
            ? 'Failed to load events'
            : `${totalFromQuery} events${paused ? ' (paused)' : ''}${isFetching && !isLoading ? ' — refreshing...' : ''}`
        }
        actions={
          <div className="flex items-center gap-2">
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 border border-border text-slate-400 hover:text-slate-200 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
              title="Refresh now"
            >
              <RefreshCw className={cn('w-3.5 h-3.5', isFetching && 'animate-spin')} />
            </button>
            <button
              onClick={() => setPaused((p) => !p)}
              className={cn(
                'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors border',
                paused
                  ? 'bg-warning/10 border-warning/30 text-warning'
                  : 'bg-surface-2 border-border text-slate-400 hover:text-slate-200',
              )}
            >
              {paused ? (
                <Play className="w-3.5 h-3.5" />
              ) : (
                <Pause className="w-3.5 h-3.5" />
              )}
              {paused ? 'Resume' : 'Pause'}
            </button>
            <button
              onClick={() => setCleared(true)}
              title="Clear view (does not delete from database)"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 border border-border text-slate-400 hover:text-slate-200 transition-colors"
            >
              <Trash2 className="w-3.5 h-3.5" />
              Clear
            </button>
          </div>
        }
      />

      {/* Entity type filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {ENTITY_FILTERS.map(({ value, label }) => {
          const count = value === '' ? (queryResult?.length ?? 0) : (entityCounts[value] ?? 0)
          const isActive = entityFilter === value
          return (
            <button
              key={value || '__all__'}
              onClick={() => {
                setEntityFilter(value)
                setPage(1)
                setCleared(false)
              }}
              className={cn(
                'flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium transition-colors',
                isActive
                  ? 'bg-info/20 text-info'
                  : 'text-muted-foreground hover:text-slate-300 hover:bg-surface-2',
              )}
            >
              {label}
              {count > 0 && (
                <span className="font-numeric text-xs opacity-60">{count}</span>
              )}
            </button>
          )
        })}
      </div>

      {/* Log feed */}
      {isLoading ? (
        <ActivitySkeleton />
      ) : isError ? (
        <div className="bg-surface rounded-lg border border-border flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Shield className="w-8 h-8 mb-3 opacity-50 text-loss" />
          <p className="text-sm text-loss">Failed to load audit log</p>
          <p className="text-xs mt-1">Check backend connectivity and try again</p>
          <button
            onClick={() => refetch()}
            className="mt-4 px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 border border-border text-slate-400 hover:text-slate-200 transition-colors"
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="bg-surface rounded-lg border border-border divide-y divide-border max-h-[calc(100vh-280px)] overflow-y-auto">
          {entries.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
              <ScrollText className="w-8 h-8 mb-3 opacity-50" />
              <p className="text-sm">No events found</p>
              <p className="text-xs mt-1">
                {cleared
                  ? 'View cleared — resume or change filter to reload'
                  : entityFilter
                  ? `No ${entityFilter} events recorded yet`
                  : 'Events will appear here as the system operates'}
              </p>
              {cleared && (
                <button
                  onClick={() => setCleared(false)}
                  className="mt-4 px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 border border-border text-slate-400 hover:text-slate-200 transition-colors"
                >
                  Reload events
                </button>
              )}
            </div>
          ) : (
            <>
              {entries.map((entry) => {
                const config = ACTION_CONFIG[entry.action] ?? FALLBACK_CONFIG
                const Icon = config.icon
                const level = config.level
                const isExpanded = expandedId === entry.id
                const detail = buildDetailString(entry.action, entry.changes ?? {})
                const timeAgo = (() => {
                  try {
                    return formatDistanceToNow(new Date(entry.timestamp), { addSuffix: true })
                  } catch {
                    return entry.timestamp
                  }
                })()

                return (
                  <div
                    key={entry.id}
                    onClick={() => setExpandedId(isExpanded ? null : entry.id)}
                    className="px-4 py-2.5 hover:bg-surface-2/50 cursor-pointer transition-colors"
                  >
                    <div className="flex items-start gap-3">
                      <span
                        className={cn(
                          'w-1.5 h-1.5 rounded-full mt-2 shrink-0',
                          levelDot[level],
                        )}
                      />
                      <Icon
                        className={cn(
                          'w-4 h-4 mt-0.5 shrink-0',
                          levelColor[level],
                        )}
                      />
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className={cn('text-sm font-medium', levelColor[level])}>
                            {config.label}
                          </span>
                          <Badge
                            variant={levelBadgeVariant[level]}
                            className="text-[10px] px-1.5 py-0"
                          >
                            {entry.entity_type}
                          </Badge>
                          {entry.entity_id && (
                            <span className="text-[10px] text-muted-foreground font-numeric">
                              #{entry.entity_id}
                            </span>
                          )}
                          {entry.performed_by && (
                            <span className="text-[10px] text-muted-foreground">
                              by {entry.performed_by}
                            </span>
                          )}
                        </div>
                        {detail && (
                          <p className="text-xs text-muted-foreground mt-0.5 line-clamp-1">
                            {detail}
                          </p>
                        )}
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        <span
                          className="text-xs text-muted-foreground font-numeric tabular-nums"
                          title={entry.timestamp}
                        >
                          {timeAgo}
                        </span>
                        {isExpanded ? (
                          <ChevronDown className="w-3 h-3 text-muted-foreground" />
                        ) : (
                          <ChevronRight className="w-3 h-3 text-muted-foreground opacity-0 group-hover:opacity-100" />
                        )}
                      </div>
                    </div>

                    {/* Expanded raw changes JSON */}
                    {isExpanded && (
                      <pre className="mt-2 ml-8 text-xs text-slate-400 bg-surface-2 rounded p-3 overflow-x-auto max-h-48 leading-relaxed">
                        {JSON.stringify(entry.changes, null, 2)}
                      </pre>
                    )}
                  </div>
                )
              })}

              {/* Load more / pagination */}
              {entries.length >= 100 && (
                <div className="px-4 py-3 flex items-center justify-center gap-3">
                  {page > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        setPage((p) => Math.max(1, p - 1))
                      }}
                      className="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 border border-border text-slate-400 hover:text-slate-200 transition-colors"
                    >
                      Previous
                    </button>
                  )}
                  <span className="text-xs text-muted-foreground font-numeric">
                    Page {page}
                  </span>
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setPage((p) => p + 1)
                      setCleared(false)
                    }}
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 border border-border text-slate-400 hover:text-slate-200 transition-colors"
                  >
                    Load more
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
