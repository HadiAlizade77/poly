import React from 'react'
import { useSearchParams } from 'react-router-dom'
import { type ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow, format, formatDuration, intervalToDuration } from 'date-fns'
import { X, ShoppingCart, ExternalLink, Wallet, Check, AlertTriangle, Power, Shield, Brain } from 'lucide-react'
import { toast } from 'sonner'
import { useOrders } from '@/hooks/useOrders'
import { usePositions, usePositionHistory, useClosePosition } from '@/hooks/usePositions'
import { useDecisions } from '@/hooks/useDecisions'
import { useRiskConfig } from '@/hooks/useRiskConfig'
import { useBankroll } from '@/hooks/useBankroll'
import { useAppStore } from '@/stores/app.store'
import { DataTable } from '@/components/ui/DataTable'
import { OrderStatusBadge } from '@/components/ui/StatusBadge'
import { Badge } from '@/components/ui/Badge'
import { PnlDisplay } from '@/components/ui/PnlDisplay'
import { PriceDisplay } from '@/components/ui/PriceDisplay'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'
import type {
  Order,
  OrderStatus,
  OrderSide,
  Position,
  PositionHistory,
  ExitStrategy,
  PositionSide,
  CloseReason,
} from '@polymarket/shared'

// ─── trading context bar ──────────────────────────────────────────────────────

