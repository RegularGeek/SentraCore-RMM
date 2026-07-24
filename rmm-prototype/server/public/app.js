// SentraCore RMM Dashboard client
// Adds on top of live monitoring: auth/session handling, tabs per agent
// (Overview / History / Inventory / Scripts), an alerts drawer with
// threshold-rule management, and a remote script console with audit trail.
//
// Auth-restructuring change: api() now echoes the CSRF cookie back as a
// header on every request, since the server enforces the double-submit
// CSRF check on all state-changing /api/* routes. No other behavior here
// changed.

const HISTORY_LEN = 60; // ~2 min of live history at 2s/sample

const state = {
  agents: new Map(),
  selectedId: null,
  activeTab: "overview",
  historyRange: "1h",
  alerts: [],
  rules: [],
  scriptRuns: [], // for the currently selected agent
  scriptPending: false,
  role: null,
};

const el = {
  connDot: document.getElementById("connDot"),
  connLabel: document.getElementById("connLabel"),
  agentList: document.getElementById("agentList"),
  agentCount: document.getElementById("agentCount"),
  detail: document.getElementById("detail"),
  sessionInfo: document.getElementById("sessionInfo"),
  logoutBtn: document.getElementById("logoutBtn"),
  alertsBtn: document.getElementById("alertsBtn"),
  alertsBadge: document.getElementById("alertsBadge"),
  drawer: document.getElementById("alertsDrawer"),
  drawerBackdrop: document.getElementById("drawerBackdrop"),
  closeDrawerBtn: document.getElementById("closeDrawerBtn"),
  activeAlertsList: document.getElementById("activeAlertsList"),
  rulesList: document.getElementById("rulesList"),
  ruleForm: document.getElementById("ruleForm"),
};

function readCookie(name) {
  const match = document.cookie.match(new RegExp("(?:^|; )" + name + "=([^;]*)"));
  return match ? decodeURIComponent(match[1]) : null;
}

async function api(path, opts = {}) {
  const res = await fetch(path, {
    headers: {
      "Content-Type": "application/json",
      "x-csrf-token": readCookie("sentracore.csrf") || "",
    },
    credentials: "same-origin",
    ...opts,
  });
  if (res.status === 401) {
    window.location.href = "/login.html";
    throw new Error("not authenticated");
  }
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `request failed (${res.status})`);
  }
  return res.status === 204 ? null : res.json();
}

// ---- Boot ----
async function boot() {
  try {
    const session = await api("/api/session");
    el.sessionInfo.textContent = `${session.username} · ${session.orgName} · ${session.role}`;
    state.role = session.role;
  } catch {
    return; // api() already redirected to /login.html
  }
  await Promise.all([loadAlerts(), loadRules()]);
  connect();
  renderAll();
}

el.logoutBtn.addEventListener("click", async () => {
  await api("/api/logout", { method: "POST" }).catch(() => {});
  window.location.href = "/login.html";
});

// ---- Agent live-state helpers ----
function emptyHistory() {
  return { cpu: [], mem: [], disk: [], netRx: [], netTx: [] };
}
function pushHistory(hist, data) {
  hist.cpu.push(data.cpuLoad);
  hist.mem.push(data.memUsedPct);
  hist.disk.push(data.diskUsedPct);
  hist.netRx.push(data.netRxKBs);
  hist.netTx.push(data.netTxKBs);
  for (const key of Object.keys(hist)) {
    if (hist[key].length > HISTORY_LEN) hist[key].shift();
  }
}
function ensureAgent(id) {
  if (!state.agents.has(id)) {
    state.agents.set(id, { info: {}, status: "offline", lastMetrics: null, history: emptyHistory() });
  }
  return state.agents.get(id);
}

// ---- WebSocket (live metrics + alerts + script results) ----
let ws;
let retryDelay = 1000;

