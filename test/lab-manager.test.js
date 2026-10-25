const { test } = require("node:test");
const assert = require("node:assert/strict");
const { LabManager, startOptions } = require("../scripts/lab/manager");

const settings = { browsers: ["chromium", "firefox"], suites: ["javascript", "dom"], profile: "quick", runs: 2, warmup: 0, scale: 1, headless: true };
test("Dashboard settings are validated before a browser can start", () => {
  const options = startOptions(settings, "output");
  assert.equal(options.runs, 2); assert.deepEqual(options.browsers, ["chromium", "firefox"]);
  for (const input of [{ ...settings, browsers: [] }, { ...settings, runs: -1 }, { ...settings, command: "anything" }, { ...settings, browsers: ["__proto__"] }, { ...settings, headless: "false" }]) assert.throws(() => startOptions(input, "output"));
});
test("Dashboard jobs start, reject overlapping runs, stop, and release their slot", async () => {
  let finish, signal;
  const store = { root: "output", load: () => ({ settings: { browsers: ["chromium"], suites: ["javascript"], runs: 2 }, samples: [] }) };
  const manager = new LabManager(store, async (options, dependencies) => {
    signal = dependencies.signal; dependencies.onStarted({ id: "lab_ui" });
    await new Promise(resolve => finish = resolve);
  });
  assert.deepEqual(await manager.start(settings), { runId: "lab_ui" });
  assert.equal(manager.activity().active.counts.planned, 2);
  await assert.rejects(manager.start(settings), /already running/);
  assert.throws(() => manager.stop("another_run"), /no longer running/);
  assert.equal(manager.stop("lab_ui").stopping, true); assert.equal(signal.aborted, true);
  const completion = manager.active.promise; finish(); await completion;
  assert.equal(manager.activity().active, null);
});
test("Startup errors become visible and do not leave the runner busy", async () => {
  const manager = new LabManager({ root: "output" }, async () => { throw new Error("Cannot start this run"); });
  await assert.rejects(manager.start(settings), /Cannot start/);
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(manager.activity().active, null); assert.match(manager.activity().error, /Cannot start/);
});
