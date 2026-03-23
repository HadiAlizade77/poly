import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { RiskConfig, RiskEvent } from '@polymarket/shared'
import { api } from '@/lib/api'

export const riskKeys = {
  config: ['risk', 'config'] as const,
  events: (filters?: Record<string, unknown>) => ['risk', 'events', filters] as const,
  killSwitch: ['risk', 'kill-switch'] as const,
}

export function useRiskConfig() {
  return useQuery({
    queryKey: riskKeys.config,
    queryFn: () => api.get<RiskConfig>('/api/risk/config'),
    staleTime: 60_000,
  })
}

export function useRiskEvents(filters?: { severity?: string; limit?: number }) {
  return useQuery({
    queryKey: riskKeys.events(filters),
    queryFn: () => {
      const params = new URLSearchParams()
      if (filters?.severity) params.set('severity', filters.severity)
      if (filters?.limit) params.set('limit', String(filters.limit))
      const qs = params.toString()
      return api.get<RiskEvent[]>(`/api/risk/events${qs ? `?${qs}` : ''}`)
    },
    staleTime: 15_000,
  })
}

export function useUpdateRiskConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<RiskConfig>) =>
      api.put<RiskConfig>('/api/risk/config', config),
    onSuccess: (updated) => {
      qc.setQueryData(riskKeys.config, updated)
    },
  })
}

export function useToggleKillSwitch() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (enabled: boolean) =>
      api.patch<{ kill_switch_enabled: boolean }>('/api/risk/kill-switch', { enabled }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: riskKeys.config })
    },
  })
}
