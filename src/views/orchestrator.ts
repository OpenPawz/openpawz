// Paw — Orchestrator View
// Multi-agent project coordination: create projects, assign agent teams,
// run boss-agent orchestration, and monitor the message bus in real-time.

import { pawEngine, EngineProject, EngineProjectAgent, EngineProjectMessage } from '../engine';
import { showToast } from '../components/toast';
import { listen } from '@tauri-apps/api/event';

let projects: EngineProject[] = [];
let currentProject: EngineProject | null = null;
let messagePollInterval: ReturnType<typeof setInterval> | null = null;

// ── DOM refs ───────────────────────────────────────────────────────────

const els = {
  get list() { return document.getElementById('orch-project-list')!; },
  get detail() { return document.getElementById('orch-project-detail')!; },
  get statTotal() { return document.getElementById('orch-stat-total')!; },
  get statRunning() { return document.getElementById('orch-stat-running')!; },
  get detailName() { return document.getElementById('orch-detail-name')!; },
  get detailStatus() { return document.getElementById('orch-detail-status')!; },
  get detailGoal() { return document.getElementById('orch-detail-goal')!; },
  get agentRoster() { return document.getElementById('orch-agent-roster')!; },
  get messageBus() { return document.getElementById('orch-message-bus')!; },
  // modals
  get modal() { return document.getElementById('orch-modal')!; },
  get modalTitle() { return document.getElementById('orch-modal-title')!; },
  get formTitle() { return document.getElementById('orch-form-title') as HTMLInputElement; },
  get formGoal() { return document.getElementById('orch-form-goal') as HTMLTextAreaElement; },
  get formBoss() { return document.getElementById('orch-form-boss') as HTMLInputElement; },
  get agentModal() { return document.getElementById('orch-agent-modal')!; },
  get agentFormId() { return document.getElementById('orch-agent-form-id') as HTMLInputElement; },
  get agentFormSpecialty() { return document.getElementById('orch-agent-form-specialty') as HTMLSelectElement; },
};

// ── Init ───────────────────────────────────────────────────────────────

export function initOrchestrator() {
  // Buttons
  document.getElementById('orch-create-btn')?.addEventListener('click', () => openCreateModal());
  document.getElementById('orch-modal-close')?.addEventListener('click', () => closeModal());
  document.getElementById('orch-modal-cancel')?.addEventListener('click', () => closeModal());
  document.getElementById('orch-modal-save')?.addEventListener('click', () => saveProject());
  document.getElementById('orch-back-btn')?.addEventListener('click', () => showList());
  document.getElementById('orch-run-btn')?.addEventListener('click', () => runProject());
  document.getElementById('orch-edit-btn')?.addEventListener('click', () => editProject());
  document.getElementById('orch-delete-btn')?.addEventListener('click', () => deleteProject());
  document.getElementById('orch-add-agent-btn')?.addEventListener('click', () => openAgentModal());
  document.getElementById('orch-agent-modal-close')?.addEventListener('click', () => closeAgentModal());
  document.getElementById('orch-agent-modal-cancel')?.addEventListener('click', () => closeAgentModal());
  document.getElementById('orch-agent-modal-save')?.addEventListener('click', () => addAgent());

  // Listen for project events from Rust backend
  listen<any>('project-event', (event) => {
    const data = event.payload;
    if (data.kind === 'project_started' || data.kind === 'project_finished' || data.kind === 'project_complete') {
      loadProjects();
      if (currentProject && currentProject.id === data.project_id) {
        loadProjectDetail(currentProject.id);
      }
    }
    if (data.kind === 'delegation' || data.kind === 'progress' || data.kind === 'message' || data.kind === 'agent_finished') {
      if (currentProject && currentProject.id === data.project_id) {
        refreshMessages();
        refreshAgents();
      }
    }
  });
}

// ── Load projects ──────────────────────────────────────────────────────

export async function loadProjects() {
  try {
    projects = await pawEngine.projectsList();
    renderList();
    updateStats();
  } catch (e) {
    console.error('[orchestrator] Failed to load projects:', e);
  }
}

