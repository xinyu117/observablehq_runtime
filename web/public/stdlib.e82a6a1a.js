var __defProp$8 = Object.defineProperty;
var __name$8 = (target, value) => __defProp$8(target, "name", { value, configurable: true });
const files = /* @__PURE__ */ new Map();
function registerFile(name, info, base = location) {
  const href = new URL(name, base).href;
  if (info == null) {
    files.delete(href);
  } else {
    const { path, mimeType, lastModified, size } = info;
    const file = new FileAttachmentImpl(new URL(path, base).href, name.split("/").pop(), mimeType, lastModified, size);
    files.set(href, file);
    return file;
  }
}
__name$8(registerFile, "registerFile");
function FileAttachment(name, base = location) {
  if (new.target !== void 0) throw new TypeError("FileAttachment is not a constructor");
  let info;
  if (typeof name === "object" && name && "name" in name) info = name, name = name.name;
  const file = files.get(new URL(name, base).href);
  if (file) return file;
  if (info) return registerFile(name, info, base);
  throw new Error(`File not found: ${name}`);
}
__name$8(FileAttachment, "FileAttachment");
async function remote_fetch(file) {
  const response = await fetch(await file.url());
  if (!response.ok) throw new Error(`Unable to load file: ${file.name}`);
  return response;
}
__name$8(remote_fetch, "remote_fetch");
const _AbstractFile = class _AbstractFile {
  constructor(name, mimeType = "application/octet-stream", lastModified, size) {
    Object.defineProperties(this, {
      name: { value: `${name}`, enumerable: true },
      mimeType: { value: `${mimeType}`, enumerable: true },
      lastModified: { value: +lastModified, enumerable: true },
      size: { value: +size, enumerable: true }
    });
  }
  async blob() {
    return (await remote_fetch(this)).blob();
  }
  async arrayBuffer() {
    return (await remote_fetch(this)).arrayBuffer();
  }
  async text(encoding) {
    return encoding === void 0 ? (await remote_fetch(this)).text() : new TextDecoder(encoding).decode(await this.arrayBuffer());
  }
  async json() {
    return (await remote_fetch(this)).json();
  }
  async stream() {
    return (await remote_fetch(this)).body;
  }
  async dsv({ delimiter = ",", array = false, typed = false } = {}) {
    const [text, d3] = await Promise.all([this.text(), import("../_npm/d3-dsv@3.0.1/9cffc2bd.js")]);
    const format = d3.dsvFormat(delimiter);
    const parse = array ? format.parseRows : format.parse;
    return parse(text, typed && d3.autoType);
  }
  async csv(options) {
    return this.dsv({ ...options, delimiter: "," });
  }
  async tsv(options) {
    return this.dsv({ ...options, delimiter: "	" });
  }
  async image(props) {
    const url = await this.url();
    return new Promise((resolve, reject) => {
      const i = new Image();
      if (new URL(url, document.baseURI).origin !== new URL(location).origin) i.crossOrigin = "anonymous";
      Object.assign(i, props);
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error(`Unable to load file: ${this.name}`));
      i.src = url;
    });
  }
  async arrow() {
    const [Arrow, response] = await Promise.all([import('../_npm/apache-arrow@21.1.0/_esm.js'), remote_fetch(this)]);
    return Arrow.tableFromIPC(response);
  }
  async arquero(options) {
    let request;
    let from;
    switch (this.mimeType) {
      case "application/json":
        request = this.text();
        from = "fromJSON";
        break;
      case "text/tab-separated-values":
        if (options?.delimiter === void 0) options = { ...options, delimiter: "	" };
      // fall through
      case "text/csv":
        request = this.text();
        from = "fromCSV";
        break;
      default:
        if (/\.arrow$/i.test(this.name)) {
          request = this.arrow();
          from = "fromArrow";
        } else if (/\.parquet$/i.test(this.name)) {
          request = this.parquet();
          from = "fromArrow";
        } else {
          throw new Error(`unable to determine Arquero loader: ${this.name}`);
        }
        break;
    }
    const [aq, body] = await Promise.all([import('../_npm/arquero@8.0.3/_esm.js'), request]);
    return aq[from](body, options);
  }
  async parquet() {
    const [Arrow, Parquet, buffer] = await Promise.all([import('../_npm/apache-arrow@21.1.0/_esm.js'), import('../_npm/parquet-wasm@0.7.1/_esm.js').then(async (Parquet2) => (await Parquet2.default(import.meta.resolve("../_npm/parquet-wasm@0.7.1/esm/parquet_wasm_bg.wasm")), Parquet2)), this.arrayBuffer()]);
    return Arrow.tableFromIPC(Parquet.readParquet(new Uint8Array(buffer)).intoIPCStream());
  }
  async sqlite() {
    const [{ SQLiteDatabaseClient }, response] = await Promise.all([import('./stdlib/sqlite.js'), this.arrayBuffer()]);
    return SQLiteDatabaseClient.open(response);
  }
  async zip() {
    const [{ ZipArchive }, buffer] = await Promise.all([import('./stdlib/zip.js'), this.arrayBuffer()]);
    return ZipArchive.from(buffer);
  }
  async xml(mimeType = "application/xml") {
    return new DOMParser().parseFromString(await this.text(), mimeType);
  }
  async html() {
    return this.xml("text/html");
  }
  async xlsx() {
    const [{ Workbook }, buffer] = await Promise.all([import('./stdlib/xlsx.js'), this.arrayBuffer()]);
    return Workbook.load(buffer);
  }
};
__name$8(_AbstractFile, "AbstractFile");
let AbstractFile = _AbstractFile;
const _FileAttachmentImpl = class _FileAttachmentImpl extends AbstractFile {
  constructor(href, name, mimeType, lastModified, size) {
    super(name, mimeType, lastModified, size);
    Object.defineProperty(this, "href", { value: href });
  }
  async url() {
    return this.href;
  }
};
__name$8(_FileAttachmentImpl, "FileAttachmentImpl");
let FileAttachmentImpl = _FileAttachmentImpl;
Object.defineProperty(FileAttachmentImpl, "name", { value: "FileAttachment" });
FileAttachment.prototype = FileAttachmentImpl.prototype;

