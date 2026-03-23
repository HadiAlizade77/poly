import { Inbox } from 'lucide-react'
import { cn } from '@/lib/utils'

interface EmptyStateProps {
  title?: string
  message?: string
  icon?: React.ReactNode
  action?: React.ReactNode
  className?: string
}

export function EmptyState({
  title = 'No data',
  message,
  icon,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div className={cn('flex flex-col items-center justify-center py-12 px-4 text-center', className)}>
      <div className="w-12 h-12 rounded-full bg-surface-2 flex items-center justify-center mb-4">
        {icon ?? <Inbox className="w-6 h-6 text-muted-foreground" />}
      </div>
      <p className="text-sm font-medium text-slate-300 mb-1">{title}</p>
      {message && <p className="text-xs text-muted-foreground max-w-xs">{message}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}
