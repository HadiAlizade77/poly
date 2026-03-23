import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Position, ExitStrategy } from '@polymarket/shared'
import { api } from '@/lib/api'

interface Paginated<T> { data: T[]; meta: unknown }

export const positionKeys = {
  all: ['positions'] as const,
  list: (filters?: Record<string, unknown>) => ['positions', 'list', filters] as const,
  detail: (id: string) => ['positions', 'detail', id] as const,
}

export function usePositions(filters?: { market_id?: string }) {
  return useQuery({
    queryKey: positionKeys.list(filters),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.market_id) params.set('market_id', filters.market_id)
      const qs = params.toString()
      const result = await api.get<Paginated<Position> | Position[]>(`/api/positions${qs ? `?${qs}` : ''}`)
      return Array.isArray(result) ? result : (result as Paginated<Position>).data
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

export function usePosition(id: string) {
  return useQuery({
    queryKey: positionKeys.detail(id),
    queryFn: () => api.get<Position>(`/api/positions/${id}`),
    enabled: Boolean(id),
  })
}

export function usePositionHistory() {
  return useQuery({
    queryKey: ['positions', 'history'],
    queryFn: async () => {
      const result = await api.get<Paginated<import('@polymarket/shared').PositionHistory> | import('@polymarket/shared').PositionHistory[]>('/api/positions/history')
      return Array.isArray(result) ? result : (result as Paginated<import('@polymarket/shared').PositionHistory>).data
    },
    staleTime: 60_000,
    retry: false,
  })
}

export function useClosePosition() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.post<void>(`/api/positions/${id}/close`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: positionKeys.all })
    },
  })
}

export function useUpdateExitStrategy() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, exit_strategy }: { id: string; exit_strategy: ExitStrategy }) =>
      api.patch<Position>(`/api/positions/${id}/exit-strategy`, { exit_strategy }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: positionKeys.all })
    },
  })
}
