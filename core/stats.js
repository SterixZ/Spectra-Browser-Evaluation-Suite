// Raj K. Jain, "The Art of Computer Systems Performance Analysis"
// Statistical Analysis Engine: Descriptive, ANOVA, Pairwise t-Tests, and Ratio Game

function computeDescriptiveStats(samples) {
  const valid = (samples || []).filter((v) => typeof v === "number" && !isNaN(v) && v > 0);
  const n = valid.length;
  if (n === 0) {
    return { n: 0, mean: 0, stdDev: 0, stdErr: 0, ci95: 0, median: 0, p90: 0, p99: 0, iqr: 0, cov: 0, min: 0, max: 0, geoMean: 0 };
  }

  const sorted = [...valid].sort((a, b) => a - b);
  const sum = sorted.reduce((a, b) => a + b, 0);
  const mean = sum / n;

  const variance = n > 1 ? sorted.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / (n - 1) : 0;
  const stdDev = Math.sqrt(variance);
  const stdErr = stdDev / Math.sqrt(n);

  // t-multiplier approximation for 95% Confidence Interval
  let t = 1.96;
  const tTable = { 1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 20: 2.086, 30: 2.042 };
  if (n > 1) {
    const df = n - 1;
    t = tTable[df] || (df < 10 ? 2.3 : df < 20 ? 2.1 : 1.96);
  }
  const ci95 = t * stdErr;

  const percentile = (p) => {
    if (n === 1) return sorted[0];
    const index = (p / 100) * (n - 1);
    const lower = Math.floor(index);
    const upper = Math.ceil(index);
    const weight = index - lower;
    return sorted[lower] * (1 - weight) + sorted[upper] * weight;
  };

  const median = percentile(50);
  const p25 = percentile(25);
  const p75 = percentile(75);
  const p90 = percentile(90);
  const p99 = percentile(99);
  const iqr = p75 - p25;
  const cov = mean > 0 ? stdDev / mean : 0;

  const logSum = sorted.reduce((acc, val) => acc + Math.log(val > 0 ? val : 1), 0);
  const geoMean = Math.exp(logSum / n);

  return {
    n,
    mean: Number(mean.toFixed(2)),
    stdDev: Number(stdDev.toFixed(2)),
    stdErr: Number(stdErr.toFixed(2)),
    ci95: Number(ci95.toFixed(2)),
    median: Number(median.toFixed(2)),
    p90: Number(p90.toFixed(2)),
    p99: Number(p99.toFixed(2)),
    iqr: Number(iqr.toFixed(2)),
    cov: Number(cov.toFixed(3)),
    min: Number(sorted[0].toFixed(2)),
    max: Number(sorted[sorted.length - 1].toFixed(2)),
    geoMean: Number(geoMean.toFixed(2)),
  };
}

function compareTwoAlternatives(samplesA, samplesB, nameA = "Browser A", nameB = "Browser B") {
  const statsA = computeDescriptiveStats(samplesA);
  const statsB = computeDescriptiveStats(samplesB);

  if (statsA.n < 2 || statsB.n < 2) {
    return {
      diffMean: statsA.mean - statsB.mean,
      ciLower: 0,
      ciUpper: 0,
      isSignificant: false,
      summary: "Insufficient sample size (n < 2).",
    };
  }

  const meanDiff = statsA.mean - statsB.mean;
  const seDiff = Math.sqrt(Math.pow(statsA.stdDev, 2) / statsA.n + Math.pow(statsB.stdDev, 2) / statsB.n);

  const dfNum = Math.pow(Math.pow(statsA.stdDev, 2) / statsA.n + Math.pow(statsB.stdDev, 2) / statsB.n, 2);
  const dfDen =
    Math.pow(Math.pow(statsA.stdDev, 2) / statsA.n, 2) / (statsA.n - 1) +
    Math.pow(Math.pow(statsB.stdDev, 2) / statsB.n, 2) / (statsB.n - 1);
  const df = Math.max(1, Math.round(dfNum / (dfDen || 1)));

  let t = 1.96;
  const tTable = { 1: 12.71, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365, 8: 2.306, 9: 2.262, 10: 2.228, 20: 2.086, 30: 2.042 };
  t = tTable[df] || (df < 10 ? 2.3 : df < 20 ? 2.1 : 1.96);

  const halfWidth = t * seDiff;
  const ciLower = meanDiff - halfWidth;
  const ciUpper = meanDiff + halfWidth;

  const isSignificant = (ciLower > 0 && ciUpper > 0) || (ciLower < 0 && ciUpper < 0);

  let summary = "";
  if (isSignificant) {
    const faster = meanDiff < 0 ? nameA : nameB;
    summary = `Statistically significant difference detected (95% CI: [${ciLower.toFixed(1)}, ${ciUpper.toFixed(1)}]). ${faster} is superior.`;
  } else {
    summary = `Difference is within experimental noise (95% CI: [${ciLower.toFixed(1)}, ${ciUpper.toFixed(1)}] spans zero). No statistically significant difference.`;
  }

  return {
    diffMean: Number(meanDiff.toFixed(2)),
    ciLower: Number(ciLower.toFixed(2)),
    ciUpper: Number(ciUpper.toFixed(2)),
    isSignificant,
    summary,
  };
}

function computeOneWayAnova(groups) {
  const keys = Object.keys(groups);
  const k = keys.length;
  if (k < 2) return { isSignificant: false, summary: "ANOVA requires >= 2 alternatives." };

  let grandSum = 0;
  let totalN = 0;
  const groupStats = {};

  keys.forEach((key) => {
    const samples = (groups[key] || []).filter((v) => typeof v === "number" && !isNaN(v) && v > 0);
    const n = samples.length;
    const sum = samples.reduce((a, b) => a + b, 0);
    const mean = n > 0 ? sum / n : 0;
    groupStats[key] = { n, sum, mean, samples };
    grandSum += sum;
    totalN += n;
  });

  if (totalN <= k) return { isSignificant: false, summary: "Insufficient total observations for ANOVA." };

  const grandMean = grandSum / totalN;

  let ssb = 0;
  let ssw = 0;

  keys.forEach((key) => {
    const { n, mean, samples } = groupStats[key];
    if (n > 0) {
      ssb += n * Math.pow(mean - grandMean, 2);
      samples.forEach((val) => {
        ssw += Math.pow(val - mean, 2);
      });
    }
  });

  const dfBetween = k - 1;
  const dfWithin = totalN - k;

  const msb = ssb / dfBetween;
  const msw = dfWithin > 0 ? ssw / dfWithin : 1;
  const fRatio = msb / (msw || 1);

  const isSignificant = fRatio > 3.0;

  return {
    k,
    totalN,
    fRatio: Number(fRatio.toFixed(2)),
    dfBetween,
    dfWithin,
    isSignificant,
    summary: isSignificant
      ? `Statistically significant browser variance confirmed (F = ${fRatio.toFixed(2)}, p < 0.05).`
      : `No significant variation between browsers (F = ${fRatio.toFixed(2)}, p >= 0.05).`,
  };
}

module.exports = {
  computeDescriptiveStats,
  compareTwoAlternatives,
  computeOneWayAnova,
};
