// Dedicated Workload Benchmark Runner for Google Chrome
// Usage: node scripts/workload_chrome.js or npm run bench:workload:chrome

const { runWorkloadForBrowsers } = require("./workload_core");

(async () => {
  console.log("\n========================================================================");
  console.log("🧪 STARTING GOOGLE CHROME WORKLOAD BENCHMARK (5 Light vs. 5 Heavy)");
  console.log("========================================================================\n");
  await runWorkloadForBrowsers(["Chrome"]);
})();
