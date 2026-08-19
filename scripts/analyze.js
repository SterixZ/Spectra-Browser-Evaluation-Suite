// Rigorous Browser Performance Analysis CLI
// Based on Raj K. Jain, "The Art of Computer Systems Performance Analysis"

const fs = require("fs");
const path = require("path");
const { RESULTS_DIR } = require("./config");
const {
  computeDescriptiveStats,
  compareTwoAlternatives,
  computeOneWayAnova,
} = require("./stats");

const PROJECT_ROOT = path.dirname(RESULTS_DIR);

function parseCsv(filePath) {
  if (!fs.existsSync(filePath)) return [];
  const content = fs.readFileSync(filePath, "utf8").replace(/\r/g, "");
  const lines = content.trim().split("\n");
  if (lines.length < 2) return [];

  const header = lines[0].split(",").map((h) => h.trim());
  return lines.slice(1).map((line) => {
    const values = line.split(",");
    const row = {};
    header.forEach((h, i) => (row[h] = values[i] ? values[i].trim() : ""));
    return row;
  });
}

function printMetricSection(title, metricClass, groups, unit = "") {
  console.log(`\n========================================================================================`);
  console.log(`📊 ${title.toUpperCase()} [Class: ${metricClass}] — Jain Ch. 3, 11, 13, 20`);
  console.log(`========================================================================================`);
  console.log(`Browser     Runs   Mean ± 95% CI          Median     P90        IQR        CoV (Stability)`);
  console.log(`----------------------------------------------------------------------------------------`);

  const browserNames = Object.keys(groups);
  for (const name of browserNames) {
    const s = computeDescriptiveStats(groups[name]);
    const meanStr = `${s.mean.toFixed(1)} ± ${s.ci95.toFixed(1)} ${unit}`.padEnd(22);
    const medStr = `${s.median.toFixed(1)}`.padEnd(10);
    const p90Str = `${s.p90.toFixed(1)}`.padEnd(10);
    const iqrStr = `${s.iqr.toFixed(1)}`.padEnd(10);
    const covStr = `${(s.cov * 100).toFixed(0)}% (${s.cov <= 0.15 ? "Stable" : "Variable"})`;

    console.log(`${name.padEnd(11)} n=${s.n}   ${meanStr} ${medStr} ${p90Str} ${iqrStr} ${covStr}`);
  }

  // 1. One-Way ANOVA (Jain Ch. 20)
  const anova = computeOneWayAnova(groups);
  console.log(`\n  • ANOVA (Ch. 20): ${anova.summary}`);

  // 2. Pairwise Hypothesis Testing (Jain Ch. 13 & 14)
  console.log(`  • Pairwise Hypothesis Tests (95% CI of Difference):`);
  for (let i = 0; i < browserNames.length; i++) {
    for (let j = i + 1; j < browserNames.length; j++) {
      const b1 = browserNames[i];
      const b2 = browserNames[j];
      const comp = compareTwoAlternatives(groups[b1], groups[b2], b1, b2);
      const tag = comp.isSignificant ? "★ SIGNIFICANT" : "— NOISE";
      console.log(
        `    - ${b1} vs ${b2}: Δ = ${comp.diffMean.toFixed(1)}${unit} [95% CI: ${comp.ciLower.toFixed(1)}, ${comp.ciUpper.toFixed(1)}] [${tag}]`
      );
    }
  }
}

function analyzeDirectory(dir) {
  console.log(`\n****************************************************************************************`);
  console.log(`🔬 BROWSER PERFORMANCE EVALUATION: ${path.basename(dir)}`);
  console.log(`   Methodology: Raj K. Jain, "The Art of Computer Systems Performance Analysis"`);
  console.log(`****************************************************************************************`);

  const metricsPath = path.join(dir, "metrics.csv");
  const pageloadPath = path.join(dir, "pageload.csv");
  const speedometerPath = path.join(dir, "speedometer.csv");

  if (fs.existsSync(metricsPath)) {
    const rows = parseCsv(metricsPath);
    const startup = {};
    const cpu = {};
    const memory = {};

    rows.forEach((r) => {
      if (!r.Browser) return;
      if (r["Startup(ms)"]) (startup[r.Browser] ||= []).push(Number(r["Startup(ms)"]));
      if (r["CPU(%)"]) (cpu[r.Browser] ||= []).push(Number(r["CPU(%)"]));
      if (r["Memory(MB)"]) (memory[r.Browser] ||= []).push(Number(r["Memory(MB)"]));
    });

    printMetricSection("1. Startup Initialization Latency", "Lower is Better (LB)", startup, "ms");
    printMetricSection("2. CPU Utilization", "Lower is Better (LB)", cpu, "%");
    printMetricSection("3. Memory Working Set", "Lower is Better (LB)", memory, "MB");
  }

  if (fs.existsSync(pageloadPath)) {
    const rows = parseCsv(pageloadPath);
    const pageload = {};

    rows.forEach((r) => {
      if (!r.Browser || !r["LoadTime(ms)"]) return;
      (pageload[r.Browser] ||= []).push(Number(r["LoadTime(ms)"]));
    });

    printMetricSection("4. Page Load Response Time", "Lower is Better (LB)", pageload, "ms");
  }

  if (fs.existsSync(speedometerPath)) {
    const rows = parseCsv(speedometerPath);
    const speed = {};

    rows.forEach((r) => {
      if (!r.Browser || !r.Score) return;
      (speed[r.Browser] ||= []).push(Number(r.Score));
    });

    if (Object.keys(speed).length > 0) {
      printMetricSection("5. Speedometer 3.0 Responsiveness", "Higher is Better (HB)", speed, "pts");
    }
  }

  console.log(`\n========================================================================================\n`);
}

const dirArg = process.argv[2] ? path.join(PROJECT_ROOT, process.argv[2]) : RESULTS_DIR;
const targetDir = fs.existsSync(dirArg)
  ? dirArg
  : fs.existsSync(RESULTS_DIR)
  ? RESULTS_DIR
  : path.join(PROJECT_ROOT, "results_2026-08-07_15-52");

analyzeDirectory(targetDir);
