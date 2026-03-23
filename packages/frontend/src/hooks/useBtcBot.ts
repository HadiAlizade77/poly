import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface BtcBotSignals {
  current_price: number
  trend: 'up' | 'down' | 'flat'
  momentum_1m: number
  momentum_3m: number
  momentum_5m: number
  rsi: number
  rsi_signal: 'overbought' | 'oversold' | 'neutral'
  volume_ratio: number
  volume_surge: boolean
  vwap: number
  price_vs_vwap: 'above' | 'below' | 'at'
  direction_score: number
  confidence: number
  suggested_side: 'YES' | 'NO'
  candle_count: number
}

export interface BtcBotActiveMarket {
  id: string
  title: string
  endDate: string
  yesPrice: number
  noPrice: number
}

export interface BtcBotBotStatus {
  signals: BtcBotSignals | null
  activeMarket: BtcBotActiveMarket | null
  tradedThisWindow: boolean
  windowsTradedCount: number
}

export interface BtcBotStats {
  total_trades: number
  wins: number
  losses: number
  pnl: number
}

export interface BtcBotLastDecision {
  action: 'trade' | 'hold' | 'skip'
  direction?: 'buy' | 'sell'
  confidence: number
  reasoning: string
  timestamp: string
}

export interface BtcBotStatusData {
  active: boolean
  latest_signals: BtcBotSignals | null
  bot_status: BtcBotBotStatus
  stats: BtcBotStats
  last_decision: BtcBotLastDecision | null
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const btcBotKeys = {
  status: ['btc-bot-status'] as const,
}

// ─── Hooks ────────────────────────────────────────────────────────────────────

export function useBtcBotStatus() {
  return useQuery({
    queryKey: btcBotKeys.status,
    queryFn: () => api.get<BtcBotStatusData>('/api/btc-bot/status'),
    refetchInterval: 5_000,
    staleTime: 3_000,
  })
}

export function useStartBtcBot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/api/btc-bot/start'),
    onSuccess: () => qc.invalidateQueries({ queryKey: btcBotKeys.status }),
  })
}

export function useStopBtcBot() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.post('/api/btc-bot/stop'),
    onSuccess: () => qc.invalidateQueries({ queryKey: btcBotKeys.status }),
  })
}
