import {
  PrismaClient,
  MarketCategory,
  MarketStatus,
  DecisionAction,
  OrderSide,
  RiskScope,
} from '@prisma/client';

const prisma = new PrismaClient();

// ─── Helpers ─────────────────────────────────────────────────────────────────

function daysFromNow(n: number): Date {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d;
}

function hoursAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 60 * 1000);
}

function minutesAgo(n: number): Date {
  return new Date(Date.now() - n * 60 * 1000);
}

function todayDate(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('🌱 Seeding database...\n');

  await seedSystemConfig();
  await seedRiskConfig();
  const markets = await seedMarkets();
  await seedScorerConfigs();
  await seedBankroll();
  await seedBankrollHistory();
  await seedAiDecisions(markets);

  console.log('\n✅ Seeding complete.');
}

// ─── System Config ────────────────────────────────────────────────────────────

async function seedSystemConfig() {
  console.log('  → System config...');

  const configs = [
    // Keys explicitly required by spec
    {
      key: 'decision_cycle_interval_crypto',
      value: 60,
      description: 'How often (seconds) the decision engine runs for crypto markets',
    },
    {
      key: 'decision_cycle_interval_politics',
      value: 300,
      description: 'How often (seconds) the decision engine runs for politics markets',
    },
    {
      key: 'decision_cycle_interval_sports',
      value: 120,
      description: 'How often (seconds) the decision engine runs for sports markets',
    },
    {
      key: 'decision_cycle_interval_events',
      value: 300,
      description: 'How often (seconds) the decision engine runs for events markets',
    },
    {
      key: 'min_confidence_threshold',
      value: 0.6,
      description: 'Minimum AI confidence score required before a trade is considered',
    },
    {
      key: 'ai_model',
      value: 'claude-sonnet-4-20250514',
      description: 'Claude model used for AI decisions and reviews',
    },
    {
      key: 'ai_max_tokens_per_day',
      value: 2000000,
      description: 'Daily token budget across all AI calls (decisions + reviews)',
    },
    // Additional operational configs
    {
      key: 'ai_dashboard_format',
      value: {
        include_account_state: true,
        include_open_positions: true,
        include_trade_feedback: true,
        include_risk_budget: true,
        max_markets_per_category: 5,
        score_decimal_places: 1,
      },
      description: 'Text dashboard configuration passed to AI prompts',
    },
    {
      key: 'feedback_window_hours',
      value: 8,
      description: 'How far back intra-session trade feedback looks',
    },
    {
      key: 'exit_strategy_defaults',
      value: {
        crypto: 'stop_loss',
        politics: 'resolution_only',
        sports: 'resolution_only',
        events: 'resolution_only',
        entertainment: 'resolution_only',
        other: 'resolution_only',
      },
      description: 'Default exit strategy per category when a position is opened',
    },
    {
      key: 'market_scanner',
      value: {
        scan_interval_seconds: 300,
        max_markets_per_category: 50,
        min_liquidity: 500,
        exclude_resolving_within_hours: 1,
      },
      description: 'Market scanner configuration',
    },
    {
      key: 'execution',
      value: {
        order_timeout_seconds: 30,
        max_slippage_pct: 0.02,
        retry_on_partial_fill: true,
        cancel_on_timeout: true,
      },
      description: 'Order execution configuration',
    },
  ];

  for (const cfg of configs) {
    await prisma.systemConfig.upsert({
      where: { key: cfg.key },
      update: {},
      create: cfg,
    });
  }

  console.log(`     ${configs.length} system configs`);
}

// ─── Risk Config ──────────────────────────────────────────────────────────────

