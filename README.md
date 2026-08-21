# 🚀 Spectra Browser Performance Evaluation Platform

An academic-grade, automated cross-browser performance benchmarking and analytics platform evaluating **Google Chrome**, **Microsoft Edge**, and **Mozilla Firefox**.

Built upon the experimental performance evaluation methodologies of **Dr. Raj Jain** (*The Art of Computer Systems Performance Analysis*) and the **W3C Navigation & Paint Timing Level 2 Specifications**.

---

## 🏛️ 6-Pillar Experimental Architecture

```
                 Comprehensive Browser Evaluation
                                │
        ┌───────────────────────┼───────────────────────┐
        ↓                       ↓                       ↓
  Network Timing          Page Lifecycle         Engine & System
     (W3C L2)              (Core Vitals)           (CPU / RAM)
        │                       │                       │
  DNS / TCP / TLS         FCP & DOMParse         Active CPU % Delta
  TTFB & Throughput       loadEventEnd           Peak RAM WorkingSet64
        │                       │                       │
        └───────────────────────┼───────────────────────┘
                                ↓
                    Statistical Rigor (Jain)
                                │
                    ANOVA F-Test • Welch t-Test
                    Ratio Game (GeoMean Ratios)
```

1. **Network Performance (W3C Level 2)**: Microsecond-precision protocol timings (`DNS`, `TCP`, `TLS`, `TTFB`, `Download`, `Throughput KB/s`).
2. **Page-Loading Performance**: First Contentful Paint (`FCP`), `DOMContentLoaded`, and Total Page Load (`loadEventEnd`).
3. **JavaScript Engine & CPU Workload**: Continuous active multi-core CPU tracking (`%`) and Speedometer 3.0 throughput (`runs/min`).
4. **Memory Footprint**: Total OS Physical Working Set (`WorkingSet64` in MB) and heavy SPA scaling inflation.
5. **Experimental Setup Controls**: Unmetered warmup passes, 5s thermal stabilization cooldowns, and clean profiles.
6. **Statistical Analysis**: One-Way ANOVA ($F$-test), Pairwise Welch's $t$-test (95% CI), CoV stability, Tail Percentiles ($P_{50}, P_{90}, P_{99}$), and The Ratio Game.

---

## 📁 Remodeled Project Directory Structure

```text
BrowserPerformance/
├── dashboard/                     # Web analytics and live telemetry dashboards
│   ├── public/
│   │   ├── benchmark.html         # Comprehensive benchmark dashboard (Kiviat & W3C Waterfall)
│   │   ├── index.html             # Real-time multi-browser live telemetry waveforms
│   │   └── theme.css              # Custom responsive dashboard design system
│   └── server.js                  # Express & WebSocket telemetry API server
├── docs/                          # Academic documentation & research papers
│   ├── Browser_Performance_Evaluation_Methodology_and_Architecture.docx
│   └── Raj_Jain_Response_Time_vs_Speedometer_Analysis.docx
├── results/                       # Active benchmark output CSV files
├── scripts/                       # Modular benchmark engines and statistics
│   ├── config.js                  # Canonical URLs, workloads, timeouts, and browser targets
│   ├── telemetry.js               # Shared OS CPU/RAM sampling & NavigationTelemetryMonitor
│   ├── browsers.js                # Playwright lifecycle & anti-backgrounding launch flags
│   ├── stats.js                   # Raj Jain mathematical statistics (ANOVA, t-test, GeoMean)
│   ├── benchmark.js               # Primary 10-site benchmark suite + Speedometer 3.0
│   ├── workload_benchmark.js      # 2-tier workload suite (5 Ultra-Light vs 5 Heavy SPAs)
│   └── analyze.js                 # Terminal CLI statistical analyzer
├── package.json                   # Project npm configuration
└── README.md                      # Platform documentation
```

---

## ⚡ Quick Start

### 1. Install Dependencies
```bash
npm install
npx playwright install
```

### 2. Run Benchmarks

* **Full 10-Site Canonical Suite + Speedometer 3.0**:
  ```bash
  npm run bench
  ```

* **2-Tier Workload Scaling Suite (5 Light vs 5 Heavy SPAs)**:
  ```bash
  npm run bench:workloads
  ```

* **Terminal Statistical Analysis**:
  ```bash
  npm run analyze
  ```

### 3. Launch Web Dashboard

```bash
npm run dashboard
```
Open **`http://localhost:3000`** in your browser:
* **Live Dashboard** (`/`): Real-time waveform streaming of CPU %, RAM MB, and Network KB/s.
* **Benchmark Analytics** (`/benchmark.html`): Interactive Kiviat Radar Graphs, W3C Timing Waterfall matrix, The Ratio Game, and ANOVA statistical scorecards.

---

## 📄 License & Academic Attribution
Created for cross-browser systems evaluation and research based on Raj Jain's *The Art of Computer Systems Performance Analysis* (John Wiley & Sons).
