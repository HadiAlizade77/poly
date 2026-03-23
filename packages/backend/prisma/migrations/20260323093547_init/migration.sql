-- CreateEnum
CREATE TYPE "MarketCategory" AS ENUM ('crypto', 'politics', 'sports', 'events', 'entertainment', 'other');

-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('active', 'closed', 'resolved', 'paused', 'excluded');

-- CreateEnum
CREATE TYPE "DecisionAction" AS ENUM ('trade', 'hold');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('buy', 'sell');

-- CreateEnum
CREATE TYPE "OrderType" AS ENUM ('limit', 'market');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('pending', 'open', 'partial', 'filled', 'cancelled', 'failed', 'expired');

-- CreateEnum
CREATE TYPE "MakerTaker" AS ENUM ('maker', 'taker', 'mixed');

-- CreateEnum
CREATE TYPE "PositionSide" AS ENUM ('long', 'short');

-- CreateEnum
CREATE TYPE "ExitStrategy" AS ENUM ('resolution_only', 'stop_loss', 'time_based', 'manual');

-- CreateEnum
CREATE TYPE "CloseReason" AS ENUM ('resolution', 'stop_loss', 'time_exit', 'manual', 'risk_veto');

-- CreateEnum
CREATE TYPE "RiskEventType" AS ENUM ('trade_vetoed', 'size_reduced', 'category_paused', 'global_stop', 'drawdown_limit', 'exposure_limit', 'liquidity_warning', 'latency_warning', 'anomaly_detected');

-- CreateEnum
CREATE TYPE "Severity" AS ENUM ('info', 'warning', 'critical');

-- CreateEnum
CREATE TYPE "AlertType" AS ENUM ('trade', 'risk', 'system', 'ai', 'performance', 'opportunity');

-- CreateEnum
CREATE TYPE "AlertSeverity" AS ENUM ('info', 'warning', 'error', 'critical');

-- CreateEnum
CREATE TYPE "ReviewType" AS ENUM ('daily', 'weekly', 'strategy_audit', 'drift_detection', 'threshold_recommendation', 'anomaly_report', 'scorer_calibration');

-- CreateEnum
CREATE TYPE "RiskScope" AS ENUM ('global', 'category', 'strategy', 'market');