async function seedRiskConfig() {
  console.log('  → Risk config...');

  // Global defaults — dollar-absolute limits + percentage limits
  await prisma.riskConfig.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      scope: RiskScope.global,
      scope_value: null,
      parameters: {
        kill_switch_enabled: false,
        // Dollar-absolute limits
        max_daily_loss: 100,
        max_position_size: 50,
        max_total_exposure: 500,
        max_single_trade: 30,
        // Percentage limits
        max_daily_drawdown_pct: 0.10,
        max_total_exposure_pct: 0.50,
        max_position_size_pct: 0.05,
        max_single_trade_risk_pct: 0.03,
        // Operational limits
        max_consecutive_losses: 5,
        max_trades_per_hour: 20,
        cooldown_after_loss_streak_minutes: 30,
        // Quality filters
        min_edge_multiple: 1.2,
        min_liquidity: 1000,
        max_spread: 0.05,
        // Timing
        latency_threshold_ms: 3000,
        // AI budget
        max_ai_token_budget_per_hour: 200000,
        min_scorer_data_freshness_seconds: 120,
        max_position_hold_hours: 72,
      },
      updated_by: 'system',
    },
  });

  // Per-category overrides
  const categoryOverrides = [
    {
      id: '00000000-0000-0000-0000-000000000002',
      scope_value: 'crypto',
      parameters: {
        max_position_size: 40,
        max_single_trade: 20,
        max_spread: 0.03,
        min_liquidity: 2000,
        max_position_hold_hours: 24,
      },
    },
    {
      id: '00000000-0000-0000-0000-000000000003',
      scope_value: 'politics',
      parameters: {
        max_position_size: 60,
        max_single_trade: 35,
        max_spread: 0.08,
        min_liquidity: 500,
        max_position_hold_hours: 168,
      },
    },
    {
      id: '00000000-0000-0000-0000-000000000004',
      scope_value: 'sports',
      parameters: {
        max_position_size: 30,
        max_single_trade: 15,
        max_spread: 0.06,
        min_liquidity: 800,
        max_position_hold_hours: 48,
      },
    },
  ];

  for (const ovr of categoryOverrides) {
    await prisma.riskConfig.upsert({
      where: { id: ovr.id },
      update: {},
      create: {
        id: ovr.id,
        scope: RiskScope.category,
        scope_value: ovr.scope_value,
        parameters: ovr.parameters,
        updated_by: 'system',
      },
    });
  }

  console.log(`     4 risk configs (1 global + 3 category)`);
}

// ─── Markets ──────────────────────────────────────────────────────────────────

