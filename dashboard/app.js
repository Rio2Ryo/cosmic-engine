/* Cosmic Engine Dashboard - App Logic */

// ===== State =====
const state = {
  connected: false,
  tasks: { pending: [], running: [], completed: [], failed: [] },
  agents: [
    { name: 'scaffold', label: 'Scaffold Agent', status: 'idle', icon: '🏗️' },
    { name: 'code-gen', label: 'Code Generation Agent', status: 'idle', icon: '🧠' },
    { name: 'test', label: 'Test Agent', status: 'idle', icon: '🧪' },
    { name: 'review', label: 'Review Agent', status: 'idle', icon: '🔍' },
    { name: 'deploy', label: 'Deploy Agent', status: 'idle', icon: '🚀' },
  ],
  activityLog: [],
  logs: [],
  taskCounter: 0
};

// ===== DOM =====
const $ = (id) => document.getElementById(id);
const $$ = (sel) => document.querySelectorAll(sel);

// ===== Tab Navigation =====
document.querySelectorAll('.nav-item').forEach(item => {
  item.addEventListener('click', () => {
    const tab = item.dataset.tab;
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    item.classList.add('active');
    document.querySelectorAll('.tab-content').forEach(t => t.classList.remove('active'));
    $(`tab-${tab}`).classList.add('active');
    // Store preference
    localStorage.setItem('cosmic-tab', tab);
  });
});

// Restore last tab
const lastTab = localStorage.getItem('cosmic-tab');
if (lastTab) {
  const el = document.querySelector(`[data-tab="${lastTab}"]`);
  if (el) el.click();
}

// ===== Activity Feed =====
function addActivity(emoji, text) {
  const feed = document.getElementById('activity-feed');
  const empty = feed.querySelector('.activity-empty');
  if (empty) empty.remove();

  const now = new Date();
  const time = now.toLocaleTimeString('ja-JP', { hour12: false });

  const item = document.createElement('div');
  item.className = 'activity-item';
  item.innerHTML = `
    <span class="activity-time">${time}</span>
    <span class="activity-text">${emoji} ${text}</span>
  `;

  feed.prepend(item);
  state.activityLog.unshift({ time, text });

  // Keep max 50 items
  while (feed.children.length > 50) feed.lastChild.remove();
}

// ===== Logging =====
function addLog(level, message) {
  const entries = document.getElementById('log-entries');
  const now = new Date();
  const time = now.toLocaleTimeString('ja-JP', { hour12: false });

  const entry = document.createElement('div');
  entry.className = `log-entry log-${level}`;
  entry.innerHTML = `
    <span class="log-time">${time}</span>
    <span class="log-msg">${message}</span>
  `;
  entries.appendChild(entry);
  entries.scrollTop = entries.scrollHeight;

  state.logs.push({ time, level, message });
  addActivity(['info','success'].includes(level) ? 'ℹ️' : level === 'error' ? '❌' : '⚠️', message);
}

// ===== Stats Update =====
function updateStats() {
  const total = Object.values(state.tasks).flat().length;
  document.querySelector('#stat-total .stat-value').textContent = total;
  document.querySelector('#stat-pending .stat-value').textContent = state.tasks.pending.length;
  document.querySelector('#stat-running .stat-value').textContent = state.tasks.running.length;
  document.querySelector('#stat-completed .stat-value').textContent = state.tasks.completed.length + state.tasks.failed.length;
}

// ===== Task Management =====
function addTask(title, agent, status = 'pending') {
  state.taskCounter++;
  const id = `task-${state.taskCounter}`;
  const task = { id, title, agent, status };
  state.tasks[status].push(task);
  renderTasks();
  updateStats();
  addLog('info', `Task created: ${title} (${agent})`);
  return task;
}

function updateTaskStatus(taskId, newStatus) {
  for (const status of Object.keys(state.tasks)) {
    const idx = state.tasks[status].findIndex(t => t.id === taskId);
    if (idx !== -1) {
      const [task] = state.tasks[status].splice(idx, 1);
      task.status = newStatus;
      state.tasks[newStatus].push(task);
      renderTasks();
      updateStats();
      addLog(newStatus === 'completed' ? 'success' : newStatus === 'failed' ? 'error' : 'info',
        `Task ${taskId}: ${status} → ${newStatus}`);
      return task;
    }
  }
}

