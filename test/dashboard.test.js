const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

function dashboardContext() {
  const elements = new Map();
  function element(tagName = "div") {
    return { tagName, textContent: "", children: [], style: {},
      append(child) { this.children.push(child); },
      replaceChildren(...children) { this.children = children; },
    };
  }
  const document = {
    getElementById(id) {
      if (!elements.has(id)) elements.set(id, element(id === "rawHead" ? "tr" : "div"));
      return elements.get(id);
    },
    createElement: element,
    createDocumentFragment: () => element("fragment"),
    querySelectorAll: () => [],
  };
  document.getElementById("logFilter").value = "";
  const context = vm.createContext({ document, window: { addEventListener() {} }, console });
  const html = fs.readFileSync(path.join(__dirname, "../dashboard/public/benchmark.html"), "utf8");
  const scripts = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)].filter(([, attributes]) => !attributes.includes("src="));
  vm.runInContext(scripts.at(-1)[2], context);
  return { context, elements };
}

test("Core ranking excludes missing metrics and preserves ties", () => {
  const { context } = dashboardContext();
  const result = vm.runInContext(`coreRanking({
    Chrome: {startup:{n:3,mean:100},cpu:{n:3,mean:0},memory:{n:3,mean:200}},
    Edge: {startup:{n:3,mean:100},cpu:{n:0,mean:0},memory:{n:3,mean:300}},
    Firefox: {startup:{n:0,mean:0},cpu:{n:3,mean:5},memory:{n:3,mean:400}}
  })`, context);
  assert.equal(result.best.startup, "Chrome / Edge");
  assert.equal(result.best.cpu, "Chrome");
  assert.equal(result.wins.Chrome, 3);
  assert.equal(result.wins.Firefox, 0);
});

test("Raw logs render CSV values as text and keep valid table header structure", () => {
  const { context, elements } = dashboardContext();
  vm.runInContext('rawCsvData = { pageloads: [{ Website: "<img src=x onerror=alert(1)>" }] }; renderLogs("pageloads");', context);
  const header = elements.get("rawHead");
  assert.equal(header.children[0].tagName, "th");
  const fragment = elements.get("rawBody").children[0];
  assert.equal(fragment.children[0].children[0].textContent, "<img src=x onerror=alert(1)>");
});
