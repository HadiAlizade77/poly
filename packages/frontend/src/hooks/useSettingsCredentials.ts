import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '@/lib/api'

// ─── types ────────────────────────────────────────────────────────────────────

export interface CredentialsResponse {
  polymarket_api_key: string
  polymarket_secret: string
  polymarket_passphrase: string
  polymarket_wallet: string
  polymarket_private_key: string
  anthropic_api_key: string
  openrouter_api_key: string
  news_api_key: string
  odds_api_key: string
  polygon_rpc_url: string
}

export interface CredentialsSavePayload {
  polymarket_api_key?: string
  polymarket_secret?: string
  polymarket_passphrase?: string
  polymarket_wallet?: string
  polymarket_private_key?: string
  anthropic_api_key?: string
  openrouter_api_key?: string
  news_api_key?: string
  odds_api_key?: string
  polygon_rpc_url?: string
}

export interface AiConfigResponse {
  provider: 'anthropic' | 'openrouter'
  model: string
  temperature: number
  max_tokens: number
}

export interface AiConfigSavePayload {
  provider: 'anthropic' | 'openrouter'
  model: string
  temperature: number
  max_tokens: number
}

// ─── query keys ───────────────────────────────────────────────────────────────

export const settingsKeys = {
  credentials: ['settings', 'credentials'] as const,
  aiConfig: ['settings', 'ai-config'] as const,
}

// ─── hooks ────────────────────────────────────────────────────────────────────

export function useCredentials() {
  return useQuery({
    queryKey: settingsKeys.credentials,
    queryFn: () => api.get<CredentialsResponse>('/api/settings/credentials'),
    staleTime: 60_000,
    // If endpoint doesn't exist yet, return a safe empty default
    retry: false,
  })
}

export function useSaveCredentials() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: CredentialsSavePayload) =>
      api.post<unknown>('/api/settings/credentials', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.credentials })
    },
  })
}

export function useAiConfig() {
  return useQuery({
    queryKey: settingsKeys.aiConfig,
    queryFn: () => api.get<AiConfigResponse>('/api/settings/ai-config'),
    staleTime: 60_000,
    retry: false,
  })
}

export function useSaveAiConfig() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (payload: AiConfigSavePayload) =>
      api.post<unknown>('/api/settings/ai-config', payload),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: settingsKeys.aiConfig })
    },
  })
}
