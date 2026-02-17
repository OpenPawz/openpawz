// ─── Memory Intelligence · Barrel Export ───────────────────────────────
// Re-exports all public API from atoms and molecules.

export {
  // Types
  type Memory,
  type MemorySearchOptions,
  type MemoryStoreOptions,
  type MemoryStats,
  type SearchConfig,
  type MemoryCategory,

  // Constants
  DEFAULT_SEARCH_CONFIG,
  MEMORY_CATEGORIES,

  // Pure functions (atoms)
  temporalDecayFactor,
  applyDecay,
  jaccardSimilarity,
  mmrRerank,
  formatMemoryForContext,
  groupByCategory,
  describeAge,
} from './atoms';

export {
  // Config persistence (molecules)
  loadSearchConfig,
  saveSearchConfig,

  // Tauri IPC operations
  storeMemory,
  searchMemories,
  getMemoryStats,
  deleteMemory,

  // Composite operations
  searchForAgent,
  buildMemoryContext,
  getAgentMemoryOverview,
} from './molecules';