function renderTasks() {
  ['pending', 'running', 'completed', 'failed'].forEach(status => {
    const container = document.getElementById(`tasks-${status}`);
    container.innerHTML = state.tasks[status].map(t => `
      <div class="task-card" data-id="${t.id}">
        <div class="task-title">${t.title}</div>
        <div class="task-agent">🤖 ${state.agents.find(a => a.name === t.agent)?.label || t.agent}</div>
      </div>
    `).join('');
  });
}

// ===== Agent Status =====
function updateAgentStatus(agentName, status) {
  const agent = state.agents.find(a => a.name === agentName);
  if (agent) {
    agent.status = status;
    const card = document.querySelector(`[data-agent="${agentName}"] .agent-status`);
    if (card) {
      card.className = `agent-status ${status}`;
      card.textContent = status.charAt(0).toUpperCase() + status.slice(1);
    }
    addLog(status === 'running' ? 'info' : status === 'done' ? 'success' : status === 'error' ? 'error' : 'info',
      `Agent ${agent.label}: ${status}`);
  }
}

// ===== System Health =====
function updateServerStatus(status) {
  const el = document.getElementById('server-status');
  if (el) {
    el.textContent = status;
    el.className = `health-status ${status.toLowerCase()}`;
  }
}

function updateTokenBudget(text) {
  const el = document.getElementById('token-budget');
  if (el) el.textContent = text;
}

// ===== Connection =====
function setConnection(online) {
  state.connected = online;
  const dot = document.querySelector('#connection-status .status-dot');
  const text = document.querySelector('#connection-status span:last-child');
  if (online) {
    dot.className = 'status-dot online';
    text.textContent = 'Connected';
    addActivity('🔌', 'Dashboard connected to orchestrator');
  } else {
    dot.className = 'status-dot offline';
    text.textContent = 'Disconnected';
  }
}

// ===== Event Source (SSE) =====
let eventSource = null;

function connectSSE() {
  if (eventSource) eventSource.close();
  eventSource = new EventSource('/events');

  eventSource.onopen = () => {
    setConnection(true);
    updateServerStatus('Running');
  };

  eventSource.onmessage = (e) => {
    try {
      const data = JSON.parse(e.data);
      handleEvent(data);
    } catch (err) {
      // ignore parse errors
    }
  };

  eventSource.addEventListener('task', (e) => {
    const data = JSON.parse(e.data);
    if (data.action === 'create') addTask(data.title, data.agent, data.status);
    if (data.action === 'update') updateTaskStatus(data.id, data.status);
  });

  eventSource.addEventListener('agent', (e) => {
    const data = JSON.parse(e.data);
    updateAgentStatus(data.agent, data.status);
  });

  eventSource.addEventListener('log', (e) => {
    const data = JSON.parse(e.data);
    addLog(data.level, data.message);
  });

  eventSource.addEventListener('stats', (e) => {
    const data = JSON.parse(e.data);
    updateTokenBudget(data.tokenBudget || '-');
  });

  eventSource.onerror = () => {
    setConnection(false);
    updateServerStatus('Disconnected');
    // Auto-reconnect after 3s
    setTimeout(connectSSE, 3000);
  };
}

// ===== Event Handler =====
function handleEvent(data) {
  if (data.type === 'task' && data.action === 'create') {
    addTask(data.title, data.agent, data.status);
  }
  if (data.type === 'task' && data.action === 'update') {
    updateTaskStatus(data.id, data.status);
  }
  if (data.type === 'agent') {
    updateAgentStatus(data.agent, data.status);
  }
  if (data.type === 'log') {
    addLog(data.level, data.message);
  }
  if (data.type === 'stats') {
    updateTokenBudget(data.tokenBudget || '-');
  }
}

// ===== Playground Actions =====
document.getElementById('btn-launch')?.addEventListener('click', async () => {
  const project = document.getElementById('input-project').value;
  const template = document.getElementById('input-template').value;
  const features = [...document.querySelectorAll('#input-features input:checked')].map(cb => cb.value);

  const output = document.getElementById('playground-output');
  output.textContent = '🚀 Launching agent fleet...\n';

  try {
    const res = await fetch('/api/launch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ project, template, features })
    });
    const result = await res.json();
    output.textContent = JSON.stringify(result, null, 2);
    addActivity('🚀', `Launch: ${project} (${template})`);
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  }
});

