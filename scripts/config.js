const path = require("path");

function envInteger(name, fallback, minimum, maximum) {
  const value = process.env[name] == null ? fallback : Number(process.env[name]);
  if (!Number.isInteger(value) || value < minimum || value > maximum) {
    throw new Error(`${name} must be an integer between ${minimum} and ${maximum}.`);
  }
  return value;
}

const RUNS = envInteger("RUNS", 3, 1, 100);

module.exports = {
  // scripts/ lives one level below the project root, and results/ is a
  // sibling of scripts/ at the root (matches the actual project layout).
  RESULTS_DIR: path.join(__dirname, "..", "results"),

  // Scale these to run bigger/smaller benchmarks. Override at the shell:
  //   $env:RUNS = '20'; npm run bench
  RUNS,
  WORKLOAD_RUNS: envInteger("WORKLOAD_RUNS", RUNS, 1, 100),
  SPEEDOMETER_RUNS: envInteger("SPEEDOMETER_RUNS", 1, 0, 100),

  // How long to let the page settle after loading all URLS before sampling
  // CPU/memory, and how the CPU sample itself is taken (N samples of
  // `interval` ms each, averaged).
  STABILIZE_MS: envInteger("STABILIZE_MS", 2000, 0, 60000),
  CPU_SAMPLE_COUNT: envInteger("CPU_SAMPLE_COUNT", 5, 1, 1000),
  CPU_SAMPLE_INTERVAL_MS: envInteger("CPU_SAMPLE_INTERVAL_MS", 500, 1, 60000),

  URLS: [
    "https://www.google.com",
    "https://github.com",
    "https://news.ycombinator.com",
    "https://www.wikipedia.org",
    "https://www.youtube.com",
    "https://www.reddit.com",
    "https://duckduckgo.com",
    "https://www.w3schools.com",
    "https://playwright.dev",
    "https://www.w3.org",
  ],

  SPEEDOMETER_URL: "https://browserbench.org/Speedometer3.0/",

  // process: the OS process name used for CPU/memory sampling (Windows).
  BROWSERS: [
    { name: "Chrome", process: "chrome", channel: "chrome" },
    { name: "Edge", process: "msedge", channel: "msedge" },
    { name: "Firefox", process: "firefox", channel: null },
  ],
};
