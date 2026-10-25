const { test } = require("node:test");
const assert = require("node:assert/strict");
const { parseCsvText, numericField } = require("../scripts/csv");

test("CSV preserves empty columns instead of shifting later measurements", () => {
  assert.deepEqual(parseCsvText("Browser,CPU,Memory\nChrome,,128\n"), [{ Browser: "Chrome", CPU: "", Memory: "128" }]);
});

test("CSV supports BOM, CRLF, quoted commas, escaped quotes, and multiline cells", () => {
  assert.deepEqual(parseCsvText('\uFEFFBrowser,Site,Note\r\nChrome,"Hello, world","A ""quote""\nnext line"\r\n'),
    [{ Browser: "Chrome", Site: "Hello, world", Note: 'A "quote"\nnext line' }]);
});

test("CSV ignores blank lines and supports trailing empty fields", () => {
  assert.deepEqual(parseCsvText("A,B,C\n\n1,2,\n"), [{ A: "1", B: "2", C: "" }]);
  assert.deepEqual(parseCsvText(""), []);
  assert.deepEqual(parseCsvText("A,B\n"), []);
});

test("Malformed quoted CSV produces a useful error", () => {
  assert.throws(() => parseCsvText('A\n"unfinished'), /unterminated/);
});

test("Numeric aliases preserve zero and ignore blanks or non-finite numbers", () => {
  assert.equal(numericField({ cpu: "0", peak: "99" }, "cpu", "peak"), 0);
  assert.equal(numericField({ cpu: "", peak: "3.5" }, "cpu", "peak"), 3.5);
  assert.equal(numericField({ cpu: "Infinity" }, "cpu"), null);
});
