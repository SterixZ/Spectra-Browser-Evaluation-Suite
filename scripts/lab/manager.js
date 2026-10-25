const { parseOptions } = require("./options");
const { runLab } = require("./runner");
const { progressCounts } = require("./store");

function startOptions(body, root) {
  const allowed = ["profile", "browsers", "suites", "runs", "scale", "warmup", "headless"];
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some(key => !allowed.includes(key))) throw new Error("Choose valid test settings.");
  const args = [];
  for (const key of ["profile", "runs", "scale", "warmup"]) if (body[key] != null) args.push(`--${key}`, String(body[key]));
  for (const key of ["browsers", "suites"]) {
    if (!Array.isArray(body[key]) || !body[key].length || body[key].some(value => typeof value !== "string")) throw new Error(`Choose at least one ${key === "browsers" ? "browser" : "test group"}.`);
    args.push(`--${key}`, body[key].join(","));
  }
  if (body.headless != null && typeof body.headless !== "boolean") throw new Error("Browser mode must be true or false.");
  if (body.headless === false) args.push("--headed");
  return { ...parseOptions(args), outputRoot: root };
}

class LabManager {
  constructor(store, execute = runLab) { this.store = store; this.execute = execute; this.active = null; this.lastError = null; }
  activity() {
    if (!this.active) return { active: null, error: this.lastError };
    let counts;
    try { counts = progressCounts(this.store.load(this.active.runId)); } catch {}
    return { active: { runId: this.active.runId, stopping: this.active.controller.signal.aborted, counts }, error: this.lastError };
  }
  async start(body) { return this.launch(startOptions(body, this.store.root)); }
  async resume(id) {
    this.store.load(id);
    return this.launch({ ...parseOptions(["--resume", id]), outputRoot: this.store.root });
  }
  async launch(options) {
    if (this.active) throw Object.assign(new Error("A test is already running. Wait for it to finish or stop it first."), { status: 409 });
    const activity = { controller: new AbortController(), runId: options.resume || null };
    this.active = activity; this.lastError = null;
    return new Promise((resolve, reject) => {
      activity.promise = Promise.resolve().then(() => this.execute(options, { store: this.store, signal: activity.controller.signal,
        onStarted: run => { activity.runId = run.id; resolve({ runId: run.id }); },
      })).catch(error => { this.lastError = error.message; reject(error); }).finally(() => { if (this.active === activity) this.active = null; });
    });
  }
  stop(id) {
    if (!this.active || this.active.runId !== id) throw Object.assign(new Error("This test is no longer running."), { status: 409 });
    this.active.controller.abort();
    return { runId: id, stopping: true };
  }
}

module.exports = { LabManager, startOptions };
