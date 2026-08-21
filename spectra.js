#!/usr/bin/env node

/**
 * Spectra Cross-Browser Performance Evaluation Platform
 * Unified Command-Line Interface (CLI) & Benchmark Orchestrator
 */

const fs = require("fs");
const path = require("path");
const os = require("os");
const { RESULTS_DIR, DEFAULT_RUNS, DEFAULT_SPEEDOMETER_RUNS, DEFAULT_WORKLOAD_ITERATIONS, INTER_RUN_DELAY_MS } = require("./core/config");
const { getLaunchers, ensureDir } = require("./core/browsers");
const { sleep } = require("./core/telemetry");
const { computeDescriptiveStats, computeOneWayAnova, compareTwoAlternatives } = require("./core/stats");
const { runCanonicalIteration } = require("./suites/canonical");
const { runSpeedometerBenchmark } = require("./suites/speedometer");
const { runWorkloadSuite } = require("./suites/workloads");

function parseArgs(args) {
  const parsed = {
    command: args[0] || "run",
    suite: "standard",
    runs: DEFAULT_RUNS,
    speedometerRuns: DEFAULT_SPEEDOMETER_RUNS,
    workloadIters: DEFAULT_WORKLOAD_ITERATIONS,
    browsers: null,
    port: 3000,
    targetDir: null,
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--suite" && args[i + 1]) parsed.suite = args[++i].toLowerCase();
    else if (arg === "--runs" && args[i + 1]) parsed.runs = Number(args[++i]) || DEFAULT_RUNS;
    else if (arg === "--speedometer-runs" && args[i + 1]) parsed.speedometerRuns = Number(args[++i]) || DEFAULT_SPEEDOMETER_RUNS;
    else if (arg === "--workload-iters" && args[i + 1]) parsed.workloadIters = Number(args[++i]) || DEFAULT_WORKLOAD_ITERATIONS;
    else if (arg === "--browsers" && args[i + 1]) parsed.browsers = args[++i].split(",").map((b) => b.trim());
    else if (arg === "--port" && args[i + 1]) parsed.port = Number(args[++i]) || 3000;
    else if (!arg.startsWith("--") && !parsed.targetDir) parsed.targetDir = arg;
  }

  return parsed;
}

/**
 * Saves both the master structured JSON manifest and all legacy CSV files
 */
function saveRunOutputs(outputDir, manifestData) {
  ensureDir(outputDir);

  // 1. Save Master Run Manifest (JSON)
  fs.writeFileSync(
    path.join(outputDir, "run_manifest.json"),
    JSON.stringify(manifestData, null, 2),
    "utf8"
  );

  // 2. Export Standard CSVs for Backward Compatibility
  const metricsCsv = ["Browser,Run,Startup(ms),CPU(%),Memory(MB)"];
  const pageloadCsv = ["Browser,Run,Website,LoadTime(ms)"];
  const speedometerCsv = ["Browser,Run,Score"];
  const networkCsv = [
    "Browser,Run,Website,Requests,TransferBytes,Transfer(MB),TransferRate(KB/s),DNS(ms),TCP(ms),TLS(ms),TTFB(ms),Download(ms),FCP(ms)",
  ];

  if (manifestData.canonicalRuns) {
    manifestData.canonicalRuns.forEach((r) => {
      metricsCsv.push(`${r.browser},${r.run},${r.startupMs},${r.activeCpuPercent},${r.memoryMB}`);
      if (r.sites) {
        r.sites.forEach((s) => {
          pageloadCsv.push(`${r.browser},${r.run},${s.url},${s.loadTimeMs}`);
          networkCsv.push(
            `${r.browser},${r.run},${s.url},${s.requests},${s.transferBytes},${s.transferMB},${s.transferRateKBs},${s.dnsMs},${s.tcpMs},${s.tlsMs},${s.ttfbMs},${s.downloadMs},${s.fcpMs}`
          );
        });
      }
    });
  }

  if (manifestData.speedometerRuns) {
    manifestData.speedometerRuns.forEach((s) => {
      speedometerCsv.push(`${s.browser},${s.run},${s.score}`);
    });
  }

  fs.writeFileSync(path.join(outputDir, "metrics.csv"), metricsCsv.join("\n") + "\n");
  fs.writeFileSync(path.join(outputDir, "pageload.csv"), pageloadCsv.join("\n") + "\n");
  fs.writeFileSync(path.join(outputDir, "speedometer.csv"), speedometerCsv.join("\n") + "\n");
  fs.writeFileSync(path.join(outputDir, "network.csv"), networkCsv.join("\n") + "\n");

  // If Workload suite was executed, export workload CSVs
  if (manifestData.workloadResults) {
    const rawHeaders = [
      "Browser,Category,SiteName,Url,Iteration,StartupMs,LoadTimeMs,DNS_Ms,TCP_Ms,TLS_Ms,TTFB_Ms,Download_Ms,FCP_Ms,DomInteractiveMs,DomCompleteMs,PeakCpuPercent,AvgCpuPercent,PeakMemoryMB,FinalMemoryMB,Requests,TransferMB,TransferRateKBs",
    ];
    const compHeaders = [
      "Browser,Light_MeanLoadMs,Heavy_MeanLoadMs,LoadInflationRatio,Light_PeakRAM_MB,Heavy_PeakRAM_MB,RAM_InflationRatio,Light_MeanCPU,Heavy_MeanCPU",
    ];

    const rawRows = manifestData.workloadResults.raw.map(
      (r) =>
        `${r.browser},${r.category},"${r.siteName}","${r.url}",${r.iteration},${r.startupMs},${r.loadTimeMs},${r.dnsMs},${r.tcpMs},${r.tlsMs},${r.ttfbMs},${r.downloadMs},${r.fcpMs},${r.domInteractiveMs},${r.domCompleteMs},${r.peakCpuPercent},${r.avgCpuPercent},${r.peakMemoryMB},${r.finalMemoryMB},${r.requests},${r.transferMB},${r.transferRateKBs}`
    );

    const compRows = manifestData.workloadResults.comparison.map(
      (c) =>
        `${c.browser},${c.lightMeanLoadMs},${c.heavyMeanLoadMs},${c.loadInflationRatio},${c.lightPeakRamMB},${c.heavyPeakRamMB},${c.ramInflationRatio},${c.lightMeanCpu},${c.heavyMeanCpu}`
    );

    fs.writeFileSync(path.join(outputDir, "workload_raw.csv"), rawHeaders.concat(rawRows).join("\n") + "\n");
    fs.writeFileSync(path.join(outputDir, "workload_comparison.csv"), compHeaders.concat(compRows).join("\n") + "\n");
  }
}

