import React from 'react'
import { useForm } from 'react-hook-form'
import { toast } from 'sonner'
import { Save, Power, AlertTriangle, Edit2, Check, X } from 'lucide-react'
import { useRiskConfig, useUpdateRiskConfig, useToggleKillSwitch } from '@/hooks/useRiskConfig'
import { useSystemConfigs, useSetSystemConfig } from '@/hooks/useSystemConfig'
import { useAppStore } from '@/stores/app.store'
import { Badge } from '@/components/ui/Badge'
import { LoadingPage } from '@/components/ui/LoadingSpinner'
import { PageHeader } from '@/components/ui/PageHeader'
import { cn } from '@/lib/utils'
import type { RiskConfig } from '@polymarket/shared'

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
  { key: 'max_daily_loss',                    label: 'Max Daily Loss',           description: 'Maximum USD loss allowed per day',                  min: 0,    max: 10000,  step: 10,    unit: '$' },
  { key: 'max_position_size',                 label: 'Max Position Size',        description: 'Maximum fraction of bankroll per position',         min: 0,    max: 1,      step: 0.01,  isPercent: true },
  { key: 'max_total_exposure',                label: 'Max Total Exposure',       description: 'Maximum total deployed capital in USD',             min: 0,    max: 100000, step: 100,   unit: '$' },
  { key: 'max_single_trade',                  label: 'Max Single Trade',         description: 'Maximum USD size for a single trade',               min: 0,    max: 10000,  step: 10,    unit: '$' },
  { key: 'max_consecutive_losses',            label: 'Max Consecutive Losses',   description: 'Loss streak before cooldown is triggered',          min: 1,    max: 20,     step: 1 },
  { key: 'cooldown_after_loss_streak_minutes',label: 'Cooldown Duration',        description: 'Minutes to pause trading after a loss streak',      min: 0,    max: 1440,   step: 5,     unit: 'min' },
  { key: 'min_liquidity',                     label: 'Min Liquidity',            description: 'Minimum market liquidity in USD to trade',          min: 0,    max: 100000, step: 100,   unit: '$' },
  { key: 'max_spread',                        label: 'Max Spread',               description: 'Maximum bid-ask spread to accept',                  min: 0,    max: 0.5,    step: 0.005, isPercent: true },
  { key: 'max_latency_ms',                    label: 'Max Latency',              description: 'Maximum acceptable order placement latency',         min: 0,    max: 10000,  step: 50,    unit: 'ms' },
  { key: 'max_data_age_seconds',              label: 'Max Data Age',             description: 'Maximum age of price data before rejecting a trade', min: 0,    max: 3600,   step: 10,    unit: 's' },
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

function RiskConfigSection() {
  const { data: config, isLoading } = useRiskConfig()
  const update = useUpdateRiskConfig()

  const { register, handleSubmit, reset, formState: { isDirty } } = useForm<RiskFormValues>()

  // Populate form when data loads
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

// ─── kill switch section ───────────────────────────────────────────────────────

function KillSwitchSection() {
  const [confirming, setConfirming] = React.useState(false)
  const { killSwitchEnabled, toggleKillSwitch } = useAppStore()
  const toggleMutation = useToggleKillSwitch()

  const handleToggle = () => {
    if (!killSwitchEnabled) {
      // Enabling kill switch — confirm first
      setConfirming(true)
    } else {
      // Disabling kill switch — no confirm needed
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

      {/* Confirmation dialog */}
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

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Settings() {
  const { killSwitchEnabled } = useAppStore()

  return (
    <div className="space-y-6 max-w-4xl">
      <PageHeader title="Settings" subtitle="Platform configuration and risk management" />

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

      <Section title="Risk Configuration">
        <RiskConfigSection />
      </Section>

      <Section title="System Configuration">
        <SystemConfigSection />
      </Section>
    </div>
  )
}
