// ─── Execution Engine Barrel ──────────────────────────────────────────────────

export { ExecutionEngine, executionEngine } from './engine.js';
export type { ExecutionInput, ExecutionResult } from './engine.js';

export { computeSize, DEFAULT_SIZING_CONFIG } from './sizing.js';
export type { SizingConfig, SizingInput, SizingResult } from './sizing.js';

export { OrderManager, orderManager } from './order-manager.js';
export type { PlaceOrderInput, PlaceOrderResult } from './order-manager.js';

export { PositionManager, positionManager } from './position-manager.js';
export type { OpenPositionInput, ClosePositionInput } from './position-manager.js';

export { ExitMonitor, exitMonitor } from './exit-monitor.js';
