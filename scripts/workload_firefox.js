// Dedicated Workload Benchmark Runner for Mozilla Firefox
// Usage: node scripts/workload_firefox.js or npm run bench:workload:firefox

const { runWorkloadForBrowsers } = require("./workload_core");

(async () => {
  console.log("\n========================================================================");
  console.log("🧪 STARTING MOZILLA FIREFOX WORKLOAD BENCHMARK (5 Light vs. 5 Heavy)");
  console.log("========================================================================\n");
  await runWorkloadForBrowsers(["Firefox"]);
})();