function TradingContextBar() {
  const { data: decisions } = useDecisions({ limit: 1 })
  const { data: config } = useRiskConfig()
  const { data: bankroll } = useBankroll()
  const tradingState = useAppStore((s) => s.tradingState)

  const lastDecision = decisions?.[0]
  const currentExposure = Number(bankroll?.deployed_balance ?? 0)
  const maxExposure = Number(config?.max_total_exposure ?? 0)
  const exposurePct = maxExposure > 0 ? Math.min(100, (currentExposure / maxExposure) * 100) : 0

  const stateDisplay: Record<string, { label: string; color: string; bg: string; border: string }> = {
    running:       { label: 'Trading Active',       color: 'text-profit',  bg: 'bg-profit/10', border: 'border-profit/30' },
    stopped:       { label: 'Trading Stopped',      color: 'text-loss',    bg: 'bg-loss/10',   border: 'border-loss/30'   },
    paused_all:    { label: 'Trading Paused',       color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30' },
    paused_sells:  { label: 'Sells Paused',         color: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30' },
  }
  const sd = stateDisplay[tradingState] ?? stateDisplay.stopped

  return (
    <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
      {/* Trading State Status */}
      <div className={cn(
        'flex items-center gap-2 px-3 py-2 rounded-md border text-sm',
        sd.bg, sd.border, sd.color
      )}>
        <Power className="w-4 h-4 shrink-0" />
        <span className="font-medium">{sd.label}</span>
      </div>

      {/* Exposure Gauge (inline) */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface">
        <Shield className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex justify-between text-xs mb-1">
            <span className="text-muted-foreground">Exposure</span>
            <span className={cn(
              'font-numeric',
              exposurePct >= 80 ? 'text-loss' : exposurePct >= 60 ? 'text-warning' : 'text-slate-300'
            )}>
              {Math.round(exposurePct)}%
            </span>
          </div>
          <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
            <div
              className={cn(
                'h-full rounded-full transition-all',
                exposurePct >= 80 ? 'bg-loss' : exposurePct >= 60 ? 'bg-warning' : 'bg-profit'
              )}
              style={{ width: `${exposurePct}%` }}
            />
          </div>
        </div>
      </div>

      {/* Last AI Decision */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface">
        <Brain className="w-4 h-4 text-info shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Last Decision</p>
          {lastDecision ? (
            <div className="flex items-center gap-1.5">
              <span className={cn(
                'text-sm font-medium',
                lastDecision.action === 'trade' ? 'text-profit' : 'text-muted-foreground'
              )}>
                {lastDecision.action.toUpperCase()}
              </span>
              {lastDecision.regime_assessment && (
                <span className="text-xs text-muted-foreground truncate">· {lastDecision.regime_assessment}</span>
              )}
            </div>
          ) : (
            <span className="text-xs text-muted-foreground">No decisions yet</span>
          )}
        </div>
      </div>

      {/* Available Balance */}
      <div className="flex items-center gap-2 px-3 py-2 rounded-md border border-border bg-surface">
        <Wallet className="w-4 h-4 text-muted-foreground shrink-0" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Available</p>
          <span className="text-sm font-numeric text-slate-200">
            {bankroll
              ? `$${Number(bankroll.active_balance).toLocaleString('en-US', { maximumFractionDigits: 2 })}`
              : '—'}
          </span>
        </div>
      </div>
    </div>
  )
}

// ─── orders helpers ───────────────────────────────────────────────────────────

const STATUS_OPTIONS: { value: OrderStatus | ''; label: string }[] = [
  { value: '', label: 'All Status' },
  { value: 'open', label: 'Open' },
  { value: 'pending', label: 'Pending' },
  { value: 'partial', label: 'Partial' },
  { value: 'filled', label: 'Filled' },
  { value: 'cancelled', label: 'Cancelled' },
  { value: 'failed', label: 'Failed' },
  { value: 'expired', label: 'Expired' },
]

function SideBadge({ side }: { side: OrderSide }) {
  return <Badge variant={side === 'buy' ? 'success' : 'danger'}>{side.toUpperCase()}</Badge>
}

function FillBar({ filled, total }: { filled: number | string; total: number | string }) {
  const pct = Number(total) > 0 ? Math.min(100, (Number(filled) / Number(total)) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', pct === 100 ? 'bg-profit' : 'bg-info')} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-numeric text-muted-foreground w-7 text-right">{Math.round(pct)}%</span>
    </div>
  )
}

// ─── order drawer ─────────────────────────────────────────────────────────────

function OrderDrawer({ order, onClose }: { order: Order; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex">
      <div className="flex-1 bg-black/40" onClick={onClose} />
      <div className="w-full max-w-md bg-surface border-l border-border overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border sticky top-0 bg-surface z-10">
          <div className="flex items-center gap-2">
            <ShoppingCart className="w-4 h-4 text-info" />
            <span className="text-sm font-medium text-slate-200">Order Detail</span>
          </div>
          <button onClick={onClose} className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-surface-2">
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="p-4 space-y-5">
          {/* Status + side */}
          <div className="flex items-center gap-2 flex-wrap">
            <OrderStatusBadge status={order.status} />
            <SideBadge side={order.side} />
            {order.order_type && <Badge variant="outline">{order.order_type.toUpperCase()}</Badge>}
            {order.maker_or_taker && <Badge variant="outline">{order.maker_or_taker}</Badge>}
          </div>

          {/* Price / size grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Price',     value: <PriceDisplay value={order.price} decimals={4} className="text-slate-200" /> },
              { label: 'Size',      value: <span className="font-numeric text-slate-200">{Number(order.size).toFixed(6)}</span> },
              { label: 'Filled',    value: <span className="font-numeric text-profit">{Number(order.filled_size).toFixed(6)}</span> },
              { label: 'Avg Fill',  value: <PriceDisplay value={order.avg_fill_price} decimals={4} className="text-slate-200" /> },
              { label: 'Fees Paid', value: <span className="font-numeric text-muted-foreground">${Number(order.fees_paid).toFixed(6)}</span> },
              { label: 'Fill %',    value: <span className="font-numeric">{Number(order.size) > 0 ? ((Number(order.filled_size) / Number(order.size)) * 100).toFixed(1) : '0'}%</span> },
            ].map(({ label, value }) => (
              <div key={label} className="bg-surface-2 rounded px-3 py-2">
                <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                {value}
              </div>
            ))}
          </div>

          {/* Outcome token */}
          <div>
            <p className="text-xs text-muted-foreground mb-1">Outcome Token</p>
            <p className="font-mono text-sm text-slate-300 break-all">{order.outcome_token}</p>
          </div>

          {/* Polymarket order ID */}
          {order.polymarket_order_id && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Polymarket Order ID</p>
              <div className="flex items-center gap-2">
                <p className="font-mono text-xs text-info break-all">{order.polymarket_order_id}</p>
                <ExternalLink className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
              </div>
            </div>
          )}

          {/* Decision link */}
          {order.decision_id && (
            <div className="bg-surface-2 rounded px-3 py-2">
              <p className="text-xs text-muted-foreground mb-0.5">Linked Decision</p>
              <p className="font-mono text-xs text-info">{order.decision_id}</p>
            </div>
          )}

          {/* Error */}
          {order.error_message && (
            <div className="bg-loss/10 border border-loss/20 rounded px-3 py-2">
              <p className="text-xs text-loss font-medium mb-0.5">Error</p>
              <p className="text-xs text-slate-300">{order.error_message}</p>
            </div>
          )}

          {/* Timestamps */}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
            <p>Created: <span className="text-slate-300">{format(new Date(order.created_at), 'MMM d, yyyy HH:mm:ss')}</span></p>
            {order.filled_at && <p>Filled: <span className="text-slate-300">{format(new Date(order.filled_at), 'MMM d, yyyy HH:mm:ss')}</span></p>}
            {order.cancelled_at && <p>Cancelled: <span className="text-slate-300">{format(new Date(order.cancelled_at), 'MMM d, yyyy HH:mm:ss')}</span></p>}
            {order.placement_latency_ms != null && <p>Placement latency: <span className="font-numeric text-slate-300">{order.placement_latency_ms} ms</span></p>}
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── orders columns ───────────────────────────────────────────────────────────

const orderColumns: ColumnDef<Order, unknown>[] = [
  {
    id: 'created_at', accessorKey: 'created_at', header: 'Time', size: 120,
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(getValue() as Date), { addSuffix: true })}</span>
    ),
  },
  {
    id: 'side', accessorKey: 'side', header: 'Side', size: 70,
    cell: ({ getValue }) => <SideBadge side={getValue() as OrderSide} />,
  },
  {
    id: 'outcome_token', accessorKey: 'outcome_token', header: 'Outcome', size: 100,
    cell: ({ getValue }) => (
      <span className="text-sm font-mono text-slate-300 truncate block max-w-[90px]">{getValue() as string}</span>
    ),
  },
  {
    id: 'order_type', accessorKey: 'order_type', header: 'Type', size: 65,
    cell: ({ getValue }) => { const v = getValue() as string | undefined; return v ? <Badge variant="outline">{v.toUpperCase()}</Badge> : null },
  },
  {
    id: 'price', accessorKey: 'price', header: 'Price', size: 75,
    cell: ({ getValue }) => <PriceDisplay value={getValue() as number} decimals={3} className="text-slate-200" />,
  },
  {
    id: 'size', accessorKey: 'size', header: 'Size', size: 75,
    cell: ({ getValue }) => <span className="font-numeric text-slate-300">{Number(getValue()).toFixed(4)}</span>,
  },
  {
    id: 'filled', header: 'Filled', size: 110,
    cell: ({ row }) => <FillBar filled={row.original.filled_size} total={row.original.size} />,
  },
  {
    id: 'avg_fill_price', accessorKey: 'avg_fill_price', header: 'Avg Fill', size: 75,
    cell: ({ getValue }) => <PriceDisplay value={getValue() as number | null} decimals={3} className="text-slate-300" />,
  },
  {
    id: 'fees_paid', accessorKey: 'fees_paid', header: 'Fees', size: 65,
    cell: ({ getValue }) => <span className="font-numeric text-muted-foreground text-xs">${Number(getValue()).toFixed(4)}</span>,
  },
  {
    id: 'status', accessorKey: 'status', header: 'Status', size: 95,
    cell: ({ getValue }) => <OrderStatusBadge status={getValue() as OrderStatus} />,
  },
  {
    id: 'polymarket_order_id', accessorKey: 'polymarket_order_id', header: 'PM Order ID', size: 120,
    cell: ({ getValue }) => {
      const v = getValue() as string | null
      return v
        ? <span className="font-mono text-xs text-info truncate block max-w-[110px]">{v}</span>
        : <span className="text-muted-foreground">—</span>
    },
  },
]

// ─── orders tab ───────────────────────────────────────────────────────────────

function OrdersTab() {
  const [statusFilter, setStatusFilter] = React.useState<OrderStatus | ''>('')
  const [sideFilter, setSideFilter] = React.useState<OrderSide | ''>('')
  const [selected, setSelected] = React.useState<Order | null>(null)

  const { data: orders, isLoading } = useOrders({ status: statusFilter || undefined })

  const filtered = React.useMemo(() => {
    if (!orders) return []
    if (!sideFilter) return orders
    return orders.filter((o) => o.side === sideFilter)
  }, [orders, sideFilter])

  const counts = React.useMemo(() => {
    if (!orders) return {} as Record<string, number>
    return orders.reduce<Record<string, number>>((acc, o) => {
      acc[o.status] = (acc[o.status] ?? 0) + 1
      return acc
    }, {})
  }, [orders])

  return (
    <div className="space-y-4">
      {/* Quick stat pills */}
      {orders && (
        <div className="flex flex-wrap gap-2">
          {(['open', 'partial', 'filled', 'failed'] as OrderStatus[]).map((s) =>
            counts[s] ? (
              <button
                key={s}
                onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
                className={cn('px-2.5 py-1 rounded-full text-xs font-medium transition-colors', statusFilter === s ? 'ring-1 ring-info' : '')}
              >
                <OrderStatusBadge status={s} />
                <span className="ml-1.5 font-numeric">{counts[s]}</span>
              </button>
            ) : null
          )}
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as OrderStatus | '')}
          className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-info"
        >
          {STATUS_OPTIONS.map(({ value, label }) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select
          value={sideFilter}
          onChange={(e) => setSideFilter(e.target.value as OrderSide | '')}
          className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-info"
        >
          <option value="">All Sides</option>
          <option value="buy">Buy</option>
          <option value="sell">Sell</option>
        </select>
        {(statusFilter || sideFilter) && (
          <button
            onClick={() => { setStatusFilter(''); setSideFilter('') }}
            className="px-3 py-2 text-sm text-muted-foreground hover:text-slate-200 hover:bg-surface-2 rounded-md transition-colors"
          >
            Clear
          </button>
        )}
      </div>

      {filtered.length === 0 && !isLoading ? (
        <EmptyState
          icon={<ShoppingCart className="w-6 h-6 text-muted-foreground" />}
          title="No orders found"
          message="Orders appear here once the trading engine places them."
        />
      ) : (
        <DataTable
          columns={orderColumns}
          data={filtered}
          loading={isLoading}
          pageSize={30}
          getRowId={(row) => row.id}
          onRowClick={(row) => setSelected(row.original)}
          emptyMessage="No orders match current filters"
        />
      )}

      {selected && <OrderDrawer order={selected} onClose={() => setSelected(null)} />}
    </div>
  )
}

// ─── positions helpers ────────────────────────────────────────────────────────

const EXIT_STRATEGY_LABELS: Record<ExitStrategy, string> = {
  resolution_only: 'Resolution',
  stop_loss:       'Stop Loss',
  time_based:      'Time',
  manual:          'Manual',
}

const CLOSE_REASON_VARIANTS: Record<CloseReason, 'success' | 'danger' | 'warning' | 'info' | 'default'> = {
  resolution: 'success',
  stop_loss:  'danger',
  time_exit:  'warning',
  manual:     'info',
  risk_veto:  'danger',
}

const CLOSE_REASON_LABELS: Record<CloseReason, string> = {
  resolution: 'Resolution',
  stop_loss:  'Stop Loss',
  time_exit:  'Time Exit',
  manual:     'Manual',
  risk_veto:  'Risk Veto',
}

function ExitStrategyBadge({ strategy }: { strategy: ExitStrategy }) {
  const variant = strategy === 'stop_loss' ? 'danger' : strategy === 'time_based' ? 'warning' : strategy === 'manual' ? 'info' : 'default'
  return <Badge variant={variant}>{EXIT_STRATEGY_LABELS[strategy]}</Badge>
}

function humanDuration(ms: number): string {
  const d = intervalToDuration({ start: 0, end: ms })
  return formatDuration(d, { format: ['days', 'hours', 'minutes'], zero: false }) || '<1 min'
}

// ─── close position button ────────────────────────────────────────────────────

function CloseButton({ positionId, unrealizedPnl }: { positionId: string; unrealizedPnl: number | null }) {
  const [confirming, setConfirming] = React.useState(false)
  const close = useClosePosition()

  if (confirming) {
    return (
      <div className="flex items-center gap-1">
        {unrealizedPnl != null && unrealizedPnl < 0 && (
          <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />
        )}
        <button
          onClick={() =>
            close.mutate(positionId, {
              onSuccess: () => { setConfirming(false); toast.success('Position closed') },
              onError:   () => { setConfirming(false); toast.error('Failed to close') },
            })
          }
          disabled={close.isPending}
          className="p-1 rounded text-profit hover:text-profit/80 disabled:opacity-50"
          title="Confirm close"
        >
          <Check className="w-4 h-4" />
        </button>
        <button onClick={() => setConfirming(false)} className="p-1 rounded text-muted-foreground hover:text-slate-300" title="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <button
      onClick={() => setConfirming(true)}
      className="px-2.5 py-1 text-xs rounded-md bg-surface-2 text-slate-400 hover:text-loss hover:bg-loss/10 border border-border hover:border-loss/30 transition-colors"
    >
      Close
    </button>
  )
}

// ─── open positions columns ───────────────────────────────────────────────────

const openColumns: ColumnDef<Position, unknown>[] = [
  {
    id: 'opened_at', accessorKey: 'opened_at', header: 'Opened', size: 120,
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(getValue() as Date), { addSuffix: true })}</span>
    ),
  },
  {
    id: 'outcome_token', accessorKey: 'outcome_token', header: 'Outcome', size: 110,
    cell: ({ getValue }) => (
      <span className="font-mono text-xs text-slate-300 block truncate max-w-[100px]">{getValue() as string}</span>
    ),
  },
  {
    id: 'side', accessorKey: 'side', header: 'Side', size: 70,
    cell: ({ getValue }) => {
      const s = getValue() as PositionSide
      return <Badge variant={s === 'long' ? 'success' : 'danger'}>{s.toUpperCase()}</Badge>
    },
  },
  {
    id: 'size', accessorKey: 'size', header: 'Size', size: 75,
    cell: ({ getValue }) => <span className="font-numeric text-slate-200">{Number(getValue()).toFixed(4)}</span>,
  },
  {
    id: 'avg_entry_price', accessorKey: 'avg_entry_price', header: 'Entry', size: 75,
    cell: ({ getValue }) => <PriceDisplay value={getValue() as number} decimals={3} className="text-slate-300" />,
  },
  {
    id: 'current_price', accessorKey: 'current_price', header: 'Current', size: 75,
    cell: ({ row }) => {
      const c = row.original.current_price
      const e = row.original.avg_entry_price
      return (
        <PriceDisplay
          value={c}
          decimals={3}
          className={cn(
            c != null && c > e ? 'text-profit' : c != null && c < e ? 'text-loss' : 'text-slate-300'
          )}
        />
      )
    },
  },
  {
    id: 'unrealized_pnl', accessorKey: 'unrealized_pnl', header: 'Unreal. P&L', size: 110,
    cell: ({ getValue }) => {
      const v = getValue() as number | null
      return v != null ? <PnlDisplay value={v} showIcon /> : <span className="text-muted-foreground">—</span>
    },
  },
  {
    id: 'realized_pnl', accessorKey: 'realized_pnl', header: 'Real. P&L', size: 95,
    cell: ({ getValue }) => <PnlDisplay value={getValue() as number} />,
  },
  {
    id: 'exit_strategy', accessorKey: 'exit_strategy', header: 'Exit', size: 100,
    cell: ({ getValue }) => <ExitStrategyBadge strategy={getValue() as ExitStrategy} />,
  },
  {
    id: 'stop_loss_price', accessorKey: 'stop_loss_price', header: 'Stop', size: 75,
    cell: ({ getValue }) => <PriceDisplay value={getValue() as number | null} decimals={3} className="text-loss" />,
  },
  {
    id: 'actions', header: '', size: 80,
    cell: ({ row }) => <CloseButton positionId={row.original.id} unrealizedPnl={row.original.unrealized_pnl} />,
  },
]

// ─── open positions tab ───────────────────────────────────────────────────────

function OpenPositionsTab({ positions, isLoading }: { positions: Position[] | undefined; isLoading: boolean }) {
  const totalUnrealized = positions?.reduce((s, p) => s + Number(p.unrealized_pnl ?? 0), 0) ?? 0
  const totalRealized   = positions?.reduce((s, p) => s + Number(p.realized_pnl), 0) ?? 0
  const totalFees       = positions?.reduce((s, p) => s + Number(p.total_fees), 0) ?? 0
  const longCount       = positions?.filter((p) => p.side === 'long').length ?? 0
  const shortCount      = positions?.filter((p) => p.side === 'short').length ?? 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Unrealized P&L" loading={isLoading} value={<PnlDisplay value={totalUnrealized} size="lg" showIcon />} />
        <StatCard label="Realized P&L"   loading={isLoading} value={<PnlDisplay value={totalRealized}   size="lg" showIcon />} />
        <StatCard label="Total Fees"     loading={isLoading} value={<span className="font-numeric text-muted-foreground">${Number(totalFees).toFixed(4)}</span>} />
        <StatCard
          label="Long / Short"
          loading={isLoading}
          value={
            <span>
              <span className="text-profit font-numeric">{longCount}</span>
              <span className="text-muted-foreground mx-1">/</span>
              <span className="text-loss font-numeric">{shortCount}</span>
            </span>
          }
        />
      </div>

      {positions?.length === 0 && !isLoading ? (
        <EmptyState
          icon={<Wallet className="w-6 h-6 text-muted-foreground" />}
          title="No positions"
          message="Positions appear once trades execute."
        />
      ) : (
        <DataTable
          columns={openColumns}
          data={positions ?? []}
          loading={isLoading}
          pageSize={20}
          getRowId={(r) => r.id}
        />
      )}
    </div>
  )
}

// ─── history columns ──────────────────────────────────────────────────────────

const historyColumns: ColumnDef<PositionHistory, unknown>[] = [
  {
    id: 'closed_at', accessorKey: 'closed_at', header: 'Closed', size: 120,
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(getValue() as Date), { addSuffix: true })}</span>
    ),
  },
  {
    id: 'outcome_token', accessorKey: 'outcome_token', header: 'Outcome', size: 110,
    cell: ({ getValue }) => (
      <span className="font-mono text-xs text-slate-300 block truncate max-w-[100px]">{getValue() as string}</span>
    ),
  },
  {
    id: 'side', accessorKey: 'side', header: 'Side', size: 70,
    cell: ({ getValue }) => {
      const s = getValue() as PositionSide
      return <Badge variant={s === 'long' ? 'success' : 'danger'}>{s.toUpperCase()}</Badge>
    },
  },
  {
    id: 'size', accessorKey: 'size', header: 'Size', size: 75,
    cell: ({ getValue }) => <span className="font-numeric text-slate-300">{Number(getValue()).toFixed(4)}</span>,
  },
  {
    id: 'avg_entry_price', accessorKey: 'avg_entry_price', header: 'Entry', size: 75,
    cell: ({ getValue }) => <PriceDisplay value={getValue() as number} decimals={3} className="text-slate-300" />,
  },
  {
    id: 'avg_exit_price', accessorKey: 'avg_exit_price', header: 'Exit', size: 75,
    cell: ({ getValue }) => <PriceDisplay value={getValue() as number | null} decimals={3} className="text-slate-300" />,
  },
  {
    id: 'realized_pnl', accessorKey: 'realized_pnl', header: 'Realized P&L', size: 110,
    cell: ({ getValue }) => <PnlDisplay value={getValue() as number} showIcon />,
  },
  {
    id: 'total_fees', accessorKey: 'total_fees', header: 'Fees', size: 70,
    cell: ({ getValue }) => <span className="font-numeric text-muted-foreground text-xs">${Number(getValue()).toFixed(4)}</span>,
  },
  {
    id: 'close_reason', accessorKey: 'close_reason', header: 'Close Reason', size: 110,
    cell: ({ getValue }) => {
      const r = getValue() as CloseReason
      return <Badge variant={CLOSE_REASON_VARIANTS[r]}>{CLOSE_REASON_LABELS[r]}</Badge>
    },
  },
  {
    id: 'duration', header: 'Duration', size: 100,
    cell: ({ row }) => {
      const ms = new Date(row.original.closed_at).getTime() - new Date(row.original.opened_at).getTime()
      return <span className="text-xs text-muted-foreground">{humanDuration(ms)}</span>
    },
  },
  {
    id: 'regime_at_entry', accessorKey: 'regime_at_entry', header: 'Regime', size: 90,
    cell: ({ getValue }) => {
      const v = getValue() as string | null
      return v ? <Badge variant="default">{v}</Badge> : <span className="text-muted-foreground">—</span>
    },
  },
]

