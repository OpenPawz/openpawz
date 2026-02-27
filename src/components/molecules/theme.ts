// src/components/molecules/theme.ts
// Theme management — multi-theme support.

const THEME_KEY = 'paw-theme';

export type PawTheme = 'dark' | 'light' | 'midnight' | 'hacker' | 'ember' | 'arctic' | 'violet' | 'solarized';

export const THEMES: { id: PawTheme; label: string; icon: string; swatch: string }[] = [
  { id: 'dark',      label: 'Dark',          icon: 'dark_mode',      swatch: '#050505' },
  { id: 'light',     label: 'Light',         icon: 'light_mode',     swatch: '#F5F0EB' },
  { id: 'midnight',  label: 'Midnight Blue', icon: 'nights_stay',    swatch: '#0B1120' },
  { id: 'hacker',    label: 'Hacker',        icon: 'terminal',       swatch: '#000000' },
  { id: 'ember',     label: 'Ember',         icon: 'local_fire_department', swatch: '#1A1210' },
  { id: 'arctic',    label: 'Arctic',        icon: 'ac_unit',        swatch: '#EFF4F8' },
  { id: 'violet',    label: 'Violet Void',   icon: 'auto_awesome',   swatch: '#100818' },
  { id: 'solarized', label: 'Solarized',     icon: 'wb_twilight',    swatch: '#002B36' },
];

const ACCENT_MAP: Record<PawTheme, string> = {
  dark: '#FF4D4D',
  light: '#CC3333',
  midnight: '#4D9EFF',
  hacker: '#00FF41',
  ember: '#FF8C28',
  arctic: '#2E7DB5',
  violet: '#A78BFA',
  solarized: '#268BD2',
};

export function getTheme(): PawTheme {
  return (localStorage.getItem(THEME_KEY) as PawTheme) || 'dark';
}

export function setTheme(theme: PawTheme) {
  if (theme === 'dark') {
    document.documentElement.removeAttribute('data-theme');
  } else {
    document.documentElement.setAttribute('data-theme', theme);
  }
  localStorage.setItem(THEME_KEY, theme);

  // Update settings page label if present
  const label = document.getElementById('theme-label');
  if (label) {
    const meta = THEMES.find(t => t.id === theme);
    label.textContent = meta?.label ?? theme;
  }

  // Sync sidebar picker swatch
  updateSidebarPicker(theme);
}

export function initTheme() {
  setTheme(getTheme());

  // Legacy settings page toggle — treat as dark/light flip
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const cur = getTheme();
    // If on a dark variant, go light; if on light/arctic, go dark
    const isLight = cur === 'light' || cur === 'arctic';
    setTheme(isLight ? 'dark' : 'light');
  });

  // Build sidebar theme picker
  buildSidebarPicker();
}

// ── Sidebar theme picker ─────────────────────────────────────────────────

function buildSidebarPicker() {
  const btn = document.getElementById('sidebar-theme-toggle');
  if (!btn) return;

  const current = getTheme();

  // Replace button innards with swatch + dropdown
  btn.innerHTML = `
    <span class="theme-swatch" style="background:${ACCENT_MAP[current]}"></span>
    <span class="ms nav-icon" style="font-size:14px">expand_more</span>
  `;
  btn.style.position = 'relative';

  // Build dropdown
  const dropdown = document.createElement('div');
  dropdown.className = 'theme-picker-dropdown';
  dropdown.style.display = 'none';
  dropdown.innerHTML = THEMES.map(t => `
    <button class="theme-picker-item${t.id === current ? ' active' : ''}" data-theme="${t.id}">
      <span class="theme-picker-swatch" style="background:${t.swatch};box-shadow:inset 0 0 0 1px ${ACCENT_MAP[t.id]}"></span>
      <span class="theme-picker-label">${t.label}</span>
    </button>
  `).join('');

  btn.parentElement?.appendChild(dropdown);

  // Toggle dropdown on button click
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    const open = dropdown.style.display !== 'none';
    dropdown.style.display = open ? 'none' : 'flex';
  });

  // Theme selection
  dropdown.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.theme-picker-item') as HTMLElement | null;
    if (!item) return;
    e.stopPropagation();
    const theme = item.dataset.theme as PawTheme;
    setTheme(theme);
    dropdown.querySelectorAll('.theme-picker-item').forEach(el => el.classList.remove('active'));
    item.classList.add('active');
    dropdown.style.display = 'none';
  });

  // Close on outside click
  document.addEventListener('click', () => {
    dropdown.style.display = 'none';
  });
}

function updateSidebarPicker(theme: PawTheme) {
  const btn = document.getElementById('sidebar-theme-toggle');
  if (!btn) return;
  const swatch = btn.querySelector('.theme-swatch') as HTMLElement | null;
  if (swatch) {
    swatch.style.background = ACCENT_MAP[theme];
  }
  // Update active state in dropdown
  const dropdown = btn.parentElement?.querySelector('.theme-picker-dropdown');
  if (dropdown) {
    dropdown.querySelectorAll('.theme-picker-item').forEach(el => {
      el.classList.toggle('active', (el as HTMLElement).dataset.theme === theme);
    });
  }
}
