// Showcase Mode — Pre-populated demo data for first-run experience

import { buildShowcaseData, type ShowcaseData } from '../views/today/atoms';

const STORAGE_KEY = 'paw-showcase-mode';

let _active = false;
let _data: ShowcaseData | null = null;

/** Is showcase mode currently active? */
export function isShowcaseActive(): boolean {
  return _active;
}

/** Enable showcase mode with synthetic data. */
export function enableShowcase() {
  _active = true;
  _data = buildShowcaseData();
  localStorage.setItem(STORAGE_KEY, '1');
  renderBanner();
}

/** Disable showcase mode and remove banner. */
export function disableShowcase() {
  _active = false;
  _data = null;
  localStorage.removeItem(STORAGE_KEY);
  removeBanner();
}

/** Get the current showcase data (or null if inactive). */
export function getShowcaseData(): ShowcaseData | null {
  return _active ? _data : null;
}

/** Restore showcase state from localStorage on app start. */
export function restoreShowcase() {
  if (localStorage.getItem(STORAGE_KEY) === '1') {
    _active = true;
    _data = buildShowcaseData();
    renderBanner();
  }
}

// ── Banner ────────────────────────────────────────────────────────────

function renderBanner() {
  removeBanner();
  const banner = document.createElement('div');
  banner.className = 'showcase-banner';
  banner.id = 'showcase-banner';
  banner.innerHTML = `
    <span class="showcase-banner-icon"><span class="ms ms-sm">science</span></span>
    <span class="showcase-banner-text">Showcase Mode — You're viewing demo data</span>
    <button class="showcase-banner-dismiss btn btn-ghost btn-sm" id="showcase-dismiss">Exit Showcase</button>
  `;
  document.body.prepend(banner);

  document.getElementById('showcase-dismiss')?.addEventListener('click', () => {
    disableShowcase();
    // Trigger a Today refresh
    window.dispatchEvent(new CustomEvent('showcase-exit'));
  });
}

function removeBanner() {
  document.getElementById('showcase-banner')?.remove();
}
