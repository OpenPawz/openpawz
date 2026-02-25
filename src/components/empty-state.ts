// Shared empty state component — renders guided empty states for unconfigured views.
// Each empty state shows: icon, title, description, optional CTA, optional prerequisites.

import { escHtml } from './helpers';

export interface EmptyStateAction {
  label: string;
  /** Material Symbols icon name (optional) */
  icon?: string;
  /** CSS class variant: 'primary' (default) | 'ghost' */
  variant?: 'primary' | 'ghost';
}

export interface EmptyStatePrereq {
  label: string;
  /** true = already satisfied */
  met: boolean;
}

export interface EmptyStateConfig {
  /** Material Symbols icon name */
  icon: string;
  title: string;
  subtitle: string;
  /** Primary action button(s). Each gets a data-action="0", data-action="1", etc. */
  actions?: EmptyStateAction[];
  /** Feature highlights — brief bullet points showing what the feature can do */
  features?: string[];
  /** Prerequisites that must be met before the feature works */
  prereqs?: EmptyStatePrereq[];
  /** Hint text below everything (e.g. "Data saved in ~/Documents/Paw") */
  hint?: string;
}

/**
 * Render guided empty state HTML.
 * Returns a string of HTML with class `.empty-state` as root.
 * The caller is responsible for inserting + binding event listeners on `[data-action]` buttons.
 */
export function renderEmptyState(cfg: EmptyStateConfig): string {
  const actionsHtml = cfg.actions?.length
    ? `<div class="empty-actions">
        ${cfg.actions
          .map(
            (a, i) =>
              `<button class="btn btn-${a.variant ?? 'primary'}" data-action="${i}">
                ${a.icon ? `<span class="ms ms-sm">${a.icon}</span>` : ''}
                ${escHtml(a.label)}
              </button>`,
          )
          .join('')}
      </div>`
    : '';

  const featuresHtml = cfg.features?.length
    ? `<div class="empty-features">
        ${cfg.features.map((f) => `<div class="empty-feature-item"><span class="ms ms-sm">check_circle</span> ${escHtml(f)}</div>`).join('')}
      </div>`
    : '';

  const prereqsHtml = cfg.prereqs?.length
    ? `<div class="empty-prereqs">
        <div class="empty-prereqs-title">Prerequisites</div>
        ${cfg.prereqs
          .map(
            (p) =>
              `<div class="empty-prereq-item ${p.met ? 'met' : ''}">
                <span class="ms ms-sm">${p.met ? 'check_circle' : 'radio_button_unchecked'}</span>
                ${escHtml(p.label)}
              </div>`,
          )
          .join('')}
      </div>`
    : '';

  const hintHtml = cfg.hint ? `<div class="empty-hint">${escHtml(cfg.hint)}</div>` : '';

  return `<div class="empty-state">
    <div class="empty-icon"><span class="ms">${cfg.icon}</span></div>
    <div class="empty-title">${escHtml(cfg.title)}</div>
    <div class="empty-subtitle">${escHtml(cfg.subtitle)}</div>
    ${featuresHtml}
    ${actionsHtml}
    ${prereqsHtml}
    ${hintHtml}
  </div>`;
}
