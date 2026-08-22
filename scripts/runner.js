const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const { RESULTS_DIR } = require("./config");

const PROJECT_ROOT = path.dirname(RESULTS_DIR);

if (fs.existsSync(RESULTS_DIR)) {
  fs.rmSync(RESULTS_DIR, { recursive: true, force: true });
}
fs.mkdirSync(RESULTS_DIR, { recursive: true });

console.log(`\n=============================================`);
console.log(`🚀 STARTING FULL BROWSER BENCHMARK`);
console.log(`=============================================\n`);

try {
  execSync(`node "${path.join(__dirname, "full_benchmark.js")}"`, {
    stdio: "inherit",
    cwd: __dirname,
  });
} catch (error) {
  console.error(`\n❌ Benchmark failed.`);
  process.exit(1);
}

const date = new Date();
const timestamp = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(
  date.getDate()
).padStart(2, "0")}_${String(date.getHours()).padStart(2, "0")}-${String(date.getMinutes()).padStart(
  2,
  "0"
)}`;

const timestampedDir = path.join(PROJECT_ROOT, `results_${timestamp}`);

if (fs.existsSync(RESULTS_DIR)) {
  fs.renameSync(RESULTS_DIR, timestampedDir);

  console.log(`\n=============================================`);
  console.log(`✅ BENCHMARK COMPLETE!`);
  console.log(`📁 All data saved to: ${timestampedDir}`);
  console.log(`=============================================\n`);

  console.log(`Run "npm run analyze -- ${path.basename(timestampedDir)}" for summary stats.`);
}
