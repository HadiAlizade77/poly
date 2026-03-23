---
name: add-ui-page
description: >
  Create a new frontend page/view for the Polymarket trading dashboard.
  Use when building pages like Dashboard, Markets, Strategies, Signals, Trades, Positions, Risk, AI, Analytics, Backtest, Alerts, Settings, Health.
argument-hint: "[page-name] [route-path]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Add UI Page

Create page: `$ARGUMENTS[0]` at route `$ARGUMENTS[1]`

## Project Context

- Frontend: `packages/frontend/src/`
- React 19 + TypeScript + Vite 8
- Styling: Tailwind CSS 4 (dark mode primary)
- Components: shadcn/ui + Radix UI
- State: Zustand (client), TanStack Query (server)
- Tables: TanStack Table
- Charts: Recharts (general), TradingView Lightweight Charts (financial)
- Forms: React Hook Form + Zod
- Real-time: Socket.IO client
- Routing: React Router v6

## Design System

- Dark background: `#0a0a0f`, card surfaces: `#12121a`
- Green for profit, red for loss, blue for neutral, amber for warnings
- Font: Inter for UI, JetBrains Mono for numbers/data
- Desktop-first layout with sidebar navigation

## Scaffolding Steps

1. Create page directory: `packages/frontend/src/pages/$0/`
2. Create main page component: `$0.tsx`
   - Use the `AppShell` layout (sidebar + header + main content)
   - Include loading skeleton states
   - Include empty state with guidance
   - Include error boundary
3. Create sub-components in the same directory (panels, tables, drawers, etc.)
4. Create barrel `index.ts`
5. Add route to `App.tsx` router configuration
6. Add sidebar navigation entry in `<Sidebar>` component
7. Create API hook in `packages/frontend/src/hooks/use$0.ts`:
   - TanStack Query hooks for data fetching
   - Mutations with optimistic updates where applicable
8. Create API client in `packages/frontend/src/api/$0.api.ts`:
   - Typed axios calls matching backend endpoints
9. Wire up WebSocket events if page needs real-time data:
   - Subscribe to relevant Socket.IO channels
   - Update TanStack Query cache on events

## Component Patterns

```tsx
// Page component
export function $0Page() {
  return (
    <div className="space-y-6">
      <PageHeader title="$0" />
      <Suspense fallback={<PageSkeleton />}>
        <$0Content />
      </Suspense>
    </div>
  );
}

// Data table with TanStack Table
// Detail drawer with shadcn Sheet
// Filter bar with shadcn Select, Input, DatePicker
// Stat cards with StatCard component
// Charts with Recharts or TradingView LW Charts
```

## Testing

- Component renders without error
- Handles loading, error, empty states
- User interactions trigger correct callbacks
- Real-time updates display correctly (with mocked WebSocket)
