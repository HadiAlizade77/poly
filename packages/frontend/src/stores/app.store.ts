import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type TradingState = 'stopped' | 'running' | 'paused_all' | 'paused_sells'
type ConnectionStatus = 'connected' | 'disconnected' | 'connecting'

interface AppState {
  sidebarOpen: boolean
  tradingState: TradingState
  // Keep killSwitchEnabled as derived for backward compatibility
  killSwitchEnabled: boolean
  connectionStatus: ConnectionStatus
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  setTradingState: (state: TradingState) => void
  toggleKillSwitch: () => void
  setConnectionStatus: (status: ConnectionStatus) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      sidebarOpen: true,
      tradingState: 'stopped',
      killSwitchEnabled: true, // stopped = kill switch on
      connectionStatus: 'disconnected',

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      setTradingState: (state) =>
        set({
          tradingState: state,
          killSwitchEnabled: state === 'stopped',
        }),
      toggleKillSwitch: () => {
        // Legacy toggle: maps to stopped/running
        const current = get().tradingState
        const next = current === 'running' ? 'stopped' : 'running'
        set({
          tradingState: next,
          killSwitchEnabled: next === 'stopped',
        })
      },
      setConnectionStatus: (status) => set({ connectionStatus: status }),
    }),
    {
      name: 'polymarket-app',
      partialize: (s) => ({
        sidebarOpen: s.sidebarOpen,
        tradingState: s.tradingState,
        killSwitchEnabled: s.killSwitchEnabled,
      }),
    }
  )
)
