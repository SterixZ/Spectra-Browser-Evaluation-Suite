// Comprehensive Statistical Engine for Computer Systems Performance Analysis
// Direct implementation of Raj K. Jain, "The Art of Computer Systems Performance Analysis"
// Covers Chapters 3 (Metrics), 11 & 12 (Summaries & Distributions), 13 & 14 (Comparing 2 Alternatives), 20 (ANOVA)

// Student's t critical values for 90%, 95%, 99% CI (two-tailed)
const T_TABLE = {
  90: {
    1: 6.314, 2: 2.920, 3: 2.353, 4: 2.132, 5: 2.015,
    6: 1.943, 7: 1.895, 8: 1.860, 9: 1.833, 10: 1.812,
    15: 1.753, 20: 1.725, 25: 1.708, 30: 1.697
  },
  95: {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571,
    6: 2.447,  7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228,
    15: 2.131, 20: 2.086, 25: 2.060, 30: 2.042
  },
  99: {
    1: 63.657, 2: 9.925, 3: 5.841, 4: 4.604, 5: 4.032,
    6: 3.707,  7: 3.499, 8: 3.355, 9: 3.250, 10: 3.169,
    15: 2.947, 20: 2.845, 25: 2.787, 30: 2.750
  }
};

function getTCritical(df, confidence = 95) {
  const rounded = Math.max(1, Math.round(df));
  const table = T_TABLE[confidence] || T_TABLE[95];
  if (rounded >= 30) {
    if (confidence === 90) return 1.645;
    if (confidence === 99) return 2.576;
    return 1.960;
  }
  return table[rounded] || 1.960;
}

// Percentile computation with linear interpolation (Jain Ch. 11)
function quantile(sortedArr, q) {
  if (!sortedArr.length) return 0;
  if (sortedArr.length === 1) return sortedArr[0];
  const pos = (sortedArr.length - 1) * q;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sortedArr[base + 1] !== undefined) {
    return sortedArr[base] + rest * (sortedArr[base + 1] - sortedArr[base]);
  }
  return sortedArr[base];
}

// Full univariate statistical evaluation (Jain Ch. 11 & 13)
function computeDescriptiveStats(rawValues) {
  const values = rawValues.filter((v) => typeof v === "number" && !isNaN(v));
  const n = values.length;
  if (n === 0) {
    return {
      n: 0, mean: 0, stdev: 0, variance: 0, cov: 0,
      ci90: 0, ci95: 0, ci99: 0,
      median: 0, p25: 0, p75: 0, p90: 0, p95: 0, p99: 0,
      min: 0, max: 0, iqr: 0,
      geoMean: 0, harmonicMean: 0,
      stability: "No data"
    };
  }

  const sum = values.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const variance = n > 1
    ? values.reduce((acc, v) => acc + (v - mean) ** 2, 0) / (n - 1)
    : 0;
  const stdev = Math.sqrt(variance);

  // Coefficient of Variation (CoV = s / mean) — Jain Ch. 11
  // Quantifies relative variability and repeatability of benchmark measurements
  const cov = mean !== 0 ? stdev / Math.abs(mean) : 0;
  let stability = "High Stability (Low Noise)";
  if (cov > 0.35) stability = "High Variability (Noisy)";
  else if (cov > 0.15) stability = "Moderate Variability";

  // Confidence Intervals for the Mean (Jain Ch. 13)
  const se = n > 1 ? stdev / Math.sqrt(n) : 0;
  const ci90 = n > 1 ? getTCritical(n - 1, 90) * se : 0;
  const ci95 = n > 1 ? getTCritical(n - 1, 95) * se : 0;
  const ci99 = n > 1 ? getTCritical(n - 1, 99) * se : 0;

  const sorted = [...values].sort((a, b) => a - b);
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const p25 = quantile(sorted, 0.25);
  const median = quantile(sorted, 0.50);
  const p75 = quantile(sorted, 0.75);
  const p90 = quantile(sorted, 0.90);
  const p95 = quantile(sorted, 0.95);
  const p99 = quantile(sorted, 0.99);
  const iqr = p75 - p25;

  // Geometric Mean (Jain Ch. 11 — recommended for normalized ratios / Speedometer scores)
  let geoMean = 0;
  if (values.every((v) => v > 0)) {
    const logSum = values.reduce((acc, v) => acc + Math.log(v), 0);
    geoMean = Math.exp(logSum / n);
  }

  // Harmonic Mean (Jain Ch. 11 — recommended for rates such as KB/s or req/s)
  let harmonicMean = 0;
  if (values.every((v) => v > 0)) {
    const invSum = values.reduce((acc, v) => acc + 1 / v, 0);
    harmonicMean = n / invSum;
  }

  return {
    n,
    mean,
    stdev,
    variance,
    cov,
    stability,
    ci90,
    ci95,
    ci99,
    median,
    p25,
    p75,
    p90,
    p95,
    p99,
    min,
    max,
    iqr,
    geoMean: geoMean || mean,
    harmonicMean: harmonicMean || mean,
  };
}

