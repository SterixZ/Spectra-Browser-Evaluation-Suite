const os = require("node:os");
const { randomUUID } = require("node:crypto");
const { CATALOG, BROWSERS, WORKLOAD_VERSION } = require("./catalog");
const { RunStore, summarize, latestSamples } = require("./store");
const { startFixtureServer } = require("./fixture-server");
const { measureSuite } = require("./cases");

function environment() {
  return { platform: process.platform, arch: process.arch, osRelease: os.release(),
    cpuModel: os.cpus()[0]?.model || "unknown", cpuCount: os.cpus().length,
    totalMemoryGB: Math.round(os.totalmem() / 1024 ** 3 * 10) / 10,
    nodeVersion: process.version, playwrightVersion: require("playwright/package.json").version };
}

async function launchBrowser(id, settings) {
  const definition = BROWSERS[id];
  return require("playwright")[definition.engine].launch({ headless: settings.headless,
    ...(definition.channel ? { channel: definition.channel } : {}) });
}

function validateMeasurement(suiteId, measurement) {
  const suite = CATALOG.find(item => item.id === suiteId);
  if (!measurement?.metrics || Object.keys(suite.metrics).some(key => !Number.isFinite(measurement.metrics[key]) || measurement.metrics[key] < 0)) {
    throw new Error(`Invalid or incomplete measurements from ${suiteId}.`);
  }
  return measurement;
}

async function runSample(browser, suiteId, fixtureUrl, settings, signal, measure = measureSuite) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 800 }, deviceScaleFactor: 1 });
  let timer, abort;
  try {
    const deadline = new Promise((resolve, reject) => {
      timer = setTimeout(() => reject(Object.assign(new Error(`Sample exceeded ${settings.timeoutMs} ms.`), { name: "TimeoutError" })), settings.timeoutMs);
      abort = () => reject(Object.assign(new Error("Run interrupted."), { name: "AbortError" }));
      signal?.addEventListener("abort", abort, { once: true });
      if (signal?.aborted) abort();
    });
    const result = await Promise.race([measure(suiteId, context, fixtureUrl, settings.scale), deadline]);
    return { status: "ok", ...validateMeasurement(suiteId, result) };
  } catch (error) {
    return { status: error.name === "TimeoutError" ? "timeout" : error.message.includes("UNSUPPORTED:") ? "unsupported" : "failed",
      message: error.message.slice(0, 1000), metrics: {} };
  } finally {
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
    await context.close().catch(() => {});
  }
}

async function runLab(options, dependencies = {}) {
  const store = dependencies.store || new RunStore(options.outputRoot);
  const currentEnvironment = environment();
  const settings = Object.fromEntries(["profile", "browsers", "suites", "runs", "warmup", "scale", "timeoutMs", "headless"].map(key => [key, options[key]]));
  const run = options.resume ? store.load(options.resume) : {
    id: `lab_${new Date().toISOString().replace(/[:.]/g, "-")}_${randomUUID().slice(0, 8)}`,
    schemaVersion: 1, workloadVersion: WORKLOAD_VERSION, startedAt: new Date().toISOString(),
    status: "running", settings, environment: currentEnvironment, browserVersions: {},
    catalog: CATALOG.filter(suite => options.suites.includes(suite.id)), samples: [], warmupErrors: [],
  };
  if (options.resume) {
    if (run.workloadVersion !== WORKLOAD_VERSION) throw new Error("Workload version changed. Start a new run to keep results comparable.");
    for (const key of ["platform", "arch", "osRelease", "cpuModel", "cpuCount", "nodeVersion", "playwrightVersion"]) {
      if (run.environment[key] !== currentEnvironment[key]) throw new Error(`Environment changed (${key}). Start a new run.`);
    }
  } else store.create(run);

  const release = store.acquire(run.id);

  const progress = dependencies.onProgress || (() => {});
  const signal = dependencies.signal;
  let fixture;
  const append = (browser, suite, iteration, result) => {
    const key = `${browser}/${suite}/${iteration}`;
    const attempt = run.samples.filter(sample => sample.key === key).length + 1;
    run.samples.push({ key, browser, suite, iteration, attempt, recordedAt: new Date().toISOString(), ...result });
    store.save(run);
    progress({ runId: run.id, browser, suite, iteration, ...result });
  };
  try {
    run.status = "running"; delete run.completedAt; delete run.lastError;
    store.save(run);
    dependencies.onStarted?.(run);
    fixture = await (dependencies.startFixture || startFixtureServer)();
    for (const browserId of run.settings.browsers) {
      if (signal?.aborted) break;
      const completed = new Set(latestSamples(run.samples).filter(sample => ["ok", "unsupported"].includes(sample.status)).map(sample => sample.key));
      const remaining = run.settings.suites.flatMap(suite => Array.from({ length: run.settings.runs }, (_, i) => ({ suite, iteration: i + 1 })))
        .filter(({ suite, iteration }) => !completed.has(`${browserId}/${suite}/${iteration}`));
      if (!remaining.length) continue;
      let browser;
      try {
        browser = await (dependencies.launchBrowser || launchBrowser)(browserId, run.settings);
        const version = browser.version();
        if (run.browserVersions[browserId] && run.browserVersions[browserId] !== version) {
          throw new Error("Browser version changed. Start a new run instead of mixing versions.");
        }
        run.browserVersions[browserId] = version;
        store.save(run);
        // Rotate suite order by browser to reduce a consistent first-suite bias.
        const suites = [...run.settings.suites];
        const rotation = run.settings.browsers.indexOf(browserId) % suites.length;
        suites.push(...suites.splice(0, rotation));
        for (const suite of suites) {
          const iterations = remaining.filter(item => item.suite === suite);
          if (!iterations.length || signal?.aborted) continue;
          for (let warmup = 0; warmup < run.settings.warmup && !signal?.aborted; warmup++) {
            const result = await runSample(browser, suite, fixture.url, run.settings, signal, dependencies.measureSuite);
            if (result.status !== "ok") {
              run.warmupErrors.push({ browser: browserId, suite, message: result.message, recordedAt: new Date().toISOString() });
              store.save(run); break;
            }
          }
          for (const { iteration } of iterations) {
            if (signal?.aborted) break;
            const result = await runSample(browser, suite, fixture.url, run.settings, signal, dependencies.measureSuite);
            if (signal?.aborted) break; // Interrupted samples are retried on resume.
            append(browserId, suite, iteration, result);
          }
        }
      } catch (error) {
        for (const { suite, iteration } of remaining) {
          if (signal?.aborted) break;
          const key = `${browserId}/${suite}/${iteration}`;
          if (run.samples.some(sample => sample.key === key && sample.status === "ok")) continue;
          append(browserId, suite, iteration, { status: "failed", metrics: {}, message: error.message.slice(0, 1000) });
        }
      } finally { if (browser) await browser.close().catch(() => {}); }
    }
    const counts = summarize(run).counts;
    run.status = signal?.aborted ? "interrupted" : counts.failed || counts.timeout || counts.pending ? "partial" : "completed";
    run.completedAt = new Date().toISOString();
    store.save(run); store.export(run);
    return run;
  } catch (error) {
    run.status = "interrupted"; run.lastError = error.message; store.save(run);
    throw error;
  } finally {
    try { if (fixture) await fixture.close(); } finally { release(); }
  }
}

module.exports = { runLab, runSample, validateMeasurement, environment };
