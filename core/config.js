const path = require("path");

module.exports = {
  // Directory Paths
  PROJECT_ROOT: path.join(__dirname, ".."),
  RESULTS_DIR: path.join(__dirname, "..", "results"),
  DATA_DIR: path.join(__dirname, "..", "data"),
  DOCS_DIR: path.join(__dirname, "..", "docs"),

  // Benchmark Run Parameters
  DEFAULT_RUNS: Number(process.env.RUNS) || 3,
  DEFAULT_SPEEDOMETER_RUNS: Number(process.env.SPEEDOMETER_RUNS) || 3,
  DEFAULT_WORKLOAD_ITERATIONS: Number(process.env.ITERATIONS) || 5,

  // Delays and Timing (ms)
  INTER_RUN_DELAY_MS: 3000,
  INTER_SITE_DELAY_MS: 1500,
  THERMAL_COOLDOWN_MS: 5000,
  POST_LOAD_STABILIZE_MS: 1500,
  NAVIGATION_TIMEOUT_MS: 25000,
  SPEEDOMETER_TIMEOUT_MS: 600000,

  // Target Benchmark URLs
  SPEEDOMETER_URL: "https://browserbench.org/Speedometer3.0/",
  WARMUP_URL: "https://example.com",

  // Canonical 10-Website Real-World Lifecycle Suite
  CANONICAL_URLS: [
    "https://www.google.com",
    "https://github.com",
    "https://stackoverflow.com",
    "https://www.wikipedia.org",
    "https://www.youtube.com",
    "https://www.reddit.com",
    "https://learn.microsoft.com",
    "https://developer.mozilla.org",
    "https://playwright.dev",
    "https://openai.com",
  ],

  // 2-Tier Workload Benchmark Suite (5 Ultra-Light vs 5 Heavy SPAs)
  WORKLOAD_SUITES: {
    Lightweight: [
      { name: "W3C Standards", url: "https://www.w3.org" },
      { name: "CERN World Wide Web", url: "http://info.cern.ch" },
      { name: "Project Gutenberg", url: "https://www.gutenberg.org" },
      { name: "NPR Text-Only", url: "https://text.npr.org" },
      { name: "Wikipedia Main", url: "https://www.wikipedia.org" },
    ],
    Heavyweight: [
      { name: "YouTube Video Hub", url: "https://www.youtube.com" },
      { name: "Reddit Feed (SPA)", url: "https://www.reddit.com" },
      { name: "The Verge Web App", url: "https://www.theverge.com" },
      { name: "VS Code Online", url: "https://vscode.dev" },
      { name: "Amazon Storefront", url: "https://www.amazon.com" },
    ],
  },

  // Supported Web Browsers
  BROWSERS: [
    { name: "Chrome", process: "chrome", channel: "chrome", isChromium: true },
    { name: "Edge", process: "msedge", channel: "msedge", isChromium: true },
    { name: "Firefox", process: "firefox", channel: null, isChromium: false },
  ],
};
