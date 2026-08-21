const path = require("path");

module.exports = {
  // Output and Data Directories
  DATA_DIR: path.join(__dirname, "..", "data"),
  RESULTS_DIR: path.join(__dirname, "..", "results"),

  // Benchmark Run Parameters
  RUNS: Number(process.env.RUNS) || 3,
  SPEEDOMETER_RUNS: Number(process.env.SPEEDOMETER_RUNS) || 3,
  STABILIZE_MS: Number(process.env.STABILIZE_MS) || 3000,
  INTER_RUN_DELAY_MS: 3000,
  INTER_SITE_DELAY_MS: 1500,

  // Speedometer 3.0 Benchmark URL
  SPEEDOMETER_URL: "https://browserbench.org/Speedometer3.0/",

  // Standard 10-Website Canonical Suite (Direct endpoints to prevent multi-hop redirects)
  URLS: [
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

  // 2-Tier Workload Benchmark Suite (5 Ultra-Lightweight vs 5 Heavyweight SPAs)
  WORKLOADS: {
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

  // Target Web Browsers & OS Process Names
  BROWSERS: [
    { name: "Chrome", process: "chrome", channel: "chrome" },
    { name: "Edge", process: "msedge", channel: "msedge" },
    { name: "Firefox", process: "firefox", channel: null },
  ],
};
