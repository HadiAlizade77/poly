import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Order, OrderStatus } from '@polymarket/shared'
import { api } from '@/lib/api'

export const orderKeys = {
  all: ['orders'] as const,
  list: (filters?: Record<string, unknown>) => ['orders', 'list', filters] as const,
  detail: (id: string) => ['orders', 'detail', id] as const,
}

export function useOrders(filters?: { market_id?: string; status?: OrderStatus; limit?: number }) {
  return useQuery({
    queryKey: orderKeys.list(filters),
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters?.market_id) params.set('market_id', filters.market_id)
      if (filters?.status) params.set('status', filters.status)
      if (filters?.limit) params.set('limit', String(filters.limit))
      const qs = params.toString()
      return api.get<Order[]>(`/api/orders${qs ? `?${qs}` : ''}`)
    },
    staleTime: 10_000,
  })
}

export function useOrder(id: string) {
  return useQuery({
    queryKey: orderKeys.detail(id),
    queryFn: () => api.get<Order>(`/api/orders/${id}`),
    enabled: Boolean(id),
  })
}

export function useUpdateOrderStatus() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ id, status }: { id: string; status: OrderStatus }) =>
      api.patch<Order>(`/api/orders/${id}/status`, { status }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: orderKeys.all })
    },
  })
}
