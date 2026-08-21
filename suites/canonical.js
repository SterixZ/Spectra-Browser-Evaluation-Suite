const { performance } = require("perf_hooks");
const { CANONICAL_URLS, INTER_SITE_DELAY_MS, NAVIGATION_TIMEOUT_MS } = require("../core/config");
const { attachCdpSession } = require("../core/browsers");
const { sleep, getCpuTime, getMemoryMB, extractCDPMetrics, extractW3CTimings, NavigationTelemetryMonitor } = require("../core/telemetry");

/**
 * Runs a single iteration of the 10-Site Canonical Lifecycle Benchmark
 */
async function runCanonicalIteration(browserInfo, runNumber, options = {}) {
  const urls = options.urls || CANONICAL_URLS;
  const startupStart = performance.now();
  const browser = await browserInfo.launch();
  const startupMs = performance.now() - startupStart;

  const startCpuTime = getCpuTime(browserInfo.process);
  const startWallTime = performance.now();
  let peakRunMemoryMB = getMemoryMB(browserInfo.process);
  let peakRunCpuPercent = 0;
  let siteCpuAverages = [];

  const siteResults = [];
  const context = await browser.newContext();

  for (const url of urls) {
    let transferBytes = 0;
    let requestCount = 0;
    const page = await context.newPage();

    // Attach Chrome DevTools Protocol session if supported
    const cdpClient = browserInfo.isChromium ? await attachCdpSession(context, page) : null;

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
        .goto(url, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS })
        .catch(async () => {
          await page.goto(url, { waitUntil: "commit", timeout: NAVIGATION_TIMEOUT_MS });
        });
      await page.waitForLoadState("load", { timeout: 8000 }).catch(() => {});
      const navElapsedSec = Math.max(0.1, (performance.now() - navStart) / 1000);

      // Extract W3C Timing and CDP Engine Diagnostics in parallel
      const [w3cTiming, cdpMetrics] = await Promise.all([
        extractW3CTimings(page),
        extractCDPMetrics(cdpClient),
      ]);

      const stats = monitor.stop();
      if (stats.peakMemoryMB > peakRunMemoryMB) peakRunMemoryMB = stats.peakMemoryMB;
      if (stats.peakCpu > peakRunCpuPercent) peakRunCpuPercent = stats.peakCpu;
      siteCpuAverages.push(stats.avgCpu);

      const rawLoadMs = w3cTiming?.loadMs ?? (navElapsedSec * 1000);
      const finalLoadMs = rawLoadMs > 0 && rawLoadMs < 45000 ? rawLoadMs : navElapsedSec * 1000;

      const totalBytes = Math.max(transferBytes, w3cTiming?.clientBytes || 0);
      const finalReqCount = Math.max(requestCount, w3cTiming?.clientCount || 1);
      const transferMB = Number((totalBytes / (1024 * 1024)).toFixed(2));
      const transferRateKBs = Number(((totalBytes / 1024) / (finalLoadMs / 1000 || 1)).toFixed(1));

      const entry = {
        browser: browserInfo.name,
        run: runNumber,
        url,
        loadTimeMs: Number(finalLoadMs.toFixed(2)),
        dnsMs: Number((w3cTiming?.dns || 0).toFixed(1)),
        tcpMs: Number((w3cTiming?.tcp || 0).toFixed(1)),
        tlsMs: Number((w3cTiming?.tls || 0).toFixed(1)),
        ttfbMs: Number((w3cTiming?.ttfb || 0).toFixed(1)),
        downloadMs: Number((w3cTiming?.download || 0).toFixed(1)),
        fcpMs: Number((w3cTiming?.fcp || 0).toFixed(1)),
        domInteractiveMs: Number((w3cTiming?.domInteractive || 0).toFixed(1)),
        domCompleteMs: Number((w3cTiming?.domComplete || 0).toFixed(1)),
        requests: finalReqCount,
        transferBytes: totalBytes,
        transferMB,
        transferRateKBs,
        peakCpuPercent: stats.peakCpu,
        avgCpuPercent: stats.avgCpu,
        peakMemoryMB: stats.peakMemoryMB,
        finalMemoryMB: stats.finalMemoryMB,
        cdp: cdpMetrics,
      };

      siteResults.push(entry);

      const cdpSnippet = cdpMetrics?.jsHeapUsedMB ? ` | JSHeap: ${cdpMetrics.jsHeapUsedMB}MB` : "";
      console.log(
        `  ${url}: ${finalLoadMs.toFixed(0)}ms (TTFB: ${entry.ttfbMs}ms, FCP: ${entry.fcpMs}ms) | CPU: ${stats.peakCpu}% | RAM: ${stats.peakMemoryMB}MB${cdpSnippet} | ${transferMB}MB (${finalReqCount} reqs @ ${transferRateKBs} KB/s)`
      );
    } catch (err) {
      console.log(`  ${url}: failed (${err.message.slice(0, 30)}), skipping`);
    } finally {
      await page.close().catch(() => {});
      await sleep(INTER_SITE_DELAY_MS);
    }
  }

  // Calculate cumulative active session CPU
  const endCpuTime = getCpuTime(browserInfo.process);
  const endWallTime = performance.now();
  const totalElapsedSec = Math.max(0.1, (endWallTime - startWallTime) / 1000);
  const totalCpuDeltaSec = Math.max(0, endCpuTime - startCpuTime);
  const cumulativeCpuPercent = Number(((totalCpuDeltaSec * 100) / ((require("os").cpus().length || 1) * totalElapsedSec)).toFixed(2));

  const avgSiteCpu = siteCpuAverages.length > 0
    ? Number((siteCpuAverages.reduce((a, b) => a + b, 0) / siteCpuAverages.length).toFixed(2))
    : cumulativeCpuPercent;

  const finalActiveCpu = Math.max(cumulativeCpuPercent, avgSiteCpu);
  const memoryMB = Number(Math.max(peakRunMemoryMB, getMemoryMB(browserInfo.process)).toFixed(2));

  await browser.close().catch(() => {});

  const runSummary = {
    browser: browserInfo.name,
    run: runNumber,
    startupMs: Number(startupMs.toFixed(2)),
    activeCpuPercent: Number(finalActiveCpu.toFixed(2)),
    peakCpuPercent: Number(peakRunCpuPercent.toFixed(2)),
    memoryMB,
    sites: siteResults,
  };

  console.log(
    `  ▶ Run ${runNumber} Summary: startup=${startupMs.toFixed(0)}ms active_cpu=${finalActiveCpu.toFixed(1)}% (peak_burst=${peakRunCpuPercent.toFixed(1)}%) peak_mem=${memoryMB.toFixed(1)}MB`
  );

  return runSummary;
}

module.exports = { runCanonicalIteration };
