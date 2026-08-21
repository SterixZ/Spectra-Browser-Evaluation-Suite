const { execSync } = require("child_process");
const os = require("os");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns cumulative CPU core-seconds consumed by all child processes of the given process name.
 */
function getCpuTime(processName) {
  try {
    const cmd = `powershell -NoProfile -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum"`;
    const output = execSync(cmd, { encoding: "utf8" }).trim();
    return Number(output) || 0;
  } catch {
    return 0;
  }
}

/**
 * Returns total Physical Working Set RAM (in MB) consumed by all child processes of the given process name.
 */
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

/**
 * Extracts Chrome DevTools Protocol (CDP) engine diagnostics (JS Heap, Layouts, DOM Nodes)
 */
async function extractCDPMetrics(cdpClient) {
  if (!cdpClient) return null;
  try {
    const res = await cdpClient.send("Performance.getMetrics");
    const metricsMap = {};
    if (res && res.metrics) {
      for (const m of res.metrics) {
        metricsMap[m.name] = m.value;
      }
    }
    const jsHeapUsedMB = metricsMap.JSHeapUsedSize ? Number((metricsMap.JSHeapUsedSize / (1024 * 1024)).toFixed(2)) : null;
    const jsHeapTotalMB = metricsMap.JSHeapTotalSize ? Number((metricsMap.JSHeapTotalSize / (1024 * 1024)).toFixed(2)) : null;
    const domNodes = metricsMap.Nodes || null;
    const layoutDurationSec = metricsMap.LayoutDuration || null;

    return {
      jsHeapUsedMB,
      jsHeapTotalMB,
      domNodes,
      layoutDurationSec,
    };
  } catch {
    return null;
  }
}

/**
 * Extracts native W3C Navigation Timing Level 2 and Paint Timing metrics
 */
async function extractW3CTimings(page) {
  try {
    return await page.evaluate(() => {
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
      const fcpEntry = paintList.find((p) => p.name === "first-contentful-paint");
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
  } catch {
    return null;
  }
}

/**
 * Continuous Active-Navigation Telemetry Monitor
 */
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

module.exports = {
  sleep,
  getCpuTime,
  getMemoryMB,
  extractCDPMetrics,
  extractW3CTimings,
  NavigationTelemetryMonitor,
};
