import { create } from 'zustand'
import { persist } from 'zustand/middleware'

type ConnectionStatus = 'connected' | 'disconnected' | 'connecting'

interface AppState {
  sidebarOpen: boolean
  killSwitchEnabled: boolean
  connectionStatus: ConnectionStatus
  toggleSidebar: () => void
  setSidebarOpen: (open: boolean) => void
  toggleKillSwitch: () => void
  setConnectionStatus: (status: ConnectionStatus) => void
}

export const useAppStore = create<AppState>()(
  persist(
    (set) => ({
      sidebarOpen: true,
      killSwitchEnabled: false,
      connectionStatus: 'disconnected',

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      toggleKillSwitch: () => set((s) => ({ killSwitchEnabled: !s.killSwitchEnabled })),
      setConnectionStatus: (status) => set({ connectionStatus: status }),
    }),
    {
      name: 'polymarket-app',
      partialize: (s) => ({ sidebarOpen: s.sidebarOpen, killSwitchEnabled: s.killSwitchEnabled }),
    }
  )
)
