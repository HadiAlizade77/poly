import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  ScatterChart,
  Scatter,
  Legend,
  ReferenceLine,
  BarChart,
  Bar,
} from 'recharts'
import { format } from 'date-fns'
import { useBankrollHistory, useBankroll } from '@/hooks/useBankroll'
import { useAnalyticsSummary } from '@/hooks/useAnalytics'
import { useDecisions } from '@/hooks/useDecisions'
import { StatCard } from '@/components/ui/StatCard'
import { PnlDisplay } from '@/components/ui/PnlDisplay'
import { LoadingPage } from '@/components/ui/LoadingSpinner'
import { EmptyState } from '@/components/ui/EmptyState'
import { PageHeader } from '@/components/ui/PageHeader'
import { BarChart3 } from 'lucide-react'

// ─── chart theme ──────────────────────────────────────────────────────────────

const CHART_COLORS = {
  profit: '#22c55e',
  loss:   '#ef4444',
  info:   '#3b82f6',
  warn:   '#f59e0b',
  muted:  '#6b7280',
  grid:   '#1e1e2e',
  text:   '#9ca3af',
}

const CATEGORY_COLORS = [
  '#3b82f6', '#22c55e', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4',
]

const tooltipStyle = {
  backgroundColor: '#12121a',
  border: '1px solid #1e1e2e',
  borderRadius: '6px',
  color: '#f1f5f9',
  fontSize: 12,
}

// ─── P&L history chart ────────────────────────────────────────────────────────

