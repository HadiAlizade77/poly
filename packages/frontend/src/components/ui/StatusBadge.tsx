import { Badge } from './Badge'
import type { MarketStatus, OrderStatus, AlertSeverity } from '@polymarket/shared'

export function MarketStatusBadge({ status }: { status: MarketStatus }) {
  const map: Record<MarketStatus, { variant: 'success' | 'danger' | 'warning' | 'default' | 'info'; label: string }> = {
    active: { variant: 'success', label: 'Active' },
    paused: { variant: 'warning', label: 'Paused' },
    closed: { variant: 'default', label: 'Closed' },
    resolved: { variant: 'info', label: 'Resolved' },
    excluded: { variant: 'danger', label: 'Excluded' },
  }
  const { variant, label } = map[status] ?? { variant: 'default', label: status }
  return <Badge variant={variant}>{label}</Badge>
}

export function OrderStatusBadge({ status }: { status: OrderStatus }) {
  const map: Record<OrderStatus, { variant: 'success' | 'danger' | 'warning' | 'default' | 'info'; label: string }> = {
    filled: { variant: 'success', label: 'Filled' },
    open: { variant: 'info', label: 'Open' },
    partial: { variant: 'warning', label: 'Partial' },
    pending: { variant: 'default', label: 'Pending' },
    cancelled: { variant: 'default', label: 'Cancelled' },
    failed: { variant: 'danger', label: 'Failed' },
    expired: { variant: 'default', label: 'Expired' },
  }
  const { variant, label } = map[status] ?? { variant: 'default', label: status }
  return <Badge variant={variant}>{label}</Badge>
}

export function SeverityBadge({ severity }: { severity: AlertSeverity }) {
  const map: Record<AlertSeverity, { variant: 'success' | 'danger' | 'warning' | 'default' | 'info'; label: string }> = {
    info: { variant: 'info', label: 'Info' },
    warning: { variant: 'warning', label: 'Warning' },
    error: { variant: 'danger', label: 'Error' },
    critical: { variant: 'danger', label: 'Critical' },
  }
  const { variant, label } = map[severity] ?? { variant: 'default', label: severity }
  return <Badge variant={variant}>{label}</Badge>
}
