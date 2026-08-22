// Core Benchmark Execution Module
// Supports running individual browsers (Chrome, Edge, Firefox) or all browsers together
// Records full telemetry (Active CPU, Peak CPU burst, RAM, Peak RAM, W3C waterfall)
// Auto-archives results/ to results_YYYY-MM-DD_HH-MM only when ALL 3 browsers are complete

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
} = require("./config");
const { getLaunchers, ensureResultsDir } = require("./browsers");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

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
      await page
        .goto(url, { waitUntil: "domcontentloaded", timeout: 18000 })
        .catch(async () => {
          await page.goto(url, { waitUntil: "commit", timeout: 10000 });
        });
      await page.waitForLoadState("load", { timeout: 6000 }).catch(() => {});
      const navElapsedSec = Math.max(0.1, (performance.now() - navStart) / 1000);

      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        const resList = performance.getEntriesByType("resource");
        const paintList = performance.getEntriesByType("paint");

        let clientBytes = nav ? (nav.transferSize || nav.encodedBodySize || 0) : 0;
        let clientCount = 1;
        for (const r of resList) {
          clientCount++;
          clientBytes += (r.transferSize || r.encodedBodySize || r.decodedBodySize || 0);
        }

        const dns = nav ? Math.max(0, nav.domainLookupEnd - nav.domainLookupStart) : 0;
        const tcp = nav ? Math.max(0, nav.connectEnd - nav.connectStart) : 0;
        const tls = nav && nav.secureConnectionStart > 0 ? Math.max(0, nav.connectEnd - nav.secureConnectionStart) : 0;
        const ttfb = nav ? Math.max(0, nav.responseStart - nav.requestStart) : 0;
        
        let download = nav ? Math.max(0, nav.responseEnd - nav.responseStart) : 0;
        if (download === 0 && resList && resList.length > 0) {
          const resDiffs = resList.map(r => r.responseEnd - r.responseStart).filter(d => d > 0);
          if (resDiffs.length > 0) {
            download = resDiffs.reduce((a, b) => a + b, 0) / resDiffs.length;
          } else if (nav && nav.domInteractive > nav.responseStart) {
            download = nav.domInteractive - nav.responseStart;
          }
        }

        const domInteractive = nav ? nav.domInteractive : 0;
        const domComplete = nav ? nav.domComplete : 0;
        const fcpEntry = paintList.find(p => p.name === "first-contentful-paint");
        const fcp = fcpEntry ? fcpEntry.startTime : 0;

        let pageLoadMs = null;
        if (nav) {
          if (nav.loadEventEnd > 0) pageLoadMs = nav.loadEventEnd;
          else if (nav.domComplete > 0) pageLoadMs = nav.domComplete;
          else if (nav.domContentLoadedEventEnd > 0) pageLoadMs = nav.domContentLoadedEventEnd;
          else if (nav.domInteractive > 0) pageLoadMs = nav.domInteractive;
          else if (nav.responseEnd > 0) pageLoadMs = nav.responseEnd;
        }

        return {
          loadMs: pageLoadMs,
          dns,
          tcp,
          tls,
          ttfb,
          download,
          domInteractive,
          domComplete,
          fcp,
          clientBytes,
          clientCount,
        };
      });

      const stats = monitor.stop();
      if (stats.peakMemoryMB > peakRunMemoryMB) peakRunMemoryMB = stats.peakMemoryMB;
      if (stats.peakCpu > peakRunCpuPercent) peakRunCpuPercent = stats.peakCpu;
      siteCpuAverages.push(stats.avgCpu);

      const finalLoadMs = (timing?.loadMs != null && timing.loadMs > 0)
        ? timing.loadMs
        : (navElapsedSec * 1000);
      const totalBytes = Math.max(transferBytes, timing?.clientBytes || 0);
      const finalReqCount = Math.max(requestCount, timing?.clientCount || 1);
      const transferMB = Number((totalBytes / (1024 * 1024)).toFixed(2));
      const transferRateKBs = Number(((totalBytes / 1024) / (finalLoadMs / 1000 || 1)).toFixed(1));

      const dnsMs = (timing?.dns || 0).toFixed(1);
      const tcpMs = (timing?.tcp || 0).toFixed(1);
      const tlsMs = (timing?.tls || 0).toFixed(1);
      const ttfbMs = (timing?.ttfb || 0).toFixed(1);
      const dlMs = (timing?.download || 0).toFixed(1);
      const fcpMs = (timing?.fcp || 0).toFixed(1);

      if (finalLoadMs != null) {
        pageloadCsv.rows.push(`${browserInfo.name},${run},${url},${finalLoadMs.toFixed(2)}`);
        networkCsv.rows.push(
          `${browserInfo.name},${run},${url},${finalReqCount},${totalBytes},${transferMB},${transferRateKBs},${dnsMs},${tcpMs},${tlsMs},${ttfbMs},${dlMs},${fcpMs},${stats.peakCpu.toFixed(2)},${stats.peakMemoryMB.toFixed(1)}`
        );
        console.log(
          `  ${url}: ${finalLoadMs.toFixed(0)}ms load (TTFB: ${ttfbMs}ms, FCP: ${fcpMs}ms) | peak_cpu=${stats.peakCpu}% peak_mem=${stats.peakMemoryMB}MB | ${transferMB}MB (${finalReqCount} reqs @ ${transferRateKBs} KB/s)`
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
    `  ▶ Run ${run} Summary: startup=${startupMs.toFixed(0)}ms active_cpu=${finalActiveCpu.toFixed(1)}% (peak_burst=${peakRunCpuPercent.toFixed(1)}%) peak_mem=${peakRunMemoryMB.toFixed(1)}MB`
  );

  metricsCsv.rows.push(
    `${browserInfo.name},${run},${startupMs.toFixed(2)},${finalActiveCpu.toFixed(2)},${peakRunCpuPercent.toFixed(2)},${memoryMB.toFixed(2)},${peakRunMemoryMB.toFixed(2)}`
  );

  await browser.close();
}

