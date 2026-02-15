// Today View — Daily briefing with weather, calendar, tasks, and unread emails

import { gateway } from '../gateway';

const $ = (id: string) => document.getElementById(id);

interface Task {
  id: string;
  text: string;
  done: boolean;
  dueDate?: string;
  createdAt: string;
}

let _tasks: Task[] = [];

export function configure(_opts: Record<string, unknown>) {
  // Future: callbacks for navigation etc
}

export async function loadToday() {
  console.log('[today] loadToday called');
  loadTasks();
  renderToday();
  
  // Fetch live data
  await Promise.all([
    fetchWeather(),
    fetchUnreadEmails(),
  ]);
}

function loadTasks() {
  try {
    const stored = localStorage.getItem('paw-tasks');
    _tasks = stored ? JSON.parse(stored) : [];
  } catch {
    _tasks = [];
  }
}

function saveTasks() {
  localStorage.setItem('paw-tasks', JSON.stringify(_tasks));
}

async function fetchWeather() {
  const weatherEl = $('today-weather');
  if (!weatherEl) return;
  
  try {
    // Use gateway to get weather via skill
    const result = await gateway.rpc('tools.exec', {
      command: 'curl -s "wttr.in/?format=%c+%t+%C"',
      timeout: 5000,
    });
    if (result?.stdout) {
      weatherEl.innerHTML = `<span class="today-weather-temp">${result.stdout.trim()}</span>`;
    }
  } catch {
    weatherEl.innerHTML = '<span class="today-weather-unavailable">Weather unavailable</span>';
  }
}

async function fetchUnreadEmails() {
  const emailsEl = $('today-emails');
  if (!emailsEl) return;
  
  // This would integrate with mail module - for now show placeholder
  emailsEl.innerHTML = `
    <div class="today-section-empty">Connect email in Mail view to see unread messages</div>
  `;
}

function renderToday() {
  const container = $('today-content');
  if (!container) return;

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const greeting = getGreeting();

  const pendingTasks = _tasks.filter(t => !t.done);
  const completedToday = _tasks.filter(t => t.done && isToday(t.createdAt));

  container.innerHTML = `
    <div class="today-header">
      <div class="today-greeting">${greeting}</div>
      <div class="today-date">${dateStr}</div>
    </div>
    
    <div class="today-grid">
      <div class="today-main">
        <!-- Weather -->
        <div class="today-card">
          <div class="today-card-header">
            <span class="today-card-icon">☀️</span>
            <span class="today-card-title">Weather</span>
          </div>
          <div class="today-card-body" id="today-weather">
            <span class="today-loading">Loading...</span>
          </div>
        </div>
        
        <!-- Tasks -->
        <div class="today-card today-card-tasks">
          <div class="today-card-header">
            <span class="today-card-icon">✅</span>
            <span class="today-card-title">Tasks</span>
            <span class="today-card-count">${pendingTasks.length}</span>
            <button class="btn btn-ghost btn-sm today-add-task-btn">+ Add</button>
          </div>
          <div class="today-card-body">
            <div class="today-tasks" id="today-tasks">
              ${pendingTasks.length === 0 ? `
                <div class="today-section-empty">No tasks yet. Add one to get started!</div>
              ` : pendingTasks.map(task => `
                <div class="today-task" data-id="${task.id}">
                  <input type="checkbox" class="today-task-check" ${task.done ? 'checked' : ''}>
                  <span class="today-task-text">${escHtml(task.text)}</span>
                  <button class="today-task-delete" title="Delete">×</button>
                </div>
              `).join('')}
            </div>
            ${completedToday.length > 0 ? `
              <div class="today-completed-label">${completedToday.length} completed today</div>
            ` : ''}
          </div>
        </div>
        
        <!-- Unread Emails -->
        <div class="today-card">
          <div class="today-card-header">
            <span class="today-card-icon">📧</span>
            <span class="today-card-title">Unread Emails</span>
          </div>
          <div class="today-card-body" id="today-emails">
            <span class="today-loading">Loading...</span>
          </div>
        </div>
      </div>
      
      <div class="today-sidebar">
        <!-- Quick Actions -->
        <div class="today-card">
          <div class="today-card-header">
            <span class="today-card-icon">⚡</span>
            <span class="today-card-title">Quick Actions</span>
          </div>
          <div class="today-card-body">
            <button class="today-quick-action" id="today-briefing-btn">
              <span>🎙️</span> Morning Briefing
            </button>
            <button class="today-quick-action" id="today-summarize-btn">
              <span>📝</span> Summarize Inbox
            </button>
            <button class="today-quick-action" id="today-schedule-btn">
              <span>📅</span> What's on today?
            </button>
          </div>
        </div>
      </div>
    </div>
  `;

  bindEvents();
}

