import { useState } from 'react'
import { Bell, Play, Square, Pause, AlertTriangle, ChevronDown, FlaskConical } from 'lucide-react'
import { Link } from 'react-router-dom'
import { cn } from '@/lib/utils'
import { useAppStore, type TradingState } from '@/stores/app.store'
import { useSystemHealth } from '@/hooks/useSystemHealth'
import { useTradingState, useSetTradingState } from '@/hooks/useTradingState'
import { useSandboxStatus } from '@/hooks/useSandbox'

const WS_STATUS_CONFIG = {
  connected: { label: 'Connected', dot: 'bg-profit' },
  connecting: { label: 'Connecting...', dot: 'bg-warning animate-pulse' },
  disconnected: { label: 'Disconnected', dot: 'bg-loss' },
} as const

// ─── Trading state display config ────────────────────────────────────────────

const STATE_CONFIG: Record<
  TradingState,
  { label: string; color: string; bgColor: string; borderColor: string; icon: typeof Play }
> = {
  running: {
    label: 'Running',
    color: 'text-profit',
    bgColor: 'bg-profit/15',
    borderColor: 'border-profit/30',
    icon: Play,
  },
  stopped: {
    label: 'Stopped',
    color: 'text-loss',
    bgColor: 'bg-loss/15',
    borderColor: 'border-loss/30',
    icon: Square,
  },
  paused_all: {
    label: 'Paused',
    color: 'text-warning',
    bgColor: 'bg-warning/15',
    borderColor: 'border-warning/30',
    icon: Pause,
  },
  paused_sells: {
    label: 'No Sells',
    color: 'text-warning',
    bgColor: 'bg-warning/15',
    borderColor: 'border-warning/30',
    icon: Pause,
  },
}

// ─── Mini health indicator ──────────────────────────────────────────────────

function MiniHealthIndicator() {
  const { health } = useSystemHealth()

  if (!health) return null

  const dbOk = health.db === 'ok'
  const redisOk = health.redis === 'ok'
  const allOk = dbOk && redisOk

  return (
    <Link
      to="/settings?tab=health"
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
      <span className="hidden md:flex items-center gap-0.5 ml-0.5">
        <span className={cn('w-1.5 h-1.5 rounded-full', dbOk ? 'bg-profit' : 'bg-loss')} title="DB" />
        <span className={cn('w-1.5 h-1.5 rounded-full', redisOk ? 'bg-profit' : 'bg-loss')} title="Redis" />
      </span>
    </Link>
  )
}

// ─── Sandbox badge ───────────────────────────────────────────────────────────

function SandboxBadge() {
  const { data: sandbox } = useSandboxStatus()
  if (!sandbox?.active) return null

  return (
    <Link
      to="/settings?tab=general"
      className={cn(
        'flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium',
        'bg-warning/15 border border-warning/30 text-warning animate-pulse'
      )}
    >
      <FlaskConical className="w-3.5 h-3.5" />
      <span className="hidden sm:inline">SANDBOX</span>
      <span className="font-numeric">${sandbox.current_balance.toLocaleString('en-US', { maximumFractionDigits: 0 })}</span>
    </Link>
  )
}

// ─── Confirmation modal ────────────────────────────────────────────────────

interface ConfirmModalProps {
  title: string
  description: string
  confirmLabel: string
  confirmClass: string
  onConfirm: () => void
  onCancel: () => void
  isPending: boolean
}

function ConfirmModal({
  title,
  description,
  confirmLabel,
  confirmClass,
  onConfirm,
  onCancel,
  isPending,
}: ConfirmModalProps) {
  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center">
      <div className="bg-surface border border-border rounded-lg p-6 max-w-sm w-full mx-4 shadow-xl">
        <div className="flex flex-col items-center gap-4 text-center">
          <AlertTriangle className="w-8 h-8 text-warning" />
          <div>
            <h3 className="text-sm font-semibold text-slate-100 mb-1">{title}</h3>
            <p className="text-xs text-muted-foreground">{description}</p>
          </div>
          <div className="flex gap-2 w-full">
            <button
              onClick={onCancel}
              disabled={isPending}
              className="flex-1 px-3 py-2 rounded-md text-xs font-medium bg-surface-2 text-slate-300 hover:text-slate-100 hover:bg-slate-700 transition-colors disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              onClick={onConfirm}
              disabled={isPending}
              className={cn(
                'flex-1 px-3 py-2 rounded-md text-xs font-medium text-white transition-colors disabled:opacity-50',
                confirmClass
              )}
            >
              {isPending ? 'Applying...' : confirmLabel}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}

// ─── Pause mode dropdown ─────────────────────────────────────────────────────

interface PauseDropdownProps {
  onSelect: (state: TradingState) => void
  onClose: () => void
}

function PauseDropdown({ onSelect, onClose }: PauseDropdownProps) {
  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />
      <div className="absolute right-0 top-full mt-1 z-50 bg-surface border border-border rounded-lg shadow-xl py-1 min-w-[180px]">
        <button
          onClick={() => onSelect('paused_all')}
          className="w-full px-3 py-2 text-left text-xs hover:bg-surface-2 transition-colors"
        >
          <div className="font-medium text-slate-200">Pause Everything</div>
          <div className="text-muted-foreground mt-0.5">No new trades, no exits</div>
        </button>
        <button
          onClick={() => onSelect('paused_sells')}
          className="w-full px-3 py-2 text-left text-xs hover:bg-surface-2 transition-colors"
        >
          <div className="font-medium text-slate-200">Pause Sells Only</div>
          <div className="text-muted-foreground mt-0.5">New buys allowed, no sells or exits</div>
        </button>
      </div>
    </>
  )
}

