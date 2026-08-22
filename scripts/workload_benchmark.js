// Full Workload Benchmark Suite Runner for all 3 Browsers (Chrome, Edge, Firefox)
// Usage: node scripts/workload_benchmark.js or npm run bench:workloads

const { runWorkloadForBrowsers } = require("./workload_core");

(async () => {
  await runWorkloadForBrowsers(["Chrome", "Edge", "Firefox"]);
})();
