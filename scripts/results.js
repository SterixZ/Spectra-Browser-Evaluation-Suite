const path = require("node:path");
const fs = require("node:fs");
const { parseCsv, numericField } = require("./csv");
const { computeDescriptiveStats, compareTwoAlternatives, computeOneWayAnova } = require("./stats");

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
  const clean = values.filter((v) => typeof v === "number" && Number.isFinite(v)).sort((a, b) => a - b);
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
  const pageloads = parseCsv(path.join(resultsDir, "pageload.csv")).concat(
    parseCsv(path.join(resultsDir, "pageloads.csv"))
  );
  const workloadRaw = parseCsv(path.join(resultsDir, "workload_raw.csv"));

  const networkPath = path.join(resultsDir, "network.csv");
  const network = fs.existsSync(networkPath) ? parseCsv(networkPath) : [];

  const raw = {
    startup: {},
    cpu: {},
    memory: {},
    speedometer: {},
    pageload: {},
    pageloadBySite: Object.create(null),
    ttfb: {},
    fcp: {},
    transferRate: {},
    dns: {},
    download: {},
  };

  const init = (b) => {
    raw.startup[b] ||= [];
    raw.cpu[b] ||= [];
    raw.memory[b] ||= [];
    raw.speedometer[b] ||= [];
    raw.pageload[b] ||= [];
    raw.ttfb[b] ||= [];
    raw.fcp[b] ||= [];
    raw.transferRate[b] ||= [];
    raw.dns[b] ||= [];
    raw.download[b] ||= [];
  };

  metrics.forEach((r) => {
    const b = r.Browser || r.browser;
    if (!["Chrome", "Edge", "Firefox"].includes(b)) return;
    init(b);
    const startup = numericField(r, "Startup(ms)", "startup_time_ms", "StartupMs");
    if (Number.isFinite(startup) && startup > 0) raw.startup[b].push(startup);
    const cpu = numericField(r, "CPU(%)", "ActiveCPU(%)", "cpu_percent", "PeakCpuPercent", "CpuPercent");
    if (Number.isFinite(cpu)) raw.cpu[b].push(cpu);
    const mem = numericField(r, "Memory(MB)", "PeakMemory(MB)", "memory_mb", "PeakMemoryMB", "MemoryMB");
    if (Number.isFinite(mem)) raw.memory[b].push(mem);
  });

  speedometer.forEach((r) => {
    const b = r.Browser || r.browser;
    if (!["Chrome", "Edge", "Firefox"].includes(b)) return;
    init(b);
    const score = numericField(r, "Score", "score");
    if (Number.isFinite(score) && score > 0) raw.speedometer[b].push(score);
  });

  pageloads.forEach((r) => {
    const b = r.Browser || r.browser;
    const t = numericField(r, "LoadTime(ms)", "load_time_ms", "LoadTimeMs");
    if (!["Chrome", "Edge", "Firefox"].includes(b) || t === null || t <= 0) return;
    init(b);
    raw.pageload[b].push(t);

    const site = r.Website || r.url || r.Url || r.SiteName || "unknown";
    raw.pageloadBySite[site] ||= {};
    raw.pageloadBySite[site][b] ||= [];
    raw.pageloadBySite[site][b].push(t);
  });

  network.forEach((r) => {
    const b = r.Browser || r.browser;
    if (!["Chrome", "Edge", "Firefox"].includes(b)) return;
    init(b);

    const ttfb = numericField(r, "TTFB(ms)", "TTFB_Ms", "ttfb");
    if (Number.isFinite(ttfb) && ttfb > 0) raw.ttfb[b].push(ttfb);

    const fcp = numericField(r, "FCP(ms)", "FCP_Ms", "fcp");
    if (Number.isFinite(fcp) && fcp > 0) raw.fcp[b].push(fcp);

    const rate = numericField(r, "TransferRate(KB/s)", "TransferRateKBs", "rate");
    if (Number.isFinite(rate) && rate > 0) raw.transferRate[b].push(rate);

    const dns = numericField(r, "DNS(ms)", "DNS_Ms", "dns");
    if (Number.isFinite(dns)) raw.dns[b].push(dns);

    const dl = numericField(r, "Download(ms)", "Download_Ms", "download");
    if (Number.isFinite(dl)) raw.download[b].push(dl);
  });

  const primaryCounts = Object.fromEntries(Object.entries(raw).filter(([key]) => key !== "pageloadBySite").map(([key, series]) => [key, Object.fromEntries(Object.entries(series).map(([browser, values]) => [browser, values.length]))]));
  const startupIterations = new Set();

  // If standard metrics weren't present, populate from workload_raw
  workloadRaw.forEach((r) => {
    const b = r.Browser || r.browser;
    if (!["Chrome", "Edge", "Firefox"].includes(b)) return;
    init(b);

    const startup = numericField(r, "StartupMs", "Startup(ms)", "startup_time_ms");
    if (Number.isFinite(startup) && startup > 0 && !primaryCounts.startup[b]) {
      const iteration = `${b}:${r.Iteration || r.Run || r.run || "1"}`;
      if (!startupIterations.has(iteration)) { raw.startup[b].push(startup); startupIterations.add(iteration); }
    }

    const cpu = numericField(r, "PeakCpuPercent", "CpuPercent", "CPU(%)", "ActiveCPU(%)", "cpu_percent");
    if (Number.isFinite(cpu) && !primaryCounts.cpu[b]) raw.cpu[b].push(cpu);

    const mem = numericField(r, "PeakMemoryMB", "MemoryMB", "Memory(MB)", "PeakMemory(MB)", "memory_mb");
    if (Number.isFinite(mem) && !primaryCounts.memory[b]) raw.memory[b].push(mem);

    const loadTime = numericField(r, "LoadTimeMs", "LoadTime(ms)", "load_time_ms");
    if (Number.isFinite(loadTime) && loadTime > 0 && !primaryCounts.pageload[b]) {
      raw.pageload[b].push(loadTime);
      const site = r.SiteName || r.url || r.Url || r.Website || "unknown";
      raw.pageloadBySite[site] ||= {};
      raw.pageloadBySite[site][b] ||= [];
      raw.pageloadBySite[site][b].push(loadTime);
    }

    const ttfb = numericField(r, "TTFB_Ms", "TTFB(ms)");
    if (Number.isFinite(ttfb) && ttfb > 0 && !primaryCounts.ttfb[b]) raw.ttfb[b].push(ttfb);

    const fcp = numericField(r, "FCP_Ms", "FCP(ms)");
    if (Number.isFinite(fcp) && fcp > 0 && !primaryCounts.fcp[b]) raw.fcp[b].push(fcp);

    const rate = numericField(r, "TransferRateKBs", "TransferRate(KB/s)");
    if (Number.isFinite(rate) && rate > 0 && !primaryCounts.transferRate[b]) raw.transferRate[b].push(rate);
  });

  const browsers = Array.from(
    new Set([
      ...Object.keys(raw.startup),
      ...Object.keys(raw.cpu),
      ...Object.keys(raw.memory),
      ...Object.keys(raw.pageload),
    ])
  );

  const summary = {};
  const cdf = {};

  browsers.forEach((b) => {
    init(b);
    summary[b] = {
      startup: computeDescriptiveStats(raw.startup[b]),
      cpu: computeDescriptiveStats(raw.cpu[b]),
      memory: computeDescriptiveStats(raw.memory[b]),
      speedometer: computeDescriptiveStats(raw.speedometer[b]),
      pageload: computeDescriptiveStats(raw.pageload[b]),
      ttfb: computeDescriptiveStats(raw.ttfb[b]),
      fcp: computeDescriptiveStats(raw.fcp[b]),
      transferRate: computeDescriptiveStats(raw.transferRate[b]),
      dns: computeDescriptiveStats(raw.dns[b]),
      download: computeDescriptiveStats(raw.download[b]),
    };
    cdf[b] = computeCdfData(raw.pageload[b]);
  });

  const siteSummary = Object.create(null);
  for (const [site, bMap] of Object.entries(raw.pageloadBySite)) {
    const hasData = Object.values(bMap).some((vals) => vals && vals.length > 0);
    if (!hasData) continue;
    siteSummary[site] = {};
    for (const [b, vals] of Object.entries(bMap)) {
      if (vals && vals.length > 0) {
        siteSummary[site][b] = computeDescriptiveStats(vals);
      }
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
  if (fs.existsSync(workloadCompPath) || fs.existsSync(workloadRawPath)) {
    workloads = {
      comparison: fs.existsSync(workloadCompPath) ? parseCsv(workloadCompPath) : [],
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
      metrics: metrics.length ? metrics : (workloads ? workloads.raw : []),
      pageloads: pageloads.length ? pageloads : (workloads ? workloads.raw : []),
      speedometer,
      network,
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
    .filter((name) => name === "results" || name === "workloads" || name.startsWith("results_") || name.startsWith("workloads_"))
    .filter((name) =>
      fs.existsSync(path.join(PROJECT_ROOT, name, "metrics.csv")) ||
      fs.existsSync(path.join(PROJECT_ROOT, name, "workload_raw.csv")) ||
      fs.existsSync(path.join(PROJECT_ROOT, name, "pageload.csv")) ||
      fs.existsSync(path.join(PROJECT_ROOT, name, "pageloads.csv"))
    );

  runs.sort((a, b) => {
    if (a === "results") return -1;
    if (b === "results") return 1;
    if (a === "workloads") return -1;
    if (b === "workloads") return 1;
    return b.replace(/^(results|workloads)_/, "").localeCompare(a.replace(/^(results|workloads)_/, ""));
  });
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


module.exports = { getBenchmarkData, listRunFolders, listWorkloadFolders, getWorkloadData };
