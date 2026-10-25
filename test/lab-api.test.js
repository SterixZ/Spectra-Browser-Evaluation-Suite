const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { once } = require("node:events");
const express = require("express");
const { createLabRouter } = require("../scripts/lab/api");
const { RunStore } = require("../scripts/lab/store");
const { CATALOG } = require("../scripts/lab/catalog");
let root, server, base;

before(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-api-test-"));
  const store = new RunStore(root);
  store.create({ schemaVersion: 1, id: "lab_test", status: "completed", startedAt: new Date().toISOString(),
    settings: { browsers: ["chromium"], suites: ["javascript"], runs: 3, profile: "quick", scale: 1, headless: true },
    catalog: CATALOG.filter(suite => suite.id === "javascript"), samples: [1, 2, 3].map(iteration => ({ key: `chromium/javascript/${iteration}`, browser: "chromium", suite: "javascript", iteration, attempt: 1, status: "ok", metrics: { sortMs: iteration, jsonMs: 2, computeMs: 3 } })) });
  const app = express(); app.use("/api/lab", createLabRouter(store));
  server = app.listen(0, "127.0.0.1"); await once(server, "listening"); base = `http://127.0.0.1:${server.address().port}/api/lab`;
});
after(async () => { await new Promise(resolve => server.close(resolve)); fs.rmSync(root, { recursive: true, force: true }); });

test("Lab catalog exposes all seven suites and five browser choices", async () => {
  const data = await (await fetch(base + "/catalog")).json();
  assert.equal(data.suites.length, 7); assert.equal(Object.keys(data.browsers).length, 5);
});
test("Lab run discovery uses compact metadata and bounded pagination", async () => {
  const data = await (await fetch(base + "/runs?limit=1")).json();
  assert.equal(data.total, 1); assert.equal(data.runs[0].ok, 3); assert.equal(data.runs[0].samples, undefined);
  assert.equal((await fetch(base + "/runs?limit=10000")).status, 400);
});
test("Lab detail API summarizes all samples while returning one page of rows", async () => {
  const data = await (await fetch(base + "/runs/lab_test?offset=1&limit=1")).json();
  assert.equal(data.samples.length, 1); assert.equal(data.samples[0].iteration, 2);
  assert.equal(data.summary[0].n, 3); assert.equal(data.summary[0].mean, 2);
  assert.equal(data.pagination.total, 3); assert.equal(data.run.samples, undefined);
});
test("Lab rejects unknown runs, invalid filters, and invalid offsets", async () => {
  assert.equal((await fetch(base + "/runs/missing")).status, 404);
  assert.equal((await fetch(base + "/runs/%2E%2E%2Foutside")).status, 404);
  assert.equal((await fetch(base + "/runs/lab_test?browser=unknown")).status, 400);
  assert.equal((await fetch(base + "/runs/lab_test?offset=-1")).status, 400);
});
test("CSV download is an attachment and includes each measured sample", async () => {
  const response = await fetch(base + "/runs/lab_test/csv");
  assert.match(response.headers.get("content-disposition"), /lab_test.csv/);
  assert.match(await response.text(), /chromium,javascript,3,1,ok/);
});
