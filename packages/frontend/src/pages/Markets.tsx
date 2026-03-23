import React from 'react'
import { type ColumnDef } from '@tanstack/react-table'
import { Search, ExternalLink, X, Brain, CheckCircle, XCircle } from 'lucide-react'
import { formatDistanceToNow } from 'date-fns'
import { useNavigate } from 'react-router-dom'
import { useMarkets } from '@/hooks/useMarkets'
import { useDecisions } from '@/hooks/useDecisions'
import { DataTable } from '@/components/ui/DataTable'
import { MarketStatusBadge } from '@/components/ui/StatusBadge'
import { Badge } from '@/components/ui/Badge'
import { PriceDisplay } from '@/components/ui/PriceDisplay'
import { cn } from '@/lib/utils'
import type { Market, MarketCategory, MarketStatus, AIDecision } from '@polymarket/shared'

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

function MarketDrawer({ market, onClose, latestDecision }: { market: Market; onClose: () => void; latestDecision?: AIDecision }) {
  const navigate = useNavigate()

  // Normalize outcomes to handle both scanner format (tokenId/outcome) and seed format (token_id/name)
  const normalizedOutcomes = (market.outcomes ?? []).map((o: any) => ({
    name: o.name ?? o.outcome ?? 'Unknown',
    token_id: o.token_id ?? o.tokenId ?? '',
  }))

  const outcomeNames = normalizedOutcomes.map((o) => o.name)
  const yesPrice = market.current_prices?.[outcomeNames.find((n) => n.toLowerCase() === 'yes') ?? 'Yes']
  const noPrice = market.current_prices?.[outcomeNames.find((n) => n.toLowerCase() === 'no') ?? 'No']

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
            </div>
          </div>

          {/* Tradeable indicator */}
          {market.is_tradeable ? (
            <div className="flex items-center gap-2 bg-profit/10 border border-profit/20 rounded-md px-3 py-2 text-sm text-profit">
              <CheckCircle className="w-4 h-4" />
              Eligible for AI Trading
            </div>
          ) : (
            <div className="flex items-center gap-2 bg-surface-2 border border-border rounded-md px-3 py-2 text-sm text-muted-foreground">
              <XCircle className="w-4 h-4" />
              Not eligible for trading
              {(market as any).exclusion_reason && (
                <span>— {(market as any).exclusion_reason}</span>
              )}
            </div>
          )}

          {/* AI Decision Context */}
          {latestDecision == null ? (
            <div className="bg-surface-2 rounded-md px-3 py-2 text-xs text-muted-foreground">
              <Brain className="w-4 h-4 inline mr-1.5" />
              No AI decision yet for this market
            </div>
          ) : (
            <div className="bg-surface-2 rounded-lg p-3 space-y-2">
              <div className="flex items-center gap-2">
                <Brain className="w-4 h-4 text-info" />
                <span className="text-xs font-medium text-slate-200">Latest AI Decision</span>
                <Badge variant={latestDecision.action === 'trade' ? 'success' : 'default'}>
                  {latestDecision.action.toUpperCase()}
                </Badge>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Confidence: </span>
                  <span className="font-numeric text-slate-300">{Math.round(Number(latestDecision.confidence) * 100)}%</span>
                </div>
                {latestDecision.direction && (
                  <div>
                    <span className="text-muted-foreground">Direction: </span>
                    <span className="text-slate-300">{latestDecision.direction}</span>
                  </div>
                )}
                {latestDecision.regime_assessment && (
                  <div>
                    <span className="text-muted-foreground">Regime: </span>
                    <span className="text-slate-300 capitalize">{latestDecision.regime_assessment}</span>
                  </div>
                )}
                {latestDecision.estimated_edge != null && (
                  <div>
                    <span className="text-muted-foreground">Edge: </span>
                    <span className="font-numeric text-slate-300">{(Number(latestDecision.estimated_edge) * 100).toFixed(2)}%</span>
                  </div>
                )}
              </div>
              {latestDecision.reasoning && (
                <p className="text-xs text-slate-400 line-clamp-2 mt-1">{latestDecision.reasoning}</p>
              )}
            </div>
          )}

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
          {normalizedOutcomes.length > 0 && (
            <div>
              <p className="text-xs text-muted-foreground mb-2">Outcomes</p>
              <div className="space-y-1.5">
                {normalizedOutcomes.map((o) => (
                  <div key={o.token_id || o.name} className="flex items-center justify-between bg-surface-2 rounded px-3 py-2">
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

          {/* Actions */}
          <div className="space-y-2 pt-2">
            {(market.slug || market.polymarket_id) && (
              <a
                href={
                  market.slug
                    ? `https://polymarket.com/market/${market.slug}`
                    : `https://polymarket.com/event/${market.polymarket_id}`
                }
                target="_blank"
                rel="noopener noreferrer"
                className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-info text-white rounded-md text-sm font-medium hover:bg-info/90 transition-colors"
              >
                <ExternalLink className="w-4 h-4" />
                Trade on Polymarket
              </a>
            )}
            <button
              onClick={() => { navigate('/intelligence?tab=decisions') }}
              className="flex items-center justify-center gap-2 w-full px-4 py-2.5 bg-surface-2 text-slate-300 rounded-md text-sm font-medium hover:bg-slate-700 border border-border transition-colors"
            >
              <Brain className="w-4 h-4" />
              View AI Decisions
            </button>
          </div>

          {/* Meta */}
          <div className="text-xs text-muted-foreground space-y-1 pt-2 border-t border-border">
            {market.end_date && (
              <p>Ends: {new Date(market.end_date).toLocaleDateString()}</p>
            )}
            <p>Updated {formatDistanceToNow(new Date(market.updated_at), { addSuffix: true })}</p>
          </div>
        </div>
      </div>
    </div>
  )
}

export default function Markets() {
  const [category, setCategory] = React.useState<MarketCategory | 'all'>('all')
  const [statusFilter, setStatusFilter] = React.useState<MarketStatus | 'all'>('all')
  const [search, setSearch] = React.useState('')
  const [selectedMarket, setSelectedMarket] = React.useState<Market | null>(null)

  const { data: markets, isLoading } = useMarkets({
    category: category === 'all' ? undefined : category,
    status: statusFilter === 'all' ? undefined : statusFilter,
  })

  const { data: decisions } = useDecisions({ limit: 200 })

  const latestDecisionMap = React.useMemo(() => {
    if (!decisions) return new Map<string, AIDecision>()
    const map = new Map<string, AIDecision>()
    for (const d of decisions) {
      if (d.market_id && !map.has(d.market_id)) {
        map.set(d.market_id, d)
      }
    }
    return map
  }, [decisions])

  const columns = React.useMemo<ColumnDef<Market, unknown>[]>(() => [
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
      id: 'ai_signal',
      header: 'AI Signal',
      size: 100,
      cell: ({ row }) => {
        const decision = latestDecisionMap.get(row.original.id)
        if (!decision) return <span className="text-xs text-muted-foreground">—</span>
        return (
          <div className="flex items-center gap-1.5">
            <span className={cn(
              'w-1.5 h-1.5 rounded-full',
              decision.action === 'trade' ? 'bg-profit' : 'bg-muted'
            )} />
            <span className={cn(
              'text-xs font-medium',
              decision.action === 'trade' ? 'text-profit' : 'text-muted-foreground'
            )}>
              {decision.action === 'trade' ? decision.direction ?? 'TRADE' : 'HOLD'}
            </span>
            {decision.confidence != null && (
              <span className="text-xs text-muted-foreground font-numeric">
                {Math.round(Number(decision.confidence) * 100)}%
              </span>
            )}
          </div>
        )
      },
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
  ], [latestDecisionMap])

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
        <MarketDrawer
          market={selectedMarket}
          onClose={() => setSelectedMarket(null)}
          latestDecision={latestDecisionMap.get(selectedMarket.id)}
        />
      )}
    </div>
  )
}
