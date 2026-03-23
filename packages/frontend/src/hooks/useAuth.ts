import { useMutation } from '@tanstack/react-query'
import { api } from '@/lib/api'

const TOKEN_KEY = 'polymarket_auth_token'

interface LoginResponse {
  token: string
  expiresAt: string
}

function saveToken(token: string) {
  localStorage.setItem(TOKEN_KEY, token)
}

function clearToken() {
  localStorage.removeItem(TOKEN_KEY)
}

export function getAuthToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function useAuthToken() {
  return getAuthToken()
}

export function useLogin() {
  return useMutation({
    mutationFn: (password: string) =>
      api.post<LoginResponse>('/api/auth/login', { password }),
    onSuccess: ({ token }) => {
      saveToken(token)
    },
  })
}

export function useLogout() {
  return useMutation({
    mutationFn: async () => {
      clearToken()
    },
  })
}
