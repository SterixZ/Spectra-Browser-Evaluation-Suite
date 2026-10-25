const { test } = require("node:test");
const assert = require("node:assert/strict");
const { getTCritical, computeDescriptiveStats, computeOneWayAnova, compareTwoAlternatives } = require("../scripts/stats");

test("Student's t matches published critical values, including previously missing degrees of freedom", () => {
  for (const [df, confidence, expected] of [[1, 95, 12.7062], [11, 95, 2.2010], [30, 95, 2.0423], [20, 99, 2.8453], [10, 90, 1.8125]]) {
    assert.ok(Math.abs(getTCritical(df, confidence) - expected) < 0.0001);
  }
  assert.ok(getTCritical(11.5) < getTCritical(11));
  assert.ok(getTCritical(11.5) > getTCritical(12));
});

test("Descriptive statistics exclude infinities and retain valid zero samples", () => {
  const stats = computeDescriptiveStats([0, 2, 4, NaN, Infinity, -Infinity]);
  assert.equal(stats.n, 3);
  assert.equal(stats.mean, 2);
  assert.equal(stats.variance, 4);
  assert.equal(stats.median, 2);
});

test("ANOVA uses degrees of freedom instead of a fixed significance threshold", () => {
  // F(1,4) = 6 has p = 0.070484, so the old fixed cutoff of 3.35 was wrong.
  const result = computeOneWayAnova({ Chrome: [1, 2, 3], Edge: [3, 4, 5] });
  assert.equal(result.fStat, 6);
  assert.ok(Math.abs(result.pValue - 0.0704839969) < 1e-9);
  assert.equal(result.isSignificant, false);
  assert.equal(result.dfB, 1);
  assert.equal(result.dfW, 4);
});

test("ANOVA ignores empty groups and handles identical observations", () => {
  const result = computeOneWayAnova({ Chrome: [2, 2, 2], Edge: [2, 2, 2], Firefox: [NaN] });
  assert.equal(result.dfB, 1);
  assert.equal(result.pValue, 1);
  assert.equal(result.isSignificant, false);
});

test("Distinct constant groups remain significant and serialize without Infinity", () => {
  const result = computeOneWayAnova({ Chrome: [1, 1], Edge: [5, 5] });
  assert.equal(result.pValue, 0);
  assert.equal(result.fStat, null);
  assert.equal(result.isSignificant, true);
});

test("Welch comparison does not claim significance without a variance estimate", () => {
  assert.equal(compareTwoAlternatives([1, 1], [2, 2]).isSignificant, false);
  assert.match(compareTwoAlternatives([1], [2]).summary, /too small/);
  assert.equal(compareTwoAlternatives([1, 2, 3], [20, 21, 22]).isSignificant, true);
});
