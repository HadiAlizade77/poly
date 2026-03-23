/**
 * PM2 ecosystem configuration for the Polymarket AI Trading Platform.
 * Run with: pm2 start ecosystem.config.js
 */
// eslint-disable-next-line no-undef
module.exports = {
  apps: [
    // ── Main API Server ────────────────────────────────────────────────────
    {
      name: 'api-server',
      script: './dist/server.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_development: {
        NODE_ENV: 'development',
        PORT: 3001,
      },
      env_production: {
        NODE_ENV: 'production',
        PORT: 3001,
      },
    },

    // ── Market Scanner ─────────────────────────────────────────────────────
    {
      name: 'market-scanner',
      script: './dist/processes/market-scanner.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env_development: {
        NODE_ENV: 'development',
        SCANNER_INTERVAL_MS: '60000',
        SCANNER_MAX_PAGES: '20',
      },
      env_production: {
        NODE_ENV: 'production',
        SCANNER_INTERVAL_MS: '60000',
        SCANNER_MAX_PAGES: '20',
      },
    },

    // ── Data Ingestion ─────────────────────────────────────────────────────
    {
      name: 'data-ingestion',
      script: './dist/processes/data-ingestion.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env_development: { NODE_ENV: 'development' },
      env_production:  { NODE_ENV: 'production' },
    },

    // ── Decision Engine ────────────────────────────────────────────────────
    {
      name: 'decision-engine',
      script: './dist/processes/decision-engine.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '512M',
      env_development: { NODE_ENV: 'development' },
      env_production:  { NODE_ENV: 'production' },
    },

    // ── Execution Manager ─────────────────────────────────────────────────
    {
      name: 'execution-manager',
      script: './dist/processes/execution-manager.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env_development: { NODE_ENV: 'development' },
      env_production:  { NODE_ENV: 'production' },
    },

    // ── AI Reviewer (pending review monitor) ──────────────────────────────
    {
      name: 'ai-reviewer',
      script: './dist/processes/ai-reviewer.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '128M',
      env_development: {
        NODE_ENV: 'development',
        AI_REVIEWER_INTERVAL_MS: '60000',
      },
      env_production: {
        NODE_ENV: 'production',
        AI_REVIEWER_INTERVAL_MS: '60000',
      },
    },

    // ── Scheduler (daily snapshots, pruning) ───────────────────────────────
    {
      name: 'scheduler',
      script: './dist/processes/scheduler.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '128M',
      env_development: { NODE_ENV: 'development' },
      env_production:  { NODE_ENV: 'production' },
    },

    // ── BTC 5-Min Bot ──────────────────────────────────────────────────────
    {
      name: 'btc-5min-bot',
      script: './dist/processes/btc-5min-bot.js',
      instances: 1,
      autorestart: true,
      watch: false,
      max_memory_restart: '256M',
      env_development: { NODE_ENV: 'development' },
      env_production:  { NODE_ENV: 'production' },
    },
  ],
};
