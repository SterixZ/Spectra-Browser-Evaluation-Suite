// These functions execute inside an isolated browser page; keep them self-contained.
const PAGE_CASES = {
  javascript: scale => {
    let seed = 1729;
    const values = Array.from({ length: 20000 * scale }, () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; });
    let started = performance.now();
    values.sort((a, b) => a - b);
    const sortMs = Math.max(0.001, performance.now() - started);
    if (values.some((value, i) => i > 0 && value < values[i - 1])) throw new Error("Sort verification failed.");
    const records = Array.from({ length: 5000 * scale }, (_, i) => ({ id: i, name: `item-${i}`, active: i % 2 === 0, values: [i, i + 1, i + 2] }));
    started = performance.now();
    const restored = JSON.parse(JSON.stringify(records));
    const jsonMs = Math.max(0.001, performance.now() - started);
    if (restored.length !== records.length || restored.at(-1).id !== records.length - 1) throw new Error("JSON verification failed.");
    started = performance.now();
    let checksum = 1729;
    for (let i = 0; i < 1000000 * scale; i++) checksum = (Math.imul(checksum ^ i, 16777619) + i) >>> 0;
    const computeMs = Math.max(0.001, performance.now() - started);
    return { metrics: { sortMs, jsonMs, computeMs }, details: { arrayItems: values.length, records: records.length, checksum } };
  },
  dom: scale => {
    const container = document.getElementById("fixture");
    container.replaceChildren();
    const count = 1000 * scale;
    let started = performance.now();
    const fragment = document.createDocumentFragment();
    for (let i = 0; i < count; i++) {
      const node = document.createElement("div"); node.className = "item";
      node.textContent = `Node ${i}`; fragment.append(node);
    }
    container.append(fragment);
    const initialHeight = container.getBoundingClientRect().height;
    const insertMs = Math.max(0.001, performance.now() - started);
    started = performance.now();
    for (let i = 0; i < count; i += 2) container.children[i].style.padding = `${i % 5 + 3}px`;
    const updatedHeight = container.getBoundingClientRect().height;
    const updateMs = Math.max(0.001, performance.now() - started);
    started = performance.now();
    let matches = 0;
    for (let i = 0; i < 30; i++) matches += container.querySelectorAll(".item:nth-child(2n)").length;
    const queryMs = Math.max(0.001, performance.now() - started);
    if (container.children.length !== count || matches !== count / 2 * 30) throw new Error("DOM verification failed.");
    return { metrics: { insertMs, updateMs, queryMs }, details: { nodes: count, initialHeight, updatedHeight } };
  },
  canvas: scale => {
    const canvas = document.createElement("canvas"); canvas.width = 800; canvas.height = 600;
    document.getElementById("fixture").replaceChildren(canvas);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("UNSUPPORTED: Canvas 2D unavailable.");
    const shapes = 5000 * scale;
    let started = performance.now();
    for (let i = 0; i < shapes; i++) {
      context.fillStyle = `rgb(${i % 256},${i * 7 % 256},${i * 13 % 256})`;
      context.fillRect(i * 17 % 780, i * 23 % 580, 20, 20);
    }
    context.getImageData(0, 0, 1, 1); // Synchronize deferred drawing before stopping the timer.
    const drawMs = Math.max(0.001, performance.now() - started);
    started = performance.now();
    const pixels = context.getImageData(0, 0, 800, 600);
    const readbackMs = Math.max(0.001, performance.now() - started);
    if (pixels.data.length !== 800 * 600 * 4) throw new Error("Canvas readback verification failed.");
    return { metrics: { drawMs, readbackMs, shapesPerSecond: shapes * 1000 / drawMs }, details: { shapes, width: 800, height: 600 } };
  },
  crypto: async scale => {
    if (!globalThis.crypto?.subtle) throw new Error("UNSUPPORTED: Web Crypto unavailable.");
    const bytes = new Uint8Array(1024 * 1024 * scale);
    for (let i = 0; i < bytes.length; i++) bytes[i] = (i * 31 + 17) % 256;
    const repetitions = 5;
    const started = performance.now();
    let digest;
    for (let i = 0; i < repetitions; i++) digest = await crypto.subtle.digest("SHA-256", bytes);
    const digestMs = Math.max(0.001, performance.now() - started);
    if (digest.byteLength !== 32) throw new Error("Digest verification failed.");
    return { metrics: { digestMs, megabytesPerSecond: scale * repetitions * 1000 / digestMs }, details: { payloadBytes: bytes.length, repetitions } };
  },
  storage: async scale => {
    if (!globalThis.indexedDB) throw new Error("UNSUPPORTED: IndexedDB unavailable.");
    const db = await new Promise((resolve, reject) => {
      const request = indexedDB.open("spectra-lab-v1", 1);
      request.onupgradeneeded = () => request.result.createObjectStore("records");
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
      request.onblocked = () => reject(new Error("Database open blocked."));
    });
    try {
      const count = 500 * scale;
      const payload = "spectra-".repeat(64);
      let started = performance.now();
      await new Promise((resolve, reject) => {
        const transaction = db.transaction("records", "readwrite");
        const store = transaction.objectStore("records");
        for (let i = 0; i < count; i++) store.put({ id: i, payload }, i);
        transaction.oncomplete = resolve;
        transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("Write transaction aborted."));
      });
      const writeMs = Math.max(0.001, performance.now() - started);
      started = performance.now();
      const records = await new Promise((resolve, reject) => {
        const transaction = db.transaction("records", "readonly");
        const request = transaction.objectStore("records").getAll();
        transaction.oncomplete = () => resolve(request.result);
        transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error("Read transaction aborted."));
      });
      const readMs = Math.max(0.001, performance.now() - started);
      if (records.length !== count || records.at(-1).id !== count - 1) throw new Error("Storage verification failed.");
      return { metrics: { writeMs, readMs, recordsPerSecond: count * 1000 / writeMs }, details: { records: count, payloadCharacters: payload.length } };
    } finally { db.close(); }
  },
  network: async scale => {
    const repetitions = 5 * scale;
    const payloadBytes = 256 * 1024;
    const fetchAndVerify = async url => {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Fixture returned HTTP ${response.status}.`);
      const bytes = new Uint8Array(await response.arrayBuffer());
      if (bytes.length !== payloadBytes || bytes[0] !== 17 || bytes[1] !== 48) throw new Error("Network payload verification failed.");
    };
    let started = performance.now();
    for (let i = 0; i < repetitions; i++) await fetchAndVerify(`/payload?kb=256&sample=${i}`);
    const uncachedMs = Math.max(0.001, performance.now() - started);
    await fetchAndVerify("/payload?kb=256&cached=1");
    started = performance.now();
    for (let i = 0; i < repetitions; i++) await fetchAndVerify("/payload?kb=256&cached=1");
    const cachedMs = Math.max(0.001, performance.now() - started);
    return { metrics: { uncachedMs, cachedMs, megabytesPerSecond: repetitions * 0.25 * 1000 / uncachedMs }, details: { repetitions, payloadBytes, transport: "loopback HTTP", cacheNote: "Cacheable requests; cache hit is browser-dependent." } };
  },
};

async function measureSuite(suiteId, context, fixtureUrl, scale) {
  const page = await context.newPage();
  await page.goto(fixtureUrl, { waitUntil: "load" });
  if (suiteId !== "tabs") return page.evaluate(PAGE_CASES[suiteId], scale);
  const { performance } = require("node:perf_hooks");
  const tabs = Math.min(16, 2 * scale);
  await page.close();
  const started = performance.now();
  // All promises settle before the context is closed, including failed navigations.
  const results = await Promise.allSettled(Array.from({ length: tabs }, async () => {
    const tab = await context.newPage();
    await tab.goto(fixtureUrl, { waitUntil: "load" });
    if (await tab.locator("#fixture p").count() !== 200) throw new Error("Tab fixture verification failed.");
  }));
  const failure = results.find(result => result.status === "rejected");
  if (failure) throw failure.reason;
  const totalMs = Math.max(0.001, performance.now() - started);
  return { metrics: { totalMs, perTabMs: totalMs / tabs, tabsPerSecond: tabs * 1000 / totalMs }, details: { tabs } };
}

module.exports = { PAGE_CASES, measureSuite };