function updateStats() {
  els.statTotal.textContent = `${projects.length} project${projects.length !== 1 ? 's' : ''}`;
  const running = projects.filter(p => p.status === 'running').length;
  els.statRunning.textContent = `${running} running`;
}

// ── Render list ────────────────────────────────────────────────────────

function renderList() {
  const container = els.list;
  if (projects.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <svg viewBox="0 0 24 24" width="48" height="48" stroke="currentColor" fill="none" stroke-width="1.5">
          <circle cx="12" cy="5" r="3"/><circle cx="5" cy="19" r="3"/><circle cx="19" cy="19" r="3"/>
          <line x1="12" y1="8" x2="5" y2="16"/><line x1="12" y1="8" x2="19" y2="16"/>
        </svg>
        <h3>No projects yet</h3>
        <p>Create a project to orchestrate multiple agents working together on a shared goal.</p>
      </div>`;
    return;
  }

  container.innerHTML = projects.map(p => `
    <div class="orch-project-card" data-id="${p.id}">
      <div class="orch-card-header">
        <span class="orch-card-title">${escapeHtml(p.title)}</span>
        <span class="orch-status-badge orch-status-${p.status}">${p.status}</span>
      </div>
      <div class="orch-card-goal">${escapeHtml(p.goal.substring(0, 120))}${p.goal.length > 120 ? '...' : ''}</div>
      <div class="orch-card-footer">
        <span class="orch-card-agents">${p.agents.length} agent${p.agents.length !== 1 ? 's' : ''}</span>
        <span class="orch-card-time">${timeAgo(p.updated_at)}</span>
      </div>
    </div>
  `).join('');

  // Click handlers
  container.querySelectorAll('.orch-project-card').forEach(card => {
    card.addEventListener('click', () => {
      const id = (card as HTMLElement).dataset.id!;
      loadProjectDetail(id);
    });
  });
}

// ── Project detail ─────────────────────────────────────────────────────

async function loadProjectDetail(projectId: string) {
  try {
    // Refresh project list first to get latest data
    projects = await pawEngine.projectsList();
    const project = projects.find(p => p.id === projectId);
    if (!project) {
      showToast('Project not found', 'error');
      return;
    }
    currentProject = project;

    els.list.style.display = 'none';
    els.detail.style.display = 'block';

    els.detailName.textContent = project.title;
    els.detailStatus.textContent = project.status;
    els.detailStatus.className = `orch-status-badge orch-status-${project.status}`;
    els.detailGoal.textContent = project.goal;

    // Update run button state
    const runBtn = document.getElementById('orch-run-btn')!;
    if (project.status === 'running') {
      runBtn.textContent = '⏳ Running...';
      (runBtn as HTMLButtonElement).disabled = true;
    } else {
      runBtn.textContent = '▶ Run';
      (runBtn as HTMLButtonElement).disabled = false;
    }

    renderAgentRoster(project.agents);
    await refreshMessages();

    // Start polling messages while viewing
    if (messagePollInterval) clearInterval(messagePollInterval);
    messagePollInterval = setInterval(() => {
      if (currentProject) refreshMessages();
    }, 3000);
  } catch (e) {
    console.error('[orchestrator] Failed to load project detail:', e);
  }
}

function showList() {
  currentProject = null;
  if (messagePollInterval) {
    clearInterval(messagePollInterval);
    messagePollInterval = null;
  }
  els.detail.style.display = 'none';
  els.list.style.display = 'block';
  loadProjects();
}

function renderAgentRoster(agents: EngineProjectAgent[]) {
  if (agents.length === 0) {
    els.agentRoster.innerHTML = '<div class="empty-state-sm">No agents assigned yet.</div>';
    return;
  }

  els.agentRoster.innerHTML = agents.map(a => `
    <div class="orch-agent-card orch-agent-${a.status}">
      <div class="orch-agent-header">
        <span class="orch-agent-icon">${specialtyIcon(a.specialty)}</span>
        <span class="orch-agent-name">${escapeHtml(a.agent_id)}</span>
        <span class="orch-agent-role-badge">${a.role}</span>
        <span class="orch-agent-status-dot orch-dot-${a.status}" title="${a.status}"></span>
        <button class="btn btn-ghost btn-xs orch-remove-agent" data-agent="${a.agent_id}" title="Remove">×</button>
      </div>
      <div class="orch-agent-meta">
        <span class="orch-agent-specialty">${a.specialty}</span>
        ${a.current_task ? `<span class="orch-agent-task" title="${escapeHtml(a.current_task)}">${escapeHtml(a.current_task.substring(0, 60))}</span>` : ''}
      </div>
    </div>
  `).join('');

  // Remove agent buttons
  els.agentRoster.querySelectorAll('.orch-remove-agent').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const agentId = (btn as HTMLElement).dataset.agent!;
      if (!currentProject) return;
      const newAgents = currentProject.agents.filter(a => a.agent_id !== agentId);
      await pawEngine.projectSetAgents(currentProject.id, newAgents);
      currentProject.agents = newAgents;
      renderAgentRoster(newAgents);
      showToast(`Removed agent ${agentId}`);
    });
  });
}

async function refreshAgents() {
  if (!currentProject) return;
  try {
    projects = await pawEngine.projectsList();
    const p = projects.find(p => p.id === currentProject!.id);
    if (p) {
      currentProject = p;
      renderAgentRoster(p.agents);
    }
  } catch (e) {
    // Ignore refresh errors
  }
}

async function refreshMessages() {
  if (!currentProject) return;
  try {
    const messages = await pawEngine.projectMessages(currentProject.id, 100);
    renderMessageBus(messages);
  } catch (e) {
    // Ignore refresh errors  
  }
}

function renderMessageBus(messages: EngineProjectMessage[]) {
  if (messages.length === 0) {
    els.messageBus.innerHTML = '<div class="empty-state-sm">No messages yet. Run the project to see agent communication.</div>';
    return;
  }

  els.messageBus.innerHTML = messages.map(m => {
    const kindClass = `orch-msg-${m.kind}`;
    const arrow = m.to_agent ? ` → ${escapeHtml(m.to_agent)}` : ' (broadcast)';
    return `
      <div class="orch-message ${kindClass}">
        <div class="orch-msg-header">
          <span class="orch-msg-kind">${messageKindLabel(m.kind)}</span>
          <span class="orch-msg-from">${escapeHtml(m.from_agent)}${arrow}</span>
          <span class="orch-msg-time">${formatTime(m.created_at)}</span>
        </div>
        <div class="orch-msg-content">${escapeHtml(m.content)}</div>
      </div>
    `;
  }).join('');

  // Auto-scroll to bottom
  els.messageBus.scrollTop = els.messageBus.scrollHeight;
}

// ── Create/Edit project ────────────────────────────────────────────────

let editingProjectId: string | null = null;

function openCreateModal() {
  editingProjectId = null;
  (document.getElementById('orch-modal-title')!).textContent = 'New Project';
  (document.getElementById('orch-modal-save')!).textContent = 'Create Project';
  els.formTitle.value = '';
  els.formGoal.value = '';
  els.formBoss.value = 'default';
  els.modal.style.display = 'flex';
}

function editProject() {
  if (!currentProject) return;
  editingProjectId = currentProject.id;
  (document.getElementById('orch-modal-title')!).textContent = 'Edit Project';
  (document.getElementById('orch-modal-save')!).textContent = 'Save Changes';
  els.formTitle.value = currentProject.title;
  els.formGoal.value = currentProject.goal;
  els.formBoss.value = currentProject.boss_agent;
  els.modal.style.display = 'flex';
}

function closeModal() {
  els.modal.style.display = 'none';
  editingProjectId = null;
}

async function saveProject() {
  const title = els.formTitle.value.trim();
  const goal = els.formGoal.value.trim();
  const boss = els.formBoss.value.trim() || 'default';

  if (!title) {
    showToast('Project title is required', 'error');
    return;
  }
  if (!goal) {
    showToast('Project goal is required', 'error');
    return;
  }

  try {
    if (editingProjectId) {
      // Update existing
      const existing = projects.find(p => p.id === editingProjectId);
      if (existing) {
        const updated: EngineProject = {
          ...existing,
          title,
          goal,
          boss_agent: boss,
        };
        await pawEngine.projectUpdate(updated);
        showToast('Project updated');
        if (currentProject) {
          await loadProjectDetail(editingProjectId);
        }
      }
    } else {
      // Create new
      const project: EngineProject = {
        id: crypto.randomUUID(),
        title,
        goal,
        status: 'planning',
        boss_agent: boss,
        agents: [
          { agent_id: boss, role: 'boss', specialty: 'general', status: 'idle', current_task: undefined },
        ],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      await pawEngine.projectCreate(project);
      // Also set the boss as the first agent
      await pawEngine.projectSetAgents(project.id, project.agents);
      showToast('Project created');
    }

    closeModal();
    await loadProjects();
  } catch (e: any) {
    showToast(`Error: ${e}`, 'error');
  }
}

async function deleteProject() {
  if (!currentProject) return;
  if (!confirm(`Delete project "${currentProject.title}"? This cannot be undone.`)) return;

  try {
    await pawEngine.projectDelete(currentProject.id);
    showToast('Project deleted');
    showList();
  } catch (e: any) {
    showToast(`Error: ${e}`, 'error');
  }
}

// ── Run project ────────────────────────────────────────────────────────

async function runProject() {
  if (!currentProject) return;
  if (currentProject.status === 'running') {
    showToast('Project is already running', 'error');
    return;
  }
  if (currentProject.agents.length === 0) {
    showToast('Add at least one agent before running', 'error');
    return;
  }

  try {
    await pawEngine.projectRun(currentProject.id);
    showToast('Project started! The boss agent is orchestrating.');

    // Update UI
    const runBtn = document.getElementById('orch-run-btn')!;
    runBtn.textContent = '⏳ Running...';
    (runBtn as HTMLButtonElement).disabled = true;
    els.detailStatus.textContent = 'running';
    els.detailStatus.className = 'orch-status-badge orch-status-running';
  } catch (e: any) {
    showToast(`Error: ${e}`, 'error');
  }
}

// ── Add agent ──────────────────────────────────────────────────────────

function openAgentModal() {
  els.agentFormId.value = '';
  els.agentFormSpecialty.value = 'general';
  els.agentModal.style.display = 'flex';
}

function closeAgentModal() {
  els.agentModal.style.display = 'none';
}

async function addAgent() {
  if (!currentProject) return;
  const agentId = els.agentFormId.value.trim();
  const specialty = els.agentFormSpecialty.value;

  if (!agentId) {
    showToast('Agent ID is required', 'error');
    return;
  }

  // Check if already assigned
  if (currentProject.agents.some(a => a.agent_id === agentId)) {
    showToast('This agent is already on the team', 'error');
    return;
  }

  const newAgent: EngineProjectAgent = {
    agent_id: agentId,
    role: 'worker',
    specialty,
    status: 'idle',
    current_task: undefined,
  };

  const allAgents = [...currentProject.agents, newAgent];
  try {
    await pawEngine.projectSetAgents(currentProject.id, allAgents);
    currentProject.agents = allAgents;
    renderAgentRoster(allAgents);
    closeAgentModal();
    showToast(`Added agent ${agentId}`);
  } catch (e: any) {
    showToast(`Error: ${e}`, 'error');
  }
}

// ── Helpers ────────────────────────────────────────────────────────────

function escapeHtml(text: string): string {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function specialtyIcon(specialty: string): string {
  const icons: Record<string, string> = {
    coder: '💻',
    researcher: '🔍',
    designer: '🎨',
    communicator: '📢',
    security: '🛡️',
    general: '🤖',
  };
  return icons[specialty] || '🤖';
}

function messageKindLabel(kind: string): string {
  const labels: Record<string, string> = {
    delegation: '📋 Delegation',
    progress: '📊 Progress',
    result: '✅ Result',
    error: '❌ Error',
    message: '💬 Message',
  };
  return labels[kind] || kind;
}

function timeAgo(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diff = now.getTime() - date.getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function formatTime(dateStr: string): string {
  try {
    const d = new Date(dateStr);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
  } catch {
    return dateStr;
  }
}