-- CreateTable
CREATE TABLE "markets" (
    "id" UUID NOT NULL,
    "polymarket_id" TEXT NOT NULL,
    "slug" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "category" "MarketCategory" NOT NULL,
    "subcategory" TEXT,
    "status" "MarketStatus" NOT NULL DEFAULT 'active',
    "resolution_source" TEXT,
    "resolution_criteria" TEXT,
    "outcomes" JSONB NOT NULL,
    "current_prices" JSONB,
    "volume_24h" DECIMAL(20,4),
    "liquidity" DECIMAL(20,4),
    "end_date" TIMESTAMPTZ,
    "resolved_outcome" TEXT,
    "tags" TEXT[],
    "metadata" JSONB,
    "is_tradeable" BOOLEAN NOT NULL DEFAULT true,
    "exclusion_reason" TEXT,
    "first_seen_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "markets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "market_snapshots" (
    "id" BIGSERIAL NOT NULL,
    "market_id" UUID NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "prices" JSONB NOT NULL,
    "spread" DECIMAL(10,6),
    "volume_1h" DECIMAL(20,4),
    "liquidity" DECIMAL(20,4),
    "order_book_depth" JSONB,
    "metadata" JSONB,

    CONSTRAINT "market_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "external_data_points" (
    "id" BIGSERIAL NOT NULL,
    "source" TEXT NOT NULL,
    "data_type" TEXT NOT NULL,
    "symbol" TEXT,
    "timestamp" TIMESTAMPTZ NOT NULL,
    "value" JSONB NOT NULL,
    "metadata" JSONB,

    CONSTRAINT "external_data_points_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "context_scores" (
    "id" BIGSERIAL NOT NULL,
    "market_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "scores" JSONB NOT NULL,
    "raw_indicators" JSONB,
    "dashboard_text" TEXT,

    CONSTRAINT "context_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scorer_configs" (
    "id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "scorer_name" TEXT NOT NULL,
    "description" TEXT,
    "is_enabled" BOOLEAN NOT NULL DEFAULT true,
    "parameters" JSONB NOT NULL,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "scorer_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_decisions" (
    "id" BIGSERIAL NOT NULL,
    "market_id" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "cycle_number" INTEGER,
    "dashboard_text" TEXT NOT NULL,
    "account_state" JSONB NOT NULL,
    "trade_feedback" JSONB,
    "action" "DecisionAction" NOT NULL,
    "direction" TEXT,
    "outcome_token" TEXT,
    "confidence" DECIMAL(5,4) NOT NULL,
    "size_hint" DECIMAL(5,4),
    "estimated_edge" DECIMAL(8,6),
    "estimated_cost" DECIMAL(8,6),
    "fair_value" DECIMAL(8,6),
    "market_price" DECIMAL(8,6),
    "reasoning" TEXT NOT NULL,
    "regime_assessment" TEXT,
    "regime_confidence" DECIMAL(5,4),
    "was_executed" BOOLEAN NOT NULL DEFAULT false,
    "veto_reason" TEXT,
    "order_id" UUID,
    "model_used" TEXT NOT NULL DEFAULT 'claude-sonnet-4-20250514',
    "latency_ms" INTEGER,
    "tokens_used" INTEGER,
    "prompt_version" TEXT,

    CONSTRAINT "ai_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trade_feedback" (
    "id" BIGSERIAL NOT NULL,
    "category" TEXT NOT NULL,
    "session_date" DATE NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "feedback_summary" JSONB NOT NULL,
    "feedback_text" TEXT NOT NULL,

    CONSTRAINT "trade_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orders" (
    "id" UUID NOT NULL,
    "decision_id" BIGINT,
    "market_id" UUID NOT NULL,
    "polymarket_order_id" TEXT,
    "side" "OrderSide" NOT NULL,
    "outcome_token" TEXT NOT NULL,
    "order_type" "OrderType" NOT NULL,
    "price" DECIMAL(10,6) NOT NULL,
    "size" DECIMAL(20,6) NOT NULL,
    "filled_size" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "avg_fill_price" DECIMAL(10,6),
    "status" "OrderStatus" NOT NULL DEFAULT 'pending',
    "maker_or_taker" "MakerTaker",
    "fees_paid" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "placement_latency_ms" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "filled_at" TIMESTAMPTZ,
    "cancelled_at" TIMESTAMPTZ,

    CONSTRAINT "orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "trades" (
    "id" UUID NOT NULL,
    "order_id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "decision_id" BIGINT,
    "side" "OrderSide" NOT NULL,
    "outcome_token" TEXT NOT NULL,
    "size" DECIMAL(20,6) NOT NULL,
    "entry_price" DECIMAL(10,6) NOT NULL,
    "fees" DECIMAL(20,6) NOT NULL,
    "net_cost" DECIMAL(20,6) NOT NULL,
    "regime_at_entry" TEXT,
    "confidence_at_entry" DECIMAL(5,4),
    "edge_at_entry" DECIMAL(8,6),
    "executed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "trades_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "positions" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "outcome_token" TEXT NOT NULL,
    "side" "PositionSide" NOT NULL,
    "size" DECIMAL(20,6) NOT NULL,
    "avg_entry_price" DECIMAL(10,6) NOT NULL,
    "current_price" DECIMAL(10,6),
    "unrealized_pnl" DECIMAL(20,6),
    "realized_pnl" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "total_fees" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "decision_id" BIGINT,
    "exit_strategy" "ExitStrategy" NOT NULL DEFAULT 'resolution_only',
    "stop_loss_price" DECIMAL(10,6),
    "time_exit_at" TIMESTAMPTZ,
    "opened_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "positions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "position_history" (
    "id" UUID NOT NULL,
    "market_id" UUID NOT NULL,
    "outcome_token" TEXT NOT NULL,
    "side" "PositionSide" NOT NULL,
    "size" DECIMAL(20,6) NOT NULL,
    "avg_entry_price" DECIMAL(10,6) NOT NULL,
    "avg_exit_price" DECIMAL(10,6),
    "realized_pnl" DECIMAL(20,6) NOT NULL,
    "total_fees" DECIMAL(20,6) NOT NULL,
    "decision_id" BIGINT,
    "regime_at_entry" TEXT,
    "regime_at_exit" TEXT,
    "resolution_outcome" TEXT,
    "opened_at" TIMESTAMPTZ NOT NULL,
    "closed_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "close_reason" "CloseReason" NOT NULL,

    CONSTRAINT "position_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_reviews" (
    "id" BIGSERIAL NOT NULL,
    "review_type" "ReviewType" NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "period_start" TIMESTAMPTZ,
    "period_end" TIMESTAMPTZ,
    "category" TEXT,
    "findings" JSONB,
    "recommendations" JSONB,
    "reasoning" TEXT,
    "was_applied" BOOLEAN NOT NULL DEFAULT false,
    "applied_at" TIMESTAMPTZ,
    "applied_by" TEXT,

    CONSTRAINT "ai_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_events" (
    "id" BIGSERIAL NOT NULL,
    "event_type" "RiskEventType" NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "severity" "Severity" NOT NULL,
    "decision_id" BIGINT,
    "market_id" UUID,
    "details" JSONB NOT NULL,
    "message" TEXT NOT NULL,
    "auto_resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_at" TIMESTAMPTZ,

    CONSTRAINT "risk_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alerts" (
    "id" BIGSERIAL NOT NULL,
    "alert_type" "AlertType" NOT NULL,
    "severity" "AlertSeverity" NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB,
    "is_read" BOOLEAN NOT NULL DEFAULT false,
    "is_dismissed" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ,

    CONSTRAINT "alerts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankroll" (
    "id" UUID NOT NULL,
    "total_balance" DECIMAL(20,6) NOT NULL,
    "previous_balance" DECIMAL(20,6) NOT NULL,
    "reserved_balance" DECIMAL(20,6) NOT NULL,
    "active_balance" DECIMAL(20,6) NOT NULL,
    "deployed_balance" DECIMAL(20,6) NOT NULL,
    "unrealized_pnl" DECIMAL(20,6) NOT NULL,
    "balance_delta_today" DECIMAL(20,6) NOT NULL,
    "balance_delta_total" DECIMAL(20,6) NOT NULL,
    "initial_deposit" DECIMAL(20,6) NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "bankroll_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bankroll_history" (
    "id" BIGSERIAL NOT NULL,
    "date" DATE NOT NULL,
    "opening_balance" DECIMAL(20,6) NOT NULL,
    "closing_balance" DECIMAL(20,6) NOT NULL,
    "deposits" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "withdrawals" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "trading_pnl" DECIMAL(20,6) NOT NULL,
    "fees_total" DECIMAL(20,6) NOT NULL DEFAULT 0,
    "trades_count" INTEGER NOT NULL DEFAULT 0,
    "win_rate" DECIMAL(5,4),

    CONSTRAINT "bankroll_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "risk_config" (
    "id" UUID NOT NULL,
    "scope" "RiskScope" NOT NULL,
    "scope_value" TEXT,
    "parameters" JSONB NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL,
    "updated_by" TEXT,

    CONSTRAINT "risk_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_config" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "description" TEXT,
    "updated_at" TIMESTAMPTZ NOT NULL,

    CONSTRAINT "system_config_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "id" BIGSERIAL NOT NULL,
    "timestamp" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "action" TEXT NOT NULL,
    "entity_type" TEXT NOT NULL,
    "entity_id" TEXT,
    "changes" JSONB,
    "performed_by" TEXT,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "markets_polymarket_id_key" ON "markets"("polymarket_id");

-- CreateIndex
CREATE INDEX "markets_category_status_idx" ON "markets"("category", "status");

-- CreateIndex
CREATE INDEX "market_snapshots_market_id_timestamp_idx" ON "market_snapshots"("market_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "external_data_points_source_data_type_timestamp_idx" ON "external_data_points"("source", "data_type", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "external_data_points_symbol_timestamp_idx" ON "external_data_points"("symbol", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "context_scores_market_id_timestamp_idx" ON "context_scores"("market_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "context_scores_category_timestamp_idx" ON "context_scores"("category", "timestamp" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "scorer_configs_category_scorer_name_key" ON "scorer_configs"("category", "scorer_name");

-- CreateIndex
CREATE INDEX "ai_decisions_market_id_timestamp_idx" ON "ai_decisions"("market_id", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "ai_decisions_category_timestamp_idx" ON "ai_decisions"("category", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "ai_decisions_action_timestamp_idx" ON "ai_decisions"("action", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "trade_feedback_category_session_date_idx" ON "trade_feedback"("category", "session_date" DESC);

-- CreateIndex
CREATE INDEX "orders_market_id_idx" ON "orders"("market_id");

-- CreateIndex
CREATE INDEX "orders_decision_id_idx" ON "orders"("decision_id");

-- CreateIndex
CREATE INDEX "orders_status_idx" ON "orders"("status");

-- CreateIndex
CREATE INDEX "trades_order_id_idx" ON "trades"("order_id");

-- CreateIndex
CREATE INDEX "trades_market_id_idx" ON "trades"("market_id");

-- CreateIndex
CREATE INDEX "trades_executed_at_idx" ON "trades"("executed_at" DESC);

-- CreateIndex
CREATE INDEX "positions_market_id_idx" ON "positions"("market_id");

-- CreateIndex
CREATE UNIQUE INDEX "positions_market_id_outcome_token_key" ON "positions"("market_id", "outcome_token");

-- CreateIndex
CREATE INDEX "position_history_market_id_idx" ON "position_history"("market_id");

-- CreateIndex
CREATE INDEX "position_history_closed_at_idx" ON "position_history"("closed_at" DESC);

-- CreateIndex
CREATE INDEX "ai_reviews_review_type_timestamp_idx" ON "ai_reviews"("review_type", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "risk_events_event_type_timestamp_idx" ON "risk_events"("event_type", "timestamp" DESC);

-- CreateIndex
CREATE INDEX "risk_events_decision_id_idx" ON "risk_events"("decision_id");

-- CreateIndex
CREATE INDEX "alerts_is_read_created_at_idx" ON "alerts"("is_read", "created_at" DESC);

-- CreateIndex
CREATE UNIQUE INDEX "bankroll_history_date_key" ON "bankroll_history"("date");

-- CreateIndex
CREATE INDEX "bankroll_history_date_idx" ON "bankroll_history"("date" DESC);

-- CreateIndex
CREATE INDEX "risk_config_scope_scope_value_idx" ON "risk_config"("scope", "scope_value");

-- CreateIndex
CREATE UNIQUE INDEX "system_config_key_key" ON "system_config"("key");

-- CreateIndex
CREATE INDEX "audit_log_entity_type_entity_id_idx" ON "audit_log"("entity_type", "entity_id");

-- CreateIndex
CREATE INDEX "audit_log_timestamp_idx" ON "audit_log"("timestamp" DESC);

-- AddForeignKey
ALTER TABLE "market_snapshots" ADD CONSTRAINT "market_snapshots_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "context_scores" ADD CONSTRAINT "context_scores_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ai_decisions" ADD CONSTRAINT "ai_decisions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "orders" ADD CONSTRAINT "orders_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "ai_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "orders"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "trades" ADD CONSTRAINT "trades_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "ai_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "positions" ADD CONSTRAINT "positions_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "ai_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_history" ADD CONSTRAINT "position_history_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "position_history" ADD CONSTRAINT "position_history_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "ai_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_decision_id_fkey" FOREIGN KEY ("decision_id") REFERENCES "ai_decisions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "risk_events" ADD CONSTRAINT "risk_events_market_id_fkey" FOREIGN KEY ("market_id") REFERENCES "markets"("id") ON DELETE SET NULL ON UPDATE CASCADE;
