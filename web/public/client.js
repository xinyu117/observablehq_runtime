import { Inspector, Runtime } from "./runtime.5f2a81f8.js";
import { Generators, Mutable, FileAttachment, resize } from "./stdlib.e82a6a1a.js";

var __defProp$6 = Object.defineProperty;
var __name$6 = (target, value) => __defProp$6(target, "name", { value, configurable: true });
const copyButton = document.createElement("template");
copyButton.innerHTML = '<button title="Copy code" class="observablehq-pre-copy"><svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="2"><path d="M2 6C2 5.44772 2.44772 5 3 5H10C10.5523 5 11 5.44772 11 6V13C11 13.5523 10.5523 14 10 14H3C2.44772 14 2 13.5523 2 13V6Z M4 2.00004L12 2.00001C13.1046 2 14 2.89544 14 4.00001V12"></path></svg></button>';
enableCopyButtons();
function enableCopyButtons() {
  for (const pre of document.querySelectorAll("pre:not([data-copy=none])")) {
    const parent = pre.parentNode;
    if (parent.classList.contains("observablehq-pre-container")) continue;
    const div = parent.insertBefore(document.createElement("div"), pre);
    div.className = "observablehq-pre-container";
    Object.assign(div.dataset, pre.dataset);
    div.appendChild(copyButton.content.cloneNode(true).firstChild).addEventListener("click", copy);
    div.appendChild(pre);
  }
}
__name$6(enableCopyButtons, "enableCopyButtons");
async function copy({ currentTarget: target }) {
  await navigator.clipboard.writeText(target.nextElementSibling.textContent.trim());
  const [animation] = target.getAnimations({ subtree: true });
  if (animation) animation.currentTime = 0;
  target.classList.add("observablehq-pre-copied");
  target.addEventListener("animationend", () => target.classList.remove("observablehq-pre-copied"), { once: true });
}
__name$6(copy, "copy");

var __defProp$5 = Object.defineProperty;
var __name$5 = (target, value) => __defProp$5(target, "name", { value, configurable: true });
const toggle = document.querySelector("#observablehq-sidebar-toggle");
if (toggle) {
  let indeterminate = toggle.indeterminate;
  const match = /* @__PURE__ */ __name$5(() => matchMedia("(min-width: calc(640px + 6rem + 272px))").matches, "match");
  toggle.onclick = () => {
    const matches = match();
    if (indeterminate) toggle.checked = !matches, indeterminate = false;
    else if (toggle.checked === matches) indeterminate = true;
    toggle.indeterminate = indeterminate;
    if (indeterminate) sessionStorage.removeItem("observablehq-sidebar");
    else sessionStorage.setItem("observablehq-sidebar", toggle.checked);
  };
  addEventListener("keydown", (event) => {
    if (event.code === "Escape" && !match() && (!toggle.indeterminate && toggle.checked && (event.target === document.body || event.target === toggle) || event.target?.closest("#observablehq-sidebar"))) {
      toggle.click();
    }
  });
  addEventListener("keypress", (event) => {
    if (event.code === "KeyB" && (event.metaKey || event.altKey) && !event.ctrlKey && (event.target === document.body || event.target === toggle || event.target?.closest("#observablehq-sidebar"))) {
      toggle.click();
      event.preventDefault();
    }
  });
  const title = `Toggle sidebar ${/Mac|iPhone/.test(navigator.platform) ? /Firefox/.test(navigator.userAgent) ? "\u2325" : "\u2318" : "Alt-"}B`;
  for (const label of document.querySelectorAll(
    "#observablehq-sidebar-toggle, label[for='observablehq-sidebar-toggle']"
  )) {
    label.title = title;
  }
}
function preventDoubleClick(event) {
  if (event.detail > 1) event.preventDefault();
}
__name$5(preventDoubleClick, "preventDoubleClick");
function persistOpen() {
  sessionStorage.setItem(`observablehq-sidebar:${this.firstElementChild.textContent}`, this.open);
}
__name$5(persistOpen, "persistOpen");
for (const summary of document.querySelectorAll("#observablehq-sidebar summary")) {
  summary.onmousedown = preventDoubleClick;
  summary.parentElement.ontoggle = persistOpen;
}

