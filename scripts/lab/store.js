const fs = require("node:fs");
const path = require("node:path");
const { computeDescriptiveStats } = require("../stats");
const { resultsRoot } = require("./options");

function latestSamples(samples) {
  return [...new Map(samples.map(sample => [sample.key, sample])).values()];
}

function progressCounts(run) {
  const latest = latestSamples(run.samples);
  const counts = { planned: run.settings.browsers.length * run.settings.suites.length * run.settings.runs,
    ok: 0, failed: 0, timeout: 0, unsupported: 0 };
  latest.forEach(sample => { if (sample.status in counts && sample.status !== "planned") counts[sample.status]++; });
  counts.pending = counts.planned - latest.length;
  return counts;
}

function summarize(run) {
  const latest = latestSamples(run.samples);
  const summary = [];
  for (const suite of run.catalog) {
    for (const [metric, [label, unit, direction]] of Object.entries(suite.metrics)) {
      for (const browser of run.settings.browsers) {
        const values = latest.filter(sample => sample.browser === browser && sample.suite === suite.id && sample.status === "ok")
          .map(sample => sample.metrics[metric]).filter(Number.isFinite);
        if (!values.length) continue;
        const stats = computeDescriptiveStats(values);
        summary.push({ suite: suite.id, browser, metric, label, unit, direction, ...stats,
          ci95: stats.n > 1 ? stats.ci95 : null });
      }
    }
  }
  return { summary, counts: progressCounts(run) };
}

function csvCell(value) {
  // Prevent formula execution when messages are opened in spreadsheet software.
  let text = value == null ? "" : String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = "'" + text;
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

function samplesCsv(run) {
  const records = [["Browser", "Suite", "Iteration", "Attempt", "Status", "Metric", "Value", "Unit", "Message"]];
  for (const sample of run.samples) {
    const suite = run.catalog.find(item => item.id === sample.suite);
    const metrics = Object.entries(sample.metrics || {});
    for (const [metric, value] of metrics.length ? metrics : [["", ""]]) {
      records.push([sample.browser, sample.suite, sample.iteration, sample.attempt, sample.status,
        metric, value, suite?.metrics[metric]?.[1] || "", sample.message || ""]);
    }
  }
  return records.map(record => record.map(csvCell).join(",")).join("\n") + "\n";
}

function atomicJson(filepath, data) {
  const temporary = `${filepath}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, JSON.stringify(data, null, 2) + "\n");
  fs.renameSync(temporary, filepath);
}

class RunStore {
  constructor(root = resultsRoot()) { this.root = path.resolve(root); }
  directory(id) {
    if (typeof id !== "string" || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(id)) throw new Error("Invalid run ID.");
    const directory = path.join(this.root, id);
    if (fs.existsSync(directory)) {
      const relative = path.relative(fs.realpathSync(this.root), fs.realpathSync(directory));
      if (relative.startsWith("..") || path.isAbsolute(relative)) throw new Error("Run directory escapes the results root.");
      const manifest = path.join(directory, "manifest.json");
      if (fs.existsSync(manifest) && fs.lstatSync(manifest).isSymbolicLink()) throw new Error("Linked manifests are not supported.");
    }
    return directory;
  }
  create(run) {
    const directory = this.directory(run.id);
    fs.mkdirSync(this.root, { recursive: true });
    fs.mkdirSync(directory); // Never overwrite an existing experiment.
    this.save(run);
  }
  save(run) {
    const directory = this.directory(run.id);
    atomicJson(path.join(directory, "manifest.json"), run);
    atomicJson(path.join(directory, "metadata.json"), { id: run.id, schemaVersion: run.schemaVersion,
      status: run.status, startedAt: run.startedAt, completedAt: run.completedAt,
      profile: run.settings.profile, browsers: run.settings.browsers, suites: run.settings.suites,
      headless: run.settings.headless, scale: run.settings.scale, ...progressCounts(run) });
  }
  load(id) {
    const run = JSON.parse(fs.readFileSync(path.join(this.directory(id), "manifest.json"), "utf8"));
    if (run.id !== id || run.schemaVersion !== 1 || !Array.isArray(run.samples) || !Array.isArray(run.catalog) || !run.settings) throw new Error("Invalid lab manifest.");
    return run;
  }
  list() {
    if (!fs.existsSync(this.root)) return [];
    return fs.readdirSync(this.root, { withFileTypes: true }).filter(entry => entry.isDirectory() && !entry.isSymbolicLink())
      .flatMap(entry => {
        try {
          const filepath = path.join(this.directory(entry.name), "metadata.json");
          if (fs.lstatSync(filepath).isSymbolicLink()) return [];
          const metadata = JSON.parse(fs.readFileSync(filepath, "utf8"));
          return metadata.id === entry.name && metadata.schemaVersion === 1 ? [metadata] : [];
        } catch { return []; }
      }).sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }
  export(run) {
    const directory = this.directory(run.id);
    fs.writeFileSync(path.join(directory, "samples.csv"), samplesCsv(run));
    atomicJson(path.join(directory, "summary.json"), summarize(run));
  }
  acquire(id) {
    const filepath = path.join(this.directory(id), "run.lock");
    if (fs.existsSync(filepath)) {
      const owner = Number(fs.readFileSync(filepath, "utf8"));
      if (!Number.isInteger(owner) || owner < 1) throw new Error("Invalid run lock. Inspect run.lock before resuming.");
      let active = true;
      try { process.kill(owner, 0); } catch (error) { if (error.code === "ESRCH") active = false; }
      if (active) throw new Error("This run is already active in another process.");
      fs.unlinkSync(filepath);
    }
    const handle = fs.openSync(filepath, "wx");
    fs.writeFileSync(handle, String(process.pid));
    return () => { fs.closeSync(handle); fs.unlinkSync(filepath); };
  }
}

module.exports = { RunStore, summarize, latestSamples, samplesCsv, csvCell, progressCounts };
