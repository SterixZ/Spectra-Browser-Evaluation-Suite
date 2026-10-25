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

Workload sites and iteration settings are defined separately in `scripts/workload_core.js`.

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

`check` validates JavaScript syntax, including inline dashboard scripts. The Node test suite covers CSV edge cases, statistical reference values, workload aggregation, ranking and log rendering, HTTP endpoints, and malformed WebSocket messages. GitHub Actions runs both checks on pushes and pull requests. No browser installation is needed for these regression tests.

Full benchmark runs launch installed browsers and contact public websites. They are separate from the automated regression suite.

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
test/                 Regression and API tests
results_*/            Included standard sample run
workloads_*/          Included workload sample run
```

Presentation decks, PDF reports, ZIP/source archives, local environment files, dependencies, and in-progress results are ignored by Git. The original local presentation and report files remain on disk.
