// src/features/integration-guardrails/index.ts — Barrel + state management
//
// Thin barrel: re-exports atoms + molecules, manages guardrail state.

export {
  // Atoms — types
  type IntegrationRiskLevel,
  type IntegrationAction,
  type RateLimitConfig,
  type RateLimitWindow,
  type AgentServicePermission,
  type AccessLevel,
  type CredentialUsageLog,
  type DryRunPlan,
  type DryRunStep,
  // Atoms — functions
  classifyActionRisk,
  riskMeta,
  getRateLimit,
  checkRateLimit,
  resetRateLimit,
  bumpRateLimit,
  isActionAllowed,
  accessMeta,
  countHighRisk,
  planRequiresConfirm,
} from './atoms';

export {
  // Molecules — types
  type ConfirmationRequest,
  // Molecules — renderers
  renderConfirmationCard,
  renderRateLimitWarning,
  renderDryRunPlan,
  renderAuditLog,
  renderPermissionEditor,
  // Molecules — interaction
  requestConfirmation,
  wireGuardrailEvents,
} from './molecules';
