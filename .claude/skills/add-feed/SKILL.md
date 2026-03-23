---
name: add-feed
description: >
  Add a new external data feed to the data ingestion service.
  Use when integrating Binance, News API, The Odds API, polling data, Twitter, or other data sources.
argument-hint: "[feed-name] [source-type: websocket|rest-poll|scraper]"
allowed-tools: Read, Write, Edit, Bash, Glob, Grep
---

# Add Data Feed

Create feed: `$ARGUMENTS[0]` (type: `$ARGUMENTS[1]`)

## Project Context

- Feeds live in `packages/backend/src/services/data-ingestion/feeds/`
- Each feed implements the `DataFeed` interface
- All data normalized to `external_data_points` table
- Feeds publish events to Redis: `data:new:{source}:{type}`
- Each feed is enable/disable from UI via `system_config`

## Feed Interface

```typescript
interface DataFeed {
  name: string;
  source: string;
  dataType: string;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  onData(handler: (point: ExternalDataPoint) => void): void;
  health(): FeedHealth;
  isEnabled(): boolean;
}

interface FeedHealth {
  connected: boolean;
  lastDataReceived: Date | null;
  errorCount: number;
  latency: number;
  reconnectCount: number;
}
```

## Steps

1. Create feed file: `packages/backend/src/services/data-ingestion/feeds/$0.feed.ts`
2. Implement `DataFeed` interface:
   - For **WebSocket**: auto-reconnect with exponential backoff, ping/pong handling
   - For **REST poll**: configurable interval, rate limit awareness
   - For **Scraper**: cheerio + axios, respect robots.txt, cache results
3. Normalize output to `ExternalDataPoint`:
   ```typescript
   {
     source: '$0',
     data_type: string,
     symbol: string,
     timestamp: Date,
     value: JsonObject,    // flexible payload
     metadata: JsonObject,  // source-specific extras
   }
   ```
4. Register feed in `packages/backend/src/services/data-ingestion/manager.ts`
5. Add config entry in `system_config` seed data
6. Create unit tests for data normalization
7. Create integration test for connection lifecycle (with mocked external)

## External API References

- **Binance WS**: `wss://stream.binance.com:9443`, no auth, 24h reconnect, 5 msg/s limit
- **The Odds API**: REST `the-odds-api.com/v4/`, API key in query, credit-based billing
- **News API**: REST `newsapi.org/v2/`, API key header, 100 req/day free
- **RCP/538**: CSV download + scraping, no auth, cache heavily
- **Twitter/X**: REST + SSE, OAuth 2.0, expensive ($200+/mo)

## Health Monitoring

The feed must report health status. The system health page (`/health`) displays:
- Connection status (green/yellow/red dot)
- Last data received timestamp
- Error count since last restart
- Reconnect count
