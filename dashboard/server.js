// Live browser telemetry & benchmark results evaluation server.
// Implementation of Raj K. Jain, "The Art of Computer Systems Performance Analysis".

const path = require("path");
const os = require("os");
const http = require("http");
const express = require("express");
const { WebSocketServer } = require("ws");
const { execSync } = require("child_process");
const { chromium, firefox } = require("playwright");
const fs = require("fs");
const {
  computeDescriptiveStats,
  compareTwoAlternatives,
  computeOneWayAnova,
} = require("../scripts/stats");

// 1000ms tick interval ensures smooth, real-time live telemetry stream
const TICK_MS = 1000;

const BROWSER_DEFS = {
  Chrome: { process: "chrome", channel: "chrome" },
  Edge: { process: "msedge", channel: "msedge" },
  Firefox: { process: "firefox", channel: null },
};

const sessions = {};

function getCpuTime(processName) {
  try {
    const cmd = `powershell -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum"`;
    const output = execSync(cmd, { encoding: "utf8" }).trim();
    return Number(output) || 0;
  } catch {
    return 0;
  }
}

function getMemoryMB(processName) {
  try {
    const cmd = `powershell -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum"`;
    const output = execSync(cmd, { encoding: "utf8" }).trim();
    const bytes = Number(output);
    return isNaN(bytes) ? 0 : bytes / 1024 / 1024;
  } catch {
    return 0;
  }
}

async function launchBrowser(name) {
  if (sessions[name]) return;

  const def = BROWSER_DEFS[name];
  if (!def) throw new Error(`Unknown browser: ${name}`);

  const browser = def.channel
    ? await chromium.launch({ channel: def.channel, headless: false })
    : await firefox.launch({ headless: false });

  const context = await browser.newContext();

  const session = {
    browser,
    context,
    startTime: Date.now(),
    lastCpuTime: getCpuTime(def.process),
    lastSampleTime: Date.now(),
    bandwidthBytes: 0,
    lastBandwidthBytes: 0,
    processName: def.process,
    interval: null,
  };
  sessions[name] = session;

  const trackPage = (page) => {
    page.on("response", (response) => {
      const len = response.headers()["content-length"];
      if (len && !isNaN(Number(len))) {
        session.bandwidthBytes += Number(len);
      }
    });
    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        session.currentUrl = frame.url();
      }
    });
  };

  session.currentUrl = "about:blank";
  context.on("page", trackPage);
  const firstPage = await context.newPage();
  trackPage(firstPage);
  await firstPage.goto("https://www.google.com").catch(() => {});
  session.currentUrl = firstPage.url();

  browser.on("disconnected", () => {
    if (sessions[name]) {
      clearInterval(sessions[name].interval);
      delete sessions[name];
      broadcast({ type: "closed", browser: name });
    }
  });

  session.interval = setInterval(() => tick(name), TICK_MS);
}

async function stopBrowser(name) {
  const session = sessions[name];
  if (!session) return;
  clearInterval(session.interval);
  delete sessions[name];
  try {
    await session.browser.close();
  } catch {}
  broadcast({ type: "closed", browser: name });
}

function tick(name) {
  const session = sessions[name];
  if (!session) return;

  const now = Date.now();
  const currentCpuTime = getCpuTime(session.processName);
  const deltaCpu = currentCpuTime - session.lastCpuTime;
  const deltaWallSec = (now - session.lastSampleTime) / 1000;
  const cpuPercent = deltaWallSec > 0 ? (deltaCpu * 100) / (os.cpus().length * deltaWallSec) : 0;

  session.lastCpuTime = currentCpuTime;
  session.lastSampleTime = now;

  const memoryMB = getMemoryMB(session.processName);
  const deltaBandwidthBytes = session.bandwidthBytes - session.lastBandwidthBytes;
  session.lastBandwidthBytes = session.bandwidthBytes;
  const bandwidthRateKBs = deltaBandwidthBytes / 1024 / (TICK_MS / 1000);

  broadcast({
    type: "stats",
    browser: name,
    cpuPercent: Math.max(0, Math.min(100, cpuPercent)).toFixed(1),
    memoryMB: memoryMB.toFixed(1),
    runtimeSec: Math.round((now - session.startTime) / 1000),
    bandwidthTotalKB: (session.bandwidthBytes / 1024).toFixed(1),
    bandwidthRateKBs: Math.max(0, bandwidthRateKBs).toFixed(1),
    currentUrl: session.currentUrl,
  });
}

function parseCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8").replace(/\r/g, "");
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = values[i] ? values[i].trim() : ""));
    return row;
  });
}

// Compute pairwise comparisons across browser pairs
function computePairwise(groups, unit = "") {
  const names = Object.keys(groups);
  const list = [];
  for (let i = 0; i < names.length; i++) {
    for (let j = i + 1; j < names.length; j++) {
      const b1 = names[i];
      const b2 = names[j];
      const comp = compareTwoAlternatives(groups[b1], groups[b2], b1, b2);
      list.push({ ...comp, unit });
    }
  }
  return list;
}

// Generates points for Empirical Cumulative Distribution Function (CDF) curve (Jain Ch. 12)
function computeCdfData(values) {
  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;
  if (!n) return [];

  // Generate 25 evenly spaced percentiles
  const points = [];
  for (let p = 0; p <= 100; p += 4) {
    const frac = p / 100;
    const idx = Math.min(n - 1, Math.floor(frac * (n - 1)));
    points.push({ percentile: p, latency: Number(sorted[idx].toFixed(1)) });
  }
  return points;
}

