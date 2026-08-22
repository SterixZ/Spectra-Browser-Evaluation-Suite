// Full Benchmark Suite Runner for all 3 Browsers (Chrome, Edge, Firefox)
// Usage: node scripts/full_benchmark.js or npm run bench

const { runBenchmarkForBrowsers } = require("./bench_browser_core");

(async () => {
  await runBenchmarkForBrowsers(["Chrome", "Edge", "Firefox"]);
})();
