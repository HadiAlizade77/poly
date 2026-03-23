import { Bell, Power } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAppStore } from '@/stores/app.store'
import { useSystemHealth } from '@/hooks/useSystemHealth'

const WS_STATUS_CONFIG = {
  connected: { label: 'Connected', dot: 'bg-profit' },
  connecting: { label: 'Connecting…', dot: 'bg-warning animate-pulse' },
  disconnected: { label: 'Disconnected', dot: 'bg-loss' },
} as const

function MiniHealthIndicator() {
  const { health } = useSystemHealth()

  if (!health) return null

  const dbOk = health.db === 'ok'
  const redisOk = health.redis === 'ok'
  const allOk = dbOk && redisOk

  return (
    <Link
      to="/health"
      className="flex items-center gap-1.5 px-2 py-1 rounded-md hover:bg-surface-2 transition-colors group"
      title="System Health"
    >
      <span
        className={cn(
          'w-2 h-2 rounded-full shrink-0',
          allOk ? 'bg-profit' : 'bg-warning animate-pulse'
        )}
      />
      <span className="text-xs text-muted-foreground group-hover:text-slate-300 hidden sm:inline">
        {allOk ? 'Healthy' : 'Degraded'}
      </span>
      {/* Individual service dots */}
      <span className="hidden md:flex items-center gap-0.5 ml-0.5">
        <span className={cn('w-1.5 h-1.5 rounded-full', dbOk ? 'bg-profit' : 'bg-loss')} title="DB" />
        <span className={cn('w-1.5 h-1.5 rounded-full', redisOk ? 'bg-profit' : 'bg-loss')} title="Redis" />
      </span>
    </Link>
  )
}

export function Header() {
  const { killSwitchEnabled, toggleKillSwitch, connectionStatus } = useAppStore()
  const wsStatus = WS_STATUS_CONFIG[connectionStatus]

  return (
    <header className="h-14 flex items-center justify-between px-4 bg-surface border-b border-border shrink-0">
      <div className="flex items-center gap-2">
        <span className="text-sm font-medium text-slate-300">
          Polymarket AI Trading Platform
        </span>
      </div>

      <div className="flex items-center gap-2">
        {/* Mini health indicator */}
        <MiniHealthIndicator />

        <div className="w-px h-4 bg-border mx-1" />

        {/* WebSocket connection status */}
        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
          <span className={cn('w-2 h-2 rounded-full', wsStatus.dot)} />
          <span className="hidden sm:inline">{wsStatus.label}</span>
        </div>

        {/* Notification bell */}
        <button
          className="relative p-1.5 rounded-md text-slate-400 hover:text-slate-200 hover:bg-surface-2 transition-colors"
          aria-label="Notifications"
        >
          <Bell className="w-4 h-4" />
        </button>

        {/* Kill switch */}
        <button
          onClick={toggleKillSwitch}
          className={cn(
            'flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium transition-colors',
            killSwitchEnabled
              ? 'bg-loss/20 text-loss hover:bg-loss/30 border border-loss/30'
              : 'bg-surface-2 text-slate-400 hover:text-slate-200 hover:bg-slate-700 border border-border'
          )}
          aria-label="Toggle kill switch"
        >
          <Power className="w-3.5 h-3.5" />
          <span className="hidden sm:inline">
            {killSwitchEnabled ? 'Kill Switch ON' : 'Kill Switch'}
          </span>
        </button>
      </div>
    </header>
  )
}