async function runSpeedometer(browserInfo, runNumber) {
  console.log(`  Speedometer run ${runNumber}`);

  const browser = await browserInfo.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(600000);

    await page.goto(SPEEDOMETER_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForLoadState("load", { timeout: 15000 }).catch(() => {});

    const startButton = page.locator(".start-tests-button, button#start-tests, button:has-text('Start Test')").first();
    await startButton.waitFor({ state: "visible", timeout: 30000 });
    await sleep(1000);
    await startButton.click({ force: true });

    await page.waitForFunction(
      () => {
        const text = document.body ? document.body.innerText : "";
        const scoreElem = document.querySelector("#result-number, .result-number, .score");
        return (
          (scoreElem && scoreElem.innerText.trim().length > 0) ||
          (text.includes("Score") && (text.includes("±") || text.includes("/min")))
        );
      },
      null,
      { timeout: 600000 }
    );

    const score = await page.evaluate(() => {
      const el = document.querySelector("#result-number, .result-number, .score");
      if (el && el.innerText.trim().length > 0) {
        const num = parseFloat(el.innerText.trim());
        if (!isNaN(num) && num > 0) return num;
      }
      const match = document.body.innerText.match(/Score\s*\n*\s*(\d+(?:\.\d+)?)/i);
      return match ? parseFloat(match[1]) : null;
    });

    if (!score || isNaN(score)) {
      await page.screenshot({
        path: path.join(RESULTS_DIR, `speedometer_error_${browserInfo.name}_${runNumber}.png`),
      });
      throw new Error("Score extraction failed. Screenshot saved.");
    }

    console.log(`  Speedometer score: ${score}`);
    return score;
  } finally {
    await browser.close().catch(() => {});
    await sleep(2000);
  }
}

function checkAndArchiveResultsDir() {
  const metricsPath = path.join(RESULTS_DIR, "metrics.csv");
  if (!fs.existsSync(metricsPath)) return;

  const content = fs.readFileSync(metricsPath, "utf8");
  const lines = content.trim().split("\n").slice(1);
  const recordedBrowsers = new Set();
  for (const line of lines) {
    const browser = line.split(",")[0].trim();
    if (browser) recordedBrowsers.add(browser.toLowerCase());
  }

  const allThree = ["chrome", "edge", "firefox"].every((b) => recordedBrowsers.has(b));
  if (allThree) {
    const date = new Date();
    const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;
    const projectRoot = path.dirname(RESULTS_DIR);
    let finalDir = path.join(projectRoot, `results_${timestamp}`);

    if (fs.existsSync(finalDir)) {
      finalDir = path.join(projectRoot, `results_${timestamp}_${String(date.getSeconds()).padStart(2, "0")}`);
    }

    fs.renameSync(RESULTS_DIR, finalDir);
    console.log(`\n🎉 ALL 3 BROWSERS COMPLETE!`);
    console.log(`📦 Archived full results to: ${finalDir}`);
    console.log(`📁 Subsequent runs will create a fresh results/ directory.\n`);
  } else {
    const remaining = ["Chrome", "Edge", "Firefox"].filter((b) => !recordedBrowsers.has(b.toLowerCase()));
    console.log(`\nℹ️  Recorded: ${Array.from(recordedBrowsers).join(", ")} | Waiting for: ${remaining.join(", ")} before archiving to results_timestamp.`);
  }
}