// ─── history tab ──────────────────────────────────────────────────────────────

function HistoryTab() {
  const { data: history, isLoading, isError } = usePositionHistory()

  if (isError) {
    return <EmptyState title="History unavailable" message="Position history endpoint is not available yet." />
  }

  const totalPnl  = history?.reduce((s, p) => s + Number(p.realized_pnl), 0) ?? 0
  const winCount  = history?.filter((p) => Number(p.realized_pnl) > 0).length ?? 0
  const lossCount = history?.filter((p) => Number(p.realized_pnl) < 0).length ?? 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Closed Positions"  loading={isLoading} value={history?.length ?? '—'} />
        <StatCard label="Total Realized P&L" loading={isLoading} value={<PnlDisplay value={totalPnl} size="lg" showIcon />} />
        <StatCard label="Wins"   loading={isLoading} value={<span className="text-profit font-numeric">{winCount}</span>} />
        <StatCard label="Losses" loading={isLoading} value={<span className="text-loss font-numeric">{lossCount}</span>} />
      </div>

      {history?.length === 0 && !isLoading ? (
        <EmptyState
          icon={<Wallet className="w-6 h-6 text-muted-foreground" />}
          title="No closed positions"
          message="Closed positions will appear here."
        />
      ) : (
        <DataTable
          columns={historyColumns}
          data={history ?? []}
          loading={isLoading}
          pageSize={25}
          getRowId={(r) => r.id}
        />
      )}
    </div>
  )
}