function bindEvents() {
  // Add task button
  $('today-content')?.querySelector('.today-add-task-btn')?.addEventListener('click', () => {
    openAddTaskModal();
  });

  // Task checkboxes
  document.querySelectorAll('.today-task-check').forEach(checkbox => {
    checkbox.addEventListener('change', (e) => {
      const taskEl = (e.target as HTMLElement).closest('.today-task');
      const taskId = taskEl?.getAttribute('data-id');
      if (taskId) toggleTask(taskId);
    });
  });

  // Task delete buttons
  document.querySelectorAll('.today-task-delete').forEach(btn => {
    btn.addEventListener('click', (e) => {
      const taskEl = (e.target as HTMLElement).closest('.today-task');
      const taskId = taskEl?.getAttribute('data-id');
      if (taskId) deleteTask(taskId);
    });
  });

  // Quick actions
  $('today-briefing-btn')?.addEventListener('click', () => triggerBriefing());
  $('today-summarize-btn')?.addEventListener('click', () => triggerInboxSummary());
  $('today-schedule-btn')?.addEventListener('click', () => triggerScheduleCheck());
}

function openAddTaskModal() {
  const modal = document.createElement('div');
  modal.className = 'today-modal';
  modal.innerHTML = `
    <div class="today-modal-dialog">
      <div class="today-modal-header">
        <span>Add Task</span>
        <button class="btn-icon today-modal-close">×</button>
      </div>
      <div class="today-modal-body">
        <input type="text" class="form-input" id="task-input" placeholder="What needs to be done?" autofocus>
      </div>
      <div class="today-modal-footer">
        <button class="btn btn-ghost today-modal-cancel">Cancel</button>
        <button class="btn btn-primary" id="task-submit">Add Task</button>
      </div>
    </div>
  `;
  document.body.appendChild(modal);

  const input = modal.querySelector('#task-input') as HTMLInputElement;
  input?.focus();

  const close = () => modal.remove();
  const submit = () => {
    const text = input?.value.trim();
    if (text) {
      addTask(text);
      close();
    }
  };

  modal.querySelector('.today-modal-close')?.addEventListener('click', close);
  modal.querySelector('.today-modal-cancel')?.addEventListener('click', close);
  modal.querySelector('#task-submit')?.addEventListener('click', submit);
  input?.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
  modal.addEventListener('click', (e) => { if (e.target === modal) close(); });
}

function addTask(text: string) {
  const task: Task = {
    id: `task-${Date.now()}`,
    text,
    done: false,
    createdAt: new Date().toISOString(),
  };
  _tasks.unshift(task);
  saveTasks();
  renderToday();
  showToast('Task added');
}

function toggleTask(taskId: string) {
  const task = _tasks.find(t => t.id === taskId);
  if (task) {
    task.done = !task.done;
    saveTasks();
    setTimeout(() => renderToday(), 300); // Delay for animation
  }
}

function deleteTask(taskId: string) {
  _tasks = _tasks.filter(t => t.id !== taskId);
  saveTasks();
  renderToday();
}

async function triggerBriefing() {
  showToast('Starting morning briefing...');
  try {
    await gateway.chatSend('Give me a morning briefing: weather, any calendar events today, and summarize my unread emails.');
  } catch {
    showToast('Failed to start briefing', 'error');
  }
}

async function triggerInboxSummary() {
  showToast('Summarizing inbox...');
  try {
    await gateway.chatSend('Check my email inbox and summarize the important unread messages.');
  } catch {
    showToast('Failed to summarize inbox', 'error');
  }
}

async function triggerScheduleCheck() {
  showToast('Checking schedule...');
  try {
    await gateway.chatSend('What do I have scheduled for today? Check my calendar.');
  } catch {
    showToast('Failed to check schedule', 'error');
  }
}

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function isToday(dateStr: string): boolean {
  const date = new Date(dateStr);
  const today = new Date();
  return date.toDateString() === today.toDateString();
}

function showToast(message: string, type: 'success' | 'error' = 'success') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.classList.add('show'), 10);
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function escHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function initToday() {
  // Called on app startup
}
