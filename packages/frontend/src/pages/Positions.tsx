import React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { formatDistanceToNow, formatDuration, intervalToDuration } from 'date-fns'
import { Wallet, X, Check, AlertTriangle } from 'lucide-react'
import { toast } from 'sonner'
import { usePositions, usePositionHistory, useClosePosition } from '@/hooks/usePositions'
import { DataTable } from '@/components/ui/DataTable'
import { Badge } from '@/components/ui/Badge'
import { PnlDisplay } from '@/components/ui/PnlDisplay'
import { PriceDisplay } from '@/components/ui/PriceDisplay'
import { StatCard } from '@/components/ui/StatCard'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'
import type { Position, PositionHistory, ExitStrategy, PositionSide, CloseReason } from '@polymarket/shared'

// ─── shared helpers ───────────────────────────────────────────────────────────

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
        {unrealizedPnl != null && unrealizedPnl < 0 && <AlertTriangle className="w-3.5 h-3.5 text-warning shrink-0" />}
        <button onClick={() => close.mutate(positionId, { onSuccess: () => { setConfirming(false); toast.success('Position closed') }, onError: () => { setConfirming(false); toast.error('Failed to close') } })} disabled={close.isPending} className="p-1 rounded text-profit hover:text-profit/80 disabled:opacity-50" title="Confirm close">
          <Check className="w-4 h-4" />
        </button>
        <button onClick={() => setConfirming(false)} className="p-1 rounded text-muted-foreground hover:text-slate-300" title="Cancel">
          <X className="w-4 h-4" />
        </button>
      </div>
    )
  }

  return (
    <button onClick={() => setConfirming(true)} className="px-2.5 py-1 text-xs rounded-md bg-surface-2 text-slate-400 hover:text-loss hover:bg-loss/10 border border-border hover:border-loss/30 transition-colors">
      Close
    </button>
  )
}

// ─── open positions tab ───────────────────────────────────────────────────────

const openColumns: ColumnDef<Position, unknown>[] = [
  {
    id: 'opened_at', accessorKey: 'opened_at', header: 'Opened', size: 120,
    cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(getValue() as Date), { addSuffix: true })}</span>,
  },
  {
    id: 'outcome_token', accessorKey: 'outcome_token', header: 'Outcome', size: 110,
    cell: ({ getValue }) => <span className="font-mono text-xs text-slate-300 block truncate max-w-[100px]">{getValue() as string}</span>,
  },
  {
    id: 'side', accessorKey: 'side', header: 'Side', size: 70,
    cell: ({ getValue }) => { const s = getValue() as PositionSide; return <Badge variant={s === 'long' ? 'success' : 'danger'}>{s.toUpperCase()}</Badge> },
  },
  {
    id: 'size', accessorKey: 'size', header: 'Size', size: 75,
    cell: ({ getValue }) => <span className="font-numeric text-slate-200">{(getValue() as number).toFixed(4)}</span>,
  },
  {
    id: 'avg_entry_price', accessorKey: 'avg_entry_price', header: 'Entry', size: 75,
    cell: ({ getValue }) => <PriceDisplay value={getValue() as number} decimals={3} className="text-slate-300" />,
  },
  {
    id: 'current_price', accessorKey: 'current_price', header: 'Current', size: 75,
    cell: ({ row }) => {
      const c = row.original.current_price, e = row.original.avg_entry_price
      return <PriceDisplay value={c} decimals={3} className={cn(c != null && c > e ? 'text-profit' : c != null && c < e ? 'text-loss' : 'text-slate-300')} />
    },
  },
  {
    id: 'unrealized_pnl', accessorKey: 'unrealized_pnl', header: 'Unreal. P&L', size: 110,
    cell: ({ getValue }) => { const v = getValue() as number | null; return v != null ? <PnlDisplay value={v} showIcon /> : <span className="text-muted-foreground">—</span> },
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

function OpenPositionsTab({ positions, isLoading }: { positions: Position[] | undefined; isLoading: boolean }) {
  const totalUnrealized = positions?.reduce((s, p) => s + (p.unrealized_pnl ?? 0), 0) ?? 0
  const totalRealized   = positions?.reduce((s, p) => s + p.realized_pnl, 0) ?? 0
  const totalFees       = positions?.reduce((s, p) => s + p.total_fees, 0) ?? 0
  const longCount       = positions?.filter((p) => p.side === 'long').length ?? 0
  const shortCount      = positions?.filter((p) => p.side === 'short').length ?? 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Unrealized P&L" loading={isLoading} value={<PnlDisplay value={totalUnrealized} size="lg" showIcon />} />
        <StatCard label="Realized P&L" loading={isLoading} value={<PnlDisplay value={totalRealized} size="lg" showIcon />} />
        <StatCard label="Total Fees" loading={isLoading} value={<span className="font-numeric text-muted-foreground">${totalFees.toFixed(4)}</span>} />
        <StatCard label="Long / Short" loading={isLoading} value={<span><span className="text-profit font-numeric">{longCount}</span><span className="text-muted-foreground mx-1">/</span><span className="text-loss font-numeric">{shortCount}</span></span>} />
      </div>

      {positions?.length === 0 && !isLoading ? (
        <EmptyState icon={<Wallet className="w-6 h-6 text-muted-foreground" />} title="No open positions" message="Positions appear once trades execute." />
      ) : (
        <DataTable columns={openColumns} data={positions ?? []} loading={isLoading} pageSize={20} getRowId={(r) => r.id} />
      )}
    </div>
  )
}

