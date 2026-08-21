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

function getLaunchers(filterNames = null) {
  let list = BROWSERS;
  if (filterNames && filterNames.length) {
    const targets = filterNames.map((n) => n.toLowerCase());
    list = BROWSERS.filter((b) => targets.includes(b.name.toLowerCase()));
  }

  return list.map((b) => ({
    name: b.name,
    process: b.process,
    isChromium: b.isChromium,
    channel: b.channel,
    launch: (options = {}) =>
      b.channel
        ? chromium.launch({
            channel: b.channel,
            headless: false,
            args: CHROMIUM_ARGS,
            ...options,
          })
        : firefox.launch({
            headless: false,
            args: FIREFOX_ARGS,
            ...options,
          }),
  }));
}

/**
 * Creates a Chrome DevTools Protocol (CDP) session if the browser supports it
 */
async function attachCdpSession(context, page) {
  try {
    if (context && typeof context.newCDPSession === "function") {
      const client = await context.newCDPSession(page);
      await client.send("Performance.enable").catch(() => {});
      return client;
    }
  } catch {
    return null;
  }
  return null;
}

function ensureDir(dir) {
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = {
  getLaunchers,
  attachCdpSession,
  ensureDir,
  CHROMIUM_ARGS,
  FIREFOX_ARGS,
};
