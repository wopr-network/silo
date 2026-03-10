export const UI_HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Silo Dashboard</title>
<style>
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { background: #0d1117; color: #c9d1d9; font-family: 'Courier New', monospace; font-size: 14px; }
#auth-overlay { position: fixed; inset: 0; background: #0d1117; display: flex; align-items: center; justify-content: center; z-index: 100; }
#auth-box { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 32px; width: 360px; }
#auth-box h2 { color: #58a6ff; margin-bottom: 16px; font-size: 18px; }
#auth-box input { width: 100%; background: #0d1117; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 12px; border-radius: 4px; font-family: inherit; font-size: 14px; margin-bottom: 12px; }
#auth-box button { width: 100%; background: #238636; border: none; color: #fff; padding: 8px; border-radius: 4px; cursor: pointer; font-size: 14px; }
#auth-box button:hover { background: #2ea043; }
nav { background: #161b22; border-bottom: 1px solid #30363d; padding: 0 24px; display: flex; align-items: center; gap: 0; }
nav h1 { color: #58a6ff; font-size: 16px; margin-right: 32px; padding: 14px 0; }
.tab { background: none; border: none; color: #8b949e; padding: 14px 16px; cursor: pointer; font-family: inherit; font-size: 14px; border-bottom: 2px solid transparent; }
.tab:hover { color: #c9d1d9; }
.tab.active { color: #58a6ff; border-bottom-color: #58a6ff; }
.tab-content { display: none; padding: 24px; }
.tab-content.active { display: block; }
.search-row { display: flex; gap: 8px; margin-bottom: 20px; }
.search-row input { flex: 1; background: #161b22; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 12px; border-radius: 4px; font-family: inherit; font-size: 14px; }
.search-row button, .btn { background: #21262d; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 16px; border-radius: 4px; cursor: pointer; font-family: inherit; font-size: 14px; }
.search-row button:hover, .btn:hover { background: #30363d; }
.timeline { display: flex; flex-direction: column; gap: 0; }
.timeline-item { display: flex; gap: 16px; padding: 12px 0; border-bottom: 1px solid #21262d; }
.timeline-dot { width: 10px; height: 10px; border-radius: 50%; background: #58a6ff; margin-top: 5px; flex-shrink: 0; }
.timeline-dot.gate-pass { background: #3fb950; }
.timeline-dot.gate-fail { background: #f85149; }
.timeline-dot.invocation { background: #d2a8ff; }
.timeline-body { flex: 1; }
.timeline-ts { color: #8b949e; font-size: 12px; margin-bottom: 4px; }
.timeline-label { font-weight: bold; color: #e6edf3; }
.timeline-sub { color: #8b949e; font-size: 12px; margin-top: 2px; }
.badge { display: inline-block; padding: 2px 8px; border-radius: 12px; font-size: 11px; font-weight: bold; }
.badge-pass { background: #0d4429; color: #3fb950; }
.badge-fail { background: #490202; color: #f85149; }
.badge-pending { background: #1c2a3a; color: #58a6ff; }
.badge-complete { background: #0d2d0d; color: #3fb950; }
.badge-amber { background: #2d1f00; color: #e3b341; }
.flow-select { background: #161b22; border: 1px solid #30363d; color: #c9d1d9; padding: 8px 12px; border-radius: 4px; font-family: inherit; font-size: 14px; margin-bottom: 20px; }
.flow-graph { position: relative; display: flex; gap: 32px; flex-wrap: wrap; align-items: flex-start; padding: 16px; background: #161b22; border: 1px solid #30363d; border-radius: 8px; min-height: 200px; }
.state-box { background: #0d1117; border: 1px solid #30363d; border-radius: 6px; padding: 12px 16px; min-width: 140px; }
.state-box.initial { border-color: #58a6ff; }
.state-box.terminal { border-color: #3fb950; }
.state-name { font-weight: bold; color: #e6edf3; margin-bottom: 4px; }
.state-count { color: #8b949e; font-size: 12px; }
.workers-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(200px, 1fr)); gap: 16px; margin-bottom: 24px; }
.stat-card { background: #161b22; border: 1px solid #30363d; border-radius: 8px; padding: 16px; }
.stat-card .label { color: #8b949e; font-size: 12px; margin-bottom: 4px; }
.stat-card .value { color: #e6edf3; font-size: 24px; font-weight: bold; }
table { width: 100%; border-collapse: collapse; }
th { text-align: left; padding: 8px 12px; color: #8b949e; font-size: 12px; border-bottom: 1px solid #30363d; }
td { padding: 8px 12px; border-bottom: 1px solid #21262d; vertical-align: top; }
td.ts { color: #8b949e; font-size: 12px; white-space: nowrap; }
td.type-cell { color: #d2a8ff; font-size: 12px; white-space: nowrap; }
td.entity-cell { color: #58a6ff; font-size: 12px; font-family: monospace; }
td.payload-cell { color: #8b949e; font-size: 11px; max-width: 400px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; cursor: pointer; }
td.payload-cell.expanded { white-space: pre-wrap; word-break: break-all; }
.filter-row { display: flex; gap: 8px; margin-bottom: 16px; align-items: center; }
.filter-row select { background: #161b22; border: 1px solid #30363d; color: #c9d1d9; padding: 6px 10px; border-radius: 4px; font-family: inherit; font-size: 13px; }
.filter-row label { color: #8b949e; font-size: 13px; }
#sse-status { position: fixed; bottom: 12px; right: 16px; font-size: 11px; color: #8b949e; }
#sse-status.connected { color: #3fb950; }
#sse-status.error { color: #f85149; }
.empty { color: #8b949e; text-align: center; padding: 32px; }
.error-msg { color: #f85149; margin: 8px 0; font-size: 13px; }
</style>
</head>
<body>

<div id="auth-overlay">
  <div id="auth-box">
    <h2>Silo</h2>
    <p style="color:#8b949e;margin-bottom:16px;font-size:13px;">Enter your admin token to continue.</p>
    <input type="password" id="token-input" placeholder="Admin token" autocomplete="off">
    <div id="auth-error" class="error-msg" style="display:none"></div>
    <button onclick="doLogin()">Connect</button>
  </div>
</div>

<nav>
  <h1>Silo</h1>
  <button class="tab active" onclick="showTab('entity-timeline', this)">Timeline</button>
  <button class="tab" onclick="showTab('flow-graph', this)">Flow Graph</button>
  <button class="tab" onclick="showTab('worker-dashboard', this)">Workers</button>
  <button class="tab" onclick="showTab('event-log', this)">Event Log</button>
</nav>

<!-- Entity Timeline -->
<div id="entity-timeline" class="tab-content active">
  <div class="search-row">
    <input id="entity-id-input" type="text" placeholder="Entity ID..." onkeydown="if(event.key==='Enter')loadTimeline()">
    <button onclick="loadTimeline()">Load</button>
  </div>
  <div id="timeline-container"><p class="empty">Enter an entity ID to view its timeline.</p></div>
</div>

<!-- Flow Graph -->
<div id="flow-graph" class="tab-content">
  <select id="flow-select" class="flow-select" onchange="loadFlowGraph()">
    <option value="">-- Select a flow --</option>
  </select>
  <div id="graph-container"><p class="empty">Select a flow to visualize its state graph.</p></div>
</div>

<!-- Worker Dashboard -->
<div id="worker-dashboard" class="tab-content">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px;">
    <h2 style="color:#e6edf3;font-size:16px;">Worker Dashboard</h2>
    <button class="btn" onclick="loadDashboard()">Refresh</button>
  </div>
  <div id="dashboard-container"><p class="empty">Loading...</p></div>
</div>

<!-- Event Log -->
<div id="event-log" class="tab-content">
  <div class="filter-row">
    <label>Filter by type:</label>
    <select id="event-type-filter" onchange="filterEventLog()">
      <option value="">All</option>
    </select>
    <button class="btn" onclick="loadEventLog()">Refresh</button>
  </div>
  <div id="event-log-container"><p class="empty">Loading events...</p></div>
</div>

<div id="sse-status">SSE: disconnected</div>

<script>
let TOKEN = '';
let sseSource = null;
let allEvents = [];
let dashboardDebounceTimer = null;

function scheduleDashboardRefresh() {
  if (dashboardDebounceTimer) clearTimeout(dashboardDebounceTimer);
  dashboardDebounceTimer = setTimeout(() => {
    dashboardDebounceTimer = null;
    if (document.getElementById('worker-dashboard').classList.contains('active')) {
      loadDashboard();
    }
  }, 100);
}

function ts(ms) {
  return new Date(typeof ms === 'number' ? ms : ms).toLocaleString();
}

function doLogin() {
  const v = document.getElementById('token-input').value.trim();
  if (!v) { showAuthError('Token required'); return; }
  TOKEN = v;
  sessionStorage.setItem('silo-token', v);
  verifyToken();
}

function showAuthError(msg) {
  const el = document.getElementById('auth-error');
  el.textContent = msg;
  el.style.display = 'block';
}

function verifyToken() {
  fetch('/api/ui/events/recent?limit=1', { headers: { Authorization: 'Bearer ' + TOKEN } })
    .then(r => {
      if (r.ok) {
        document.getElementById('auth-overlay').style.display = 'none';
        initApp();
      } else {
        showAuthError('Invalid token');
        TOKEN = '';
        sessionStorage.removeItem('silo-token');
      }
    })
    .catch(() => showAuthError('Connection failed'));
}

function initApp() {
  connectSSE();
  loadEventLog();
  loadFlowList();
  loadDashboard();
}

function connectSSE() {
  if (sseSource) sseSource.close();
  // Pass token via Authorization header using a fetch-based SSE reader to
  // avoid exposing it in the URL (which appears in server logs).
  // EventSource does not support custom headers, so we use fetch + ReadableStream.
  const ctrl = new AbortController();
  sseSource = ctrl; // store for close()
  fetch('/api/ui/events', { headers: { Authorization: 'Bearer ' + TOKEN }, signal: ctrl.signal })
    .then(r => {
      if (!r.ok) { handleSseError(); return; }
      const el = document.getElementById('sse-status');
      el.textContent = 'SSE: connected';
      el.className = 'connected';
      const reader = r.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';
      function pump() {
        reader.read().then(({ done, value }) => {
          if (done) { handleSseError(); return; }
          buf += decoder.decode(value, { stream: true });
          const lines = buf.split('\n');
          buf = lines.pop();
          for (const line of lines) {
            if (line.startsWith('data: ')) {
              try {
                const ev = JSON.parse(line.slice(6));
                prependEventRow(ev);
                scheduleDashboardRefresh();
              } catch (_) {}
            }
          }
          pump();
        }).catch(handleSseError);
      }
      pump();
    })
    .catch(handleSseError);
  function handleSseError() {
    const el = document.getElementById('sse-status');
    if (el) { el.textContent = 'SSE: reconnecting...'; el.className = 'error'; }
    setTimeout(() => connectSSE(), 5000);
  }
}
  sseSource.onopen = () => {
    const el = document.getElementById('sse-status');
    el.textContent = 'SSE: connected';
    el.className = 'connected';
  };
  sseSource.onerror = () => {
    const el = document.getElementById('sse-status');
    el.textContent = 'SSE: reconnecting...';
    el.className = 'error';
  };
  sseSource.onmessage = (e) => {
    try {
      const ev = JSON.parse(e.data);
      prependEventRow(ev);
      if (document.getElementById('worker-dashboard').classList.contains('active')) {
        loadDashboard();
      }
    } catch (_) {}
  };
}

function api(path) {
  return fetch(path, { headers: { Authorization: 'Bearer ' + TOKEN } }).then(r => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function showTab(id, btn) {
  document.querySelectorAll('.tab-content').forEach(el => el.classList.remove('active'));
  document.querySelectorAll('.tab').forEach(el => el.classList.remove('active'));
  document.getElementById(id).classList.add('active');
  btn.classList.add('active');
  if (id === 'worker-dashboard') loadDashboard();
  if (id === 'flow-graph') loadFlowList();
}

// ── Entity Timeline ──────────────────────────────────────────────

async function loadTimeline() {
  const id = document.getElementById('entity-id-input').value.trim();
  if (!id) return;
  const el = document.getElementById('timeline-container');
  el.innerHTML = '<p class="empty">Loading...</p>';
  try {
    const [entity, events, invocations, gates] = await Promise.all([
      api('/api/entities/' + encodeURIComponent(id)),
      api('/api/ui/entity/' + encodeURIComponent(id) + '/events'),
      api('/api/ui/entity/' + encodeURIComponent(id) + '/invocations'),
      api('/api/ui/entity/' + encodeURIComponent(id) + '/gates'),
    ]);

    // Build merged timeline
    const rows = [];

    if (entity && entity.id) {
      rows.push({ t: new Date(entity.createdAt).getTime(), kind: 'entity', label: 'Entity created', sub: 'Flow: ' + entity.flowId + ' | State: ' + entity.state });
    }

    for (const ev of (Array.isArray(events) ? events : [])) {
      rows.push({ t: ev.emittedAt, kind: ev.type, label: ev.type, sub: JSON.stringify(ev.payload || {}).slice(0, 120) });
    }

    for (const inv of (Array.isArray(invocations) ? invocations : [])) {
      const st = inv.startedAt ? new Date(inv.startedAt).getTime() : (inv.createdAt ? new Date(inv.createdAt).getTime() : 0);
      rows.push({ t: st, kind: 'invocation', label: 'Invocation: ' + inv.stage, sub: 'Status: ' + (inv.completedAt ? 'completed' : inv.failedAt ? 'failed' : 'pending') + (inv.signal ? ' | signal: ' + inv.signal : '') });
    }

    for (const g of (Array.isArray(gates) ? gates : [])) {
      rows.push({ t: g.evaluatedAt ? new Date(g.evaluatedAt).getTime() : 0, kind: g.passed ? 'gate-pass' : 'gate-fail', label: 'Gate: ' + g.gateId, sub: g.passed ? 'PASSED' : 'FAILED' + (g.output ? ' — ' + g.output.slice(0, 80) : '') });
    }

    rows.sort((a, b) => a.t - b.t);

    if (rows.length === 0) { el.innerHTML = '<p class="empty">No data for this entity.</p>'; return; }

    el.innerHTML = '<div class="timeline">' + rows.map(r => {
      let dotClass = 'timeline-dot';
      if (r.kind === 'gate-pass') dotClass += ' gate-pass';
      else if (r.kind === 'gate-fail') dotClass += ' gate-fail';
      else if (r.kind === 'invocation') dotClass += ' invocation';
      return '<div class="timeline-item"><div class="' + dotClass + '"></div><div class="timeline-body"><div class="timeline-ts">' + (r.t ? ts(r.t) : '—') + '</div><div class="timeline-label">' + esc(r.label) + '</div><div class="timeline-sub">' + esc(r.sub || '') + '</div></div></div>';
    }).join('') + '</div>';
  } catch (e) {
    el.innerHTML = '<p class="error-msg">Error: ' + esc(String(e)) + '</p>';
  }
}

// ── Flow Graph ───────────────────────────────────────────────────

async function loadFlowList() {
  try {
    const flows = await api('/api/flows');
    const sel = document.getElementById('flow-select');
    const prev = sel.value;
    sel.innerHTML = '<option value="">-- Select a flow --</option>';
    for (const f of (Array.isArray(flows) ? flows : [])) {
      const opt = document.createElement('option');
      opt.value = f.id;
      opt.textContent = f.name;
      sel.appendChild(opt);
    }
    if (prev) { sel.value = prev; loadFlowGraph(); }
  } catch (_) {}
}

async function loadFlowGraph() {
  const id = document.getElementById('flow-select').value;
  const el = document.getElementById('graph-container');
  if (!id) { el.innerHTML = '<p class="empty">Select a flow.</p>'; return; }
  el.innerHTML = '<p class="empty">Loading...</p>';
  try {
    const [flow, status] = await Promise.all([api('/api/flows/' + encodeURIComponent(id)), api('/api/status')]);
    const counts = {};
    if (status && status.flows) {
      for (const fstat of status.flows) {
        if (fstat.flowId === id && fstat.states) {
          for (const s of fstat.states) counts[s.state] = s.count;
        }
      }
    }
    const states = flow.states || [];
    const transitions = flow.transitions || [];
    const initial = flow.initialState;
    const terminalSet = new Set();
    for (const s of states) {
      const hasOut = transitions.some(t => t.fromState === s.name);
      if (!hasOut) terminalSet.add(s.name);
    }

    const boxes = states.map(s => {
      let cls = 'state-box';
      if (s.name === initial) cls += ' initial';
      if (terminalSet.has(s.name)) cls += ' terminal';
      return '<div class="' + cls + '"><div class="state-name">' + esc(s.name) + '</div><div class="state-count">' + (counts[s.name] || 0) + ' entities</div>' + (s.agentRole ? '<div class="state-count" style="color:#d2a8ff">' + esc(s.agentRole) + '</div>' : '') + '</div>';
    });

    el.innerHTML = '<div class="flow-graph">' + boxes.join('') + '</div>';
    if (transitions.length) {
      const list = transitions.map(t => '<tr><td>' + esc(t.fromState) + '</td><td style="color:#8b949e">→</td><td>' + esc(t.toState) + '</td><td style="color:#d2a8ff">' + esc(t.trigger) + '</td><td>' + (t.gateId ? '<span class="badge badge-amber">gated</span>' : '') + '</td></tr>').join('');
      el.innerHTML += '<h3 style="color:#8b949e;font-size:13px;margin:16px 0 8px">Transitions</h3><table><thead><tr><th>From</th><th></th><th>To</th><th>Trigger</th><th>Gate</th></tr></thead><tbody>' + list + '</tbody></table>';
    }
  } catch (e) {
    el.innerHTML = '<p class="error-msg">Error: ' + esc(String(e)) + '</p>';
  }
}

// ── Worker Dashboard ─────────────────────────────────────────────

async function loadDashboard() {
  const el = document.getElementById('dashboard-container');
  try {
    const status = await api('/api/status');
    let html = '<div class="workers-grid">';
    html += '<div class="stat-card"><div class="label">Active Invocations</div><div class="value">' + (status.activeInvocations || 0) + '</div></div>';
    html += '<div class="stat-card"><div class="label">Pending Claims</div><div class="value">' + (status.pendingClaims || 0) + '</div></div>';
    html += '<div class="stat-card"><div class="label">Total Entities</div><div class="value">' + (status.totalEntities || 0) + '</div></div>';
    html += '</div>';

    if (status.flows && status.flows.length) {
      html += '<h3 style="color:#e6edf3;font-size:14px;margin-bottom:12px;">Flows</h3><table><thead><tr><th>Flow</th><th>State</th><th>Count</th></tr></thead><tbody>';
      for (const f of status.flows) {
        for (const s of (f.states || [])) {
          html += '<tr><td style="color:#58a6ff">' + esc(f.flowName || f.flowId) + '</td><td>' + esc(s.state) + '</td><td>' + s.count + '</td></tr>';
        }
      }
      html += '</tbody></table>';
    }
    el.innerHTML = html;
  } catch (e) {
    el.innerHTML = '<p class="error-msg">Error: ' + esc(String(e)) + '</p>';
  }
}

// ── Event Log ────────────────────────────────────────────────────

async function loadEventLog() {
  const el = document.getElementById('event-log-container');
  try {
    const fetched = await api('/api/ui/events/recent?limit=200');
    const fetchedRows = Array.isArray(fetched) ? fetched : [];
    // Merge: keep SSE-injected events not in the fetched set (by id), then prepend fetched
    const fetchedIds = new Set(fetchedRows.map(e => e.id));
    const sseOnly = allEvents.filter(e => !fetchedIds.has(e.id));
    allEvents = [...sseOnly, ...fetchedRows];
    updateEventTypeFilter();
    renderEventLog();
  } catch (e) {
    el.innerHTML = '<p class="error-msg">Error: ' + esc(String(e)) + '</p>';
  }
}

function prependEventRow(ev) {
  // Convert SSE event to EventRow format
  const row = { id: ev.id || '', type: ev.type || '', entityId: ev.entityId || null, flowId: ev.flowId || null, payload: ev, emittedAt: ev.timestamp ? new Date(ev.timestamp).getTime() : Date.now() };
  allEvents.unshift(row);
  if (allEvents.length > 500) allEvents.pop();
  updateEventTypeFilter();
  renderEventLog();
}

function updateEventTypeFilter() {
  const sel = document.getElementById('event-type-filter');
  const cur = sel.value;
  const types = [...new Set(allEvents.map(e => e.type))].sort();
  sel.innerHTML = '<option value="">All</option>' + types.map(t => '<option value="' + esc(t) + '">' + esc(t) + '</option>').join('');
  if (cur) sel.value = cur;
}

function filterEventLog() { renderEventLog(); }

function renderEventLog() {
  const filter = document.getElementById('event-type-filter').value;
  const el = document.getElementById('event-log-container');
  const filtered = filter ? allEvents.filter(e => e.type === filter) : allEvents;
  if (!filtered.length) { el.innerHTML = '<p class="empty">No events.</p>'; return; }
  const rows = filtered.map(e => '<tr><td class="ts">' + ts(e.emittedAt) + '</td><td class="type-cell">' + esc(e.type) + '</td><td class="entity-cell">' + esc(e.entityId || '—') + "</td><td class="payload-cell" onclick="this.classList.toggle('expanded')">" + esc(JSON.stringify(e.payload || {})) + '</td></tr>').join('');
  el.innerHTML = '<table><thead><tr><th>Time</th><th>Type</th><th>Entity</th><th>Payload</th></tr></thead><tbody>' + rows + '</tbody></table>';
}

function esc(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
}

// ── Init ─────────────────────────────────────────────────────────

const savedToken = sessionStorage.getItem('silo-token');
if (savedToken) {
  TOKEN = savedToken;
  document.getElementById('token-input').value = savedToken;
  verifyToken();
}
</script>
</body>
</html>`;
