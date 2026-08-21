const os = require("os");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const {
  RESULTS_DIR,
  URLS,
  RUNS,
  SPEEDOMETER_RUNS,
  SPEEDOMETER_URL,
  INTER_RUN_DELAY_MS,
  INTER_SITE_DELAY_MS,
} = require("./config");
const { getLaunchers, ensureDir } = require("./browsers");
const { sleep, getCpuTime, getMemoryMB, NavigationTelemetryMonitor } = require("./telemetry");

/**
 * Runs multi-site page loading and W3C network telemetry collection for one run
 */
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
        .goto(url, { waitUntil: "domcontentloaded", timeout: 25000 })
        .catch(async () => {
          await page.goto(url, { waitUntil: "commit", timeout: 25000 });
        });
      await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
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
        const download = nav ? Math.max(0, nav.responseEnd - nav.responseStart) : 0;
        const domInteractive = nav ? nav.domInteractive : 0;
        const domComplete = nav ? nav.domComplete : 0;
        const fcpEntry = paintList.find(p => p.name === "first-contentful-paint");
        const fcp = fcpEntry ? fcpEntry.startTime : 0;

        return {
          loadMs: nav ? nav.loadEventEnd : null,
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

      const rawLoadMs = timing?.loadMs ?? (navElapsedSec * 1000);
      const finalLoadMs = (rawLoadMs > 0 && rawLoadMs < 45000) ? rawLoadMs : (navElapsedSec * 1000);

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

      if (finalLoadMs > 0) {
        pageloadCsv.rows.push(`${browserInfo.name},${run},${url},${finalLoadMs.toFixed(2)}`);
        networkCsv.rows.push(
          `${browserInfo.name},${run},${url},${finalReqCount},${totalBytes},${transferMB},${transferRateKBs},${dnsMs},${tcpMs},${tlsMs},${ttfbMs},${dlMs},${fcpMs}`
        );
        console.log(
          `  ${url}: ${finalLoadMs.toFixed(0)}ms load (TTFB: ${ttfbMs}ms, FCP: ${fcpMs}ms) | peak_cpu=${stats.peakCpu}% peak_mem=${stats.peakMemoryMB}MB | ${transferMB}MB (${finalReqCount} reqs @ ${transferRateKBs} KB/s)`
        );
      }
    } catch {
      console.log(`  ${url}: failed to load, skipping`);
    } finally {
      await page.close().catch(() => {});
      await sleep(INTER_SITE_DELAY_MS);
    }
  }

  // Calculate active navigation CPU across all websites in this run
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

  await browser.close().catch(() => {});
}

/**
 * Runs Speedometer 3.0 benchmark and extracts score directly via DOM selector
 */
async function runSpeedometer(browserInfo, runNumber) {
  console.log(`  Speedometer run ${runNumber}`);

  const browser = await browserInfo.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(600000);

    await page.goto(SPEEDOMETER_URL, { waitUntil: "domcontentloaded", timeout: 30000 });
    await page.waitForSelector(".start-tests-button", { timeout: 30000 });
    await sleep(1000);
    await page.click(".start-tests-button");

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
      throw new Error("Score extraction failed.");
    }

    console.log(`  Speedometer score: ${score}`);
    return score;
  } finally {
    await browser.close().catch(() => {});
    await sleep(2000);
  }
}

/**
 * Main Benchmark Runner
 */
async function main() {
  console.log(`\n========================================================================`);
  console.log(`🚀 SPECTRA BROWSER PERFORMANCE EVALUATION SUITE`);
  console.log(`   Methodology: 6-Pillar Framework & Raj Jain Ch. 10–14`);
  console.log(`   Canonical Suite: 10 Websites × ${RUNS} Iterations | Speedometer: ${SPEEDOMETER_RUNS} Runs`);
  console.log(`========================================================================\n`);

  ensureDir(RESULTS_DIR);

  const metricsCsv = { rows: ["Browser,Run,Startup(ms),CPU(%),Memory(MB)"] };
  const pageloadCsv = { rows: ["Browser,Run,Website,LoadTime(ms)"] };
  const speedometerCsv = { rows: ["Browser,Run,Score"] };
  const networkCsv = { rows: ["Browser,Run,Website,Requests,TransferBytes,Transfer(MB),TransferRate(KB/s),DNS(ms),TCP(ms),TLS(ms),TTFB(ms),Download(ms),FCP(ms)"] };

  for (const browserInfo of getLaunchers()) {
    console.log(`\n========== ${browserInfo.name.toUpperCase()} ==========`);

    for (let run = 1; run <= RUNS; run++) {
      console.log(`\nRun ${run}/${RUNS}`);
      await runCoreMetrics(browserInfo, run, metricsCsv, pageloadCsv, networkCsv);
      await sleep(INTER_RUN_DELAY_MS);
    }

    console.log(`\n-- ${browserInfo.name}: Speedometer 3.0 --`);
    for (let run = 1; run <= SPEEDOMETER_RUNS; run++) {
      try {
        const score = await runSpeedometer(browserInfo, run);
        speedometerCsv.rows.push(`${browserInfo.name},${run},${score}`);
      } catch (error) {
        console.log("  Speedometer FAILED:", error.message);
        break;
      }
    }
  }

  // Save current active results
  fs.writeFileSync(path.join(RESULTS_DIR, "metrics.csv"), metricsCsv.rows.join("\n") + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "pageload.csv"), pageloadCsv.rows.join("\n") + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "speedometer.csv"), speedometerCsv.rows.join("\n") + "\n");
  fs.writeFileSync(path.join(RESULTS_DIR, "network.csv"), networkCsv.rows.join("\n") + "\n");

  // Automatically archive a timestamped backup copy
  const date = new Date();
  const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;

  const archiveDir = path.join(path.dirname(RESULTS_DIR), `results_${timestamp}`);
  ensureDir(archiveDir);
  fs.copyFileSync(path.join(RESULTS_DIR, "metrics.csv"), path.join(archiveDir, "metrics.csv"));
  fs.copyFileSync(path.join(RESULTS_DIR, "pageload.csv"), path.join(archiveDir, "pageload.csv"));
  fs.copyFileSync(path.join(RESULTS_DIR, "speedometer.csv"), path.join(archiveDir, "speedometer.csv"));
  fs.copyFileSync(path.join(RESULTS_DIR, "network.csv"), path.join(archiveDir, "network.csv"));

  console.log(`\n========================================================================`);
  console.log(`✅ BENCHMARK COMPLETE!`);
  console.log(`📁 Active Data: ${RESULTS_DIR}`);
  console.log(`📁 Archive Copy: ${archiveDir}`);
  console.log(`========================================================================\n`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
  });
}

module.exports = { runCoreMetrics, runSpeedometer, main };
