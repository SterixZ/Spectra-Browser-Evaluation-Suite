const path = require("node:path");
const { CATALOG, BROWSERS, PROFILES } = require("./catalog");

function integer(value, label, minimum, maximum) {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new Error(`${label} must be an integer between ${minimum} and ${maximum}.`);
  }
  return number;
}

function selection(value, allowed, label) {
  const selected = value.split(",").map(item => item.trim().toLowerCase());
  if (!selected.length || selected.some(item => !allowed.includes(item))) throw new Error(`Invalid ${label}. Choose from: ${allowed.join(", ")}.`);
  return [...new Set(selected)];
}

function resultsRoot(env = process.env) {
  return path.resolve(env.SPECTRA_RESULTS_DIR || path.join(__dirname, "../../lab-results"));
}

function parseOptions(args, env = process.env) {
  const values = {};
  const flags = new Set(["headless", "headed", "list", "help"]);
  const options = new Set(["profile", "browsers", "suites", "runs", "warmup", "scale", "timeout", "resume"]);
  for (let i = 0; i < args.length; i++) {
    const name = args[i].replace(/^--/, "");
    if (!args[i].startsWith("--") || (!flags.has(name) && !options.has(name))) throw new Error(`Unknown option: ${args[i]}`);
    if (name in values) throw new Error(`Repeated option: --${name}`);
    if (flags.has(name)) values[name] = true;
    else {
      if (args[i + 1] == null || args[i + 1].startsWith("--")) throw new Error(`--${name} requires a value.`);
      values[name] = args[++i];
    }
  }
  if (values.headless && values.headed) throw new Error("Choose --headless or --headed.");
  if (values.resume && Object.keys(values).some(key => key !== "resume")) throw new Error("Resume uses the saved settings; use --resume <run-id> by itself.");
  if (values.resume && !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,100}$/.test(values.resume)) throw new Error("Invalid run ID.");
  const profile = values.profile || "quick";
  if (!Object.hasOwn(PROFILES, profile)) throw new Error("Profile must be quick, standard, or stress.");
  const defaults = PROFILES[profile];
  return {
    profile, browsers: selection(values.browsers || "chrome,edge,firefox", Object.keys(BROWSERS), "browsers"),
    suites: selection(values.suites || CATALOG.map(suite => suite.id).join(","), CATALOG.map(suite => suite.id), "suites"),
    runs: integer(values.runs ?? defaults.runs, "Runs", 1, 100),
    warmup: integer(values.warmup ?? 1, "Warmup", 0, 10),
    scale: integer(values.scale ?? defaults.scale, "Scale", 1, 20),
    timeoutMs: integer(values.timeout ?? 30000, "Timeout", 1000, 300000),
    headless: !values.headed, outputRoot: resultsRoot(env),
    resume: values.resume, list: !!values.list, help: !!values.help,
  };
}

const HELP = `Spectra Benchmark Lab
Usage: npm run bench:lab -- [options]
  --profile quick|standard|stress    Default: quick
  --browsers chrome,edge,firefox      Also supports chromium and webkit
  --suites javascript,dom,canvas,crypto,storage,network,tabs
  --runs 1..100                      Measured samples per suite/browser
  --warmup 0..10                     Unmeasured samples (default: 1)
  --scale 1..20                      Work size multiplier
  --timeout 1000..300000              Per-sample timeout in milliseconds
  --headless | --headed              Default: headless
  --resume <run-id>                  Retry failures and unfinished samples
  --list                            List suites without starting browsers
Set SPECTRA_RESULTS_DIR to change the output directory for both CLI and dashboard.
Browser runs execute sequentially to avoid contaminating each other's timings.`;

module.exports = { parseOptions, integer, resultsRoot, HELP };
