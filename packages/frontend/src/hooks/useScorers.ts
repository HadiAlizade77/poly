import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { ScorerConfig, ContextScoreRecord } from '@polymarket/shared'
import { api } from '@/lib/api'

export const scorerKeys = {
  all: ['scorers'] as const,
  configs: (category?: string) => ['scorers', 'configs', category] as const,
  scores: (marketId?: string) => ['scorers', 'scores', marketId] as const,
}

export function useScorerConfigs(category?: string) {
  return useQuery({
    queryKey: scorerKeys.configs(category),
    queryFn: () => {
      const params = new URLSearchParams()
      if (category) params.set('category', category)
      const qs = params.toString()
      return api.get<ScorerConfig[]>(`/api/scorers${qs ? `?${qs}` : ''}`)
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
    queryFn: () => {
      const params = new URLSearchParams()
      if (marketId) params.set('market_id', marketId)
      const qs = params.toString()
      return api.get<ContextScoreRecord[]>(`/api/scorers/scores${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
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
