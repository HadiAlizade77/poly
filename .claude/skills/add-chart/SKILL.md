---
name: add-chart
description: >
  Add a new chart/visualization to the frontend dashboard.
  Use when creating P&L charts, price charts, gauges, heatmaps, or any data visualization.
argument-hint: "[chart-name] [type: line|area|bar|pie|candlestick|gauge|heatmap|scatter]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Add Chart

Create chart: `$ARGUMENTS[0]` (type: `$ARGUMENTS[1]`)

## Project Context

- General charts (line, area, bar, pie, scatter): **Recharts** (`recharts` v3.8)
- Financial charts (candlestick, OHLC, time-series): **TradingView Lightweight Charts** (`lightweight-charts` v5.1)
- Risk gauges: Custom SVG or Recharts `<PieChart>` adapted
- Heatmaps: Custom component or Recharts `<ScatterChart>` with color mapping
- Styling: Tailwind CSS, dark theme (`#0a0a0f` bg, `#12121a` surfaces)
- Colors: green for profit, red for loss, blue neutral, amber warning
- Numbers font: JetBrains Mono

## Scaffolding Steps

1. Create chart component in the appropriate page directory
2. For **Recharts**:
   ```tsx
   import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';

   export function $0Chart({ data }: { data: DataPoint[] }) {
     return (
       <ResponsiveContainer width="100%" height={300}>
         <LineChart data={data}>
           <XAxis dataKey="timestamp" />
           <YAxis />
           <Tooltip />
           <Line type="monotone" dataKey="value" stroke="#22c55e" />
         </LineChart>
       </ResponsiveContainer>
     );
   }
   ```
3. For **TradingView Lightweight Charts**:
   ```tsx
   import { createChart, ColorType } from 'lightweight-charts';
   import { useEffect, useRef } from 'react';

   export function $0Chart({ data }: { data: CandlestickData[] }) {
     const chartContainerRef = useRef<HTMLDivElement>(null);
     useEffect(() => {
       const chart = createChart(chartContainerRef.current!, {
         layout: { background: { type: ColorType.Solid, color: '#0a0a0f' } },
         grid: { vertLines: { color: '#1e1e2e' }, horzLines: { color: '#1e1e2e' } },
       });
       const series = chart.addCandlestickSeries();
       series.setData(data);
       return () => chart.remove();
     }, [data]);
     return <div ref={chartContainerRef} className="w-full h-[300px]" />;
   }
   ```
4. Wire up data via TanStack Query hook or Zustand store
5. Add interactive tooltips, series toggles, and PNG download if applicable
6. Add loading skeleton and empty state

## Chart Design Rules

- All charts responsive via `ResponsiveContainer` (Recharts) or resize observer (TVLC)
- Dark theme always — no white backgrounds
- P&L values: green (#22c55e) positive, red (#ef4444) negative
- Font for axis labels: Inter, for values: JetBrains Mono
- Interactive: tooltips on hover, click to navigate to detail