document.getElementById('btn-status')?.addEventListener('click', async () => {
  const output = document.getElementById('playground-output');
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    output.textContent = JSON.stringify(data, null, 2);
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  }
});

document.getElementById('btn-sample')?.addEventListener('click', async () => {
  const output = document.getElementById('playground-output');
  output.textContent = '📦 Generating sample app...\n';

  try {
    const res = await fetch('/api/sample', { method: 'POST' });
    const data = await res.json();
    output.textContent = JSON.stringify(data, null, 2);
    addActivity('📦', 'Sample app generated');
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  }
});

document.getElementById('btn-serve-demo')?.addEventListener('click', async () => {
  const output = document.getElementById('playground-output');
  output.textContent = '🌐 Serving demo app...\n';

  try {
    const res = await fetch('/api/serve-demo', { method: 'POST' });
    const data = await res.json();
    output.textContent = JSON.stringify(data, null, 2);
    addActivity('🌐', 'Demo app served');
  } catch (err) {
    output.textContent = `Error: ${err.message}`;
  }
});

document.getElementById('btn-run-cycle')?.addEventListener('click', async () => {
  addActivity('▶️', 'Manual cycle triggered');
  try {
    const res = await fetch('/api/cycle', { method: 'POST' });
    const data = await res.json();
    addLog('info', `Cycle completed: ${JSON.stringify(data)}`);
  } catch (err) {
    addLog('error', `Cycle failed: ${err.message}`);
  }
});

document.getElementById('btn-refresh')?.addEventListener('click', async () => {
  addActivity('🔄', 'Manual refresh');
  try {
    const res = await fetch('/api/status');
    const data = await res.json();
    if (data.tasks) {
      Object.entries(data.tasks).forEach(([status, tasks]) => {
        tasks.forEach(t => addTask(t.title, t.agent, status));
      });
    }
    addLog('info', 'Dashboard refreshed');
  } catch (err) {
    addLog('error', `Refresh failed: ${err.message}`);
  }
});

document.getElementById('btn-clear-logs')?.addEventListener('click', () => {
  document.getElementById('log-entries').innerHTML = '';
  state.logs = [];
});

// ===== Graph (D3-like SVG rendering) =====
function renderGraph(nodes, edges) {
  const container = document.getElementById('task-graph');
  if (!nodes || nodes.length === 0) {
    container.innerHTML = '<div class="placeholder">No tasks yet.</div>';
    return;
  }

  let svg = `<svg width="100%" height="250" viewBox="0 0 800 250" style="background: transparent;">`;
  // Draw edges
  edges.forEach((e, i) => {
    const from = nodes.find(n => n.id === e.from);
    const to = nodes.find(n => n.id === e.to);
    if (from && to) {
      svg += `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}" stroke="#2a2a3e" stroke-width="2" />`;
    }
  });
  // Draw nodes
  nodes.forEach((n, i) => {
    const colors = { pending: '#ffd54f', running: '#448aff', completed: '#00e676', failed: '#ff5252' };
    const color = colors[n.status] || '#606080';
    svg += `<circle cx="${n.x}" cy="${n.y}" r="20" fill="${color}" opacity="0.8" stroke="#1a1a26" stroke-width="3" />`;
    svg += `<text x="${n.x}" y="${n.y + 4}" text-anchor="middle" fill="white" font-size="10" font-weight="600">${n.label}</text>`;
  });
  svg += '</svg>';
  container.innerHTML = svg;
}

// ===== Initialize =====
function init() {
  // Simulate some initial activity for the demo
  addLog('info', 'Dashboard initialized');
  addActivity('✨', 'Cosmic Engine dashboard ready');
  updateServerStatus('Standby');
  updateTokenBudget('∞');

  // Auto-connect SSE after 1s
  setTimeout(connectSSE, 1000);

  // Periodic health check
  setInterval(async () => {
    try {
      const res = await fetch('/api/health');
      if (res.ok) {
        setConnection(true);
        updateServerStatus('Running');
      }
    } catch {
      // SSE handles disconnection
    }
  }, 15000);
}

// Start when ready
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
