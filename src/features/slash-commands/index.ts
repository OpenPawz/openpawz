// ─────────────────────────────────────────────────────────────────────────────
// Slash Commands — Public API
// ─────────────────────────────────────────────────────────────────────────────

// Atoms (pure)
export {
  type SlashCommandDef,
  type ParsedCommand,
  type AutocompleteSuggestion,
  COMMANDS,
  isSlashCommand,
  parseCommand,
  validateCommand,
  getAutocompleteSuggestions,
  buildHelpText,
  getCommandDef,
} from './atoms';

// Molecules (side-effects)
export {
  type CommandResult,
  type CommandContext,
  type SessionOverrides,
  interceptSlashCommand,
  getSessionOverrides,
  clearSessionOverrides,
} from './molecules';
