// src/engine.ts — re-export barrel (backward-compat shim)
// Content has moved to:
//   types       → src/engine/atoms/types.ts
//   pawEngine   → src/engine/molecules/ipc_client.ts
//
// All existing imports of { pawEngine, EngineConfig, ... } from './engine' continue to work.

export * from './engine/atoms/types';
export { pawEngine } from './engine/molecules/ipc_client';