// ─── Trading Control ────────────────────────────────────────────────────────

function TradingControl() {
  const tradingState = useAppStore((s) => s.tradingState)
  const setStateMutation = useSetTradingState()
  const [confirmAction, setConfirmAction] = useState<TradingState | null>(null)
  const [showPauseMenu, setShowPauseMenu] = useState(false)

  // Load state from backend on mount
  useTradingState()

  const cfg = STATE_CONFIG[tradingState]
  const StateIcon = cfg.icon

  const handleStart = () => setConfirmAction('running')
  const handleStop = () => setConfirmAction('stopped')
  const handlePauseSelect = (state: TradingState) => {
    setShowPauseMenu(false)
    setConfirmAction(state)
  }

  const handleConfirm = () => {
    if (!confirmAction) return
    setStateMutation.mutate(
      { state: confirmAction },
      {
        onSettled: () => setConfirmAction(null),
      }
    )
  }

  const confirmConfig: Record<TradingState, { title: string; desc: string; label: string; cls: string }> = {
    running: {
      title: 'Start Trading?',
      desc: 'This will activate the full trading pipeline — market scanning, AI decisions, and order execution.',
      label: 'Start Trading',
      cls: 'bg-profit hover:bg-green-600',
    },
    stopped: {
      title: 'Stop Trading?',
      desc: 'This will halt all trading activity immediately. No new orders will be placed and exit monitoring will stop.',
      label: 'Stop Trading',
      cls: 'bg-loss hover:bg-red-600',
    },
    paused_all: {
      title: 'Pause All Trading?',
      desc: 'No new trades will be placed and no positions will be exited. Market scanning continues for data collection.',
      label: 'Pause All',
      cls: 'bg-warning hover:bg-amber-600',
    },
    paused_sells: {
      title: 'Pause Sells Only?',
      desc: 'New buy orders are still allowed, but no sell orders will be placed and no automatic exits will trigger.',
      label: 'Pause Sells',
      cls: 'bg-warning hover:bg-amber-600',
    },
  }

  return (
    <>
      <div className="flex items-center gap-1">
        {/* Current state badge */}
        <div
          className={cn(
            'flex items-center gap-1.5 px-2.5 py-1.5 rounded-l-md text-xs font-medium border',
            cfg.bgColor,
            cfg.borderColor,
            cfg.color
          )}
        >
          <StateIcon className="w-3 h-3" />
          <span className="hidden sm:inline">{cfg.label}</span>
        </div>

        {/* Action buttons based on current state */}
        {tradingState === 'stopped' && (
          <button
            onClick={handleStart}
            className="flex items-center gap-1 px-2.5 py-1.5 rounded-r-md text-xs font-medium bg-profit/15 text-profit border border-profit/30 hover:bg-profit/25 transition-colors"
            title="Start trading"
          >
            <Play className="w-3 h-3" />
            <span className="hidden sm:inline">Start</span>
          </button>
        )}

        {tradingState === 'running' && (
          <>
            <div className="relative">
              <button
                onClick={() => setShowPauseMenu((v) => !v)}
                className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium bg-warning/15 text-warning border border-warning/30 hover:bg-warning/25 transition-colors"
                title="Pause trading"
              >
                <Pause className="w-3 h-3" />
                <ChevronDown className="w-3 h-3" />
              </button>
              {showPauseMenu && (
                <PauseDropdown
                  onSelect={handlePauseSelect}
                  onClose={() => setShowPauseMenu(false)}
                />
              )}
            </div>
            <button
              onClick={handleStop}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-r-md text-xs font-medium bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25 transition-colors"
              title="Stop trading"
            >
              <Square className="w-3 h-3" />
              <span className="hidden sm:inline">Stop</span>
            </button>
          </>
        )}

        {(tradingState === 'paused_all' || tradingState === 'paused_sells') && (
          <>
            <button
              onClick={handleStart}
              className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-medium bg-profit/15 text-profit border border-profit/30 hover:bg-profit/25 transition-colors"
              title="Resume trading"
            >
              <Play className="w-3 h-3" />
              <span className="hidden sm:inline">Resume</span>
            </button>
            <button
              onClick={handleStop}
              className="flex items-center gap-1 px-2.5 py-1.5 rounded-r-md text-xs font-medium bg-loss/15 text-loss border border-loss/30 hover:bg-loss/25 transition-colors"
              title="Stop trading"
            >
              <Square className="w-3 h-3" />
            </button>
          </>
        )}
      </div>

      {/* Confirmation modal */}
      {confirmAction && (
        <ConfirmModal
          title={confirmConfig[confirmAction].title}
          description={confirmConfig[confirmAction].desc}
          confirmLabel={confirmConfig[confirmAction].label}
          confirmClass={confirmConfig[confirmAction].cls}
          onConfirm={handleConfirm}
          onCancel={() => setConfirmAction(null)}
          isPending={setStateMutation.isPending}
        />
      )}
    </>
  )
}

// ─── Header ─────────────────────────────────────────────────────────────────

export function Header() {
  const { connectionStatus } = useAppStore()
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

        {/* Sandbox mode indicator */}
        <SandboxBadge />

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

        <div className="w-px h-4 bg-border mx-1" />

        {/* Trading state control */}
        <TradingControl />
      </div>
    </header>
  )
}
