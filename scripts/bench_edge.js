// Dedicated Benchmark Runner for Microsoft Edge
// Usage: node scripts/bench_edge.js or npm run bench:edge

const { runBenchmarkForBrowsers } = require("./bench_browser_core");

(async () => {
  console.log("\n=============================================");
  console.log("🌐 STARTING MICROSOFT EDGE BENCHMARK");
  console.log("=============================================\n");
  await runBenchmarkForBrowsers(["Edge"]);
})();
