import { cn } from '@/lib/utils'

interface PriceDisplayProps {
  value: number | null | undefined
  decimals?: number
  prefix?: string
  suffix?: string
  className?: string
  emptyText?: string
}

export function PriceDisplay({
  value,
  decimals = 4,
  prefix = '',
  suffix = '',
  className,
  emptyText = '—',
}: PriceDisplayProps) {
  if (value == null) {
    return <span className={cn('text-muted-foreground', className)}>{emptyText}</span>
  }

  const formatted = value.toLocaleString('en-US', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  })

  return (
    <span className={cn('font-numeric', className)}>
      {prefix}{formatted}{suffix}
    </span>
  )
}

export function PercentDisplay({
  value,
  decimals = 1,
  className,
}: {
  value: number | null | undefined
  decimals?: number
  className?: string
}) {
  if (value == null) return <span className="text-muted-foreground">—</span>
  return (
    <span className={cn('font-numeric', className)}>
      {(value * 100).toFixed(decimals)}%
    </span>
  )
}
