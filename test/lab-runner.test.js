const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { parseOptions } = require("../scripts/lab/options");
const { runLab, runSample } = require("../scripts/lab/runner");
const { RunStore, summarize, samplesCsv } = require("../scripts/lab/store");

function setup(t, args = []) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-lab-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const options = { ...parseOptions(["--browsers", "chromium", "--suites", "javascript", "--runs", "2", ...args]), outputRoot: root };
  let contextsClosed = 0, browsersClosed = 0, measurements = 0;
  const browser = { version: () => "test-1", newContext: async () => ({ close: async () => { contextsClosed++; } }), close: async () => { browsersClosed++; } };
  const dependencies = { store: new RunStore(root), startFixture: async () => ({ url: "http://127.0.0.1", close: async () => {} }),
    launchBrowser: async () => browser, measureSuite: async () => { measurements++; return { metrics: { sortMs: 1, jsonMs: 2, computeMs: 3 } }; } };
  return { options, dependencies, browser, counts: () => ({ contextsClosed, browsersClosed, measurements }) };
}

test("Warmups are excluded from statistics and each sample gets an isolated context", async t => {
  const fixture = setup(t);
  const run = await runLab(fixture.options, fixture.dependencies);
  assert.equal(run.status, "completed"); assert.equal(run.samples.length, 2);
  assert.deepEqual(fixture.counts(), { contextsClosed: 3, browsersClosed: 1, measurements: 3 });
  assert.equal(summarize(run).summary[0].n, 2);
  assert.equal(fixture.dependencies.store.list()[0].ok, 2);
  assert.ok(fs.existsSync(path.join(fixture.options.outputRoot, run.id, "samples.csv")));
});
test("A failed sample can be resumed without re-running successful samples", async t => {
  const fixture = setup(t, ["--warmup", "0"]);
  let calls = 0;
  const measure = fixture.dependencies.measureSuite;
  fixture.dependencies.measureSuite = async (...args) => { if (++calls === 1) throw new Error("Transient failure"); return measure(...args); };
  const partial = await runLab(fixture.options, fixture.dependencies);
  assert.equal(partial.status, "partial"); assert.equal(summarize(partial).counts.ok, 1);
  fixture.dependencies.measureSuite = measure;
  const resumed = await runLab({ ...fixture.options, resume: partial.id }, fixture.dependencies);
  assert.equal(resumed.status, "completed"); assert.equal(resumed.samples.length, 3);
  assert.equal(resumed.samples.at(-1).attempt, 2);
  assert.equal(summarize(resumed).summary[0].n, 2);
  assert.match(samplesCsv(resumed), /Transient failure/);
});
test("Interruptions save progress and leave unfinished samples resumable", async t => {
  const fixture = setup(t, ["--warmup", "0"]), controller = new AbortController();
  fixture.dependencies.signal = controller.signal;
  fixture.dependencies.onProgress = () => controller.abort();
  const run = await runLab(fixture.options, fixture.dependencies);
  assert.equal(run.status, "interrupted"); assert.equal(run.samples.length, 1);
  assert.equal(summarize(run).counts.pending, 1);
});
test("Per-sample timeouts close the context before the next sample", async t => {
  const fixture = setup(t);
  const result = await runSample(fixture.browser, "javascript", "http://127.0.0.1", { scale: 1, timeoutMs: 5 }, undefined, () => new Promise(() => {}));
  assert.equal(result.status, "timeout"); assert.equal(fixture.counts().contextsClosed, 1);
});
test("Unsupported APIs and invalid measurement values do not become zero scores", async t => {
  const fixture = setup(t);
  const unsupported = await runSample(fixture.browser, "javascript", "local", { scale: 1, timeoutMs: 100 }, undefined, async () => { throw new Error("UNSUPPORTED: API absent"); });
  assert.equal(unsupported.status, "unsupported"); assert.deepEqual(unsupported.metrics, {});
  const invalid = await runSample(fixture.browser, "javascript", "local", { scale: 1, timeoutMs: 100 }, undefined, async () => ({ metrics: { sortMs: Infinity, jsonMs: 1, computeMs: 1 } }));
  assert.equal(invalid.status, "failed");
});
test("Resume rejects changed machine or browser versions and does not mix environments", async t => {
  const fixture = setup(t, ["--warmup", "0"]);
  fixture.dependencies.launchBrowser = async () => { throw new Error("Not installed"); };
  const run = await runLab(fixture.options, fixture.dependencies);
  assert.equal(summarize(run).counts.failed, 2);
  run.environment.cpuModel = "different machine"; fixture.dependencies.store.save(run);
  await assert.rejects(runLab({ ...fixture.options, resume: run.id }, fixture.dependencies), /Environment changed/);
});
test("Run locks prevent concurrent resume writers and filenames reject traversal", async t => {
  const fixture = setup(t), run = await runLab(fixture.options, fixture.dependencies), store = fixture.dependencies.store;
  const release = store.acquire(run.id);
  try { assert.throws(() => store.acquire(run.id), /already active/); } finally { release(); }
  assert.throws(() => store.load("../outside"), /Invalid run ID/);
});
test("Resume refuses to add samples from an updated browser version", async t => {
  const fixture = setup(t, ["--warmup", "0"]), controller = new AbortController();
  fixture.dependencies.signal = controller.signal;
  fixture.dependencies.onProgress = () => controller.abort();
  const partial = await runLab(fixture.options, fixture.dependencies);
  delete fixture.dependencies.signal; delete fixture.dependencies.onProgress;
  fixture.browser.version = () => "test-2";
  const resumed = await runLab({ ...fixture.options, resume: partial.id }, fixture.dependencies);
  assert.equal(resumed.status, "partial");
  assert.equal(resumed.browserVersions.chromium, "test-1");
  assert.equal(summarize(resumed).counts.ok, 1);
  assert.match(resumed.samples.at(-1).message, /Browser version changed/);
});
test("CSV exports quote text and neutralize spreadsheet formulas in error messages", async t => {
  const fixture = setup(t, ["--warmup", "0"]);
  fixture.dependencies.measureSuite = async () => { throw new Error('=HYPERLINK("example")'); };
  const run = await runLab(fixture.options, fixture.dependencies);
  assert.match(samplesCsv(run), /'=HYPERLINK/);
  assert.equal(summarize(run).summary.length, 0);
});
