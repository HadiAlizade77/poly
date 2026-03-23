import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScorerConfig, ContextScoreRecord } from '@polymarket/shared'
import { api } from '@/lib/api'

interface Paginated<T> { data: T[]; meta: unknown }

export const scorerKeys = {
  all: ['scorers'] as const,
  configs: (category?: string) => ['scorers', 'configs', category] as const,
  scores: (marketId?: string) => ['scorers', 'scores', marketId] as const,
}

export function useScorerConfigs(category?: string) {
  return useQuery({
    queryKey: scorerKeys.configs(category),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (category) params.set('category', category)
      const qs = params.toString()
      const result = await api.get<Paginated<ScorerConfig> | ScorerConfig[]>(`/api/scorers${qs ? `?${qs}` : ''}`)
      return Array.isArray(result) ? result : (result as Paginated<ScorerConfig>).data
    },
    staleTime: 60_000,
  })
}

export function useScorerConfig(id: string) {
  return useQuery({
    queryKey: [...scorerKeys.configs(), id],
    queryFn: () => api.get<ScorerConfig>(`/api/scorers/${id}`),
    enabled: Boolean(id),
  })
}

export function useContextScores(marketId?: string) {
  return useQuery({
    queryKey: scorerKeys.scores(marketId),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (marketId) params.set('market_id', marketId)
      const qs = params.toString()
      const result = await api.get<Paginated<ContextScoreRecord> | ContextScoreRecord[]>(`/api/scorers/scores${qs ? `?${qs}` : ''}`)
      if (Array.isArray(result)) return result
      const paged = result as Paginated<ContextScoreRecord>
      return paged.data ?? []
    },
    staleTime: 30_000,
    retry: false,
  })
}

export function useToggleScorer() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.patch<ScorerConfig>(`/api/scorers/${id}/toggle`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scorerKeys.all })
    },
  })
}

export function useUpsertScorerConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<ScorerConfig>) =>
      api.put<ScorerConfig>('/api/scorers', config),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: scorerKeys.all })
    },
  })
}
