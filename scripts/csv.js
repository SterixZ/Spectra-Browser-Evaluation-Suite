const fs = require("node:fs");

// Preserve empty columns, quoted commas/newlines, escaped quotes, and UTF-8 BOMs.
function parseCsvText(text) {
  const records = [];
  let record = [], field = "", quoted = false;
  text = text.replace(/^\uFEFF/, "");
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i++; }
      else quoted = !quoted;
    } else if (char === "," && !quoted) {
      record.push(field); field = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      record.push(field);
      if (record.some(value => value.trim() !== "")) records.push(record);
      record = []; field = "";
    } else field += char;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  record.push(field);
  if (record.some(value => value.trim() !== "")) records.push(record);
  if (!records.length) return [];
  const headers = records.shift().map(value => value.trim());
  return records.map(values => Object.fromEntries(headers.map((key, i) => [key, (values[i] ?? "").trim()])));
}

function parseCsv(filepath) {
  return fs.existsSync(filepath) ? parseCsvText(fs.readFileSync(filepath, "utf8")) : [];
}

// Empty cells are missing observations; numeric zero remains a valid observation.
function numericField(row, ...keys) {
  for (const key of keys) {
    const value = row[key];
    if (value == null || String(value).trim() === "") continue;
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

module.exports = { parseCsv, parseCsvText, numericField };
