(() => {
  const byId = id => document.getElementById(id);
  const state = { catalog: null, data: null, controller: null, sampleOffset: 0, runOffset: 0, activity: null, busy: false, polling: false };
  const palette = { chrome: "#d89b24", edge: "#19a58c", firefox: "#ed7945", chromium: "#5185da", webkit: "#8e79c8" };
  const icons = { javascript: "{ }", dom: "▤", canvas: "◈", crypto: "◇", storage: "▱", network: "⇄", tabs: "▣" };
  const names = { javascript: "JavaScript", dom: "Pages & layout", canvas: "Graphics", crypto: "Encryption", storage: "Local storage", network: "Network & cache", tabs: "Multiple tabs" };
  const profiles = { quick: "Quick check", standard: "Balanced", stress: "Stress test" };
  const format = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "—";
  const browserName = id => state.catalog?.browsers[id]?.name || id;
  const groupName = id => names[id] || id;
  const date = value => new Date(value).toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  function element(tag, text, className) { const node = document.createElement(tag); if (text != null) node.textContent = text; if (className) node.className = className; return node; }
  function dot(browser) { const node = element("span", "", "browser-dot"); node.style.setProperty("--browser-color", palette[browser] || "#6b7280"); return node; }
  function status(message = "", error = false) { byId("labStatus").textContent = message; byId("labStatus").hidden = !message; byId("labStatus").classList.toggle("error", error); }
  async function json(url, signal, body) {
    const response = await fetch(url, { signal, cache: "no-store", ...(body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
    const data = await response.json(); if (!response.ok) throw new Error(data.error || "The request could not be completed. Try again."); return data;
  }
  function options(select, entries, selected) { select.replaceChildren(...entries.map(([value, label]) => new Option(label, value))); if (entries.some(([value]) => value === selected)) select.value = selected; }
  function row(values, className) { const tr = element("tr", null, className); values.forEach(value => tr.append(element("td", value))); return tr; }
  function checked(id) { return [...byId(id).querySelectorAll("input:checked")].map(input => input.value); }
  function planSettings() { return { profile: byId("planProfile").value, browsers: checked("planBrowsers"), suites: checked("planSuites"), runs: Number(byId("planRuns").value), scale: Number(byId("planScale").value), warmup: Number(byId("planWarmup").value), headless: !byId("planHeaded").checked }; }
  function updatePlan() {
    const p = planSettings();
    const valid = p.browsers.length && p.suites.length && Number.isInteger(p.runs) && p.runs >= 1 && p.runs <= 100 && Number.isInteger(p.scale) && p.scale >= 1 && p.scale <= 20 && Number.isInteger(p.warmup) && p.warmup >= 0 && p.warmup <= 10;
    byId("planCommand").value = valid ? `npm run bench:lab -- --profile ${p.profile} --browsers ${p.browsers.join(",")} --suites ${p.suites.join(",")} --runs ${p.runs} --scale ${p.scale} --warmup ${p.warmup}${p.headless ? "" : " --headed"}` : "Choose at least one browser and test group, and valid advanced settings.";
    byId("planEstimate").textContent = valid ? `${p.browsers.length} browser${p.browsers.length === 1 ? "" : "s"} · ${p.suites.length} test groups · ${p.browsers.length * p.suites.length * p.runs} checks` : "Choose your browsers and test groups.";
    byId("startTest").textContent = state.busy ? "Starting…" : "Start test →";
    byId("copyCommand").disabled = !valid; byId("startTest").disabled = !valid || state.busy || !!state.activity;
  }
  function openPlanner(compare = false) {
    if (compare && state.data) {
      const settings = state.data.run.settings;
      const browsers = new Set(settings.browsers);
      if (browsers.size < 2) browsers.add(Object.keys(state.catalog.browsers).find(id => !browsers.has(id)));
      byId("planBrowsers").querySelectorAll("input").forEach(input => input.checked = browsers.has(input.value));
      byId("planSuites").querySelectorAll("input").forEach(input => input.checked = settings.suites.includes(input.value));
      byId("planProfile").value = settings.profile; byId("planRuns").value = settings.runs; byId("planScale").value = settings.scale; byId("planWarmup").value = settings.warmup; byId("planHeaded").checked = !settings.headless;
    }
    byId("plannerError").hidden = true; updatePlan(); byId("planner").showModal();
  }
  function setupPlanner() {
    for (const [container, entries, selected] of [["planBrowsers", Object.entries(state.catalog.browsers).map(([id, browser]) => [id, browser.name]), ["chrome", "edge", "firefox"]], ["planSuites", state.catalog.suites.map(suite => [suite.id, groupName(suite.id)]), state.catalog.suites.map(suite => suite.id)]]) {
      byId(container).replaceChildren(...entries.map(([id, label]) => {
        const node = element("label", null, container === "planBrowsers" ? "browser-choice" : "lab-checkbox"); const input = element("input"); input.type = "checkbox"; input.value = id; input.checked = selected.includes(id);
        node.append(input); if (container === "planBrowsers") node.append(dot(id)); node.append(document.createTextNode(label)); return node;
      }));
    }
    byId("planner").addEventListener("input", updatePlan);
    byId("planProfile").addEventListener("change", () => { const p = state.catalog.profiles[byId("planProfile").value]; byId("planRuns").value = p.runs; byId("planScale").value = p.scale; updatePlan(); });
    byId("closePlanner").addEventListener("click", () => byId("planner").close());
    byId("copyCommand").addEventListener("click", async () => { try { await navigator.clipboard.writeText(byId("planCommand").value); byId("copyStatus").textContent = "Copied."; } catch { byId("planCommand").focus(); byId("planCommand").select(); byId("copyStatus").textContent = "Select and copy the command."; } });
    byId("startTest").addEventListener("click", () => performAction("/api/lab/runs", planSettings(), true));
    updatePlan();
  }
  async function performAction(url, body = {}, fromPlanner = false) {
    state.busy = true; updatePlan(); byId("plannerError").hidden = true;
    try {
      const started = await json(url, undefined, body);
      if (fromPlanner) byId("planner").close();
      state.runOffset = 0; state.sampleOffset = 0; byId("browserFilter").value = "";
      await refreshRuns(started.runId); await refreshActivity(); if (state.data?.run.status === "running") status("Your test has started. Results update automatically.");
    } catch (error) { if (fromPlanner) { byId("plannerError").textContent = error.message; byId("plannerError").hidden = false; } else status(error.message, true); }
    finally { state.busy = false; updatePlan(); }
  }
  async function refreshRuns(preferred) {
    try {
      const listing = await json(`/api/lab/runs?offset=${state.runOffset}&limit=50`);
      const current = preferred || byId("labRun").value;
      const selected = current || listing.runs.find(run => run.browsers.length > 1 && run.ok > 0)?.id;
      const entries = listing.runs.map(run => [run.id, `${run.browsers.map(browserName).join(" + ")} · ${profiles[run.profile] || run.profile} · ${date(run.startedAt)}`]);
      if (selected && !entries.some(([id]) => id === selected)) entries.unshift([selected, selected]);
      options(byId("labRun"), entries, selected); byId("labRun").disabled = !entries.length;
      byId("newerRuns").disabled = state.runOffset === 0; byId("olderRuns").disabled = state.runOffset + 50 >= listing.total;
      byId("runRange").textContent = listing.total ? `${listing.total} saved test${listing.total === 1 ? "" : "s"}` : "No saved tests";
      byId("emptyLab").hidden = !!entries.length;
      if (!entries.length) { byId("experiment").hidden = true; byId("downloadCsv").hidden = true; return; }
      state.sampleOffset = 0; await loadRun();
    } catch (error) { status(error.message, true); }
  }
  async function loadRun() {
    const id = byId("labRun").value; if (!id) return;
    state.controller?.abort(); const controller = new AbortController(); state.controller = controller;
    const query = new URLSearchParams({ offset: state.sampleOffset, limit: 100 }); if (byId("browserFilter").value) query.set("browser", byId("browserFilter").value);
    byId("experiment").setAttribute("aria-busy", "true");
    try {
      const data = await json(`/api/lab/runs/${encodeURIComponent(id)}?${query}`, controller.signal); if (controller.signal.aborted) return;
      const previous = state.data?.run.id; state.data = data;
      if (previous !== id) { options(byId("suiteSelect"), data.run.catalog.map(suite => [suite.id, groupName(suite.id)])); options(byId("browserFilter"), [["", "All browsers"], ...data.run.settings.browsers.map(browser => [browser, browserName(browser)])]); metricOptions(); }
      renderRun(); renderOverview(); renderComparison(); renderSamples(); byId("experiment").hidden = false; byId("emptyLab").hidden = true; byId("downloadCsv").hidden = false;
      const url = new URL(location); url.searchParams.set("run", id); history.replaceState({}, "", url);
      const issues = data.counts.failed + data.counts.timeout;
      status(issues ? `${issues} check${issues === 1 ? " needs" : "s need"} attention. Open Individual checks for details, then use Resume test to retry.` : "", !!issues);
    } catch (error) { if (error.name !== "AbortError") status(error.message, true); }
    finally { if (state.controller === controller) byId("experiment").setAttribute("aria-busy", "false"); }
  }
  async function refreshActivity() {
    try {
      const activity = await json("/api/lab/activity"); state.activity = activity.active;
      byId("activeTest").hidden = !activity.active; byId("newRun").disabled = !!activity.active;
      if (activity.active) {
        const active = activity.active, counts = active.counts;
        byId("activeTestTitle").textContent = active.stopping ? "Stopping after the current check…" : "Your browser test is running";
        byId("activeTestDescription").textContent = counts ? `${counts.ok + counts.failed + counts.timeout + counts.unsupported} of ${counts.planned} checks recorded. You can leave this page open.` : "Preparing browsers and warmup checks. Your results will appear shortly.";
        byId("testProgress").value = counts?.planned ? 100 * (counts.planned - counts.pending) / counts.planned : 0;
        byId("stopTest").disabled = active.stopping;
      }
      byId("resumeTest").hidden = !state.data || !!activity.active || !["partial", "interrupted"].includes(state.data.run.status);
      updatePlan();
    } catch { /* Saved results remain usable if run controls are temporarily unavailable. */ }
  }
  function renderRun() {
    const { run, counts } = state.data, settings = run.settings, env = run.environment;
    byId("runStatus").textContent = ({ completed: "Complete", running: "Running", partial: "Needs attention", interrupted: "Stopped" })[run.status] || run.status; byId("runStatus").dataset.status = run.status;
    byId("sampleCount").textContent = `${counts.ok} / ${counts.planned}`; byId("pendingCount").textContent = counts.pending ? `${counts.pending} still to go` : "All checks recorded";
    byId("browserCount").textContent = settings.browsers.length; byId("browserNames").textContent = settings.browsers.map(browserName).join(" · ");
    byId("suiteCount").textContent = settings.suites.length; byId("workScale").textContent = `${profiles[settings.profile]} · ${settings.scale}× workload`;
    byId("failureCount").textContent = counts.failed + counts.timeout; byId("unsupportedCount").textContent = counts.unsupported ? `${counts.unsupported} unavailable` : counts.failed + counts.timeout ? "Open individual checks below" : "Everything looks good";
    byId("experimentInfo").textContent = `${date(run.startedAt)} · ${settings.headless ? "Browsers run in the background" : "Visible browser windows"} · ${settings.runs} repetitions per test · ${settings.warmup} warmups · workload version ${run.workloadVersion}`;
    byId("machineInfo").textContent = `${env.platform} ${env.arch} · ${env.cpuModel} · ${env.cpuCount} logical cores · ${env.totalMemoryGB} GiB RAM`;
    byId("versionsInfo").textContent = Object.entries(run.browserVersions).map(([browser, version]) => `${browserName(browser)} ${version}`).join(" · ");
    byId("downloadCsv").href = `/api/lab/runs/${encodeURIComponent(run.id)}/csv`;
    const measured = [...new Set(state.data.summary.map(item => item.browser))];
    byId("singleBrowserNotice").hidden = measured.length > 1 || run.status === "running";
    byId("singleBrowserTitle").textContent = measured.length ? `Only ${browserName(measured[0])} has results in this test` : "There are no completed measurements yet";
    byId("singleBrowserDescription").textContent = measured.length ? "These are individual results, not a browser comparison. Test two or more browsers with the same settings to see them side by side." : "Inspect the failed checks below, then retry or start a new test.";
    byId("resumeTest").hidden = !!state.activity || !["partial", "interrupted"].includes(run.status);
  }
  function renderOverview() {
    const { run, summary } = state.data, browsers = run.settings.browsers;
    const multi = new Set(summary.map(item => item.browser)).size > 1;
    byId("overviewTitle").textContent = multi ? "Browsers, side by side" : "All test results";
    byId("overviewDescription").textContent = multi ? "Compare browser values within the same row. Each row tests a different task." : "Every test group is shown below. Select a row to explore its measurements.";
    byId("overviewCount").textContent = `${run.catalog.length} test groups`;
    const head = element("tr"); head.append(element("th", "Test group / measurement"));
    browsers.forEach(browser => { const th = element("th"); th.append(dot(browser), document.createTextNode(browserName(browser))); head.append(th); });
    byId("overviewHead").replaceChildren(head);
    byId("overviewBody").replaceChildren(...run.catalog.map(suite => {
      const metricId = Object.keys(suite.metrics)[0], metric = suite.metrics[metricId];
      const values = summary.filter(item => item.suite === suite.id && item.metric === metricId);
      const best = values.length > 1 ? (metric[2] === "lower" ? Math.min : Math.max)(...values.map(item => item.mean)) : null;
      const tr = element("tr", null, suite.id === byId("suiteSelect").value ? "selected" : "");
      const label = element("td"), button = element("button", null, "group-button"); button.type = "button"; button.setAttribute("aria-label", `Explore ${groupName(suite.id)}`);
      const text = element("span", groupName(suite.id)); text.append(element("small", metric[0])); button.append(element("span", icons[suite.id], "group-icon"), text);
      button.addEventListener("click", () => { byId("suiteSelect").value = suite.id; metricOptions(); renderOverview(); renderComparison(); byId("resultPanel").scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "instant" : "smooth", block: "start" }); }); label.append(button); tr.append(label);
      browsers.forEach(browser => { const value = values.find(item => item.browser === browser); const cell = element("td", value ? `${format(value.mean)} ${metric[1]}` : "No result"); if (value && best !== null && value.mean === best) { cell.className = "best-value"; cell.append(element("span", metric[2] === "lower" ? "Lowest mean" : "Highest mean", "best-marker")); } tr.append(cell); }); return tr;
    }));
  }
  function metricOptions() { const suite = state.data.run.catalog.find(item => item.id === byId("suiteSelect").value); options(byId("metricSelect"), Object.entries(suite.metrics).map(([id, metric]) => [id, metric[0]])); }
  function renderComparison() {
    const suite = state.data.run.catalog.find(item => item.id === byId("suiteSelect").value), metricId = byId("metricSelect").value, metric = suite.metrics[metricId];
    const summary = state.data.summary.filter(item => item.suite === suite.id), values = summary.filter(item => item.metric === metricId), multi = values.length > 1;
    byId("resultTitle").textContent = `${groupName(suite.id)} · ${multi ? "browser comparison" : "results"}`;
    byId("suiteDescription").textContent = suite.description; byId("metricDirection").textContent = metric[2] === "lower" ? "↓ Lower is better" : "↑ Higher is better";
    byId("chartDescription").textContent = `${metric[0]} · ${multi ? "Same test, same settings, different browsers." : "A measurement from one browser."}`;
    byId("labChart").hidden = !multi; byId("singleResult").hidden = values.length !== 1; byId("chartEmpty").hidden = !!values.length;
    byId("labChart").replaceChildren(); byId("singleResult").replaceChildren();
    if (multi) { const maximum = Math.max(...values.map(item => item.mean)); values.forEach(item => { const node = element("div", null, "comparison-row"), name = element("div", null, "comparison-name"), track = element("div", null, "comparison-track"), fill = element("div", null, "comparison-fill"); name.append(dot(item.browser), document.createTextNode(browserName(item.browser))); fill.style.setProperty("--browser-color", palette[item.browser]); fill.style.width = `${maximum ? item.mean / maximum * 100 : 0}%`; track.append(fill); node.append(name, track, element("div", `${format(item.mean)} ${metric[1]}`, "comparison-value")); byId("labChart").append(node); }); }
    else if (values.length === 1) { const item = values[0], number = element("div", format(item.mean), "result-number"); number.append(element("small", metric[1])); const explanation = element("div"); explanation.append(element("strong", `${browserName(item.browser)} · ${metric[0]}`), element("p", `${item.n} repetition${item.n === 1 ? "" : "s"} · recorded range ${format(item.min)}–${format(item.max)} ${metric[1]}`), element("p", "Add another browser to turn this result into a comparison.")); byId("singleResult").append(number, explanation); }
    byId("metricHighlights").replaceChildren(...Object.entries(suite.metrics).map(([id, definition]) => { const measured = summary.filter(item => item.metric === id); const ordered = [...measured].sort((a, b) => (a.mean - b.mean) * (definition[2] === "lower" ? 1 : -1)); const winner = ordered[0]; const card = element("div", null, "metric-highlight"); card.append(element("span", definition[0]), element("strong", winner ? `${format(winner.mean)} ${definition[1]}` : "Not measured"), element("small", winner ? `${browserName(winner.browser)}${ordered.length > 1 ? ` · ${definition[2] === "lower" ? "lowest" : "highest"} recorded mean` : " · individual result"}` : "Waiting for a successful check")); return card; }));
    byId("labSummary").replaceChildren(...summary.map(item => row([browserName(item.browser), item.label, `${format(item.mean)} ${item.unit}`, item.ci95 == null ? "More repetitions needed" : `${format(item.ci95)} ${item.unit}`, format(item.median), format(item.p95), item.n])));
    if (!summary.length) byId("labSummary").replaceChildren(row(["No completed measurements for this test group."]));
  }
  function renderSamples() {
    const { samples, pagination } = state.data;
    byId("labSamples").replaceChildren(...samples.map(sample => row([browserName(sample.browser), groupName(sample.suite), sample.iteration, sample.attempt, ({ ok: "Passed", failed: "Failed", timeout: "Timed out", unsupported: "Unavailable" })[sample.status] || sample.status,
      sample.status === "ok" ? Object.entries(sample.metrics).map(([id, value]) => `${state.data.run.catalog.find(suite => suite.id === sample.suite)?.metrics[id]?.[0] || id}: ${format(value)}`).join(" · ") : sample.message || "Unavailable"], `sample-${sample.status}`)));
    if (!samples.length) byId("labSamples").replaceChildren(row(["No checks match this filter."]));
    byId("previousSamples").disabled = pagination.offset === 0; byId("nextSamples").disabled = pagination.offset + pagination.limit >= pagination.total;
    byId("sampleRange").textContent = pagination.total ? `${pagination.offset + 1}–${Math.min(pagination.offset + pagination.limit, pagination.total)} of ${pagination.total}` : "No checks";
  }
  async function init() {
    try {
      state.catalog = await json("/api/lab/catalog"); setupPlanner();
      byId("newRun").addEventListener("click", () => openPlanner()); byId("emptyStart").addEventListener("click", () => openPlanner()); byId("compareBrowsers").addEventListener("click", () => openPlanner(true));
      byId("refreshRuns").addEventListener("click", () => refreshRuns());
      byId("labRun").addEventListener("change", () => { state.sampleOffset = 0; byId("browserFilter").value = ""; loadRun(); });
      byId("suiteSelect").addEventListener("change", () => { metricOptions(); renderOverview(); renderComparison(); }); byId("metricSelect").addEventListener("change", renderComparison);
      byId("browserFilter").addEventListener("change", () => { state.sampleOffset = 0; loadRun(); });
      for (const [id, delta] of [["previousSamples", -100], ["nextSamples", 100]]) byId(id).addEventListener("click", () => { state.sampleOffset = Math.max(0, state.sampleOffset + delta); loadRun(); });
      for (const [id, delta] of [["newerRuns", -50], ["olderRuns", 50]]) byId(id).addEventListener("click", () => { state.runOffset += delta; byId("labRun").replaceChildren(); refreshRuns(); });
      byId("resumeTest").addEventListener("click", () => performAction(`/api/lab/runs/${encodeURIComponent(state.data.run.id)}/resume`));
      byId("stopTest").addEventListener("click", async () => { try { await json(`/api/lab/runs/${encodeURIComponent(state.activity.runId)}/stop`, undefined, {}); await refreshActivity(); } catch (error) { status(error.message, true); } });
      await refreshRuns(new URLSearchParams(location.search).get("run")); await refreshActivity();
      setInterval(async () => { if (state.polling || document.hidden) return; state.polling = true; try { const wasActive = !!state.activity; await refreshActivity(); if (wasActive || state.activity || state.data?.run.status === "running") { if (!byId("labRun").value && state.activity?.runId) await refreshRuns(state.activity.runId); else await loadRun(); } } finally { state.polling = false; } }, 2000);
    } catch (error) { status(error.message, true); }
  }
  document.addEventListener("DOMContentLoaded", init);
})();