var __defProp$4 = Object.defineProperty;
var __name$4 = (target, value) => __defProp$4(target, "name", { value, configurable: true });
const toc = document.querySelector("#observablehq-toc");
if (toc) {
  const highlight = toc.appendChild(document.createElement("div"));
  highlight.classList.add("observablehq-secondary-link-highlight");
  const main = document.querySelector("#observablehq-main");
  const headings = Array.from(main.querySelectorAll(toc.dataset.selector)).reverse();
  const links = toc.querySelectorAll(".observablehq-secondary-link");
  const relink = /* @__PURE__ */ __name$4(() => {
    for (const link of links) {
      link.classList.remove("observablehq-secondary-link-active");
    }
    if (location.hash) {
      for (const heading of headings) {
        const hash = encodeURI(`#${heading.id}`);
        if (hash === location.hash) {
          const top = heading.getBoundingClientRect().top;
          if (0 < top && top < 40) {
            for (const link of links) {
              if (link.querySelector("a[href]")?.hash === hash) {
                link.classList.add("observablehq-secondary-link-active");
                return link;
              }
            }
            return;
          }
          break;
        }
      }
    }
    for (const heading of headings) {
      if (heading.getBoundingClientRect().top >= innerHeight * 0.5) continue;
      const hash = heading.querySelector("a[href]")?.hash;
      for (const link of links) {
        if (link.querySelector("a[href]")?.hash === hash) {
          link.classList.add("observablehq-secondary-link-active");
          return link;
        }
      }
      break;
    }
  }, "relink");
  const intersected = /* @__PURE__ */ __name$4(() => {
    const link = relink();
    highlight.style.cssText = link ? `top: ${link.offsetTop}px; height: ${link.offsetHeight}px;` : "";
  }, "intersected");
  const observer = new IntersectionObserver(intersected, { rootMargin: "0px 0px -50% 0px" });
  for (const heading of headings) observer.observe(heading);
}

var __defProp$3 = Object.defineProperty;
var __name$3 = (target, value) => __defProp$3(target, "name", { value, configurable: true });
function inspect(value, expanded) {
  const node = document.createElement("div");
  new Inspector(node).fulfilled(value);
  if (expanded) {
    for (const path of expanded) {
      let child = node;
      for (const i of path) child = child?.childNodes[i];
      child?.dispatchEvent(new Event("mouseup"));
    }
  }
  return node;
}
__name$3(inspect, "inspect");
function inspectError(value) {
  const node = document.createElement("div");
  new Inspector(node).rejected(value);
  node.classList.add("observablehq--error");
  return node;
}
__name$3(inspectError, "inspectError");

