# Spectra: Browser Evaluation Suite

Compare Chrome, Microsoft Edge, and Firefox using repeatable benchmark runs, live resource telemetry, and statistical analysis. Spectra includes a local dashboard for exploring startup time, page loading, CPU, memory, navigation timings, Speedometer scores, and light versus heavy workloads.

## Quick start

**Requirements:** Node.js 20 or newer. Windows 10/11 is required for process CPU and working-set memory collection. Install Google Chrome and Microsoft Edge for their respective benchmark commands. Firefox runs use Playwright’s Firefox binary.

```sh
npm ci
npx playwright install firefox
npm start
```

Open the [benchmark dashboard](http://127.0.0.1:3000/benchmark.html) to explore the included sample runs. Open the [live console](http://127.0.0.1:3000/) to launch a browser and watch its telemetry. The dashboard binds to the local machine only. Set `PORT` to use another port.

The sample CSVs were recorded on **August 22, 2026**. They demonstrate the application and describe that particular machine and test session; they are not current browser rankings.

## Run benchmarks

```sh
# All browsers, sequentially
npm run bench

# One browser at a time
npm run bench:chrome
npm run bench:edge
npm run bench:firefox

# Light and heavy workload suites
npm run bench:workloads
npm run bench:workload:chrome
npm run bench:workload:edge
npm run bench:workload:firefox
```

Standard benchmarks visit ten configured websites, collect navigation and resource measurements, and attempt Speedometer 3.0. Workloads compare five lightweight sites with five heavier pages. A failed Speedometer attempt is logged; it does not manufacture a score.

Results accumulate in `results/` or `workloads/`. Re-running one browser replaces that browser’s in-progress observations. Once all three browsers are present, the core runner archives the directory with a timestamp. The top-level runner preserves unfinished data for other browsers and leaves archiving to the core runner.

Close unrelated browser windows and background tasks before collecting results. Live CPU and memory measurements include **all processes with the browser’s process name**, including pre-existing browser sessions. Keep network conditions and benchmark settings consistent between runs.

### Configuration

Edit `scripts/config.js` to change standard benchmark websites. Environment overrides include `RUNS` (default `3`) and `SPEEDOMETER_RUNS` (default `1`). For example, in PowerShell:

```powershell
$env:RUNS = '5'
$env:SPEEDOMETER_RUNS = '3'
npm run bench
```

Workload sites are defined in `scripts/workload_core.js`. Workloads use `RUNS` by default; set `WORKLOAD_RUNS` to override their iteration count independently. Counts are validated before browsers launch. Set `SPEEDOMETER_RUNS=0` to skip Speedometer deliberately. Legacy archives include milliseconds and a collision suffix so rapid runs preserve every directory.

## Benchmark Lab: seven additional suites

The new [Benchmark Lab](http://127.0.0.1:3000/lab.html) runs controlled local workloads independently of the existing website suites. It supports installed **Chrome** and **Edge**, plus Playwright **Chromium**, **Firefox**, and **WebKit**. WebKit is an engine build, not the Safari application.

| Suite | What it measures |
| :--- | :--- |
| `javascript` | Seeded numeric sorting, JSON serialization/parsing, and integer computation |
| `dom` | Node insertion, style changes, forced layout, and selector queries |
| `canvas` | Canvas 2D drawing with synchronization, pixel readback, and drawing throughput |
| `crypto` | SHA-256 hashing duration and binary-payload throughput |
| `storage` | IndexedDB writes through transaction completion, verified reads, and records/second |
| `network` | Uncached loopback transfers versus repeated cacheable fetches |
| `tabs` | Concurrent local-document startup and tabs/second |

These are **Spectra microbenchmarks**, not substitutes for Speedometer, JetStream, MotionMark, or field Web Vitals. Network results measure the local HTTP stack and cache behavior, not internet connection speed. Cache use depends on the browser; the benchmark does not assume every cacheable fetch is a cache hit.

```sh
# Install just the engine needed for a first local run
npx playwright install chromium
npm run bench:lab -- --browsers chromium

# Compare the installed branded browsers and Playwright Firefox
npm run bench:lab -- --browsers chrome,edge,firefox

# Select a subset and increase sample counts
npm run bench:lab -- --browsers chromium,firefox --suites javascript,dom,storage --runs 10 --warmup 2

# Larger workloads; optionally show browser windows
npm run bench:lab -- --profile stress --browsers chromium --headed

# Show available suites without launching browsers
npm run bench:lab -- --list
npm run bench:lab -- --help
```

To use all Playwright engine builds, install them with `npx playwright install chromium firefox webkit`. Linux may also need the browser system dependencies: `npx playwright install --with-deps chromium firefox webkit`.

### Scale and repeat experiments

| Profile | Measured samples per suite/browser | Work size multiplier |
| :--- | :--- | :--- |
| `quick` | 3 | 1× |
| `standard` | 5 | 3× |
| `stress` | 10 | 8× |

Each profile has one unmeasured warmup per suite/browser. Override these settings with `--runs 1..100`, `--warmup 0..10`, `--scale 1..20`, and `--timeout 1000..300000` (milliseconds per sample). Runs default to headless mode; use `--headed` for visible windows. The planner in Benchmark Lab builds commands and shows the total number of samples before you start.

Browser targets execute **sequentially** to avoid competing for resources. Only the multi-tab suite opens pages concurrently; its load scales from 2 to a maximum of 16 tabs. Suite order rotates between browsers to reduce a consistent first-suite bias. Each sample uses a new, non-persistent context with a fixed 1280 × 800 viewport and device scale factor of 1.

Results are checkpointed to `lab-results/<run-id>/manifest.json` after every attempt. `samples.csv` and `summary.json` are exported when a run finishes or is interrupted. The manifest records workload revision, exact settings, browser versions, operating system, CPU, memory, Node version, and Playwright version.

```sh
# Resume an interrupted or partially failed experiment using its printed ID
npm run bench:lab -- --resume <run-id>
```

Resume preserves successful samples and retries failed, timed-out, or unfinished ones. It retains earlier attempts in the CSV while summaries use only the latest attempt for each sample. Saved settings cannot be overridden during resume; changed environments or browser versions require a new run. A lock prevents concurrent writers from resuming the same experiment.

Set `SPECTRA_RESULTS_DIR` to change the results location; use the same value for the CLI and dashboard server. Experiment manifests and generated screenshots are ignored by Git.

### Compare and export

Start the dashboard with `npm start`, then open **Benchmark Lab**. Choose an experiment and a suite to see a chart, means, confidence intervals, medians, percentiles, and sample history. The page refreshes running experiments, paginates saved runs and sample history, filters samples by browser, and downloads all attempts as CSV. Run URLs can be bookmarked locally.

Missing APIs, timeouts, and browser-launch failures have explicit statuses and never become invented zero scores. A single sample has no confidence estimate. Compare results only when workload revision, size, browser mode, and machine conditions match. Hardware acceleration and headless operation can materially affect graphics timings. Background activity, thermal changes, and timer precision still affect these synthetic measurements.

Implementation references: [Playwright browser engines](https://playwright.dev/docs/browsers), [isolated browser contexts](https://playwright.dev/docs/api/class-browsercontext), and [IndexedDB transaction completion](https://developer.mozilla.org/en-US/docs/Web/API/IDBTransaction/complete_event).

## Explore and analyze results

The dashboard provides:

- Run selection, shareable run URLs, light/dark themes, and responsive layouts.
- A scorecard ranked by the number of wins across measured startup, CPU, and memory metrics; ties share wins.
- Per-site loading charts, cumulative distributions, resource comparisons, and an eight-axis radar. Missing radar observations remain gaps.
- Ratios against a selected baseline and workload inflation comparisons.
- Searchable raw logs rendered as text, including quoted and multiline CSV values.
- Visible loading, empty, and error states.

```sh
# Analyze the newest available run
npm run analyze

# Analyze a particular saved run
npm run analyze -- results_2026-08-22_22-29
npm run analyze -- workloads_2026-08-22_19-56
```

Both the dashboard API and command-line analyzer use the same CSV parsing and aggregation code. They support standard and workload column names, retain valid zero measurements, ignore missing numeric cells, and keep per-run averages separate from per-site peaks.

## Statistical interpretation

The analysis reports sample counts, arithmetic means, sample standard deviations, percentiles, and Student’s t confidence intervals. Pairwise comparisons use Welch’s degrees of freedom. One-way ANOVA calculates an F-distribution p-value from the actual between-group and within-group degrees of freedom.

- A single observation cannot estimate uncertainty; the CLI shows its confidence interval as `N/A`.
- An empty series represents unavailable data, not measured zero performance.
- Pairwise intervals are unadjusted comparisons; multiple comparisons can increase the false-positive rate.
- Pooled page-load observations span different websites and repeated sessions. Treat their inference as exploratory; site mix, network conditions, and correlated observations affect interpretation.
- Headline and ratio rankings are descriptive summaries of the selected run, not proof of an overall browser advantage.
- Live transfer measurements estimate response sizes and are not a packet-level network capture.

Statistical references: [NIST Student’s t critical values](https://itl.nist.gov/div898/handbook/eda/section3/eda3672.htm), [NIST F distribution](https://itl.nist.gov/div898/handbook/eda/section3/eda3665.htm), and [NIST ANOVA](https://itl.nist.gov/div898/handbook/prc/section4/prc433.htm).

## Development and validation

```sh
npm run check
npm test
```

`check` validates JavaScript syntax, including inline dashboard scripts. The Node test suite covers CSV edge cases, statistical reference values, workload aggregation, ranking and log rendering, HTTP endpoints, and malformed WebSocket messages. GitHub Actions runs both checks on pushes and pull requests. No browser installation is needed for these regression tests. CI also runs the real-browser smoke test separately in Chromium, Firefox, and WebKit, including all seven Lab suites and the desktop/mobile dashboard.

The real-browser smoke test can also run locally. In PowerShell:

```powershell
$env:SPECTRA_BROWSER_SMOKE = '1'
$env:SPECTRA_SMOKE_BROWSER = 'chromium'
node --test test/lab-browser.test.js
Remove-Item Env:SPECTRA_BROWSER_SMOKE
Remove-Item Env:SPECTRA_SMOKE_BROWSER
```

Smoke tests generate desktop/mobile screenshots in `test-results/`. Lab suites use only their temporary local fixture server. The legacy website benchmarks contact public websites and remain separate from the regression suite.

## Project layout

```text
dashboard/
  public/             Dashboard, live console, theme, and local Chart.js bundle
  server.js           Local HTTP and WebSocket server
scripts/
  csv.js              Shared CSV parser and numeric-field handling
  results.js          Run discovery and benchmark aggregation
  distributions.js    Student’s t and F distribution calculations
  stats.js            Descriptive statistics, Welch comparisons, and ANOVA
  telemetry.js        Asynchronous Windows process sampling for the live console
  analyze.js          Command-line reporting
  bench_browser_core.js
  workload_core.js    Standard and workload collection engines
  bench_lab.js        Configurable Lab command line
  lab/
    catalog.js        Suite definitions and metric units
    cases.js          Browser-side workloads and result validation
    runner.js         Warmups, timeouts, isolation, checkpoints, and resume
    store.js          Atomic manifests, compact discovery metadata, summaries, CSV
    fixture-server.js Local deterministic documents and binary payloads
    api.js            Paginated read-only Lab endpoints
test/                 Regression and API tests
results_*/            Included standard sample run
workloads_*/          Included workload sample run
lab-results/          Generated local experiments (ignored by Git)
```

Presentation decks, PDF reports, ZIP/source archives, local environment files, dependencies, and in-progress results are ignored by Git. The original local presentation and report files remain on disk.
