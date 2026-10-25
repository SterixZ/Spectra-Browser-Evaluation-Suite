const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const { once } = require("node:events");
const express = require("express");
const { BROWSERS } = require("../scripts/lab/catalog");

test("All pages share sidebar layout, route selection, theme, and mobile behavior", {
  skip: process.env.SPECTRA_BROWSER_SMOKE !== "1", timeout: 90000,
}, async t => {
  const app = express();
  app.use(require("../dashboard/server").app);
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const browserId = process.env.SPECTRA_SMOKE_BROWSER || "chromium";
  const definition = BROWSERS[browserId];
  const browser = await require("playwright")[definition.engine].launch({ headless: true,
    ...(definition.channel ? { channel: definition.channel } : {}) });
  t.after(() => browser.close());
  const context = await browser.newContext({ viewport: { width: 1440, height: 1100 } });
  await context.route("**/*", route => route.request().url().startsWith(base) ? route.continue() : route.abort());
  const pages = [], errors = [], images = path.join(__dirname, "../test-results");
  fs.mkdirSync(images, { recursive: true });
  for (const [id, route] of [["lab", "/lab.html"], ["website", "/benchmark.html"], ["live", "/"]]) {
    const page = await context.newPage();
    page.on("pageerror", error => errors.push(error.message));
    await page.goto(base + route);
    await page.waitForFunction(() => document.querySelectorAll(".spectra-nav-link").length === 3);
    assert.deepEqual(await page.locator(".spectra-nav-link").allTextContents(), ["Browser benchmarks", "Website tests", "Live monitor"]);
    assert.deepEqual(await page.locator(".spectra-nav-link").evaluateAll(links => links.map(link => link.getAttribute("href"))), ["/lab.html", "/benchmark.html", "/"]);
    assert.equal(await page.locator('.spectra-nav-link[aria-current="page"]').count(), 1);
    assert.equal(await page.locator('.spectra-nav-link[aria-current="page"]').getAttribute("data-page"), id);
    const bounds = await page.locator(".spectra-sidebar").boundingBox();
    assert.equal(bounds.width, 230);
    assert.equal(bounds.x, 0);
    pages.push({ id, page });
  }
  const lab = pages[0].page, website = pages[1].page;
  await lab.locator('[data-theme-choice="light"]').click();
  for (const { id, page } of pages) {
    await page.waitForFunction(() => document.documentElement.dataset.theme === "light");
    assert.equal(await page.locator('[data-theme-choice="light"]').getAttribute("aria-pressed"), "true");
    await page.locator(".spectra-sidebar").screenshot({ path: path.join(images, `sidebar-${browserId}-${id}.png`) });
  }
  await website.locator('[data-theme-choice="dark"]').click();
  for (const { page } of pages) {
    await page.waitForFunction(() => document.documentElement.dataset.theme === "dark");
    assert.equal(await page.locator('[data-theme-choice="dark"]').getAttribute("aria-pressed"), "true");
  }
  for (const view of ["charts", "logs"]) {
    await website.locator(`[data-website-view="${view}"]`).click();
    await website.waitForFunction(expected => document.querySelector(".page-view.active")?.id === `view-${expected}`, view);
    assert.equal(await website.locator('[data-website-view][aria-current="location"]').getAttribute("data-website-view"), view);
    assert.equal(await website.locator('.spectra-nav-link[aria-current="page"]').getAttribute("data-page"), "website");
  }
  await website.goBack();
  await website.waitForFunction(() => document.querySelector(".page-view.active")?.id === "view-charts");
  await website.goForward();
  await website.waitForFunction(() => document.querySelector(".page-view.active")?.id === "view-logs");
  await website.goto(base + "/benchmark.html#table");
  await website.waitForFunction(() => document.querySelector(".page-view.active")?.id === "view-table");
  assert.equal(await website.locator('.spectra-nav-link[aria-current="page"]').getAttribute("data-page"), "website");
  await website.screenshot({ path: path.join(images, `navigation-${browserId}-website.png`) });
  const mobileBounds = [];
  for (const { id, page } of pages) {
    await page.setViewportSize({ width: 390, height: 844 });
    const bounds = await page.locator(".spectra-sidebar").boundingBox();
    mobileBounds.push({ width: bounds.width, height: bounds.height });
    assert.equal(bounds.width, 390);
    assert.equal(await page.locator('[data-theme-choice="light"]').isVisible(), true);
    await page.locator(".spectra-sidebar").screenshot({ path: path.join(images, `sidebar-${browserId}-${id}-mobile.png`) });
  }
  assert.deepEqual(mobileBounds[0], mobileBounds[1]);
  assert.deepEqual(mobileBounds[1], mobileBounds[2]);
  assert.deepEqual(errors, []);
  await context.close();
});
