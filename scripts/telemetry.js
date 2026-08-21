const { execSync } = require("child_process");
const os = require("os");

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Returns cumulative CPU core-seconds consumed by all child processes of the given process name.
 * Uses PowerShell Get-Process on Windows.
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
 * Continuous Active-Navigation Telemetry Monitor
 * Samples process CPU delta and Working Set RAM during page navigation and DOM parsing.
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
  NavigationTelemetryMonitor,
};
