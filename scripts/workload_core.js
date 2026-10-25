// Modular Workload Benchmark Execution Engine
// Evaluates 5 Ultra-Lightweight vs. 5 Extreme Heavyweight Workloads per browser
// Auto-aggregates and archives workloads/ to workloads_YYYY-MM-DD_HH-MM when all 3 browsers finish

const fs = require("fs");
const path = require("path");
const os = require("os");
const { performance } = require("perf_hooks");
const { execSync } = require("child_process");
const { getLaunchers } = require("./browsers");
const { computeDescriptiveStats } = require("./stats");

const ITERATIONS = 3;
const INTER_SITE_DELAY_MS = 1000;
const INTER_ITERATION_DELAY_MS = 2000;
const POST_LOAD_STABILIZE_MS = 1500;
const WARMUP_URL = "https://www.google.com";

const WORKLOADS = {
  Lightweight: [
    { name: "CERN Original WWW", url: "http://info.cern.ch/hypertext/WWW/TheProject.html" },
    { name: "Example Domain", url: "https://example.com" },
    { name: "NPR Text Portal", url: "https://text.npr.org" },
    { name: "DuckDuckGo Lite", url: "https://lite.duckduckgo.com/lite/" },
    { name: "W3C Standards Spec", url: "https://www.w3.org/TR/PNG/" },
  ],
  Heavyweight: [
    { name: "YouTube Feed SPA", url: "https://www.youtube.com" },
    { name: "VS Code Web Hub", url: "https://github.com/microsoft/vscode" },
    { name: "Reddit Infinite Feed", url: "https://www.reddit.com" },
    { name: "Unsplash High-Res Grid", url: "https://unsplash.com" },
    { name: "Wiki GDP Table", url: "https://en.wikipedia.org/wiki/List_of_countries_by_GDP_(nominal)" },
  ],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getCpuTime(processName) {
  try {
    const cmd = `powershell -NoProfile -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum"`;
    const res = execSync(cmd, { encoding: "utf8" }).trim();
    return Number(res) || 0;
  } catch {
    return 0;
  }
}

function getMemoryMB(processName) {
  try {
    const cmd = `powershell -NoProfile -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Measure-Object WorkingSet64 -Sum).Sum"`;
    const res = execSync(cmd, { encoding: "utf8" }).trim();
    const bytes = Number(res);
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

function checkAndArchiveWorkloadsDir(workloadsDir) {
  const rawPath = path.join(workloadsDir, "workload_raw.csv");
  if (!fs.existsSync(rawPath)) return;

  const content = fs.readFileSync(rawPath, "utf8");
  const lines = content.trim().split("\n").slice(1);
  const recordedBrowsers = new Set();
  
  const parsedRows = [];
  for (const line of lines) {
    const parts = line.split(",");
    if (parts.length >= 7) {
      const b = parts[0].trim();
      recordedBrowsers.add(b.toLowerCase());
      parsedRows.push({
        browser: b,
        category: parts[1].trim(),
        siteName: parts[2].replace(/"/g, "").trim(),
        url: parts[3].replace(/"/g, "").trim(),
        iter: parseInt(parts[4]),
        startupMs: parseFloat(parts[5]) || 0,
        loadTimeMs: parseFloat(parts[6]) || 0,
        peakCpu: parseFloat(parts[15]) || 0,
        avgCpu: parseFloat(parts[16]) || 0,
        peakMem: parseFloat(parts[17]) || 0,
      });
    }
  }

  const allThree = ["chrome", "edge", "firefox"].every((b) => recordedBrowsers.has(b));
  if (allThree) {
    // Generate summary and comparison matrices across all 3 browsers
    const summaryRows = [
      "Browser,Category,SampleCount,MeanStartupMs,MeanLoadMs,MedianLoadMs,P90LoadMs,MeanPeakCpuPercent,MeanPeakMemoryMB,CoV_LoadTime",
    ];
    const comparisonRows = [
      "Browser,Light_MeanLoadMs,Heavy_MeanLoadMs,LoadInflationRatio,Light_PeakRAM_MB,Heavy_PeakRAM_MB,RAM_InflationRatio,Light_PeakCPU,Heavy_PeakCPU,CPU_InflationRatio",
    ];

    const browserNames = Array.from(new Set(parsedRows.map((r) => r.browser)));
    for (const b of browserNames) {
      const bRows = parsedRows.filter((r) => r.browser === b);
      const lightRows = bRows.filter((r) => r.category === "Lightweight");
      const heavyRows = bRows.filter((r) => r.category === "Heavyweight");

      const startupStats = computeDescriptiveStats(bRows.map((r) => r.startupMs));
      const lightStats = computeDescriptiveStats(lightRows.map((r) => r.loadTimeMs));
      const heavyStats = computeDescriptiveStats(heavyRows.map((r) => r.loadTimeMs));

      const lightCpuStats = computeDescriptiveStats(lightRows.map((r) => r.peakCpu));
      const heavyCpuStats = computeDescriptiveStats(heavyRows.map((r) => r.peakCpu));

      const lightMemStats = computeDescriptiveStats(lightRows.map((r) => r.peakMem));
      const heavyMemStats = computeDescriptiveStats(heavyRows.map((r) => r.peakMem));

      summaryRows.push(
        `${b},Lightweight,${lightStats.n},${startupStats.mean.toFixed(1)},${lightStats.mean.toFixed(1)},${lightStats.median.toFixed(1)},${lightStats.p90.toFixed(1)},${lightCpuStats.mean.toFixed(2)},${lightMemStats.mean.toFixed(1)},${lightStats.cov.toFixed(3)}`
      );
      summaryRows.push(
        `${b},Heavyweight,${heavyStats.n},${startupStats.mean.toFixed(1)},${heavyStats.mean.toFixed(1)},${heavyStats.median.toFixed(1)},${heavyStats.p90.toFixed(1)},${heavyCpuStats.mean.toFixed(2)},${heavyMemStats.mean.toFixed(1)},${heavyStats.cov.toFixed(3)}`
      );

      const loadRatio = lightStats.mean > 0 ? (heavyStats.mean / lightStats.mean).toFixed(2) : "N/A";
      const memRatio = lightMemStats.mean > 0 ? (heavyMemStats.mean / lightMemStats.mean).toFixed(2) : "N/A";
      const cpuRatio = lightCpuStats.mean > 0 ? (heavyCpuStats.mean / lightCpuStats.mean).toFixed(2) : "N/A";

      comparisonRows.push(
        `${b},${lightStats.mean.toFixed(1)},${heavyStats.mean.toFixed(1)},${loadRatio}x,${lightMemStats.mean.toFixed(1)},${heavyMemStats.mean.toFixed(1)},${memRatio}x,${lightCpuStats.mean.toFixed(2)},${heavyCpuStats.mean.toFixed(2)},${cpuRatio}x`
      );
    }

    fs.writeFileSync(path.join(workloadsDir, "workload_summary.csv"), summaryRows.join("\n") + "\n");
    fs.writeFileSync(path.join(workloadsDir, "workload_comparison.csv"), comparisonRows.join("\n") + "\n");

    const date = new Date();
    const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
      date.getDate()
    ).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;
    const projectRoot = path.dirname(workloadsDir);
    let finalDir = path.join(projectRoot, `workloads_${timestamp}`);

    if (fs.existsSync(finalDir)) {
      finalDir = path.join(projectRoot, `workloads_${timestamp}_${String(date.getSeconds()).padStart(2, "0")}`);
    }

    fs.renameSync(workloadsDir, finalDir);
    console.log(`\n🎉 ALL 3 BROWSERS COMPLETE IN WORKLOADS!`);
    console.log(`📦 Generated summary matrices and archived to: ${finalDir}`);
    console.log(`📁 Subsequent runs will create a fresh workloads/ directory.\n`);
  } else {
    const remaining = ["Chrome", "Edge", "Firefox"].filter((b) => !recordedBrowsers.has(b.toLowerCase()));
    console.log(`\nℹ️  Workload Recorded: ${Array.from(recordedBrowsers).join(", ")} | Waiting for: ${remaining.join(", ")} before auto-archiving to workloads_timestamp.`);
  }
}

async function runWorkloadForBrowsers(targetNames = ["Chrome", "Edge", "Firefox"]) {
  const workloadsDir = path.join(__dirname, "..", "workloads");
  if (!fs.existsSync(workloadsDir)) fs.mkdirSync(workloadsDir, { recursive: true });

  const rawPath = path.join(workloadsDir, "workload_raw.csv");
  const metricsPath = path.join(workloadsDir, "metrics.csv");
  const pageloadPath = path.join(workloadsDir, "pageloads.csv");
  const speedometerPath = path.join(workloadsDir, "speedometer.csv");
  const networkPath = path.join(workloadsDir, "network.csv");

  const readOrInit = (p, header) => {
    if (fs.existsSync(p)) {
      return { rows: fs.readFileSync(p, "utf8").trim().split("\n").filter(Boolean) };
    }
    return { rows: [header] };
  };

  const rawCsv = readOrInit(rawPath, "Browser,Category,SiteName,Url,Iteration,StartupMs,LoadTimeMs,DNS_Ms,TCP_Ms,TLS_Ms,TTFB_Ms,Download_Ms,FCP_Ms,DomInteractiveMs,DomCompleteMs,PeakCpuPercent,AvgCpuPercent,PeakMemoryMB,FinalMemoryMB,Requests,TransferMB,TransferRateKBs");
  const metricsCsv = readOrInit(metricsPath, "browser,run,startup_time_ms,cpu_percent,memory_mb");
  const pageloadCsv = readOrInit(pageloadPath, "browser,run,url,load_time_ms");
  const speedometerCsv = readOrInit(speedometerPath, "browser,run,score");
  const networkCsv = readOrInit(networkPath, "Browser,Run,Category,SiteName,Url,Requests,TransferBytes,Transfer(MB),TransferRate(KB/s),DNS(ms),TCP(ms),TLS(ms),TTFB(ms),Download(ms),FCP(ms)");

  const filterOutBrowser = (csvObj, browserName) => {
    csvObj.rows = csvObj.rows.filter((line, idx) => {
      if (idx === 0) return true; // keep header
      return !line.toLowerCase().startsWith(browserName.toLowerCase() + ",");
    });
  };

  const allLaunchers = getLaunchers();
  const selectedLaunchers = allLaunchers.filter((b) =>
    targetNames.map((t) => t.toLowerCase()).includes(b.name.toLowerCase())
  );

  if (!selectedLaunchers.length) {
    console.error(`No matching browsers found for: ${targetNames.join(", ")}`);
    process.exit(1);
  }

  for (const browserInfo of selectedLaunchers) {
    console.log(`\n========================================================================`);
    console.log(`🧪 WORKLOAD BENCHMARK: ${browserInfo.name.toUpperCase()}`);
    console.log(`   5 Ultra-Light vs. 5 Extreme-Heavy × ${ITERATIONS} Iterations`);
    console.log(`========================================================================\n`);

    // Clean previous rows for this specific browser if re-running
    filterOutBrowser(rawCsv, browserInfo.name);
    filterOutBrowser(metricsCsv, browserInfo.name);
    filterOutBrowser(pageloadCsv, browserInfo.name);
    filterOutBrowser(speedometerCsv, browserInfo.name);
    filterOutBrowser(networkCsv, browserInfo.name);

    for (let iter = 1; iter <= ITERATIONS; iter++) {
      console.log(`\n  [${browserInfo.name}] Iteration ${iter}/${ITERATIONS}`);

      let iterCpus = [];
      let iterMems = [];
      let iterStartupMs = 0;

      for (const [category, siteList] of Object.entries(WORKLOADS)) {
        console.log(`    📁 Category: ${category}`);

        const startStartup = performance.now();
        const browser = await browserInfo.launch();
        const startupMs = performance.now() - startStartup;
        if (iterStartupMs === 0) iterStartupMs = startupMs;

        const context = await browser.newContext();

        // Unmetered Warmup Pass
        const warmupPage = await context.newPage();
        try {
          await warmupPage.goto(WARMUP_URL, { waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => {});
          await sleep(1000);
        } catch {
        } finally {
          await warmupPage.close().catch(() => {});
          await sleep(500);
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

          const monitor = new NavigationTelemetryMonitor(browserInfo.process, 300);
          try {
            monitor.start();

            const startNav = performance.now();

            await page
              .goto(site.url, { waitUntil: "domcontentloaded", timeout: 25000 })
              .catch(async () => {
                await page.goto(site.url, { waitUntil: "commit", timeout: 15000 });
              });
            await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});

            const totalNavMs = performance.now() - startNav;

            const timings = await page
              .evaluate(() => {
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

                let pageLoad = null;
                if (nav) {
                  if (nav.loadEventEnd > 0) pageLoad = nav.loadEventEnd;
                  else if (nav.domComplete > 0) pageLoad = nav.domComplete;
                  else if (nav.domContentLoadedEventEnd > 0) pageLoad = nav.domContentLoadedEventEnd;
                  else if (nav.domInteractive > 0) pageLoad = nav.domInteractive;
                  else if (nav.responseEnd > 0) pageLoad = nav.responseEnd;
                }

                return {
                  loadTime: pageLoad,
                  dns,
                  tcp,
                  tls,
                  ttfb,
                  download,
                  fcp,
                  domInteractive,
                  domComplete,
                  clientBytes,
                  clientCount,
                };
              })
              .catch(() => ({ loadTime: null, dns: 0, tcp: 0, tls: 0, ttfb: 0, download: 0, fcp: 0, domInteractive: 0, domComplete: 0, clientBytes: 0, clientCount: 0 }));

            const effectiveLoad =
              timings.loadTime != null && timings.loadTime > 0 ? timings.loadTime : totalNavMs;
            const dns = timings.dns != null ? timings.dns.toFixed(1) : "0.0";
            const tcp = timings.tcp != null ? timings.tcp.toFixed(1) : "0.0";
            const tls = timings.tls != null ? timings.tls.toFixed(1) : "0.0";
            const ttfb = timings.ttfb != null ? timings.ttfb.toFixed(1) : "0.0";
            const dl = timings.download != null ? timings.download.toFixed(1) : "0.0";
            const fcp = timings.fcp != null ? timings.fcp.toFixed(1) : "0.0";
            const domInt = timings.domInteractive != null ? timings.domInteractive.toFixed(1) : "0.0";
            const domComp = timings.domComplete != null ? timings.domComplete.toFixed(1) : "0.0";

            const totalTransBytes = Math.max(transferBytes, timings.clientBytes || 0);
            const totalRequests = Math.max(requestCount, timings.clientCount || 1);
            const transferMB = Number((totalTransBytes / (1024 * 1024)).toFixed(2));
            const transferRateKBs = Number(((totalTransBytes / 1024) / (effectiveLoad / 1000 || 1)).toFixed(1));

            await sleep(POST_LOAD_STABILIZE_MS);

            const tele = monitor.stop();
            iterCpus.push(tele.peakCpu);
            iterMems.push(tele.peakMemoryMB);

            rawCsv.rows.push(
              `${browserInfo.name},${category},"${site.name}","${site.url}",${iter},${startupMs.toFixed(
                1
              )},${effectiveLoad.toFixed(1)},${dns},${tcp},${tls},${ttfb},${dl},${fcp},${domInt},${domComp},${tele.peakCpu.toFixed(
                2
              )},${tele.avgCpu.toFixed(2)},${tele.peakMemoryMB.toFixed(1)},${tele.finalMemoryMB.toFixed(1)},${totalRequests},${transferMB},${transferRateKBs}`
            );

            pageloadCsv.rows.push(
              `${browserInfo.name},${iter},${site.url},${effectiveLoad.toFixed(2)}`
            );

            networkCsv.rows.push(
              `${browserInfo.name},${iter},${category},"${site.name}","${site.url}",${totalRequests},${totalTransBytes},${transferMB},${transferRateKBs},${dns},${tcp},${tls},${ttfb},${dl},${fcp}`
            );

            console.log(
              `      • ${site.name.padEnd(22)} | Load: ${effectiveLoad
                .toFixed(0)
                .padStart(5)}ms (TTFB: ${ttfb}ms, FCP: ${fcp}ms) | RAM: ${tele.peakMemoryMB
                .toFixed(0)
                .padStart(5)}MB | CPU: ${tele.peakCpu.toFixed(1).padStart(4)}% | Net: ${transferMB.toFixed(1)}MB (${transferRateKBs} KB/s)`
            );
          } catch (err) {
            console.log(`      • ${site.name.padEnd(22)} | Timeout/Skipped (${err.message.slice(0, 30)})`);
          } finally {
            if (monitor.running) monitor.stop();
            await page.close().catch(() => {});
            await sleep(INTER_SITE_DELAY_MS);
          }
        }

        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        await sleep(INTER_ITERATION_DELAY_MS);
      }

      const meanIterCpu = iterCpus.length ? iterCpus.reduce((a, b) => a + b, 0) / iterCpus.length : 0;
      const meanIterMem = iterMems.length ? iterMems.reduce((a, b) => a + b, 0) / iterMems.length : 0;
      metricsCsv.rows.push(`${browserInfo.name},${iter},${iterStartupMs.toFixed(2)},${meanIterCpu.toFixed(2)},${meanIterMem.toFixed(1)}`);
    }

    // Save incremental files
    fs.writeFileSync(rawPath, rawCsv.rows.join("\n") + "\n", "utf8");
    fs.writeFileSync(metricsPath, metricsCsv.rows.join("\n") + "\n", "utf8");
    fs.writeFileSync(pageloadPath, pageloadCsv.rows.join("\n") + "\n", "utf8");
    fs.writeFileSync(speedometerPath, speedometerCsv.rows.join("\n") + "\n", "utf8");
    fs.writeFileSync(networkPath, networkCsv.rows.join("\n") + "\n", "utf8");
  }

  // Check if all 3 browsers are complete in workloads/; if so, archive folder!
  checkAndArchiveWorkloadsDir(workloadsDir);
}

module.exports = {
  runWorkloadForBrowsers,
  WORKLOADS,
};