// Welch's t-test for comparing two alternatives with unequal variances (Jain Ch. 13 & 14)
function compareTwoAlternatives(sampleA, sampleB, labelA = "A", labelB = "B") {
  const sA = computeDescriptiveStats(sampleA);
  const sB = computeDescriptiveStats(sampleB);

  if (sA.n < 2 || sB.n < 2) {
    return {
      labelA, labelB, diffMean: sA.mean - sB.mean,
      ciLower: 0, ciUpper: 0, isSignificant: false,
      summary: "Sample size too small (n < 2)"
    };
  }

  const diffMean = sA.mean - sB.mean;
  const varA = (sA.stdev ** 2) / sA.n;
  const varB = (sB.stdev ** 2) / sB.n;
  const seDiff = Math.sqrt(varA + varB);

  // Welch-Satterthwaite degrees of freedom
  const dfNum = (varA + varB) ** 2;
  const dfDenom = (varA ** 2) / (sA.n - 1) + (varB ** 2) / (sB.n - 1);
  const df = dfDenom > 0 ? dfNum / dfDenom : Math.min(sA.n - 1, sB.n - 1);

  const tCrit = getTCritical(df, 95);
  const marginOfError = tCrit * seDiff;
  const ciLower = diffMean - marginOfError;
  const ciUpper = diffMean + marginOfError;

  // If 95% CI does not contain zero => Statistically significant difference
  const isSignificant = (ciLower > 0 && ciUpper > 0) || (ciLower < 0 && ciUpper < 0);

  let summary;
  if (!isSignificant) {
    summary = `Difference is within experimental noise (95% CI includes 0).`;
  } else if (diffMean < 0) {
    summary = `${labelA} is faster/lower than ${labelB} by ${Math.abs(diffMean).toFixed(1)} (95% CI: [${ciLower.toFixed(1)}, ${ciUpper.toFixed(1)}]).`;
  } else {
    summary = `${labelA} is higher than ${labelB} by ${diffMean.toFixed(1)} (95% CI: [${ciLower.toFixed(1)}, ${ciUpper.toFixed(1)}]).`;
  }

  return {
    labelA,
    labelB,
    meanA: sA.mean,
    meanB: sB.mean,
    diffMean,
    ciLower,
    ciUpper,
    marginOfError,
    isSignificant,
    summary,
  };
}

// One-Way ANOVA across K Alternatives (Jain Ch. 20)
function computeOneWayAnova(groups) {
  const names = Object.keys(groups);
  const k = names.length;
  if (k < 2) return { isSignificant: false, fStat: 0, summary: "Need at least 2 browsers for ANOVA." };

  let totalN = 0;
  let grandSum = 0;
  const stats = {};

  for (const name of names) {
    const vals = (groups[name] || []).filter((v) => typeof v === "number" && !isNaN(v));
    const n = vals.length;
    const sum = vals.reduce((a, b) => a + b, 0);
    const mean = n > 0 ? sum / n : 0;
    stats[name] = { vals, n, mean };
    totalN += n;
    grandSum += sum;
  }

  if (totalN <= k) return { isSignificant: false, fStat: 0, summary: "Insufficient observations." };

  const grandMean = grandSum / totalN;

  let ssb = 0;
  let ssw = 0;
  for (const name of names) {
    const g = stats[name];
    ssb += g.n * (g.mean - grandMean) ** 2;
    for (const v of g.vals) {
      ssw += (v - g.mean) ** 2;
    }
  }

  const dfB = k - 1;
  const dfW = totalN - k;
  const msb = dfB > 0 ? ssb / dfB : 0;
  const msw = dfW > 0 ? ssw / dfW : 0;
  const fStat = msw > 0 ? msb / msw : 0;

  // Approximate F-critical for alpha = 0.05
  const isSignificant = fStat > 3.35;

  return {
    fStat: Number(fStat.toFixed(2)),
    dfB,
    dfW,
    isSignificant,
    summary: isSignificant
      ? `Statistically significant browser variance confirmed (F = ${fStat.toFixed(2)}, p < 0.05).`
      : `No significant variation between browsers (F = ${fStat.toFixed(2)}, p >= 0.05).`,
  };
}

module.exports = {
  getTCritical,
  computeDescriptiveStats,
  computeStats: computeDescriptiveStats,
  compareTwoAlternatives,
  computeOneWayAnova,
};
