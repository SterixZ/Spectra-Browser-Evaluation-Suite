// One script, one browser launch per run: measures startup time, page load
// time per site, then CPU% and memory from a single stabilization window —
// instead of separately re-opening the same sites once per metric. Finishes
// with the Speedometer synthetic-score pass per browser.
//
// Usage:  node scripts/full_benchmark.js
// Tune via env vars: RUNS, SPEEDOMETER_RUNS, STABILIZE_MS,
//                     CPU_SAMPLE_COUNT, CPU_SAMPLE_INTERVAL_MS

const os = require("os");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { execSync } = require("child_process");
const {
  RESULTS_DIR,
  URLS,
  RUNS,
  SPEEDOMETER_RUNS,
  SPEEDOMETER_URL,
  STABILIZE_MS,
  CPU_SAMPLE_COUNT,
  CPU_SAMPLE_INTERVAL_MS,
} = require("./config");
const { getLaunchers, ensureResultsDir } = require("./browsers");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// NOTE: CPU/memory sampling matches by OS PROCESS NAME (Windows, via
// PowerShell). Close other windows of the browser under test first, or
// its usage gets folded into these numbers too.

function getCpuTime(processName) {
  try {
    const command = `powershell -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum"`;
    const output = execSync(command, { encoding: "utf8" }).trim();
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

// Continuous Active-Navigation Telemetry Monitor
// Samples process CPU & WorkingSet64 every 300ms during page navigation and render
class NavigationTelemetryMonitor {
  constructor(processName, sampleIntervalMs = 300) {
    this.processName = processName;
    this.sampleIntervalMs = sampleIntervalMs;
    this.cpuCount = os.cpus().length || 1;
    this.samples = [];
    this.peakCpu = 0;
    this.peakMemoryMB = 0;
    this.running = false;
    this.startCpuTime = 0;
    this.startWallTime = 0;
    this.lastCpuTime = 0;
    this.lastWallTime = 0;
  }

  start() {
    this.running = true;
    this.startCpuTime = getCpuTime(this.processName);
    this.startWallTime = performance.now();
    this.lastCpuTime = this.startCpuTime;
    this.lastWallTime = this.startWallTime;
    this.peakMemoryMB = getMemoryMB(this.processName);

    const pollLoop = async () => {
      while (this.running) {
        await sleep(this.sampleIntervalMs);
        if (!this.running) break;

        const currentCpuTime = getCpuTime(this.processName);
        const currentWallTime = performance.now();
        const currentMem = getMemoryMB(this.processName);

        const deltaCpuSec = currentCpuTime - this.lastCpuTime;
        const deltaWallSec = (currentWallTime - this.lastWallTime) / 1000;

        if (deltaWallSec > 0 && deltaCpuSec >= 0) {
          const cpuPercent = Number(
            Math.max(0, Math.min(100, (deltaCpuSec * 100) / (this.cpuCount * deltaWallSec))).toFixed(2)
          );
          this.samples.push({ cpu: cpuPercent, mem: currentMem });
          if (cpuPercent > this.peakCpu) this.peakCpu = cpuPercent;
          if (currentMem > this.peakMemoryMB) this.peakMemoryMB = currentMem;
        }

        this.lastCpuTime = currentCpuTime;
        this.lastWallTime = currentWallTime;
      }
    };

    pollLoop();
  }

  stop() {
    this.running = false;
    const finalCpuTime = getCpuTime(this.processName);
    const finalWallTime = performance.now();
    const finalMem = getMemoryMB(this.processName);
    if (finalMem > this.peakMemoryMB) this.peakMemoryMB = finalMem;

    const totalCpuSec = Math.max(0, finalCpuTime - this.startCpuTime);
    const totalWallSec = Math.max(0.001, (finalWallTime - this.startWallTime) / 1000);
    const totalCpuPercent = Number(((totalCpuSec * 100) / (this.cpuCount * totalWallSec)).toFixed(2));

    let avgCpu = totalCpuPercent;
    if (this.samples.length > 0) {
      const sampleAvg = this.samples.reduce((a, b) => a + b.cpu, 0) / this.samples.length;
      avgCpu = Number(Math.max(totalCpuPercent, sampleAvg).toFixed(2));
    }
    const peakCpu = Number(Math.max(this.peakCpu, avgCpu, totalCpuPercent).toFixed(2));

    return {
      peakCpu,
      avgCpu,
      peakMemoryMB: Number(this.peakMemoryMB.toFixed(1)),
      finalMemoryMB: Number(finalMem.toFixed(1)),
    };
  }
}

async function runCoreMetrics(browserInfo, run, metricsCsv, pageloadCsv, networkCsv) {
  const startupStart = performance.now();
  const browser = await browserInfo.launch();
  const startupMs = performance.now() - startupStart;

  const startCpuTime = getCpuTime(browserInfo.process);
  const startWallTime = performance.now();
  let peakRunMemoryMB = getMemoryMB(browserInfo.process);
  let peakRunCpuPercent = 0;
  let siteCpuAverages = [];

  const context = await browser.newContext();

  for (const url of URLS) {
    let transferBytes = 0;
    let requestCount = 0;
    const page = await context.newPage();

    page.on("response", async (res) => {
      requestCount++;
      const cl = res.headers()["content-length"];
      if (cl) {
        transferBytes += parseInt(cl, 10) || 0;
      }
    });

    try {
      const monitor = new NavigationTelemetryMonitor(browserInfo.process, 300);
      monitor.start();

      const navStart = performance.now();
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      const navElapsedSec = Math.max(0.1, (performance.now() - navStart) / 1000);

      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const resList = performance.getEntriesByType("resource");
        let clientBytes = nav ? (nav.transferSize || nav.encodedBodySize || 0) : 0;
        let clientCount = 1;
        for (const r of resList) {
          clientCount++;
          clientBytes += (r.transferSize || r.encodedBodySize || r.decodedBodySize || 0);
        }
        return {
          loadMs: nav ? nav.loadEventEnd : null,
          clientBytes,
          clientCount,
        };
      });

      const stats = monitor.stop();
      if (stats.peakMemoryMB > peakRunMemoryMB) peakRunMemoryMB = stats.peakMemoryMB;
      if (stats.peakCpu > peakRunCpuPercent) peakRunCpuPercent = stats.peakCpu;
      siteCpuAverages.push(stats.avgCpu);

      const finalLoadMs = timing?.loadMs ?? (navElapsedSec * 1000);
      const totalBytes = Math.max(transferBytes, timing?.clientBytes || 0);
      const finalReqCount = Math.max(requestCount, timing?.clientCount || 1);
      const transferMB = Number((totalBytes / (1024 * 1024)).toFixed(2));
      const transferRateKBs = Number(((totalBytes / 1024) / (finalLoadMs / 1000 || 1)).toFixed(1));

      if (finalLoadMs != null) {
        pageloadCsv.rows.push(`${browserInfo.name},${run},${url},${finalLoadMs.toFixed(2)}`);
        networkCsv.rows.push(
          `${browserInfo.name},${run},${url},${finalReqCount},${totalBytes},${transferMB},${transferRateKBs}`
        );
        console.log(
          `  ${url}: ${finalLoadMs.toFixed(0)}ms load | peak_cpu=${stats.peakCpu}% peak_mem=${stats.peakMemoryMB}MB | ${transferMB}MB (${finalReqCount} reqs @ ${transferRateKBs} KB/s)`
        );
      }
    } catch {
      console.log(`  ${url}: failed to load, skipping`);
    } finally {
      await page.close().catch(() => {});
    }
  }

  // Calculate cumulative active CPU across the entire multi-site session
  const endCpuTime = getCpuTime(browserInfo.process);
  const endWallTime = performance.now();
  const totalElapsedSec = Math.max(0.1, (endWallTime - startWallTime) / 1000);
  const totalCpuDeltaSec = Math.max(0, endCpuTime - startCpuTime);
  const cumulativeCpuPercent = Number(((totalCpuDeltaSec * 100) / (os.cpus().length * totalElapsedSec)).toFixed(2));
  
  const avgSiteCpu = siteCpuAverages.length > 0
    ? Number((siteCpuAverages.reduce((a, b) => a + b, 0) / siteCpuAverages.length).toFixed(2))
    : cumulativeCpuPercent;

  const finalActiveCpu = Math.max(cumulativeCpuPercent, avgSiteCpu);
  const memoryMB = Number(Math.max(peakRunMemoryMB, getMemoryMB(browserInfo.process)).toFixed(2));

  console.log(
    `  ▶ Run ${run} Summary: startup=${startupMs.toFixed(0)}ms active_cpu=${finalActiveCpu.toFixed(1)}% (peak_burst=${peakRunCpuPercent.toFixed(1)}%) peak_mem=${memoryMB.toFixed(1)}MB`
  );

  metricsCsv.rows.push(
    `${browserInfo.name},${run},${startupMs.toFixed(2)},${finalActiveCpu.toFixed(2)},${memoryMB.toFixed(2)}`
  );

  await browser.close();
}

