const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { getBenchmarkData, listRunFolders } = require("../scripts/results");

function fixture(t, files) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-test-"));
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }));
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(directory, name), text);
  return directory;
}

test("Workload metrics use the three recorded iterations without mixing site peaks", () => {
  const data = getBenchmarkData(path.join(__dirname, "../workloads_2026-08-22_19-56"));
  assert.equal(data.summary.Chrome.cpu.n, 3);
  assert.equal(data.summary.Chrome.memory.n, 3);
  assert.equal(data.summary.Chrome.startup.n, 3);
  assert.ok(Math.abs(data.summary.Chrome.cpu.mean - 3.3033333333) < 1e-8);
});

test("Standard run preserves the recorded samples and Speedometer observations", () => {
  const data = getBenchmarkData(path.join(__dirname, "../results_2026-08-22_22-29"));
  assert.equal(data.summary.Chrome.startup.n, 3);
  assert.equal(data.summary.Chrome.speedometer.n, 1);
  assert.equal(data.summary.Chrome.pageload.n, 30);
});

test("Fallback-only workload retains every timing observation and deduplicates startup iterations", t => {
  const directory = fixture(t, { "workload_raw.csv": "Browser,Iteration,StartupMs,PeakCpuPercent,PeakMemoryMB,TTFB_Ms,FCP_Ms,TransferRateKBs\nChrome,1,100,2,300,20,30,40\nChrome,1,100,4,500,40,50,60\nChrome,2,200,6,700,60,70,80\n" });
  const data = getBenchmarkData(directory).summary.Chrome;
  assert.equal(data.startup.n, 2);
  assert.equal(data.ttfb.n, 3);
  assert.equal(data.fcp.n, 3);
  assert.equal(data.transferRate.n, 3);
  assert.equal(data.cpu.mean, 4);
});

test("Empty numeric cells are missing data; zero CPU remains a valid sample", t => {
  const directory = fixture(t, { "metrics.csv": "Browser,Startup(ms),CPU(%),Memory(MB)\nChrome,100,0,200\nChrome,200,,300\n" });
  const stats = getBenchmarkData(directory).summary.Chrome;
  assert.equal(stats.cpu.n, 1);
  assert.equal(stats.cpu.mean, 0);
  assert.equal(stats.memory.mean, 250);
});

test("Results folder selection compares timestamps across run types", () => {
  const folders = listRunFolders();
  assert.ok(folders.indexOf("results_2026-08-22_22-29") < folders.indexOf("workloads_2026-08-22_19-56"));
});
