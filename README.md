# 🚀 Spectra: Enterprise Browser Systems Evaluation Suite

A high-precision statistical benchmark suite and telemetry dashboard for evaluating modern web browsers (**Google Chrome**, **Microsoft Edge**, and **Mozilla Firefox**), built on the performance evaluation methodology of **Raj K. Jain’s *The Art of Computer Systems Performance Analysis*** (Chapters 3, 10, 11, 13, and 20).

---

## ⚡ Quick Start Guide (For Teammates & Testers)

Follow these simple steps to run the benchmark on your local machine:

### 1. Prerequisites
Ensure you have the following installed on your machine:
* **Operating System**: Windows 10 / 11 *(64-bit)*
* **Node.js**: Version `v18` or newer ([Download Node.js](https://nodejs.org/))
* **Browsers Installed**: 
  * Google Chrome
  * Microsoft Edge
  * Mozilla Firefox

---

### 2. Installation & Setup

1. **Unzip the project folder** to your preferred location (e.g. `C:\Users\<You>\Downloads\BrowserPerformance\`).
2. **Open Terminal / PowerShell / Command Prompt** inside this folder:
   ```bash
   cd BrowserPerformance
   ```
3. **Install Node.js dependencies**:
   ```bash
   npm install
   ```
4. **Install Firefox test binary (Required for Firefox automated runs)**:
   ```bash
   npx playwright install firefox
   ```

---

### 3. Run Benchmark Tests

You can run the full automated test across all 3 browsers, or test individual browsers one by one:

#### Option A: Standard 10-Site Benchmark (With Speedometer 3.0)
Evaluates Startup Time, Active Multi-Core CPU %, WorkingSet64 RAM, Speedometer 3.0 Composite Score, and full W3C Timing Waterfalls (DNS, TCP, TLS, TTFB, Download, FCP) across 10 balanced domains.

```bash
# Run full suite across all 3 browsers (Chrome -> Edge -> Firefox):
npm run bench

# OR run individual browsers independently:
npm run bench:chrome     # Runs Google Chrome only
npm run bench:edge       # Runs Microsoft Edge only
npm run bench:firefox    # Runs Mozilla Firefox only
```

> **Auto-Archive Feature**: When running individual browsers, results accumulate into `results/`. As soon as all 3 browsers complete, the folder is automatically archived to `results_YYYY-MM-DD_HH-MM/` and a fresh `results/` is prepared.

---

#### Option B: Workload Benchmark (5 Ultra-Light vs. 5 Extreme-Heavy Dynamic SPAs)
Evaluates architectural elasticity, memory inflation, and CPU overhead ratios under heavy client-side JavaScript/DOM stress (Jain Ch. 3 & 11).

```bash
# Run full workload benchmark across all 3 browsers:
npm run bench:workloads

# OR run individual browsers on workloads:
npm run bench:workload:chrome    # Tests Chrome on 5 Light vs 5 Heavy SPAs
npm run bench:workload:edge      # Tests Edge on 5 Light vs 5 Heavy SPAs
npm run bench:workload:firefox   # Tests Firefox on 5 Light vs 5 Heavy SPAs
```

> **Auto-Archive Feature**: Individual workload runs accumulate into `workloads/`. When the 3rd browser finishes, the system automatically computes `workload_summary.csv` and `workload_comparison.csv` with inflation ratios and archives to `workloads_YYYY-MM-DD_HH-MM/`.

---

### 4. Launch the Interactive Visual Dashboard

To view the interactive graphs, 8-Axis Kiviat Performance Radar, W3C Waterfall, and ANOVA statistical significance tables:

```bash
npm run dashboard
```

Open your browser and navigate to:
* **Interactive Statistical Evaluation Dashboard**: [http://localhost:3000/benchmark.html](http://localhost:3000/benchmark.html)
* **Real-time 1-Second Telemetry Console**: [http://localhost:3000](http://localhost:3000)

*(Use the dropdown in the sidebar to switch between any archived test run folder instantly!)*

---

### 5. View Summary Stats in Terminal (CLI)

You can also print full statistical summaries, $95\%$ Confidence Intervals, and One-Way ANOVA directly in the terminal:

```bash
# Analyze the latest run:
npm run analyze

# Or analyze a specific historical folder:
npm run analyze results_2026-08-22_19-56
npm run analyze workloads_2026-08-22_19-56
```

---

## 📋 Available NPM Commands Cheat Sheet

| Command | Script / Target | Description |
| :--- | :--- | :--- |
| `npm install` | Setup | Installs all required project dependencies |
| `npx playwright install firefox` | Setup | Installs the Firefox automation binary |
| `npm run bench` | Full Benchmark | Runs 3 iterations + Speedometer 3.0 on Chrome, Edge, and Firefox |
| `npm run bench:chrome` | Chrome Standard | Runs 3 iterations + Speedometer 3.0 on Google Chrome |
| `npm run bench:edge` | Edge Standard | Runs 3 iterations + Speedometer 3.0 on Microsoft Edge |
| `npm run bench:firefox` | Firefox Standard | Runs 3 iterations + Speedometer 3.0 on Mozilla Firefox |
| `npm run bench:workloads` | Full Workload | Runs 5 Light vs 5 Heavy sites (3 passes) on all 3 browsers |
| `npm run bench:workload:chrome` | Chrome Workload | Runs 5 Light vs 5 Heavy sites on Google Chrome |
| `npm run bench:workload:edge` | Edge Workload | Runs 5 Light vs 5 Heavy sites on Microsoft Edge |
| `npm run bench:workload:firefox`| Firefox Workload | Runs 5 Light vs 5 Heavy sites on Mozilla Firefox |
| `npm run dashboard` | Express / UI | Starts the web dashboard server on `http://localhost:3000` |
| `npm run analyze` | Stats CLI | Computes means, standard deviations, $95\%\text{ CI}$, and ANOVA in terminal |

---

## 📊 Evaluation Architecture & Key Features

### 1. 8-Axis Kiviat Performance Radar (Raj Jain Ch. 10.4)
Located on the **Visual Charts** tab of the dashboard, this multi-dimensional radar balances performance across 8 key vectors normalized from $0–100\%$:
1. 🚀 **Startup Responsiveness** ($1/\text{Startup Time}$)
2. ⚡ **CPU Economy** ($1/\text{Active CPU \%}$)
3. 💾 **RAM Economy** ($1/\text{WorkingSet64 Memory}$)
4. ⏱️ **Response Velocity** ($1/\text{Page Load Time}$)
5. 📡 **Reaction Time** ($1/\text{TTFB Immediacy}$)
6. 🎨 **Render Immediacy** ($1/\text{First Contentful Paint}$)
7. 🏎️ **Execution Velocity** ($\text{Speedometer 3.0 Score}$)
8. 🏋️ **Workload Resilience** ($1/\text{Load Inflation Multiplier}$)

### 2. Full W3C Protocol Timing Waterfall
Extracts true browser network layer timings for every URL:
* **DNS Resolution** (`domainLookupEnd - domainLookupStart`)
* **TCP Handshake** (`connectEnd - connectStart`)
* **TLS Negotiation** (`connectEnd - secureConnectionStart`)
* **TTFB (Time to First Byte)** (`responseStart - requestStart`)
* **Download Time** (Content streaming duration)
* **FCP (First Contentful Paint)** (`first-contentful-paint`)

### 3. Continuous Active Navigation Telemetry Monitor
Samples process CPU and WorkingSet64 physical RAM every **300ms** continuously during page navigation and rendering. Accurately records:
* `ActiveCPU(%)`: Cumulative multi-core average CPU utilization.
* `PeakCPU(%)`: Peak processor burst spike during script execution.
* `Memory(MB)`: Steady-state physical RAM.
* `PeakMemory(MB)`: Peak memory footprint allocated during navigation.

### 4. Workload Inflation Ratios & The Ratio Game (Raj Jain Ch. 11.5)
Evaluates browser elasticity by comparing **5 Ultra-Lightweight Document Sites** (CERN, Example, NPR Text, DuckDuckGo Lite, W3C Spec) against **5 Extreme-Heavyweight SPAs** (YouTube, VS Code Hub, Reddit, Unsplash, Wiki GDP Table):
* **Load Inflation Multiplier**: $\frac{\text{Mean Heavy Load Time}}{\text{Mean Light Load Time}}$
* **RAM Inflation Multiplier**: $\frac{\text{Mean Heavy Peak RAM}}{\text{Mean Light Peak RAM}}$
* **CPU Overhead Ratio**: $\frac{\text{Mean Heavy Peak CPU}}{\text{Mean Light Peak CPU}}$

---

## 📂 Repository Structure

```
BrowserPerformance/
├── dashboard/
│   ├── public/
│   │   ├── benchmark.html          # Executive Scorecard, Kiviat Radar & W3C UI
│   │   ├── index.html              # Real-Time 1-Second Telemetry Console
│   │   ├── theme.css               # Light/Dark Design System
│   │   └── chart.umd.min.js        # Local Chart.js engine
│   └── server.js                   # Express & WebSocket Server
├── scripts/
│   ├── config.js                   # Benchmark URL list & baseline configuration
│   ├── browsers.js                 # Playwright Chromium/Edge/Firefox launchers
│   ├── stats.js                    # ANOVA, Student's t-CI, Welch's t-test engine
│   ├── bench_browser_core.js       # Standard benchmark execution & telemetry engine
│   ├── bench_chrome.js             # Standalone Chrome benchmark runner
│   ├── bench_edge.js               # Standalone Edge benchmark runner
│   ├── bench_firefox.js            # Standalone Firefox benchmark runner
│   ├── full_benchmark.js           # All-browsers sequential standard runner
│   ├── workload_core.js            # Workload execution & inflation analysis engine
│   ├── workload_chrome.js          # Standalone Chrome workload runner
│   ├── workload_edge.js            # Standalone Edge workload runner
│   ├── workload_firefox.js         # Standalone Firefox workload runner
│   ├── workload_benchmark.js       # All-browsers sequential workload runner
│   ├── runner.js                   # Full benchmark CLI runner & folder archiver
│   └── analyze.js                  # Terminal statistical summary CLI
├── results_*/                      # Archived standard benchmark datasets
├── workloads_*/                    # Archived workload benchmark datasets
└── package.json
```

---

## 📚 References & Methodology
* **Raj K. Jain**: *The Art of Computer Systems Performance Analysis: Techniques for Experimental Design, Measurement, Simulation, and Modeling*, John Wiley & Sons.
  * **Chapter 3**: Selection of Techniques and Metrics (HB, LB, NB metrics, Time-Rate-Resource framework).
  * **Chapter 10.4**: Kiviat Graphs (Multi-dimensional radial system balance).
  * **Chapter 11**: Summarizing Measured Data & The Ratio Game (Avoiding baseline selection bias).
  * **Chapter 13 & 14**: Confidence Intervals & Hypothesis Testing.
  * **Chapter 20**: One-Way Analysis of Variance (ANOVA).

---

## 📄 License
ISC License. Built for rigorous computer systems performance evaluation and research.
