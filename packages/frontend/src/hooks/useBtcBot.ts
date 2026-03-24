import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

// ─── Types ────────────────────────────────────────────────────────────────────

export type BtcBotLogType = 'buy' | 'sell' | 'hold' | 'signal' | 'close' | 'flip' | 'info' | 'error'

export interface BtcBotLogEntry {
  id: string
  timestamp: string
  type: BtcBotLogType
  message: string
  meta?: Record<string, unknown>
}

export interface BtcBotLogsData {
  log: BtcBotLogEntry[]
  count: number
}

export interface BtcBotTradeEntry {
  timestamp: string
  action: string
  side: string        // outcome token name (e.g. YES / NO token id)
  order_side: string  // buy | sell
  price: number
  size: number
  pnl: number | null
  ai_reasoning: string | null
  confidence: number | null
}

export interface BtcBotAiDecisionEntry {
  timestamp: string
  action: string
  side: string | null
  direction: string | null
  price: number | null
  size: null
  pnl: null
  ai_reasoning: string | null
  confidence: number
  was_executed: boolean
  estimated_edge: number | null
}

export interface BtcBotTradesData {
  trades: BtcBotTradeEntry[]
  ai_decisions: BtcBotAiDecisionEntry[]
}

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
  endDate: string | null
  yesPrice: number
  noPrice: number
}

export interface BtcBotBotStatus {
  signals: BtcBotSignals | null
  activeMarket: BtcBotActiveMarket | null
  state: 'flat' | 'long_yes' | 'long_no'
  currentPositionId: string | null
  windowTradeCount: number
  sessionTrades: number
  sessionPnl: number
  lastAction: string | null
  lastActionTime: string | null
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

/** Shape of the btc-bot:status WebSocket event (from the bot's cacheStatus emit). */
export interface BtcBotWsStatusPayload {
  signals: BtcBotSignals | null
  activeMarket: BtcBotActiveMarket | null
  state: BtcBotBotStatus['state']
  windowTradeCount: number
  sessionTrades: number
  sessionPnl: number
  lastAction: string | null
  lastActionTime: string | null
  timestamp: string
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

// Fetch BTC bot activity log (Redis list, newest-first)
export function useBtcBotLogs() {
  return useQuery({
    queryKey: ['btc-bot', 'logs'],
    queryFn: () => api.get<BtcBotLogsData>('/api/btc-bot/logs'),
    refetchInterval: 3_000,
    staleTime: 2_000,
  })
}

// Fetch BTC bot executed trades + AI decisions from DB
export function useBtcBotTrades() {
  return useQuery({
    queryKey: ['btc-bot', 'trades'],
    queryFn: () => api.get<BtcBotTradesData>('/api/btc-bot/trades'),
    refetchInterval: 5_000,
    staleTime: 4_000,
  })
}
