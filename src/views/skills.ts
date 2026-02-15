// Skills View — Plugin Manager
// Extracted from main.ts for maintainability

import { gateway } from '../gateway';

const $ = (id: string) => document.getElementById(id);

// ── Module state ───────────────────────────────────────────────────────────
let wsConnected = false;

export function setWsConnected(connected: boolean) {
  wsConnected = connected;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function escAttr(s: string): string {
  return s.replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

let _skillsToastTimer: number | null = null;
function showSkillsToast(message: string, type: 'success' | 'error' | 'info') {
  const toast = $('skills-toast');
  if (!toast) return;
  toast.className = `skills-toast ${type}`;
  toast.textContent = message;
  toast.style.display = 'flex';

  if (_skillsToastTimer) clearTimeout(_skillsToastTimer);
  _skillsToastTimer = window.setTimeout(() => {
    toast.style.display = 'none';
    _skillsToastTimer = null;
  }, type === 'error' ? 8000 : 4000);
}

// ── Main loader ────────────────────────────────────────────────────────────
export async function loadSkills() {
  const installed = $('skills-installed-list');
  const available = $('skills-available-list');
  const availableSection = $('skills-available-section');
  const empty = $('skills-empty');
  const loading = $('skills-loading');
  if (!wsConnected) return;

  if (loading) loading.style.display = '';
  if (empty) empty.style.display = 'none';
  if (installed) installed.innerHTML = '';
  if (available) available.innerHTML = '';
  if (availableSection) availableSection.style.display = 'none';

  try {
    const result = await gateway.skillsStatus();
    if (loading) loading.style.display = 'none';

    const skills = result.skills ?? [];
    if (!skills.length) {
      if (empty) empty.style.display = 'flex';
      return;
    }

    for (const skill of skills) {
      const card = document.createElement('div');
      card.className = 'skill-card';

      const isEnabled = !skill.disabled;
      const hasMissingBins = (skill.missing?.bins?.length ?? 0) > 0
        || (skill.missing?.anyBins?.length ?? 0) > 0
        || (skill.missing?.os?.length ?? 0) > 0;
      const hasMissingEnv = (skill.missing?.env?.length ?? 0) > 0;
      const hasMissingConfig = (skill.missing?.config?.length ?? 0) > 0;
      const isInstalled = skill.always || (!hasMissingBins && !hasMissingEnv && !hasMissingConfig);
      const needsSetup = !hasMissingBins && (hasMissingEnv || hasMissingConfig);
      const hasEnvRequirements = (skill.requirements?.env?.length ?? 0) > 0;
      const installOptions = skill.install ?? [];

      if (needsSetup) card.className += ' needs-setup';

      const statusLabel = isInstalled
        ? (isEnabled ? 'Enabled' : 'Disabled')
        : needsSetup ? 'Needs Setup' : 'Available';
      const statusClass = isInstalled
        ? (isEnabled ? 'connected' : 'muted')
        : needsSetup ? 'warning' : 'muted';

      const installSpecId = installOptions[0]?.id ?? '';
      const installLabel = installOptions[0]?.label ?? 'Install';

      const skillDataAttr = escAttr(JSON.stringify({
        name: skill.name,
        skillKey: skill.skillKey ?? skill.name,
        description: skill.description ?? '',
        primaryEnv: skill.primaryEnv,
        requiredEnv: skill.requirements?.env ?? [],
        missingEnv: skill.missing?.env ?? [],
        homepage: skill.homepage,
      }));

      card.innerHTML = `
        <div class="skill-card-header">
          <span class="skill-card-name">${skill.emoji ? escHtml(skill.emoji) + ' ' : ''}${escHtml(skill.name)}</span>
          <span class="status-badge ${statusClass}">${statusLabel}</span>
        </div>
        <div class="skill-card-desc">${escHtml(skill.description ?? '')}</div>
        ${needsSetup ? `<div class="skill-config-missing">Needs API key${(skill.missing?.env?.length ?? 0) > 1 ? 's' : ''}: ${escHtml((skill.missing?.env ?? []).join(', '))}</div>` : ''}
        <div class="skill-card-footer">
          <div style="display:flex;align-items:center;gap:8px">
            ${skill.homepage ? `<a class="skill-card-link" href="${escAttr(skill.homepage)}" target="_blank">docs ↗</a>` : ''}
          </div>
          <div class="skill-card-actions">
            ${isInstalled ? `
              ${hasEnvRequirements ? `<button class="btn btn-ghost btn-sm skill-configure" data-skill='${skillDataAttr}' title="Configure">Configure</button>` : ''}
              <button class="skill-toggle ${isEnabled ? 'enabled' : ''}" data-skill-key="${escAttr(skill.skillKey ?? skill.name)}" data-name="${escAttr(skill.name)}" data-enabled="${isEnabled}" title="${isEnabled ? 'Disable' : 'Enable'}"></button>
            ` : needsSetup ? `
              <button class="btn btn-primary btn-sm skill-configure" data-skill='${skillDataAttr}'>Setup</button>
            ` : installOptions.length > 0 ? `
              <button class="btn btn-primary btn-sm skill-install" data-name="${escAttr(skill.name)}" data-install-id="${escAttr(installSpecId)}">${escHtml(installLabel)}</button>
            ` : `
              <span class="status-badge muted">No installer</span>
            `}
          </div>
        </div>
      `;
      if (isInstalled) {
        installed?.appendChild(card);
      } else {
        if (availableSection) availableSection.style.display = '';
        available?.appendChild(card);
      }
    }

    wireSkillActions();
  } catch (e) {
    console.warn('Skills load failed:', e);
    if (loading) loading.style.display = 'none';
    if (empty) empty.style.display = 'flex';
    showSkillsToast(`Failed to load skills: ${e}`, 'error');
  }
}

function wireSkillActions() {
  // Install buttons
  document.querySelectorAll('.skill-install').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const name = (btn as HTMLElement).dataset.name!;
      const installId = (btn as HTMLElement).dataset.installId!;
      if (!installId) {
        showSkillsToast(`No installer available for ${name}`, 'error');
        return;
      }
      (btn as HTMLButtonElement).disabled = true;
      (btn as HTMLButtonElement).textContent = 'Installing…';
      showSkillsToast(`Installing ${name}…`, 'info');
      try {
        await gateway.skillsInstall(name, installId);
        showSkillsToast(`${name} installed successfully!`, 'success');
        await loadSkills();
      } catch (e) {
        showSkillsToast(`Install failed for ${name}: ${e}`, 'error');
        (btn as HTMLButtonElement).disabled = false;
        (btn as HTMLButtonElement).textContent = 'Install';
      }
    });
  });

  // Enable/disable toggles
  document.querySelectorAll('.skill-toggle').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const skillKey = (btn as HTMLElement).dataset.skillKey!;
      const name = (btn as HTMLElement).dataset.name ?? skillKey;
      const currentlyEnabled = (btn as HTMLElement).dataset.enabled === 'true';
      const newState = !currentlyEnabled;

      (btn as HTMLButtonElement).disabled = true;
      try {
        await gateway.skillsUpdate(skillKey, { enabled: newState });
        showSkillsToast(`${name} ${newState ? 'enabled' : 'disabled'}`, 'success');
        await loadSkills();
      } catch (e) {
        showSkillsToast(`Failed to ${newState ? 'enable' : 'disable'} ${name}: ${e}`, 'error');
        (btn as HTMLButtonElement).disabled = false;
      }
    });
  });

  // Configure / Setup buttons
  document.querySelectorAll('.skill-configure').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const raw = (btn as HTMLElement).dataset.skill;
      if (!raw) return;
      try {
        const data = JSON.parse(raw);
        openSkillConfigModal(data);
      } catch { /* ignore parse errors */ }
    });
  });
}