/**
 * Primary Benchmark Execution Command
 */
async function executeRun(options) {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-").slice(0, 16);
  const launchers = getLaunchers(options.browsers);

  console.log(`\n========================================================================`);
  console.log(`🚀 SPECTRA NEXT-GEN BROWSER EVALUATION PLATFORM`);
  console.log(`   Suite: ${options.suite.toUpperCase()} | OS: ${os.type()} (${os.cpus().length} Logical Cores)`);
  console.log(`   Target Browsers: ${launchers.map((b) => b.name).join(", ")}`);
  console.log(`========================================================================\n`);

  const manifest = {
    metadata: {
      timestamp: new Date().toISOString(),
      platform: os.platform(),
      osRelease: os.release(),
      cpuCores: os.cpus().length,
      cpuModel: os.cpus()[0]?.model || "Unknown",
      totalMemoryGB: Number((os.totalmem() / (1024 * 1024 * 1024)).toFixed(1)),
      suite: options.suite,
      runs: options.runs,
    },
    canonicalRuns: [],
    speedometerRuns: [],
    workloadResults: null,
  };

  // 1. Standard Canonical Suite
  if (options.suite === "standard" || options.suite === "all" || options.suite === "canonical") {
    for (const browser of launchers) {
      console.log(`\n========== ${browser.name.toUpperCase()}: CANONICAL SUITE ==========`);
      for (let r = 1; r <= options.runs; r++) {
        console.log(`\n[${browser.name}] Iteration ${r}/${options.runs}`);
        const result = await runCanonicalIteration(browser, r);
        manifest.canonicalRuns.push(result);
        await sleep(INTER_RUN_DELAY_MS);
      }

      console.log(`\n-- ${browser.name}: Speedometer 3.0 --`);
      for (let r = 1; r <= options.speedometerRuns; r++) {
        try {
          const score = await runSpeedometerBenchmark(browser, r);
          manifest.speedometerRuns.push({ browser: browser.name, run: r, score });
        } catch (err) {
          console.log(`  Speedometer FAILED for ${browser.name}:`, err.message);
          break;
        }
      }
    }
  }

  // 2. 2-Tier Workload Suite
  if (options.suite === "workloads" || options.suite === "all") {
    console.log(`\n========== WORKLOAD SCALING SUITE (5 Light vs 5 Heavy SPAs) ==========`);
    manifest.workloadResults = await runWorkloadSuite(launchers, options.workloadIters);
  }

  // Save to active results/ directory
  saveRunOutputs(RESULTS_DIR, manifest);

  // Archive timestamped backup copy
  const archiveDir = path.join(path.dirname(RESULTS_DIR), `results_${timestamp}`);
  saveRunOutputs(archiveDir, manifest);

  console.log(`\n========================================================================`);
  console.log(`✅ EVALUATION COMPLETE!`);
  console.log(`📁 Active Manifest & CSVs: ${RESULTS_DIR}`);
  console.log(`📁 Historical Archive:     ${archiveDir}`);
  console.log(`========================================================================\n`);
  console.log(`Run "node spectra.js analyze" to inspect Raj Jain statistical scorecards.`);
  console.log(`Run "node spectra.js serve" to launch the visual web dashboard.`);
}

/**
 * Statistical Analysis Command
 */
function executeAnalyze(options) {
  const targetDir = options.targetDir
    ? path.isAbsolute(options.targetDir)
      ? options.targetDir
      : path.join(path.dirname(RESULTS_DIR), options.targetDir)
    : RESULTS_DIR;

  if (!fs.existsSync(targetDir)) {
    console.error(`Directory not found: ${targetDir}`);
    process.exit(1);
  }

  const { analyzeDirectory } = require("./scripts/analyze");
  analyzeDirectory(targetDir);
}

/**
 * Web Dashboard Server Command
 */
function executeServe(options) {
  process.env.PORT = options.port;
  require("./dashboard/server");
}

// Main CLI Dispatcher
async function main() {
  const options = parseArgs(process.argv.slice(2));

  switch (options.command) {
    case "run":
    case "bench":
      await executeRun(options);
      break;
    case "analyze":
    case "stats":
      executeAnalyze(options);
      break;
    case "serve":
    case "dashboard":
      executeServe(options);
      break;
    default:
      console.log(`
Spectra CLI Usage:
  node spectra.js run [--suite standard|workloads|all] [--runs N] [--browsers chrome,edge,firefox]
  node spectra.js analyze [run-directory]
  node spectra.js serve [--port 3000]
      `);
      break;
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Execution error:", err);
    process.exit(1);
  });
}

module.exports = { executeRun, executeAnalyze, executeServe };
