// ─── Browser Sandbox · Barrel Export ───────────────────────────────────
// Re-exports all public API from atoms and molecules.

export {
  // Types
  type BrowserProfile,
  type BrowserConfig,
  type ScreenshotEntry,
  type WorkspaceInfo,
  type WorkspaceFile,
  type NetworkPolicy,
  type NetworkRequest,

  // Constants
  DEFAULT_BROWSER_CONFIG,
  DEFAULT_ALLOWED_DOMAINS,
  DEFAULT_BLOCKED_DOMAINS,

  // Pure functions (atoms)
  formatBytes,
  isValidDomain,
  extractDomain,
  timeAgo,
} from './atoms';

export {
  // Browser profiles (molecules)
  loadBrowserConfig,
  saveBrowserConfig,
  createBrowserProfile,
  deleteBrowserProfile,

  // Screenshots
  listScreenshots,
  getScreenshot,
  deleteScreenshot,

  // Workspaces
  listWorkspaces,
  listWorkspaceFiles,
  deleteWorkspace,

  // Network policy
  loadNetworkPolicy,
  saveNetworkPolicy,
  checkNetworkUrl,
} from './molecules';
