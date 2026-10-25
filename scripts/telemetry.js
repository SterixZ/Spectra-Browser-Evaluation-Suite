const { execFile } = require("node:child_process");
const { promisify } = require("node:util");
const execFileAsync = promisify(execFile);

async function sampleProcess(processName) {
  if (!["chrome", "msedge", "firefox"].includes(processName)) throw new Error("Unknown browser process.");
  if (process.platform !== "win32") return { cpuSeconds: 0, memoryMB: 0 };
  const script = `$items = @(Get-Process -Name ${processName} -ErrorAction SilentlyContinue); @{ cpuSeconds = [double](($items | Measure-Object CPU -Sum).Sum); memoryMB = [double](($items | Measure-Object WorkingSet64 -Sum).Sum) / 1MB } | ConvertTo-Json -Compress`;
  const { stdout } = await execFileAsync("powershell.exe", ["-NoProfile", "-NonInteractive", "-Command", script], {
    windowsHide: true, timeout: 8000,
  });
  return JSON.parse(stdout);
}

module.exports = { sampleProcess };