function connect() {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  ws = new WebSocket(`${proto}://${location.host}/ws/dashboard`);

  ws.onopen = () => { retryDelay = 1000; setConn(true); };
  ws.onclose = () => { setConn(false); setTimeout(connect, retryDelay); retryDelay = Math.min(retryDelay * 2, 15000); };
  ws.onerror = () => ws.close();

  ws.onmessage = (evt) => {
    const msg = JSON.parse(evt.data);

    if (msg.type === "snapshot") {
      for (const a of msg.agents) {
        const agent = ensureAgent(a.id);
        agent.info = a.info;
        agent.status = a.status;
        agent.lastMetrics = a.lastMetrics;
        if (a.lastMetrics) pushHistory(agent.history, a.lastMetrics);
      }
      renderAll();
    }

    if (msg.type === "agent_online") {
      const agent = ensureAgent(msg.id);
      agent.info = msg.info;
      agent.status = "online";
      renderAll();
    }

    if (msg.type === "agent_offline") {
      const agent = state.agents.get(msg.id);
      if (agent) agent.status = "offline";
      renderAll();
    }

    if (msg.type === "metrics") {
      const agent = ensureAgent(msg.id);
      agent.status = "online";
      agent.lastMetrics = msg.data;
      pushHistory(agent.history, msg.data);
      renderAll();
    }

    if (msg.type === "alert") {
      state.alerts.unshift(msg.event);
      renderAlertsBadge();
      renderDrawer();
    }

    if (msg.type === "alert_resolved") {
      const a = state.alerts.find((x) => x.id === msg.id);
      if (a) a.status = "resolved";
      renderAlertsBadge();
      renderDrawer();
    }

    if (msg.type === "script_result") {
      if (state.selectedId === msg.agentId && state.activeTab === "scripts") {
        loadScriptRuns(msg.agentId);
      }
      state.scriptPending = false;
    }
  };
}

function setConn(live) {
  el.connDot.classList.toggle("live", live);
  el.connDot.classList.toggle("down", !live);
  el.connLabel.textContent = live ? "connected" : "reconnecting…";
}

// ---- Alerts drawer ----
async function loadAlerts() {
  state.alerts = await api("/api/alerts").catch(() => []);
  renderAlertsBadge();
}
async function loadRules() {
  state.rules = await api("/api/alert-rules").catch(() => []);
}

function renderAlertsBadge() {
  const activeCount = state.alerts.filter((a) => a.status === "firing").length;
  el.alertsBadge.hidden = activeCount === 0;
  el.alertsBadge.textContent = activeCount;
}

function openDrawer() {
  el.drawer.classList.add("open");
  el.drawerBackdrop.classList.add("open");
  renderDrawer();
}
function closeDrawer() {
  el.drawer.classList.remove("open");
  el.drawerBackdrop.classList.remove("open");
}
el.alertsBtn.addEventListener("click", openDrawer);
el.closeDrawerBtn.addEventListener("click", closeDrawer);
el.drawerBackdrop.addEventListener("click", closeDrawer);

function metricLabel(metric) {
  return { cpuLoad: "CPU load", memUsedPct: "Memory", diskUsedPct: "Disk" }[metric] || metric;
}

function renderDrawer() {
  const active = state.alerts.filter((a) => a.status === "firing");
  el.activeAlertsList.innerHTML = active.length
    ? active.map((a) => `
        <div class="alert-row">
          <div>
            <div class="alert-row-title">${escapeHtml(a.hostname || a.agent_id)}</div>
            <div class="alert-row-sub">${metricLabel(a.metric)} = ${a.value} · triggered ${new Date(a.triggered_at).toLocaleTimeString()}</div>
          </div>
          <button class="ack-btn" data-id="${a.id}">Ack</button>
        </div>`).join("")
    : `<div class="empty-hint">No active alerts.</div>`;

  el.activeAlertsList.querySelectorAll(".ack-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/alerts/${btn.dataset.id}/ack`, { method: "POST" }).catch(() => {});
      await loadAlerts();
      renderDrawer();
    });
  });

  el.rulesList.innerHTML = state.rules.length
    ? state.rules.map((r) => `
        <div class="rule-row">
          <span>${metricLabel(r.metric)} ${r.comparator} ${r.threshold}${r.webhook_url ? " · webhook" : ""}</span>
          <button class="del-btn" data-id="${r.id}">delete</button>
        </div>`).join("")
    : `<div class="empty-hint">No rules yet — endpoints won't alert until you add one.</div>`;

  el.rulesList.querySelectorAll(".del-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await api(`/api/alert-rules/${btn.dataset.id}`, { method: "DELETE" }).catch(() => {});
      await loadRules();
      renderDrawer();
    });
  });
}