// ── Skill config modal ─────────────────────────────────────────────────────
interface SkillConfigData {
  name: string;
  skillKey: string;
  description: string;
  primaryEnv?: string;
  requiredEnv: string[];
  missingEnv: string[];
  homepage?: string;
}

let _activeSkillConfig: SkillConfigData | null = null;

function openSkillConfigModal(data: SkillConfigData) {
  const modal = $('skill-config-modal');
  const title = $('skill-config-title');
  const desc = $('skill-config-desc');
  const fields = $('skill-config-fields');
  if (!modal || !fields) return;

  _activeSkillConfig = data;

  if (title) title.textContent = `Configure ${data.name}`;
  if (desc) {
    const parts: string[] = [];
    if (data.description) parts.push(data.description);
    if (data.homepage) parts.push(`<a href="${escAttr(data.homepage)}" target="_blank" style="color:var(--accent)">View docs ↗</a>`);
    desc.innerHTML = parts.join(' — ');
  }

  const envVars = data.requiredEnv.length > 0 ? data.requiredEnv : (data.primaryEnv ? [data.primaryEnv] : []);
  fields.innerHTML = envVars.map(envName => {
    const isMissing = data.missingEnv.includes(envName);
    const isPrimary = envName === data.primaryEnv;
    return `
      <div class="skill-config-field">
        <label for="skill-env-${escAttr(envName)}">${escHtml(envName)}${isMissing ? ' <span style="color:var(--warning,#E8A317)">(not set)</span>' : ' <span style="color:var(--success)">✓</span>'}</label>
        <input type="password" id="skill-env-${escAttr(envName)}" class="form-input"
          data-env-name="${escAttr(envName)}"
          data-is-primary="${isPrimary}"
          placeholder="${isPrimary ? 'Enter your API key' : `Enter value for ${envName}`}"
          autocomplete="off" spellcheck="false">
        <div class="field-hint">${isPrimary ? 'This is the main API key for this skill.' : 'Required environment variable.'} Leave blank to keep current value.</div>
      </div>
    `;
  }).join('');

  modal.style.display = 'flex';
}

function closeSkillConfigModal() {
  const modal = $('skill-config-modal');
  if (modal) modal.style.display = 'none';
  _activeSkillConfig = null;
}

