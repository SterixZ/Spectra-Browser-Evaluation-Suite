// Dedicated Workload Benchmark Runner for Microsoft Edge
// Usage: node scripts/workload_edge.js or npm run bench:workload:edge

const { runWorkloadForBrowsers } = require("./workload_core");

(async () => {
  console.log("\n========================================================================");
  console.log("🧪 STARTING MICROSOFT EDGE WORKLOAD BENCHMARK (5 Light vs. 5 Heavy)");
  console.log("========================================================================\n");
  await runWorkloadForBrowsers(["Edge"]);
})();
