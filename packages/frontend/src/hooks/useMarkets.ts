import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Market, MarketStatus } from '@polymarket/shared'
import { api } from '@/lib/api'

export const marketKeys = {
  all: ['markets'] as const,
  list: (filters?: Record<string, unknown>) => ['markets', 'list', filters] as const,
  detail: (id: string) => ['markets', 'detail', id] as const,
}

export function useMarkets(filters?: { category?: string; status?: MarketStatus; search?: string }) {
  return useQuery({
    queryKey: marketKeys.list(filters),
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters?.category) params.set('category', filters.category)
      if (filters?.status) params.set('status', filters.status)
      if (filters?.search) params.set('search', filters.search)
      const qs = params.toString()
      return api.get<Market[]>(`/api/markets${qs ? `?${qs}` : ''}`)
    },
    staleTime: 30_000,
  })
}

export function useMarket(id: string) {
  return useQuery({
    queryKey: marketKeys.detail(id),
    queryFn: () => api.get<Market>(`/api/markets/${id}`),
    enabled: Boolean(id),
  })
}

export function useUpdateMarketStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: MarketStatus }) =>
      api.patch<Market>(`/api/markets/${id}/status`, { status }),
    onSuccess: (updated) => {
      qc.invalidateQueries({ queryKey: marketKeys.all })
      qc.setQueryData(marketKeys.detail(updated.id), updated)
    },
  })
}
