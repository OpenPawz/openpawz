// src/engine-bridge.ts — re-export barrel (backward-compat shim)
// Content has moved to src/engine/molecules/bridge.ts
// All existing imports of { isEngineMode, startEngineBridge, ... } continue to work.

export * from './engine/molecules/bridge';
