import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { RiskConfig, RiskEvent } from '@polymarket/shared'
import { api } from '@/lib/api'

interface Paginated<T> { data: T[]; meta: unknown }

export const riskKeys = {
  config: ['risk', 'config'] as const,
  events: (filters?: Record<string, unknown>) => ['risk', 'events', filters] as const,
  killSwitch: ['risk', 'kill-switch'] as const,
}

interface RawRiskConfigEntry {
  id: string
  scope: string
  scope_value: string | null
  parameters: Record<string, unknown>
}

export function useRiskConfig() {
  return useQuery({
    queryKey: riskKeys.config,
    queryFn: async () => {
      const configs = await api.get<RawRiskConfigEntry[]>('/api/risk/config')
      const global = configs.find((c) => c.scope === 'global')
      if (!global) return null as unknown as RiskConfig
      const p = global.parameters as Record<string, number | boolean>
      return {
        kill_switch_enabled: Boolean(p.kill_switch_enabled ?? false),
        max_daily_loss: Number(p.max_daily_loss ?? 0),
        max_position_size: Number(p.max_position_size_pct ?? 0),
        max_total_exposure: Number(p.max_total_exposure ?? 0),
        max_single_trade: Number(p.max_single_trade ?? 0),
        max_consecutive_losses: Number(p.max_consecutive_losses ?? 0),
        cooldown_after_loss_streak_minutes: Number(p.cooldown_after_loss_streak_minutes ?? 0),
        min_liquidity: Number(p.min_liquidity ?? 0),
        max_spread: Number(p.max_spread ?? 0),
        max_latency_ms: Number(p.latency_threshold_ms ?? 3000),
        max_data_age_seconds: Number(p.min_scorer_data_freshness_seconds ?? 120),
      } satisfies RiskConfig
    },
    staleTime: 60_000,
  })
}

export function useRiskEvents(filters?: { severity?: string; limit?: number }) {
  return useQuery({
    queryKey: riskKeys.events(filters),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (filters?.severity) params.set('severity', filters.severity)
      if (filters?.limit) params.set('limit', String(filters.limit))
      const qs = params.toString()
      const result = await api.get<Paginated<RiskEvent> | RiskEvent[]>(`/api/risk/events${qs ? `?${qs}` : ''}`)
      return Array.isArray(result) ? result : (result as Paginated<RiskEvent>).data
    },
    staleTime: 15_000,
  })
}

export function useUpdateRiskConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (config: Partial<RiskConfig>) => {
      // Backend expects { scope, parameters } with its own field names
      const parameters: Record<string, unknown> = {}
      if (config.max_daily_loss !== undefined)                    parameters.max_daily_loss = config.max_daily_loss
      if (config.max_position_size !== undefined)                 parameters.max_position_size_pct = config.max_position_size
      if (config.max_total_exposure !== undefined)                parameters.max_total_exposure = config.max_total_exposure
      if (config.max_single_trade !== undefined)                  parameters.max_single_trade = config.max_single_trade
      if (config.max_consecutive_losses !== undefined)            parameters.max_consecutive_losses = config.max_consecutive_losses
      if (config.cooldown_after_loss_streak_minutes !== undefined) parameters.cooldown_after_loss_streak_minutes = config.cooldown_after_loss_streak_minutes
      if (config.min_liquidity !== undefined)                     parameters.min_liquidity = config.min_liquidity
      if (config.max_spread !== undefined)                        parameters.max_spread = config.max_spread
      if (config.max_latency_ms !== undefined)                    parameters.latency_threshold_ms = config.max_latency_ms
      if (config.max_data_age_seconds !== undefined)              parameters.min_scorer_data_freshness_seconds = config.max_data_age_seconds
      return api.put<unknown>('/api/risk/config', { scope: 'global', parameters })
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: riskKeys.config })
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
