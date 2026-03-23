import { useQuery } from '@tanstack/react-query'
import type { AIDecision } from '@polymarket/shared'
import { api } from '@/lib/api'

interface Paginated<T> { data: T[]; meta: unknown }

interface DecisionStats {
  total: number
  trades: number
  holds: number
  executed: number
  vetoed: number
  avg_confidence: number | null
  avg_edge: number | null
}

export const decisionKeys = {
  all: ['decisions'] as const,
  list: (filters?: Record<string, unknown>) => ['decisions', 'list', filters] as const,
  stats: ['decisions', 'stats'] as const,
  detail: (id: string) => ['decisions', 'detail', id] as const,
}

export function useDecisions(filters?: { market_id?: string; action?: string; limit?: number }) {
  return useQuery({
    queryKey: decisionKeys.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.market_id) params.set('market_id', filters.market_id)
      if (filters?.action) params.set('action', filters.action)
      if (filters?.limit) params.set('limit', String(filters.limit))
      const qs = params.toString()
      const result = await api.get<Paginated<AIDecision> | AIDecision[]>(`/api/decisions${qs ? `?${qs}` : ''}`)
      return Array.isArray(result) ? result : (result as Paginated<AIDecision>).data
    },
    staleTime: 15_000,
  })
}

export function useDecisionStats() {
  return useQuery({
    queryKey: decisionKeys.stats,
    queryFn: () => api.get<DecisionStats>('/api/decisions/stats'),
    staleTime: 30_000,
  })
}

export function useDecision(id: string) {
  return useQuery({
    queryKey: decisionKeys.detail(id),
    queryFn: () => api.get<AIDecision>(`/api/decisions/${id}`),
    enabled: Boolean(id),
  })
}
