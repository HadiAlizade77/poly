import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

interface SystemConfig {
  key: string
  value: unknown
  updated_at: string
}

interface HealthStatus {
  status: 'ok' | 'degraded' | 'down'
  uptime: number
  services?: Record<string, 'ok' | 'degraded' | 'down'>
  timestamp: string
  environment?: string
}

export const systemKeys = {
  all: ['system-config'] as const,
  one: (key: string) => ['system-config', key] as const,
  health: ['health'] as const,
}

export function useSystemConfigs() {
  return useQuery({
    queryKey: systemKeys.all,
    queryFn: () => api.get<SystemConfig[]>('/api/system-config'),
    staleTime: 5 * 60_000,
  })
}

export function useSystemConfig(key: string) {
  return useQuery({
    queryKey: systemKeys.one(key),
    queryFn: () => api.get<SystemConfig>(`/api/system-config/${key}`),
    enabled: Boolean(key),
    staleTime: 5 * 60_000,
  })
}

export function useHealth() {
  return useQuery({
    queryKey: systemKeys.health,
    queryFn: () => api.get<HealthStatus>('/api/health'),
    staleTime: 10_000,
    refetchInterval: 30_000,
  })
}

export function useSetSystemConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: ({ key, value }: { key: string; value: unknown }) =>
      api.put<SystemConfig>(`/api/system-config/${key}`, { value }),
    onSuccess: (updated) => {
      qc.setQueryData(systemKeys.one(updated.key), updated)
      qc.invalidateQueries({ queryKey: systemKeys.all })
    },
  })
}
