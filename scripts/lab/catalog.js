const CATALOG = [
  { id: "javascript", name: "JavaScript", description: "Seeded array sorting, JSON round trips, and integer computation.",
    metrics: { sortMs: ["Array sort", "ms", "lower"], jsonMs: ["JSON round trip", "ms", "lower"], computeMs: ["Integer computation", "ms", "lower"] } },
  { id: "dom", name: "DOM & layout", description: "Build a document, force layout, then update and query its nodes.",
    metrics: { insertMs: ["Insert & layout", "ms", "lower"], updateMs: ["Style update & layout", "ms", "lower"], queryMs: ["Selector queries", "ms", "lower"] } },
  { id: "canvas", name: "Canvas 2D", description: "Draw deterministic shapes, force a readback, and inspect pixels.",
    metrics: { drawMs: ["Draw & synchronize", "ms", "lower"], readbackMs: ["Pixel readback", "ms", "lower"], shapesPerSecond: ["Drawing throughput", "shapes/s", "higher"] } },
  { id: "crypto", name: "Web Crypto", description: "Hash a fixed binary payload repeatedly using SHA-256.",
    metrics: { digestMs: ["SHA-256 duration", "ms", "lower"], megabytesPerSecond: ["Hashing throughput", "MB/s", "higher"] } },
  { id: "storage", name: "IndexedDB", description: "Commit records in one transaction, then read and verify all records.",
    metrics: { writeMs: ["Committed write", "ms", "lower"], readMs: ["Read transaction", "ms", "lower"], recordsPerSecond: ["Write throughput", "records/s", "higher"] } },
  { id: "network", name: "Local network & cache", description: "Fetch an uncached local payload, then repeat a cacheable resource.",
    metrics: { uncachedMs: ["Uncached fetch", "ms", "lower"], cachedMs: ["Repeated cacheable fetch", "ms", "lower"], megabytesPerSecond: ["Uncached throughput", "MB/s", "higher"] } },
  { id: "tabs", name: "Multi-tab loading", description: "Open multiple local documents concurrently and verify every DOM is ready.",
    metrics: { totalMs: ["All tabs ready", "ms", "lower"], perTabMs: ["Time per tab", "ms", "lower"], tabsPerSecond: ["Tab throughput", "tabs/s", "higher"] } },
];
const BROWSERS = {
  chrome: { name: "Chrome", engine: "chromium", channel: "chrome" },
  edge: { name: "Edge", engine: "chromium", channel: "msedge" },
  firefox: { name: "Firefox", engine: "firefox" },
  chromium: { name: "Chromium", engine: "chromium" },
  webkit: { name: "WebKit", engine: "webkit" },
};
const PROFILES = { quick: { runs: 3, scale: 1 }, standard: { runs: 5, scale: 3 }, stress: { runs: 10, scale: 8 } };
const WORKLOAD_VERSION = 1;
module.exports = { CATALOG, BROWSERS, PROFILES, WORKLOAD_VERSION };
