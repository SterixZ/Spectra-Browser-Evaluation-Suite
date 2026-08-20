// Live browser telemetry & benchmark results evaluation server.
// Implementation of Raj K. Jain, "The Art of Computer Systems Performance Analysis".

const path = require("path");
const os = require("os");
const http = require("http");
const fs = require("fs");
const { execSync } = require("child_process");
const express = require("express");
const { WebSocketServer } = require("ws");
const { chromium, firefox } = require("playwright");
const {
  computeDescriptiveStats,
  compareTwoAlternatives,
  computeOneWayAnova,
} = require("../scripts/stats");

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
    processName: def.process,
    lastCpuTime: getCpuTime(def.process),
    lastSampleTime: Date.now(),
    bandwidthBytes: 0,
    lastBandwidthBytes: 0,
    startTime: Date.now(),
    currentUrl: "",
    interval: null,
  };
  sessions[name] = session;

  function trackPage(page) {
    page.on("response", async (res) => {
      try {
        const headers = res.headers();
        const len = headers["content-length"];
        if (len) {
          session.bandwidthBytes += Number(len);
        } else {
          const body = await res.body().catch(() => null);
          if (body) session.bandwidthBytes += body.length;
        }
      } catch {}
    });

    page.on("framenavigated", (frame) => {
      if (frame === page.mainFrame()) {
        session.currentUrl = frame.url();
      }
    });
  }

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
    runtimeSec: Math.floor((now - session.startTime) / 1000),
    bandwidthRateKBs: Math.max(0, bandwidthRateKBs).toFixed(1),
    currentUrl: session.currentUrl,
  });
}

function parseCsv(filepath) {
  if (!fs.existsSync(filepath)) return [];
  const lines = fs
    .readFileSync(filepath, "utf8")
    .trim()
    .split(/\r?\n/)
    .filter(Boolean);
  if (lines.length < 2) return [];

  const headers = lines[0].split(",").map((h) => h.trim().replace(/^"|"$/g, ""));
  return lines.slice(1).map((line) => {
    // Regex matches comma-separated values while respecting quotes
    const values = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g) || line.split(",");
    const row = {};
    headers.forEach((h, i) => {
      row[h] = values[i] ? values[i].trim().replace(/^"|"$/g, "") : "";
    });
    return row;
  });
}

function computePairwise(seriesMap, unit) {
  const browsers = Object.keys(seriesMap);
  const pairs = [];
  for (let i = 0; i < browsers.length; i++) {
    for (let j = i + 1; j < browsers.length; j++) {
      const b1 = browsers[i];
      const b2 = browsers[j];
      const result = compareTwoAlternatives(seriesMap[b1], seriesMap[b2], b1, b2, unit);
      pairs.push(result);
    }
  }
  return pairs;
}

function computeCdfData(values) {
  const clean = values.filter((v) => typeof v === "number" && !isNaN(v)).sort((a, b) => a - b);
  const n = clean.length;
  if (n === 0) return [];

  return clean.map((val, idx) => ({
    x: Number(val.toFixed(1)),
    y: Number(((idx + 1) / n).toFixed(4)),
  }));
}

function getBenchmarkData(resultsDir) {
  const metrics = parseCsv(path.join(resultsDir, "metrics.csv"));
  const speedometer = parseCsv(path.join(resultsDir, "speedometer.csv"));
  const pageloads = parseCsv(path.join(resultsDir, "pageload.csv"));

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

  const workloadCompPath = path.join(resultsDir, "workload_comparison.csv");
  const workloadRawPath = path.join(resultsDir, "workload_raw.csv");
  const workloadSummaryPath = path.join(resultsDir, "workload_summary.csv");

  let workloads = null;
  if (fs.existsSync(workloadCompPath)) {
    workloads = {
      comparison: parseCsv(workloadCompPath),
      summary: fs.existsSync(workloadSummaryPath) ? parseCsv(workloadSummaryPath) : [],
      raw: fs.existsSync(workloadRawPath) ? parseCsv(workloadRawPath) : [],
    };
  }

  return {
    summary,
    siteSummary,
    cdf,
    anova,
    pairwise,
    workloads,
    raw: {
      metrics,
      pageloads,
      speedometer,
      workload_raw: workloads ? workloads.raw : [],
    },
  };
}

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

function listWorkloadFolders() {
  const PROJECT_ROOT = path.join(__dirname, "..");
  const entries = fs.readdirSync(PROJECT_ROOT, { withFileTypes: true });
  const workloads = entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .filter((name) => name.startsWith("workloads_"))
    .filter((name) => fs.existsSync(path.join(PROJECT_ROOT, name, "workload_raw.csv")));

  workloads.sort((a, b) => b.localeCompare(a));
  return workloads;
}

function getWorkloadData(workloadDir) {
  const rawRows = parseCsv(path.join(workloadDir, "workload_raw.csv"));
  const summaryRows = parseCsv(path.join(workloadDir, "workload_summary.csv"));
  const comparisonRows = parseCsv(path.join(workloadDir, "workload_comparison.csv"));

  return {
    raw: rawRows,
    summary: summaryRows,
    comparison: comparisonRows,
  };
}

const app = express();
app.use(express.static(path.join(__dirname, "public")));

app.get("/api/runs", (req, res) => {
  res.json({ runs: listRunFolders(), workloads: listWorkloadFolders() });
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

app.get("/api/workloads", (req, res) => {
  const PROJECT_ROOT = path.join(__dirname, "..");
  const workloads = listWorkloadFolders();
  const dirName = req.query.dir || workloads[0];

  if (!dirName || !workloads.includes(dirName)) {
    return res.status(404).json({ error: "Workload results folder not found." });
  }

  const workloadDir = path.join(PROJECT_ROOT, dirName);
  res.json({ dir: dirName, data: getWorkloadData(workloadDir) });
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
  for (const name of Object.keys(sessions)) {
    await stopBrowser(name);
  }
  process.exit();
});

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`\n========================================================`);
  console.log(`🌐 BROWSER PERFORMANCE DASHBOARD`);
  console.log(`📡 Evaluation Console: http://localhost:${PORT}/benchmark.html`);
  console.log(`⚡ Live Telemetry:     http://localhost:${PORT}`);
  console.log(`========================================================\n`);
});