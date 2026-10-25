// The core runner owns incremental saves and archiving. Preserve unfinished runs.
const { runBenchmarkForBrowsers } = require("./bench_browser_core");

runBenchmarkForBrowsers(["Chrome", "Edge", "Firefox"]).catch(error => {
  console.error(`Benchmark failed: ${error.message}`);
  process.exitCode = 1;
});
