import React from 'react'
import { NavLink } from 'react-router-dom'
import {
  LayoutDashboard,
  TrendingUp,
  Brain,
  Zap,
  ShoppingCart,
  Wallet,
  Shield,
  BarChart3,
  Settings,
  ChevronLeft,
  ChevronRight,
  Activity,
  HeartPulse,
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
  { to: '/scorers', icon: Activity, label: 'Context Scorers' },
  { to: '/decisions', icon: Brain, label: 'AI Decisions' },
  { to: '/orders', icon: ShoppingCart, label: 'Orders' },
  { to: '/positions', icon: Wallet, label: 'Positions' },
  { to: '/risk', icon: Shield, label: 'Risk' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
  { to: '/settings', icon: Settings, label: 'Settings' },
  { to: '/health', icon: HeartPulse, label: 'System Health' },
]

export function Sidebar() {
  const { sidebarOpen, toggleSidebar } = useAppStore()

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
          <div className="w-7 h-7 rounded bg-info flex items-center justify-center shrink-0">
            <Zap className="w-4 h-4 text-white" />
          </div>
          {sidebarOpen && (
            <span className="font-semibold text-sm text-slate-100 truncate">
              Polymarket AI
            </span>
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
