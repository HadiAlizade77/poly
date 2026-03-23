import { http, HttpResponse } from 'msw';

const now = new Date().toISOString();
const yesterday = new Date(Date.now() - 86_400_000).toISOString();

// ─── sample data ──────────────────────────────────────────────────────────────

const bankroll = {
  id: 'bkrl-001',
  total_balance: 1000.0,
  active_balance: 800.0,
  reserved_balance: 100.0,
  deployed_balance: 200.0,
  unrealized_pnl: 5.5,
  balance_delta_today: 12.34,
  balance_delta_total: 45.67,
  updated_at: now,
};

const bankrollHistory = [
  { id: 'hist-001', date: '2026-03-21', closing_balance: 980.0, trading_pnl: -20.0, win_rate: 0.45 },
  { id: 'hist-002', date: '2026-03-22', closing_balance: 1000.0, trading_pnl: 20.0, win_rate: 0.6 },
];

const markets = [
  {
    id: 'mkt-001',
    polymarket_id: 'pm-btc-100k',
    title: 'Will BTC exceed $100k?',
    category: 'crypto',
    status: 'active',
    current_prices: { Yes: 0.65, No: 0.35 },
    is_tradeable: true,
    created_at: yesterday,
    updated_at: now,
    end_date: null,
    liquidity: 50000,
    volume_24h: 10000,
  },
  {
    id: 'mkt-002',
    polymarket_id: 'pm-eth-5k',
    title: 'Will ETH reach $5k in 2026?',
    category: 'crypto',
    status: 'active',
    current_prices: { Yes: 0.4, No: 0.6 },
    is_tradeable: true,
    created_at: yesterday,
    updated_at: now,
    end_date: null,
    liquidity: 30000,
    volume_24h: 5000,
  },
];

const decisions = [
  {
    id: 'dec-001',
    action: 'trade',
    confidence: 0.75,
    category: 'crypto',
    regime_assessment: 'trending',
    estimated_edge: 0.05,
    estimated_cost: 50.0,
    fair_value: 0.7,
    was_executed: true,
    timestamp: now,
    dashboard_text: 'BTC showing uptrend momentum',
    reasoning: 'Strong on-chain metrics and price action.',
    model_used: 'claude-sonnet-4-6',
    latency_ms: 320,
    tokens_used: 1200,
    prompt_version: 'v2',
    direction: 'long',
    trade_feedback: {},
  },
  {
    id: 'dec-002',
    action: 'hold',
    confidence: 0.45,
    category: 'politics',
    regime_assessment: 'quiet',
    estimated_edge: -0.01,
    estimated_cost: null,
    fair_value: null,
    was_executed: false,
    timestamp: yesterday,
    dashboard_text: 'Insufficient edge in politics market',
    reasoning: 'Market too efficient, no clear edge.',
    model_used: 'claude-sonnet-4-6',
    latency_ms: 280,
    tokens_used: 900,
    prompt_version: 'v2',
    direction: null,
    trade_feedback: {},
  },
];

const decisionStats = {
  total: 50,
  trades: 20,
  holds: 25,
  executed: 18,
  vetoed: 2,
  avg_confidence: 0.72,
  avg_edge: null,
};

const orders = [
  {
    id: 'ord-001',
    side: 'buy',
    outcome_token: 'YES-BTC-001',
    order_type: 'limit',
    price: 0.65,
    size: 100.0,
    filled_size: 50.0,
    avg_fill_price: 0.64,
    fees_paid: 0.05,
    status: 'partial',
    created_at: now,
    filled_at: null,
    cancelled_at: null,
    polymarket_order_id: 'pm-ord-123',
    placement_latency_ms: 150,
    decision_id: 'dec-001',
    maker_or_taker: 'maker',
    error_message: null,
    market_id: 'mkt-001',
  },
];

const positions = [
  {
    id: 'pos-001',
    side: 'long',
    outcome_token: 'YES-BTC-001',
    size: 50.0,
    avg_entry_price: 0.64,
    current_price: 0.68,
    unrealized_pnl: 2.0,
    realized_pnl: 0,
    total_fees: 0.05,
    exit_strategy: 'stop_loss',
    stop_loss_price: 0.55,
    opened_at: yesterday,
    market_id: 'mkt-001',
  },
];

const positionHistory = [
  {
    id: 'ph-001',
    side: 'long',
    outcome_token: 'YES-ETH-001',
    size: 25.0,
    avg_entry_price: 0.55,
    avg_exit_price: 0.72,
    realized_pnl: 4.25,
    total_fees: 0.03,
    close_reason: 'resolution',
    opened_at: '2026-03-20T10:00:00Z',
    closed_at: '2026-03-22T15:00:00Z',
    regime_at_entry: 'trending',
    market_id: 'mkt-001',
  },
];

