import React, { useState, useRef, useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'
import { useForm, Controller } from 'react-hook-form'
import { toast } from 'sonner'
import { formatDistanceToNow } from 'date-fns'
import {
  Save,
  Power,
  AlertTriangle,
  Edit2,
  Check,
  X,
  Eye,
  EyeOff,
  Key,
  Lock,
  Brain,
  Cpu,
  Database,
  Server,
  Wifi,
  Clock,
  Radio,
  Globe,
  RefreshCw,
  Users,
  RotateCcw,
  Timer,
  FlaskConical,
  Gauge,
} from 'lucide-react'
import { useRiskConfig, useUpdateRiskConfig, useToggleKillSwitch, useAutoTuneStatus, useAutoTuneRisk, useDisableAutoTune, useRiskAppetite, useUpdateRiskAppetite } from '@/hooks/useRiskConfig'
import { useBtcBotStatus } from '@/hooks/useBtcBot'
import { useSandboxStatus, useSandboxAnalytics, useStartSandbox, useResetSandbox, useStopSandbox } from '@/hooks/useSandbox'
import { useBankroll } from '@/hooks/useBankroll'
import { useSystemConfigs, useSetSystemConfig } from '@/hooks/useSystemConfig'
import {
  useCredentials,
  useSaveCredentials,
  useAiConfig,
  useSaveAiConfig,
} from '@/hooks/useSettingsCredentials'
import type { CredentialsSavePayload, AiConfigSavePayload } from '@/hooks/useSettingsCredentials'
import { useAppStore } from '@/stores/app.store'
import {
  useSystemHealth,
  formatUptime,
  feedStaleness,
  type ServiceStatus,
  type FeedStatus,
} from '@/hooks/useSystemHealth'
import { Badge } from '@/components/ui/Badge'
import { LoadingPage } from '@/components/ui/LoadingSpinner'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'
import type { RiskConfig } from '@polymarket/shared'

// ─── tab definitions ──────────────────────────────────────────────────────────

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'risk', label: 'Risk Config' },
  { id: 'keys', label: 'API Keys' },
  { id: 'ai', label: 'AI Model' },
  { id: 'health', label: 'System Health' },
]

// ─── risk config form ─────────────────────────────────────────────────────────

type RiskFormValues = {
  max_daily_loss: number
  max_position_size: number
  max_total_exposure: number
  max_single_trade: number
  max_consecutive_losses: number
  cooldown_after_loss_streak_minutes: number
  min_liquidity: number
  max_spread: number
  max_latency_ms: number
  max_data_age_seconds: number
}

interface RiskFieldConfig {
  key: keyof RiskFormValues
  label: string
  description: string
  min: number
  max: number
  step: number
  unit?: string
  isPercent?: boolean
}

const RISK_FIELDS: RiskFieldConfig[] = [
  { key: 'max_daily_loss',                     label: 'Max Daily Loss',           description: 'Maximum USD loss allowed per day',                  min: 0,    max: 10000,  step: 10,    unit: '$' },
  { key: 'max_position_size',                  label: 'Max Position Size',        description: 'Maximum fraction of bankroll per position',         min: 0,    max: 1,      step: 0.01,  isPercent: true },
  { key: 'max_total_exposure',                 label: 'Max Total Exposure',       description: 'Maximum total deployed capital in USD',             min: 0,    max: 100000, step: 100,   unit: '$' },
  { key: 'max_single_trade',                   label: 'Max Single Trade',         description: 'Maximum USD size for a single trade',               min: 0,    max: 10000,  step: 10,    unit: '$' },
  { key: 'max_consecutive_losses',             label: 'Max Consecutive Losses',   description: 'Loss streak before cooldown is triggered',          min: 1,    max: 20,     step: 1 },
  { key: 'cooldown_after_loss_streak_minutes', label: 'Cooldown Duration',        description: 'Minutes to pause trading after a loss streak',      min: 0,    max: 1440,   step: 5,     unit: 'min' },
  { key: 'min_liquidity',                      label: 'Min Liquidity',            description: 'Minimum market liquidity in USD to trade',          min: 0,    max: 100000, step: 100,   unit: '$' },
  { key: 'max_spread',                         label: 'Max Spread',               description: 'Maximum bid-ask spread to accept',                  min: 0,    max: 0.5,    step: 0.005, isPercent: true },
  { key: 'max_latency_ms',                     label: 'Max Latency',              description: 'Maximum acceptable order placement latency',         min: 0,    max: 10000,  step: 50,    unit: 'ms' },
  { key: 'max_data_age_seconds',               label: 'Max Data Age',             description: 'Maximum age of price data before rejecting a trade', min: 0,    max: 3600,   step: 10,    unit: 's' },
]

