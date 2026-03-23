import React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow, format } from 'date-fns'
import { X, ShoppingCart, ExternalLink } from 'lucide-react'
import { useOrders } from '@/hooks/useOrders'
import { DataTable } from '@/components/ui/DataTable'
import { OrderStatusBadge } from '@/components/ui/StatusBadge'
import { Badge } from '@/components/ui/Badge'
import { PriceDisplay } from '@/components/ui/PriceDisplay'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'
import type { Order, OrderStatus, OrderSide } from '@polymarket/shared'

// ─── helpers ─────────────────────────────────────────────────────────────────

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

function FillBar({ filled, total }: { filled: number; total: number }) {
  const pct = total > 0 ? Math.min(100, (filled / total) * 100) : 0
  return (
    <div className="flex items-center gap-2 min-w-[80px]">
      <div className="flex-1 h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full', pct === 100 ? 'bg-profit' : 'bg-info')} style={{ width: `${pct}%` }} />
      </div>
      <span className="text-xs font-numeric text-muted-foreground w-7 text-right">{Math.round(pct)}%</span>
    </div>
  )
}

// ─── detail drawer ────────────────────────────────────────────────────────────

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
            <Badge variant="outline">{order.order_type.toUpperCase()}</Badge>
            {order.maker_or_taker && <Badge variant="outline">{order.maker_or_taker}</Badge>}
          </div>

          {/* Price / size grid */}
          <div className="grid grid-cols-2 gap-3">
            {[
              { label: 'Price',        value: <PriceDisplay value={order.price} decimals={4} className="text-slate-200" /> },
              { label: 'Size',         value: <span className="font-numeric text-slate-200">{order.size.toFixed(6)}</span> },
              { label: 'Filled',       value: <span className="font-numeric text-profit">{order.filled_size.toFixed(6)}</span> },
              { label: 'Avg Fill',     value: <PriceDisplay value={order.avg_fill_price} decimals={4} className="text-slate-200" /> },
              { label: 'Fees Paid',    value: <span className="font-numeric text-muted-foreground">${order.fees_paid.toFixed(6)}</span> },
              { label: 'Fill %',       value: <span className="font-numeric">{order.size > 0 ? ((order.filled_size / order.size) * 100).toFixed(1) : '0'}%</span> },
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

// ─── columns ──────────────────────────────────────────────────────────────────

const columns: ColumnDef<Order, unknown>[] = [
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
    cell: ({ getValue }) => <Badge variant="outline">{(getValue() as string).toUpperCase()}</Badge>,
  },
  {
    id: 'price', accessorKey: 'price', header: 'Price', size: 75,
    cell: ({ getValue }) => <PriceDisplay value={getValue() as number} decimals={3} className="text-slate-200" />,
  },
  {
    id: 'size', accessorKey: 'size', header: 'Size', size: 75,
    cell: ({ getValue }) => <span className="font-numeric text-slate-300">{(getValue() as number).toFixed(4)}</span>,
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
    cell: ({ getValue }) => <span className="font-numeric text-muted-foreground text-xs">${(getValue() as number).toFixed(4)}</span>,
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

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Orders() {
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
      <PageHeader title="Orders" subtitle={orders ? `${orders.length} orders` : 'Loading…'} />

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
        <EmptyState icon={<ShoppingCart className="w-6 h-6 text-muted-foreground" />} title="No orders found" message="Orders appear here once the trading engine places them." />
      ) : (
        <DataTable
          columns={columns}
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