// ─── tab config ───────────────────────────────────────────────────────────────

const TAB_KEYS = ['orders', 'positions', 'history'] as const
type TabKey = typeof TAB_KEYS[number]

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Trading() {
  const [searchParams, setSearchParams] = useSearchParams()
  const rawTab = searchParams.get('tab') ?? 'orders'
  const activeTab: TabKey = (TAB_KEYS as readonly string[]).includes(rawTab) ? (rawTab as TabKey) : 'orders'

  const { data: orders } = useOrders({})
  const { data: positions, isLoading: positionsLoading } = usePositions()

  function switchTab(key: TabKey) {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev)
      next.set('tab', key)
      return next
    })
  }

  const subtitle =
    activeTab === 'orders'
      ? orders != null ? `${orders.length} orders` : 'Loading…'
      : activeTab === 'positions'
        ? positions != null ? `${positions.length} open position${positions.length !== 1 ? 's' : ''}` : 'Loading…'
        : 'Closed position history'

  const tabs: { key: TabKey; label: string; badge?: number }[] = [
    { key: 'orders',    label: 'Orders',         badge: orders?.length },
    { key: 'positions', label: 'Open Positions',  badge: positions?.length },
    { key: 'history',   label: 'History' },
  ]

  return (
    <div className="space-y-4">
      <PageHeader title="Trading" subtitle={subtitle} />

      <TradingContextBar />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border">
        {tabs.map((tab) => (
          <button
            key={tab.key}
            onClick={() => switchTab(tab.key)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              activeTab === tab.key
                ? 'border-info text-info'
                : 'border-transparent text-muted-foreground hover:text-slate-300',
            )}
          >
            {tab.label}
            {tab.badge != null && (
              <span className={cn('ml-1.5 text-xs font-numeric', activeTab === tab.key ? 'text-info' : 'text-muted-foreground')}>
                {tab.badge}
              </span>
            )}
          </button>
        ))}
      </div>

      {/* Tab content — only active tab is mounted */}
      {activeTab === 'orders'    && <OrdersTab />}
      {activeTab === 'positions' && <OpenPositionsTab positions={positions} isLoading={positionsLoading} />}
      {activeTab === 'history'   && <HistoryTab />}
    </div>
  )
}
