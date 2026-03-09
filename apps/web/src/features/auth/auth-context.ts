import { createContext, useContext } from 'react'

export interface AuthContextValue {
  isLoading: boolean
  isAuthenticated: boolean
  isDummyAuth: boolean
  providerName: string
  error: string
  login: () => void
  logout: () => void
}

export const AuthContext = createContext<AuthContextValue | null>(null)

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider')
  }
  return ctx
}
