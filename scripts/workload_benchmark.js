const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const {
  WORKLOADS,
  INTER_SITE_DELAY_MS,
} = require("./config");
const { getLaunchers, ensureDir } = require("./browsers");
const { sleep, NavigationTelemetryMonitor } = require("./telemetry");

const ITERATIONS = Number(process.env.ITERATIONS) || 5;
const POST_LOAD_STABILIZE_MS = 1500;
const INTER_ITERATION_DELAY_MS = 5000;
const WARMUP_URL = "https://example.com";

async function runWorkloadBenchmark() {
  const date = new Date();
  const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;

  const outputDir = path.join(__dirname, "..", `workloads_${timestamp}`);
  ensureDir(outputDir);

  console.log(`\n========================================================================`);
  console.log(`🧪 LIGHTWEIGHT VS. HEAVYWEIGHT BROWSER WORKLOAD BENCHMARK`);
  console.log(`   Methodology: Raj Jain Ch. 3, 11 (5 Light vs. 5 Heavy × ${ITERATIONS} Iterations)`);
  console.log(`   Telemetry Mode: Continuous Active-Navigation Peak Load Tracking`);
  console.log(`   Output Directory: ${outputDir}`);
  console.log(`========================================================================\n`);

  const rawRows = [
    "Browser,Category,SiteName,Url,Iteration,StartupMs,LoadTimeMs,DNS_Ms,TCP_Ms,TLS_Ms,TTFB_Ms,Download_Ms,FCP_Ms,DomInteractiveMs,DomCompleteMs,PeakCpuPercent,AvgCpuPercent,PeakMemoryMB,FinalMemoryMB,Requests,TransferMB,TransferRateKBs",
  ];

  const metricsRows = ["browser,run,startup_time_ms,cpu_percent,memory_mb"];
  const pageloadRows = ["browser,run,url,load_time_ms"];
  const speedometerRows = ["browser,run,score"];
  const networkRows = ["Browser,Run,Category,SiteName,Url,Requests,TransferBytes,Transfer(MB),TransferRate(KB/s),DNS(ms),TCP(ms),TLS(ms),TTFB(ms),Download(ms),FCP(ms)"];

  const launchers = getLaunchers();
  const aggregated = {};

  for (const browserInfo of launchers) {
    aggregated[browserInfo.name] = {
      Lightweight: { loadTimes: [], peakCpus: [], peakMems: [] },
      Heavyweight: { loadTimes: [], peakCpus: [], peakMems: [] },
      startupTimes: [],
    };

    console.log(`\n▶ Starting Evaluation: ${browserInfo.name.toUpperCase()}`);
    console.log(`------------------------------------------------------------------------`);

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
        aggregated[browserInfo.name].startupTimes.push(startupMs);

        const context = await browser.newContext();

        // Unmetered warmup pass to eliminate cold JIT bias
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
            const monitor = new NavigationTelemetryMonitor(browserInfo.process, 300);
            monitor.start();

            const startNav = performance.now();

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

                if (!nav) return { loadTime: null, dns: 0, tcp: 0, tls: 0, ttfb: 0, download: 0, fcp: 0, domInteractive: 0, domComplete: 0, clientBytes, clientCount };
                return {
                  loadTime:
                    nav.loadEventEnd > 0
                      ? nav.loadEventEnd
                      : nav.domContentLoadedEventEnd > 0
                      ? nav.domContentLoadedEventEnd
                      : nav.responseEnd,
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

            aggregated[browserInfo.name][category].loadTimes.push(effectiveLoad);
            aggregated[browserInfo.name][category].peakCpus.push(tele.peakCpu);
            aggregated[browserInfo.name][category].peakMems.push(tele.peakMemoryMB);

            iterCpus.push(tele.peakCpu);
            iterMems.push(tele.peakMemoryMB);

            rawRows.push(
              `${browserInfo.name},${category},"${site.name}","${site.url}",${iter},${startupMs.toFixed(
                1
              )},${effectiveLoad.toFixed(1)},${dns},${tcp},${tls},${ttfb},${dl},${fcp},${domInt},${domComp},${tele.peakCpu.toFixed(
                2
              )},${tele.avgCpu.toFixed(2)},${tele.peakMemoryMB.toFixed(1)},${tele.finalMemoryMB.toFixed(1)},${totalRequests},${transferMB},${transferRateKBs}`
            );

            pageloadRows.push(
              `${browserInfo.name},${iter},${site.url},${effectiveLoad.toFixed(2)}`
            );

            networkRows.push(
              `${browserInfo.name},${iter},${category},"${site.name}","${site.url}",${totalRequests},${totalTransBytes},${transferMB},${transferRateKBs},${dns},${tcp},${tls},${ttfb},${dl},${fcp}`
            );

            console.log(
              `      • ${site.name.padEnd(20)} | Load: ${effectiveLoad
                .toFixed(0)
                .padStart(5)}ms (TTFB: ${ttfb}ms, FCP: ${fcp}ms) | RAM: ${tele.peakMemoryMB
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
        await sleep(INTER_SITE_DELAY_MS);
      }

      const meanIterCpu = iterCpus.length > 0 ? (iterCpus.reduce((a, b) => a + b, 0) / iterCpus.length).toFixed(2) : "0.00";
      const peakIterMem = iterMems.length > 0 ? Math.max(...iterMems).toFixed(1) : "0.0";

      metricsRows.push(`${browserInfo.name},${iter},${iterStartupMs.toFixed(1)},${meanIterCpu},${peakIterMem}`);

      console.log(`  [Cooldown] Pausing ${INTER_ITERATION_DELAY_MS / 1000}s for thermal stabilization...`);
      await sleep(INTER_ITERATION_DELAY_MS);
    }
  }

  // Calculate Raj Jain Workload Comparison Metrics
  const compRows = [
    "Browser,Light_MeanLoadMs,Heavy_MeanLoadMs,LoadInflationRatio,Light_PeakRAM_MB,Heavy_PeakRAM_MB,RAM_InflationRatio,Light_MeanCPU,Heavy_MeanCPU",
  ];

  for (const b of launchers) {
    const data = aggregated[b.name];
    const lightMeanLoad = data.Lightweight.loadTimes.length
      ? data.Lightweight.loadTimes.reduce((a, b) => a + b, 0) / data.Lightweight.loadTimes.length
      : 1;
    const heavyMeanLoad = data.Heavyweight.loadTimes.length
      ? data.Heavyweight.loadTimes.reduce((a, b) => a + b, 0) / data.Heavyweight.loadTimes.length
      : 1;
    const loadInflation = (heavyMeanLoad / (lightMeanLoad || 1)).toFixed(2);

    const lightPeakRam = data.Lightweight.peakMems.length ? Math.max(...data.Lightweight.peakMems) : 0;
    const heavyPeakRam = data.Heavyweight.peakMems.length ? Math.max(...data.Heavyweight.peakMems) : 0;
    const ramInflation = (heavyPeakRam / (lightPeakRam || 1)).toFixed(2);

    const lightMeanCpu = data.Lightweight.peakCpus.length
      ? (data.Lightweight.peakCpus.reduce((a, b) => a + b, 0) / data.Lightweight.peakCpus.length).toFixed(2)
      : "0.00";
    const heavyMeanCpu = data.Heavyweight.peakCpus.length
      ? (data.Heavyweight.peakCpus.reduce((a, b) => a + b, 0) / data.Heavyweight.peakCpus.length).toFixed(2)
      : "0.00";

    compRows.push(
      `${b.name},${lightMeanLoad.toFixed(1)},${heavyMeanLoad.toFixed(
        1
      )},${loadInflation}x,${lightPeakRam.toFixed(1)},${heavyPeakRam.toFixed(
        1
      )},${ramInflation}x,${lightMeanCpu}%,${heavyMeanCpu}%`
    );
  }

  fs.writeFileSync(path.join(outputDir, "workload_raw.csv"), rawRows.join("\n") + "\n");
  fs.writeFileSync(path.join(outputDir, "workload_comparison.csv"), compRows.join("\n") + "\n");
  fs.writeFileSync(path.join(outputDir, "metrics.csv"), metricsRows.join("\n") + "\n");
  fs.writeFileSync(path.join(outputDir, "pageload.csv"), pageloadRows.join("\n") + "\n");
  fs.writeFileSync(path.join(outputDir, "speedometer.csv"), speedometerRows.join("\n") + "\n");
  fs.writeFileSync(path.join(outputDir, "network.csv"), networkRows.join("\n") + "\n");

  console.log(`\n========================================================================`);
  console.log(`📊 RAJ JAIN WORKLOAD INFLATION SUMMARY`);
  console.log(`========================================================================`);
  console.log(compRows.join("\n"));
  console.log(`\n✅ Results saved to: ${outputDir}`);
  console.log(`========================================================================\n`);
}

if (require.main === module) {
  runWorkloadBenchmark().catch((err) => {
    console.error("Workload benchmark failed:", err);
    process.exit(1);
  });
}

module.exports = { runWorkloadBenchmark };