async function seedMarkets() {
  console.log('  → Markets...');

  const marketsData = [
    // ── Crypto ──
    {
      polymarket_id: 'btc-above-70k-eod',
      slug: 'btc-above-70k-end-of-day',
      title: 'Will BTC be above $70k at the end of day?',
      category: MarketCategory.crypto,
      subcategory: 'btc_price_targets',
      status: MarketStatus.active,
      resolution_source: 'Binance spot price',
      resolution_criteria: 'Resolves YES if BTC/USDT on Binance is above $70,000 at 23:59 UTC today.',
      outcomes: [
        { name: 'Yes', token_id: 'btc-70k-eod-yes' },
        { name: 'No', token_id: 'btc-70k-eod-no' },
      ],
      current_prices: { 'btc-70k-eod-yes': 0.41, 'btc-70k-eod-no': 0.59 },
      volume_24h: 182000.0,
      liquidity: 64000.0,
      end_date: daysFromNow(0),
      tags: ['btc', 'price-target', 'daily', 'crypto'],
      is_tradeable: true,
    },
    {
      polymarket_id: 'eth-above-4k-friday',
      slug: 'eth-above-4k-by-friday',
      title: 'Will ETH be above $4k by Friday?',
      category: MarketCategory.crypto,
      subcategory: 'eth_price_targets',
      status: MarketStatus.active,
      resolution_source: 'Binance spot price',
      resolution_criteria: 'Resolves YES if ETH/USDT on Binance closes above $4,000 at any point before Friday 23:59 UTC.',
      outcomes: [
        { name: 'Yes', token_id: 'eth-4k-fri-yes' },
        { name: 'No', token_id: 'eth-4k-fri-no' },
      ],
      current_prices: { 'eth-4k-fri-yes': 0.28, 'eth-4k-fri-no': 0.72 },
      volume_24h: 94500.0,
      liquidity: 31000.0,
      end_date: daysFromNow(4),
      tags: ['eth', 'price-target', 'weekly', 'crypto'],
      is_tradeable: true,
    },
    {
      polymarket_id: 'btc-15min-up-001',
      slug: 'btc-up-next-15min',
      title: 'Will BTC be higher in the next 15 minutes?',
      category: MarketCategory.crypto,
      subcategory: 'btc_15min',
      status: MarketStatus.active,
      resolution_criteria: 'Resolves YES if BTC/USDT on Binance is higher at the close of the next 15-minute candle than at the open.',
      outcomes: [
        { name: 'Yes', token_id: 'btc-15min-yes-001' },
        { name: 'No', token_id: 'btc-15min-no-001' },
      ],
      current_prices: { 'btc-15min-yes-001': 0.52, 'btc-15min-no-001': 0.48 },
      volume_24h: 45230.0,
      liquidity: 12800.0,
      end_date: daysFromNow(1),
      tags: ['btc', 'crypto', 'short-term', 'price'],
      is_tradeable: true,
    },
    {
      polymarket_id: 'eth-15min-up-001',
      slug: 'eth-up-next-15min',
      title: 'Will ETH be higher in the next 15 minutes?',
      category: MarketCategory.crypto,
      subcategory: 'eth_15min',
      status: MarketStatus.active,
      resolution_criteria: 'Resolves YES if ETH/USDT on Binance is higher at the close of the next 15-minute candle than at the open.',
      outcomes: [
        { name: 'Yes', token_id: 'eth-15min-yes-001' },
        { name: 'No', token_id: 'eth-15min-no-001' },
      ],
      current_prices: { 'eth-15min-yes-001': 0.49, 'eth-15min-no-001': 0.51 },
      volume_24h: 28100.0,
      liquidity: 8500.0,
      end_date: daysFromNow(1),
      tags: ['eth', 'crypto', 'short-term', 'price'],
      is_tradeable: true,
    },
    // ── Politics ──
    {
      polymarket_id: 'biden-2026-midterm-popular-vote',
      slug: 'biden-wins-2026-midterm-popular-vote',
      title: 'Will Biden win the 2026 midterm popular vote?',
      category: MarketCategory.politics,
      subcategory: 'us_elections',
      status: MarketStatus.active,
      resolution_source: 'Federal Election Commission',
      resolution_criteria: 'Resolves YES if the Democratic Party receives more total votes than the Republican Party in the 2026 US House of Representatives elections.',
      outcomes: [
        { name: 'Yes', token_id: 'biden-midterm-pop-yes' },
        { name: 'No', token_id: 'biden-midterm-pop-no' },
      ],
      current_prices: { 'biden-midterm-pop-yes': 0.47, 'biden-midterm-pop-no': 0.53 },
      volume_24h: 67800.0,
      liquidity: 28000.0,
      end_date: new Date('2026-11-04'),
      tags: ['biden', 'midterm', 'popular-vote', 'democrats'],
      is_tradeable: true,
    },
    {
      polymarket_id: 'republicans-win-senate-2026',
      slug: 'republicans-win-senate-2026',
      title: 'Will Republicans win the Senate in 2026?',
      category: MarketCategory.politics,
      subcategory: 'us_elections',
      status: MarketStatus.active,
      resolution_source: 'Associated Press election results',
      resolution_criteria: 'Resolves YES if Republicans hold or gain a majority in the US Senate after the 2026 midterm elections.',
      outcomes: [
        { name: 'Yes', token_id: 'gop-senate-2026-yes' },
        { name: 'No', token_id: 'gop-senate-2026-no' },
      ],
      current_prices: { 'gop-senate-2026-yes': 0.62, 'gop-senate-2026-no': 0.38 },
      volume_24h: 112400.0,
      liquidity: 47000.0,
      end_date: new Date('2026-11-04'),
      tags: ['republicans', 'senate', 'midterm', 'congress'],
      is_tradeable: true,
    },
    {
      polymarket_id: 'trump-approval-above-45',
      slug: 'trump-approval-above-45pct',
      title: 'Will Trump\'s approval rating be above 45% by end of Q2 2026?',
      category: MarketCategory.politics,
      subcategory: 'us_politics',
      status: MarketStatus.active,
      resolution_source: 'RealClearPolitics average',
      resolution_criteria: 'Resolves YES if the RealClearPolitics average approval rating for Donald Trump is above 45.0% on June 30, 2026.',
      outcomes: [
        { name: 'Yes', token_id: 'trump-approval-45-yes' },
        { name: 'No', token_id: 'trump-approval-45-no' },
      ],
      current_prices: { 'trump-approval-45-yes': 0.33, 'trump-approval-45-no': 0.67 },
      volume_24h: 48300.0,
      liquidity: 19500.0,
      end_date: new Date('2026-06-30'),
      tags: ['trump', 'approval', 'polling', 'us-politics'],
      is_tradeable: true,
    },
    // ── Sports ──
    {
      polymarket_id: 'lakers-win-nba-championship-2026',
      slug: 'lakers-win-nba-championship-2026',
      title: 'Will the Lakers win the 2026 NBA Championship?',
      category: MarketCategory.sports,
      subcategory: 'nba',
      status: MarketStatus.active,
      resolution_source: 'NBA official results',
      resolution_criteria: 'Resolves YES if the Los Angeles Lakers win the 2026 NBA Championship.',
      outcomes: [
        { name: 'Yes', token_id: 'lakers-nba-2026-yes' },
        { name: 'No', token_id: 'lakers-nba-2026-no' },
      ],
      current_prices: { 'lakers-nba-2026-yes': 0.14, 'lakers-nba-2026-no': 0.86 },
      volume_24h: 29800.0,
      liquidity: 12400.0,
      end_date: new Date('2026-06-30'),
      tags: ['lakers', 'nba', 'basketball', 'championship'],
      is_tradeable: true,
    },
    {
      polymarket_id: 'chiefs-win-super-bowl-lix',
      slug: 'chiefs-win-super-bowl-lix',
      title: 'Will the Chiefs win Super Bowl LIX?',
      category: MarketCategory.sports,
      subcategory: 'nfl',
      status: MarketStatus.active,
      resolution_source: 'NFL official results',
      resolution_criteria: 'Resolves YES if the Kansas City Chiefs win Super Bowl LIX.',
      outcomes: [
        { name: 'Yes', token_id: 'chiefs-sb-lix-yes' },
        { name: 'No', token_id: 'chiefs-sb-lix-no' },
      ],
      current_prices: { 'chiefs-sb-lix-yes': 0.19, 'chiefs-sb-lix-no': 0.81 },
      volume_24h: 56700.0,
      liquidity: 24000.0,
      end_date: new Date('2026-02-08'),
      tags: ['chiefs', 'super-bowl', 'nfl', 'football'],
      is_tradeable: true,
    },
    // ── Events ──
    {
      polymarket_id: 'fed-cuts-rates-june-2026',
      slug: 'fed-cuts-rates-june-2026',
      title: 'Will the Fed cut rates in June 2026?',
      category: MarketCategory.events,
      subcategory: 'us_monetary_policy',
      status: MarketStatus.active,
      resolution_source: 'Federal Reserve official statement',
      resolution_criteria: 'Resolves YES if the Federal Reserve announces a rate cut at its June 2026 FOMC meeting.',
      outcomes: [
        { name: 'Yes', token_id: 'fed-june-cut-yes' },
        { name: 'No', token_id: 'fed-june-cut-no' },
      ],
      current_prices: { 'fed-june-cut-yes': 0.34, 'fed-june-cut-no': 0.66 },
      volume_24h: 98400.0,
      liquidity: 41000.0,
      end_date: new Date('2026-06-18'),
      tags: ['fed', 'rates', 'monetary-policy', 'fomc'],
      is_tradeable: true,
    },
    {
      polymarket_id: 'spacex-starship-orbit-july-2026',
      slug: 'spacex-starship-orbit-july-2026',
      title: 'Will SpaceX Starship reach orbit by July 2026?',
      category: MarketCategory.events,
      subcategory: 'space',
      status: MarketStatus.active,
      resolution_source: 'SpaceX official announcement + FAA records',
      resolution_criteria: 'Resolves YES if SpaceX Starship completes at least one full orbit of Earth before August 1, 2026.',
      outcomes: [
        { name: 'Yes', token_id: 'starship-orbit-jul-yes' },
        { name: 'No', token_id: 'starship-orbit-jul-no' },
      ],
      current_prices: { 'starship-orbit-jul-yes': 0.71, 'starship-orbit-jul-no': 0.29 },
      volume_24h: 38200.0,
      liquidity: 16500.0,
      end_date: new Date('2026-07-31'),
      tags: ['spacex', 'starship', 'space', 'orbit'],
      is_tradeable: true,
    },
  ];

  const created: Record<string, string> = {};

  for (const data of marketsData) {
    const { outcomes, current_prices, tags, ...rest } = data;
    const market = await prisma.market.upsert({
      where: { polymarket_id: data.polymarket_id },
      update: {},
      create: {
        ...rest,
        outcomes: outcomes as object[],
        current_prices: current_prices as object,
        tags,
      },
    });
    created[data.polymarket_id] = market.id;
  }

  console.log(`     ${marketsData.length} markets (4 crypto, 3 politics, 2 sports, 2 events)`);
  return created;
}

