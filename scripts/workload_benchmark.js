// Lightweight vs. Heavyweight Browser Workload Benchmark
// Measures and compares performance across 5 Lightweight and 5 Heavyweight websites
// with 5 iterations per browser, outputting structured comparative CSVs and analysis.

const os = require("os");
const fs = require("fs");
const path = require("path");
const { performance } = require("perf_hooks");
const { execSync } = require("child_process");
const { BROWSERS } = require("./config");
const { getLaunchers } = require("./browsers");
const { computeStats } = require("./stats");

const ITERATIONS = Number(process.env.ITERATIONS) || 5;
const STABILIZE_MS = Number(process.env.STABILIZE_MS) || 3000;
const CPU_SAMPLE_COUNT = 3;
const CPU_SAMPLE_INTERVAL_MS = 1000;

// Categorized Website Workloads
const WORKLOADS = {
  Lightweight: [
    { name: "Example Domain", url: "https://example.com" },
    { name: "Hacker News", url: "https://news.ycombinator.com" },
    { name: "Wikipedia Main", url: "https://en.wikipedia.org/wiki/Main_Page" },
    { name: "HTTPBin HTML", url: "https://httpbin.org/html" },
    { name: "Dan Luu Blog", url: "https://danluu.com" },
  ],
  Heavyweight: [
    { name: "Reddit Feed", url: "https://www.reddit.com" },
    { name: "YouTube Home", url: "https://www.youtube.com" },
    { name: "GitHub VSCode Repo", url: "https://github.com/microsoft/vscode" },
    { name: "The Verge Tech", url: "https://www.theverge.com" },
    { name: "CNN Multimedia", url: "https://www.cnn.com" },
  ],
};

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getCpuTime(processName) {
  try {
    const cmd = `powershell -Command "(Get-Process ${processName} -ErrorAction SilentlyContinue | Measure-Object CPU -Sum).Sum"`;
    const output = execSync(cmd, { encoding: "utf8" }).trim();
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

async function runWorkloadBenchmark() {
  const date = new Date();
  const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
    date.getDate()
  ).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(2, "0")}`;

  const outputDir = path.join(__dirname, "..", `workloads_${timestamp}`);
  fs.mkdirSync(outputDir, { recursive: true });

  console.log(`\n========================================================================`);
  console.log(`🧪 LIGHTWEIGHT VS. HEAVYWEIGHT WORKLOAD BENCHMARK`);
  console.log(`   5 Light Sites vs. 5 Heavy Sites (${ITERATIONS} iterations each)`);
  console.log(`   Output Directory: ${outputDir}`);
  console.log(`========================================================================\n`);

  const rawRows = [
    "Browser,Category,SiteName,Url,Iteration,LoadTimeMs,TTFB_Ms,DomCompleteMs,CpuPercent,MemoryMB",
  ];

  const launchers = getLaunchers();
  const aggregated = {};

  for (const browserInfo of launchers) {
    aggregated[browserInfo.name] = {
      Lightweight: { loadTimes: [], cpus: [], mems: [] },
      Heavyweight: { loadTimes: [], cpus: [], mems: [] },
    };

    console.log(`\n▶ Starting Evaluation: ${browserInfo.name.toUpperCase()}`);
    console.log(`------------------------------------------------------------------------`);

    for (let iter = 1; iter <= ITERATIONS; iter++) {
      console.log(`\n  [${browserInfo.name}] Iteration ${iter}/${ITERATIONS}`);

      // Evaluate both categories
      for (const [category, siteList] of Object.entries(WORKLOADS)) {
        console.log(`    📁 Category: ${category}`);

        const browser = await browserInfo.launch();
        const context = await browser.newContext();

        for (const site of siteList) {
          const page = await context.newPage();
          try {
            const startNav = performance.now();
            await page.goto(site.url, { waitUntil: "load", timeout: 35000 });
            const totalNavMs = performance.now() - startNav;

            const timings = await page.evaluate(() => {
              const nav = performance.getEntriesByType("navigation")[0];
              if (!nav) return { loadTime: null, ttfb: null, domComplete: null };
              return {
                loadTime: nav.loadEventEnd > 0 ? nav.loadEventEnd : nav.responseEnd,
                ttfb: nav.responseStart,
                domComplete: nav.domComplete,
              };
            });

            const effectiveLoad = timings.loadTime != null && timings.loadTime > 0 ? timings.loadTime : totalNavMs;
            const ttfb = timings.ttfb != null ? timings.ttfb.toFixed(1) : "0.0";
            const domComplete = timings.domComplete != null ? timings.domComplete.toFixed(1) : "0.0";

            await sleep(500);

            const cpu = await sampleAverageCpuPercent(browserInfo.process, 1, 500);
            const mem = getMemoryMB(browserInfo.process);

            aggregated[browserInfo.name][category].loadTimes.push(effectiveLoad);
            aggregated[browserInfo.name][category].cpus.push(cpu);
            aggregated[browserInfo.name][category].mems.push(mem);

            rawRows.push(
              `${browserInfo.name},${category},"${site.name}","${site.url}",${iter},${effectiveLoad.toFixed(
                1
              )},${ttfb},${domComplete},${cpu.toFixed(2)},${mem.toFixed(1)}`
            );

            console.log(
              `      • ${site.name.padEnd(20)} | Load: ${effectiveLoad.toFixed(0).padStart(5)}ms | RAM: ${mem
                .toFixed(0)
                .padStart(5)}MB | CPU: ${cpu.toFixed(1)}%`
            );
          } catch (err) {
            console.log(`      • ${site.name.padEnd(20)} | ⚠️ Timeout/Skipped (${err.message.slice(0, 30)})`);
          } finally {
            await page.close().catch(() => {});
          }
        }

        await context.close().catch(() => {});
        await browser.close().catch(() => {});
        await sleep(1500);
      }
    }
  }

  // 1. Write Raw CSV
  const rawCsvPath = path.join(outputDir, "workload_raw.csv");
  fs.writeFileSync(rawCsvPath, rawRows.join("\n"), "utf8");

  // 2. Generate and Write Comparative Summary CSV
  const summaryRows = [
    "Browser,Category,SampleCount,MeanLoadMs,MedianLoadMs,P90LoadMs,MeanCpuPercent,MeanMemoryMB,CoV_LoadTime",
  ];

  const comparisonRows = [
    "Browser,Light_MeanLoadMs,Heavy_MeanLoadMs,LoadInflationRatio,Light_MeanRAM_MB,Heavy_MeanRAM_MB,RAM_InflationRatio,Light_MeanCPU,Heavy_MeanCPU",
  ];

  console.log(`\n========================================================================`);
  console.log(`📊 COMPARATIVE WORKLOAD SUMMARY: LIGHTWEIGHT VS. HEAVYWEIGHT`);
  console.log(`========================================================================`);
  console.log(
    `Browser     Category      Mean Load     Median     P90 Load     Mean RAM     Mean CPU`
  );
  console.log(`------------------------------------------------------------------------`);

  for (const [browser, catData] of Object.entries(aggregated)) {
    const lightStats = computeStats(catData.Lightweight.loadTimes);
    const heavyStats = computeStats(catData.Heavyweight.loadTimes);

    const lightCpuStats = computeStats(catData.Lightweight.cpus);
    const heavyCpuStats = computeStats(catData.Heavyweight.cpus);

    const lightMemStats = computeStats(catData.Lightweight.mems);
    const heavyMemStats = computeStats(catData.Heavyweight.mems);

    summaryRows.push(
      `${browser},Lightweight,${lightStats.n},${lightStats.mean.toFixed(1)},${lightStats.median.toFixed(
        1
      )},${lightStats.p90.toFixed(1)},${lightCpuStats.mean.toFixed(2)},${lightMemStats.mean.toFixed(
        1
      )},${lightStats.cov.toFixed(3)}`
    );

    summaryRows.push(
      `${browser},Heavyweight,${heavyStats.n},${heavyStats.mean.toFixed(1)},${heavyStats.median.toFixed(
        1
      )},${heavyStats.p90.toFixed(1)},${heavyCpuStats.mean.toFixed(2)},${heavyMemStats.mean.toFixed(
        1
      )},${heavyStats.cov.toFixed(3)}`
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
      `            ↳ Workload Overhead: Heavy sites take ${loadRatio}x longer & use ${memRatio}x more RAM\n`
    );
  }

  const summaryCsvPath = path.join(outputDir, "workload_summary.csv");
  fs.writeFileSync(summaryCsvPath, summaryRows.join("\n"), "utf8");

  const compCsvPath = path.join(outputDir, "workload_comparison.csv");
  fs.writeFileSync(compCsvPath, comparisonRows.join("\n"), "utf8");

  console.log(`========================================================================`);
  console.log(`✅ BENCHMARK COMPLETE!`);
  console.log(`📁 Files generated in: ${outputDir}`);
  console.log(`   1. workload_raw.csv        (Detailed observation rows)`);
  console.log(`   2. workload_summary.csv    (Category aggregate statistics)`);
  console.log(`   3. workload_comparison.csv (Direct Light vs Heavy inflation ratios)`);
  console.log(`========================================================================\n`);
}

if (require.main === module) {
  runWorkloadBenchmark().catch((err) => {
    console.error("Benchmark failed:", err);
    process.exit(1);
  });
}

module.exports = { runWorkloadBenchmark };