el.ruleForm.addEventListener("submit", async (e) => {
  e.preventDefault();
  const metric = document.getElementById("ruleMetric").value;
  const comparator = document.getElementById("ruleComparator").value;
  const threshold = Number(document.getElementById("ruleThreshold").value);
  const webhookUrl = document.getElementById("ruleWebhook").value.trim() || undefined;
  await api("/api/alert-rules", { method: "POST", body: JSON.stringify({ metric, comparator, threshold, webhookUrl }) }).catch(() => {});
  document.getElementById("ruleThreshold").value = "";
  document.getElementById("ruleWebhook").value = "";
  await loadRules();
  renderDrawer();
});

// ---- Rendering: sidebar ----
function renderAll() {
  renderSidebar();
  renderDetail();
}

function fmtUptime(sec) {
  if (!sec && sec !== 0) return "–";
  const d = Math.floor(sec / 86400), h = Math.floor((sec % 86400) / 3600), m = Math.floor((sec % 3600) / 60);
  if (d > 0) return `${d}d ${h}h`;
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

function renderSidebar() {
  const ids = [...state.agents.keys()];
  el.agentCount.textContent = ids.length;

  if (ids.length === 0) {
    el.agentList.innerHTML = `<div class="empty-hint">No agents connected yet.<br>Start one with <code>npm start</code> in <code>/agent</code>.</div>`;
    return;
  }

  ids.sort((a, b) => {
    const A = state.agents.get(a), B = state.agents.get(b);
    if (A.status !== B.status) return A.status === "online" ? -1 : 1;
    return (A.info.hostname || "").localeCompare(B.info.hostname || "");
  });

  el.agentList.innerHTML = ids.map((id) => {
    const a = state.agents.get(id);
    const host = a.info.hostname || id.slice(0, 8);
    const cpu = a.lastMetrics ? `${a.lastMetrics.cpuLoad}% cpu` : "no data";
    const selected = id === state.selectedId ? "selected" : "";
    return `
      <div class="agent-card ${selected}" data-id="${id}">
        <div class="agent-card-top">
          <span class="status-dot ${a.status}"></span>
          <span class="agent-hostname">${escapeHtml(host)}</span>
        </div>
        <div class="agent-meta">${escapeHtml(a.info.platform || "unknown")} · ${a.info.cores || "?"} cores</div>
        <div class="agent-mini-cpu">${cpu}</div>
      </div>`;
  }).join("");

  el.agentList.querySelectorAll(".agent-card").forEach((node) => {
    node.addEventListener("click", () => {
      if (state.selectedId !== node.dataset.id) {
        state.selectedId = node.dataset.id;
        state.activeTab = "overview";
      }
      renderAll();
    });
  });

  if (!state.selectedId && ids.length > 0) state.selectedId = ids[0];
}

// ---- Rendering: detail pane / tabs ----
const TABS = [
  { id: "overview", label: "Overview" },
  { id: "history", label: "History" },
  { id: "inventory", label: "Inventory" },
  { id: "scripts", label: "Scripts" },
];

function renderDetail() {
  const id = state.selectedId;
  const a = id ? state.agents.get(id) : null;

  if (!a) {
    el.detail.innerHTML = `<div class="empty-state"><div class="empty-glyph">◌</div><p>Select an endpoint to view live metrics.</p></div>`;
    return;
  }

  const host = a.info.hostname || id.slice(0, 8);
  const m = a.lastMetrics;

  el.detail.innerHTML = `
    <div class="detail-head">
      <div class="detail-hostname">${escapeHtml(host)}</div>
      <div class="detail-sub">
        ${escapeHtml(a.info.distro || a.info.platform || "unknown os")}
        <span>·</span>${escapeHtml(a.info.cpuModel || "unknown cpu")}
        <span>·</span>uptime ${fmtUptime(m ? m.uptimeSec : null)}
      </div>
      <div class="tabs">
        ${TABS.map((t) => `<button class="tab ${state.activeTab === t.id ? "active" : ""}" data-tab="${t.id}">${t.label}</button>`).join("")}
      </div>
    </div>
    <div id="tabBody"></div>
  `;

  el.detail.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.activeTab = btn.dataset.tab;
      renderDetail();
    });
  });

  const body = document.getElementById("tabBody");
  if (state.activeTab === "overview") renderOverviewTab(body, a);
  if (state.activeTab === "history") renderHistoryTab(body, id);
  if (state.activeTab === "inventory") renderInventoryTab(body, id);
  if (state.activeTab === "scripts") renderScriptsTab(body, id);
}

