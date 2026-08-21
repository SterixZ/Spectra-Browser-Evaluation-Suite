const path = require("path");

module.exports = {
  // scripts/ lives one level below the project root, and results/ is a
  // sibling of scripts/ at the root (matches the actual project layout).
  RESULTS_DIR: path.join(__dirname, "..", "results"),

  // Scale these to run bigger/smaller benchmarks. Override at the shell:
  //   RUNS=20 node scripts/benchmark.js
  RUNS: Number(process.env.RUNS) || 3,
  SPEEDOMETER_RUNS: Number(process.env.SPEEDOMETER_RUNS) || 3,

  // How long to let the page settle after loading all URLS before sampling
  // CPU/memory, and how the CPU sample itself is taken (N samples of
  // `interval` ms each, averaged).
  STABILIZE_MS: Number(process.env.STABILIZE_MS) || 5000,
  CPU_SAMPLE_COUNT: Number(process.env.CPU_SAMPLE_COUNT) || 5,
  CPU_SAMPLE_INTERVAL_MS: Number(process.env.CPU_SAMPLE_INTERVAL_MS) || 1000,

  URLS: [
    "https://www.google.com",
    "https://github.com",
    "https://stackoverflow.com",
    "https://www.wikipedia.org",
    "https://www.youtube.com",
    "https://www.reddit.com",
    "https://www.microsoft.com",
    "https://developer.mozilla.org",
    "https://playwright.dev",
    "https://openai.com",
  ],

  SPEEDOMETER_URL: "https://browserbench.org/Speedometer3.0/",

  // process: the OS process name used for CPU/memory sampling (Windows).
  BROWSERS: [
    { name: "Chrome", process: "chrome", channel: "chrome" },
    { name: "Edge", process: "msedge", channel: "msedge" },
    { name: "Firefox", process: "firefox", channel: null },
  ],
};
