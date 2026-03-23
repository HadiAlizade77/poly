import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

export interface SandboxStatus {
  active: boolean
  started_at: string | null
  starting_balance: number
  current_balance: number
  total_pnl: number
  pnl_percent: number
  deployed: number
  available: number
}

export interface SandboxAnalytics {
  sandbox_duration_hours: number
  starting_balance: number
  current_balance: number
  total_pnl: number
  pnl_percent: number
  max_drawdown: number
  max_drawdown_percent: number
  total_decisions: number
  trade_decisions: number
  hold_decisions: number
  total_orders: number
  filled_orders: number
  expired_orders: number
  failed_orders: number
  fill_rate: number
  open_positions: number
  closed_positions: number
  unrealized_pnl: number
  wins: number
  losses: number
  win_rate: number
  avg_win: number
  avg_loss: number
  profit_factor: number
  best_trade: number
  worst_trade: number
  total_fees: number
  total_ai_tokens: number
  avg_hold_time_hours: number
  by_category: Record<string, { trades: number; wins: number; pnl: number; fees: number }>
  by_close_reason: Record<string, number>
  balance_history: Array<{ date: string; balance: number; pnl: number; trades: number; win_rate: number | null }>
}

export const sandboxKeys = {
  status: ['sandbox', 'status'] as const,
  analytics: ['sandbox', 'analytics'] as const,
}

export function useSandboxStatus() {
  return useQuery({
    queryKey: sandboxKeys.status,
    queryFn: () => api.get<SandboxStatus>('/api/sandbox/status'),
    staleTime: 10_000,
  })
}

export function useSandboxAnalytics() {
  return useQuery({
    queryKey: sandboxKeys.analytics,
    queryFn: () => api.get<SandboxAnalytics>('/api/sandbox/analytics'),
    staleTime: 30_000,
  })
}

export function useStartSandbox() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (starting_balance: number) =>
      api.post('/api/sandbox/start', { starting_balance }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sandbox'] })
      qc.invalidateQueries({ queryKey: ['bankroll'] })
    },
  })
}

export function useResetSandbox() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (starting_balance?: number) =>
      api.post('/api/sandbox/reset', { starting_balance }),
    onSuccess: () => {
      qc.invalidateQueries()
    },
  })
}

export function useStopSandbox() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/api/sandbox/stop'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['sandbox'] })
    },
  })
}