function RiskField({ field, reg }: { field: RiskFieldConfig; reg: ReturnType<ReturnType<typeof useForm<RiskFormValues>>['register']> }) {
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <div>
          <label className="text-sm font-medium text-slate-200">{field.label}</label>
          <p className="text-xs text-muted-foreground">{field.description}</p>
        </div>
        <span className="text-sm font-numeric text-slate-300 min-w-[60px] text-right">{/* value shown by input */}</span>
      </div>
      <div className="flex items-center gap-3">
        <input
          type="range"
          min={field.min}
          max={field.max}
          step={field.step}
          className="flex-1 accent-info"
          {...reg}
        />
        <div className="flex items-center gap-1">
          <input
            type="number"
            min={field.min}
            max={field.max}
            step={field.step}
            className="w-24 bg-surface-2 border border-border rounded px-2 py-1 text-sm font-numeric text-slate-200 focus:outline-none focus:border-info text-right"
            {...reg}
          />
          {(field.unit || field.isPercent) && (
            <span className="text-xs text-muted-foreground">
              {field.isPercent ? '%' : field.unit}
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── risk appetite card ───────────────────────────────────────────────────────

function getRiskAppetiteLabel(level: number): string {
  if (level <= 2) return 'Ultra Conservative — Only trades with very high edge and confidence. Minimal position sizes.'
  if (level <= 4) return 'Conservative — Selective trading with above-average edge requirements.'
  if (level === 5) return 'Balanced — Standard risk approach. Moderate edge requirements.'
  if (level <= 7) return 'Aggressive — Takes more opportunities with lower edge thresholds. Larger positions.'
  if (level <= 9) return 'Very Aggressive — Actively seeks trades. Reduced quality filters.'
  return 'Maximum Risk — Trades on any positive edge. Maximum position sizing.'
}

function getRiskAppetiteBadgeClass(level: number): string {
  if (level <= 3) return 'text-profit bg-profit/10 border-profit/30'
  if (level <= 6) return 'text-info bg-info/10 border-info/30'
  if (level <= 8) return 'text-warning bg-warning/10 border-warning/30'
  return 'text-loss bg-loss/10 border-loss/30'
}

function getRiskAppetiteTrackGradient(level: number): string {
  const pct = ((level - 1) / 9) * 100
  // Track fills with color based on level; remaining track is muted
  if (level <= 3) return `linear-gradient(to right, #22c55e ${pct}%, #1e1e2e ${pct}%)`
  if (level <= 6) return `linear-gradient(to right, #3b82f6 ${pct}%, #1e1e2e ${pct}%)`
  if (level <= 8) return `linear-gradient(to right, #f59e0b ${pct}%, #1e1e2e ${pct}%)`
  return `linear-gradient(to right, #ef4444 ${pct}%, #1e1e2e ${pct}%)`
}

const APPETITE_TICK_LABELS: { value: number; label: string }[] = [
  { value: 1,  label: 'Ultra Safe' },
  { value: 3,  label: 'Conservative' },
  { value: 5,  label: 'Balanced' },
  { value: 7,  label: 'Aggressive' },
  { value: 10, label: 'Max Risk' },
]

function RiskAppetiteCard() {
  const { data: serverAppetite = 5 } = useRiskAppetite()
  const updateAppetite = useUpdateRiskAppetite()

  const [localLevel, setLocalLevel] = React.useState<number>(serverAppetite)
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Sync local state when server value loads/changes
  React.useEffect(() => {
    setLocalLevel(serverAppetite)
  }, [serverAppetite])

  const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const val = Number(e.target.value)
    setLocalLevel(val)

    if (debounceRef.current) clearTimeout(debounceRef.current)
    debounceRef.current = setTimeout(() => {
      updateAppetite.mutate(val, {
        onSuccess: () => toast.success(`Risk appetite updated to ${val}/10`),
        onError: () => toast.error('Failed to update risk appetite'),
      })
    }, 500)
  }, [updateAppetite])

  const badgeClass = getRiskAppetiteBadgeClass(localLevel)
  const trackStyle = { background: getRiskAppetiteTrackGradient(localLevel) }

  return (
    <div className="bg-surface rounded-lg border border-border p-6 mb-4">
      <div className="flex items-start justify-between gap-4 mb-5">
        <div className="flex items-start gap-3">
          <div className="mt-0.5 p-2 rounded-md bg-surface-2">
            <Gauge className="w-5 h-5 text-slate-300" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <p className="font-semibold text-sm text-slate-200">Risk Appetite</p>
              <span className={cn('text-xs font-medium px-2 py-0.5 rounded border font-numeric', badgeClass)}>
                {localLevel}/10
              </span>
            </div>
            <p className="text-xs text-muted-foreground mt-0.5">
              How aggressively the system seeks and sizes trades
            </p>
          </div>
        </div>
      </div>

      {/* Slider */}
      <div className="px-1">
        <input
          type="range"
          min={1}
          max={10}
          step={1}
          value={localLevel}
          onChange={handleChange}
          disabled={updateAppetite.isPending}
          className="w-full h-2 rounded-full appearance-none cursor-pointer disabled:cursor-not-allowed disabled:opacity-60"
          style={trackStyle}
        />

        {/* Tick labels */}
        <div className="flex justify-between mt-2">
          {APPETITE_TICK_LABELS.map(({ value, label }) => (
            <button
              key={value}
              type="button"
              onClick={() => {
                setLocalLevel(value)
                if (debounceRef.current) clearTimeout(debounceRef.current)
                debounceRef.current = setTimeout(() => {
                  updateAppetite.mutate(value, {
                    onSuccess: () => toast.success(`Risk appetite updated to ${value}/10`),
                    onError: () => toast.error('Failed to update risk appetite'),
                  })
                }, 500)
              }}
              className={cn(
                'text-xs transition-colors',
                localLevel === value ? 'text-slate-200 font-medium' : 'text-muted-foreground hover:text-slate-300',
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Description */}
      <div className="mt-4 px-3 py-2.5 rounded-md bg-surface-2 border border-border">
        <p className="text-xs text-slate-300 leading-relaxed">
          {getRiskAppetiteLabel(localLevel)}
        </p>
      </div>
    </div>
  )
}

// ─── AI risk auto-tuner panel ─────────────────────────────────────────────────

function AiRiskAutoTuner({ onAutoTuneChange }: { onAutoTuneChange?: (enabled: boolean) => void }) {
  const { data: autoTuneStatus } = useAutoTuneStatus()
  const { data: bankroll } = useBankroll()
  const autoTune = useAutoTuneRisk()
  const disable = useDisableAutoTune()

  const isEnabled = autoTuneStatus?.enabled ?? false
  const balance = Number(bankroll?.total_balance ?? 0)
  const tier = balance < 100 ? 'Aggressive' : balance < 1000 ? 'Moderate' : 'Conservative'
  const tierColor = balance < 100 ? 'text-warning' : balance < 1000 ? 'text-info' : 'text-profit'

  const handleToggle = () => {
    if (isEnabled) {
      disable.mutate(undefined, {
        onSuccess: () => {
          toast.success('AI auto-tune disabled — risk config is now manual')
          onAutoTuneChange?.(false)
        },
        onError: () => toast.error('Failed to disable AI auto-tune'),
      })
    } else {
      autoTune.mutate(undefined, {
        onSuccess: (data) => {
          toast.success(data.message)
          onAutoTuneChange?.(true)
        },
        onError: () => toast.error('Failed to auto-tune risk config'),
      })
    }
  }

  const isPending = autoTune.isPending || disable.isPending
  const lastBalance = autoTuneStatus?.lastTunedBalance != null ? Number(autoTuneStatus.lastTunedBalance) : null
  const balanceDriftSignificant =
    isEnabled && lastBalance != null && lastBalance > 0 &&
    Math.abs(balance - lastBalance) / lastBalance > 0.1

  return (
    <div
      className={cn(
        'rounded-lg border p-4 mb-5',
        isEnabled ? 'bg-info/5 border-info/30' : 'bg-surface border-border',
      )}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 p-2 rounded-md', isEnabled ? 'bg-info/20' : 'bg-surface-2')}>
            <Brain className={cn('w-5 h-5', isEnabled ? 'text-info' : 'text-muted-foreground')} />
          </div>
          <div>
            <p className={cn('font-semibold text-sm', isEnabled ? 'text-info' : 'text-slate-200')}>
              AI Risk Auto-Tuner — {isEnabled ? 'Active' : 'Disabled'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isEnabled
                ? 'Risk parameters are automatically configured based on your balance. Manual changes will be overwritten on next tune.'
                : 'Let AI set optimal risk limits based on your account balance. Adjusts dynamically as balance changes.'}
            </p>
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={isPending}
          className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-colors shrink-0 border',
            isEnabled
              ? 'bg-surface-2 text-slate-300 hover:bg-surface border-border'
              : 'bg-info/20 text-info hover:bg-info/30 border-info/30',
          )}
        >
          {isPending ? 'Applying…' : isEnabled ? 'Disable' : 'Enable AI Tuning'}
        </button>
      </div>

      {balance > 0 && (
        <div className="mt-3 flex items-center gap-4 text-xs">
          <span className="text-muted-foreground">
            Balance:{' '}
            <span className="font-numeric text-slate-300">
              ${balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
            </span>
          </span>
          <span className="text-muted-foreground">
            Risk tier: <span className={cn('font-medium', tierColor)}>{tier}</span>
          </span>
          {isEnabled && lastBalance != null && (
            <span className="text-muted-foreground">
              Last tuned at:{' '}
              <span className="font-numeric text-slate-300">
                ${lastBalance.toLocaleString('en-US', { minimumFractionDigits: 2 })}
              </span>
            </span>
          )}
        </div>
      )}

      {balanceDriftSignificant && (
        <div className="mt-3 flex items-center gap-2 bg-warning/10 border border-warning/20 rounded-md px-3 py-2">
          <AlertTriangle className="w-4 h-4 text-warning shrink-0" />
          <span className="text-xs text-warning">Balance changed significantly since last tune.</span>
          <button
            onClick={() =>
              autoTune.mutate(undefined, {
                onSuccess: (d) => toast.success(d.message),
                onError: () => toast.error('Failed to re-tune risk config'),
              })
            }
            disabled={autoTune.isPending}
            className="text-xs font-medium text-info hover:text-info/80 ml-auto shrink-0 disabled:opacity-50"
          >
            Re-tune now
          </button>
        </div>
      )}
    </div>
  )
}

function RiskConfigSection() {
  const { data: config, isLoading } = useRiskConfig()
  const update = useUpdateRiskConfig()

  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<RiskFormValues>()

  React.useEffect(() => {
    if (config) {
      const vals: RiskFormValues = {
        max_daily_loss: config.max_daily_loss,
        max_position_size: config.max_position_size,
        max_total_exposure: config.max_total_exposure,
        max_single_trade: config.max_single_trade,
        max_consecutive_losses: config.max_consecutive_losses,
        cooldown_after_loss_streak_minutes: config.cooldown_after_loss_streak_minutes,
        min_liquidity: config.min_liquidity,
        max_spread: config.max_spread,
        max_latency_ms: config.max_latency_ms,
        max_data_age_seconds: config.max_data_age_seconds,
      }
      reset(vals)
    }
  }, [config, reset])

  const onSubmit = (values: RiskFormValues) => {
    update.mutate(values as Partial<RiskConfig>, {
      onSuccess: () => toast.success('Risk config saved'),
      onError: () => toast.error('Failed to save risk config'),
    })
  }

  if (isLoading) return <LoadingPage />

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {RISK_FIELDS.map((field) => (
          <RiskField
            key={field.key}
            field={field}
            reg={register(field.key, { valueAsNumber: true })}
          />
        ))}
      </div>
      <div className="flex justify-end pt-2">
        <button
          type="submit"
          disabled={!isDirty || update.isPending}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            isDirty
              ? 'bg-info text-white hover:bg-info/90'
              : 'bg-surface-2 text-muted-foreground cursor-not-allowed',
          )}
        >
          <Save className="w-4 h-4" />
          {update.isPending ? 'Saving…' : 'Save Risk Config'}
        </button>
      </div>
    </form>
  )
}

// ─── sandbox section ──────────────────────────────────────────────────────────

function SandboxSection() {
  const { data: sandbox, isLoading } = useSandboxStatus()
  const { data: analytics } = useSandboxAnalytics()
  const startSandbox = useStartSandbox()
  const resetSandbox = useResetSandbox()
  const stopSandbox = useStopSandbox()
  const [balance, setBalance] = useState('1000')
  const [showAnalytics, setShowAnalytics] = useState(false)

  const isActive = sandbox?.active ?? false

  const handleStart = () => {
    const bal = parseFloat(balance)
    if (isNaN(bal) || bal <= 0) { toast.error('Enter a valid balance'); return }
    startSandbox.mutate(bal, {
      onSuccess: () => toast.success(`Sandbox started with $${bal.toLocaleString()} virtual balance`),
      onError: () => toast.error('Failed to start sandbox'),
    })
  }

  const handleReset = () => {
    const bal = parseFloat(balance)
    resetSandbox.mutate(bal > 0 ? bal : undefined, {
      onSuccess: () => toast.success('Sandbox data reset'),
      onError: () => toast.error('Failed to reset sandbox'),
    })
  }

  const handleStop = () => {
    stopSandbox.mutate(undefined, {
      onSuccess: () => toast.success('Sandbox mode deactivated'),
    })
  }

  if (isLoading) return null

  return (
    <div className={cn(
      'rounded-lg border p-5',
      isActive ? 'bg-warning/5 border-warning/30' : 'bg-surface border-border'
    )}>
      <div className="flex items-start justify-between gap-4 mb-4">
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 p-2 rounded-md', isActive ? 'bg-warning/20' : 'bg-surface-2')}>
            <FlaskConical className={cn('w-5 h-5', isActive ? 'text-warning' : 'text-muted-foreground')} />
          </div>
          <div>
            <p className={cn('font-semibold text-sm', isActive ? 'text-warning' : 'text-slate-200')}>
              Sandbox Mode — {isActive ? 'Active' : 'Inactive'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {isActive
                ? 'AI uses real tokens to make decisions. Orders are simulated — no real money is spent.'
                : 'Test the trading system with virtual money. Real AI analysis, simulated execution.'}
            </p>
          </div>
        </div>
      </div>

      {!isActive ? (
        <div className="space-y-3">
          <div className="flex items-center gap-3">
            <label className="text-sm text-slate-300">Starting Balance:</label>
            <div className="flex items-center gap-1">
              <span className="text-sm text-muted-foreground">$</span>
              <input
                type="number"
                min={10}
                step={100}
                value={balance}
                onChange={e => setBalance(e.target.value)}
                className="w-32 bg-surface-2 border border-border rounded px-3 py-1.5 text-sm font-numeric text-slate-200 focus:outline-none focus:border-info"
              />
            </div>
            <button
              onClick={handleStart}
              disabled={startSandbox.isPending}
              className="px-4 py-1.5 rounded-md text-sm font-medium bg-warning/20 text-warning hover:bg-warning/30 border border-warning/30 transition-colors disabled:opacity-50"
            >
              {startSandbox.isPending ? 'Starting…' : 'Start Sandbox'}
            </button>
          </div>
          <p className="text-xs text-muted-foreground">
            Sandbox uses real AI (costs tokens) but simulates all trades. Perfect for testing strategies.
          </p>
        </div>
      ) : sandbox ? (
        <div className="space-y-4">
          {/* Live stats */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="bg-surface-2 rounded px-3 py-2">
              <p className="text-xs text-muted-foreground">Starting</p>
              <p className="font-numeric text-slate-200">${sandbox.starting_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-surface-2 rounded px-3 py-2">
              <p className="text-xs text-muted-foreground">Current</p>
              <p className="font-numeric text-slate-200">${sandbox.current_balance.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            </div>
            <div className="bg-surface-2 rounded px-3 py-2">
              <p className="text-xs text-muted-foreground">P&L</p>
              <p className={cn('font-numeric', sandbox.total_pnl >= 0 ? 'text-profit' : 'text-loss')}>
                {sandbox.total_pnl >= 0 ? '+' : ''}${sandbox.total_pnl.toFixed(2)} ({sandbox.pnl_percent.toFixed(1)}%)
              </p>
            </div>
            <div className="bg-surface-2 rounded px-3 py-2">
              <p className="text-xs text-muted-foreground">Deployed</p>
              <p className="font-numeric text-slate-200">${sandbox.deployed.toLocaleString('en-US', { minimumFractionDigits: 2 })}</p>
            </div>
          </div>

          {/* Detailed analytics toggle */}
          {analytics && (
            <>
              <button
                onClick={() => setShowAnalytics(v => !v)}
                className="text-xs text-info hover:text-info/80 transition-colors"
              >
                {showAnalytics ? 'Hide detailed analytics' : 'Show detailed analytics'}
              </button>

              {showAnalytics && (
                <div className="space-y-4 pt-2 border-t border-border">
                  {/* Performance grid */}
                  <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {[
                      { label: 'Win Rate', value: `${analytics.win_rate.toFixed(1)}%` },
                      { label: 'Profit Factor', value: analytics.profit_factor.toFixed(2) },
                      { label: 'Total Trades', value: String(analytics.closed_positions) },
                      { label: 'Open Positions', value: String(analytics.open_positions) },
                      { label: 'Avg Win', value: `$${analytics.avg_win.toFixed(2)}`, cls: 'text-profit' },
                      { label: 'Avg Loss', value: `$${analytics.avg_loss.toFixed(2)}`, cls: 'text-loss' },
                      { label: 'Best Trade', value: `$${analytics.best_trade.toFixed(2)}`, cls: 'text-profit' },
                      { label: 'Worst Trade', value: `$${analytics.worst_trade.toFixed(2)}`, cls: 'text-loss' },
                      { label: 'Max Drawdown', value: `${analytics.max_drawdown_percent.toFixed(1)}%`, cls: 'text-loss' },
                      { label: 'Total Fees', value: `$${analytics.total_fees.toFixed(4)}` },
                      { label: 'AI Tokens Used', value: analytics.total_ai_tokens.toLocaleString() },
                      { label: 'Avg Hold Time', value: `${analytics.avg_hold_time_hours.toFixed(1)}h` },
                      { label: 'AI Decisions', value: String(analytics.total_decisions) },
                      { label: 'Fill Rate', value: `${analytics.fill_rate.toFixed(0)}%` },
                      { label: 'Duration', value: `${analytics.sandbox_duration_hours.toFixed(1)}h` },
                    ].map(({ label, value, cls }) => (
                      <div key={label} className="bg-surface-2 rounded px-3 py-2">
                        <p className="text-xs text-muted-foreground mb-0.5">{label}</p>
                        <p className={cn('font-numeric text-sm', cls ?? 'text-slate-200')}>{value}</p>
                      </div>
                    ))}
                  </div>

                  {/* Category breakdown */}
                  {Object.keys(analytics.by_category).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">By Category</p>
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                        {Object.entries(analytics.by_category).map(([cat, stats]) => (
                          <div key={cat} className="bg-surface-2 rounded px-3 py-2">
                            <p className="text-xs font-medium text-slate-300 capitalize">{cat}</p>
                            <p className="text-xs text-muted-foreground">
                              {stats.trades} trades · {stats.wins}W ·{' '}
                              <span className={cn('font-numeric', stats.pnl >= 0 ? 'text-profit' : 'text-loss')}>
                                ${stats.pnl.toFixed(2)}
                              </span>
                            </p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Close reason breakdown */}
                  {Object.keys(analytics.by_close_reason).length > 0 && (
                    <div>
                      <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-2">Exit Reasons</p>
                      <div className="flex gap-2 flex-wrap">
                        {Object.entries(analytics.by_close_reason).map(([reason, count]) => (
                          <Badge key={reason} variant="outline">
                            {reason.replace(/_/g, ' ')}: {count}
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              )}
            </>
          )}

          {/* Action buttons */}
          <div className="flex gap-2 pt-2 flex-wrap items-center">
            <div className="flex items-center gap-2">
              <span className="text-xs text-muted-foreground">New balance:</span>
              <input
                type="number" min={10} step={100} value={balance}
                onChange={e => setBalance(e.target.value)}
                className="w-28 bg-surface-2 border border-border rounded px-2 py-1 text-xs font-numeric text-slate-200 focus:outline-none focus:border-info"
              />
            </div>
            <button
              onClick={handleReset}
              disabled={resetSandbox.isPending}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 text-slate-400 hover:text-warning hover:bg-warning/10 border border-border hover:border-warning/30 transition-colors disabled:opacity-50"
            >
              {resetSandbox.isPending ? 'Resetting…' : 'Reset & Restart'}
            </button>
            <button
              onClick={handleStop}
              disabled={stopSandbox.isPending}
              className="px-3 py-1.5 rounded-md text-xs font-medium bg-surface-2 text-slate-400 hover:text-slate-200 border border-border transition-colors disabled:opacity-50"
            >
              Stop Sandbox
            </button>
          </div>
        </div>
      ) : null}
    </div>
  )
}

// ─── kill switch section ───────────────────────────────────────────────────────

function KillSwitchSection() {
  const [confirming, setConfirming] = React.useState(false)
  const { killSwitchEnabled, toggleKillSwitch } = useAppStore()
  const toggleMutation = useToggleKillSwitch()

  const handleToggle = () => {
    if (!killSwitchEnabled) {
      setConfirming(true)
    } else {
      toggleMutation.mutate(false, {
        onSuccess: () => { toggleKillSwitch(); toast.success('Kill switch disabled') },
        onError: () => toast.error('Failed to update kill switch'),
      })
    }
  }

  const handleConfirm = () => {
    toggleMutation.mutate(true, {
      onSuccess: () => { toggleKillSwitch(); setConfirming(false); toast.warning('Kill switch ENABLED — trading halted') },
      onError: () => { setConfirming(false); toast.error('Failed to update kill switch') },
    })
  }

  return (
    <div className="space-y-4">
      <div
        className={cn(
          'rounded-lg border p-5 flex items-center justify-between gap-4',
          killSwitchEnabled ? 'bg-loss/10 border-loss/30' : 'bg-surface border-border',
        )}
      >
        <div className="flex items-start gap-3">
          <div className={cn('mt-0.5 p-2 rounded-md', killSwitchEnabled ? 'bg-loss/20' : 'bg-surface-2')}>
            <Power className={cn('w-5 h-5', killSwitchEnabled ? 'text-loss' : 'text-muted-foreground')} />
          </div>
          <div>
            <p className={cn('font-semibold text-sm', killSwitchEnabled ? 'text-loss' : 'text-slate-200')}>
              Kill Switch — {killSwitchEnabled ? 'ENABLED' : 'Disabled'}
            </p>
            <p className="text-xs text-muted-foreground mt-0.5">
              {killSwitchEnabled
                ? 'All trading is halted. No new orders will be placed.'
                : 'Trading is active. Toggle to halt all new order placement immediately.'}
            </p>
          </div>
        </div>
        <button
          onClick={handleToggle}
          disabled={toggleMutation.isPending}
          className={cn(
            'px-4 py-2 rounded-md text-sm font-medium transition-colors shrink-0',
            killSwitchEnabled
              ? 'bg-surface-2 text-slate-300 hover:bg-surface border border-border'
              : 'bg-loss/20 text-loss hover:bg-loss/30 border border-loss/30',
          )}
        >
          {killSwitchEnabled ? 'Disable Kill Switch' : 'Enable Kill Switch'}
        </button>
      </div>

      {confirming && (
        <div className="rounded-lg border border-warning/30 bg-warning/10 p-4">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-5 h-5 text-warning mt-0.5 shrink-0" />
            <div className="flex-1">
              <p className="text-sm font-semibold text-warning">Confirm Kill Switch Activation</p>
              <p className="text-xs text-muted-foreground mt-1">
                This will immediately halt all trading. No new orders will be placed until you disable it.
                Are you sure?
              </p>
              <div className="flex gap-2 mt-3">
                <button
                  onClick={handleConfirm}
                  disabled={toggleMutation.isPending}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-loss text-white rounded-md text-xs font-medium hover:bg-loss/90 transition-colors"
                >
                  <Check className="w-3.5 h-3.5" />
                  Yes, halt trading
                </button>
                <button
                  onClick={() => setConfirming(false)}
                  className="flex items-center gap-1.5 px-3 py-1.5 bg-surface-2 text-slate-300 rounded-md text-xs font-medium hover:bg-slate-700 transition-colors"
                >
                  <X className="w-3.5 h-3.5" />
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// ─── system config inline editor ─────────────────────────────────────────────

function SystemConfigRow({ entry }: { entry: { key: string; value: unknown; updated_at: string } }) {
  const [editing, setEditing] = React.useState(false)
  const [draft, setDraft] = React.useState(JSON.stringify(entry.value))
  const setConfig = useSetSystemConfig()

  const handleSave = () => {
    let parsed: unknown
    try { parsed = JSON.parse(draft) } catch { parsed = draft }
    setConfig.mutate({ key: entry.key, value: parsed }, {
      onSuccess: () => { setEditing(false); toast.success(`Saved ${entry.key}`) },
      onError: () => toast.error(`Failed to save ${entry.key}`),
    })
  }

  const handleCancel = () => {
    setDraft(JSON.stringify(entry.value))
    setEditing(false)
  }

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-2/50">
      <td className="px-3 py-3 text-sm font-mono text-info align-top">{entry.key}</td>
      <td className="px-3 py-3 min-w-0">
        {editing ? (
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="w-full bg-surface-2 border border-info rounded px-2 py-1 text-sm font-mono text-slate-200 focus:outline-none"
            autoFocus
          />
        ) : (
          <span className="font-mono text-sm text-slate-300 break-all">
            {typeof entry.value === 'object' ? JSON.stringify(entry.value) : String(entry.value)}
          </span>
        )}
      </td>
      <td className="px-3 py-3 text-xs text-muted-foreground whitespace-nowrap align-top">
        {new Date(entry.updated_at).toLocaleDateString()}
      </td>
      <td className="px-3 py-3 align-top">
        {editing ? (
          <div className="flex gap-1">
            <button onClick={handleSave} disabled={setConfig.isPending} className="p-1 text-profit hover:text-profit/80 disabled:opacity-50">
              <Check className="w-4 h-4" />
            </button>
            <button onClick={handleCancel} className="p-1 text-muted-foreground hover:text-slate-300">
              <X className="w-4 h-4" />
            </button>
          </div>
        ) : (
          <button onClick={() => setEditing(true)} className="p-1 text-muted-foreground hover:text-slate-300">
            <Edit2 className="w-4 h-4" />
          </button>
        )}
      </td>
    </tr>
  )
}

function SystemConfigSection() {
  const { data: configs, isLoading } = useSystemConfigs()

  if (isLoading) return <LoadingPage />
  if (!configs || configs.length === 0) {
    return <p className="text-sm text-muted-foreground py-4">No system config keys found.</p>
  }

  return (
    <div className="overflow-x-auto rounded-lg border border-border">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-border bg-surface-2">
            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Key</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Value</th>
            <th className="px-3 py-2.5 text-left text-xs font-medium text-muted-foreground uppercase tracking-wide">Updated</th>
            <th className="px-3 py-2.5 w-16" />
          </tr>
        </thead>
        <tbody>
          {configs.map((entry) => (
            <SystemConfigRow key={entry.key} entry={entry as { key: string; value: unknown; updated_at: string }} />
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ─── api keys & credentials ───────────────────────────────────────────────────

type CredFormValues = {
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

function PasswordField({
  label,
  description,
  registration,
}: {
  label: string
  description?: string
  registration: ReturnType<ReturnType<typeof useForm<CredFormValues>>['register']>
}) {
  const [visible, setVisible] = React.useState(false)
  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium text-slate-200">{label}</label>
      {description && <p className="text-xs text-muted-foreground">{description}</p>}
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <input
            type={visible ? 'text' : 'password'}
            autoComplete="off"
            className="w-full bg-surface-2 border border-border rounded px-3 py-2 text-sm font-mono text-slate-200 focus:outline-none focus:border-info pr-10 placeholder:text-muted-foreground/50"
            placeholder="Paste or type value…"
            {...registration}
          />
          <button
            type="button"
            onClick={() => setVisible((v) => !v)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-slate-300 transition-colors"
            tabIndex={-1}
          >
            {visible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </div>
      </div>
    </div>
  )
}

function ApiKeysSection() {
  const { data: creds, isLoading } = useCredentials()
  const save = useSaveCredentials()

  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<CredFormValues>({
    defaultValues: {
      polymarket_api_key: '',
      polymarket_secret: '',
      polymarket_passphrase: '',
      polymarket_wallet: '',
      polymarket_private_key: '',
      anthropic_api_key: '',
      openrouter_api_key: '',
      news_api_key: '',
      odds_api_key: '',
      polygon_rpc_url: '',
    },
  })

  React.useEffect(() => {
    if (creds) {
      reset({
        polymarket_api_key: creds.polymarket_api_key ?? '',
        polymarket_secret: creds.polymarket_secret ?? '',
        polymarket_passphrase: creds.polymarket_passphrase ?? '',
        polymarket_wallet: creds.polymarket_wallet ?? '',
        polymarket_private_key: creds.polymarket_private_key ?? '',
        anthropic_api_key: creds.anthropic_api_key ?? '',
        openrouter_api_key: creds.openrouter_api_key ?? '',
        news_api_key: creds.news_api_key ?? '',
        odds_api_key: creds.odds_api_key ?? '',
        polygon_rpc_url: creds.polygon_rpc_url ?? '',
      })
    }
  }, [creds, reset])

  const onSubmit = (values: CredFormValues) => {
    const payload: CredentialsSavePayload = {}
    if (values.polymarket_api_key)    payload.polymarket_api_key    = values.polymarket_api_key
    if (values.polymarket_secret)     payload.polymarket_secret     = values.polymarket_secret
    if (values.polymarket_passphrase) payload.polymarket_passphrase = values.polymarket_passphrase
    if (values.polymarket_wallet)     payload.polymarket_wallet     = values.polymarket_wallet
    if (values.polymarket_private_key) payload.polymarket_private_key = values.polymarket_private_key
    if (values.anthropic_api_key)     payload.anthropic_api_key     = values.anthropic_api_key
    if (values.openrouter_api_key)    payload.openrouter_api_key    = values.openrouter_api_key
    if (values.news_api_key)          payload.news_api_key          = values.news_api_key
    if (values.odds_api_key)          payload.odds_api_key          = values.odds_api_key
    if (values.polygon_rpc_url)       payload.polygon_rpc_url       = values.polygon_rpc_url

    save.mutate(payload, {
      onSuccess: () => toast.success('API keys saved'),
      onError: () => toast.error('Failed to save API keys'),
    })
  }

  if (isLoading) return <LoadingPage />

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div className="flex items-center gap-2 pb-1">
        <div className="p-1.5 rounded-md bg-info/10">
          <Key className="w-4 h-4 text-info" />
        </div>
        <span className="text-xs text-muted-foreground">Polymarket Exchange</span>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PasswordField
          label="API Key"
          description="Your Polymarket CLOB API key"
          registration={register('polymarket_api_key')}
        />
        <PasswordField
          label="Secret"
          description="Private key / secret for signing"
          registration={register('polymarket_secret')}
        />
        <PasswordField
          label="Passphrase"
          description="Passphrase associated with the API key"
          registration={register('polymarket_passphrase')}
        />
        <PasswordField
          label="Wallet Address"
          description="Your Polymarket proxy wallet address (0x...)"
          registration={register('polymarket_wallet')}
        />
        <PasswordField
          label="Wallet Private Key"
          description="Private key for L2 signing (never shared)"
          registration={register('polymarket_private_key')}
        />
      </div>

      <div className="border-t border-border pt-5">
        <div className="flex items-center gap-2 pb-3">
          <div className="p-1.5 rounded-md bg-info/10">
            <Radio className="w-4 h-4 text-info" />
          </div>
          <span className="text-xs text-muted-foreground">Data Feeds</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PasswordField
          label="NewsAPI Key"
          description="newsapi.org — financial news for AI context"
          registration={register('news_api_key')}
        />
        <PasswordField
          label="Odds API Key"
          description="the-odds-api.com — sports betting odds data"
          registration={register('odds_api_key')}
        />
      </div>

      <div className="border-t border-border pt-5">
        <div className="flex items-center gap-2 pb-1">
          <div className="p-1.5 rounded-md bg-info/10">
            <Lock className="w-4 h-4 text-info" />
          </div>
          <span className="text-xs text-muted-foreground">AI Providers</span>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <PasswordField
          label="Anthropic API Key"
          description="Used when provider is set to Anthropic"
          registration={register('anthropic_api_key')}
        />
        <PasswordField
          label="OpenRouter API Key"
          description="Used when provider is set to OpenRouter"
          registration={register('openrouter_api_key')}
        />
      </div>

      <div className="border-t border-border pt-5">
        <div className="flex items-center gap-2 pb-3">
          <div className="p-1.5 rounded-md bg-info/10">
            <Globe className="w-4 h-4 text-info" />
          </div>
          <span className="text-xs text-muted-foreground">Blockchain</span>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4">
        <PasswordField
          label="Polygon RPC URL"
          description="RPC endpoint for Polygon network (default: https://1rpc.io/matic)"
          registration={register('polygon_rpc_url')}
        />
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={!isDirty || save.isPending}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            isDirty
              ? 'bg-info text-white hover:bg-info/90'
              : 'bg-surface-2 text-muted-foreground cursor-not-allowed',
          )}
        >
          <Save className="w-4 h-4" />
          {save.isPending ? 'Saving…' : 'Save Credentials'}
        </button>
      </div>
    </form>
  )
}

// ─── ai model configuration ───────────────────────────────────────────────────

const ANTHROPIC_MODELS = [
  { value: 'claude-opus-4-6',              label: 'Claude Opus 4.6' },
  { value: 'claude-sonnet-4-6',            label: 'Claude Sonnet 4.6' },
  { value: 'claude-haiku-4-5-20251001',    label: 'Claude Haiku 4.5' },
] as const

const OPENROUTER_MODELS = [
  { value: 'anthropic/claude-sonnet-4',         label: 'Claude Sonnet 4 (via OR)' },
  { value: 'anthropic/claude-haiku-4',          label: 'Claude Haiku 4 (via OR)' },
  { value: 'google/gemini-2.5-pro-preview',     label: 'Gemini 2.5 Pro Preview' },
  { value: 'google/gemini-2.5-flash-preview',   label: 'Gemini 2.5 Flash Preview' },
  { value: 'openai/gpt-4.1',                    label: 'GPT-4.1' },
  { value: 'openai/gpt-4.1-mini',               label: 'GPT-4.1 Mini' },
  { value: 'openai/o3',                         label: 'o3' },
  { value: 'openai/o4-mini',                    label: 'o4-mini' },
  { value: 'meta-llama/llama-4-maverick',       label: 'Llama 4 Maverick' },
  { value: 'deepseek/deepseek-r1',              label: 'DeepSeek R1' },
  { value: 'deepseek/deepseek-chat-v3-0324',    label: 'DeepSeek Chat V3' },
  { value: 'x-ai/grok-3-beta',                  label: 'Grok 3 Beta' },
] as const

type AiProvider = 'anthropic' | 'openrouter'

type AiFormValues = {
  provider: AiProvider
  model: string
  temperature: number
  max_tokens: number
}

const DEFAULT_AI_CONFIG: AiFormValues = {
  provider: 'anthropic',
  model: 'claude-sonnet-4-6',
  temperature: 0.7,
  max_tokens: 4096,
}

function AiConfigSection() {
  const { data: aiConfig, isLoading } = useAiConfig()
  const save = useSaveAiConfig()

  const { register, handleSubmit, watch, reset, control, setValue, formState: { isDirty } } =
    useForm<AiFormValues>({ defaultValues: DEFAULT_AI_CONFIG })

  const provider = watch('provider')
  const temperature = watch('temperature')

  React.useEffect(() => {
    if (aiConfig) {
      reset({
        provider: aiConfig.provider ?? 'anthropic',
        model: aiConfig.model ?? DEFAULT_AI_CONFIG.model,
        temperature: aiConfig.temperature ?? DEFAULT_AI_CONFIG.temperature,
        max_tokens: aiConfig.max_tokens ?? DEFAULT_AI_CONFIG.max_tokens,
      })
    }
  }, [aiConfig, reset])

  const prevProvider = React.useRef<AiProvider>(provider)
  React.useEffect(() => {
    if (prevProvider.current !== provider) {
      prevProvider.current = provider
      const first = provider === 'anthropic' ? ANTHROPIC_MODELS[0].value : OPENROUTER_MODELS[0].value
      setValue('model', first, { shouldDirty: true })
    }
  }, [provider, setValue])

  const modelOptions = provider === 'anthropic' ? ANTHROPIC_MODELS : OPENROUTER_MODELS

  const onSubmit = (values: AiFormValues) => {
    const payload: AiConfigSavePayload = {
      provider: values.provider,
      model: values.model,
      temperature: Number(values.temperature),
      max_tokens: Number(values.max_tokens),
    }
    save.mutate(payload, {
      onSuccess: () => toast.success('AI config saved'),
      onError: () => toast.error('Failed to save AI config'),
    })
  }

  if (isLoading) return <LoadingPage />

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-6">
      {/* Provider */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-200">AI Provider</label>
        <p className="text-xs text-muted-foreground">Choose between Anthropic direct or OpenRouter gateway</p>
        <div className="flex gap-3 mt-2">
          {(['anthropic', 'openrouter'] as const).map((p) => (
            <Controller
              key={p}
              name="provider"
              control={control}
              render={({ field }) => (
                <button
                  type="button"
                  onClick={() => field.onChange(p)}
                  className={cn(
                    'flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium transition-colors',
                    field.value === p
                      ? 'bg-info/15 border-info text-info'
                      : 'bg-surface-2 border-border text-muted-foreground hover:text-slate-300 hover:border-slate-600',
                  )}
                >
                  {p === 'anthropic' ? <Brain className="w-4 h-4" /> : <Cpu className="w-4 h-4" />}
                  {p === 'anthropic' ? 'Anthropic (Claude)' : 'OpenRouter'}
                </button>
              )}
            />
          ))}
        </div>
      </div>

      {/* Model */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-200">Model</label>
        <p className="text-xs text-muted-foreground">
          {provider === 'anthropic'
            ? 'Select a Claude model served directly by Anthropic'
            : 'Select a model available via OpenRouter'}
        </p>
        <select
          {...register('model')}
          className="w-full bg-surface-2 border border-border rounded px-3 py-2 text-sm text-slate-200 focus:outline-none focus:border-info"
        >
          {modelOptions.map((m) => (
            <option key={m.value} value={m.value}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      {/* Temperature */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <div>
            <label className="text-sm font-medium text-slate-200">Temperature</label>
            <p className="text-xs text-muted-foreground">Controls randomness — lower = more deterministic</p>
          </div>
          <span className="text-sm font-numeric text-info min-w-[36px] text-right">
            {Number(temperature).toFixed(1)}
          </span>
        </div>
        <input
          type="range"
          min={0}
          max={1}
          step={0.1}
          className="w-full accent-info"
          {...register('temperature', { valueAsNumber: true })}
        />
        <div className="flex justify-between text-xs text-muted-foreground">
          <span>0.0 — Deterministic</span>
          <span>1.0 — Creative</span>
        </div>
      </div>

      {/* Max tokens */}
      <div className="space-y-1.5">
        <label className="text-sm font-medium text-slate-200">Max Tokens</label>
        <p className="text-xs text-muted-foreground">Maximum tokens in the AI response</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={256}
            max={128000}
            step={256}
            className="w-40 bg-surface-2 border border-border rounded px-3 py-2 text-sm font-numeric text-slate-200 focus:outline-none focus:border-info"
            {...register('max_tokens', { valueAsNumber: true })}
          />
          <span className="text-xs text-muted-foreground">tokens</span>
        </div>
      </div>

      <div className="flex justify-end pt-1">
        <button
          type="submit"
          disabled={!isDirty || save.isPending}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-md text-sm font-medium transition-colors',
            isDirty
              ? 'bg-info text-white hover:bg-info/90'
              : 'bg-surface-2 text-muted-foreground cursor-not-allowed',
          )}
        >
          <Save className="w-4 h-4" />
          {save.isPending ? 'Saving…' : 'Save AI Config'}
        </button>
      </div>
    </form>
  )
}

// ─── engine configuration ─────────────────────────────────────────────────────

function EngineConfigSection() {
  const { data: configs } = useSystemConfigs()
  const setConfig = useSetSystemConfig()

  const executionMode = configs?.find((c) => c.key === 'EXECUTION_MODE')?.value ?? 'mock'
  const aiTokenBudget = configs?.find((c) => c.key === 'AI_DAILY_TOKEN_BUDGET')?.value ?? 100000

  return (
    <div className="space-y-4">
      {/* Execution Mode — CRITICAL safety toggle */}
      <div className="rounded-lg border p-4 space-y-3">
        <div>
          <label className="text-sm font-medium text-slate-200">Execution Mode</label>
          <p className="text-xs text-muted-foreground">Controls whether orders are simulated or sent to Polymarket</p>
        </div>
        <div className="flex gap-3">
          {(['mock', 'live'] as const).map((mode) => (
            <button
              key={mode}
              onClick={() =>
                setConfig.mutate(
                  { key: 'EXECUTION_MODE', value: mode },
                  { onSuccess: () => toast.success(`Execution mode set to ${mode.toUpperCase()}`) },
                )
              }
              className={cn(
                'flex items-center gap-2 px-4 py-2 rounded-md border text-sm font-medium transition-colors',
                executionMode === mode
                  ? mode === 'live'
                    ? 'bg-loss/15 border-loss text-loss'
                    : 'bg-info/15 border-info text-info'
                  : 'bg-surface-2 border-border text-muted-foreground hover:text-slate-300',
              )}
            >
              {mode === 'mock' ? 'Mock (Simulated)' : 'Live (Real Funds)'}
            </button>
          ))}
        </div>
        {executionMode === 'live' && (
          <div className="flex items-center gap-2 bg-loss/10 border border-loss/20 rounded-md px-3 py-2 text-xs text-loss">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>LIVE MODE — Real orders will be placed on Polymarket with real funds.</span>
          </div>
        )}
      </div>

      {/* AI Daily Token Budget */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-slate-200">AI Daily Token Budget</label>
        <p className="text-xs text-muted-foreground">Maximum tokens the AI can use per day (controls API costs)</p>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1000}
            max={10000000}
            step={10000}
            defaultValue={Number(aiTokenBudget)}
            onBlur={(e) => {
              const val = parseInt(e.target.value)
              if (!isNaN(val) && val > 0) {
                setConfig.mutate(
                  { key: 'AI_DAILY_TOKEN_BUDGET', value: val },
                  { onSuccess: () => toast.success('Token budget updated') },
                )
              }
            }}
            className="w-40 bg-surface-2 border border-border rounded px-3 py-2 text-sm font-numeric text-slate-200 focus:outline-none focus:border-info"
          />
          <span className="text-xs text-muted-foreground">tokens/day</span>
        </div>
      </div>
    </div>
  )
}

// ─── btc bot health widget ────────────────────────────────────────────────────

function BtcBotHealthWidget() {
  const { data, isLoading } = useBtcBotStatus()

  if (isLoading) {
    return (
      <div className="space-y-2">
        <div className="h-4 w-32 bg-surface-2 rounded animate-pulse" />
        <div className="h-4 w-48 bg-surface-2 rounded animate-pulse" />
      </div>
    )
  }

  const active = data?.active ?? false
  const signals = data?.latest_signals ?? null
  const botStatus = data?.bot_status

  return (
    <div className="space-y-3">
      {/* Status row */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {active ? (
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-profit opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-profit" />
            </span>
          ) : (
            <span className="w-2 h-2 rounded-full bg-slate-600" />
          )}
          <span className={cn('text-sm font-medium', active ? 'text-profit' : 'text-muted-foreground')}>
            {active ? 'Running' : 'Stopped'}
          </span>
        </div>
        <Badge variant={active ? 'success' : 'danger'}>
          {active ? 'Active' : 'Stopped'}
        </Badge>
      </div>

      {/* Metrics */}
      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-surface-2 rounded px-2 py-1.5">
          <p className="text-muted-foreground mb-0.5">BTC Price</p>
          <p className="font-numeric text-slate-300">
            {signals ? `$${signals.current_price.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}` : '—'}
          </p>
        </div>
        <div className="bg-surface-2 rounded px-2 py-1.5">
          <p className="text-muted-foreground mb-0.5">Direction</p>
          <p className={cn(
            'font-numeric',
            signals && signals.direction_score > 0 ? 'text-profit' :
            signals && signals.direction_score < 0 ? 'text-loss' :
            'text-slate-300'
          )}>
            {signals ? `${signals.direction_score > 0 ? '+' : ''}${signals.direction_score.toFixed(1)}` : '—'}
          </p>
        </div>
        <div className="bg-surface-2 rounded px-2 py-1.5">
          <p className="text-muted-foreground mb-0.5">Windows</p>
          <p className="font-numeric text-slate-300">
            {botStatus ? botStatus.windowsTradedCount : '—'}
          </p>
        </div>
      </div>

      {/* Active market */}
      {botStatus?.activeMarket ? (
        <p className="text-xs text-muted-foreground truncate">
          Market: <span className="text-slate-300">{botStatus.activeMarket.title}</span>
        </p>
      ) : active ? (
        <p className="text-xs text-muted-foreground">Scanning for next 5-min window…</p>
      ) : null}
    </div>
  )
}

// ─── section wrapper ──────────────────────────────────────────────────────────

function Section({ title, badge, children }: { title: string; badge?: React.ReactNode; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg border border-border">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
        <h2 className="text-sm font-medium text-slate-200">{title}</h2>
        {badge}
      </div>
      <div className="p-4">{children}</div>
    </div>
  )
}

// ─── health tab helpers ───────────────────────────────────────────────────────

type StatusLevel = 'ok' | 'degraded' | 'error' | 'unknown'

function svcStatusLevel(s: ServiceStatus['status']): StatusLevel {
  if (s === 'running') return 'ok'
  if (s === 'errored') return 'error'
  return 'unknown'
}

function statusVariant(s: StatusLevel): 'success' | 'warning' | 'danger' | 'default' {
  if (s === 'ok') return 'success'
  if (s === 'degraded') return 'warning'
  if (s === 'error') return 'danger'
  return 'default'
}

function svcBadgeVariant(s: ServiceStatus['status']): 'success' | 'danger' | 'default' {
  if (s === 'running') return 'success'
  if (s === 'errored') return 'danger'
  return 'default'
}

function StatusDot({ status }: { status: StatusLevel }) {
  return (
    <span
      className={cn(
        'inline-block w-2 h-2 rounded-full shrink-0',
        status === 'ok' && 'bg-profit',
        status === 'degraded' && 'bg-warning animate-pulse',
        status === 'error' && 'bg-loss',
        status === 'unknown' && 'bg-slate-600',
      )}
    />
  )
}

function InfraCard({
  label,
  status,
  icon: Icon,
  latencyMs,
  sub,
}: {
  label: string
  status: StatusLevel
  icon: React.ComponentType<{ className?: string }>
  latencyMs?: number
  sub?: string
}) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4 flex items-start gap-3">
      <div
        className={cn(
          'w-9 h-9 rounded-md flex items-center justify-center shrink-0 mt-0.5',
          status === 'ok' && 'bg-profit/15',
          status === 'degraded' && 'bg-warning/15',
          status === 'error' && 'bg-loss/15',
          status === 'unknown' && 'bg-surface-2',
        )}
      >
        <Icon
          className={cn(
            'w-4 h-4',
            status === 'ok' && 'text-profit',
            status === 'degraded' && 'text-warning',
            status === 'error' && 'text-loss',
            status === 'unknown' && 'text-muted-foreground',
          )}
        />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between gap-2">
          <span className="text-sm font-medium text-slate-200">{label}</span>
          <Badge variant={statusVariant(status)}>
            {status === 'ok' ? 'Connected' : status === 'error' ? 'Error' : status === 'degraded' ? 'Degraded' : 'Unknown'}
          </Badge>
        </div>
        <div className="mt-1 flex items-center gap-3 text-xs text-muted-foreground">
          {latencyMs != null && (
            <span className="font-numeric text-slate-300">{latencyMs} ms</span>
          )}
          {sub && <span>{sub}</span>}
        </div>
      </div>
    </div>
  )
}

function ServiceCard({ svc }: { svc: ServiceStatus }) {
  const level = svcStatusLevel(svc.status)
  const dotColor = {
    running: 'bg-profit',
    stopped: 'bg-slate-600',
    errored: 'bg-loss animate-pulse',
    unknown: 'bg-slate-600',
  }[svc.status] ?? 'bg-slate-600'

  return (
    <div
      className={cn(
        'bg-surface rounded-lg border p-4 space-y-3 transition-colors',
        level === 'ok' && 'border-border',
        level === 'error' && 'border-loss/30',
        level === 'unknown' && 'border-border opacity-70',
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
          <span className="text-sm font-mono font-medium text-slate-200 truncate">{svc.name}</span>
        </div>
        <Badge variant={svcBadgeVariant(svc.status)}>
          {svc.status === 'running' ? 'Running' : svc.status === 'errored' ? 'Errored' : svc.status === 'stopped' ? 'Stopped' : 'Unknown'}
        </Badge>
      </div>

      <div className="grid grid-cols-3 gap-2 text-xs">
        <div className="bg-surface-2 rounded px-2 py-1.5">
          <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
            <Timer className="w-3 h-3" />
            <span>Uptime</span>
          </div>
          <span className="font-numeric text-slate-300">
            {svc.uptimeSeconds != null ? formatUptime(svc.uptimeSeconds) : '—'}
          </span>
        </div>
        <div className="bg-surface-2 rounded px-2 py-1.5">
          <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
            <Cpu className="w-3 h-3" />
            <span>Memory</span>
          </div>
          <span className="font-numeric text-slate-300">
            {svc.memoryMb != null ? `${svc.memoryMb} MB` : '—'}
          </span>
        </div>
        <div className="bg-surface-2 rounded px-2 py-1.5">
          <div className="flex items-center gap-1 text-muted-foreground mb-0.5">
            <RotateCcw className="w-3 h-3" />
            <span>Restarts</span>
          </div>
          <span className={cn('font-numeric', (svc.restartCount ?? 0) > 3 ? 'text-warning' : 'text-slate-300')}>
            {svc.restartCount ?? 0}
          </span>
        </div>
      </div>

      {svc.detail && (
        <p className="text-xs text-muted-foreground truncate">{svc.detail}</p>
      )}
    </div>
  )
}

function FeedRow({ feed }: { feed: FeedStatus }) {
  const staleness = feedStaleness(feed.lastFetchAt)

  const dotClass = {
    ok: 'bg-profit',
    stale: 'bg-warning animate-pulse',
    dead: 'bg-loss',
  }[staleness]

  const badgeVariant: 'success' | 'warning' | 'danger' =
    staleness === 'ok' ? 'success' : staleness === 'stale' ? 'warning' : 'danger'

  const badgeLabel =
    staleness === 'ok' ? 'Live' : staleness === 'stale' ? 'Stale' : 'No data'

  return (
    <div className="flex items-center gap-3 py-2.5 border-b border-border last:border-0">
      <span className={cn('w-2 h-2 rounded-full shrink-0', dotClass)} />
      <span className="text-sm text-slate-300 flex-1">{feed.name}</span>
      <div className="flex items-center gap-3">
        {feed.latencyMs != null && (
          <span className="text-xs font-numeric text-muted-foreground">{feed.latencyMs} ms</span>
        )}
        {feed.lastFetchAt ? (
          <span className="text-xs text-muted-foreground hidden sm:inline">
            {formatDistanceToNow(new Date(feed.lastFetchAt), { addSuffix: true })}
          </span>
        ) : (
          <span className="text-xs text-muted-foreground hidden sm:inline">never</span>
        )}
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
      </div>
    </div>
  )
}

function MemoryBar({ used, total, label }: { used: number; total: number; label: string }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0
  const barColor = pct > 80 ? 'bg-loss' : pct > 60 ? 'bg-warning' : 'bg-profit'
  return (
    <div className="space-y-1.5">
      <div className="flex justify-between text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-numeric text-slate-300">{used} / {total} MB ({pct}%)</span>
      </div>
      <div className="h-2 bg-surface-2 rounded-full overflow-hidden">
        <div className={cn('h-full rounded-full transition-all', barColor)} style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// ─── tab content components ───────────────────────────────────────────────────

function GeneralTab() {
  const { killSwitchEnabled } = useAppStore()
  return (
    <div className="space-y-6">
      <Section title="Sandbox Mode">
        <SandboxSection />
      </Section>

      <Section
        title="Kill Switch"
        badge={
          <Badge variant={killSwitchEnabled ? 'danger' : 'default'} className="ml-auto">
            {killSwitchEnabled ? 'ACTIVE' : 'Inactive'}
          </Badge>
        }
      >
        <KillSwitchSection />
      </Section>

      <Section title="System Configuration">
        <SystemConfigSection />
      </Section>

      <Section title="Engine Configuration">
        <EngineConfigSection />
      </Section>
    </div>
  )
}

function RiskConfigTab() {
  const [autoTuneActive, setAutoTuneActive] = React.useState(false)
  const { data: autoTuneStatus } = useAutoTuneStatus()

  // Sync initial state from server
  React.useEffect(() => {
    if (autoTuneStatus != null) {
      setAutoTuneActive(autoTuneStatus.enabled)
    }
  }, [autoTuneStatus])

  return (
    <div className="space-y-4">
      <RiskAppetiteCard />
      <AiRiskAutoTuner onAutoTuneChange={setAutoTuneActive} />
      <div className={cn(
        'bg-surface rounded-lg border border-border p-4 transition-opacity',
        autoTuneActive ? 'opacity-50 pointer-events-none' : '',
      )}>
        {autoTuneActive && (
          <div className="flex items-center gap-2 mb-4 text-xs text-info">
            <Brain className="w-3.5 h-3.5 shrink-0" />
            <span>These values are managed by the AI auto-tuner. Disable it to edit manually.</span>
          </div>
        )}
        <RiskConfigSection />
      </div>
    </div>
  )
}

function ApiKeysTab() {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <ApiKeysSection />
    </div>
  )
}

function AiModelTab() {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <AiConfigSection />
    </div>
  )
}

function SystemHealthTab() {
  const { health, lastUpdated } = useSystemHealth()
  const connectionStatus = useAppStore((s) => s.connectionStatus)

  if (!health) return <LoadingPage />

  const overallLevel: StatusLevel = health.status === 'ok' ? 'ok' : health.status === 'degraded' ? 'degraded' : 'error'

  const erroredServices = health.services?.filter((s) => s.status === 'errored').length ?? 0
  const staleFeeds = health.feeds?.filter((f) => feedStaleness(f.lastFetchAt) !== 'ok').length ?? 0

  return (
    <div className="space-y-6">
      {/* Last-updated note */}
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
        <RefreshCw className="w-3.5 h-3.5" />
        {lastUpdated
          ? `Last event ${formatDistanceToNow(lastUpdated, { addSuffix: true })} · auto-refreshes every 30 s`
          : 'Waiting for first WebSocket event…'}
      </div>

      {/* Overall banner */}
      <div
        className={cn(
          'rounded-lg border px-4 py-3 flex items-center gap-3',
          overallLevel === 'ok' && 'bg-profit/10 border-profit/30',
          overallLevel === 'degraded' && 'bg-warning/10 border-warning/30',
          overallLevel === 'error' && 'bg-loss/10 border-loss/30',
        )}
      >
        <StatusDot status={overallLevel} />
        <span
          className={cn(
            'text-sm font-semibold',
            overallLevel === 'ok' && 'text-profit',
            overallLevel === 'degraded' && 'text-warning',
            overallLevel === 'error' && 'text-loss',
          )}
        >
          {overallLevel === 'ok'
            ? 'All systems operational'
            : overallLevel === 'degraded'
            ? `System degraded — ${erroredServices} service${erroredServices !== 1 ? 's' : ''} errored, ${staleFeeds} feed${staleFeeds !== 1 ? 's' : ''} stale`
            : 'Critical — system errors detected'}
        </span>
      </div>

      {/* Infrastructure */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">Infrastructure</h2>
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <InfraCard
            label="PostgreSQL"
            status={health.db === 'ok' ? 'ok' : 'error'}
            icon={Database}
            latencyMs={health.dbLatencyMs}
            sub="Primary database"
          />
          <InfraCard
            label="Redis"
            status={health.redis === 'ok' ? 'ok' : 'error'}
            icon={Server}
            latencyMs={health.redisLatencyMs}
            sub="Cache & pub/sub"
          />
          <InfraCard
            label="WebSocket"
            status={connectionStatus === 'connected' ? 'ok' : connectionStatus === 'connecting' ? 'degraded' : 'error'}
            icon={Wifi}
            sub={`${health.connections} client${health.connections !== 1 ? 's' : ''} connected`}
          />
          <InfraCard
            label="API Server"
            status="ok"
            icon={Clock}
            sub={`Uptime ${formatUptime(health.uptime)}`}
          />
        </div>
      </div>

      {/* Memory */}
      {health.memory && (
        <div className="bg-surface rounded-lg border border-border p-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-4">Memory</h2>
          <div className="space-y-3">
            <MemoryBar
              label="Heap"
              used={health.memory.heapUsedMb}
              total={health.memory.heapTotalMb}
            />
            <div className="flex justify-between text-xs">
              <span className="text-muted-foreground">RSS (resident set)</span>
              <span className="font-numeric text-slate-300">{health.memory.rssMb} MB</span>
            </div>
          </div>
        </div>
      )}

      {/* PM2 services */}
      <div>
        <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide mb-3">
          Services (PM2) — {health.services?.filter((s) => s.status === 'running').length ?? 0} / {health.services?.length ?? 0} running
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-3 gap-3">
          {health.services?.map((svc) => <ServiceCard key={svc.name} svc={svc} />)}
        </div>
      </div>

      {/* BTC 5-Min Bot */}
      <div className="bg-surface rounded-lg border border-border p-4">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xs font-medium text-muted-foreground uppercase tracking-wide">BTC 5-Min Bot</h2>
        </div>
        <BtcBotHealthWidget />
      </div>

      {/* Data feeds */}
      <div className="bg-surface rounded-lg border border-border">
        <div className="flex items-center gap-2 px-4 py-3 border-b border-border">
          <Radio className="w-4 h-4 text-info" />
          <h2 className="text-sm font-medium text-slate-200">Data Feeds</h2>
          <span className="ml-auto text-xs text-muted-foreground">
            stale &gt;5 min · dead &gt;15 min
          </span>
        </div>
        <div className="px-4">
          {health.feeds?.map((feed) => <FeedRow key={feed.name} feed={feed} />)}
        </div>
      </div>

      {/* Footer */}
      <div className="bg-surface rounded-lg border border-border px-4 py-3 flex flex-wrap gap-6 text-xs text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Users className="w-3.5 h-3.5" />
          <span>{health.connections} WS client{health.connections !== 1 ? 's' : ''}</span>
        </div>
        {health.environment && (
          <div className="flex items-center gap-1.5">
            <Server className="w-3.5 h-3.5" />
            <span>Env: <span className="text-slate-300 uppercase">{health.environment}</span></span>
          </div>
        )}
        <div className="ml-auto font-numeric">
          {health.timestamp ? new Date(health.timestamp).toLocaleTimeString() : '—'}
        </div>
      </div>
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'general'
  const { killSwitchEnabled } = useAppStore()

  const setTab = (id: string) => {
    setSearchParams({ tab: id }, { replace: true })
  }

  const isHealthTab = activeTab === 'health'

  return (
    <div className={cn('space-y-6', !isHealthTab && 'max-w-4xl')}>
      <PageHeader
        title="Settings"
        subtitle="Platform configuration, risk management, and system health"
        actions={
          killSwitchEnabled ? (
            <Badge variant="danger">Kill Switch ACTIVE</Badge>
          ) : undefined
        }
      />

      {/* Tab bar */}
      <div className="flex gap-1 border-b border-border overflow-x-auto">
        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setTab(tab.id)}
            className={cn(
              'px-4 py-2 text-sm font-medium transition-colors border-b-2 -mb-px whitespace-nowrap',
              activeTab === tab.id
                ? 'border-info text-info'
                : 'border-transparent text-muted-foreground hover:text-slate-300',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'general' && <GeneralTab />}
      {activeTab === 'risk'    && <RiskConfigTab />}
      {activeTab === 'keys'    && <ApiKeysTab />}
      {activeTab === 'ai'      && <AiModelTab />}
      {activeTab === 'health'  && <SystemHealthTab />}
    </div>
  )
}
