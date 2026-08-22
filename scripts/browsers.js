const fs = require("fs");
const { chromium, firefox } = require("playwright");
const { BROWSERS } = require("./config");

const CHROMIUM_ARGS = [
  "--no-first-run",
  "--no-default-browser-check",
  "--disable-background-mode",
  "--disable-features=msEdgeStartupBoost,msHubEdgeSidebar,msEdgeFre,msSmartScreenProtection",
  "--disable-backgrounding-occluded-windows",
  "--disable-renderer-backgrounding",
  "--disable-breakpad",
  "--disable-component-update",
  "--disable-extensions",
  "--disable-sync",
];

const FIREFOX_ARGS = [
  "-no-remote",
];

// Returns standardized launcher objects: { name, process, launch() }
function getLaunchers() {
  return BROWSERS.map((b) => ({
    name: b.name,
    process: b.process,
    launch: (options = {}) =>
      b.channel
        ? chromium.launch({ channel: b.channel, headless: false, ...options })
        : firefox.launch({ headless: false, ...options }),
  }));
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  getLaunchers,
  ensureDir,
  CHROMIUM_ARGS,
  FIREFOX_ARGS,
};