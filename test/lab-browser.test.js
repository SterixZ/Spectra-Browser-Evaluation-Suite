const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const express = require("express");
const { parseOptions } = require("../scripts/lab/options");
const { runLab } = require("../scripts/lab/runner");
const { RunStore, summarize } = require("../scripts/lab/store");
const { createLabRouter } = require("../scripts/lab/api");
const { BROWSERS } = require("../scripts/lab/catalog");
const enabled = process.env.SPECTRA_BROWSER_SMOKE === "1";

test("Real browser runs all seven suites and renders saved results in the Lab", { skip: !enabled, timeout: 180000 }, async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-browser-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const browserId = process.env.SPECTRA_SMOKE_BROWSER || "chromium";
  const options = { ...parseOptions(["--browsers", browserId, "--runs", "1", "--warmup", "0", "--timeout", "20000"]), outputRoot: root };
  const run = await runLab(options);
  const result = summarize(run);
  assert.equal(run.status, "completed", JSON.stringify(run.samples.filter(sample => sample.status !== "ok")));
  assert.equal(result.counts.ok, 7);
  assert.equal(result.summary.length, run.catalog.reduce((total, suite) => total + Object.keys(suite.metrics).length, 0));

  const app = express();
  app.use(express.static(path.join(__dirname, "../dashboard/public")));
  app.use("/api/lab", createLabRouter(new RunStore(root)));
  const server = app.listen(0, "127.0.0.1"); await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const definition = BROWSERS[browserId];
  const browser = await require("playwright")[definition.engine].launch({ headless: true, ...(definition.channel ? { channel: definition.channel } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${base}/lab.html?run=${run.id}`);
  await page.waitForFunction(() => document.getElementById("runStatus").textContent === "COMPLETED");
  assert.equal(await page.locator("#sampleCount").textContent(), "7 / 7");
  assert.equal(await page.locator("#suiteSelect option").count(), 7);
  for (const suite of run.settings.suites) {
    await page.selectOption("#suiteSelect", suite);
    const metricCount = Object.keys(run.catalog.find(item => item.id === suite).metrics).length;
    assert.equal(await page.locator("#labSummary tr").count(), metricCount);
    assert.equal(await page.locator("#metricSelect option").count(), metricCount);
  }
  assert.equal(await page.locator("#labSamples tr").count(), 7);
  assert.match(await page.locator("#planCommand").inputValue(), /npm run bench:lab/);
  assert.equal(await page.locator("#downloadCsv").getAttribute("href"), `/api/lab/runs/${run.id}/csv`);
  await page.locator('[data-theme-choice="dark"]').click();
  assert.equal(await page.locator("html").getAttribute("data-theme"), "dark");
  const images = path.join(__dirname, "../test-results"); fs.mkdirSync(images, { recursive: true });
  await page.screenshot({ path: path.join(images, `lab-${browserId}.png`), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), "Mobile layout overflows horizontally");
  await page.screenshot({ path: path.join(images, `lab-${browserId}-mobile.png`), fullPage: true });
  assert.deepEqual(errors, []);

  // Verify the empty state after switching to a separate results root.
  const emptyStore = new RunStore(path.join(root, "empty"));
  const emptyApp = express(); emptyApp.use(express.static(path.join(__dirname, "../dashboard/public"))); emptyApp.use("/api/lab", createLabRouter(emptyStore));
  const emptyServer = emptyApp.listen(0, "127.0.0.1"); await once(emptyServer, "listening");
  t.after(() => new Promise(resolve => emptyServer.close(resolve)));
  const emptyBase = `http://127.0.0.1:${emptyServer.address().port}`;
  await context.unroute("**/*");
  await context.route("**/*", route => route.request().url().startsWith(emptyBase) ? route.continue() : route.abort());
  await page.goto(emptyBase + "/lab.html");
  await page.waitForFunction(() => !document.getElementById("emptyLab").hidden);
  assert.equal(await page.locator("#planner").getAttribute("open"), "");
  await context.close();
});