var __defProp$2 = Object.defineProperty;
var __name$2 = (target, value) => __defProp$2(target, "name", { value, configurable: true });
const _ = /* @__PURE__ */ __name$2(() => import("../_npm/lodash@4.18.1/3978b7c7.js").then((lodash) => lodash.default), "_");
const aq = /* @__PURE__ */ __name$2(() => import('../_npm/arquero@8.0.3/_esm.js'), "aq");
const Arrow = /* @__PURE__ */ __name$2(() => import('../_npm/apache-arrow@21.1.0/_esm.js'), "Arrow");
const d3 = /* @__PURE__ */ __name$2(() => import("../_npm/d3@7.9.0/66d82917.js"), "d3");
const dot = /* @__PURE__ */ __name$2(() => import('./stdlib/dot.js').then((dot2) => dot2.default), "dot");
const duckdb = /* @__PURE__ */ __name$2(() => import('../_npm/@duckdb/duckdb-wasm@1.29.0/_esm.js'), "duckdb");
const DuckDBClient = /* @__PURE__ */ __name$2(() => import('./stdlib/duckdb.js').then((duckdb2) => duckdb2.DuckDBClient), "DuckDBClient");
const echarts = /* @__PURE__ */ __name$2(() => import('../_npm/echarts@6.0.0/dist/echarts.esm.min.js._esm.js'), "echarts");
const htl = /* @__PURE__ */ __name$2(() => import("../_npm/htl@0.3.1/72f4716c.js"), "htl");
const html = /* @__PURE__ */ __name$2(() => import("../_npm/htl@0.3.1/72f4716c.js").then((htl2) => htl2.html), "html");
const svg = /* @__PURE__ */ __name$2(() => import("../_npm/htl@0.3.1/72f4716c.js").then((htl2) => htl2.svg), "svg");
const Inputs = /* @__PURE__ */ __name$2(() => import("./stdlib/inputs.a2f1f90e.js"), "Inputs");
const L = /* @__PURE__ */ __name$2(() => import('../_npm/leaflet@1.9.4/_esm.js'), "L");
const mapboxgl = /* @__PURE__ */ __name$2(() => import('../_npm/mapbox-gl@3.21.0/_esm.js').then((module) => module.default), "mapboxgl");
const mermaid = /* @__PURE__ */ __name$2(() => import('./stdlib/mermaid.js').then((mermaid2) => mermaid2.default), "mermaid");
const Plot = /* @__PURE__ */ __name$2(() => import('../_npm/@observablehq/plot@0.6.17/_esm.js'), "Plot");
const React = /* @__PURE__ */ __name$2(() => import("../_npm/react@19.2.5/7aa7fa53.js"), "React");
const ReactDOM = /* @__PURE__ */ __name$2(() => import("../_npm/react-dom@19.2.5/client.27878cbd.js"), "ReactDOM");
const sql = /* @__PURE__ */ __name$2(() => import('./stdlib/duckdb.js').then((duckdb2) => duckdb2.sql), "sql");
const SQLite = /* @__PURE__ */ __name$2(() => import('./stdlib/sqlite.js').then((sqlite) => sqlite.default), "SQLite");
const SQLiteDatabaseClient = /* @__PURE__ */ __name$2(() => import('./stdlib/sqlite.js').then((sqlite) => sqlite.SQLiteDatabaseClient), "SQLiteDatabaseClient");
const tex = /* @__PURE__ */ __name$2(() => import('./stdlib/tex.js').then((tex2) => tex2.default), "tex");
const topojson = /* @__PURE__ */ __name$2(() => import('../_npm/topojson-client@3.1.0/_esm.js'), "topojson");
const vg = /* @__PURE__ */ __name$2(() => import('./stdlib/vgplot.js').then((vg2) => vg2.default()), "vg");
const vl = /* @__PURE__ */ __name$2(() => import('./stdlib/vega-lite.js').then((vl2) => vl2.default), "vl");

var recommendedLibraries = /*#__PURE__*/Object.freeze({
  __proto__: null,
  Arrow: Arrow,
  DuckDBClient: DuckDBClient,
  Inputs: Inputs,
  L: L,
  Plot: Plot,
  React: React,
  ReactDOM: ReactDOM,
  SQLite: SQLite,
  SQLiteDatabaseClient: SQLiteDatabaseClient,
  _: _,
  aq: aq,
  d3: d3,
  dot: dot,
  duckdb: duckdb,
  echarts: echarts,
  htl: htl,
  html: html,
  mapboxgl: mapboxgl,
  mermaid: mermaid,
  sql: sql,
  svg: svg,
  tex: tex,
  topojson: topojson,
  vg: vg,
  vl: vl
});

