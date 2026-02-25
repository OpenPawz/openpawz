// First-run guided tour — 5-step spotlight overlay

import { TOUR_STEPS, type TourStep } from '../views/today/atoms';

const STORAGE_KEY = 'paw-tour-complete';

let _step = 0;
let _overlay: HTMLDivElement | null = null;
let _onComplete: (() => void) | null = null;

/** Has the user already completed (or dismissed) the tour? */
export function isTourComplete(): boolean {
  return localStorage.getItem(STORAGE_KEY) === '1';
}

/** Mark tour as permanently dismissed. */
function markComplete() {
  localStorage.setItem(STORAGE_KEY, '1');
}

/** Launch the tour overlay. Calls `onComplete` when finished or skipped. */
export function startTour(onComplete?: () => void) {
  if (_overlay) return; // already running
  _step = 0;
  _onComplete = onComplete ?? null;
  renderStep();
}

/** Close the tour without marking it complete. */
export function closeTour() {
  cleanup();
}

// ── Internal ──────────────────────────────────────────────────────────

function renderStep() {
  cleanup();

  const step = TOUR_STEPS[_step];
  if (!step) {
    finish();
    return;
  }

  const target = document.querySelector(step.target) as HTMLElement | null;

  // Create overlay
  _overlay = document.createElement('div');
  _overlay.className = 'tour-overlay';
  _overlay.setAttribute('role', 'dialog');
  _overlay.setAttribute('aria-label', 'Guided tour');

  // Spotlight cutout + tooltip
  _overlay.innerHTML = buildOverlayHTML(step, _step, TOUR_STEPS.length, target);
  document.body.appendChild(_overlay);

  // Position tooltip relative to target
  if (target) {
    positionTooltip(target, step.position);
  }

  // Bind events
  _overlay.querySelector('.tour-skip')?.addEventListener('click', skip);
  _overlay.querySelector('.tour-next')?.addEventListener('click', next);
  _overlay.querySelector('.tour-back')?.addEventListener('click', back);
  _overlay.querySelector('.tour-finish')?.addEventListener('click', finish);
  _overlay.addEventListener('keydown', onKeydown);

  // Focus management
  const tooltip = _overlay.querySelector('.tour-tooltip') as HTMLElement;
  tooltip?.focus();
}

function buildOverlayHTML(step: TourStep, idx: number, total: number, target: HTMLElement | null): string {
  const isFirst = idx === 0;
  const isLast = idx === total - 1;
  const stepNum = idx + 1;

  // Build spotlight SVG mask if target exists
  let spotlightSvg = '';
  if (target) {
    const rect = target.getBoundingClientRect();
    const pad = 6;
    spotlightSvg = `
      <svg class="tour-spotlight-svg" xmlns="http://www.w3.org/2000/svg">
        <defs>
          <mask id="tour-mask">
            <rect width="100%" height="100%" fill="white"/>
            <rect x="${rect.left - pad}" y="${rect.top - pad}"
                  width="${rect.width + pad * 2}" height="${rect.height + pad * 2}"
                  rx="8" fill="black"/>
          </mask>
        </defs>
        <rect width="100%" height="100%" fill="rgba(0,0,0,0.6)" mask="url(#tour-mask)"/>
      </svg>
    `;
  }

  return `
    ${spotlightSvg || '<div class="tour-backdrop"></div>'}
    <div class="tour-tooltip" tabindex="-1" role="document">
      <div class="tour-tooltip-header">
        <span class="tour-tooltip-step">${stepNum} / ${total}</span>
        <button class="tour-skip btn btn-ghost btn-sm">Skip tour</button>
      </div>
      <div class="tour-tooltip-title">${step.title}</div>
      <div class="tour-tooltip-desc">${step.description}</div>
      <div class="tour-tooltip-actions">
        ${!isFirst ? '<button class="tour-back btn btn-ghost btn-sm">Back</button>' : '<span></span>'}
        ${isLast
          ? '<button class="tour-finish btn btn-primary btn-sm">Get Started</button>'
          : '<button class="tour-next btn btn-primary btn-sm">Next</button>'}
      </div>
      <div class="tour-dots">
        ${Array.from({ length: total }, (_, i) =>
          `<span class="tour-dot${i === idx ? ' active' : ''}"></span>`
        ).join('')}
      </div>
    </div>
  `;
}

function positionTooltip(target: HTMLElement, position: TourStep['position']) {
  const tooltip = _overlay?.querySelector('.tour-tooltip') as HTMLElement;
  if (!tooltip) return;

  const rect = target.getBoundingClientRect();
  const gap = 16;

  // Default positioning — right of target (sidebar items)
  if (position === 'right') {
    tooltip.style.top = `${rect.top + rect.height / 2}px`;
    tooltip.style.left = `${rect.right + gap}px`;
    tooltip.style.transform = 'translateY(-50%)';
  } else if (position === 'bottom') {
    tooltip.style.top = `${rect.bottom + gap}px`;
    tooltip.style.left = `${rect.left + rect.width / 2}px`;
    tooltip.style.transform = 'translateX(-50%)';
  } else {
    tooltip.style.top = `${rect.top + rect.height / 2}px`;
    tooltip.style.left = `${rect.left - gap}px`;
    tooltip.style.transform = 'translate(-100%, -50%)';
  }
}

function next() {
  if (_step < TOUR_STEPS.length - 1) {
    _step++;
    renderStep();
  }
}

function back() {
  if (_step > 0) {
    _step--;
    renderStep();
  }
}

function skip() {
  markComplete();
  cleanup();
  _onComplete?.();
}

function finish() {
  markComplete();
  cleanup();
  _onComplete?.();
}

function cleanup() {
  if (_overlay) {
    _overlay.remove();
    _overlay = null;
  }
}

function onKeydown(e: KeyboardEvent) {
  if (e.key === 'Escape') {
    skip();
  } else if (e.key === 'ArrowRight' || e.key === 'Enter') {
    if (_step < TOUR_STEPS.length - 1) next();
    else finish();
  } else if (e.key === 'ArrowLeft') {
    back();
  }
}
