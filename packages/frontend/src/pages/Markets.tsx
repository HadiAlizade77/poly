import React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Search, ExternalLink, X } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useMarkets } from '@/hooks/useMarkets'
import { DataTable } from '@/components/ui/DataTable'
import { MarketStatusBadge } from '@/components/ui/StatusBadge'
import { Badge } from '@/components/ui/Badge'
import { PriceDisplay } from '@/components/ui/PriceDisplay'
import { cn } from '@/lib/utils'
import type { Market, MarketCategory, MarketStatus } from '@polymarket/shared'

const CATEGORIES: { value: MarketCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'politics', label: 'Politics' },
  { value: 'sports', label: 'Sports' },
  { value: 'events', label: 'Events' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'other', label: 'Other' },
]

const STATUS_FILTERS: { value: MarketStatus | 'all'; label: string }[] = [
  { value: 'all', label: 'All Status' },
  { value: 'active', label: 'Active' },
  { value: 'paused', label: 'Paused' },
  { value: 'closed', label: 'Closed' },
  { value: 'resolved', label: 'Resolved' },
  { value: 'excluded', label: 'Excluded' },
]

function MarketDrawer({ market, onClose }: { market: Market; onClose: () => void }) {
  const yesPrice = market.current_prices?.['YES'] ?? market.current_prices?.['yes']
  const noPrice = market.current_prices?.['NO'] ?? market.current_prices?.['no']

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-black/40" onClick={onClose} />
      {/* Panel */}
      <div className="w-full max-w-md bg-surface border-l border-border overflow-y-auto">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <h2 className="text-sm font-medium text-slate-200">Market Detail</h2>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-slate-200 hover:bg-surface-2"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <div className="p-4 space-y-4">
          {/* Title + badges */}
          <div>
            <h3 className="text-base font-semibold text-slate-100 leading-snug">{market.title}</h3>
            <div className="flex items-center gap-2 mt-2 flex-wrap">
              <MarketStatusBadge status={market.status} />
              <Badge variant="outline">{market.category}</Badge>
              {market.is_tradeable && <Badge variant="success">Tradeable</Badge>}
            </div>
          </div>

          {/* Prices */}
          {market.current_prices && Object.keys(market.current_prices).length > 0 && (
            <div className="bg-surface-2 rounded-lg p-3 grid grid-cols-2 gap-3">
              {yesPrice != null && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">YES</p>
                  <PriceDisplay value={yesPrice} decimals={3} className="text-profit text-lg font-semibold" />
                </div>
              )}
              {noPrice != null && (
                <div>
                  <p className="text-xs text-muted-foreground mb-0.5">NO</p>
                  <PriceDisplay value={noPrice} decimals={3} className="text-loss text-lg font-semibold" />
                </div>
              )}
            </div>
          )}

          {/* Stats */}
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-surface-2 rounded p-3">
              <p className="text-xs text-muted-foreground mb-0.5">24h Volume</p>
              <p className="font-numeric text-slate-200">
                {market.volume_24h != null
                  ? `$${market.volume_24h.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                  : '—'}
              </p>
            </div>
            <div className="bg-surface-2 rounded p-3">
              <p className="text-xs text-muted-foreground mb-0.5">Liquidity</p>
              <p className="font-numeric text-slate-200">
                {market.liquidity != null
                  ? `$${market.liquidity.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
                  : '—'}
              </p>
            </div>
          </div>

          {/* Description */}
          {market.description && (
            <div>
              <p className="text-xs text-muted-foreground mb-1">Description</p>
              <p className="text-sm text-slate-300 leading-relaxed">{market.description}</p>
            </div>
          )}

          {/* Outcomes */}
          {market.outcomes.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Outcomes</p>
              <div className="space-y-1.5">
                {market.outcomes.map((o) => (
                  <div key={o.token_id} className="flex items-center justify-between bg-surface-2 rounded px-3 py-2">
                    <span className="text-sm text-slate-200">{o.name}</span>
                    {market.current_prices?.[o.name] != null && (
                      <PriceDisplay
                        value={market.current_prices[o.name]}
                        decimals={3}
                        className="text-slate-300"
                      />
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Meta */}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
            {market.end_date && (
              <p>Ends: {new Date(market.end_date).toLocaleDateString()}</p>
            )}
            <p>Updated {formatDistanceToNow(new Date(market.updated_at), { addSuffix: true })}</p>
            {market.slug && (
              <a
                href={`https://polymarket.com/event/${market.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1 text-info hover:underline"
              >
                View on Polymarket <ExternalLink className="w-3 h-3" />
              </a>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

const columns: ColumnDef<Market, unknown>[] = [
  {
    id: 'title',
    accessorKey: 'title',
    header: 'Market',
    size: 320,
    cell: ({ row }) => (
      <div className="max-w-xs">
        <p className="truncate text-slate-200 font-medium text-sm">{row.original.title}</p>
        <p className="text-xs text-muted-foreground">{row.original.category}</p>
      </div>
    ),
  },
  {
    id: 'status',
    accessorKey: 'status',
    header: 'Status',
    size: 100,
    cell: ({ row }) => <MarketStatusBadge status={row.original.status} />,
  },
  {
    id: 'yes_price',
    header: 'YES',
    size: 80,
    cell: ({ row }) => {
      const p = row.original.current_prices?.['YES'] ?? row.original.current_prices?.['yes']
      return <PriceDisplay value={p} decimals={3} className="text-profit" emptyText="—" />
    },
  },
  {
    id: 'no_price',
    header: 'NO',
    size: 80,
    cell: ({ row }) => {
      const p = row.original.current_prices?.['NO'] ?? row.original.current_prices?.['no']
      return <PriceDisplay value={p} decimals={3} className="text-loss" emptyText="—" />
    },
  },
  {
    id: 'volume_24h',
    accessorKey: 'volume_24h',
    header: 'Vol 24h',
    size: 100,
    cell: ({ getValue }) => {
      const v = getValue() as number | null
      return v != null
        ? <span className="font-numeric text-slate-300">${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
        : <span className="text-muted-foreground">—</span>
    },
  },
  {
    id: 'liquidity',
    accessorKey: 'liquidity',
    header: 'Liquidity',
    size: 100,
    cell: ({ getValue }) => {
      const v = getValue() as number | null
      return v != null
        ? <span className="font-numeric text-slate-300">${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
        : <span className="text-muted-foreground">—</span>
    },
  },
  {
    id: 'tradeable',
    accessorKey: 'is_tradeable',
    header: 'Tradeable',
    size: 90,
    cell: ({ getValue }) =>
      getValue() ? (
        <Badge variant="success">Yes</Badge>
      ) : (
        <Badge variant="outline">No</Badge>
      ),
  },
  {
    id: 'updated_at',
    accessorKey: 'updated_at',
    header: 'Updated',
    size: 120,
    cell: ({ getValue }) => (
      <span className="text-xs text-muted-foreground">
        {formatDistanceToNow(new Date(getValue() as Date), { addSuffix: true })}
      </span>
    ),
  },
]

export default function Markets() {
  const [category, setCategory] = React.useState<MarketCategory | 'all'>('all')
  const [statusFilter, setStatusFilter] = React.useState<MarketStatus | 'all'>('all')
  const [search, setSearch] = React.useState('')
  const [selectedMarket, setSelectedMarket] = React.useState<Market | null>(null)

  const { data: markets, isLoading } = useMarkets({
    category: category === 'all' ? undefined : category,
    status: statusFilter === 'all' ? undefined : statusFilter,
  })

  const filtered = React.useMemo(() => {
    if (!markets) return []
    if (!search.trim()) return markets
    const q = search.toLowerCase()
    return markets.filter(
      (m) =>
        m.title.toLowerCase().includes(q) ||
        m.category.toLowerCase().includes(q) ||
        (m.description?.toLowerCase().includes(q) ?? false)
    )
  }, [markets, search])

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-semibold text-slate-100">Markets</h1>
        <p className="text-sm text-muted-foreground mt-0.5">
          {markets ? `${markets.length} markets` : 'Loading…'}
        </p>
      </div>

      {/* Category tabs */}
      <div className="flex gap-1 overflow-x-auto pb-1">
        {CATEGORIES.map(({ value, label }) => (
          <button
            key={value}
            onClick={() => setCategory(value)}
            className={cn(
              'px-3 py-1.5 rounded-md text-sm font-medium whitespace-nowrap transition-colors',
              category === value
                ? 'bg-info/20 text-info'
                : 'text-muted-foreground hover:text-slate-300 hover:bg-surface-2'
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Filters row */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <input
            type="text"
            placeholder="Search markets…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-surface border border-border rounded-md pl-9 pr-3 py-2 text-sm text-slate-200 placeholder:text-muted-foreground focus:outline-none focus:border-info"
          />
        </div>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as MarketStatus | 'all')}
          className="bg-surface border border-border rounded-md px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-info"
        >
          {STATUS_FILTERS.map(({ value, label }) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
      </div>

      <DataTable
        columns={columns}
        data={filtered}
        loading={isLoading}
        pageSize={25}
        getRowId={(row) => row.id}
        onRowClick={(row) => setSelectedMarket(row.original)}
        emptyMessage={isLoading ? 'Loading markets…' : 'No markets found'}
      />

      {selectedMarket && (
        <MarketDrawer market={selectedMarket} onClose={() => setSelectedMarket(null)} />
      )}
    </div>
  )
}
