// SentraCore RMM - Monitoring Agent
// Runs on the target system (Windows / Linux / macOS), collects live
// metrics with `systeminformation`, and streams them to the server
// over a WebSocket. Reconnects automatically with backoff.
//
// Unchanged by the authentication milestone - the agent talks to the
// server over /ws/agent using its org token, which is a separate trust
// boundary from dashboard user logins.

const WebSocket = require("ws");
const si = require("systeminformation");
const os = require("os");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { exec } = require("child_process");

const SERVER_URL = process.env.SERVER_URL || "ws://localhost:8787/ws/agent";
const AGENT_TOKEN = process.env.AGENT_TOKEN || "changeme-dev-token";
const INTERVAL_MS = Number(process.env.INTERVAL_MS || 2000);
const INVENTORY_INTERVAL_MS = Number(process.env.INVENTORY_INTERVAL_MS || 30 * 60 * 1000);
// Remote script execution runs arbitrary commands sent by the server on this
// machine. Only point an agent at a server you trust, and see the README's
// security section before using this beyond your own test machines.
const ALLOW_REMOTE_SCRIPTS = process.env.ALLOW_REMOTE_SCRIPTS !== "false";

// Persist a stable agent ID across restarts so the server recognizes
// this machine as the same endpoint instead of a new one every time.
const ID_FILE = path.join(__dirname, ".agent-id");
function loadOrCreateAgentId() {
  try {
    return fs.readFileSync(ID_FILE, "utf8").trim();
  } catch {
    const id = crypto.randomUUID();
    fs.writeFileSync(ID_FILE, id);
    return id;
  }
}
const AGENT_ID = loadOrCreateAgentId();

let ws;
let reconnectDelay = 1000;
const MAX_RECONNECT_DELAY = 30000;
let metricsTimer = null;
let stopping = false;

async function staticInfo() {
  const [osInfo, cpu] = await Promise.all([si.osInfo(), si.cpu()]);
  return {
    hostname: os.hostname(),
    platform: osInfo.platform,
    distro: osInfo.distro,
    release: osInfo.release,
    arch: osInfo.arch,
    cpuModel: `${cpu.manufacturer} ${cpu.brand}`.trim(),
    cores: cpu.cores,
  };
}

async function collectMetrics() {
  const [load, mem, fsSize, net, time] = await Promise.all([
    si.currentLoad(),
    si.mem(),
    si.fsSize(),
    si.networkStats(),
    Promise.resolve(si.time()),
  ]);

  const disk = fsSize[0] || { size: 0, used: 0, use: 0 };
  const netTotal = net.reduce(
    (acc, n) => ({ rx: acc.rx + (n.rx_sec || 0), tx: acc.tx + (n.tx_sec || 0) }),
    { rx: 0, tx: 0 }
  );

  return {
    cpuLoad: Number(load.currentLoad.toFixed(1)),
    memUsedPct: Number(((mem.active / mem.total) * 100).toFixed(1)),
    memUsedGB: Number((mem.active / 1e9).toFixed(2)),
    memTotalGB: Number((mem.total / 1e9).toFixed(2)),
    diskUsedPct: Number((disk.use || 0).toFixed(1)),
    diskUsedGB: Number((disk.used / 1e9).toFixed(2)),
    diskTotalGB: Number((disk.size / 1e9).toFixed(2)),
    netRxKBs: Number((netTotal.rx / 1024).toFixed(1)),
    netTxKBs: Number((netTotal.tx / 1024).toFixed(1)),
    uptimeSec: Math.round(time.uptime),
  };
}

async function collectHardware() {
  const [system, cpu, mem, disks, graphics, net, osInfo] = await Promise.all([
    si.system(), si.cpu(), si.memLayout(), si.diskLayout(), si.graphics(), si.networkInterfaces(), si.osInfo(),
  ]);
  return {
    system: { manufacturer: system.manufacturer, model: system.model },
    cpu: { manufacturer: cpu.manufacturer, brand: cpu.brand, cores: cpu.cores, physicalCores: cpu.physicalCores, speedGHz: cpu.speed },
    memoryModules: mem.map((m) => ({ sizeGB: Number((m.size / 1e9).toFixed(1)), type: m.type, clockMHz: m.clockSpeed })),
    disks: disks.map((d) => ({ name: d.name, sizeGB: Number((d.size / 1e9).toFixed(1)), type: d.type, interfaceType: d.interfaceType })),
    graphics: (graphics.controllers || []).map((g) => ({ model: g.model, vramMB: g.vram })),
    network: (net || []).filter((n) => !n.internal).map((n) => ({ iface: n.iface, ip4: n.ip4, mac: n.mac })),
    os: { platform: osInfo.platform, distro: osInfo.distro, release: osInfo.release, kernel: osInfo.kernel, arch: osInfo.arch },
  };
}

// Best-effort, per-OS installed-software listing. Cross-platform tooling
// doesn't have one universal API for this, so we shell out to the native
// package/registry query for the current OS and fail soft (empty list) if
// the command isn't available.
function run(cmd, timeoutMs = 20000) {
  return new Promise((resolve) => {
    exec(cmd, { timeout: timeoutMs, maxBuffer: 20 * 1024 * 1024, windowsHide: true }, (err, stdout) => {
      resolve(err ? "" : stdout || "");
    });
  });
}

