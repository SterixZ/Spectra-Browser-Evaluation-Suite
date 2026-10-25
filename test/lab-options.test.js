const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseOptions } = require("../scripts/lab/options");
const { CATALOG } = require("../scripts/lab/catalog");

test("Lab profiles scale sample counts and workloads without adding new dependencies", () => {
  const quick = parseOptions([]), stress = parseOptions(["--profile", "stress"]);
  assert.equal(quick.runs, 3); assert.equal(quick.suites.length, 7);
  assert.equal(stress.runs, 10); assert.equal(stress.scale, 8);
  assert.equal(quick.headless, true);
  assert.equal(CATALOG.length, new Set(CATALOG.map(suite => suite.id)).size);
});
test("Lab options accept a selected browser/suite matrix and explicit zero warmups", () => {
  const config = parseOptions(["--browsers", "chromium,webkit,chromium", "--suites", "storage,dom", "--warmup", "0", "--runs", "2", "--headed"]);
  assert.deepEqual(config.browsers, ["chromium", "webkit"]); assert.deepEqual(config.suites, ["storage", "dom"]);
  assert.equal(config.warmup, 0); assert.equal(config.runs, 2); assert.equal(config.headless, false);
});
test("Lab rejects invalid, ambiguous, and unbounded workload settings", () => {
  for (const args of [["--runs", "0"], ["--scale", "21"], ["--runs", "1.5"], ["--runs", "NaN"], ["--suites", "unknown"], ["--browsers", "__proto__"], ["--profile", "__proto__"], ["--runs"], ["--headless", "--headed"], ["--runs", "1", "--runs", "2"], ["--oops"]]) {
    assert.throws(() => parseOptions(args), undefined, args.join(" "));
  }
});
test("Resume settings cannot silently change the experiment", () => {
  assert.equal(parseOptions(["--resume", "lab_test-1"]).resume, "lab_test-1");
  assert.throws(() => parseOptions(["--resume", "../escape"]), /Invalid run ID/);
  assert.throws(() => parseOptions(["--resume", "lab_test", "--runs", "3"]), /saved settings/);
});
