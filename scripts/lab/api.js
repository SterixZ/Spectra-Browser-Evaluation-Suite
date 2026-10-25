const express = require("express");
const { CATALOG, BROWSERS, PROFILES } = require("./catalog");
const { RunStore, summarize, latestSamples, samplesCsv } = require("./store");
const { LabManager } = require("./manager");

function pageNumber(value, fallback, minimum, maximum) {
  if (value == null) return fallback;
  const number = Number(value);
  if (typeof value !== "string" || !Number.isInteger(number) || number < minimum || number > maximum) throw new Error("Invalid pagination.");
  return number;
}

function createLabRouter(store = new RunStore(), manager = new LabManager(store)) {
  const router = express.Router();
  router.get("/activity", (req, res) => res.json(manager.activity()));
  router.use((req, res, next) => {
    if (req.method !== "POST") return next();
    try {
      if (req.headers.origin && new URL(req.headers.origin).host !== req.headers.host) return res.status(403).json({ error: "Start tests from this dashboard." });
    } catch { return res.status(403).json({ error: "Invalid request origin." }); }
    if (!req.is("application/json")) return res.status(415).json({ error: "Test settings must be JSON." });
    next();
  });
  router.use(express.json({ limit: "8kb", strict: true }));
  const action = handler => async (req, res) => {
    try { res.status(202).json(await handler(req)); }
    catch (error) { res.status(error.status || 400).json({ error: error.message }); }
  };
  router.post("/runs", action(req => manager.start(req.body)));
  router.post("/runs/:id/resume", action(req => manager.resume(req.params.id)));
  router.post("/runs/:id/stop", action(req => manager.stop(req.params.id)));
  router.get("/catalog", (req, res) => res.json({ suites: CATALOG, browsers: BROWSERS, profiles: PROFILES }));
  router.get("/runs", (req, res) => {
    try {
      const offset = pageNumber(req.query.offset, 0, 0, 1000000);
      const limit = pageNumber(req.query.limit, 50, 1, 200);
      const runs = store.list();
      res.json({ runs: runs.slice(offset, offset + limit), total: runs.length, offset, limit });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.get("/runs/:id/csv", (req, res) => {
    try {
      const run = store.load(req.params.id);
      res.set("Content-Disposition", `attachment; filename="${run.id}.csv"`);
      res.type("text/csv").send(samplesCsv(run));
    } catch { res.status(404).json({ error: "Lab run not found." }); }
  });
  router.get("/runs/:id", (req, res) => {
    let run;
    try { run = store.load(req.params.id); }
    catch { return res.status(404).json({ error: "Lab run not found." }); }
    try {
      const offset = pageNumber(req.query.offset, 0, 0, 1000000);
      const limit = pageNumber(req.query.limit, 100, 1, 200);
      if (req.query.suite && !run.settings.suites.includes(req.query.suite)) return res.status(400).json({ error: "Unknown suite filter." });
      if (req.query.browser && !run.settings.browsers.includes(req.query.browser)) return res.status(400).json({ error: "Unknown browser filter." });
      const samples = latestSamples(run.samples).filter(sample => (!req.query.suite || sample.suite === req.query.suite) && (!req.query.browser || sample.browser === req.query.browser));
      const { samples: attempts, ...metadata } = run;
      res.json({ run: metadata, ...summarize(run), samples: samples.slice(offset, offset + limit),
        pagination: { offset, limit, total: samples.length, attempts: attempts.length } });
    } catch (error) { res.status(400).json({ error: error.message }); }
  });
  router.use((error, req, res, next) => res.status(error.status || 400).json({ error: "The test settings could not be read. Choose valid settings and try again." }));
  router.labManager = manager;
  return router;
}

module.exports = { createLabRouter, pageNumber };