function PnlHistoryChart() {
  const { data: history, isLoading } = useBankrollHistory()

  if (isLoading) return <LoadingPage />
  if (!history || history.length === 0) {
    return (
      <EmptyState
        title="No history yet"
        message="Balance history will appear once trading begins."
      />
    )
  }

  const chartData = history.map((h) => ({
    date: format(new Date(h.date), 'MMM d'),
    balance: h.closing_balance,
    pnl: h.trading_pnl,
    winRate: h.win_rate != null ? +(h.win_rate * 100).toFixed(1) : null,
  }))

  const firstBalance = chartData[0]?.balance ?? 0
  const lastBalance  = chartData[chartData.length - 1]?.balance ?? 0
  const totalPnl     = lastBalance - firstBalance

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between mb-1">
        <p className="text-xs text-muted-foreground">Total change</p>
        <PnlDisplay value={totalPnl} showIcon size="sm" />
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
          <XAxis dataKey="date" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis
            tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v: number) => `$${v.toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
            width={70}
          />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(value: number) => [`$${value.toLocaleString('en-US', { minimumFractionDigits: 2 })}`, 'Balance']}
            labelStyle={{ color: CHART_COLORS.text }}
          />
          <ReferenceLine y={firstBalance} stroke={CHART_COLORS.muted} strokeDasharray="4 2" />
          <Line
            type="monotone"
            dataKey="balance"
            stroke={totalPnl >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4, fill: totalPnl >= 0 ? CHART_COLORS.profit : CHART_COLORS.loss }}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  )
}

// ─── daily P&L bar-style line chart ──────────────────────────────────────────

function DailyPnlChart() {
  const { data: history, isLoading } = useBankrollHistory()

  if (isLoading || !history || history.length === 0) return null

  const chartData = history.map((h) => ({
    date: format(new Date(h.date), 'MMM d'),
    pnl: +h.trading_pnl.toFixed(2),
  }))

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis dataKey="date" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `$${v}`}
          width={55}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number) => [`$${value.toFixed(2)}`, 'Daily P&L']}
          labelStyle={{ color: CHART_COLORS.text }}
        />
        <ReferenceLine y={0} stroke={CHART_COLORS.muted} />
        <Line
          type="monotone"
          dataKey="pnl"
          stroke={CHART_COLORS.info}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── trades by category pie ───────────────────────────────────────────────────

function CategoryPieChart() {
  const { data: summary, isLoading } = useAnalyticsSummary()

  if (isLoading) return <LoadingPage />
  if (!summary || Object.keys(summary.by_category).length === 0) {
    return <EmptyState title="No category data" message="Category breakdown appears once trades execute." />
  }

  const data = Object.entries(summary.by_category).map(([name, stats]) => ({
    name,
    value: stats.trades,
    pnl: stats.pnl,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie
          data={data}
          cx="50%"
          cy="50%"
          innerRadius={55}
          outerRadius={85}
          paddingAngle={3}
          dataKey="value"
          label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
          labelLine={false}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number, _name: string, entry) => [
            `${value} trades · $${(entry.payload as { pnl: number }).pnl.toFixed(2)} P&L`,
          ]}
        />
        <Legend
          iconType="circle"
          iconSize={8}
          formatter={(value) => <span style={{ color: CHART_COLORS.text, fontSize: 11 }}>{value}</span>}
        />
      </PieChart>
    </ResponsiveContainer>
  )
}

// ─── confidence vs outcome scatter ────────────────────────────────────────────

function ConfidenceOutcomeChart() {
  const { data: decisions, isLoading } = useDecisions()

  if (isLoading) return <LoadingPage />

  const tradeDecisions = decisions?.filter((d) => d.action === 'trade' && d.was_executed) ?? []

  if (tradeDecisions.length === 0) {
    return <EmptyState title="No executed trades" message="Scatter plot populates after trades execute." />
  }

  const data = tradeDecisions.map((d) => ({
    confidence: +(d.confidence * 100).toFixed(1),
    edge: d.estimated_edge != null ? +(d.estimated_edge * 100).toFixed(2) : 0,
    executed: d.was_executed ? 1 : 0,
  }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <ScatterChart margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis
          dataKey="confidence"
          name="Confidence"
          unit="%"
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          label={{ value: 'Confidence %', position: 'insideBottom', offset: -2, fill: CHART_COLORS.text, fontSize: 11 }}
        />
        <YAxis
          dataKey="edge"
          name="Edge"
          unit="%"
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          width={45}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          cursor={{ strokeDasharray: '3 3', stroke: CHART_COLORS.muted }}
          formatter={(value: number, name: string) => [`${value}%`, name]}
        />
        <ReferenceLine y={0} stroke={CHART_COLORS.muted} strokeDasharray="4 2" />
        <Scatter data={data} fill={CHART_COLORS.info} opacity={0.7} />
      </ScatterChart>
    </ResponsiveContainer>
  )
}

// ─── win rate over time ───────────────────────────────────────────────────────

function WinRateChart() {
  const { data: history, isLoading } = useBankrollHistory()

  if (isLoading || !history || history.length === 0) return null

  const chartData = history
    .filter((h) => h.win_rate != null)
    .map((h) => ({
      date: format(new Date(h.date), 'MMM d'),
      winRate: +(h.win_rate! * 100).toFixed(1),
    }))

  if (chartData.length === 0) return null

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={chartData} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis dataKey="date" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
          width={40}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number) => [`${value}%`, 'Win Rate']}
          labelStyle={{ color: CHART_COLORS.text }}
        />
        <ReferenceLine y={50} stroke={CHART_COLORS.muted} strokeDasharray="4 2" />
        <Line
          type="monotone"
          dataKey="winRate"
          stroke={CHART_COLORS.warn}
          strokeWidth={2}
          dot={false}
          activeDot={{ r: 4 }}
        />
      </LineChart>
    </ResponsiveContainer>
  )
}

// ─── confidence calibration ───────────────────────────────────────────────────

function ConfidenceCalibrationChart() {
  const { data: decisions, isLoading } = useDecisions()

  if (isLoading) return <LoadingPage />

  const executed = decisions?.filter((d) => d.action === 'trade' && d.was_executed) ?? []

  if (executed.length === 0) {
    return <EmptyState title="No executed trades" message="Calibration chart populates after trades execute." />
  }

  // Group into 10% confidence buckets and compute win rate per bucket
  type Bucket = { bucket: string; winRate: number; count: number }
  const bucketMap: Record<string, { wins: number; total: number }> = {}
  for (const d of executed) {
    const pct = Math.floor(d.confidence * 10) * 10
    const label = `${pct}–${pct + 10}%`
    if (!bucketMap[label]) bucketMap[label] = { wins: 0, total: 0 }
    bucketMap[label].total++
    if ((d.estimated_edge ?? 0) > 0) bucketMap[label].wins++
  }

  const data: Bucket[] = Object.entries(bucketMap)
    .sort(([a], [b]) => parseInt(a) - parseInt(b))
    .map(([bucket, { wins, total }]) => ({
      bucket,
      winRate: total > 0 ? +((wins / total) * 100).toFixed(1) : 0,
      count: total,
    }))

  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke={CHART_COLORS.grid} />
        <XAxis dataKey="bucket" tick={{ fill: CHART_COLORS.text, fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis
          domain={[0, 100]}
          tick={{ fill: CHART_COLORS.text, fontSize: 11 }}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v: number) => `${v}%`}
          width={40}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value: number, _name: string, entry) => [
            `${value}% win rate · ${(entry.payload as Bucket).count} trades`,
          ]}
          labelStyle={{ color: CHART_COLORS.text }}
        />
        <ReferenceLine y={50} stroke={CHART_COLORS.muted} strokeDasharray="4 2" />
        <Bar dataKey="winRate" fill={CHART_COLORS.info} radius={[3, 3, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  )
}

// ─── chart card wrapper ───────────────────────────────────────────────────────

function ChartCard({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="bg-surface rounded-lg border border-border p-4">
      <h2 className="text-sm font-medium text-slate-200 mb-4">{title}</h2>
      {children}
    </div>
  )
}

// ─── page ─────────────────────────────────────────────────────────────────────

export default function Analytics() {
  const { data: summary, isLoading: summaryLoading } = useAnalyticsSummary()
  const { data: bankroll, isLoading: bankrollLoading } = useBankroll()

  const winRate  = summary?.win_rate != null ? `${(summary.win_rate * 100).toFixed(1)}%` : '—'
  const avgPnl   = summary?.avg_pnl_per_trade != null ? summary.avg_pnl_per_trade : null

  return (
    <div className="space-y-6">
      <PageHeader title="Analytics" subtitle="Performance metrics and trade history analysis" />

      {/* Summary stats */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Total Trades"
          loading={summaryLoading}
          value={summary?.total_trades ?? '—'}
          subValue={summary ? `${summary.winning_trades}W / ${summary.losing_trades}L` : undefined}
        />
        <StatCard
          label="Win Rate"
          loading={summaryLoading}
          value={winRate}
        />
        <StatCard
          label="Total P&L"
          loading={summaryLoading}
          value={summary ? <PnlDisplay value={summary.total_pnl} size="lg" showIcon /> : '—'}
          subValue={avgPnl != null ? <span className="text-xs">avg <PnlDisplay value={avgPnl} size="sm" /> / trade</span> : undefined}
        />
        <StatCard
          label="Total Balance"
          loading={bankrollLoading}
          value={
            bankroll
              ? `$${bankroll.total_balance.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
              : '—'
          }
          subValue={bankroll ? <PnlDisplay value={bankroll.balance_delta_today} size="sm" showIcon /> : undefined}
        />
      </div>

      {/* Charts row 1 — P&L history (full width) */}
      <ChartCard title="Portfolio Balance History">
        <PnlHistoryChart />
      </ChartCard>

      {/* Charts row 2 — Daily P&L + Win rate */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Daily P&L">
          <DailyPnlChart />
        </ChartCard>
        <ChartCard title="Win Rate Over Time">
          <WinRateChart />
        </ChartCard>
      </div>

      {/* Charts row 3 — Category breakdown + Confidence scatter */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <ChartCard title="Trades by Category">
          <CategoryPieChart />
        </ChartCard>
        <ChartCard title="Confidence vs Estimated Edge">
          <ConfidenceOutcomeChart />
        </ChartCard>
      </div>

      {/* Charts row 4 — Confidence calibration */}
      <ChartCard title="Confidence Calibration (Win Rate by Confidence Bucket)">
        <ConfidenceCalibrationChart />
      </ChartCard>

      {/* Best / Worst trade */}
      {summary && (summary.best_trade_pnl != null || summary.worst_trade_pnl != null) && (
        <div className="grid grid-cols-2 gap-4">
          <StatCard
            label="Best Trade"
            loading={false}
            value={summary.best_trade_pnl != null ? <PnlDisplay value={summary.best_trade_pnl} size="lg" showIcon /> : '—'}
          />
          <StatCard
            label="Worst Trade"
            loading={false}
            value={summary.worst_trade_pnl != null ? <PnlDisplay value={summary.worst_trade_pnl} size="lg" showIcon /> : '—'}
          />
        </div>
      )}

      {/* Fees summary */}
      {summary && (
        <div className="bg-surface rounded-lg border border-border px-4 py-3 flex flex-wrap gap-6 text-xs text-muted-foreground">
          <span>Total fees paid: <span className="font-numeric text-slate-300">${summary.total_fees.toFixed(4)}</span></span>
          {summary.avg_hold_time_hours != null && (
            <span>Avg hold time: <span className="font-numeric text-slate-300">{summary.avg_hold_time_hours.toFixed(1)}h</span></span>
          )}
          <span className="ml-auto">
            <BarChart3 className="w-3.5 h-3.5 inline mr-1" />
            {summary.total_trades} total trades analyzed
          </span>
        </div>
      )}
    </div>
  )
}
