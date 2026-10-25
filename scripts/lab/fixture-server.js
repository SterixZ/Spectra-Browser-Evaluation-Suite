const http = require("node:http");
const { once } = require("node:events");

const DOCUMENT = `<!doctype html><html lang="en"><meta charset="utf-8"><title>Spectra local fixture</title>
<style>body{font:14px system-ui;margin:24px}#fixture{width:800px}.item{display:inline-block;padding:2px;border:1px solid #ddd}</style>
<h1>Spectra controlled workload</h1><main id="fixture"></main>
<script>const fragment=document.createDocumentFragment();for(let i=0;i<200;i++){const p=document.createElement('p');p.textContent='Fixture row '+i;fragment.append(p)}document.getElementById('fixture').append(fragment);</script></html>`;

async function startFixtureServer() {
  const payload = Buffer.alloc(1024 * 1024);
  for (let i = 0; i < payload.length; i++) payload[i] = (i * 31 + 17) % 256;
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, "http://localhost");
    if (url.pathname === "/payload") {
      const kilobytes = Number(url.searchParams.get("kb") || 256);
      if (!Number.isInteger(kilobytes) || kilobytes < 1 || kilobytes > 1024) { res.writeHead(400).end(); return; }
      const bytes = kilobytes * 1024;
      res.writeHead(200, { "Content-Type": "application/octet-stream", "Content-Length": bytes,
        "Cache-Control": url.searchParams.has("cached") ? "public, max-age=3600" : "no-store" });
      res.end(payload.subarray(0, bytes));
    } else if (url.pathname === "/" || url.pathname === "/fixture") {
      res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
      res.end(DOCUMENT);
    } else res.writeHead(404).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return { url: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

module.exports = { startFixtureServer };