// ─── history tab ──────────────────────────────────────────────────────────────

const historyColumns: ColumnDef<PositionHistory, unknown>[] = [
  {
    id: 'closed_at', accessorKey: 'closed_at', header: 'Closed', size: 120,
    cell: ({ getValue }) => <span className="text-xs text-muted-foreground">{formatDistanceToNow(new Date(getValue() as Date), { addSuffix: true })}</span>,
  },
  {
    id: 'outcome_token', accessorKey: 'outcome_token', header: 'Outcome', size: 110,
    cell: ({ getValue }) => <span className="font-mono text-xs text-slate-300 block truncate max-w-[100px]">{getValue() as string}</span>,
  },
  {
    id: 'side', accessorKey: 'side', header: 'Side', size: 70,
    cell: ({ getValue }) => { const s = getValue() as PositionSide; return <Badge variant={s === 'long' ? 'success' : 'danger'}>{s.toUpperCase()}</Badge> },
  },
  {
    id: 'size', accessorKey: 'size', header: 'Size', size: 75,
    cell: ({ getValue }) => <span className="font-numeric text-slate-300">{(getValue() as number).toFixed(4)}</span>,
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
    cell: ({ getValue }) => <span className="font-numeric text-muted-foreground text-xs">${(getValue() as number).toFixed(4)}</span>,
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
    cell: ({ getValue }) => { const v = getValue() as string | null; return v ? <Badge variant="default">{v}</Badge> : <span className="text-muted-foreground">—</span> },
  },
]

function HistoryTab() {
  const { data: history, isLoading, isError } = usePositionHistory()

  if (isError) {
    return <EmptyState title="History unavailable" message="Position history endpoint is not available yet." />
  }

  const totalPnl  = history?.reduce((s, p) => s + p.realized_pnl, 0) ?? 0
  const winCount  = history?.filter((p) => p.realized_pnl > 0).length ?? 0
  const lossCount = history?.filter((p) => p.realized_pnl < 0).length ?? 0

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Closed Positions" loading={isLoading} value={history?.length ?? '—'} />
        <StatCard label="Total Realized P&L" loading={isLoading} value={<PnlDisplay value={totalPnl} size="lg" showIcon />} />
        <StatCard label="Wins" loading={isLoading} value={<span className="text-profit font-numeric">{winCount}</span>} />
        <StatCard label="Losses" loading={isLoading} value={<span className="text-loss font-numeric">{lossCount}</span>} />
      </div>

      {history?.length === 0 && !isLoading ? (
        <EmptyState icon={<Wallet className="w-6 h-6 text-muted-foreground" />} title="No closed positions" message="Closed positions will appear here." />
      ) : (
        <DataTable columns={historyColumns} data={history ?? []} loading={isLoading} pageSize={25} getRowId={(r) => r.id} />
      )}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

const TABS = ['Open', 'History'] as const
type Tab = typeof TABS[number]

export default function Positions() {
  const [tab, setTab] = React.useState<Tab>('Open')
  const { data: positions, isLoading } = usePositions()

  return (
    <div className="space-y-4">
      <PageHeader
        title="Positions"
        subtitle={positions ? `${positions.length} open position${positions.length !== 1 ? 's' : ''}` : 'Loading…'}
      />

      {/* Tabs */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px',
              tab === t ? 'border-info text-info' : 'border-transparent text-muted-foreground hover:text-slate-300',
            )}
          >
            {t}
            {t === 'Open' && positions != null && (
              <span className={cn('ml-1.5 text-xs font-numeric', tab === t ? 'text-info' : 'text-muted-foreground')}>
                {positions.length}
              </span>
            )}
          </button>
        ))}
      </div>

      {tab === 'Open'    && <OpenPositionsTab positions={positions} isLoading={isLoading} />}
      {tab === 'History' && <HistoryTab />}
    </div>
  )
}
