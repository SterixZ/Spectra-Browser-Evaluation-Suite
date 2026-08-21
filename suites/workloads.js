const { performance } = require("perf_hooks");
const { WORKLOAD_SUITES, INTER_SITE_DELAY_MS, THERMAL_COOLDOWN_MS, POST_LOAD_STABILIZE_MS, WARMUP_URL } = require("../core/config");
const { sleep, extractW3CTimings, NavigationTelemetryMonitor } = require("../core/telemetry");

/**
 * Runs the 2-Tier Workload Benchmark (5 Light vs 5 Heavy SPAs)
 */
async function runWorkloadSuite(launchers, iterations = 5) {
  const aggregated = {};
  const rawRows = [];
  const compRows = [];

  for (const browserInfo of launchers) {
    aggregated[browserInfo.name] = {
      Lightweight: { loadTimes: [], peakCpus: [], peakMems: [] },
      Heavyweight: { loadTimes: [], peakCpus: [], peakMems: [] },
      startupTimes: [],
    };

    console.log(`\n▶ Starting Workload Evaluation: ${browserInfo.name.toUpperCase()}`);
    console.log(`------------------------------------------------------------------------`);

    for (let iter = 1; iter <= iterations; iter++) {
      console.log(`\n  [${browserInfo.name}] Iteration ${iter}/${iterations}`);

      for (const [category, siteList] of Object.entries(WORKLOAD_SUITES)) {
        console.log(`    📁 Category: ${category}`);

        const startStartup = performance.now();
        const browser = await browserInfo.launch();
        const startupMs = performance.now() - startStartup;
        aggregated[browserInfo.name].startupTimes.push(startupMs);

        const context = await browser.newContext();

        // Unmetered warmup pass
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
            const w3c = await extractW3CTimings(page);

            const effectiveLoad = w3c?.loadMs && w3c.loadMs > 0 && w3c.loadMs < 45000 ? w3c.loadMs : totalNavMs;
            const dns = w3c?.dns != null ? w3c.dns.toFixed(1) : "0.0";
            const tcp = w3c?.tcp != null ? w3c.tcp.toFixed(1) : "0.0";
            const tls = w3c?.tls != null ? w3c.tls.toFixed(1) : "0.0";
            const ttfb = w3c?.ttfb != null ? w3c.ttfb.toFixed(1) : "0.0";
            const dl = w3c?.download != null ? w3c.download.toFixed(1) : "0.0";
            const fcp = w3c?.fcp != null ? w3c.fcp.toFixed(1) : "0.0";
            const domInt = w3c?.domInteractive != null ? w3c.domInteractive.toFixed(1) : "0.0";
            const domComp = w3c?.domComplete != null ? w3c.domComplete.toFixed(1) : "0.0";

            const totalTransBytes = Math.max(transferBytes, w3c?.clientBytes || 0);
            const totalRequests = Math.max(requestCount, w3c?.clientCount || 1);
            const transferMB = Number((totalTransBytes / (1024 * 1024)).toFixed(2));
            const transferRateKBs = Number(((totalTransBytes / 1024) / (effectiveLoad / 1000 || 1)).toFixed(1));

            await sleep(POST_LOAD_STABILIZE_MS);
            const tele = monitor.stop();

            aggregated[browserInfo.name][category].loadTimes.push(effectiveLoad);
            aggregated[browserInfo.name][category].peakCpus.push(tele.peakCpu);
            aggregated[browserInfo.name][category].peakMems.push(tele.peakMemoryMB);

            rawRows.push({
              browser: browserInfo.name,
              category,
              siteName: site.name,
              url: site.url,
              iteration: iter,
              startupMs: Number(startupMs.toFixed(1)),
              loadTimeMs: Number(effectiveLoad.toFixed(1)),
              dnsMs: Number(dns),
              tcpMs: Number(tcp),
              tlsMs: Number(tls),
              ttfbMs: Number(ttfb),
              downloadMs: Number(dl),
              fcpMs: Number(fcp),
              domInteractiveMs: Number(domInt),
              domCompleteMs: Number(domComp),
              peakCpuPercent: tele.peakCpu,
              avgCpuPercent: tele.avgCpu,
              peakMemoryMB: tele.peakMemoryMB,
              finalMemoryMB: tele.finalMemoryMB,
              requests: totalRequests,
              transferMB,
              transferRateKBs,
            });

            console.log(
              `      • ${site.name.padEnd(20)} | Load: ${effectiveLoad.toFixed(0).padStart(5)}ms (TTFB: ${ttfb}ms, FCP: ${fcp}ms) | RAM: ${tele.peakMemoryMB.toFixed(0).padStart(5)}MB | CPU: ${tele.peakCpu.toFixed(1).padStart(4)}% | Net: ${transferMB.toFixed(1)}MB (${transferRateKBs} KB/s)`
            );
          } catch (err) {
            console.log(`      • ${site.name.padEnd(20)} | Skipped (${err.message.slice(0, 30)})`);
          } finally {
            await page.close().catch(() => {});
            await sleep(INTER_SITE_DELAY_MS);
          }
        }

        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        await sleep(INTER_SITE_DELAY_MS);
      }

      console.log(`  [Cooldown] Pausing ${THERMAL_COOLDOWN_MS / 1000}s for thermal stabilization...`);
      await sleep(THERMAL_COOLDOWN_MS);
    }
  }

  // Calculate Raj Jain Inflation Ratios
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

    compRows.push({
      browser: b.name,
      lightMeanLoadMs: Number(lightMeanLoad.toFixed(1)),
      heavyMeanLoadMs: Number(heavyMeanLoad.toFixed(1)),
      loadInflationRatio: `${loadInflation}x`,
      lightPeakRamMB: Number(lightPeakRam.toFixed(1)),
      heavyPeakRamMB: Number(heavyPeakRam.toFixed(1)),
      ramInflationRatio: `${ramInflation}x`,
      lightMeanCpu: `${lightMeanCpu}%`,
      heavyMeanCpu: `${heavyMeanCpu}%`,
    });
  }

  return {
    raw: rawRows,
    comparison: compRows,
    aggregated,
  };
}

module.exports = { runWorkloadSuite };
