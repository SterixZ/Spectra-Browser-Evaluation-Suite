const { test, before, after } = require("node:test");
const assert = require("node:assert/strict");
const { once } = require("node:events");
const WebSocket = require("ws");
const { server, wss } = require("../dashboard/server");
let base;

before(async () => {
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  base = `http://127.0.0.1:${server.address().port}`;
});
after(async () => {
  for (const client of wss.clients) client.terminate();
  await new Promise(resolve => wss.close(resolve));
  await new Promise(resolve => server.close(resolve));
});

test("Dashboard assets and run discovery are served locally", async () => {
  for (const route of ["/", "/benchmark.html", "/theme.css", "/theme-toggle.js", "/chart.umd.min.js"]) {
    assert.equal((await fetch(base + route)).status, 200);
  }
  const result = await (await fetch(base + "/api/runs")).json();
  assert.ok(result.runs.includes("results_2026-08-22_22-29"));
  assert.ok(result.workloads.includes("workloads_2026-08-22_19-56"));
});

test("Benchmark and workload APIs expose matching sample data", async () => {
  const benchmark = await (await fetch(base + "/api/benchmark?dir=workloads_2026-08-22_19-56")).json();
  assert.equal(benchmark.data.summary.Chrome.cpu.n, 3);
  const workload = await (await fetch(base + "/api/workloads")).json();
  assert.ok(workload.data.raw.length > 0);
});

test("Unknown folders and traversal attempts fail without leaking files", async () => {
  for (const directory of ["../", "missing", "../../Windows"]) {
    const response = await fetch(base + `/api/benchmark?dir=${encodeURIComponent(directory)}`);
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /not found/);
  }
});

test("Malformed WebSocket commands do not crash the telemetry server", async () => {
  const client = new WebSocket(base.replace("http", "ws"));
  const firstMessage = once(client, "message");
  await once(client, "open");
  const [raw] = await firstMessage;
  assert.equal(JSON.parse(raw).type, "init");
  for (const input of ["null", "[]", "broken JSON", '{"action":"launch","browser":"Unknown"}']) client.send(input);
  client.ping();
  await once(client, "pong");
  assert.equal((await fetch(base + "/api/runs")).status, 200);
  client.close();
  await once(client, "close");
});
