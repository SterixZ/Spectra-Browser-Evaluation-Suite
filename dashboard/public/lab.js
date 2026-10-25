(() => {
  const byId = id => document.getElementById(id);
  const state = { catalog: null, data: null, chart: null, controller: null, sampleOffset: 0, runOffset: 0, runTotal: 0 };
  const colors = ["#6366f1", "#0284c7", "#f97316", "#10b981", "#a855f7"];
  const format = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
  const browserName = id => state.catalog.browsers[id]?.name || id;
  function status(message = "", error = false) {
    byId("labStatus").textContent = message; byId("labStatus").hidden = !message;
    byId("labStatus").classList.toggle("error", error);
  }
  async function json(url, signal) {
    const response = await fetch(url, { signal, cache: "no-store" });
    if (!response.ok) throw new Error((await response.json()).error || "Results could not be loaded.");
    return response.json();
  }
  function options(select, entries, selected) {
    select.replaceChildren(...entries.map(([value, label]) => new Option(label, value)));
    if (entries.some(([value]) => value === selected)) select.value = selected;
  }
  function row(values, className = "") {
    const tr = document.createElement("tr");
    values.forEach(value => { const td = document.createElement("td"); td.textContent = value; tr.append(td); });
    if (className) tr.className = className;
    return tr;
  }
  function checked(id) { return [...byId(id).querySelectorAll("input:checked")].map(input => input.value); }
  function updatePlan() {
    const browsers = checked("planBrowsers"), suites = checked("planSuites");
    const runs = Number(byId("planRuns").value), scale = Number(byId("planScale").value), warmup = Number(byId("planWarmup").value);
    const valid = browsers.length && suites.length && Number.isInteger(runs) && runs >= 1 && runs <= 100 && Number.isInteger(scale) && scale >= 1 && scale <= 20 && Number.isInteger(warmup) && warmup >= 0 && warmup <= 10;
    byId("planCommand").value = valid ? `npm run bench:lab -- --profile ${byId("planProfile").value} --browsers ${browsers.join(",")} --suites ${suites.join(",")} --runs ${runs} --scale ${scale} --warmup ${warmup}${byId("planHeaded").checked ? " --headed" : ""}` : "Select at least one browser and suite, and enter settings within the displayed limits.";
    byId("planEstimate").textContent = valid ? `${browsers.length * suites.length * runs} measured samples + ${browsers.length * suites.length * warmup} warmups. Browsers run sequentially; multi-tab concurrency stays inside its own workload.` : "Complete the settings to build a command.";
    byId("copyCommand").disabled = !valid;
  }
  function setupPlanner() {
    function checks(container, entries, selected) {
      byId(container).replaceChildren(...entries.map(([value, name]) => {
        const label = document.createElement("label"); label.className = "lab-checkbox";
        const input = document.createElement("input"); input.type = "checkbox"; input.value = value; input.checked = selected.includes(value);
        label.append(input, document.createTextNode(name)); return label;
      }));
    }
    checks("planBrowsers", Object.entries(state.catalog.browsers).map(([id, browser]) => [id, browser.name]), ["chrome", "edge", "firefox"]);
    checks("planSuites", state.catalog.suites.map(suite => [suite.id, suite.name]), state.catalog.suites.map(suite => suite.id));
    byId("planner").addEventListener("input", updatePlan);
    byId("planProfile").addEventListener("change", () => {
      const profile = state.catalog.profiles[byId("planProfile").value];
      byId("planRuns").value = profile.runs; byId("planScale").value = profile.scale; updatePlan();
    });
    byId("copyCommand").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(byId("planCommand").value); byId("copyStatus").textContent = "Copied."; }
      catch { byId("planCommand").focus(); byId("planCommand").select(); byId("copyStatus").textContent = "Select and copy the command above."; }
    });
    updatePlan();
  }
  async function refreshRuns(preferred) {
    try {
      const data = await json(`/api/lab/runs?offset=${state.runOffset}&limit=50`);
      state.runTotal = data.total;
      const selected = preferred || byId("labRun").value;
      const entries = data.runs.map(run => [run.id, `${new Date(run.startedAt).toLocaleString()} · ${run.profile} · ${run.status}`]);
      if (selected && !entries.some(([id]) => id === selected)) entries.unshift([selected, selected]);
      options(byId("labRun"), entries, selected);
      byId("newerRuns").disabled = state.runOffset === 0;
      byId("olderRuns").disabled = state.runOffset + 50 >= data.total;
      byId("runRange").textContent = data.total ? `${state.runOffset + 1}–${Math.min(state.runOffset + 50, data.total)} of ${data.total} runs` : "No saved experiments";
      byId("emptyLab").hidden = !!entries.length; byId("labRun").disabled = !entries.length;
      if (!entries.length) { byId("experiment").hidden = true; byId("planner").open = true; return; }
      state.sampleOffset = 0;
      await loadRun();
    } catch (error) { status(error.message, true); }
  }
  async function loadRun() {
    if (!byId("labRun").value) return;
    state.controller?.abort();
    const controller = new AbortController(); state.controller = controller;
    const runId = byId("labRun").value;
    const query = new URLSearchParams({ offset: state.sampleOffset, limit: 100 });
    if (byId("browserFilter").value) query.set("browser", byId("browserFilter").value);
    byId("experiment").setAttribute("aria-busy", "true");
    try {
      const data = await json(`/api/lab/runs/${encodeURIComponent(runId)}?${query}`, controller.signal);
      if (controller.signal.aborted) return;
      const previousRun = state.data?.run.id;
      state.data = data;
      if (previousRun !== data.run.id) {
        options(byId("suiteSelect"), data.run.catalog.map(suite => [suite.id, suite.name]));
        options(byId("browserFilter"), [["", "All browsers"], ...data.run.settings.browsers.map(id => [id, browserName(id)])]);
        metricOptions();
      }
      renderRun(); renderComparison(); renderSamples();
      byId("experiment").hidden = false; byId("emptyLab").hidden = true;
      const url = new URL(window.location); url.searchParams.set("run", runId); history.replaceState({}, "", url);
      const issues = data.counts.failed + data.counts.timeout;
      status(issues ? `${issues} sample(s) failed or timed out. Fix the cause, then resume with: npm run bench:lab -- --resume ${runId}` : data.run.status === "running" ? "Experiment in progress. Results refresh automatically." : "", !!issues);
    } catch (error) { if (error.name !== "AbortError") status(error.message, true); }
    finally { if (state.controller === controller) byId("experiment").setAttribute("aria-busy", "false"); }
  }
  function renderRun() {
    const { run, counts } = state.data, settings = run.settings, env = run.environment;
    byId("runStatus").textContent = run.status.toUpperCase();
    byId("sampleCount").textContent = `${counts.ok} / ${counts.planned}`;
    byId("pendingCount").textContent = `${counts.pending} pending`;
    byId("browserCount").textContent = settings.browsers.length;
    byId("browserNames").textContent = settings.browsers.map(browserName).join(" · ");
    byId("suiteCount").textContent = settings.suites.length;
    byId("workScale").textContent = `${settings.profile} · ${settings.scale}× workload`;
    byId("failureCount").textContent = counts.failed + counts.timeout;
    byId("unsupportedCount").textContent = `${counts.unsupported} unsupported`;
    byId("experimentInfo").textContent = `${new Date(run.startedAt).toLocaleString()} · ${settings.headless ? "Headless" : "Headed"} · ${settings.runs} measured samples · ${settings.warmup} warmups per suite · workload revision ${run.workloadVersion}`;
    byId("machineInfo").textContent = `${env.platform} ${env.arch} · ${env.cpuModel} · ${env.cpuCount} logical cores · ${env.totalMemoryGB} GB RAM`;
    byId("versionsInfo").textContent = Object.entries(run.browserVersions).map(([browser, version]) => `${browserName(browser)} ${version}`).join(" · ");
    byId("downloadCsv").href = `/api/lab/runs/${encodeURIComponent(run.id)}/csv`;
  }
  function metricOptions() {
    const suite = state.data.run.catalog.find(item => item.id === byId("suiteSelect").value);
    options(byId("metricSelect"), Object.entries(suite.metrics).map(([id, metric]) => [id, metric[0]]));
  }
  function renderComparison() {
    const suite = state.data.run.catalog.find(item => item.id === byId("suiteSelect").value);
    const metricId = byId("metricSelect").value, metric = suite.metrics[metricId];
    const summary = state.data.summary.filter(item => item.suite === suite.id);
    byId("suiteDescription").textContent = suite.description;
    byId("labSummary").replaceChildren(...summary.map(item => row([browserName(item.browser), item.label,
      `${format(item.mean)} ${item.unit}`, item.ci95 == null ? "Not enough samples" : `${format(item.ci95)} ${item.unit}`,
      format(item.median), format(item.p95), item.n])));
    if (!summary.length) byId("labSummary").replaceChildren(row(["No successful observations for this suite."]));
    byId("chartDescription").textContent = `${metric[0]} (${metric[1]}) · ${metric[2] === "lower" ? "Lower" : "Higher"} is better · bars show arithmetic means.`;
    const values = summary.filter(item => item.metric === metricId);
    if (state.chart) { state.chart.destroy(); state.chart = null; }
    byId("labChart").hidden = !values.length; byId("chartEmpty").hidden = !!values.length;
    if (!values.length || typeof Chart === "undefined") return;
    const text = getComputedStyle(document.documentElement).getPropertyValue("--muted").trim();
    state.chart = new Chart(byId("labChart"), { type: "bar",
      data: { labels: values.map(item => browserName(item.browser)), datasets: [{ label: metric[0], data: values.map(item => item.mean), backgroundColor: colors, borderRadius: 6 }] },
      options: { responsive: true, maintainAspectRatio: false, animation: false,
        plugins: { legend: { display: false }, tooltip: { callbacks: { label: context => `${format(context.parsed.y)} ${metric[1]}` } } },
        scales: { x: { ticks: { color: text }, grid: { display: false } }, y: { beginAtZero: true, ticks: { color: text }, title: { display: true, text: metric[1], color: text } } } } });
  }
  function renderSamples() {
    const { samples, pagination } = state.data;
    byId("labSamples").replaceChildren(...samples.map(sample => row([browserName(sample.browser), sample.suite,
      sample.iteration, sample.attempt, sample.status,
      sample.status === "ok" ? Object.entries(sample.metrics).map(([name, value]) => `${name}: ${format(value)}`).join(" · ") : sample.message || "Unavailable"], `sample-${sample.status}`)));
    if (!samples.length) byId("labSamples").replaceChildren(row(["No samples match this filter."]));
    byId("previousSamples").disabled = pagination.offset === 0;
    byId("nextSamples").disabled = pagination.offset + pagination.limit >= pagination.total;
    byId("sampleRange").textContent = pagination.total ? `${pagination.offset + 1}–${Math.min(pagination.offset + pagination.limit, pagination.total)} of ${pagination.total} samples` : "0 samples";
  }
  async function init() {
    try {
      state.catalog = await json("/api/lab/catalog"); setupPlanner();
      byId("refreshRuns").addEventListener("click", () => refreshRuns());
      byId("labRun").addEventListener("change", () => { state.sampleOffset = 0; byId("browserFilter").value = ""; loadRun(); });
      byId("suiteSelect").addEventListener("change", () => { metricOptions(); renderComparison(); });
      byId("metricSelect").addEventListener("change", renderComparison);
      byId("browserFilter").addEventListener("change", () => { state.sampleOffset = 0; loadRun(); });
      byId("previousSamples").addEventListener("click", () => { state.sampleOffset = Math.max(0, state.sampleOffset - 100); loadRun(); });
      byId("nextSamples").addEventListener("click", () => { state.sampleOffset += 100; loadRun(); });
      for (const [id, delta] of [["newerRuns", -50], ["olderRuns", 50]]) byId(id).addEventListener("click", () => { state.runOffset += delta; byId("labRun").replaceChildren(); refreshRuns(); });
      window.onThemeChange = () => { if (state.data) renderComparison(); };
      await refreshRuns(new URLSearchParams(location.search).get("run"));
      setInterval(() => { if (state.data?.run.status === "running" && !document.hidden) loadRun(); }, 5000);
    } catch (error) { status(error.message, true); }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