var __defProp$1 = Object.defineProperty;
var __name$1 = (target, value) => __defProp$1(target, "name", { value, configurable: true });
const aapl = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/aapl.csv"), true), "aapl");
const alphabet = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/alphabet.csv"), true), "alphabet");
const cars = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/cars.csv"), true), "cars");
const citywages = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/citywages.csv"), true), "citywages");
const diamonds = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/diamonds.csv"), true), "diamonds");
const flare = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/flare.csv"), true), "flare");
const industries = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/industries.csv"), true), "industries");
const miserables = /* @__PURE__ */ __name$1(() => json(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/miserables.json")), "miserables");
const olympians = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/olympians.csv"), true), "olympians");
const penguins = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/penguins.csv"), true), "penguins");
const pizza = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/pizza.csv"), true), "pizza");
const weather = /* @__PURE__ */ __name$1(() => csv(import.meta.resolve("../_npm/@observablehq/sample-datasets@1.0.1/weather.csv"), true), "weather");
async function json(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`unable to fetch ${url}: status ${response.status}`);
  return response.json();
}
__name$1(json, "json");
async function text(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`unable to fetch ${url}: status ${response.status}`);
  return response.text();
}
__name$1(text, "text");
async function csv(url, typed) {
  const [contents, d3] = await Promise.all([text(url), import("../_npm/d3-dsv@3.0.1/9cffc2bd.js")]);
  return d3.csvParse(contents, typed && d3.autoType);
}
__name$1(csv, "csv");