function getBenchmarkData(targetDir) {
  const metrics = parseCsv(path.join(targetDir, "metrics.csv"));
  const pageloads = parseCsv(path.join(targetDir, "pageload.csv"));
  const speedometer = parseCsv(path.join(targetDir, "speedometer.csv"));

  const raw = {
    startup: {},
    cpu: {},
    memory: {},
    speedometer: {},
    pageload: {},
    pageloadBySite: {},
  };

  const init = (b) => {
    raw.startup[b] ||= [];
    raw.cpu[b] ||= [];
    raw.memory[b] ||= [];
    raw.speedometer[b] ||= [];
    raw.pageload[b] ||= [];
  };

  metrics.forEach((r) => {
    if (!r.Browser) return;
    init(r.Browser);
    if (r["Startup(ms)"]) raw.startup[r.Browser].push(Number(r["Startup(ms)"]));
    if (r["CPU(%)"]) raw.cpu[r.Browser].push(Number(r["CPU(%)"]));
    if (r["Memory(MB)"]) raw.memory[r.Browser].push(Number(r["Memory(MB)"]));
  });

  speedometer.forEach((r) => {
    if (!r.Browser) return;
    init(r.Browser);
    if (r.Score) raw.speedometer[r.Browser].push(Number(r.Score));
  });

  pageloads.forEach((r) => {
    if (!r.Browser || !r["LoadTime(ms)"]) return;
    init(r.Browser);
    const t = Number(r["LoadTime(ms)"]);
    raw.pageload[r.Browser].push(t);

    const site = r.Website || "unknown";
    raw.pageloadBySite[site] ||= {};
    raw.pageloadBySite[site][r.Browser] ||= [];
    raw.pageloadBySite[site][r.Browser].push(t);
  });

  const browsers = Object.keys(raw.startup);
  const summary = {};
  const cdf = {};

  browsers.forEach((b) => {
    summary[b] = {
      startup: computeDescriptiveStats(raw.startup[b]),
      cpu: computeDescriptiveStats(raw.cpu[b]),
      memory: computeDescriptiveStats(raw.memory[b]),
      speedometer: computeDescriptiveStats(raw.speedometer[b]),
      pageload: computeDescriptiveStats(raw.pageload[b]),
    };
    cdf[b] = computeCdfData(raw.pageload[b]);
  });

  const siteSummary = {};
  for (const [site, bMap] of Object.entries(raw.pageloadBySite)) {
    siteSummary[site] = {};
    for (const [b, vals] of Object.entries(bMap)) {
      siteSummary[site][b] = computeDescriptiveStats(vals);
    }
  }

  const anova = {
    startup: computeOneWayAnova(raw.startup),
    cpu: computeOneWayAnova(raw.cpu),
    memory: computeOneWayAnova(raw.memory),
    pageload: computeOneWayAnova(raw.pageload),
    speedometer: computeOneWayAnova(raw.speedometer),
  };

  const pairwise = {
    startup: computePairwise(raw.startup, "ms"),
    cpu: computePairwise(raw.cpu, "%"),
    memory: computePairwise(raw.memory, "MB"),
    pageload: computePairwise(raw.pageload, "ms"),
    speedometer: computePairwise(raw.speedometer, "pts"),
  };

  return {
    summary,
    siteSummary,
    cdf,
    anova,
    pairwise,
    raw: { metrics, pageloads, speedometer },
  };
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

function listRunFolders() {
  const PROJECT_ROOT = path.join(__dirname, "..");
  const entries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true });
  const runs = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => name === "results" || name.startsWith("results_"))
    .filter((name) => fs.existsSync(path.join(PROJECT_ROOT, name, "metrics.csv")));

  runs.sort((a, b) => (a === "results" ? -1 : b === "results" ? 1 : b.localeCompare(a)));
  return runs;
}

app.get("/api/runs", (req, res) => {
  res.json({ runs: listRunFolders() });
});

app.get("/api/benchmark", (req, res) => {
  const PROJECT_ROOT = path.join(__dirname, "..");
  const runs = listRunFolders();
  const dirName = req.query.dir || runs[0];

  if (!dirName || !runs.includes(dirName)) {
    return res.status(404).json({ error: "Benchmark results folder not found." });
  }

  const resultsDir = path.join(PROJECT_ROOT, dirName);
  res.json({ dir: dirName, data: getBenchmarkData(resultsDir) });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server });

function broadcast(msg) {
  const data = JSON.stringify(msg);
  for (const client of wss.clients) {
    if (client.readyState === client.OPEN) client.send(data);
  }
}

wss.on("connection", (ws) => {
  ws.send(JSON.stringify({ type: "init", running: Object.keys(sessions) }));

  ws.on("message", async (raw) => {
    let msg;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    if (msg.action === "launch" && BROWSER_DEFS[msg.browser]) {
      try {
        await launchBrowser(msg.browser);
        broadcast({ type: "launched", browser: msg.browser });
      } catch (err) {
        ws.send(JSON.stringify({ type: "error", browser: msg.browser, message: err.message }));
      }
    }

    if (msg.action === "stop" && BROWSER_DEFS[msg.browser]) {
      await stopBrowser(msg.browser);
    }
  });
});

process.on("SIGINT", async () => {
  await Promise.all(Object.keys(sessions).map(stopBrowser));
  process.exit(0);
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`Dashboard running at http://localhost:${PORT}`);
});