async function saveSkillConfig() {
  if (!_activeSkillConfig) return;
  const fields = $('skill-config-fields');
  if (!fields) return;

  const data = _activeSkillConfig;
  const inputs = fields.querySelectorAll<HTMLInputElement>('input[data-env-name]');

  const env: Record<string, string> = {};
  let apiKey: string | undefined;

  inputs.forEach(input => {
    const envName = input.dataset.envName!;
    const value = input.value.trim();
    if (!value) return;

    if (input.dataset.isPrimary === 'true') {
      apiKey = value;
    } else {
      env[envName] = value;
    }
  });

  if (!apiKey && Object.keys(env).length === 0) {
    showSkillsToast('No values entered — nothing to save', 'info');
    return;
  }

  const saveBtn = $('skill-config-save') as HTMLButtonElement | null;
  if (saveBtn) { saveBtn.disabled = true; saveBtn.textContent = 'Saving…'; }

  try {
    const updates: { enabled?: boolean; apiKey?: string; env?: Record<string, string> } = {};
    if (apiKey) updates.apiKey = apiKey;
    if (Object.keys(env).length > 0) updates.env = env;

    await gateway.skillsUpdate(data.skillKey, updates);
    showSkillsToast(`${data.name} configured successfully!`, 'success');
    closeSkillConfigModal();
    await loadSkills();
  } catch (e) {
    showSkillsToast(`Failed to configure ${data.name}: ${e}`, 'error');
  } finally {
    if (saveBtn) { saveBtn.disabled = false; saveBtn.textContent = 'Save'; }
  }
}

// ── Event wiring ───────────────────────────────────────────────────────────
export function initSkillsEvents() {
  $('skill-config-close')?.addEventListener('click', closeSkillConfigModal);
  $('skill-config-cancel')?.addEventListener('click', closeSkillConfigModal);
  $('skill-config-save')?.addEventListener('click', saveSkillConfig);
  $('skill-config-modal')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) closeSkillConfigModal();
  });

  $('refresh-skills-btn')?.addEventListener('click', () => loadSkills());

  // Bins modal
  $('skills-browse-bins')?.addEventListener('click', async () => {
    const backdrop = $('bins-modal-backdrop');
    const list = $('bins-list');
    const loading = $('bins-loading');
    const empty = $('bins-empty');
    if (!backdrop || !list) return;

    backdrop.style.display = 'flex';
    list.innerHTML = '';
    if (loading) loading.style.display = '';
    if (empty) empty.style.display = 'none';

    try {
      const result = await gateway.skillsBins();
      if (loading) loading.style.display = 'none';
      const bins = result.bins ?? [];
      if (!bins.length) {
        if (empty) empty.style.display = '';
        return;
      }

      for (const bin of bins) {
        const item = document.createElement('div');
        item.className = 'bins-item';
        item.innerHTML = `
          <span class="bins-item-name">${escHtml(bin)}</span>
          <button class="btn btn-primary btn-sm bins-item-install" data-name="${escAttr(bin)}">Install</button>
        `;
        list.appendChild(item);
      }

      list.querySelectorAll('.bins-item-install').forEach(btn => {
        btn.addEventListener('click', async () => {
          const name = (btn as HTMLElement).dataset.name!;
          (btn as HTMLButtonElement).disabled = true;
          (btn as HTMLButtonElement).textContent = 'Installing…';
          try {
            await gateway.skillsInstall(name, crypto.randomUUID());
            (btn as HTMLButtonElement).textContent = 'Installed';
            showSkillsToast(`${name} installed!`, 'success');
            loadSkills();
          } catch (e) {
            (btn as HTMLButtonElement).textContent = 'Failed';
            showSkillsToast(`Install failed: ${e}`, 'error');
            setTimeout(() => {
              (btn as HTMLButtonElement).textContent = 'Install';
              (btn as HTMLButtonElement).disabled = false;
            }, 2000);
          }
        });
      });
    } catch (e) {
      if (loading) loading.style.display = 'none';
      if (empty) { empty.style.display = ''; empty.textContent = `Failed to load bins: ${e}`; }
    }
  });

  $('bins-modal-close')?.addEventListener('click', () => {
    const backdrop = $('bins-modal-backdrop');
    if (backdrop) backdrop.style.display = 'none';
  });

  $('bins-modal-backdrop')?.addEventListener('click', (e) => {
    if (e.target === e.currentTarget) {
      (e.target as HTMLElement).style.display = 'none';
    }
  });

  $('bins-custom-install')?.addEventListener('click', async () => {
    const input = $('bins-custom-name') as HTMLInputElement | null;
    const btn = $('bins-custom-install') as HTMLButtonElement | null;
    if (!input || !btn) return;

    const name = input.value.trim();
    if (!name) { input.focus(); return; }

    btn.disabled = true;
    btn.textContent = 'Installing…';

    try {
      await gateway.skillsInstall(name, crypto.randomUUID());
      showSkillsToast(`${name} installed!`, 'success');
      input.value = '';
      loadSkills();
      const backdrop = $('bins-modal-backdrop');
      if (backdrop) backdrop.style.display = 'none';
    } catch (e) {
      showSkillsToast(`Install failed for "${name}": ${e}`, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Install';
    }
  });
}
