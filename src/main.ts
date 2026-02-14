// Claw Desktop - Main Application

interface Config {
  provider: string;
  apiKey: string;
  model: string;
  configured: boolean;
}

interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

// State
let config: Config = {
  provider: 'anthropic',
  apiKey: '',
  model: 'claude-sonnet-4-20250514',
  configured: false,
};

let messages: Message[] = [];
let isLoading = false;

// Gateway URL
const GATEWAY_URL = 'http://localhost:5757';

// DOM Elements
const setupView = document.getElementById('setup-view')!;
const chatView = document.getElementById('chat-view')!;
const agentsView = document.getElementById('agents-view')!;
const settingsView = document.getElementById('settings-view')!;
const statusDot = document.getElementById('status-dot')!;
const statusText = document.getElementById('status-text')!;
const chatMessages = document.getElementById('chat-messages')!;
const chatEmpty = document.getElementById('chat-empty')!;
const chatInput = document.getElementById('chat-input') as HTMLTextAreaElement;
const chatSend = document.getElementById('chat-send') as HTMLButtonElement;

// Navigation
document.querySelectorAll('.nav-item').forEach((item) => {
  item.addEventListener('click', () => {
    const view = item.getAttribute('data-view');
    if (view) switchView(view);
  });
});

function switchView(viewName: string) {
  // Update nav
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.getAttribute('data-view') === viewName);
  });

  // Update views
  [setupView, chatView, agentsView, settingsView].forEach((v) => v.classList.remove('active'));

  switch (viewName) {
    case 'chat':
      if (config.configured) {
        chatView.classList.add('active');
      } else {
        setupView.classList.add('active');
      }
      break;
    case 'agents':
      agentsView.classList.add('active');
      break;
    case 'settings':
      settingsView.classList.add('active');
      syncSettingsForm();
      break;
  }
}

// Setup Form
const setupForm = document.getElementById('setup-form') as HTMLFormElement;
setupForm.addEventListener('submit', async (e) => {
  e.preventDefault();

  const provider = (document.getElementById('provider-select') as HTMLSelectElement).value;
  const apiKey = (document.getElementById('api-key-input') as HTMLInputElement).value;
  const model = (document.getElementById('model-select') as HTMLSelectElement).value;

  if (!apiKey.trim()) {
    alert('Please enter an API key');
    return;
  }

  config = { provider, apiKey, model, configured: true };
  saveConfig();

  // Switch to chat view
  setupView.classList.remove('active');
  chatView.classList.add('active');
});

// Settings Form
document.getElementById('settings-save')?.addEventListener('click', () => {
  const provider = (document.getElementById('settings-provider') as HTMLSelectElement).value;
  const apiKey = (document.getElementById('settings-api-key') as HTMLInputElement).value;
  const model = (document.getElementById('settings-model') as HTMLSelectElement).value;

  if (apiKey.trim()) {
    config = { provider, apiKey, model, configured: true };
    saveConfig();
    alert('Settings saved!');
  }
});

function syncSettingsForm() {
  (document.getElementById('settings-provider') as HTMLSelectElement).value = config.provider;
  (document.getElementById('settings-api-key') as HTMLInputElement).value = config.apiKey;
  (document.getElementById('settings-model') as HTMLSelectElement).value = config.model;
}

// Config persistence
function saveConfig() {
  localStorage.setItem('claw-config', JSON.stringify(config));
}

function loadConfig() {
  const saved = localStorage.getItem('claw-config');
  if (saved) {
    try {
      config = JSON.parse(saved);
    } catch {
      // Invalid config, use defaults
    }
  }
}

// Chat functionality
chatSend.addEventListener('click', sendMessage);
chatInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    sendMessage();
  }
});

// Auto-resize textarea
chatInput.addEventListener('input', () => {
  chatInput.style.height = 'auto';
  chatInput.style.height = Math.min(chatInput.scrollHeight, 120) + 'px';
});

async function sendMessage() {
  const content = chatInput.value.trim();
  if (!content || isLoading) return;

  // Add user message
  addMessage({ role: 'user', content, timestamp: new Date() });
  chatInput.value = '';
  chatInput.style.height = 'auto';

  isLoading = true;
  chatSend.disabled = true;

  try {
    const response = await callLLM(content);
    addMessage({ role: 'assistant', content: response, timestamp: new Date() });
  } catch (error) {
    console.error('Error:', error);
    addMessage({
      role: 'assistant',
      content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
      timestamp: new Date(),
    });
  } finally {
    isLoading = false;
    chatSend.disabled = false;
  }
}

function addMessage(message: Message) {
  messages.push(message);
  renderMessages();
}

function renderMessages() {
  if (messages.length === 0) {
    chatEmpty.style.display = 'flex';
    return;
  }

  chatEmpty.style.display = 'none';

  // Clear and re-render (simple approach)
  const existingMessages = chatMessages.querySelectorAll('.message');
  existingMessages.forEach((m) => m.remove());

  messages.forEach((msg) => {
    const div = document.createElement('div');
    div.className = `message ${msg.role}`;

    const content = document.createElement('div');
    content.className = 'message-content';
    content.textContent = msg.content;

    const time = document.createElement('div');
    time.className = 'message-time';
    time.textContent = msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    div.appendChild(content);
    div.appendChild(time);
    chatMessages.appendChild(div);
  });

  // Scroll to bottom
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

async function callLLM(userMessage: string): Promise<string> {
  // Direct API call based on provider
  if (config.provider === 'anthropic') {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': config.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true',
      },
      body: JSON.stringify({
        model: config.model,
        max_tokens: 4096,
        messages: messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))
          .concat([{ role: 'user', content: userMessage }]),
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    return data.content[0]?.text || 'No response';
  } else if (config.provider === 'openai') {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.apiKey}`,
      },
      body: JSON.stringify({
        model: config.model,
        messages: messages
          .filter((m) => m.role === 'user' || m.role === 'assistant')
          .map((m) => ({ role: m.role, content: m.content }))
          .concat([{ role: 'user', content: userMessage }]),
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error?.message || `API error: ${response.status}`);
    }

    const data = await response.json();
    return data.choices[0]?.message?.content || 'No response';
  }

  throw new Error('Unsupported provider');
}

// Gateway status check
async function checkGatewayStatus() {
  try {
    const response = await fetch(`${GATEWAY_URL}/health`, {
      method: 'GET',
      signal: AbortSignal.timeout(2000),
    });

    if (response.ok) {
      statusDot.classList.add('connected');
      statusDot.classList.remove('error');
      statusText.textContent = 'Gateway Running';
    } else {
      throw new Error('Not OK');
    }
  } catch {
    statusDot.classList.remove('connected');
    statusDot.classList.add('error');
    statusText.textContent = 'Gateway Offline';
  }
}

// Initialize
document.addEventListener('DOMContentLoaded', () => {
  loadConfig();

  // Show appropriate view
  if (config.configured) {
    setupView.classList.remove('active');
    chatView.classList.add('active');
  } else {
    setupView.classList.add('active');
  }

  // Check gateway status
  checkGatewayStatus();
  setInterval(checkGatewayStatus, 10000);
});
