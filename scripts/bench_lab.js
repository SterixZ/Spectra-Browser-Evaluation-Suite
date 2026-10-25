const { parseOptions, HELP } = require("./lab/options");
const { CATALOG } = require("./lab/catalog");
const { runLab } = require("./lab/runner");
const { summarize } = require("./lab/store");

async function main() {
  const options = parseOptions(process.argv.slice(2));
  if (options.help) { console.log(HELP); return; }
  if (options.list) { console.table(CATALOG.map(({ id, name, description }) => ({ id, name, description }))); return; }
  const controller = new AbortController();
  const interrupt = () => controller.abort();
  process.once("SIGINT", interrupt); process.once("SIGTERM", interrupt);
  try {
    const run = await runLab(options, { signal: controller.signal, onProgress: sample => {
      console.log(`[${sample.browser}] ${sample.suite} #${sample.iteration}: ${sample.status}${sample.message ? ` — ${sample.message.split("\n")[0]}` : ""}`);
    } });
    const { counts } = summarize(run);
    console.log(`\n${run.status.toUpperCase()}: ${run.id}`);
    console.log(`${counts.ok}/${counts.planned} successful; ${counts.failed} failed; ${counts.timeout} timed out; ${counts.unsupported} unsupported.`);
    console.log(`Results: ${options.outputRoot}/${run.id}`);
    console.log(`Dashboard: http://127.0.0.1:3000/lab.html?run=${run.id}`);
    console.log(`Resume: npm run bench:lab -- --resume ${run.id}`);
    if (run.status !== "completed") process.exitCode = controller.signal.aborted ? 130 : 1;
  } finally {
    process.removeListener("SIGINT", interrupt); process.removeListener("SIGTERM", interrupt);
  }
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
