const express = require("express");
const { CATALOG, BROWSERS, PROFILES } = require("./catalog");
const { RunStore, summarize, latestSamples, samplesCsv } = require("./store");

function pageNumber(value, fallback, minimum, maximum) {
  if (value == null) return fallback;
  const number = Number(value);
  if (typeof value !== "string" || !Number.isInteger(number) || number < minimum || number > maximum) throw new Error("Invalid pagination.");
  return number;
}

function createLabRouter(store = new RunStore()) {
  const router = express.Router();
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
  return router;
}

module.exports = { createLabRouter, pageNumber };