var __defProp$7 = Object.defineProperty;
var __name$7 = (target, value) => __defProp$7(target, "name", { value, configurable: true });
async function* observe(initialize) {
  let resolve;
  let value;
  let stale = false;
  const dispose = initialize((x) => {
    value = x;
    if (resolve) resolve(x), resolve = null;
    else stale = true;
    return x;
  });
  if (dispose != null && typeof dispose !== "function") {
    throw new Error(
      typeof dispose.then === "function" ? "async initializers are not supported" : "initializer returned something, but not a dispose function"
    );
  }
  try {
    while (true) {
      yield stale ? (stale = false, value) : new Promise((_) => resolve = _);
    }
  } finally {
    if (dispose != null) {
      dispose();
    }
  }
}
__name$7(observe, "observe");

var __defProp$6 = Object.defineProperty;
var __name$6 = (target, value) => __defProp$6(target, "name", { value, configurable: true });
function dark() {
  return observe((notify) => {
    let dark2;
    const media = matchMedia("(prefers-color-scheme: dark)");
    const probe = document.createElement("div");
    probe.style.transitionProperty = "color, background-color";
    probe.style.transitionDuration = "1ms";
    const changed = /* @__PURE__ */ __name$6(() => {
      const s = getComputedStyle(document.body).getPropertyValue("color-scheme").split(/\s+/);
      let d;
      if (s.includes("light") && s.includes("dark")) d = media.matches;
      else d = s.includes("dark");
      if (dark2 === d) return;
      notify(dark2 = d);
    }, "changed");
    document.body.appendChild(probe);
    changed();
    probe.addEventListener("transitionstart", changed);
    media.addEventListener("change", changed);
    return () => {
      probe.removeEventListener("transitionstart", changed);
      media.removeEventListener("change", changed);
    };
  });
}
__name$6(dark, "dark");