async function collectSoftware() {
  const platform = os.platform();

  if (platform === "win32") {
    const psCmd = `powershell -NoProfile -Command "Get-ItemProperty 'HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Wow6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object { $_.DisplayName } | Select-Object DisplayName,DisplayVersion | ConvertTo-Json -Compress"`;
    const out = await run(psCmd, 30000);
    try {
      const parsed = JSON.parse(out || "[]");
      const list = Array.isArray(parsed) ? parsed : [parsed];
      return list.filter((p) => p && p.DisplayName).map((p) => ({ name: p.DisplayName, version: p.DisplayVersion || "" }));
    } catch {
      return [];
    }
  }

  if (platform === "linux") {
    const dpkg = await run("dpkg-query -W -f='${Package}\\t${Version}\\n' 2>/dev/null");
    if (dpkg.trim()) {
      return dpkg.trim().split("\n").map((line) => {
        const [name, version] = line.split("\t");
        return { name, version: version || "" };
      });
    }
    const rpm = await run("rpm -qa --qf '%{NAME}\\t%{VERSION}\\n' 2>/dev/null");
    if (rpm.trim()) {
      return rpm.trim().split("\n").map((line) => {
        const [name, version] = line.split("\t");
        return { name, version: version || "" };
      });
    }
    return [];
  }

  if (platform === "darwin") {
    try {
      const apps = await fs.promises.readdir("/Applications");
      return apps.filter((a) => a.endsWith(".app")).map((a) => ({ name: a.replace(/\.app$/, ""), version: "" }));
    } catch {
      return [];
    }
  }

  return [];
}

async function sendInventory() {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  try {
    const [hardware, software] = await Promise.all([collectHardware(), collectSoftware()]);
    ws.send(JSON.stringify({ type: "inventory", hardware, software }));
  } catch (err) {
    console.error("[agent] inventory collection failed:", err.message);
  }
}

// ---- Remote script execution ----
function runScript(script, timeoutMs) {
  return new Promise((resolve) => {
    exec(script, { timeout: timeoutMs, maxBuffer: 10 * 1024 * 1024, windowsHide: true }, (err, stdout, stderr) => {
      const timedOut = !!(err && err.killed && err.signal);
      resolve({
        exitCode: err ? (typeof err.code === "number" ? err.code : 1) : 0,
        stdout: stdout || "",
        stderr: stderr || (err && !timedOut ? String(err.message) : ""),
        timedOut,
      });
    });
  });
}

function connect() {
  ws = new WebSocket(SERVER_URL);

  let inventoryTimer = null;

  ws.on("open", async () => {
    reconnectDelay = 1000;
    const info = await staticInfo();
    ws.send(JSON.stringify({ type: "register", agentId: AGENT_ID, token: AGENT_TOKEN, info }));
    console.log(`[agent] connected as ${info.hostname} (${AGENT_ID})`);

    metricsTimer = setInterval(async () => {
      try {
        const data = await collectMetrics();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ type: "metrics", data }));
        }
      } catch (err) {
        console.error("[agent] metrics collection failed:", err.message);
      }
    }, INTERVAL_MS);

    sendInventory();
    inventoryTimer = setInterval(sendInventory, INVENTORY_INTERVAL_MS);
  });

  ws.on("message", async (raw) => {
    let msg;
    try { msg = JSON.parse(raw.toString()); } catch { return; }

    if (msg.type === "run_script") {
      if (!ALLOW_REMOTE_SCRIPTS) {
        ws.send(JSON.stringify({ type: "script_result", runId: msg.runId, exitCode: 126, stdout: "", stderr: "remote scripts disabled on this agent (ALLOW_REMOTE_SCRIPTS=false)", timedOut: false }));
        return;
      }
      console.log(`[agent] running script (runId=${msg.runId})`);
      const result = await runScript(msg.script, msg.timeoutMs || 30000);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "script_result", runId: msg.runId, ...result }));
      }
    }
  });

  ws.on("close", (code) => {
    if (metricsTimer) clearInterval(metricsTimer);
    if (inventoryTimer) clearInterval(inventoryTimer);
    if (stopping) return;
    console.log(`[agent] disconnected (${code}) reconnecting in ${reconnectDelay}ms...`);
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, MAX_RECONNECT_DELAY);
  });

  ws.on("error", (err) => {
    console.error("[agent] socket error:", err.message);
  });
}

// Ctrl-C / systemd stop: close the socket so the server marks this endpoint
// offline immediately instead of waiting for the heartbeat to time out.
function shutdown(signal) {
  stopping = true;
  console.log(`[agent] ${signal} received, disconnecting`);
  if (metricsTimer) clearInterval(metricsTimer);
  if (ws && ws.readyState === WebSocket.OPEN) ws.close(1000, "agent shutting down");
  setTimeout(() => process.exit(0), 500).unref();
}
process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

connect();
