import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  TrendingUp,
  Brain,
  Zap,
  ShoppingCart,
  Shield,
  ScrollText,
  Settings,
  ChevronLeft,
  ChevronRight,
  Bitcoin,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'

interface NavItem {
  to: string
  icon: React.ComponentType<{ className?: string }>
  label: string
  end?: boolean
}

const NAV_ITEMS: NavItem[] = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', end: true },
  { to: '/markets', icon: TrendingUp, label: 'Markets' },
  { to: '/trading', icon: ShoppingCart, label: 'Trading' },
  { to: '/btc-bot', icon: Bitcoin, label: 'BTC Bot' },
  { to: '/intelligence', icon: Brain, label: 'Intelligence' },
  { to: '/risk', icon: Shield, label: 'Risk' },
  { to: '/activity', icon: ScrollText, label: 'Activity Log' },
  { to: '/settings', icon: Settings, label: 'Settings' },
]

const TRADING_STATE_DOT: Record<string, string> = {
  running: 'bg-profit',
  stopped: 'bg-loss',
  paused_all: 'bg-warning animate-pulse',
  paused_sells: 'bg-warning animate-pulse',
}

export function Sidebar() {
  const { sidebarOpen, toggleSidebar, tradingState } = useAppStore()
  const stateDot = TRADING_STATE_DOT[tradingState] ?? 'bg-slate-600'

  return (
    <aside
      className={cn(
        'flex flex-col bg-surface border-r border-border transition-all duration-200 shrink-0',
        sidebarOpen ? 'w-56' : 'w-14'
      )}
    >
      {/* Logo */}
      <div className="flex items-center h-14 px-3 border-b border-border">
        <div className="flex items-center gap-2 min-w-0">
          <div className="relative w-7 h-7 rounded bg-info flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-white" />
            {!sidebarOpen && (
              <span
                className={cn(
                  'absolute -bottom-0.5 -right-0.5 w-2 h-2 rounded-full border border-surface',
                  stateDot
                )}
              />
            )}
          </div>
          {sidebarOpen && (
            <>
              <span className="font-semibold text-sm text-slate-100 truncate">
                Polymarket AI
              </span>
              <span
                className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  stateDot
                )}
              />
            </>
          )}
        </div>
      </div>

      {/* Nav links */}
      <nav className="flex-1 py-3 space-y-0.5 px-2 overflow-y-auto">
        {NAV_ITEMS.map(({ to, icon: Icon, label, end }) => (
          <NavLink
            key={to}
            to={to}
            end={end}
            className={({ isActive }) =>
              cn(
                'flex items-center gap-3 px-2 py-2 rounded-md text-sm transition-colors',
                'hover:bg-surface-2 hover:text-slate-100',
                isActive
                  ? 'bg-surface-2 text-slate-100'
                  : 'text-slate-400'
              )
            }
          >
            <Icon className="w-4 h-4 shrink-0" />
            {sidebarOpen && <span className="truncate">{label}</span>}
          </NavLink>
        ))}
      </nav>

      {/* Collapse toggle */}
      <button
        onClick={toggleSidebar}
        className="flex items-center justify-center h-10 border-t border-border text-slate-500 hover:text-slate-300 hover:bg-surface-2 transition-colors"
        aria-label={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
      >
        {sidebarOpen ? (
          <ChevronLeft className="w-4 h-4" />
        ) : (
          <ChevronRight className="w-4 h-4" />
        )}
      </button>
    </aside>
  )
}
