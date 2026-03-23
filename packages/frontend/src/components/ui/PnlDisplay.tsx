import { cn } from '@/lib/utils'
import { TrendingUp, TrendingDown, Minus } from 'lucide-react'

interface PnlDisplayProps {
  value: number
  prefix?: string
  className?: string
  showIcon?: boolean
  size?: 'sm' | 'md' | 'lg'
}

export function PnlDisplay({ value, prefix = '$', className, showIcon = false, size = 'md' }: PnlDisplayProps) {
  const isPositive = value > 0
  const isNegative = value < 0
  const formatted = `${prefix}${Math.abs(value).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

  const sizeClass = {
    sm: 'text-sm',
    md: 'text-base',
    lg: 'text-2xl font-semibold',
  }[size]

  const colorClass = isPositive ? 'text-profit' : isNegative ? 'text-loss' : 'text-muted-foreground'
  const sign = isPositive ? '+' : isNegative ? '-' : ''
  const Icon = isPositive ? TrendingUp : isNegative ? TrendingDown : Minus

  return (
    <span className={cn('font-numeric inline-flex items-center gap-1', colorClass, sizeClass, className)}>
      {showIcon && <Icon className="w-3.5 h-3.5 shrink-0" />}
      {sign}{formatted}
    </span>
  )
}
