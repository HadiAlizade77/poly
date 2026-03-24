import { CheckCircle2, Circle, Key, Brain, TrendingUp, ExternalLink } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useCredentials } from '@/hooks/useSettingsCredentials'

interface Step {
  id: string
  icon: React.ElementType
  title: string
  description: string
  done: boolean
  href?: string
  external?: boolean
}

export function GettingStarted() {
  const { data: creds, isLoading } = useCredentials()

  if (isLoading) return null

  const hasPolymarketKey = Boolean(creds?.polymarket_api_key && creds.polymarket_api_key.length > 0)
  const hasAiKey = Boolean(
    (creds?.anthropic_api_key && creds.anthropic_api_key.length > 0) ||
    (creds?.openrouter_api_key && creds.openrouter_api_key.length > 0)
  )

  const steps: Step[] = [
    {
      id: 'polymarket',
      icon: Key,
      title: 'Connect Polymarket API',
      description: 'Add your Polymarket API key, secret, and passphrase to enable live trading.',
      done: hasPolymarketKey,
      href: '/settings',
    },
    {
      id: 'ai',
      icon: Brain,
      title: 'Configure AI Provider',
      description: 'Add an Anthropic or OpenRouter API key so the AI can analyze markets.',
      done: hasAiKey,
      href: '/settings',
    },
    {
      id: 'explore',
      icon: TrendingUp,
      title: 'Explore Markets',
      description: 'Browse available prediction markets and review scanner output.',
      done: false,
      href: '/markets',
    },
  ]

  const allDone = steps.every(s => s.done)

  // Hide the checklist once all required steps are done
  if (allDone) return null

  const completedCount = steps.filter(s => s.done).length

  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <div className="flex items-center justify-between mb-3">
        <div>
          <h2 className="text-sm font-semibold text-slate-200">Getting Started</h2>
          <p className="text-xs text-muted-foreground mt-0.5">
            Complete these steps to start trading — {completedCount} of {steps.length} done
          </p>
        </div>
        <div className="text-xs text-muted-foreground font-numeric">
          {completedCount}/{steps.length}
        </div>
      </div>

      {/* Progress bar */}
      <div className="h-1 bg-surface-2 rounded-full mb-4 overflow-hidden">
        <div
          className="h-full bg-info rounded-full transition-all duration-500"
          style={{ width: `${(completedCount / steps.length) * 100}%` }}
        />
      </div>

      <div className="space-y-2">
        {steps.map(step => (
          <div
            key={step.id}
            className={`flex items-start gap-3 rounded-md p-3 transition-colors ${
              step.done ? 'opacity-60' : 'bg-surface-2'
            }`}
          >
            {step.done ? (
              <CheckCircle2 className="w-4 h-4 text-profit mt-0.5 shrink-0" />
            ) : (
              <Circle className="w-4 h-4 text-muted-foreground mt-0.5 shrink-0" />
            )}

            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <step.icon className="w-3.5 h-3.5 text-muted-foreground" />
                <span className={`text-sm font-medium ${step.done ? 'line-through text-muted-foreground' : 'text-slate-200'}`}>
                  {step.title}
                </span>
              </div>
              <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
            </div>

            {!step.done && step.href && (
              step.external ? (
                <a
                  href={step.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="shrink-0 text-xs text-info hover:underline flex items-center gap-0.5"
                >
                  Open <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <Link
                  to={step.href}
                  className="shrink-0 text-xs text-info hover:underline"
                >
                  Go
                </Link>
              )
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
