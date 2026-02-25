// src/features/integration-health/index.ts — Barrel + re-exports

export {
  type HealthStatus,
  type ServiceHealth,
  type HealthSummary,
  type IntegrationSuggestion,
  type ChainRule,
  statusIcon,
  statusColor,
  statusLabel,
  computeHealthSummary,
  deriveHealthStatus,
  daysUntilExpiry,
  generateSuggestions,
} from './atoms';

export {
  renderConnectedStrip,
  renderHealthWarning,
  renderSuggestions,
  renderChainRules,
  renderDashboardIntegrations,
  loadServiceHealth,
  loadChainRules,
  toggleChainRule,
  wireDashboardEvents,
} from './molecules';
