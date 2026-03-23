import { useState, useEffect } from 'react'
import { useSocket } from './useSocket'
import { useHealth } from './useSystemConfig'

export interface HealthMemory {
  heapUsedMb: number
  heapTotalMb: number
  rssMb: number
}

export interface ServiceStatus {
  name: string
  /** PM2 / process status */
  status: 'running' | 'stopped' | 'errored' | 'unknown'
  uptimeSeconds?: number
  memoryMb?: number
  restartCount?: number
  detail?: string
}

export interface FeedStatus {
  name: string
  connected: boolean
  /** ISO string of last successful message / fetch */
  lastFetchAt?: string | null
  latencyMs?: number
  detail?: string
}

export interface InfraStatus {
  status: 'ok' | 'error'
  latencyMs?: number
}

export interface SystemHealthPayload {
  status: 'ok' | 'degraded' | 'error'
  uptime: number
  timestamp: string
  db: 'ok' | 'error'
  dbLatencyMs?: number
  redis: 'ok' | 'error'
  redisLatencyMs?: number
  connections: number
  memory?: HealthMemory
  services?: ServiceStatus[]
  feeds?: FeedStatus[]
  environment?: string
}

// All known PM2-managed processes
const KNOWN_SERVICES: ServiceStatus[] = [
  { name: 'api-server',        status: 'unknown' },
  { name: 'market-scanner',    status: 'unknown' },
  { name: 'data-ingestion',    status: 'unknown' },
  { name: 'decision-engine',   status: 'unknown' },
  { name: 'execution-manager', status: 'unknown' },
  { name: 'ai-reviewer',       status: 'unknown' },
  { name: 'scheduler',         status: 'unknown' },
]

const KNOWN_FEEDS: FeedStatus[] = [
  { name: 'Binance',      connected: false, lastFetchAt: null },
  { name: 'News API',     connected: false, lastFetchAt: null },
  { name: 'Polling Data', connected: false, lastFetchAt: null },
  { name: 'Sports Odds',  connected: false, lastFetchAt: null },
]

export function useHealthSocket() {
  const { on } = useSocket()
  const { data: restHealth } = useHealth()

  const [health, setHealth] = useState<SystemHealthPayload | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)

  // Seed from REST on first load so the page isn't blank
  useEffect(() => {
    if (restHealth && !health) {
      const full = restHealth as unknown as Partial<SystemHealthPayload>
      setHealth({
        status: (full.status ?? 'ok') as SystemHealthPayload['status'],
        uptime: full.uptime ?? 0,
        timestamp: full.timestamp ?? new Date().toISOString(),
        db: full.db ?? 'ok',
        redis: full.redis ?? 'ok',
        connections: full.connections ?? 0,
        memory: full.memory,
        services: full.services,
        environment: full.environment ?? restHealth.environment,
      })
    }
  }, [restHealth, health])

  // Real-time updates via WebSocket every 30 s
  useEffect(() => {
    const off = on<SystemHealthPayload>('system:health', (payload) => {
      setHealth(payload)
      setLastUpdated(new Date())
    })
    return off
  }, [on])

  const merged: SystemHealthPayload | null = health
    ? {
        ...health,
        // Merge live services on top of known list so we always show all 7
        services: health.services
          ? KNOWN_SERVICES.map((known) => {
              const live = health.services!.find((s) => s.name === known.name)
              return live ?? known
            })
          : KNOWN_SERVICES,
        feeds: health.feeds
          ? KNOWN_FEEDS.map((known) => {
              const live = health.feeds!.find((f) => f.name === known.name)
              return live ?? known
            })
          : KNOWN_FEEDS,
      }
    : null

  return { health: merged, lastUpdated }
}

// ─── helpers ──────────────────────────────────────────────────────────────────

/** seconds → "2d 3h 14m" */
export function formatUptime(seconds: number): string {
  const d = Math.floor(seconds / 86_400)
  const h = Math.floor((seconds % 86_400) / 3600)
  const m = Math.floor((seconds % 3600) / 60)
  const parts: string[] = []
  if (d > 0) parts.push(`${d}d`)
  if (h > 0) parts.push(`${h}h`)
  parts.push(`${m}m`)
  return parts.join(' ')
}

/** Feed staleness: ok if fetched <5m ago, stale if 5–15m, dead if >15m or null */
export function feedStaleness(lastFetchAt: string | null | undefined): 'ok' | 'stale' | 'dead' {
  if (!lastFetchAt) return 'dead'
  const ageMs = Date.now() - new Date(lastFetchAt).getTime()
  if (ageMs < 5 * 60_000) return 'ok'
  if (ageMs < 15 * 60_000) return 'stale'
  return 'dead'
}
