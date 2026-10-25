const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const { spawnSync } = require("node:child_process");

const root = path.resolve(__dirname, "..");
let count = 0;
for (const directory of ["scripts", "dashboard", "test"]) {
  for (const entry of fs.readdirSync(path.join(root, directory), { recursive: true })) {
    const filename = path.join(root, directory, entry);
    if (filename.endsWith(".js") && !filename.endsWith("chart.umd.min.js")) {
      const result = spawnSync(process.execPath, ["--check", filename], { encoding: "utf8" });
      if (result.status !== 0) throw new Error(result.stderr);
      count++;
    } else if (filename.endsWith(".html")) {
      const text = fs.readFileSync(filename, "utf8");
      for (const [, attributes, script] of text.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
        if (!attributes.includes("src=")) new vm.Script(script, { filename });
      }
      count++;
    }
  }
}
console.log(`Syntax checked ${count} source files, including inline dashboard scripts.`);
