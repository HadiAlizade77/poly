import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import type { Bankroll, BankrollHistory } from '@polymarket/shared'
import { api } from '@/lib/api'

interface Paginated<T> { data: T[]; meta: unknown }

export const bankrollKeys = {
  current: ['bankroll'] as const,
  history: ['bankroll', 'history'] as const,
}

export function useBankroll() {
  return useQuery({
    queryKey: bankrollKeys.current,
    queryFn: () => api.get<Bankroll>('/api/bankroll'),
    staleTime: 15_000,
    refetchInterval: 60_000,
  })
}

export function useBankrollHistory() {
  return useQuery({
    queryKey: bankrollKeys.history,
    queryFn: async () => {
      const result = await api.get<Paginated<BankrollHistory> | BankrollHistory[]>('/api/bankroll/history')
      return Array.isArray(result) ? result : (result as Paginated<BankrollHistory>).data
    },
    staleTime: 5 * 60_000,
  })
}

export function useUpdateBankroll() {
  const qc = useQueryClient()
  return useMutation({
    mutationFn: (data: Partial<Pick<Bankroll, 'total_balance' | 'reserved_balance'>>) =>
      api.patch<Bankroll>('/api/bankroll', data),
    onSuccess: (updated) => {
      qc.setQueryData(bankrollKeys.current, updated)
    },
  })
}
