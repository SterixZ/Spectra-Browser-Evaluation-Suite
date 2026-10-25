const fs = require("node:fs");
const path = require("node:path");

function archiveRunDirectory(directory, now = new Date()) {
  const source = path.resolve(directory);
  const prefix = path.basename(source);
  if (!["results", "workloads"].includes(prefix)) throw new Error("Only in-progress benchmark directories can be archived.");
  const pad = (value, length = 2) => String(value).padStart(length, "0");
  const timestamp = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}-${pad(now.getSeconds())}-${pad(now.getMilliseconds(), 3)}`;
  const parent = path.dirname(source);
  let destination = path.join(parent, `${prefix}_${timestamp}`), suffix = 0;
  while (fs.existsSync(destination)) destination = path.join(parent, `${prefix}_${timestamp}_${++suffix}`);
  fs.renameSync(source, destination);
  return destination;
}

module.exports = { archiveRunDirectory };
