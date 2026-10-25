const fs = require("node:fs");
const path = require("node:path");
const { getBenchmarkData, listRunFolders } = require("./results");

const root = path.resolve(__dirname, "..");
const requested = process.argv[2];
const directory = requested ? path.resolve(root, requested) : path.join(root, listRunFolders()[0] || "results");

if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory()) {
  console.error(`No benchmark results found: ${directory}`);
  console.error("Run a benchmark first, or use npm run analyze -- <results-folder>.");
  process.exitCode = 1;
} else {
  try {
    const data = getBenchmarkData(directory);
    if (!Object.keys(data.summary).length) throw new Error("The folder contains no valid browser observations.");
    console.log(`\nSPECTRA: ${path.basename(directory)}`);
    const metrics = [
      ["startup", "Startup", "ms"], ["cpu", "CPU", "%"], ["memory", "Memory", "MB"],
      ["pageload", "Page load", "ms"], ["speedometer", "Speedometer", "pts"],
      ["ttfb", "Time to first byte", "ms"], ["fcp", "First contentful paint", "ms"],
    ];
    for (const [key, label, unit] of metrics) {
      const browsers = Object.entries(data.summary).filter(([, stats]) => stats[key].n > 0);
      if (!browsers.length) continue;
      console.log(`\n${label} (${unit})`);
      console.table(Object.fromEntries(browsers.map(([browser, stats]) => {
        const s = stats[key];
        return [browser, { samples: s.n, mean: s.mean.toFixed(2), "95% CI ±": s.n > 1 ? s.ci95.toFixed(2) : "N/A", median: s.median.toFixed(2), p95: s.p95.toFixed(2) }];
      })));
      if (data.anova[key]) console.log(`ANOVA: ${data.anova[key].summary}`);
      for (const pair of data.pairwise[key] || []) console.log(`${pair.labelA} vs ${pair.labelB}: ${pair.summary}`);
    }
  } catch (error) {
    console.error(`Analysis failed: ${error.message}`);
    process.exitCode = 1;
  }
}
