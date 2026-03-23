import React from 'react'
import { Settings, ToggleLeft, ToggleRight, ChevronDown, ChevronRight } from 'lucide-react'
import { toast } from 'sonner'
import { useScorerConfigs, useToggleScorer } from '@/hooks/useScorers'
import { ScoreSummary } from '@/components/ui/ScoreDimensionBar'
import { Badge } from '@/components/ui/Badge'
import { EmptyState } from '@/components/ui/EmptyState'
import { LoadingPage } from '@/components/ui/LoadingSpinner'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'
import type { MarketCategory, ScorerConfig } from '@polymarket/shared'

const CATEGORIES: { value: MarketCategory | 'all'; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'crypto', label: 'Crypto' },
  { value: 'politics', label: 'Politics' },
  { value: 'sports', label: 'Sports' },
  { value: 'events', label: 'Events' },
  { value: 'entertainment', label: 'Entertainment' },
  { value: 'other', label: 'Other' },
]

function ParamValue({ value }: { value: unknown }) {
  if (value === null || value === undefined) return <span className="text-muted-foreground">—</span>
  if (typeof value === 'boolean') return <Badge variant={value ? 'success' : 'default'}>{String(value)}</Badge>
  if (typeof value === 'object') return <span className="font-mono text-xs text-info">{JSON.stringify(value)}</span>
  return <span className="font-mono text-slate-300">{String(value)}</span>
}

function ScorerCard({ config }: { config: ScorerConfig }) {
  const [expanded, setExpanded] = React.useState(false)
  const toggle = useToggleScorer()

  const handleToggle = () => {
    toggle.mutate(config.id, {
      onSuccess: () => toast.success(`${config.scorer_name} ${config.is_enabled ? 'disabled' : 'enabled'}`),
      onError: () => toast.error('Failed to toggle scorer'),
    })
  }

  const paramEntries = Object.entries(config.parameters ?? {})
  // Fake dimension scores for display — real data would come from useContextScores
  const hasDimensions = false

  return (
    <div className={cn(
      'bg-surface rounded-lg border transition-colors',
      config.is_enabled ? 'border-border' : 'border-border opacity-60',
    )}>
      {/* Header row */}
      <div className="flex items-center gap-3 p-4">
        <button
          onClick={() => setExpanded((v) => !v)}
          className="flex items-center gap-2 flex-1 min-w-0 text-left"
        >
          {expanded
            ? <ChevronDown className="w-4 h-4 text-muted-foreground shrink-0" />
            : <ChevronRight className="w-4 h-4 text-muted-foreground shrink-0" />}
          <div className="min-w-0">
            <p className="text-sm font-medium text-slate-200 truncate">{config.scorer_name}</p>
            {config.description && (
              <p className="text-xs text-muted-foreground truncate">{config.description}</p>
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
            {config.is_enabled
              ? <ToggleRight className="w-6 h-6 text-profit" />
              : <ToggleLeft className="w-6 h-6" />}
          </button>
        </div>
      </div>

      {/* Expanded body */}
      {expanded && (
        <div className="border-t border-border px-4 pb-4 pt-3 space-y-4">
          {/* Parameters */}
          {paramEntries.length > 0 && (
            <div>
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Parameters</p>
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
              <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Latest Scores</p>
              {/* ScoreSummary would be wired here once useContextScores returns data */}
            </div>
          )}

          <p className="text-xs text-muted-foreground">
            Category: <span className="text-slate-300">{config.category}</span>
            {' · '}
            Updated: <span className="text-slate-300">{new Date(config.updated_at).toLocaleDateString()}</span>
          </p>
        </div>
      )}
    </div>
  )
}

export default function Scorers() {
  const [category, setCategory] = React.useState<MarketCategory | 'all'>('all')

  const { data: configs, isLoading } = useScorerConfigs(
    category === 'all' ? undefined : category,
  )

  return (
    <div className="space-y-4">
      <PageHeader
        title="Context Scorers"
        subtitle="AI scoring modules that assess market conditions per category"
        actions={
          configs && (
            <span className="text-xs text-muted-foreground">
              {configs.filter((c) => c.is_enabled).length} / {configs.length} enabled
            </span>
          )
        }
      />

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
