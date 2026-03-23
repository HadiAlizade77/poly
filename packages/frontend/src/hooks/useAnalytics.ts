import { useQuery } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface AnalyticsSummary {
  total_trades: number
  winning_trades: number
  losing_trades: number
  win_rate: number | null
  total_pnl: number
  avg_pnl_per_trade: number | null
  best_trade_pnl: number | null
  worst_trade_pnl: number | null
  total_fees: number
  avg_hold_time_hours: number | null
  by_category: Record<
    string,
    { trades: number; win_rate: number | null; pnl: number }
  >
}

export const analyticsKeys = {
  summary: ['analytics', 'summary'] as const,
}

export function useAnalyticsSummary() {
  return useQuery({
    queryKey: analyticsKeys.summary,
    queryFn: () => api.get<AnalyticsSummary>('/api/analytics/summary'),
    staleTime: 5 * 60_000,
  })
}