// ─── Scorer Configs ───────────────────────────────────────────────────────────

async function seedScorerConfigs() {
  console.log('  → Scorer configs...');

  const configs = [
    // ── Crypto (8) ──
    {
      category: 'crypto',
      scorer_name: 'exchange_divergence',
      description: 'Price divergence between Binance spot and Polymarket implied price',
      is_enabled: true,
      parameters: {
        exchange_source: 'binance',
        comparison_window_seconds: 60,
        strong_divergence_threshold: 60,
        moderate_divergence_threshold: 30,
        ema_period: 9,
        weight_in_dashboard: 1.0,
      },
    },
    {
      category: 'crypto',
      scorer_name: 'momentum',
      description: 'RSI + EMA-based momentum scoring for the underlying asset',
      is_enabled: true,
      parameters: {
        rsi_period: 14,
        rsi_overbought: 70,
        rsi_oversold: 30,
        ema_fast: 9,
        ema_slow: 21,
        candle_timeframe: '5m',
        lookback_candles: 50,
        weight_in_dashboard: 1.0,
      },
    },
    {
      category: 'crypto',
      scorer_name: 'mean_reversion',
      description: 'Bollinger Band mean reversion signal',
      is_enabled: true,
      parameters: {
        bb_period: 20,
        bb_std_dev: 2.0,
        strong_reversion_threshold: 0.9,
        moderate_reversion_threshold: 0.7,
        candle_timeframe: '5m',
        weight_in_dashboard: 0.8,
      },
    },
    {
      category: 'crypto',
      scorer_name: 'volatility',
      description: 'ATR-based volatility regime scoring',
      is_enabled: true,
      parameters: {
        atr_period: 14,
        high_volatility_multiplier: 1.5,
        low_volatility_multiplier: 0.5,
        candle_timeframe: '15m',
        weight_in_dashboard: 0.7,
      },
    },
    {
      category: 'crypto',
      scorer_name: 'volume',
      description: 'Relative volume compared to session average',
      is_enabled: true,
      parameters: {
        lookback_periods: 20,
        high_volume_threshold: 1.5,
        low_volume_threshold: 0.5,
        candle_timeframe: '5m',
        weight_in_dashboard: 0.6,
      },
    },
    {
      category: 'crypto',
      scorer_name: 'liquidity_quality',
      description: 'Order book depth and spread quality assessment',
      is_enabled: true,
      parameters: {
        min_depth_usd: 2000,
        good_spread_threshold: 0.02,
        poor_spread_threshold: 0.05,
        depth_levels: 5,
        weight_in_dashboard: 0.9,
      },
    },
    {
      category: 'crypto',
      scorer_name: 'exhaustion',
      description: 'Liquidation spike and volume exhaustion signal detection',
      is_enabled: true,
      parameters: {
        liquidation_spike_threshold: 2.0,
        volume_exhaustion_ratio: 3.0,
        lookback_minutes: 30,
        weight_in_dashboard: 0.8,
      },
    },
    {
      category: 'crypto',
      scorer_name: 'time_pressure',
      description: 'Time-to-resolution pressure scoring (affects sizing)',
      is_enabled: true,
      parameters: {
        high_pressure_minutes: 10,
        moderate_pressure_minutes: 30,
        low_pressure_minutes: 60,
        weight_in_dashboard: 0.5,
      },
    },
    // ── Politics (6) ──
    {
      category: 'politics',
      scorer_name: 'poll_divergence',
      description: 'Divergence between poll-implied probability and Polymarket price',
      is_enabled: true,
      parameters: {
        poll_sources: ['fivethirtyeight', 'realclearpolling'],
        strong_divergence_threshold: 0.10,
        moderate_divergence_threshold: 0.05,
        poll_recency_weight_days: 7,
        weight_in_dashboard: 1.2,
      },
    },
    {
      category: 'politics',
      scorer_name: 'sentiment_shift',
      description: 'News sentiment and social media momentum scoring',
      is_enabled: true,
      parameters: {
        news_sources: ['newsapi', 'reddit'],
        sentiment_window_hours: 24,
        significant_shift_threshold: 0.3,
        weight_in_dashboard: 0.7,
      },
    },
    {
      category: 'politics',
      scorer_name: 'historical_base_rate',
      description: 'Base rate from comparable historical events',
      is_enabled: true,
      parameters: {
        similarity_threshold: 0.7,
        min_sample_size: 10,
        recency_weight_years: 10,
        weight_in_dashboard: 0.8,
      },
    },
    {
      category: 'politics',
      scorer_name: 'resolution_risk',
      description: 'Ambiguity and resolution risk assessment',
      is_enabled: true,
      parameters: {
        ambiguity_keywords: ['unclear', 'contested', 'disputed'],
        high_risk_threshold: 0.3,
        weight_in_dashboard: 0.9,
      },
    },
    {
      category: 'politics',
      scorer_name: 'crowd_bias',
      description: 'Recency bias and crowd overreaction detection',
      is_enabled: true,
      parameters: {
        bias_detection_window_hours: 48,
        overreaction_threshold: 0.15,
        weight_in_dashboard: 0.6,
      },
    },
    {
      category: 'politics',
      scorer_name: 'liquidity_quality',
      description: 'Spread and depth assessment for politics markets',
      is_enabled: true,
      parameters: {
        min_depth_usd: 500,
        good_spread_threshold: 0.04,
        poor_spread_threshold: 0.10,
        weight_in_dashboard: 0.8,
      },
    },
  ];

  for (const cfg of configs) {
    await prisma.scorerConfig.upsert({
      where: { category_scorer_name: { category: cfg.category, scorer_name: cfg.scorer_name } },
      update: {},
      create: cfg,
    });
  }

  console.log(`     ${configs.length} scorer configs (8 crypto + 6 politics)`);
}

