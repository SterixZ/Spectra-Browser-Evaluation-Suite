// Dedicated Benchmark Runner for Mozilla Firefox
// Usage: node scripts/bench_firefox.js or npm run bench:firefox

const { runBenchmarkForBrowsers } = require("./bench_browser_core");

(async () => {
  console.log("\n=============================================");
  console.log("🌐 STARTING MOZILLA FIREFOX BENCHMARK");
  console.log("=============================================\n");
  await runBenchmarkForBrowsers(["Firefox"]);
})();
