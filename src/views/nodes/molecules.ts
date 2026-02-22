// Nodes — DOM rendering + IPC

import { pawEngine } from '../../engine';
import { showToast } from '../../components/toast';
import { $ } from '../../components/helpers';
import { esc } from './atoms';

// ── Main loader ────────────────────────────────────────────────────────────
export async function loadNodes() {
  const target = $('nodes-content');
  const loading = $('nodes-loading');
  if (!target) return;

  if (loading) loading.style.display = '';
  target.innerHTML = '';

  try {
    const [status, config] = await Promise.all([pawEngine.status(), pawEngine.getConfig()]);

    let skillsInfo: Array<{
      name: string;
      icon: string;
      enabled: boolean;
      is_ready: boolean;
      configured_credentials: string[];
      missing_credentials: string[];
    }> = [];
    try {
      skillsInfo = await pawEngine.skillsList();
    } catch {
      /* skills may not be loaded */
    }

    if (loading) loading.style.display = 'none';
    target.innerHTML = '';

    // ── Engine Status Card ─────────────────────────────────────────────
    const engineRunning =
      status && (status as unknown as Record<string, unknown>).running !== false;
    target.innerHTML += `
      <div class="engine-card engine-card-wide">
        <div class="engine-card-header">
          <span class="ms">monitor_heart</span>
          <h3>Engine Status</h3>
        </div>
        <div class="engine-status-row">
          <span class="engine-status-dot" style="color:${engineRunning ? 'var(--success)' : 'var(--danger)'}">
            <span class="ms">circle</span>
          </span>
          <div>
            <div class="engine-status-label">Paw Engine</div>
            <div class="engine-status-sub">${engineRunning ? 'Running — Tauri IPC connected' : 'Not responding'}</div>
          </div>
        </div>
      </div>`;

    // ── Providers Card ─────────────────────────────────────────────────
    let provRows = '';
    if (!config.providers.length) {
      provRows =
        '<p class="engine-empty-hint">No providers configured. Go to Settings → Advanced to add providers.</p>';
    } else {
      const kindIcons: Record<string, string> = {
        ollama: 'pets',
        openai: 'smart_toy',
        anthropic: 'psychology',
        google: 'auto_awesome',
        openrouter: 'language',
        custom: 'build',
      };
      for (const prov of config.providers) {
        const icon = kindIcons[prov.kind.toLowerCase()] ?? 'bolt';
        const isDefault = prov.id === config.default_provider;
        const hasKey =
          prov.kind.toLowerCase() === 'ollama' || (prov.api_key && prov.api_key.length > 0);
        const url =
          prov.base_url || (prov.kind.toLowerCase() === 'ollama' ? 'http://localhost:11434' : '—');

        provRows += `
          <div class="engine-provider-row" data-provider-kind="${esc(prov.kind.toLowerCase())}">
            <span class="ms engine-provider-icon">${icon}</span>
            <div class="engine-provider-info">
              <div class="engine-provider-name">${esc(prov.kind)}${isDefault ? ' <span class="engine-default-badge">(default)</span>' : ''}</div>
              <div class="engine-provider-url">${esc(url)}</div>
            </div>
            <span class="engine-key-status" style="color:${hasKey ? 'var(--success)' : 'var(--warning)'}">
              ${hasKey ? '● Key set' : '○ No key'}
            </span>
          </div>`;
      }
    }

    target.innerHTML += `
      <div class="engine-card">
        <div class="engine-card-header">
          <span class="ms">cloud</span>
          <h3>Providers</h3>
          <span class="engine-card-count">${config.providers.length}</span>
        </div>
        ${provRows}
      </div>`;

    // Wire Ollama test buttons after DOM insert
    target.querySelectorAll('.engine-provider-row[data-provider-kind="ollama"]').forEach((row) => {
      const testBtn = document.createElement('button');
      testBtn.className = 'btn btn-sm btn-ghost';
      testBtn.textContent = 'Test';
      testBtn.addEventListener('click', async () => {
        testBtn.disabled = true;
        testBtn.textContent = '…';
        try {
          const urlEl = row.querySelector('.engine-provider-url');
          const testUrl = (urlEl?.textContent || 'http://localhost:11434').replace(/\/$/, '');
          const resp = await fetch(`${testUrl}/api/tags`);
          if (resp.ok) {
            const data = (await resp.json()) as { models?: Array<{ name: string }> };
            const count = data.models?.length ?? 0;
            showToast(
              `Ollama connected — ${count} model${count !== 1 ? 's' : ''} available`,
              'success',
            );
          } else {
            showToast(`Ollama returned ${resp.status}`, 'error');
          }
        } catch (e) {
          showToast(`Cannot reach Ollama: ${e instanceof Error ? e.message : e}`, 'error');
        } finally {
          testBtn.disabled = false;
          testBtn.textContent = 'Test';
        }
      });
      row.appendChild(testBtn);
    });

    // ── Active Model Card ──────────────────────────────────────────────
    if (config.default_model) {
      target.innerHTML += `
        <div class="engine-card">
          <div class="engine-card-header">
            <span class="ms">flag</span>
            <h3>Active Model</h3>
          </div>
          <div class="engine-model-row">
            <span class="engine-model-name">${esc(config.default_model)}</span>
            ${config.default_provider ? `<span class="engine-model-provider">via ${esc(config.default_provider)}</span>` : ''}
          </div>
        </div>`;
    }

    // ── Engine Config Card ─────────────────────────────────────────────
    target.innerHTML += `
      <div class="engine-card">
        <div class="engine-card-header">
          <span class="ms">tune</span>
          <h3>Config</h3>
        </div>
        <div class="engine-config-grid">
          <div class="engine-config-item">
            <span class="engine-config-label">max_tool_rounds</span>
            <span class="engine-config-value">${config.max_tool_rounds ?? '—'}</span>
          </div>
          <div class="engine-config-item">
            <span class="engine-config-label">tool_timeout_secs</span>
            <span class="engine-config-value">${config.tool_timeout_secs ?? '—'}</span>
          </div>
          <div class="engine-config-item">
            <span class="engine-config-label">providers</span>
            <span class="engine-config-value">${config.providers.length}</span>
          </div>
          <div class="engine-config-item">
            <span class="engine-config-label">default_model</span>
            <span class="engine-config-value">${config.default_model ? esc(config.default_model) : '(not set)'}</span>
          </div>
        </div>
      </div>`;

    // ── Skills Card ────────────────────────────────────────────────────
    if (skillsInfo.length > 0) {
      const enabledSkills = skillsInfo.filter((s) => s.enabled);
      const readyCount = enabledSkills.filter((s) => s.is_ready).length;

      let skillRows = '';
      for (const skill of enabledSkills) {
        const ready = skill.missing_credentials.length === 0;
        skillRows += `
          <div class="engine-skill-row">
            <span class="engine-skill-icon">${esc(skill.icon)}</span>
            <span class="engine-skill-name">${esc(skill.name)}</span>
            <span class="engine-skill-status" style="color:${ready ? 'var(--success)' : 'var(--warning)'}">
              ${ready ? '● Ready' : `○ Missing: ${skill.missing_credentials.join(', ')}`}
            </span>
          </div>`;
      }

      target.innerHTML += `
        <div class="engine-card engine-card-wide">
          <div class="engine-card-header">
            <span class="ms">extension</span>
            <h3>Enabled Skills</h3>
            <span class="engine-card-count">${readyCount}/${enabledSkills.length} ready</span>
          </div>
          ${skillRows || '<p class="engine-empty-hint">No skills enabled.</p>'}
        </div>`;
    }
  } catch (e) {
    if (loading) loading.style.display = 'none';
    target.innerHTML = `<p style="color:var(--danger);padding:24px">Failed to load engine status: ${esc(String(e))}</p>`;
  }
}
