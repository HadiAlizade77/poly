import { cn } from '@/lib/utils'
import type { ScorerDimension } from '@polymarket/shared'

interface ScoreDimensionBarProps {
  label: string
  dimension: ScorerDimension
  className?: string
}

function scoreColor(value: number): string {
  if (value >= 0.7) return 'bg-profit'
  if (value >= 0.4) return 'bg-warning'
  return 'bg-loss'
}

export function ScoreDimensionBar({ label, dimension, className }: ScoreDimensionBarProps) {
  const pct = Math.round(dimension.value * 100)
  return (
    <div className={cn('space-y-1', className)}>
      <div className="flex items-center justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-numeric text-slate-300">{pct}</span>
      </div>
      <div className="h-1.5 bg-surface-2 rounded-full overflow-hidden">
        <div
          className={cn('h-full rounded-full transition-all', scoreColor(dimension.value))}
          style={{ width: `${pct}%` }}
        />
      </div>
      {dimension.detail && (
        <p className="text-xs text-muted-foreground truncate">{dimension.detail}</p>
      )}
    </div>
  )
}

interface ScoreSummaryProps {
  scores: Record<string, ScorerDimension>
  className?: string
}

export function ScoreSummary({ scores, className }: ScoreSummaryProps) {
  return (
    <div className={cn('space-y-3', className)}>
      {Object.entries(scores).map(([key, dim]) => (
        <ScoreDimensionBar key={key} label={dim.label ?? key} dimension={dim} />
      ))}
    </div>
  )
}