const riskConfig = [
  {
    id: 'rcfg-001',
    scope: 'global',
    scope_value: null,
    parameters: {
      max_daily_loss: 500,
      max_position_size_pct: 0.1,
      max_total_exposure: 2000,
      max_single_trade: 200,
      max_consecutive_losses: 5,
      cooldown_after_loss_streak_minutes: 60,
      min_liquidity: 1000,
      max_spread: 0.05,
      latency_threshold_ms: 2000,
      min_scorer_data_freshness_seconds: 60,
    },
    updated_at: now,
  },
];

const riskEvents = [
  {
    id: 'rsk-001',
    timestamp: now,
    severity: 'warning',
    event_type: 'drawdown_limit',
    message: 'Daily drawdown approaching limit',
    auto_resolved: false,
  },
  {
    id: 'rsk-002',
    timestamp: yesterday,
    severity: 'info',
    event_type: 'trade_vetoed',
    message: 'Trade vetoed by risk governor',
    auto_resolved: true,
  },
];

const scorers = [
  {
    id: 'scr-001',
    scorer_name: 'BTC Momentum',
    category: 'crypto',
    is_enabled: true,
    weight: 1.0,
    parameters: { threshold: 0.7, lookback_hours: 24 },
    created_at: now,
    updated_at: now,
  },
  {
    id: 'scr-002',
    scorer_name: 'News Sentiment',
    category: 'crypto',
    is_enabled: false,
    weight: 0.8,
    parameters: { min_articles: 3 },
    created_at: now,
    updated_at: now,
  },
];

const analyticsSummary = {
  total_trades: 100,
  winning_trades: 60,
  losing_trades: 40,
  win_rate: 0.6,
  total_pnl: 45.67,
  avg_pnl_per_trade: 0.46,
  best_trade_pnl: 25.0,
  worst_trade_pnl: -10.0,
  total_fees: 5.0,
  avg_hold_time_hours: 3.5,
  by_category: {
    crypto: { trades: 50, win_rate: 0.65, pnl: 30.0 },
    politics: { trades: 30, win_rate: 0.55, pnl: 10.0 },
    sports: { trades: 20, win_rate: 0.5, pnl: 5.67 },
  },
};

const alerts = [
  {
    id: 'alrt-001',
    title: 'High Volatility Detected',
    message: 'BTC volatility exceeds threshold',
    severity: 'warning',
    created_at: now,
    is_read: false,
    is_dismissed: false,
    alert_type: 'risk',
  },
];

const systemConfigs = [
  { key: 'trading_enabled', value: true, updated_at: now },
  { key: 'max_daily_trades', value: 20, updated_at: now },
];

const health = {
  status: 'ok',
  uptime: 3600,
  timestamp: now,
  environment: 'test',
  services: { db: 'ok', redis: 'ok' },
};

// ─── handlers ─────────────────────────────────────────────────────────────────

export const handlers = [
  http.get('/api/health', () => HttpResponse.json(health)),

  http.get('/api/bankroll', () => HttpResponse.json(bankroll)),
  http.get('/api/bankroll/history', () => HttpResponse.json(bankrollHistory)),

  http.get('/api/markets', () => HttpResponse.json(markets)),
  http.get('/api/markets/:id', ({ params }) =>
    HttpResponse.json(markets.find((m) => m.id === params.id) ?? markets[0])
  ),

  http.get('/api/decisions', () => HttpResponse.json(decisions)),
  http.get('/api/decisions/stats', () => HttpResponse.json(decisionStats)),
  http.get('/api/decisions/:id', ({ params }) =>
    HttpResponse.json(decisions.find((d) => d.id === params.id) ?? decisions[0])
  ),

  http.get('/api/orders', () => HttpResponse.json(orders)),
  http.get('/api/orders/:id', ({ params }) =>
    HttpResponse.json(orders.find((o) => o.id === params.id) ?? orders[0])
  ),

  http.get('/api/positions', () => HttpResponse.json(positions)),
  http.get('/api/positions/history', () => HttpResponse.json(positionHistory)),
  http.get('/api/positions/:id', ({ params }) =>
    HttpResponse.json(positions.find((p) => p.id === params.id) ?? positions[0])
  ),

  http.get('/api/risk/config', () => HttpResponse.json(riskConfig)),
  http.get('/api/risk/events', () => HttpResponse.json(riskEvents)),
  http.patch('/api/risk/kill-switch', () => HttpResponse.json({ kill_switch_enabled: false })),

  http.get('/api/scorers', () => HttpResponse.json(scorers)),
  http.get('/api/scorers/scores', () => HttpResponse.json([])),

  http.get('/api/analytics/summary', () => HttpResponse.json(analyticsSummary)),

  http.get('/api/alerts', () => HttpResponse.json(alerts)),
  http.get('/api/alerts/unread-count', () => HttpResponse.json({ count: 1 })),

  http.get('/api/system-config', () => HttpResponse.json(systemConfigs)),
];