// ---- Overview tab (live oscilloscope traces) ----
function metricCard(label, valueHtml, subText, canvasId) {
  return `
    <div class="metric-card">
      <div class="metric-card-head">
        <span class="metric-label">${label}</span>
        <span class="metric-value">${valueHtml}</span>
      </div>
      <canvas class="trace" id="${canvasId}"></canvas>
      <div class="metric-sub">${subText}</div>
    </div>`;
}

function renderOverviewTab(body, a) {
  const m = a.lastMetrics;
  if (!m) {
    body.innerHTML = `<div class="offline-banner">No metrics received yet from this endpoint.</div>`;
    return;
  }
  body.innerHTML = `
    <div class="metric-grid">
      ${metricCard("CPU load", `${m.cpuLoad}<span class="unit">%</span>`, `${a.info.cores || "?"} cores`, "trace-cpu")}
      ${metricCard("Memory", `${m.memUsedPct}<span class="unit">%</span>`, `${m.memUsedGB} / ${m.memTotalGB} GB`, "trace-mem")}
      ${metricCard("Disk", `${m.diskUsedPct}<span class="unit">%</span>`, `${m.diskUsedGB} / ${m.diskTotalGB} GB`, "trace-disk")}
      ${metricCard("Network", `${(m.netRxKBs + m.netTxKBs).toFixed(1)}<span class="unit">KB/s</span>`, `↓ ${m.netRxKBs} KB/s  ↑ ${m.netTxKBs} KB/s`, "trace-net")}
    </div>
    ${a.status === "offline" ? `<div class="offline-banner">This endpoint is offline. Showing last known metrics.</div>` : ""}
  `;
  drawTrace("trace-cpu", a.history.cpu, "#4FD1C5", 100, HISTORY_LEN);
  drawTrace("trace-mem", a.history.mem, "#F0A857", 100, HISTORY_LEN);
  drawTrace("trace-disk", a.history.disk, "#E5675A", 100, HISTORY_LEN);
  drawTraceDual("trace-net", a.history.netRx, a.history.netTx, "#4FD1C5", "#8A94A6", HISTORY_LEN);
}

// ---- History tab (persisted trends) ----
async function renderHistoryTab(body, agentId) {
  body.innerHTML = `
    <div class="range-picker">
      ${["1h", "24h", "7d"].map((r) => `<button class="range-btn ${state.historyRange === r ? "active" : ""}" data-range="${r}">${r}</button>`).join("")}
    </div>
    <div class="metric-grid" id="historyGrid"><div class="empty-hint">Loading history…</div></div>
  `;
  body.querySelectorAll(".range-btn").forEach((btn) => {
    btn.addEventListener("click", () => { state.historyRange = btn.dataset.range; renderHistoryTab(body, agentId); });
  });

  const rows = await api(`/api/agents/${agentId}/history?range=${state.historyRange}`).catch(() => []);
  const grid = document.getElementById("historyGrid");
  if (!rows.length) {
    grid.innerHTML = `<div class="empty-hint">No historical data yet for this range.</div>`;
    return;
  }
  grid.innerHTML = `
    ${metricCard("CPU load", "", `last ${state.historyRange}`, "hist-cpu")}
    ${metricCard("Memory", "", `last ${state.historyRange}`, "hist-mem")}
    ${metricCard("Disk", "", `last ${state.historyRange}`, "hist-disk")}
  `;
  drawTrace("hist-cpu", rows.map((r) => r.cpuLoad), "#4FD1C5", 100);
  drawTrace("hist-mem", rows.map((r) => r.memUsedPct), "#F0A857", 100);
  drawTrace("hist-disk", rows.map((r) => r.diskUsedPct), "#E5675A", 100);
}

