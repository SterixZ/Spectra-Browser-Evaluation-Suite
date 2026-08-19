const { chromium, firefox } = require("playwright");
const { BROWSERS } = require("./config");

// Returns launcher objects: { name, process, launch() }
function getLaunchers() {
  return BROWSERS.map((b) => ({
    name: b.name,
    process: b.process,
    launch: () =>
      b.channel
        ? chromium.launch({ channel: b.channel, headless: false })
        : firefox.launch({ headless: false }),
  }));
}

function ensureResultsDir(dir) {
  const fs = require("fs");
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
}

module.exports = { getLaunchers, ensureResultsDir };