// ─── Bankroll ─────────────────────────────────────────────────────────────────

async function seedBankroll() {
  console.log('  → Bankroll...');

  const existing = await prisma.bankroll.findFirst();
  if (!existing) {
    await prisma.bankroll.create({
      data: {
        total_balance: 1000.0,
        previous_balance: 1000.0,
        reserved_balance: 50.0,
        active_balance: 950.0,
        deployed_balance: 0.0,
        unrealized_pnl: 0.0,
        balance_delta_today: 0.0,
        balance_delta_total: 0.0,
        initial_deposit: 1000.0,
      },
    });
    console.log(`     Bankroll created (initial_deposit: $1,000)`);
  } else {
    console.log(`     Bankroll already exists, skipping`);
  }
}

// ─── Bankroll History ─────────────────────────────────────────────────────────

async function seedBankrollHistory() {
  console.log('  → Bankroll history...');

  const today = todayDate();
  await prisma.bankrollHistory.upsert({
    where: { date: today },
    update: {},
    create: {
      date: today,
      opening_balance: 1000.0,
      closing_balance: 1000.0,
      deposits: 1000.0,
      withdrawals: 0.0,
      trading_pnl: 0.0,
      fees_total: 0.0,
      trades_count: 0,
      win_rate: null,
    },
  });

  console.log(`     1 bankroll history entry (today)`);
}

