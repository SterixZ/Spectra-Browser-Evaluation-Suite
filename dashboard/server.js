// Live browser telemetry & benchmark results evaluation server.
// Implementation of Raj K. Jain, "The Art of Computer Systems Performance Analysis".

const path = require("path");
const os = require("os");
const http = require("http");
const { sampleProcess } = require("../scripts/telemetry");
const express = require("express");
const { WebSocketServer } = require("ws");
const { chromium, firefox } = require("playwright");
const { getBenchmarkData, listRunFolders, listWorkloadFolders, getWorkloadData } = require("../scripts/results");
const { createLabRouter } = require("../scripts/lab/api");

const TICK_MS = 1000;

const BROWSER_DEFS = {
  Chrome: { process: "chrome", channel: "chrome" },
  Edge: { process: "msedge", channel: "msedge" },
  Firefox: { process: "firefox", channel: null },
};

const sessions = Object.create(null);
const pendingLaunches = new Map();

async function launchBrowser(name) {
  if (sessions[name]) return;

  const def = BROWSER_DEFS[name];
  if (!def) throw new Error(`Unknown browser: ${name}`);

  const browser = def.channel
    ? await chromium.launch({ channel: def.channel, headless: false })
    : await firefox.launch({ headless: false });

  const context = await browser.newContext();

  const initialSample = await sampleProcess(def.process).catch(() => ({ cpuSeconds: 0 }));
  const session = {
    browser,
    context,
    processName: def.process,
    lastCpuTime: initialSample.cpuSeconds,
    lastSampleTime: Date.now(),
    bandwidthBytes: 0,
    lastBandwidthBytes: 0,
    startTime: Date.now(),
    currentUrl: "",
    interval: null,
    sampling: false,
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

async function tick(name) {
  const session = sessions[name];
  if (!session || session.sampling) return;
  session.sampling = true;
  let sample;
  try { sample = await sampleProcess(session.processName); }
  catch { return; }
  finally { session.sampling = false; }
  if (sessions[name] !== session) return;

  const now = Date.now();
  const currentCpuTime = sample.cpuSeconds;
  const deltaCpu = currentCpuTime - session.lastCpuTime;
  const deltaWallSec = (now - session.lastSampleTime) / 1000;
  const cpuPercent = deltaWallSec > 0 ? (deltaCpu * 100) / (os.cpus().length * deltaWallSec) : 0;

  session.lastCpuTime = currentCpuTime;
  session.lastSampleTime = now;

  const memoryMB = sample.memoryMB;
  const deltaBandwidthBytes = session.bandwidthBytes - session.lastBandwidthBytes;
  session.lastBandwidthBytes = session.bandwidthBytes;
  const bandwidthRateKBs = deltaBandwidthBytes / 1024 / Math.max(deltaWallSec, 0.001);

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

const app = express();
app.disable("x-powered-by");
app.use(express.static(path.join(__dirname, "public")));
const labRouter = createLabRouter();
app.use("/api/lab", labRouter);

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

app.use((err, req, res, next) => {
  console.error(err.message);
  res.status(500).json({ error: "Results could not be read. Check the CSV files and try again." });
});

const server = http.createServer(app);
const wss = new WebSocketServer({ server, maxPayload: 4096 });

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

    if (!msg || typeof msg !== "object" || Array.isArray(msg)) return;

    if (msg.action === "launch" && Object.hasOwn(BROWSER_DEFS, msg.browser)) {
      try {
        if (!pendingLaunches.has(msg.browser)) {
          pendingLaunches.set(msg.browser, launchBrowser(msg.browser).finally(() => pendingLaunches.delete(msg.browser)));
        }
        await pendingLaunches.get(msg.browser);
        broadcast({ type: "launched", browser: msg.browser });
      } catch (err) {
        if (ws.readyState === ws.OPEN) ws.send(JSON.stringify({ type: "error", browser: msg.browser, message: err.message }));
      }
    }

    if (msg.action === "stop" && Object.hasOwn(BROWSER_DEFS, msg.browser)) {
      await pendingLaunches.get(msg.browser)?.catch(() => {});
      await stopBrowser(msg.browser);
    }
  });
});

async function shutdown() {
  const activeTest = labRouter.labManager.active;
  if (activeTest) {
    activeTest.controller.abort();
    await activeTest.promise;
  }
  for (const name of Object.keys(sessions)) {
    await stopBrowser(name);
  }
  wss.close();
  server.close(() => process.exit(0));
}

if (require.main === module) {
  process.once("SIGINT", shutdown);
  process.once("SIGTERM", shutdown);
}

const PORT = process.env.PORT || 3000;
if (require.main === module) server.listen(PORT, "127.0.0.1", () => {
  console.log(`\n========================================================`);
  console.log(`🌐 BROWSER PERFORMANCE DASHBOARD`);
  console.log(`📡 Evaluation Console: http://localhost:${PORT}/benchmark.html`);
  console.log(`  Live Dashboard:     http://localhost:${PORT}`);
  console.log(`========================================================\n`);
});
module.exports = { app, server, wss };