// ---- Inventory tab ----
async function renderInventoryTab(body, agentId) {
  body.innerHTML = `<div class="empty-hint">Loading inventory…</div>`;
  const inv = await api(`/api/agents/${agentId}/inventory`).catch(() => null);
  if (!inv) {
    body.innerHTML = `<div class="empty-hint">No inventory collected yet — the agent sends this shortly after connecting, then every 30 minutes.</div>`;
    return;
  }
  const hw = inv.hardware || {};
  const kv = (label, value) => `<div class="kv"><span class="kv-label">${label}</span><span class="kv-value">${escapeHtml(String(value ?? "–"))}</span></div>`;

  body.innerHTML = `
    <div class="inv-grid">
      <div class="metric-card">
        <div class="metric-label" style="margin-bottom:10px;">System</div>
        ${kv("Model", `${hw.system?.manufacturer || ""} ${hw.system?.model || ""}`.trim())}
        ${kv("OS", `${hw.os?.distro || hw.os?.platform || ""} (${hw.os?.arch || ""})`)}
        ${kv("Kernel", hw.os?.kernel)}
      </div>
      <div class="metric-card">
        <div class="metric-label" style="margin-bottom:10px;">CPU</div>
        ${kv("Model", `${hw.cpu?.manufacturer || ""} ${hw.cpu?.brand || ""}`.trim())}
        ${kv("Cores", `${hw.cpu?.physicalCores || "?"} physical / ${hw.cpu?.cores || "?"} logical`)}
        ${kv("Speed", hw.cpu?.speedGHz ? `${hw.cpu.speedGHz} GHz` : "–")}
      </div>
      <div class="metric-card">
        <div class="metric-label" style="margin-bottom:10px;">Memory</div>
        ${(hw.memoryModules || []).map((m, i) => kv(`Module ${i + 1}`, `${m.sizeGB} GB · ${m.type || "?"}`)).join("") || kv("Modules", "unknown")}
      </div>
      <div class="metric-card">
        <div class="metric-label" style="margin-bottom:10px;">Disks</div>
        ${(hw.disks || []).map((d) => kv(d.name, `${d.sizeGB} GB · ${d.type || d.interfaceType || "?"}`)).join("") || kv("Disks", "unknown")}
      </div>
      <div class="metric-card">
        <div class="metric-label" style="margin-bottom:10px;">Graphics</div>
        ${(hw.graphics || []).map((g) => kv(g.model, g.vramMB ? `${g.vramMB} MB VRAM` : "")).join("") || kv("GPU", "unknown")}
      </div>
      <div class="metric-card">
        <div class="metric-label" style="margin-bottom:10px;">Network</div>
        ${(hw.network || []).map((n) => kv(n.iface, `${n.ip4 || "no IP"} · ${n.mac || ""}`)).join("") || kv("Interfaces", "unknown")}
      </div>
    </div>
    <div class="metric-card" style="margin-top:16px;">
      <div class="metric-card-head">
        <span class="metric-label">Installed software</span>
        <span class="metric-sub">${(inv.software || []).length} packages · collected ${new Date(inv.collectedAt).toLocaleString()}</span>
      </div>
      <div class="software-table">
        ${(inv.software || []).slice().sort((a, b) => a.name.localeCompare(b.name)).map((s) => `
          <div class="software-row"><span>${escapeHtml(s.name)}</span><span class="text-faint">${escapeHtml(s.version || "")}</span></div>
        `).join("") || `<div class="empty-hint">No software list collected (unsupported platform or command unavailable).</div>`}
      </div>
    </div>
  `;
}

// ---- Scripts tab (remote execution + audit log) ----
async function loadScriptRuns(agentId) {
  state.scriptRuns = await api(`/api/agents/${agentId}/script-runs`).catch(() => []);
  if (state.selectedId === agentId && state.activeTab === "scripts") renderScriptRunsList();
}

function renderScriptRunsList() {
  const listEl = document.getElementById("scriptRunsList");
  if (!listEl) return;
  listEl.innerHTML = state.scriptRuns.length
    ? state.scriptRuns.map((r) => `
        <div class="script-run">
          <div class="script-run-head">
            <span class="script-status ${r.status}">${r.status}</span>
            <span class="text-faint">${new Date(r.requested_at).toLocaleString()}</span>
            ${r.exit_code !== null && r.exit_code !== undefined ? `<span class="text-faint">exit ${r.exit_code}</span>` : ""}
          </div>
          <pre class="script-cmd">${escapeHtml(r.script)}</pre>
          ${r.stdout ? `<pre class="script-out">${escapeHtml(r.stdout)}</pre>` : ""}
          ${r.stderr ? `<pre class="script-err">${escapeHtml(r.stderr)}</pre>` : ""}
        </div>`).join("")
    : `<div class="empty-hint">No scripts run on this endpoint yet.</div>`;
}

