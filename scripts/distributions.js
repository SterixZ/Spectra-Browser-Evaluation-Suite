// Regularized incomplete beta, used by Student's t and F distributions.
// Distribution definitions: https://itl.nist.gov/div898/handbook/eda/section3/eda3665.htm
function logGamma(z) {
  const coefficients = [676.5203681218851, -1259.1392167224028, 771.3234287776531,
    -176.6150291621406, 12.507343278686905, -0.13857109526572012,
    9.984369578019572e-6, 1.5056327351493116e-7];
  if (z < 0.5) return Math.log(Math.PI) - Math.log(Math.sin(Math.PI * z)) - logGamma(1 - z);
  z -= 1;
  let sum = 0.9999999999998099;
  coefficients.forEach((value, i) => { sum += value / (z + i + 1); });
  const t = z + 7.5;
  return 0.5 * Math.log(2 * Math.PI) + (z + 0.5) * Math.log(t) - t + Math.log(sum);
}

function betaFraction(a, b, x) {
  const tiny = 1e-30;
  const nonzero = value => Math.abs(value) < tiny ? tiny : value;
  let c = 1, d = 1 / nonzero(1 - (a + b) * x / (a + 1)), result = d;
  for (let m = 1; m <= 300; m++) {
    let coefficient = m * (b - m) * x / ((a + 2 * m - 1) * (a + 2 * m));
    d = 1 / nonzero(1 + coefficient * d);
    c = nonzero(1 + coefficient / c);
    result *= d * c;
    coefficient = -(a + m) * (a + b + m) * x / ((a + 2 * m) * (a + 2 * m + 1));
    d = 1 / nonzero(1 + coefficient * d);
    c = nonzero(1 + coefficient / c);
    const delta = d * c;
    result *= delta;
    if (Math.abs(delta - 1) < 1e-12) return result;
  }
  throw new Error("Incomplete beta did not converge.");
}

function regularizedBeta(x, a, b) {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const factor = Math.exp(logGamma(a + b) - logGamma(a) - logGamma(b)
    + a * Math.log(x) + b * Math.log1p(-x));
  const value = x < (a + 1) / (a + b + 2)
    ? factor * betaFraction(a, b, x) / a
    : 1 - factor * betaFraction(b, a, 1 - x) / b;
  return Math.max(0, Math.min(1, value));
}

function tCritical(df, confidence = 95) {
  if (!Number.isFinite(df) || df <= 0) throw new RangeError("Degrees of freedom must be positive and finite.");
  if (![90, 95, 99].includes(confidence)) confidence = 95;
  const tail = 1 - confidence / 100;
  const probability = t => regularizedBeta(df / (df + t * t), df / 2, 0.5);
  let low = 0, high = 1;
  while (probability(high) > tail) high *= 2;
  for (let i = 0; i < 65; i++) {
    const mid = (low + high) / 2;
    if (probability(mid) > tail) low = mid;
    else high = mid;
  }
  return (low + high) / 2;
}

function fSurvival(f, numeratorDf, denominatorDf) {
  if (f === Infinity) return 0;
  return regularizedBeta(denominatorDf / (denominatorDf + numeratorDf * f), denominatorDf / 2, numeratorDf / 2);
}

module.exports = { tCritical, fSurvival };
