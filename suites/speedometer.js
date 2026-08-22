const { SPEEDOMETER_URL, SPEEDOMETER_TIMEOUT_MS } = require("../core/config");
const { sleep } = require("../core/telemetry");

/**
 * Runs Speedometer 3.0 benchmark and extracts score directly via DOM selector
 */
async function runSpeedometerBenchmark(browserInfo, runNumber) {
  console.log(`  Speedometer run ${runNumber}`);

  const browser = await browserInfo.launch();
  try {
    const page = await browser.newPage();
    page.setDefaultTimeout(SPEEDOMETER_TIMEOUT_MS);

    await page.goto(SPEEDOMETER_URL, { waitUntil: "domcontentloaded", timeout: 45000 });
    
    // Wait for the button in DOM (state: attached handles CSS opacity/transitions)
    const startBtn = page.locator(".start-tests-button, button#start-tests, button:has-text('Start Test')").first();
    await startBtn.waitFor({ state: "attached", timeout: 45000 });
    await sleep(1000);

    // Trigger click with fallback to direct DOM click
    try {
      await startBtn.click({ force: true, timeout: 10000 });
    } catch {
      await page.evaluate(() => {
        const btn = document.querySelector(".start-tests-button, button#start-tests, button");
        if (btn) btn.click();
      });
    }

    console.log(`  Speedometer started for ${browserInfo.name}, running tests...`);

    await page.waitForFunction(
      () => {
        const text = document.body ? document.body.innerText : "";
        const scoreElem = document.querySelector("#result-number, .result-number, .score");
        return (
          (scoreElem && scoreElem.innerText.trim().length > 0) ||
          (text.includes("Score") && (text.includes("±") || text.includes("/min")))
        );
      },
      null,
      { timeout: SPEEDOMETER_TIMEOUT_MS }
    );

    const score = await page.evaluate(() => {
      const el = document.querySelector("#result-number, .result-number, .score");
      if (el && el.innerText.trim().length > 0) {
        const num = parseFloat(el.innerText.trim());
        if (!isNaN(num) && num > 0) return num;
      }
      const match = document.body.innerText.match(/Score\s*\n*\s*(\d+(?:\.\d+)?)/i);
      return match ? parseFloat(match[1]) : null;
    });

    if (!score || isNaN(score)) {
      throw new Error("Score extraction failed.");
    }

    console.log(`  Speedometer score: ${score}`);
    return score;
  } finally {
    await browser.close().catch(() => {});
    await sleep(2000);
  }
}

module.exports = { runSpeedometerBenchmark };