var sampleDatasets = /*#__PURE__*/Object.freeze({
  __proto__: null,
  aapl: aapl,
  alphabet: alphabet,
  cars: cars,
  citywages: citywages,
  diamonds: diamonds,
  flare: flare,
  industries: industries,
  miserables: miserables,
  olympians: olympians,
  penguins: penguins,
  pizza: pizza,
  weather: weather
});

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const library = {
  now: /* @__PURE__ */ __name(() => Generators.now(), "now"),
  width: /* @__PURE__ */ __name(() => Generators.width(document.querySelector("main")), "width"),
  dark: /* @__PURE__ */ __name(() => Generators.dark(), "dark"),
  resize: /* @__PURE__ */ __name(() => resize, "resize"),
  FileAttachment: /* @__PURE__ */ __name(() => FileAttachment, "FileAttachment"),
  Generators: /* @__PURE__ */ __name(() => Generators, "Generators"),
  Mutable: /* @__PURE__ */ __name(() => Mutable, "Mutable"),
  ...recommendedLibraries,
  ...sampleDatasets
};
const runtime = new Runtime(library);
const main = runtime.module();
const cellsById = /* @__PURE__ */ new Map();
const rootsById = findRoots(document.body);
function define(cell) {
  const { id, mode, inputs = [], outputs = [], body } = cell;
  const variables = [];
  cellsById.set(id, { cell, variables });
  const root = rootsById.get(id);
  const loading = findLoading(root);
  root._nodes = [];
  if (mode === void 0) root._expanded = [];
  if (loading) root._nodes.push(loading);
  const pending = /* @__PURE__ */ __name(() => reset(root, loading), "pending");
  const rejected = /* @__PURE__ */ __name((error) => reject(root, error), "rejected");
  const v = main.variable({ _node: root.parentNode, pending, rejected }, { shadow: {} });
  if (inputs.includes("display") || inputs.includes("displayAsync") || inputs.includes("view") || inputs.includes("viewAsync")) {
    let displayVersion = -1;
    const predisplay = mode === "jsx" ? noop : clear;
    const display = mode === "inline" ? displayInline : mode === "jsx" ? displayJsx : displayBlock;
    const vd = new v.constructor(2, v._module);
    vd.define(
      inputs.filter((i) => i !== "display" && i !== "view"),
      () => {
        let version = v._version;
        return (value) => {
          if (version < displayVersion) throw new Error("stale display");
          else if (version > displayVersion) predisplay(root);
          displayVersion = version;
          display(root, value);
          return value;
        };
      }
    );
    v._shadow.set("display", vd);
    if (inputs.includes("view")) {
      const vv = new v.constructor(2, v._module, null, { shadow: {} });
      vv._shadow.set("display", vd);
      vv.define(["display"], (display2) => (v2) => Generators.input(display2(v2)));
      v._shadow.set("view", vv);
    }
  }
  v.define(outputs.length ? `cell ${id}` : null, inputs, body);
  variables.push(v);
  for (const o of outputs) variables.push(main.variable(true).define(o, [`cell ${id}`], (exports$1) => exports$1[o]));
}
__name(define, "define");
function noop() {
}
__name(noop, "noop");
function clear(root) {
  if (root._expanded) root._expanded = root._nodes.map(getExpanded);
  root._nodes.forEach((v) => v.remove());
  root._nodes.length = 0;
}
__name(clear, "clear");
function reset(root, loading) {
  if (root._error) {
    root._error = false;
    clear(root);
    if (loading) displayNode(root, loading);
  }
}
__name(reset, "reset");
function reject(root, error) {
  console.error(error);
  root._error = true;
  clear(root);
  displayNode(root, inspectError(error));
}
__name(reject, "reject");
function displayJsx(root, value) {
  return (root._root ??= import("../_npm/react-dom@19.2.5/client.27878cbd.js").then(({ createRoot }) => {
    const node = document.createElement("DIV");
    return [node, createRoot(node)];
  })).then(([node, client]) => {
    if (!node.parentNode) {
      root._nodes.push(node);
      root.parentNode.insertBefore(node, root);
    }
    client.render(value);
  });
}
__name(displayJsx, "displayJsx");
function displayNode(root, node) {
  if (node.nodeType === 11) {
    let child;
    while (child = node.firstChild) {
      root._nodes.push(child);
      root.parentNode.insertBefore(child, root);
    }
  } else {
    root._nodes.push(node);
    root.parentNode.insertBefore(node, root);
  }
}
__name(displayNode, "displayNode");
function displayInline(root, value) {
  if (isNode(value)) {
    displayNode(root, value);
  } else if (typeof value === "string" || !value?.[Symbol.iterator]) {
    displayNode(root, document.createTextNode(value));
  } else {
    for (const v of value) {
      displayNode(root, isNode(v) ? v : document.createTextNode(v));
    }
  }
}
__name(displayInline, "displayInline");
function displayBlock(root, value) {
  displayNode(root, isNode(value) ? value : inspect(value, root._expanded[root._nodes.length]));
}
__name(displayBlock, "displayBlock");
function undefine(id) {
  clear(rootsById.get(id));
  cellsById.get(id).variables.forEach((v) => v.delete());
  cellsById.delete(id);
}
__name(undefine, "undefine");
function isNode(value) {
  return value instanceof Node && value instanceof value.constructor;
}
__name(isNode, "isNode");
function findRoots(root) {
  const roots = /* @__PURE__ */ new Map();
  const iterator = document.createNodeIterator(root, 128, null);
  let node;
  while (node = iterator.nextNode()) {
    if (isRoot(node)) {
      roots.set(node.data.slice(1, -1), node);
    }
  }
  return roots;
}
__name(findRoots, "findRoots");
function isRoot(node) {
  return node.nodeType === 8 && /^:[0-9a-f]{8}(?:-\d+)?:$/.test(node.data);
}
__name(isRoot, "isRoot");
function isLoading(node) {
  return node.nodeType === 1 && node.tagName === "OBSERVABLEHQ-LOADING";
}
__name(isLoading, "isLoading");
function findLoading(root) {
  const sibling = root.previousSibling;
  return sibling && isLoading(sibling) ? sibling : null;
}
__name(findLoading, "findLoading");
function registerRoot(id, node) {
  if (node == null) rootsById.delete(id);
  else rootsById.set(id, node);
}
__name(registerRoot, "registerRoot");
function getExpanded(node) {
  if (node.nodeType !== 1 || !node.classList.contains("observablehq")) return;
  const expanded = node.querySelectorAll(".observablehq--expanded");
  if (expanded.length) return Array.from(expanded, (e) => getNodePath(node, e));
}
__name(getExpanded, "getExpanded");
function getNodePath(node, descendant) {
  const path = [];
  while (descendant !== node) {
    path.push(getChildIndex(descendant));
    descendant = descendant.parentNode;
  }
  return path.reverse();
}
__name(getNodePath, "getNodePath");
function getChildIndex(node) {
  return Array.prototype.indexOf.call(node.parentNode.childNodes, node);
}
__name(getChildIndex, "getChildIndex");

export { define };