async function runSpeedometer(browserInfo, runNumber) {
  console.log(`  Speedometer run ${runNumber}`);

  const browser = await browserInfo.launch();
  const page = await browser.newPage();
  page.setDefaultTimeout(600000);

  await page.goto(SPEEDOMETER_URL, { waitUntil: "domcontentloaded" });
  await page.waitForSelector(".start-tests-button");
  await page.click(".start-tests-button");

  await page.waitForFunction(
    () => document.body.innerText.includes("Score") && document.body.innerText.includes("±"),
    null,
    { timeout: 600000 }
  );

  const bodyText = await page.locator("body").innerText();
  const match = bodyText.match(/Score\s*(\d+(\.\d+)?)/);

  if (!match) {
    await page.screenshot({
      path: path.join(RESULTS_DIR, `speedometer_error_${browserInfo.name}_${runNumber}.png`),
    });
    await browser.close();
    throw new Error("Score extraction failed. Screenshot saved.");
  }

  const score = Number(match[1]);
  console.log(`  Speedometer score: ${score}`);
  await browser.close();
  return score;
}

(async () => {
  ensureResultsDir(RESULTS_DIR);

  const metricsCsv = { rows: ["Browser,Run,Startup(ms),CPU(%),Memory(MB)"] };
  const pageloadCsv = { rows: ["Browser,Run,Website,LoadTime(ms)"] };
  const speedometerCsv = { rows: ["Browser,Run,Score"] };
  const networkCsv = { rows: ["Browser,Run,Website,Requests,TransferBytes,Transfer(MB),TransferRate(KB/s)"] };

  for (const browserInfo of getLaunchers()) {
    console.log(`\n========== ${browserInfo.name} ==========`);

    for (let run = 1; run <= RUNS; run++) {
      console.log(`\nRun ${run}/${RUNS}`);
      await runCoreMetrics(browserInfo, run, metricsCsv, pageloadCsv, networkCsv);
    }

    console.log(`\n-- ${browserInfo.name}: Speedometer --`);
    for (let run = 1; run <= SPEEDOMETER_RUNS; run++) {
      try {
        const score = await runSpeedometer(browserInfo, run);
        speedometerCsv.rows.push(`${browserInfo.name},${run},${score}`);
      } catch (error) {
        console.log("  Speedometer FAILED:", error.message);
        break; // skip remaining speedometer runs for this browser, keep going to next browser
      }
    }
  }

  fs.writeFileSync(path.join(RESULTS_DIR, "metrics.csv"), metricsCsv.rows.join("\n") + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "pageload.csv"), pageloadCsv.rows.join("\n") + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "speedometer.csv"), speedometerCsv.rows.join("\n") + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "network.csv"), networkCsv.rows.join("\n") + "\n");

  console.log("\n=============================================");
  console.log("✅ Full benchmark complete!");
  console.log(`📁 metrics.csv, pageload.csv, speedometer.csv, network.csv in ${RESULTS_DIR}`);
  console.log("=============================================");
})();
