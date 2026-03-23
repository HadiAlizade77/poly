import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Alert } from '@polymarket/shared'
import { api } from '@/lib/api'

export const alertKeys = {
  all: ['alerts'] as const,
  list: (filters?: Record<string, unknown>) => ['alerts', 'list', filters] as const,
  unreadCount: ['alerts', 'unread-count'] as const,
}

export function useAlerts(filters?: { unread_only?: boolean; limit?: number }) {
  return useQuery({
    queryKey: alertKeys.list(filters),
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters?.unread_only) params.set('unread_only', 'true')
      if (filters?.limit) params.set('limit', String(filters.limit))
      const qs = params.toString()
      return api.get<Alert[]>(`/api/alerts${qs ? `?${qs}` : ''}`)
    },
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

export function useUnreadAlertCount() {
  return useQuery({
    queryKey: alertKeys.unreadCount,
    queryFn: () => api.get<{ count: number }>('/api/alerts/unread-count'),
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

export function useMarkAlertRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.patch<void>(`/api/alerts/${id}/read`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: alertKeys.all })
    },
  })
}

export function useMarkAllAlertsRead() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: () => api.patch<void>('/api/alerts/mark-all-read'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: alertKeys.all })
    },
  })
}

export function useDismissAlert() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (id: string) => api.patch<void>(`/api/alerts/${id}/dismiss`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: alertKeys.all })
    },
  })
}
