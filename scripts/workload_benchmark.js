// ============================================================================
// BROWSER PERFORMANCE EVALUATION: LIGHTWEIGHT VS. HEAVYWEIGHT WORKLOAD SUITE
// Methodology: Raj K. Jain, "The Art of Computer Systems Performance Analysis"
// ============================================================================
// Measures cold startup speed, page load latency (TTFB, DOM, Load),
// and continuous active-navigation peak CPU / RAM resource demand across 5 Lightweight
// and 5 Heavyweight websites with 5 iterations per browser and strict 5-second
// stabilization cooldown pauses. Outputs directly to standard `results_timestamp` folders.

const os = require("os");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { execSync } = require("child_process");
const { BROWSERS } = require("./config");
const { getLaunchers } = require("./browsers");
const { computeDescriptiveStats } = require("./stats");

// Configuration parameters
const ITERATIONS = Number(process.env.ITERATIONS) || 5;
const POST_LOAD_STABILIZE_MS = 2000;    // 2s post-load settle before stopping peak monitor
const INTER_SITE_DELAY_MS = 5000;       // 5s strict rest between each website
const INTER_ITERATION_DELAY_MS = 5000;  // 5s strict rest between iterations

// Categorized Workload Websites (5 Ultra-Fast Document Sites vs. 5 Heavy Dynamic SPAs)
const WORKLOADS = {
  Lightweight: [
    { name: "Example Domain", url: "https://example.com" },
    { name: "Hacker News", url: "https://news.ycombinator.com" },
    { name: "Wikipedia Main", url: "https://en.wikipedia.org/wiki/Main_Page" },
    { name: "HTTPBin HTML", url: "https://httpbin.org/html" },
    { name: "W3C Consortium", url: "https://www.w3.org" },
  ],
  Heavyweight: [
    { name: "Reddit Feed", url: "https://www.reddit.com" },
    { name: "YouTube Home", url: "https://www.youtube.com" },
    { name: "GitHub VSCode Repo", url: "https://github.com/microsoft/vscode" },
    { name: "Amazon Portal", url: "https://www.amazon.com" },
    { name: "Unsplash Media", url: "https://unsplash.com" },
  ],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getCpuTime(processName) {
  try {
    const cmd = `powershell -NoProfile -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum"`;
    const output = execSync(cmd, { encoding: "utf8" }).trim();
    return Number(output) || 0;
  } catch {
    return 0;
  }
}

function getMemoryMB(processName) {
  try {
    const cmd = `powershell -NoProfile -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum"`;
    const output = execSync(cmd, { encoding: "utf8" }).trim();
    const bytes = Number(output);
    return isNaN(bytes) ? 0 : bytes / 1024 / 1024;
  } catch {
    return 0;
  }
}

// Continuous Active-Navigation Telemetry Monitor
// Samples process CPU & WorkingSet64 every 300ms from navigation start through render
class NavigationTelemetryMonitor {
  constructor(processName, sampleIntervalMs = 300) {
    this.processName = processName;
    this.sampleIntervalMs = sampleIntervalMs;
    this.cpuCount = os.cpus().length;
    this.samples = [];
    this.peakCpu = 0;
    this.peakMemoryMB = 0;
    this.running = false;
    this.lastCpuTime = 0;
    this.lastWallTime = 0;
  }

  start() {
    this.running = true;
    this.lastCpuTime = getCpuTime(this.processName);
    this.lastWallTime = performance.now();
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
    const avgCpu =
      this.samples.length > 0
        ? Number((this.samples.reduce((a, b) => a + b.cpu, 0) / this.samples.length).toFixed(2))
        : 0;
    const finalMem =
      this.samples.length > 0
        ? Number(this.samples[this.samples.length - 1].mem.toFixed(1))
        : getMemoryMB(this.processName);

    return {
      peakCpu: Number(this.peakCpu.toFixed(2)),
      avgCpu,
      peakMemoryMB: Number(this.peakMemoryMB.toFixed(1)),
      finalMemoryMB: finalMem,
    };
  }
}

async function runWorkloadBenchmark() {
  const date = new Date();
  const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;

  const outputDir = path.join(__dirname, "..", `results_${timestamp}`);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n========================================================================`);
  console.log(`🧪 LIGHTWEIGHT VS. HEAVYWEIGHT BROWSER WORKLOAD BENCHMARK`);
  console.log(`   Methodology: Raj Jain Ch. 3, 11 (5 Light vs. 5 Heavy × ${ITERATIONS} Iterations)`);
  console.log(`   Inter-Site Pause: ${INTER_SITE_DELAY_MS / 1000}s | Inter-Iteration Pause: ${INTER_ITERATION_DELAY_MS / 1000}s`);
  console.log(`   Telemetry Mode: Continuous Active-Navigation Peak Load Tracking`);
  console.log(`   Output Directory: ${outputDir}`);
  console.log(`========================================================================\n`);

  const rawRows = [
    "Browser,Category,SiteName,Url,Iteration,StartupMs,LoadTimeMs,TTFB_Ms,DomInteractiveMs,DomCompleteMs,PeakCpuPercent,AvgCpuPercent,PeakMemoryMB,FinalMemoryMB,Requests,TransferMB,TransferRateKBs",
  ];

  const metricsRows = ["browser,run,startup_time_ms,cpu_percent,memory_mb"];
  const pageloadRows = ["browser,run,url,load_time_ms"];
  const speedometerRows = ["browser,run,score"];
  const networkRows = ["Browser,Run,Category,SiteName,Url,Requests,TransferBytes,Transfer(MB),TransferRate(KB/s)"];

  const launchers = getLaunchers();
  const aggregated = {};

  for (const browserInfo of launchers) {
    aggregated[browserInfo.name] = {
      startupTimes: [],
      Lightweight: { loadTimes: [], peakCpus: [], peakMems: [] },
      Heavyweight: { loadTimes: [], peakCpus: [], peakMems: [] },
    };

    console.log(`\n▶ Starting Evaluation: ${browserInfo.name.toUpperCase()}`);
    console.log(`------------------------------------------------------------------------`);

    for (let iter = 1; iter <= ITERATIONS; iter++) {
      console.log(`\n  [${browserInfo.name}] Iteration ${iter}/${ITERATIONS}`);

      let iterCpus = [];
      let iterMems = [];
      let iterStartupMs = 0;

      for (const [category, siteList] of Object.entries(WORKLOAD_SITES)) {
        console.log(`    📁 Category: ${category}`);

        const startStartup = performance.now();
        const browser = await browserInfo.launch();
        const startupMs = performance.now() - startStartup;
        if (iterStartupMs === 0) iterStartupMs = startupMs;
        aggregated[browserInfo.name].startupTimes.push(startupMs);

        const context = await browser.newContext();

        // -------------------------------------------------------------
        // UNMETERED WARMUP PASS: Eliminates cold V8 / Gecko engine JIT noise
        // -------------------------------------------------------------
        const warmupPage = await context.newPage();
        try {
          await warmupPage.goto(WARMUP_URL, { waitUntil: "domcontentloaded", timeout: 20000 }).catch(() => {});
          await sleep(1500);
        } catch {
        } finally {
          await warmupPage.close().catch(() => {});
          await sleep(1000);
        }

        for (const site of siteList) {
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
            // Start continuous active telemetry monitor
            const monitor = new NavigationTelemetryMonitor(browserInfo.process, 300);
            monitor.start();

            const startNav = performance.now();

            // Resilient navigation strategy
            await page
              .goto(site.url, { waitUntil: "domcontentloaded", timeout: 25000 })
              .catch(async () => {
                await page.goto(site.url, { waitUntil: "commit", timeout: 25000 });
              });
            await page.waitForLoadState("load", { timeout: 6000 }).catch(() => {});

            const totalNavMs = performance.now() - startNav;

            const timings = await page
              .evaluate(() => {
                const nav = performance.getEntriesByType("navigation")[0];
                const resList = performance.getEntriesByType("resource");
                let clientBytes = nav ? (nav.transferSize || nav.encodedBodySize || 0) : 0;
                let clientCount = 1;
                for (const r of resList) {
                  clientCount++;
                  clientBytes += (r.transferSize || r.encodedBodySize || r.decodedBodySize || 0);
                }

                if (!nav) return { loadTime: null, ttfb: null, domInteractive: null, domComplete: null, clientBytes, clientCount };
                return {
                  loadTime:
                    nav.loadEventEnd > 0
                      ? nav.loadEventEnd
                      : nav.domContentLoadedEventEnd > 0
                      ? nav.domContentLoadedEventEnd
                      : nav.responseEnd,
                  ttfb: nav.responseStart,
                  domInteractive: nav.domInteractive,
                  domComplete: nav.domComplete,
                  clientBytes,
                  clientCount,
                };
              })
              .catch(() => ({ loadTime: null, ttfb: null, domInteractive: null, domComplete: null, clientBytes: 0, clientCount: 0 }));

            const effectiveLoad =
              timings.loadTime != null && timings.loadTime > 0 ? timings.loadTime : totalNavMs;
            const ttfb = timings.ttfb != null ? timings.ttfb.toFixed(1) : "0.0";
            const domInt = timings.domInteractive != null ? timings.domInteractive.toFixed(1) : "0.0";
            const domComp = timings.domComplete != null ? timings.domComplete.toFixed(1) : "0.0";

            const totalTransBytes = Math.max(transferBytes, timings.clientBytes || 0);
            const totalRequests = Math.max(requestCount, timings.clientCount || 1);
            const transferMB = Number((totalTransBytes / (1024 * 1024)).toFixed(2));
            const transferRateKBs = Number(((totalTransBytes / 1024) / (effectiveLoad / 1000 || 1)).toFixed(1));

            // Post-load stabilization window
            await sleep(POST_LOAD_STABILIZE_MS);

            // Stop continuous monitor and extract true peak burst
            const tele = monitor.stop();

            aggregated[browserInfo.name][category].loadTimes.push(effectiveLoad);
            aggregated[browserInfo.name][category].peakCpus.push(tele.peakCpu);
            aggregated[browserInfo.name][category].peakMems.push(tele.peakMemoryMB);

            iterCpus.push(tele.peakCpu);
            iterMems.push(tele.peakMemoryMB);

            rawRows.push(
              `${browserInfo.name},${category},"${site.name}","${site.url}",${iter},${startupMs.toFixed(
                1
              )},${effectiveLoad.toFixed(1)},${ttfb},${domInt},${domComp},${tele.peakCpu.toFixed(
                2
              )},${tele.avgCpu.toFixed(2)},${tele.peakMemoryMB.toFixed(1)},${tele.finalMemoryMB.toFixed(1)},${totalRequests},${transferMB},${transferRateKBs}`
            );

            pageloadRows.push(
              `${browserInfo.name},${iter},${site.url},${effectiveLoad.toFixed(2)}`
            );

            networkRows.push(
              `${browserInfo.name},${iter},${category},"${site.name}","${site.url}",${totalRequests},${totalTransBytes},${transferMB},${transferRateKBs}`
            );

            console.log(
              `      • ${site.name.padEnd(20)} | Load: ${effectiveLoad
                .toFixed(0)
                .padStart(5)}ms | RAM: ${tele.peakMemoryMB
                .toFixed(0)
                .padStart(5)}MB | CPU: ${tele.peakCpu.toFixed(1).padStart(4)}% | Net: ${transferMB.toFixed(1)}MB (${transferRateKBs} KB/s)`
            );
          } catch (err) {
            console.log(`      • ${site.name.padEnd(20)} | Timeout/Skipped (${err.message.slice(0, 30)})`);
          } finally {
            await page.close().catch(() => {});
            await sleep(INTER_SITE_DELAY_MS);
          }
        }

        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        await sleep(INTER_ITERATION_DELAY_MS);
      }

      const meanIterCpu = iterCpus.length ? (iterCpus.reduce((a, b) => a + b, 0) / iterCpus.length) : 0;
      const meanIterMem = iterMems.length ? (iterMems.reduce((a, b) => a + b, 0) / iterMems.length) : 0;
      metricsRows.push(`${browserInfo.name},${iter},${iterStartupMs.toFixed(2)},${meanIterCpu.toFixed(2)},${meanIterMem.toFixed(1)}`);
    }
  }

  // Write Standard Run CSVs
  fs.writeFileSync(path.join(outputDir, "metrics.csv"), metricsRows.join("\n"), "utf8");
  fs.writeFileSync(path.join(outputDir, "pageloads.csv"), pageloadRows.join("\n"), "utf8");
  fs.writeFileSync(path.join(outputDir, "speedometer.csv"), speedometerRows.join("\n"), "utf8");
  fs.writeFileSync(path.join(outputDir, "network.csv"), networkRows.join("\n"), "utf8");

  // Write Workload Specific CSVs
  fs.writeFileSync(path.join(outputDir, "workload_raw.csv"), rawRows.join("\n"), "utf8");

  // Generate and Write Comparative Summary CSV
  const summaryRows = [
    "Browser,Category,SampleCount,MeanStartupMs,MeanLoadMs,MedianLoadMs,P90LoadMs,MeanPeakCpuPercent,MeanPeakMemoryMB,CoV_LoadTime",
  ];

  const comparisonRows = [
    "Browser,Light_MeanLoadMs,Heavy_MeanLoadMs,LoadInflationRatio,Light_PeakRAM_MB,Heavy_PeakRAM_MB,RAM_InflationRatio,Light_PeakCPU,Heavy_PeakCPU",
  ];

  console.log(`\n========================================================================`);
  console.log(`📊 COMPARATIVE WORKLOAD SUMMARY: LIGHTWEIGHT VS. HEAVYWEIGHT (PEAK STRESS)`);
  console.log(`========================================================================`);
  console.log(
    `Browser     Category      Mean Load     Median     P90 Load     Peak RAM     Peak CPU`
  );
  console.log(`------------------------------------------------------------------------`);

  for (const [browser, catData] of Object.entries(aggregated)) {
    const startupStats = computeDescriptiveStats(catData.startupTimes);

    const lightStats = computeDescriptiveStats(catData.Lightweight.loadTimes);
    const heavyStats = computeDescriptiveStats(catData.Heavyweight.loadTimes);

    const lightCpuStats = computeDescriptiveStats(catData.Lightweight.peakCpus);
    const heavyCpuStats = computeDescriptiveStats(catData.Heavyweight.peakCpus);

    const lightMemStats = computeDescriptiveStats(catData.Lightweight.peakMems);
    const heavyMemStats = computeDescriptiveStats(catData.Heavyweight.peakMems);

    summaryRows.push(
      `${browser},Lightweight,${lightStats.n},${startupStats.mean.toFixed(1)},${lightStats.mean.toFixed(
        1
      )},${lightStats.median.toFixed(1)},${lightStats.p90.toFixed(1)},${lightCpuStats.mean.toFixed(
        2
      )},${lightMemStats.mean.toFixed(1)},${lightStats.cov.toFixed(3)}`
    );

    summaryRows.push(
      `${browser},Heavyweight,${heavyStats.n},${startupStats.mean.toFixed(1)},${heavyStats.mean.toFixed(
        1
      )},${heavyStats.median.toFixed(1)},${heavyStats.p90.toFixed(1)},${heavyCpuStats.mean.toFixed(
        2
      )},${heavyMemStats.mean.toFixed(1)},${heavyStats.cov.toFixed(3)}`
    );

    const loadRatio = lightStats.mean > 0 ? (heavyStats.mean / lightStats.mean).toFixed(2) : "N/A";
    const memRatio = lightMemStats.mean > 0 ? (heavyMemStats.mean / lightMemStats.mean).toFixed(2) : "N/A";

    comparisonRows.push(
      `${browser},${lightStats.mean.toFixed(1)},${heavyStats.mean.toFixed(1)},${loadRatio}x,${lightMemStats.mean.toFixed(
        1
      )},${heavyMemStats.mean.toFixed(1)},${memRatio}x,${lightCpuStats.mean.toFixed(2)},${heavyCpuStats.mean.toFixed(2)}`
    );

    console.log(
      `${browser.padEnd(11)} Lightweight   ${(lightStats.mean.toFixed(0) + " ms").padEnd(13)} ${(
        lightStats.median.toFixed(0) + " ms"
      ).padEnd(10)} ${(lightStats.p90.toFixed(0) + " ms").padEnd(12)} ${(
        lightMemStats.mean.toFixed(0) + " MB"
      ).padEnd(12)} ${lightCpuStats.mean.toFixed(1)}%`
    );
    console.log(
      `${"".padEnd(11)} Heavyweight   ${(heavyStats.mean.toFixed(0) + " ms").padEnd(13)} ${(
        heavyStats.median.toFixed(0) + " ms"
      ).padEnd(10)} ${(heavyStats.p90.toFixed(0) + " ms").padEnd(12)} ${(
        heavyMemStats.mean.toFixed(0) + " MB"
      ).padEnd(12)} ${heavyCpuStats.mean.toFixed(1)}%`
    );
    console.log(
      `            ↳ Workload Overhead: Heavy sites take ${loadRatio}x longer & use ${memRatio}x more peak RAM\n`
    );
  }

  fs.writeFileSync(path.join(outputDir, "workload_summary.csv"), summaryRows.join("\n"), "utf8");
  fs.writeFileSync(path.join(outputDir, "workload_comparison.csv"), comparisonRows.join("\n"), "utf8");

  console.log(`========================================================================`);
  console.log(`✅ BENCHMARK COMPLETE!`);
  console.log(`📁 All data saved to: ${outputDir}`);
  console.log(`   • metrics.csv & pageloads.csv`);
  console.log(`   • workload_raw.csv & workload_summary.csv`);
  console.log(`   • workload_comparison.csv`);
  console.log(`========================================================================\n`);
}

if (require.main === module) {
  runWorkloadBenchmark().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
  });
}

module.exports = { runWorkloadBenchmark };