function renderScriptsTab(body, agentId) {
  const canRun = state.role && ["technician", "admin", "superadmin"].includes(state.role);
  body.innerHTML = `
    <div class="warning-banner">Scripts run with full privileges of the agent process on the target machine. Only run commands you trust — every run is logged below for audit.</div>
    ${canRun ? `
      <form id="scriptForm" class="script-form">
        <textarea id="scriptInput" rows="4" placeholder="e.g. echo hello, systemctl status nginx, Get-Service ..."></textarea>
        <button type="submit" id="scriptRunBtn">Run on this endpoint</button>
      </form>
    ` : `
      <div class="empty-hint">Your role (${escapeHtml(state.role || "unknown")}) doesn't permit running scripts. Ask an admin to grant the technician role or above.</div>
    `}
    <div id="scriptRunsList" class="script-runs-list"><div class="empty-hint">Loading history…</div></div>
  `;

  const form = document.getElementById("scriptForm");
  if (form) {
    form.addEventListener("submit", async (e) => {
      e.preventDefault();
      const input = document.getElementById("scriptInput");
      const script = input.value.trim();
      if (!script || state.scriptPending) return;
      const btn = document.getElementById("scriptRunBtn");
      btn.disabled = true;
      btn.textContent = "Running…";
      state.scriptPending = true;
      try {
        await api(`/api/agents/${agentId}/run`, { method: "POST", body: JSON.stringify({ script }) });
        input.value = "";
        await loadScriptRuns(agentId);
      } catch (err) {
        alert(err.message);
        state.scriptPending = false;
      } finally {
        btn.disabled = false;
        btn.textContent = "Run on this endpoint";
      }
    });
  }

  loadScriptRuns(agentId);
}

// ---- Canvas "oscilloscope" trace rendering ----
function setupCanvas(canvas) {
  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const w = rect.width || canvas.parentElement.clientWidth;
  const h = 56;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
  canvas.style.height = h + "px";
  const ctx = canvas.getContext("2d");
  ctx.scale(dpr, dpr);
  return { ctx, w, h };
}

function drawTrace(canvasId, values, color, maxScale, totalSlots) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || values.length === 0) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);

  const slots = totalSlots || values.length;
  const max = maxScale || Math.max(1, ...values);
  const pad = 4;
  const step = (w - pad * 2) / Math.max(1, slots - 1);
  const offset = slots - values.length;

  ctx.beginPath();
  values.forEach((v, i) => {
    const x = pad + (offset + i) * step;
    const y = h - pad - (Math.min(v, max) / max) * (h - pad * 2);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  });
  ctx.strokeStyle = color;
  ctx.lineWidth = 1.75;
  ctx.shadowColor = color;
  ctx.shadowBlur = 6;
  ctx.stroke();

  const lastX = pad + (offset + values.length - 1) * step;
  const lastY = h - pad - (Math.min(values[values.length - 1], max) / max) * (h - pad * 2);
  ctx.beginPath();
  ctx.arc(lastX, lastY, 2.5, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.shadowBlur = 8;
  ctx.fill();
}

function drawTraceDual(canvasId, valuesA, valuesB, colorA, colorB, totalSlots) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || valuesA.length === 0) return;
  const { ctx, w, h } = setupCanvas(canvas);
  ctx.clearRect(0, 0, w, h);
  const slots = totalSlots || valuesA.length;
  const max = Math.max(1, ...valuesA, ...valuesB);
  const pad = 4;
  const step = (w - pad * 2) / Math.max(1, slots - 1);
  const offset = slots - valuesA.length;

  const plot = (values, color) => {
    ctx.beginPath();
    values.forEach((v, i) => {
      const x = pad + (offset + i) * step;
      const y = h - pad - (Math.min(v, max) / max) * (h - pad * 2);
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
    });
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.shadowColor = color;
    ctx.shadowBlur = 5;
    ctx.stroke();
  };
  plot(valuesA, colorA);
  plot(valuesB, colorB);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

window.addEventListener("resize", () => renderDetail());

boot();