// ─── AI Decisions ─────────────────────────────────────────────────────────────

async function seedAiDecisions(markets: Record<string, string>) {
  console.log('  → AI decisions...');

  const btcMarketId = markets['btc-15min-up-001'];
  const ethMarketId = markets['eth-15min-up-001'];
  const fedMarketId = markets['fed-cuts-rates-june-2026'];
  const btc70kMarketId = markets['btc-above-70k-eod'];

  const decisionsData = [
    // 1: BTC 15min — executed trade (won)
    {
      market_id: btcMarketId,
      category: 'crypto',
      timestamp: hoursAgo(3),
      cycle_number: 1,
      dashboard_text: `=== MARKET CONTEXT DASHBOARD ===
Market: Will BTC be higher in the next 15 minutes?
Category: CRYPTO | Cycle: 1 | ${hoursAgo(3).toISOString()}

ACCOUNT STATE
  Balance: $1,000.00 | Deployed: $0.00 | Available: $1,000.00
  Open Positions: 0 | Daily P&L: $0.00

CONTEXT SCORES
  Exchange Divergence:  +62  [STRONG_DIV_UP]   Binance +1.1% vs Polymarket implied
  Momentum:             +71  [STRONG_BULL]      RSI 68, EMA9 > EMA21, accelerating
  Mean Reversion:       +18  [LOW]              Price 55% of BB width
  Volatility:           +52  [NORMAL]           ATR ratio 1.05
  Volume:               +78  [ABOVE_AVG]        2.1x session average
  Liquidity Quality:    +84  [GOOD]             Spread 1.8%, depth $14k
  Exhaustion:           +12  [NONE]             No spike detected
  Time Pressure:        +35  [MODERATE]         8 min to resolution

TRADE FEEDBACK: No trades today yet.`,
      account_state: { balance: 1000.0, deployed: 0.0, open_positions: 0, daily_pnl: 0.0 },
      trade_feedback: null,
      action: DecisionAction.trade,
      direction: 'buy_yes',
      outcome_token: 'btc-15min-yes-001',
      confidence: 0.73,
      size_hint: 0.4,
      estimated_edge: 0.048,
      estimated_cost: 0.003,
      fair_value: 0.57,
      market_price: 0.52,
      reasoning: 'Strong exchange divergence (+62) with bullish momentum (+71) and elevated volume (+78). Binance up 1.1% while Polymarket not yet repriced — fair value ~0.57 vs 0.52 market gives 5% gross edge. Liquidity is good, no exhaustion. Taking 40% of normal size given moderate time pressure.',
      regime_assessment: 'trending',
      regime_confidence: 0.71,
      was_executed: true,
      veto_reason: null,
      model_used: 'claude-sonnet-4-20250514',
      latency_ms: 1240,
      tokens_used: 1180,
      prompt_version: 'v2.0.0',
    },
    // 2: ETH 15min — hold (insufficient edge)
    {
      market_id: ethMarketId,
      category: 'crypto',
      timestamp: hoursAgo(2),
      cycle_number: 1,
      dashboard_text: `=== MARKET CONTEXT DASHBOARD ===
Market: Will ETH be higher in the next 15 minutes?
Category: CRYPTO | Cycle: 1 | ${hoursAgo(2).toISOString()}

ACCOUNT STATE
  Balance: $1,000.00 | Deployed: $19.60 | Available: $980.40
  Open Positions: 1 | Daily P&L: $0.00

CONTEXT SCORES
  Exchange Divergence:  -8   [NEGLIGIBLE]       Only 0.1% divergence
  Momentum:             +22  [MILD_BULL]         RSI 51, weak trend
  Mean Reversion:       +45  [MODERATE]          Midband bounce possible
  Volatility:           +38  [BELOW_AVG]         Low ATR, choppy
  Volume:               +31  [BELOW_AVG]         0.7x session average
  Liquidity Quality:    +67  [DECENT]            Spread 2.4%
  Exhaustion:           +5   [NONE]
  Time Pressure:        +20  [LOW]               12 min to resolution

TRADE FEEDBACK: 0 trades today.`,
      account_state: { balance: 1000.0, deployed: 19.6, open_positions: 1, daily_pnl: 0.0 },
      trade_feedback: null,
      action: DecisionAction.hold,
      direction: null,
      outcome_token: null,
      confidence: 0.55,
      size_hint: null,
      estimated_edge: 0.008,
      estimated_cost: 0.003,
      fair_value: 0.50,
      market_price: 0.49,
      reasoning: 'Negligible exchange divergence (-8), weak momentum (+22), below-average volume. Fair value ~0.50 vs 0.49 market — less than 1% gross edge after fees. No compelling signal. Passing.',
      regime_assessment: 'quiet',
      regime_confidence: 0.68,
      was_executed: false,
      veto_reason: null,
      model_used: 'claude-sonnet-4-20250514',
      latency_ms: 1090,
      tokens_used: 1050,
      prompt_version: 'v2.0.0',
    },
    // 3: Fed June cut — trade vetoed by risk governor
    {
      market_id: fedMarketId,
      category: 'events',
      timestamp: hoursAgo(1),
      cycle_number: 1,
      dashboard_text: `=== MARKET CONTEXT DASHBOARD ===
Market: Will the Fed cut rates in June 2026?
Category: EVENTS | Cycle: 1 | ${hoursAgo(1).toISOString()}

ACCOUNT STATE
  Balance: $1,000.00 | Deployed: $480.00 | Available: $520.00

CONTEXT SCORES
  Poll Divergence:      +58  [MODERATE_MISPRICE]  Futures imply 38%, market at 34%
  Sentiment Shift:      +40  [POSITIVE]           3 dovish Fed speeches today
  Historical Base Rate: +55  [MODERATE]           38% of similar setups cut in June
  Resolution Risk:      +80  [LOW_RISK]           Clear FOMC resolution criteria
  Crowd Bias:           +30  [MILD_RECENCY_BIAS]  Overweighted last hawkish meeting
  Time to Resolution:   +40  [MEDIUM_TERM]        86 days away
  Liquidity Quality:    +88  [EXCELLENT]          Spread 1.2%, $41k depth

TRADE FEEDBACK: 1 win today (+$19.60).`,
      account_state: { balance: 1000.0, deployed: 480.0, open_positions: 3, daily_pnl: 19.6 },
      trade_feedback: {
        trades_today: 1, wins: 1, losses: 0, net_pnl: 19.6, streak: 'W1',
        patterns_detected: [], directional_bias: 'long_bias',
        avg_confidence_on_wins: 0.73, avg_confidence_on_losses: null,
        recent_trades: [{ market: 'BTC 15min UP', direction: 'buy_yes', result: 'win', pnl: 19.6, minutes_ago: 120 }],
      },
      action: DecisionAction.trade,
      direction: 'buy_yes',
      outcome_token: 'fed-june-cut-yes',
      confidence: 0.67,
      size_hint: 0.5,
      estimated_edge: 0.041,
      estimated_cost: 0.005,
      fair_value: 0.38,
      market_price: 0.34,
      reasoning: 'Futures pricing 38% vs Polymarket 34% — 4% divergence with favorable sentiment from dovish Fed speeches. Historical base rate supports ~38%. Excellent liquidity. Recommending moderate long YES.',
      regime_assessment: 'quiet',
      regime_confidence: 0.74,
      was_executed: false,
      veto_reason: 'Max total exposure reached: $480 deployed exceeds $450 limit (90% of $500 cap)',
      model_used: 'claude-sonnet-4-20250514',
      latency_ms: 1380,
      tokens_used: 1290,
      prompt_version: 'v2.0.0',
    },
    // 4: BTC 70k EOD — hold (low confidence)
    {
      market_id: btc70kMarketId,
      category: 'crypto',
      timestamp: minutesAgo(30),
      cycle_number: 1,
      dashboard_text: `=== MARKET CONTEXT DASHBOARD ===
Market: Will BTC be above $70k at end of day?
Category: CRYPTO | Cycle: 1 | ${minutesAgo(30).toISOString()}

ACCOUNT STATE
  Balance: $1,019.60 | Deployed: $0.00 | Available: $1,019.60

CONTEXT SCORES
  Exchange Divergence:  +22  [MILD_DIV_UP]    Binance +0.4% premium
  Momentum:             +41  [MILD_BULL]       RSI 55, moderate trend
  Mean Reversion:       +35  [LOW-MODERATE]
  Volatility:           +70  [ELEVATED]        ATR expanding, range widening
  Volume:               +55  [AVERAGE]         Normal session volume
  Liquidity Quality:    +90  [EXCELLENT]       Spread 0.9%, depth $64k
  Exhaustion:           +20  [MILD]            Some profit-taking detected
  Time Pressure:        +15  [LOW]             ~8 hours to resolution

TRADE FEEDBACK: 1 win today (+$19.60). No losses.`,
      account_state: { balance: 1019.6, deployed: 0.0, open_positions: 0, daily_pnl: 19.6 },
      trade_feedback: {
        trades_today: 1, wins: 1, losses: 0, net_pnl: 19.6, streak: 'W1',
        patterns_detected: [], directional_bias: null,
        avg_confidence_on_wins: 0.73, avg_confidence_on_losses: null,
        recent_trades: [{ market: 'BTC 15min UP', direction: 'buy_yes', result: 'win', pnl: 19.6, minutes_ago: 150 }],
      },
      action: DecisionAction.hold,
      direction: null,
      outcome_token: null,
      confidence: 0.58,
      size_hint: null,
      estimated_edge: 0.021,
      estimated_cost: 0.004,
      fair_value: 0.43,
      market_price: 0.41,
      reasoning: 'BTC showing mild bullish divergence but elevated volatility makes outcome uncertain. Market at 0.41 vs fair value estimate 0.43 — only 2% gross edge. Elevated ATR means BTC could swing either way in 8 hours. Confidence 0.58 is below 0.60 threshold. Holding.',
      regime_assessment: 'volatile',
      regime_confidence: 0.65,
      was_executed: false,
      veto_reason: null,
      model_used: 'claude-sonnet-4-20250514',
      latency_ms: 1320,
      tokens_used: 1240,
      prompt_version: 'v2.0.0',
    },
  ];

  for (const data of decisionsData) {
    await prisma.aiDecision.create({ data });
  }

  console.log(`     ${decisionsData.length} AI decisions (1 executed, 2 holds, 1 vetoed)`);
}

// ─── Run ─────────────────────────────────────────────────────────────────────

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
