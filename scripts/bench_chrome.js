// Dedicated Benchmark Runner for Google Chrome
// Usage: node scripts/bench_chrome.js or npm run bench:chrome

const { runBenchmarkForBrowsers } = require("./bench_browser_core");

(async () => {
  console.log("\n=============================================");
  console.log("🌐 STARTING GOOGLE CHROME BENCHMARK");
  console.log("=============================================\n");
  await runBenchmarkForBrowsers(["Chrome"]);
})();