var __defProp$5 = Object.defineProperty;
var __name$5 = (target, value) => __defProp$5(target, "name", { value, configurable: true });
function input(element) {
  return observe((change) => {
    const event = eventof(element);
    let value = valueof(element);
    const inputted = /* @__PURE__ */ __name$5(() => change(valueof(element)), "inputted");
    element.addEventListener(event, inputted);
    if (value !== void 0) change(value);
    return () => element.removeEventListener(event, inputted);
  });
}
__name$5(input, "input");
function valueof(element) {
  switch (element.type) {
    case "range":
    case "number":
      return element.valueAsNumber;
    case "date":
      return element.valueAsDate;
    case "checkbox":
      return element.checked;
    case "file":
      return element.multiple ? element.files : element.files[0];
    case "select-multiple":
      return Array.from(element.selectedOptions, (o) => o.value);
    default:
      return element.value;
  }
}
__name$5(valueof, "valueof");
function eventof(element) {
  switch (element.type) {
    case "button":
    case "submit":
    case "checkbox":
      return "click";
    case "file":
      return "change";
    default:
      return "input";
  }
}
__name$5(eventof, "eventof");

var __defProp$4 = Object.defineProperty;
var __name$4 = (target, value) => __defProp$4(target, "name", { value, configurable: true });
async function* now() {
  while (true) {
    yield Date.now();
  }
}
__name$4(now, "now");

var __defProp$3 = Object.defineProperty;
var __name$3 = (target, value) => __defProp$3(target, "name", { value, configurable: true });
async function* queue(initialize) {
  let resolve;
  const values = [];
  const dispose = initialize((x) => {
    values.push(x);
    if (resolve) resolve(values.shift()), resolve = null;
    return x;
  });
  if (dispose != null && typeof dispose !== "function") {
    throw new Error(
      typeof dispose.then === "function" ? "async initializers are not supported" : "initializer returned something, but not a dispose function"
    );
  }
  try {
    while (true) {
      yield values.length ? values.shift() : new Promise((_) => resolve = _);
    }
  } finally {
    if (dispose != null) {
      dispose();
    }
  }
}
__name$3(queue, "queue");

var __defProp$2 = Object.defineProperty;
var __name$2 = (target, value) => __defProp$2(target, "name", { value, configurable: true });
function width(target, options) {
  return observe((notify) => {
    let width2;
    const observer = new ResizeObserver(([entry]) => {
      const w = entry.contentRect.width;
      if (w !== width2) notify(width2 = w);
    });
    observer.observe(target, options);
    return () => observer.disconnect();
  });
}
__name$2(width, "width");

var index = /*#__PURE__*/Object.freeze({
  __proto__: null,
  dark: dark,
  input: input,
  now: now,
  observe: observe,
  queue: queue,
  width: width
});

var __defProp$1 = Object.defineProperty;
var __name$1 = (target, value) => __defProp$1(target, "name", { value, configurable: true });
function Mutable(value) {
  let change;
  return Object.defineProperty(
    observe((_) => {
      change = _;
      if (value !== void 0) change(value);
    }),
    "value",
    {
      get: /* @__PURE__ */ __name$1(() => value, "get"),
      set: /* @__PURE__ */ __name$1((x) => void change(value = x), "set")
      // eslint-disable-line no-setter-return
    }
  );
}
__name$1(Mutable, "Mutable");

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
function resize(render, invalidation) {
  const div = document.createElement("div");
  div.style.position = "relative";
  if (render.length !== 1) div.style.height = "100%";
  let currentRender = 0;
  let currentDisplay = 0;
  let currentWidth;
  const observer = new ResizeObserver(async ([entry]) => {
    const { width, height } = entry.contentRect;
    if (render.length === 1 && width === currentWidth) return;
    currentWidth = width;
    const childRender = ++currentRender;
    const child = width > 0 ? await render(width, height) : null;
    if (currentDisplay > childRender) return;
    currentDisplay = childRender;
    while (div.lastChild) div.lastChild.remove();
    if (child == null) return;
    if (render.length !== 1 && isElement(child)) child.style.position = "absolute";
    div.append(child);
  });
  observer.observe(div);
  invalidation?.then(() => observer.disconnect());
  return div;
}
__name(resize, "resize");
function isElement(node) {
  return typeof node === "object" && node.nodeType === 1;
}
__name(isElement, "isElement");

export { AbstractFile, FileAttachment, index as Generators, Mutable, registerFile, resize };
