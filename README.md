# Spectra: Enterprise Browser Systems Evaluation Suite

A statistical performance evaluation platform and real-time telemetry console for modern web browsers (**Google Chrome**, **Microsoft Edge**, and **Mozilla Firefox**), built on the rigorous methodology of **Raj K. Jain’s *The Art of Computer Systems Performance Analysis***.

---

## Architecture & Capabilities

### 1. Executive Statistical Evaluation Dashboard (`/benchmark.html`)
* **Overview Scorecard**: Executive top performer summary with key takeaways and 4 high-contrast KPI cards (Startup Speed, CPU Efficiency, RAM Footprint, Web Responsiveness).
* **Visual Charts**: Full-width interactive Chart.js bar graphs comparing Page Load latency across 10 canonical websites, plus a 1-click **Combined System Resources view** (Startup / CPU / RAM).
* **Comparison Scorecard & The Ratio Game (Jain Ch. 11.5)**: Side-by-side performance matrix combined with an interactive baseline-normalized **Geometric Mean Ratio** matrix to eliminate baseline-selection bias.
* **Workload Benchmarks (Lightweight vs. Heavyweight)**: Evaluates how browsers scale under stress across 5 lightweight document sites vs. 5 heavyweight dynamic SPAs (5 iterations each) with overhead inflation multipliers.
* **Raw Observation Logs**: Filterable live search table inspecting raw sample rows.

### 2. Live Dashboard (`/`)
* **Real-time 1-second sampling** of CPU utilization (`%`), physical RAM working set (`MB`), network throughput (`KB/s`), and active navigation URLs via OS process inspection.
* **Targeted 0–10% CPU Scale**: Subtle 1%–5% processor load variations render as responsive wave graphs instead of flat lines.
* **1-Click Remote Launch & Stop Controls** for Chrome, Edge, and Firefox.

### 3. Rigorous Statistical Engine (`scripts/stats.js`)
* **Confidence Intervals (90%, 95%, 99%)** using Student's $t$-distribution critical values.
* **Coefficient of Variation ($CoV$)**: Quantifies experimental stability ($CoV \le 0.15 \implies$ High Stability).
* **Tail Percentiles ($P_{50}, P_{90}, P_{99}$)** & Interquartile Range ($IQR$) for latency skew detection.
* **One-Way ANOVA (Jain Ch. 20)**: Evaluates between-browser variance against experimental noise ($F$-test, $p < 0.05$).
* **Pairwise Hypothesis Testing**: Welch's two-sample $t$-test calculating difference confidence intervals ($\Delta \pm 95\%\text{ CI}$).

---

## Quick Start

### Prerequisites
* **Node.js**: v18 or newer
* **Operating System**: Windows 10/11
* **Browsers**: Google Chrome, Microsoft Edge, Mozilla Firefox

### Installation
```bash
git clone <repo-url>
cd BrowserPerformance
npm install
```

### Running Benchmarks
* **Run Standard Benchmark** (10 sites, 5 iterations + Speedometer 3.0):
  ```bash
  npm run bench
  ```
* **Run Workload Benchmark** (5 Light vs. 5 Heavy sites, 5 iterations):
  ```bash
  npm run bench:workloads
  ```
* **Analyze Runs in Terminal**:
  ```bash
  npm run analyze
  # or analyze a specific run:
  npm run analyze results_2026-08-07_15-52
  ```

### Launching the Dashboard
```bash
npm run dashboard
```
* **Evaluation Dashboard**: [http://localhost:3000/benchmark.html](http://localhost:3000/benchmark.html)
* **Live Dashboard**: [http://localhost:3000](http://localhost:3000)

---

## Repository Structure

```
BrowserPerformance/
├── dashboard/
│   ├── public/
│   │   ├── benchmark.html    # Statistical Scorecard & Workload UI
│   │   ├── index.html        # Real-time Live Dashboard Console
│   │   ├── theme.css         # Enterprise Design System
│   │   ├── theme-toggle.js   # Light/Dark Mode Manager
│   │   └── chart.umd.min.js  # Chart.js library
│   └── server.js             # Express & WebSocket Telemetry Server
├── scripts/
│   ├── config.js             # Canonical URLs & Browser Definitions
│   ├── stats.js              # Raj Jain Statistical Engine
│   ├── browsers.js           # Playwright Browser Automation Handlers
│   ├── full_benchmark.js     # Multi-iteration Core Benchmark
│   ├── workload_benchmark.js # Light vs Heavy Workload Benchmark
│   ├── runner.js             # Benchmark Orchestrator & Results Archiver
│   └── analyze.js            # Terminal Statistical Analysis CLI
├── results_*/                # Archived Benchmark Runs
└── package.json
```

---

## Evaluation Methodology (Raj K. Jain)

| Analysis Dimension | Mathematical Model | Source in Jain |
| :--- | :--- | :--- |
| **Metric Classification** | Lower is Better (LB) vs. Higher is Better (HB) | Chapter 3 |
| **Central Tendencies** | Arithmetic, Geometric ($\prod x_i^{1/n}$), Harmonic ($\frac{n}{\sum x_i^{-1}}$) | Chapter 11 |
| **Variability & Stability** | $CoV = s / \bar{x}$, Interquartile Range ($Q_3 - Q_1$) | Chapter 11 |
| **Normalized Comparisons** | The Ratio Game ($\text{GeoMean}(R_1, \dots, R_k)$) | Chapter 11.5 |
| **Hypothesis Testing** | Welch's $t$-test ($\Delta \pm t_{1-\alpha/2} \cdot s_\Delta$) | Chapters 13 & 14 |
| **Multi-System Variance** | One-Way ANOVA ($F = MSB / MSW$) | Chapter 20 |

---

## License
ISC License. Built for rigorous computer systems performance engineering.
