const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");
const { archiveRunDirectory } = require("../scripts/archive");

test("Legacy standard/workload iteration settings scale together and accept an explicit Speedometer skip", () => {
  const result = spawnSync(process.execPath, ["-e", 'const c=require("./scripts/config"); console.log(JSON.stringify([c.RUNS,c.WORKLOAD_RUNS,c.SPEEDOMETER_RUNS]))'],
    { cwd: path.join(__dirname, ".."), env: { ...process.env, RUNS: "7", SPEEDOMETER_RUNS: "0" }, encoding: "utf8" });
  assert.equal(result.status, 0); assert.deepEqual(JSON.parse(result.stdout), [7, 7, 0]);
  const invalid = spawnSync(process.execPath, ["-e", 'require("./scripts/config")'],
    { cwd: path.join(__dirname, ".."), env: { ...process.env, RUNS: "-1" }, encoding: "utf8" });
  assert.notEqual(invalid.status, 0); assert.match(invalid.stderr, /RUNS must be/);
});

test("Multiple archives in the same instant preserve every run without collisions", t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "spectra-archive-test-"));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const source = path.join(root, "results"), now = new Date("2026-10-25T00:00:00.000Z"), destinations = [];
  for (let i = 0; i < 3; i++) {
    fs.mkdirSync(source); fs.writeFileSync(path.join(source, "metrics.csv"), `run-${i}`);
    destinations.push(archiveRunDirectory(source, now));
  }
  assert.equal(new Set(destinations).size, 3);
  destinations.forEach((directory, i) => assert.equal(fs.readFileSync(path.join(directory, "metrics.csv"), "utf8"), `run-${i}`));
  assert.throws(() => archiveRunDirectory(root), /Only in-progress/);
});