async function runBenchmarkForBrowsers(targetNames = ["Chrome", "Edge", "Firefox"]) {
  ensureResultsDir(RESULTS_DIR);

  const metricsPath = path.join(RESULTS_DIR, "metrics.csv");
  const pageloadPath = path.join(RESULTS_DIR, "pageload.csv");
  const speedometerPath = path.join(RESULTS_DIR, "speedometer.csv");
  const networkPath = path.join(RESULTS_DIR, "network.csv");

  const readOrInit = (p, header) => {
    if (fs.existsSync(p)) {
      return { rows: fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean) };
    }
    return { rows: [header] };
  };

  const metricsCsv = readOrInit(metricsPath, "Browser,Run,Startup(ms),CPU(%),PeakCPU(%),Memory(MB),PeakMemory(MB)");
  const pageloadCsv = readOrInit(pageloadPath, "Browser,Run,Website,LoadTime(ms)");
  const speedometerCsv = readOrInit(speedometerPath, "Browser,Run,Score");
  const networkCsv = readOrInit(networkPath, "Browser,Run,Website,Requests,TransferBytes,Transfer(MB),TransferRate(KB/s),DNS(ms),TCP(ms),TLS(ms),TTFB(ms),Download(ms),FCP(ms),PeakCPU(%),PeakMemory(MB)");

  const allLaunchers = getLaunchers();
  const selectedLaunchers = allLaunchers.filter(b => 
    targetNames.map(t => t.toLowerCase()).includes(b.name.toLowerCase())
  );

  if (!selectedLaunchers.length) {
    console.error(`No matching browsers found for: ${targetNames.join(", ")}`);
    process.exit(1);
  }

  for (const browserInfo of selectedLaunchers) {
    console.log(`\n======================================================`);
    console.log(`🚀 EVALUATING BROWSER: ${browserInfo.name.toUpperCase()}`);
    console.log(`======================================================`);

    for (let run = 1; run <= RUNS; run++) {
      console.log(`\n[${browserInfo.name}] Run ${run}/${RUNS}`);
      await runCoreMetrics(browserInfo, run, metricsCsv, pageloadCsv, networkCsv);
      await sleep(2000);
    }

    console.log(`\n-- [${browserInfo.name}] Speedometer 3.0 --`);
    for (let run = 1; run <= SPEEDOMETER_RUNS; run++) {
      try {
        const score = await runSpeedometer(browserInfo, run);
        speedometerCsv.rows.push(`${browserInfo.name},${run},${score}`);
      } catch (error) {
        console.log(`  Speedometer FAILED for ${browserInfo.name}:`, error.message);
        break;
      }
    }

    // Save CSVs incrementally after each browser finishes
    fs.writeFileSync(metricsPath, metricsCsv.rows.join("\n") + "\n");
    fs.writeFileSync(pageloadPath, pageloadCsv.rows.join("\n") + "\n");
    fs.writeFileSync(speedometerPath, speedometerCsv.rows.join("\n") + "\n");
    fs.writeFileSync(networkPath, networkCsv.rows.join("\n") + "\n");
  }

  console.log(`\n======================================================`);
  console.log(`✅ Benchmark Completed for: ${selectedLaunchers.map(b => b.name).join(", ")}`);
  console.log(`📁 CSV data saved in: ${RESULTS_DIR}`);
  console.log(`======================================================\n`);

  // Check if all 3 browsers are present in results/; if so, archive folder!
  checkAndArchiveResultsDir();
}

module.exports = {
  runBenchmarkForBrowsers,
  runCoreMetrics,
  runSpeedometer,
};
