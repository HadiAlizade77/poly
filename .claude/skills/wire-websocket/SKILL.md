---
name: wire-websocket
description: >
  Wire up a new WebSocket event channel between backend and frontend.
  Use when adding real-time events like price updates, order fills, alerts, regime changes, etc.
argument-hint: "[channel-name] [event-name]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Wire WebSocket Event

Create WebSocket event: channel `$ARGUMENTS[0]`, event `$ARGUMENTS[1]`

## Project Context

- Backend WebSocket: Socket.IO server in `packages/backend/src/websocket/`
- Frontend WebSocket: Socket.IO client managed by Zustand store in `packages/frontend/src/stores/websocket.store.ts`
- Redis pub/sub bridges backend services to the API server's WebSocket

## Data Flow

```
Backend Service → Redis publish → API Server → Socket.IO emit → Frontend
```

## Steps

### Backend

1. **Publishing service** (the service that generates the event):
   - Publish to Redis: `redis.publish('$0:$1', JSON.stringify(payload))`

2. **API Server WebSocket** (`packages/backend/src/websocket/`):
   - Subscribe to Redis channel `$0:$1`
   - On message, emit to Socket.IO:
     ```typescript
     redis.subscribe('$0:$1');
     redis.on('message', (channel, message) => {
       if (channel === '$0:$1') {
         io.to('$0').emit('$1', JSON.parse(message));
       }
     });
     ```
   - Register channel in `packages/backend/src/websocket/channels.ts`

### Frontend

3. **WebSocket store** (`websocket.store.ts`):
   - Add event handler for `$1` on channel `$0`
   - Update relevant TanStack Query cache or Zustand state

4. **Page component**:
   - Subscribe to channel on mount: `socket.emit('subscribe', '$0')`
   - Unsubscribe on unmount: `socket.emit('unsubscribe', '$0')`
   - Use the `useWebSocket` hook to listen for events

## Existing Channels

| Channel | Events | Used In |
|---------|--------|---------|
| system | status | Header, Dashboard, Health |
| market | price_update, opportunity | Markets, Positions |
| signal | new, vetoed | Dashboard, Signals |
| order | placed, filled, cancelled | Dashboard, Orders |
| position | opened, updated, closed | Positions |
| risk | event, kill_switch | Dashboard, Risk |
| ai | decision, regime_change | Dashboard, AI |
| alert | new | All pages (toast) |
| bankroll | update | Dashboard |
| analytics | pnl_update | Dashboard |

## Frontend Subscription Pattern

```tsx
const { subscribe, unsubscribe } = useWebSocket();

useEffect(() => {
  subscribe('$0', '$1', (data) => {
    // Update query cache or local state
    queryClient.setQueryData(['$0'], (old) => ({ ...old, ...data }));
  });
  return () => unsubscribe('$0', '$1');
}, []);
```
