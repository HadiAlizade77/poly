import { cn } from '@/lib/utils'

interface StatCardProps {
  label: string
  value: React.ReactNode
  subValue?: React.ReactNode
  trend?: 'up' | 'down' | 'neutral'
  className?: string
  loading?: boolean
}

export function StatCard({ label, value, subValue, className, loading }: StatCardProps) {
  return (
    <div className={cn('bg-surface rounded-lg border border-border p-4', className)}>
      <p className="text-xs text-muted-foreground uppercase tracking-wide mb-1">{label}</p>
      {loading ? (
        <div className="space-y-1">
          <div className="h-7 w-24 bg-surface-2 rounded animate-pulse" />
          {subValue !== undefined && <div className="h-4 w-16 bg-surface-2 rounded animate-pulse" />}
        </div>
      ) : (
        <>
          <div className="text-2xl font-numeric font-semibold text-slate-100">{value}</div>
          {subValue !== undefined && (
            <div className="mt-0.5 text-sm text-muted-foreground">{subValue}</div>
          )}
        </>
      )}
    </div>
  )
}
