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

async function sampleAverageCpuPercent(processName, samples, intervalMs) {
  let total = 0;
  for (let i = 0; i < samples; i++) {
    const start = getCpuTime(processName);
    await sleep(intervalMs);
    const end = getCpuTime(processName);
    const cpuSeconds = end - start;
    total += (cpuSeconds * 100) / (os.cpus().length * (intervalMs / 1000));
  }
  return total / samples;
}

async function runCoreMetrics(browserInfo, run, metricsCsv, pageloadCsv) {
  const startupStart = performance.now();
  const browser = await browserInfo.launch();
  const startupMs = performance.now() - startupStart;

  const context = await browser.newContext();

  for (const url of URLS) {
    const page = await context.newPage();
    try {
      await page.goto(url, { waitUntil: "load", timeout: 30000 });
      const timing = await page.evaluate(() => {
        const nav = performance.getEntriesByType("navigation")[0];
        return nav ? nav.loadEventEnd : null;
      });
      if (timing != null) {
        pageloadCsv.rows.push(`${browserInfo.name},${run},${url},${timing.toFixed(2)}`);
        console.log(`  ${url}: ${timing.toFixed(0)}ms load`);
      }
    } catch {
      console.log(`  ${url}: failed to load, skipping`);
    }
  }

  console.log(`  Stabilizing ${STABILIZE_MS}ms before CPU/memory sampling...`);
  await sleep(STABILIZE_MS);

  const cpuPercent = await sampleAverageCpuPercent(
    browserInfo.process,
    CPU_SAMPLE_COUNT,
    CPU_SAMPLE_INTERVAL_MS
  );
  const memoryMB = getMemoryMB(browserInfo.process);

  console.log(
    `  Run ${run}: startup=${startupMs.toFixed(0)}ms cpu=${cpuPercent.toFixed(1)}% mem=${memoryMB.toFixed(1)}MB`
  );

  metricsCsv.rows.push(
    `${browserInfo.name},${run},${startupMs.toFixed(2)},${cpuPercent.toFixed(2)},${memoryMB.toFixed(2)}`
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

  for (const browserInfo of getLaunchers()) {
    console.log(`\n========== ${browserInfo.name} ==========`);

    for (let run = 1; run <= RUNS; run++) {
      console.log(`\nRun ${run}/${RUNS}`);
      await runCoreMetrics(browserInfo, run, metricsCsv, pageloadCsv);
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

  console.log("\n=============================================");
  console.log("✅ Full benchmark complete!");
  console.log(`📁 metrics.csv, pageload.csv, speedometer.csv in ${RESULTS_DIR}`);
  console.log("=============================================");
})();
