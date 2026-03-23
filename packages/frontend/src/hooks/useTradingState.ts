import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { useEffect } from 'react'
import { api } from '@/lib/api'
import { useAppStore, type TradingState } from '@/stores/app.store'
import { useSocket } from '@/hooks/useSocket'

export const tradingStateKeys = {
  state: ['trading', 'state'] as const,
}

/** Fetch current trading state from backend and keep Zustand + WebSocket in sync. */
export function useTradingState() {
  const setTradingState = useAppStore((s) => s.setTradingState)
  const { socket } = useSocket()

  const query = useQuery({
    queryKey: tradingStateKeys.state,
    queryFn: async () => {
      const result = await api.get<{ state: TradingState }>('/api/risk/trading-state')
      return result.state
    },
    staleTime: 15_000,
  })

  // Sync backend state to Zustand on load
  useEffect(() => {
    if (query.data) {
      setTradingState(query.data)
    }
  }, [query.data, setTradingState])

  // Listen for WebSocket trading state changes
  useEffect(() => {
    if (!socket) return

    const handler = (data: { state: TradingState }) => {
      setTradingState(data.state)
    }

    socket.on('trading:state', handler)
    return () => {
      socket.off('trading:state', handler)
    }
  }, [socket, setTradingState])

  return query
}

/** Mutation to change trading state. */
export function useSetTradingState() {
  const qc = useQueryClient()
  const setTradingState = useAppStore((s) => s.setTradingState)

  return useMutation({
    mutationFn: async ({ state, reason }: { state: TradingState; reason?: string }) => {
      const result = await api.patch<{ state: TradingState }>('/api/risk/trading-state', {
        state,
        reason,
      })
      return result.state
    },
    onSuccess: (newState) => {
      setTradingState(newState)
      qc.invalidateQueries({ queryKey: tradingStateKeys.state })
      qc.invalidateQueries({ queryKey: ['risk', 'config'] })
      qc.invalidateQueries({ queryKey: ['risk', 'kill-switch'] })
    },
  })
}
