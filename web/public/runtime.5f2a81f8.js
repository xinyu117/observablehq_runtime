var __defProp$p = Object.defineProperty;
var __name$p = (target, value) => __defProp$p(target, "name", { value, configurable: true });
function dispatch(node, type, detail) {
  detail = detail || {};
  var document = node.ownerDocument, event = document.defaultView.CustomEvent;
  if (typeof event === "function") {
    event = new event(type, { detail });
  } else {
    event = document.createEvent("Event");
    event.initEvent(type, false, false);
    event.detail = detail;
  }
  node.dispatchEvent(event);
}
__name$p(dispatch, "dispatch");

var __defProp$o = Object.defineProperty;
var __name$o = (target, value) => __defProp$o(target, "name", { value, configurable: true });
function isarray(value) {
  return Array.isArray(value) || value instanceof Int8Array || value instanceof Int16Array || value instanceof Int32Array || value instanceof Uint8Array || value instanceof Uint8ClampedArray || value instanceof Uint16Array || value instanceof Uint32Array || value instanceof Float32Array || value instanceof Float64Array;
}
__name$o(isarray, "isarray");
function isindex(key) {
  return key === (key | 0) + "";
}
__name$o(isindex, "isindex");

var __defProp$n = Object.defineProperty;
var __name$n = (target, value) => __defProp$n(target, "name", { value, configurable: true });
function inspectName(name) {
  const n = document.createElement("span");
  n.className = "observablehq--cellname";
  n.textContent = `${name} = `;
  return n;
}
__name$n(inspectName, "inspectName");

var __defProp$m = Object.defineProperty;
var __name$m = (target, value) => __defProp$m(target, "name", { value, configurable: true });
const symbolToString = Symbol.prototype.toString;
function formatSymbol(symbol) {
  return symbolToString.call(symbol);
}
__name$m(formatSymbol, "formatSymbol");

var __defProp$l = Object.defineProperty;
var __name$l = (target, value) => __defProp$l(target, "name", { value, configurable: true });
const { getOwnPropertySymbols, prototype: { hasOwnProperty } } = Object;
const { toStringTag } = Symbol;
const FORBIDDEN = {};
const symbolsof = getOwnPropertySymbols;
function isown(object, key) {
  return hasOwnProperty.call(object, key);
}
__name$l(isown, "isown");
function tagof(object) {
  return object[toStringTag] || object.constructor && object.constructor.name || "Object";
}
__name$l(tagof, "tagof");
function valueof(object, key) {
  try {
    const value = object[key];
    if (value) value.constructor;
    return value;
  } catch (ignore) {
    return FORBIDDEN;
  }
}
__name$l(valueof, "valueof");

var __defProp$k = Object.defineProperty;
var __name$k = (target, value) => __defProp$k(target, "name", { value, configurable: true });
const SYMBOLS = [
  { symbol: "@@__IMMUTABLE_INDEXED__@@", name: "Indexed", modifier: true },
  { symbol: "@@__IMMUTABLE_KEYED__@@", name: "Keyed", modifier: true },
  { symbol: "@@__IMMUTABLE_LIST__@@", name: "List", arrayish: true },
  { symbol: "@@__IMMUTABLE_MAP__@@", name: "Map" },
  {
    symbol: "@@__IMMUTABLE_ORDERED__@@",
    name: "Ordered",
    modifier: true,
    prefix: true
  },
  { symbol: "@@__IMMUTABLE_RECORD__@@", name: "Record" },
  {
    symbol: "@@__IMMUTABLE_SET__@@",
    name: "Set",
    arrayish: true,
    setish: true
  },
  { symbol: "@@__IMMUTABLE_STACK__@@", name: "Stack", arrayish: true }
];
function immutableName(obj) {
  try {
    let symbols = SYMBOLS.filter(({ symbol }) => obj[symbol] === true);
    if (!symbols.length) return;
    const name = symbols.find((s) => !s.modifier);
    const prefix = name.name === "Map" && symbols.find((s) => s.modifier && s.prefix);
    const arrayish = symbols.some((s) => s.arrayish);
    const setish = symbols.some((s) => s.setish);
    return {
      name: `${prefix ? prefix.name : ""}${name.name}`,
      symbols,
      arrayish: arrayish && !setish,
      setish
    };
  } catch (e) {
    return null;
  }
}
__name$k(immutableName, "immutableName");

var __defProp$j = Object.defineProperty;
var __name$j = (target, value) => __defProp$j(target, "name", { value, configurable: true });
const { getPrototypeOf, getOwnPropertyDescriptors } = Object;
const objectPrototype = getPrototypeOf({});
function inspectExpanded(object, _, name, proto) {
  let arrayish = isarray(object);
  let tag, fields, next, n;
  if (object instanceof Map) {
    if (object instanceof object.constructor) {
      tag = `Map(${object.size})`;
      fields = iterateMap$1;
    } else {
      tag = "Map()";
      fields = iterateObject$1;
    }
  } else if (object instanceof Set) {
    if (object instanceof object.constructor) {
      tag = `Set(${object.size})`;
      fields = iterateSet$1;
    } else {
      tag = "Set()";
      fields = iterateObject$1;
    }
  } else if (arrayish) {
    tag = `${object.constructor.name}(${object.length})`;
    fields = iterateArray$1;
  } else if (n = immutableName(object)) {
    tag = `Immutable.${n.name}${n.name === "Record" ? "" : `(${object.size})`}`;
    arrayish = n.arrayish;
    fields = n.arrayish ? iterateImArray$1 : n.setish ? iterateImSet$1 : iterateImObject$1;
  } else if (proto) {
    tag = tagof(object);
    fields = iterateProto;
  } else {
    tag = tagof(object);
    fields = iterateObject$1;
  }
  const span = document.createElement("span");
  span.className = "observablehq--expanded";
  if (name) {
    span.appendChild(inspectName(name));
  }
  const a = span.appendChild(document.createElement("a"));
  a.innerHTML = `<svg width=8 height=8 class='observablehq--caret'>
    <path d='M4 7L0 1h8z' fill='currentColor' />
  </svg>`;
  a.appendChild(document.createTextNode(`${tag}${arrayish ? " [" : " {"}`));
  a.addEventListener("mouseup", function(event) {
    event.stopPropagation();
    replace(span, inspectCollapsed(object, null, name, proto));
  });
  fields = fields(object);
  for (let i = 0; !(next = fields.next()).done && i < 20; ++i) {
    span.appendChild(next.value);
  }
  if (!next.done) {
    const a2 = span.appendChild(document.createElement("a"));
    a2.className = "observablehq--field";
    a2.style.display = "block";
    a2.appendChild(document.createTextNode(`  \u2026 more`));
    a2.addEventListener("mouseup", function(event) {
      event.stopPropagation();
      span.insertBefore(next.value, span.lastChild.previousSibling);
      for (let i = 0; !(next = fields.next()).done && i < 19; ++i) {
        span.insertBefore(next.value, span.lastChild.previousSibling);
      }
      if (next.done) span.removeChild(span.lastChild.previousSibling);
      dispatch(span, "load");
    });
  }
  span.appendChild(document.createTextNode(arrayish ? "]" : "}"));
  return span;
}
__name$j(inspectExpanded, "inspectExpanded");
function* iterateMap$1(map) {
  for (const [key, value] of map) {
    yield formatMapField$1(key, value);
  }
  yield* iterateObject$1(map);
}
__name$j(iterateMap$1, "iterateMap");
function* iterateSet$1(set) {
  for (const value of set) {
    yield formatSetField(value);
  }
  yield* iterateObject$1(set);
}
__name$j(iterateSet$1, "iterateSet");
function* iterateImSet$1(set) {
  for (const value of set) {
    yield formatSetField(value);
  }
}
__name$j(iterateImSet$1, "iterateImSet");
function* iterateArray$1(array) {
  for (let i = 0, n = array.length; i < n; ++i) {
    if (i in array) {
      yield formatField$1(i, valueof(array, i), "observablehq--index");
    }
  }
  for (const key in array) {
    if (!isindex(key) && isown(array, key)) {
      yield formatField$1(key, valueof(array, key), "observablehq--key");
    }
  }
  for (const symbol of symbolsof(array)) {
    yield formatField$1(
      formatSymbol(symbol),
      valueof(array, symbol),
      "observablehq--symbol"
    );
  }
}
__name$j(iterateArray$1, "iterateArray");
function* iterateImArray$1(array) {
  let i1 = 0;
  for (const n = array.size; i1 < n; ++i1) {
    yield formatField$1(i1, array.get(i1), true);
  }
}
__name$j(iterateImArray$1, "iterateImArray");
function* iterateProto(object) {
  for (const key in getOwnPropertyDescriptors(object)) {
    yield formatField$1(key, valueof(object, key), "observablehq--key");
  }
  for (const symbol of symbolsof(object)) {
    yield formatField$1(
      formatSymbol(symbol),
      valueof(object, symbol),
      "observablehq--symbol"
    );
  }
  const proto = getPrototypeOf(object);
  if (proto && proto !== objectPrototype) {
    yield formatPrototype(proto);
  }
}
__name$j(iterateProto, "iterateProto");
function* iterateObject$1(object) {
  for (const key in object) {
    if (isown(object, key)) {
      yield formatField$1(key, valueof(object, key), "observablehq--key");
    }
  }
  for (const symbol of symbolsof(object)) {
    yield formatField$1(
      formatSymbol(symbol),
      valueof(object, symbol),
      "observablehq--symbol"
    );
  }
  const proto = getPrototypeOf(object);
  if (proto && proto !== objectPrototype) {
    yield formatPrototype(proto);
  }
}
__name$j(iterateObject$1, "iterateObject");
function* iterateImObject$1(object) {
  for (const [key, value] of object) {
    yield formatField$1(key, value, "observablehq--key");
  }
}
__name$j(iterateImObject$1, "iterateImObject");
function formatPrototype(value) {
  const item = document.createElement("div");
  const span = item.appendChild(document.createElement("span"));
  item.className = "observablehq--field";
  span.className = "observablehq--prototype-key";
  span.textContent = `  <prototype>`;
  item.appendChild(document.createTextNode(": "));
  item.appendChild(inspect(value, void 0, void 0, void 0, true));
  return item;
}
__name$j(formatPrototype, "formatPrototype");
function formatField$1(key, value, className) {
  const item = document.createElement("div");
  const span = item.appendChild(document.createElement("span"));
  item.className = "observablehq--field";
  span.className = className;
  span.textContent = `  ${key}`;
  item.appendChild(document.createTextNode(": "));
  item.appendChild(inspect(value));
  return item;
}
__name$j(formatField$1, "formatField");
function formatMapField$1(key, value) {
  const item = document.createElement("div");
  item.className = "observablehq--field";
  item.appendChild(document.createTextNode("  "));
  item.appendChild(inspect(key));
  item.appendChild(document.createTextNode(" => "));
  item.appendChild(inspect(value));
  return item;
}
__name$j(formatMapField$1, "formatMapField");
function formatSetField(value) {
  const item = document.createElement("div");
  item.className = "observablehq--field";
  item.appendChild(document.createTextNode("  "));
  item.appendChild(inspect(value));
  return item;
}
__name$j(formatSetField, "formatSetField");

var __defProp$i = Object.defineProperty;
var __name$i = (target, value) => __defProp$i(target, "name", { value, configurable: true });
function hasSelection(elem) {
  const sel = window.getSelection();
  return sel.type === "Range" && (sel.containsNode(elem, true) || elem.contains(sel.anchorNode) || elem.contains(sel.focusNode));
}
__name$i(hasSelection, "hasSelection");
function inspectCollapsed(object, shallow, name, proto) {
  let arrayish = isarray(object);
  let tag, fields, next, n;
  if (object instanceof Map) {
    if (object instanceof object.constructor) {
      tag = `Map(${object.size})`;
      fields = iterateMap;
    } else {
      tag = "Map()";
      fields = iterateObject;
    }
  } else if (object instanceof Set) {
    if (object instanceof object.constructor) {
      tag = `Set(${object.size})`;
      fields = iterateSet;
    } else {
      tag = "Set()";
      fields = iterateObject;
    }
  } else if (arrayish) {
    tag = `${object.constructor.name}(${object.length})`;
    fields = iterateArray;
  } else if (n = immutableName(object)) {
    tag = `Immutable.${n.name}${n.name === "Record" ? "" : `(${object.size})`}`;
    arrayish = n.arrayish;
    fields = n.arrayish ? iterateImArray : n.setish ? iterateImSet : iterateImObject;
  } else {
    tag = tagof(object);
    fields = iterateObject;
  }
  if (shallow) {
    const span2 = document.createElement("span");
    span2.className = "observablehq--shallow";
    if (name) {
      span2.appendChild(inspectName(name));
    }
    span2.appendChild(document.createTextNode(tag));
    span2.addEventListener("mouseup", function(event) {
      if (hasSelection(span2)) return;
      event.stopPropagation();
      replace(span2, inspectCollapsed(object));
    });
    return span2;
  }
  const span = document.createElement("span");
  span.className = "observablehq--collapsed";
  if (name) {
    span.appendChild(inspectName(name));
  }
  const a = span.appendChild(document.createElement("a"));
  a.innerHTML = `<svg width=8 height=8 class='observablehq--caret'>
    <path d='M7 4L1 8V0z' fill='currentColor' />
  </svg>`;
  a.appendChild(document.createTextNode(`${tag}${arrayish ? " [" : " {"}`));
  span.addEventListener("mouseup", function(event) {
    if (hasSelection(span)) return;
    event.stopPropagation();
    replace(span, inspectExpanded(object, null, name, proto));
  }, true);
  fields = fields(object);
  for (let i = 0; !(next = fields.next()).done && i < 20; ++i) {
    if (i > 0) span.appendChild(document.createTextNode(", "));
    span.appendChild(next.value);
  }
  if (!next.done) span.appendChild(document.createTextNode(", \u2026"));
  span.appendChild(document.createTextNode(arrayish ? "]" : "}"));
  return span;
}
__name$i(inspectCollapsed, "inspectCollapsed");
function* iterateMap(map) {
  for (const [key, value] of map) {
    yield formatMapField(key, value);
  }
  yield* iterateObject(map);
}
__name$i(iterateMap, "iterateMap");
function* iterateSet(set) {
  for (const value of set) {
    yield inspect(value, true);
  }
  yield* iterateObject(set);
}
__name$i(iterateSet, "iterateSet");
function* iterateImSet(set) {
  for (const value of set) {
    yield inspect(value, true);
  }
}
__name$i(iterateImSet, "iterateImSet");
function* iterateImArray(array) {
  let i0 = -1, i1 = 0;
  for (const n = array.size; i1 < n; ++i1) {
    if (i1 > i0 + 1) yield formatEmpty(i1 - i0 - 1);
    yield inspect(array.get(i1), true);
    i0 = i1;
  }
  if (i1 > i0 + 1) yield formatEmpty(i1 - i0 - 1);
}
__name$i(iterateImArray, "iterateImArray");
function* iterateArray(array) {
  let i0 = -1, i1 = 0;
  for (const n = array.length; i1 < n; ++i1) {
    if (i1 in array) {
      if (i1 > i0 + 1) yield formatEmpty(i1 - i0 - 1);
      yield inspect(valueof(array, i1), true);
      i0 = i1;
    }
  }
  if (i1 > i0 + 1) yield formatEmpty(i1 - i0 - 1);
  for (const key in array) {
    if (!isindex(key) && isown(array, key)) {
      yield formatField(key, valueof(array, key), "observablehq--key");
    }
  }
  for (const symbol of symbolsof(array)) {
    yield formatField(formatSymbol(symbol), valueof(array, symbol), "observablehq--symbol");
  }
}
__name$i(iterateArray, "iterateArray");
function* iterateObject(object) {
  for (const key in object) {
    if (isown(object, key)) {
      yield formatField(key, valueof(object, key), "observablehq--key");
    }
  }
  for (const symbol of symbolsof(object)) {
    yield formatField(formatSymbol(symbol), valueof(object, symbol), "observablehq--symbol");
  }
}
__name$i(iterateObject, "iterateObject");
function* iterateImObject(object) {
  for (const [key, value] of object) {
    yield formatField(key, value, "observablehq--key");
  }
}
__name$i(iterateImObject, "iterateImObject");
function formatEmpty(e) {
  const span = document.createElement("span");
  span.className = "observablehq--empty";
  span.textContent = e === 1 ? "empty" : `empty \xD7 ${e}`;
  return span;
}
__name$i(formatEmpty, "formatEmpty");
function formatField(key, value, className) {
  const fragment = document.createDocumentFragment();
  const span = fragment.appendChild(document.createElement("span"));
  span.className = className;
  span.textContent = key;
  fragment.appendChild(document.createTextNode(": "));
  fragment.appendChild(inspect(value, true));
  return fragment;
}
__name$i(formatField, "formatField");
function formatMapField(key, value) {
  const fragment = document.createDocumentFragment();
  fragment.appendChild(inspect(key, true));
  fragment.appendChild(document.createTextNode(" => "));
  fragment.appendChild(inspect(value, true));
  return fragment;
}
__name$i(formatMapField, "formatMapField");

var __defProp$h = Object.defineProperty;
var __name$h = (target, value) => __defProp$h(target, "name", { value, configurable: true });
function format(date, fallback) {
  if (!(date instanceof Date)) date = /* @__PURE__ */ new Date(+date);
  if (isNaN(date)) return typeof fallback === "function" ? fallback(date) : fallback;
  const hours = date.getUTCHours();
  const minutes = date.getUTCMinutes();
  const seconds = date.getUTCSeconds();
  const milliseconds = date.getUTCMilliseconds();
  return `${formatYear(date.getUTCFullYear())}-${pad(date.getUTCMonth() + 1, 2)}-${pad(date.getUTCDate(), 2)}${hours || minutes || seconds || milliseconds ? `T${pad(hours, 2)}:${pad(minutes, 2)}${seconds || milliseconds ? `:${pad(seconds, 2)}${milliseconds ? `.${pad(milliseconds, 3)}` : ``}` : ``}Z` : ``}`;
}
__name$h(format, "format");
function formatYear(year) {
  return year < 0 ? `-${pad(-year, 6)}` : year > 9999 ? `+${pad(year, 6)}` : pad(year, 4);
}
__name$h(formatYear, "formatYear");
function pad(value, width) {
  return `${value}`.padStart(width, "0");
}
__name$h(pad, "pad");

var __defProp$g = Object.defineProperty;
var __name$g = (target, value) => __defProp$g(target, "name", { value, configurable: true });
const re = /^(?:[-+]\d{2})?\d{4}(?:-\d{2}(?:-\d{2})?)?(?:T\d{2}:\d{2}(?::\d{2}(?:\.\d{3})?)?(?:Z|[-+]\d{2}:?\d{2})?)?$/;
function parse(string, fallback) {
  if (!re.test(string += "")) return typeof fallback === "function" ? fallback(string) : fallback;
  return new Date(string);
}
__name$g(parse, "parse");

var __defProp$f = Object.defineProperty;
var __name$f = (target, value) => __defProp$f(target, "name", { value, configurable: true });
function formatDate(date) {
  return format(date, "Invalid Date");
}
__name$f(formatDate, "formatDate");

var __defProp$e = Object.defineProperty;
var __name$e = (target, value) => __defProp$e(target, "name", { value, configurable: true });
var errorToString = Error.prototype.toString;
function formatError(value) {
  return value.stack || errorToString.call(value);
}
__name$e(formatError, "formatError");

var __defProp$d = Object.defineProperty;
var __name$d = (target, value) => __defProp$d(target, "name", { value, configurable: true });
var regExpToString = RegExp.prototype.toString;
function formatRegExp(value) {
  return regExpToString.call(value);
}
__name$d(formatRegExp, "formatRegExp");

var __defProp$c = Object.defineProperty;
var __name$c = (target, value) => __defProp$c(target, "name", { value, configurable: true });
const NEWLINE_LIMIT = 20;
function formatString(string, shallow, expanded, name) {
  if (shallow === false) {
    if (count(string, /["\n]/g) <= count(string, /`|\${/g)) {
      const span3 = document.createElement("span");
      if (name) span3.appendChild(inspectName(name));
      const textValue3 = span3.appendChild(document.createElement("span"));
      textValue3.className = "observablehq--string";
      textValue3.textContent = JSON.stringify(string);
      return span3;
    }
    const lines = string.split("\n");
    if (lines.length > NEWLINE_LIMIT && !expanded) {
      const div = document.createElement("div");
      if (name) div.appendChild(inspectName(name));
      const textValue3 = div.appendChild(document.createElement("span"));
      textValue3.className = "observablehq--string";
      textValue3.textContent = "`" + templatify(lines.slice(0, NEWLINE_LIMIT).join("\n"));
      const splitter = div.appendChild(document.createElement("span"));
      const truncatedCount = lines.length - NEWLINE_LIMIT;
      splitter.textContent = `Show ${truncatedCount} truncated line${truncatedCount > 1 ? "s" : ""}`;
      splitter.className = "observablehq--string-expand";
      splitter.addEventListener("mouseup", function(event) {
        event.stopPropagation();
        replace(div, inspect(string, shallow, true, name));
      });
      return div;
    }
    const span2 = document.createElement("span");
    if (name) span2.appendChild(inspectName(name));
    const textValue2 = span2.appendChild(document.createElement("span"));
    textValue2.className = `observablehq--string${expanded ? " observablehq--expanded" : ""}`;
    textValue2.textContent = "`" + templatify(string) + "`";
    return span2;
  }
  const span = document.createElement("span");
  if (name) span.appendChild(inspectName(name));
  const textValue = span.appendChild(document.createElement("span"));
  textValue.className = "observablehq--string";
  textValue.textContent = JSON.stringify(string.length > 100 ? `${string.slice(0, 50)}\u2026${string.slice(-49)}` : string);
  return span;
}
__name$c(formatString, "formatString");
function templatify(string) {
  return string.replace(/[\\`\x00-\x09\x0b-\x19]|\${/g, templatifyChar);
}
__name$c(templatify, "templatify");
function templatifyChar(char) {
  var code = char.charCodeAt(0);
  switch (code) {
    case 8:
      return "\\b";
    case 9:
      return "\\t";
    case 11:
      return "\\v";
    case 12:
      return "\\f";
    case 13:
      return "\\r";
  }
  return code < 16 ? "\\x0" + code.toString(16) : code < 32 ? "\\x" + code.toString(16) : "\\" + char;
}
__name$c(templatifyChar, "templatifyChar");
function count(string, re) {
  var n = 0;
  while (re.exec(string)) ++n;
  return n;
}
__name$c(count, "count");

var __defProp$b = Object.defineProperty;
var __name$b = (target, value) => __defProp$b(target, "name", { value, configurable: true });
var toString$1 = Function.prototype.toString, TYPE_ASYNC = { prefix: "async \u0192" }, TYPE_ASYNC_GENERATOR = { prefix: "async \u0192*" }, TYPE_CLASS = { prefix: "class" }, TYPE_FUNCTION = { prefix: "\u0192" }, TYPE_GENERATOR = { prefix: "\u0192*" };
function inspectFunction(f, name) {
  var type, m, t = toString$1.call(f);
  switch (f.constructor && f.constructor.name) {
    case "AsyncFunction":
      type = TYPE_ASYNC;
      break;
    case "AsyncGeneratorFunction":
      type = TYPE_ASYNC_GENERATOR;
      break;
    case "GeneratorFunction":
      type = TYPE_GENERATOR;
      break;
    default:
      type = /^class\b/.test(t) ? TYPE_CLASS : TYPE_FUNCTION;
      break;
  }
  if (type === TYPE_CLASS) {
    return formatFunction(type, "", name);
  }
  if (m = /^(?:async\s*)?(\w+)\s*=>/.exec(t)) {
    return formatFunction(type, "(" + m[1] + ")", name);
  }
  if (m = /^(?:async\s*)?\(\s*(\w+(?:\s*,\s*\w+)*)?\s*\)/.exec(t)) {
    return formatFunction(type, m[1] ? "(" + m[1].replace(/\s*,\s*/g, ", ") + ")" : "()", name);
  }
  if (m = /^(?:async\s*)?function(?:\s*\*)?(?:\s*\w+)?\s*\(\s*(\w+(?:\s*,\s*\w+)*)?\s*\)/.exec(t)) {
    return formatFunction(type, m[1] ? "(" + m[1].replace(/\s*,\s*/g, ", ") + ")" : "()", name);
  }
  return formatFunction(type, "(\u2026)", name);
}
__name$b(inspectFunction, "inspectFunction");
function formatFunction(type, args, cellname) {
  var span = document.createElement("span");
  span.className = "observablehq--function";
  if (cellname) {
    span.appendChild(inspectName(cellname));
  }
  var spanType = span.appendChild(document.createElement("span"));
  spanType.className = "observablehq--keyword";
  spanType.textContent = type.prefix;
  span.appendChild(document.createTextNode(args));
  return span;
}
__name$b(formatFunction, "formatFunction");

var __defProp$a = Object.defineProperty;
var __name$a = (target, value) => __defProp$a(target, "name", { value, configurable: true });
const { prototype: { toString } } = Object;
function inspect(value, shallow, expand, name, proto) {
  let type = typeof value;
  switch (type) {
    case "boolean":
    case "undefined": {
      value += "";
      break;
    }
    case "number": {
      value = value === 0 && 1 / value < 0 ? "-0" : value + "";
      break;
    }
    case "bigint": {
      value = value + "n";
      break;
    }
    case "symbol": {
      value = formatSymbol(value);
      break;
    }
    case "function": {
      return inspectFunction(value, name);
    }
    case "string": {
      return formatString(value, shallow, expand, name);
    }
    default: {
      if (value === null) {
        type = null, value = "null";
        break;
      }
      if (value instanceof Date) {
        type = "date", value = formatDate(value);
        break;
      }
      if (value === FORBIDDEN) {
        type = "forbidden", value = "[forbidden]";
        break;
      }
      switch (toString.call(value)) {
        case "[object RegExp]": {
          type = "regexp", value = formatRegExp(value);
          break;
        }
        case "[object Error]":
        // https://github.com/lodash/lodash/blob/master/isError.js#L26
        case "[object DOMException]": {
          type = "error", value = formatError(value);
          break;
        }
        default:
          return (expand ? inspectExpanded : inspectCollapsed)(value, shallow, name, proto);
      }
      break;
    }
  }
  const span = document.createElement("span");
  if (name) span.appendChild(inspectName(name));
  const n = span.appendChild(document.createElement("span"));
  n.className = `observablehq--${type}`;
  n.textContent = value;
  return span;
}
__name$a(inspect, "inspect");
function replace(spanOld, spanNew) {
  if (spanOld.classList.contains("observablehq--inspect")) spanNew.classList.add("observablehq--inspect");
  spanOld.parentNode.replaceChild(spanNew, spanOld);
  dispatch(spanNew, "load");
}
__name$a(replace, "replace");

var __defProp$9 = Object.defineProperty;
var __name$9 = (target, value) => __defProp$9(target, "name", { value, configurable: true });
const LOCATION_MATCH = /\s+\(\d+:\d+\)$/m;
const _Inspector = class _Inspector {
  constructor(node) {
    if (!node) throw new Error("invalid node");
    this._node = node;
    node.classList.add("observablehq");
  }
  pending() {
    const { _node } = this;
    _node.classList.remove("observablehq--error");
    _node.classList.add("observablehq--running");
  }
  fulfilled(value, name) {
    const { _node } = this;
    if (!isnode(value) || value.parentNode && value.parentNode !== _node) {
      value = inspect(value, false, _node.firstChild && _node.firstChild.classList && _node.firstChild.classList.contains("observablehq--expanded"), name);
      value.classList.add("observablehq--inspect");
    }
    _node.classList.remove("observablehq--running", "observablehq--error");
    if (_node.firstChild !== value) {
      if (_node.firstChild) {
        while (_node.lastChild !== _node.firstChild) _node.removeChild(_node.lastChild);
        _node.replaceChild(value, _node.firstChild);
      } else {
        _node.appendChild(value);
      }
    }
    dispatch(_node, "update");
  }
  rejected(error, name) {
    const { _node } = this;
    _node.classList.remove("observablehq--running");
    _node.classList.add("observablehq--error");
    while (_node.lastChild) _node.removeChild(_node.lastChild);
    var div = document.createElement("div");
    div.className = "observablehq--inspect";
    if (name) div.appendChild(inspectName(name));
    div.appendChild(document.createTextNode((error + "").replace(LOCATION_MATCH, "")));
    _node.appendChild(div);
    dispatch(_node, "error", { error });
  }
};
__name$9(_Inspector, "Inspector");
let Inspector = _Inspector;
Inspector.into = function(container) {
  if (typeof container === "string") {
    container = document.querySelector(container);
    if (container == null) throw new Error("container not found");
  }
  return function() {
    return new Inspector(container.appendChild(document.createElement("div")));
  };
};
function isnode(value) {
  return (value instanceof Element || value instanceof Text) && value instanceof value.constructor;
}
__name$9(isnode, "isnode");

var __defProp$8 = Object.defineProperty;
var __name$8 = (target, value) => __defProp$8(target, "name", { value, configurable: true });
const _RuntimeError = class _RuntimeError extends Error {
  constructor(message, input) {
    super(message);
    this.input = input;
  }
};
__name$8(_RuntimeError, "RuntimeError");
let RuntimeError = _RuntimeError;
RuntimeError.prototype.name = "RuntimeError";

var __defProp$7 = Object.defineProperty;
var __name$7 = (target, value) => __defProp$7(target, "name", { value, configurable: true });
function generatorish(value) {
  return value && typeof value.next === "function" && typeof value.return === "function";
}
__name$7(generatorish, "generatorish");

var __defProp$6 = Object.defineProperty;
var __name$6 = (target, value) => __defProp$6(target, "name", { value, configurable: true });
function constant(x) {
  return () => x;
}
__name$6(constant, "constant");

var __defProp$5 = Object.defineProperty;
var __name$5 = (target, value) => __defProp$5(target, "name", { value, configurable: true });
function identity(x) {
  return x;
}
__name$5(identity, "identity");

var __defProp$4 = Object.defineProperty;
var __name$4 = (target, value) => __defProp$4(target, "name", { value, configurable: true });
function rethrow(error) {
  return () => {
    throw error;
  };
}
__name$4(rethrow, "rethrow");

const prototype = Array.prototype;
const map = prototype.map;

var __defProp$3 = Object.defineProperty;
var __name$3 = (target, value) => __defProp$3(target, "name", { value, configurable: true });
function noop() {
}
__name$3(noop, "noop");

var __defProp$2 = Object.defineProperty;
var __name$2 = (target, value) => __defProp$2(target, "name", { value, configurable: true });
const TYPE_NORMAL = 1;
const TYPE_IMPLICIT = 2;
const TYPE_DUPLICATE = 3;
const no_observer = /* @__PURE__ */ Symbol("no-observer");
const no_value = Promise.resolve();
function Variable(type, module, observer, options) {
  if (!observer) observer = no_observer;
  Object.defineProperties(this, {
    _observer: { value: observer, writable: true },
    _definition: { value: variable_undefined, writable: true },
    _duplicate: { value: void 0, writable: true },
    _duplicates: { value: void 0, writable: true },
    _indegree: { value: NaN, writable: true },
    // The number of computing inputs.
    _inputs: { value: [], writable: true },
    _invalidate: { value: noop, writable: true },
    _module: { value: module },
    _name: { value: null, writable: true },
    _outputs: { value: /* @__PURE__ */ new Set(), writable: true },
    _promise: { value: no_value, writable: true },
    _reachable: { value: observer !== no_observer, writable: true },
    // Is this variable transitively visible?
    _rejector: { value: variable_rejector(this) },
    _shadow: { value: initShadow(module, options) },
    _type: { value: type },
    _value: { value: void 0, writable: true },
    _version: { value: 0, writable: true }
  });
}
__name$2(Variable, "Variable");
Object.defineProperties(Variable.prototype, {
  _pending: { value: variable_pending, writable: true, configurable: true },
  _fulfilled: { value: variable_fulfilled, writable: true, configurable: true },
  _rejected: { value: variable_rejected, writable: true, configurable: true },
  _resolve: { value: variable_resolve, writable: true, configurable: true },
  define: { value: variable_define, writable: true, configurable: true },
  delete: { value: variable_delete, writable: true, configurable: true },
  import: { value: variable_import, writable: true, configurable: true }
});
function initShadow(module, options) {
  if (!options?.shadow) return null;
  return new Map(
    Object.entries(options.shadow).map(([name, definition]) => [name, new Variable(TYPE_IMPLICIT, module).define([], definition)])
  );
}
__name$2(initShadow, "initShadow");
function variable_attach(variable) {
  variable._module._runtime._dirty.add(variable);
  variable._outputs.add(this);
}
__name$2(variable_attach, "variable_attach");
function variable_detach(variable) {
  variable._module._runtime._dirty.add(variable);
  variable._outputs.delete(this);
}
__name$2(variable_detach, "variable_detach");
function variable_undefined() {
  throw variable_undefined;
}
__name$2(variable_undefined, "variable_undefined");
function variable_stale() {
  throw variable_stale;
}
__name$2(variable_stale, "variable_stale");
function variable_rejector(variable) {
  return (error) => {
    if (error === variable_stale) throw error;
    if (error === variable_undefined) throw new RuntimeError(`${variable._name} is not defined`, variable._name);
    if (error instanceof Error && error.message) throw new RuntimeError(error.message, variable._name);
    throw new RuntimeError(`${variable._name} could not be resolved`, variable._name);
  };
}
__name$2(variable_rejector, "variable_rejector");
function variable_duplicate(name) {
  return () => {
    throw new RuntimeError(`${name} is defined more than once`);
  };
}
__name$2(variable_duplicate, "variable_duplicate");
function variable_define(name, inputs, definition) {
  switch (arguments.length) {
    case 1: {
      definition = name, name = inputs = null;
      break;
    }
    case 2: {
      definition = inputs;
      if (typeof name === "string") inputs = null;
      else inputs = name, name = null;
      break;
    }
  }
  return variable_defineImpl.call(
    this,
    name == null ? null : String(name),
    inputs == null ? [] : map.call(inputs, this._resolve, this),
    typeof definition === "function" ? definition : constant(definition)
  );
}
__name$2(variable_define, "variable_define");
function variable_resolve(name) {
  return this._shadow?.get(name) ?? this._module._resolve(name);
}
__name$2(variable_resolve, "variable_resolve");
function variable_defineImpl(name, inputs, definition) {
  const scope = this._module._scope, runtime = this._module._runtime;
  this._inputs.forEach(variable_detach, this);
  inputs.forEach(variable_attach, this);
  this._inputs = inputs;
  this._definition = definition;
  this._value = void 0;
  if (definition === noop) runtime._variables.delete(this);
  else runtime._variables.add(this);
  if (name !== this._name || scope.get(name) !== this) {
    let error, found;
    if (this._name) {
      if (this._outputs.size) {
        scope.delete(this._name);
        found = this._module._resolve(this._name);
        found._outputs = this._outputs, this._outputs = /* @__PURE__ */ new Set();
        found._outputs.forEach(function(output) {
          output._inputs[output._inputs.indexOf(this)] = found;
        }, this);
        found._outputs.forEach(runtime._updates.add, runtime._updates);
        runtime._dirty.add(found).add(this);
        scope.set(this._name, found);
      } else if ((found = scope.get(this._name)) === this) {
        scope.delete(this._name);
      } else if (found._type === TYPE_DUPLICATE) {
        found._duplicates.delete(this);
        this._duplicate = void 0;
        if (found._duplicates.size === 1) {
          found = found._duplicates.keys().next().value;
          error = scope.get(this._name);
          found._outputs = error._outputs, error._outputs = /* @__PURE__ */ new Set();
          found._outputs.forEach(function(output) {
            output._inputs[output._inputs.indexOf(error)] = found;
          });
          found._definition = found._duplicate, found._duplicate = void 0;
          runtime._dirty.add(error).add(found);
          runtime._updates.add(found);
          scope.set(this._name, found);
        }
      } else {
        throw new Error();
      }
    }
    if (this._outputs.size) throw new Error();
    if (name) {
      if (found = scope.get(name)) {
        if (found._type === TYPE_DUPLICATE) {
          this._definition = variable_duplicate(name), this._duplicate = definition;
          found._duplicates.add(this);
        } else if (found._type === TYPE_IMPLICIT) {
          this._outputs = found._outputs, found._outputs = /* @__PURE__ */ new Set();
          this._outputs.forEach(function(output) {
            output._inputs[output._inputs.indexOf(found)] = this;
          }, this);
          runtime._dirty.add(found).add(this);
          scope.set(name, this);
        } else {
          found._duplicate = found._definition, this._duplicate = definition;
          error = new Variable(TYPE_DUPLICATE, this._module);
          error._name = name;
          error._definition = this._definition = found._definition = variable_duplicate(name);
          error._outputs = found._outputs, found._outputs = /* @__PURE__ */ new Set();
          error._outputs.forEach(function(output) {
            output._inputs[output._inputs.indexOf(found)] = error;
          });
          error._duplicates = /* @__PURE__ */ new Set([this, found]);
          runtime._dirty.add(found).add(error);
          runtime._updates.add(found).add(error);
          scope.set(name, error);
        }
      } else {
        scope.set(name, this);
      }
    }
    this._name = name;
  }
  if (this._version > 0) ++this._version;
  runtime._updates.add(this);
  runtime._compute();
  return this;
}
__name$2(variable_defineImpl, "variable_defineImpl");
function variable_import(remote, name, module) {
  if (arguments.length < 3) module = name, name = remote;
  return variable_defineImpl.call(this, String(name), [module._resolve(String(remote))], identity);
}
__name$2(variable_import, "variable_import");
function variable_delete() {
  return variable_defineImpl.call(this, null, [], noop);
}
__name$2(variable_delete, "variable_delete");
function variable_pending() {
  if (this._observer.pending) this._observer.pending();
}
__name$2(variable_pending, "variable_pending");
function variable_fulfilled(value) {
  if (this._observer.fulfilled) this._observer.fulfilled(value, this._name);
}
__name$2(variable_fulfilled, "variable_fulfilled");
function variable_rejected(error) {
  if (this._observer.rejected) this._observer.rejected(error, this._name);
}
__name$2(variable_rejected, "variable_rejected");

var __defProp$1 = Object.defineProperty;
var __name$1 = (target, value) => __defProp$1(target, "name", { value, configurable: true });
const variable_variable = /* @__PURE__ */ Symbol("variable");
const variable_invalidation = /* @__PURE__ */ Symbol("invalidation");
const variable_visibility = /* @__PURE__ */ Symbol("visibility");
function Module(runtime, builtins = []) {
  Object.defineProperties(this, {
    _runtime: { value: runtime },
    _scope: { value: /* @__PURE__ */ new Map() },
    _builtins: { value: new Map([
      ["@variable", variable_variable],
      ["invalidation", variable_invalidation],
      ["visibility", variable_visibility],
      ...builtins
    ]) },
    _source: { value: null, writable: true }
  });
}
__name$1(Module, "Module");
Object.defineProperties(Module.prototype, {
  _resolve: { value: module_resolve, writable: true, configurable: true },
  redefine: { value: module_redefine, writable: true, configurable: true },
  define: { value: module_define, writable: true, configurable: true },
  derive: { value: module_derive, writable: true, configurable: true },
  import: { value: module_import, writable: true, configurable: true },
  value: { value: module_value, writable: true, configurable: true },
  variable: { value: module_variable, writable: true, configurable: true },
  builtin: { value: module_builtin, writable: true, configurable: true }
});
function module_redefine(name) {
  const v = this._scope.get(name);
  if (!v) throw new RuntimeError(`${name} is not defined`);
  if (v._type === TYPE_DUPLICATE) throw new RuntimeError(`${name} is defined more than once`);
  return v.define.apply(v, arguments);
}
__name$1(module_redefine, "module_redefine");
function module_define() {
  const v = new Variable(TYPE_NORMAL, this);
  return v.define.apply(v, arguments);
}
__name$1(module_define, "module_define");
function module_import() {
  const v = new Variable(TYPE_NORMAL, this);
  return v.import.apply(v, arguments);
}
__name$1(module_import, "module_import");
function module_variable(observer, options) {
  return new Variable(TYPE_NORMAL, this, observer, options);
}
__name$1(module_variable, "module_variable");
async function module_value(name) {
  let v = this._scope.get(name);
  if (!v) throw new RuntimeError(`${name} is not defined`);
  if (v._observer === no_observer) {
    v = this.variable(true).define([name], identity);
    try {
      return await module_revalue(this._runtime, v);
    } finally {
      v.delete();
    }
  } else {
    return module_revalue(this._runtime, v);
  }
}
__name$1(module_value, "module_value");
async function module_revalue(runtime, variable) {
  await runtime._compute();
  try {
    return await variable._promise;
  } catch (error) {
    if (error === variable_stale) return module_revalue(runtime, variable);
    throw error;
  }
}
__name$1(module_revalue, "module_revalue");
function module_derive(injects, injectModule) {
  const map = /* @__PURE__ */ new Map();
  const modules = /* @__PURE__ */ new Set();
  const copies = [];
  function alias(source) {
    let target = map.get(source);
    if (target) return target;
    target = new Module(source._runtime, source._builtins);
    target._source = source;
    map.set(source, target);
    copies.push([target, source]);
    modules.add(source);
    return target;
  }
  __name$1(alias, "alias");
  const derive = alias(this);
  for (const inject of injects) {
    const { alias: alias2, name } = typeof inject === "object" ? inject : { name: inject };
    derive.import(name, alias2 == null ? name : alias2, injectModule);
  }
  for (const module of modules) {
    for (const [name, variable] of module._scope) {
      if (variable._definition === identity) {
        if (module === this && derive._scope.has(name)) continue;
        const importedModule = variable._inputs[0]._module;
        if (importedModule._source) alias(importedModule);
      }
    }
  }
  for (const [target, source] of copies) {
    for (const [name, sourceVariable] of source._scope) {
      const targetVariable = target._scope.get(name);
      if (targetVariable && targetVariable._type !== TYPE_IMPLICIT) continue;
      if (sourceVariable._definition === identity) {
        const sourceInput = sourceVariable._inputs[0];
        const sourceModule = sourceInput._module;
        target.import(sourceInput._name, name, map.get(sourceModule) || sourceModule);
      } else {
        target.define(name, sourceVariable._inputs.map(variable_name), sourceVariable._definition);
      }
    }
  }
  return derive;
}
__name$1(module_derive, "module_derive");
function module_resolve(name) {
  let variable = this._scope.get(name), value;
  if (!variable) {
    variable = new Variable(TYPE_IMPLICIT, this);
    if (this._builtins.has(name)) {
      variable.define(name, constant(this._builtins.get(name)));
    } else if (this._runtime._builtin._scope.has(name)) {
      variable.import(name, this._runtime._builtin);
    } else {
      try {
        value = this._runtime._global(name);
      } catch (error) {
        return variable.define(name, rethrow(error));
      }
      if (value === void 0) {
        this._scope.set(variable._name = name, variable);
      } else {
        variable.define(name, constant(value));
      }
    }
  }
  return variable;
}
__name$1(module_resolve, "module_resolve");
function module_builtin(name, value) {
  this._builtins.set(name, value);
}
__name$1(module_builtin, "module_builtin");
function variable_name(variable) {
  return variable._name;
}
__name$1(variable_name, "variable_name");

var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });
const frame = typeof requestAnimationFrame === "function" ? requestAnimationFrame : typeof setImmediate === "function" ? setImmediate : (f) => setTimeout(f, 0);
function Runtime(builtins, global = window_global) {
  const builtin = this.module();
  Object.defineProperties(this, {
    _dirty: { value: /* @__PURE__ */ new Set() },
    _updates: { value: /* @__PURE__ */ new Set() },
    _precomputes: { value: [], writable: true },
    _computing: { value: null, writable: true },
    _init: { value: null, writable: true },
    _modules: { value: /* @__PURE__ */ new Map() },
    _variables: { value: /* @__PURE__ */ new Set() },
    _disposed: { value: false, writable: true },
    _builtin: { value: builtin },
    _global: { value: global }
  });
  if (builtins) for (const name in builtins) {
    new Variable(TYPE_IMPLICIT, builtin).define(name, [], builtins[name]);
  }
}
__name(Runtime, "Runtime");
Object.defineProperties(Runtime.prototype, {
  _precompute: { value: runtime_precompute, writable: true, configurable: true },
  _compute: { value: runtime_compute, writable: true, configurable: true },
  _computeSoon: { value: runtime_computeSoon, writable: true, configurable: true },
  _computeNow: { value: runtime_computeNow, writable: true, configurable: true },
  dispose: { value: runtime_dispose, writable: true, configurable: true },
  module: { value: runtime_module, writable: true, configurable: true }
});
function runtime_dispose() {
  this._computing = Promise.resolve();
  this._disposed = true;
  this._variables.forEach((v) => {
    v._invalidate();
    v._version = NaN;
  });
}
__name(runtime_dispose, "runtime_dispose");
function runtime_module(define, observer = noop) {
  let module;
  if (define === void 0) {
    if (module = this._init) {
      this._init = null;
      return module;
    }
    return new Module(this);
  }
  module = this._modules.get(define);
  if (module) return module;
  this._init = module = new Module(this);
  this._modules.set(define, module);
  try {
    define(this, observer);
  } finally {
    this._init = null;
  }
  return module;
}
__name(runtime_module, "runtime_module");
function runtime_precompute(callback) {
  this._precomputes.push(callback);
  this._compute();
}
__name(runtime_precompute, "runtime_precompute");
function runtime_compute() {
  return this._computing || (this._computing = this._computeSoon());
}
__name(runtime_compute, "runtime_compute");
function runtime_computeSoon() {
  return new Promise(frame).then(() => this._disposed ? void 0 : this._computeNow());
}
__name(runtime_computeSoon, "runtime_computeSoon");
async function runtime_computeNow() {
  let queue = [], variables, variable, precomputes = this._precomputes;
  if (precomputes.length) {
    this._precomputes = [];
    for (const callback of precomputes) callback();
    await runtime_defer(3);
  }
  variables = new Set(this._dirty);
  variables.forEach(function(variable2) {
    variable2._inputs.forEach(variables.add, variables);
    const reachable = variable_reachable(variable2);
    if (reachable > variable2._reachable) {
      this._updates.add(variable2);
    } else if (reachable < variable2._reachable) {
      variable2._invalidate();
    }
    variable2._reachable = reachable;
  }, this);
  variables = new Set(this._updates);
  variables.forEach(function(variable2) {
    if (variable2._reachable) {
      variable2._indegree = 0;
      variable2._outputs.forEach(variables.add, variables);
    } else {
      variable2._indegree = NaN;
      variables.delete(variable2);
    }
  });
  this._computing = null;
  this._updates.clear();
  this._dirty.clear();
  variables.forEach(function(variable2) {
    variable2._outputs.forEach(variable_increment);
  });
  do {
    variables.forEach(function(variable2) {
      if (variable2._indegree === 0) {
        queue.push(variable2);
      }
    });
    while (variable = queue.pop()) {
      variable_compute(variable);
      variable._outputs.forEach(postqueue);
      variables.delete(variable);
    }
    variables.forEach(function(variable2) {
      if (variable_circular(variable2)) {
        variable_error(variable2, new RuntimeError("circular definition"));
        variable2._outputs.forEach(variable_decrement);
        variables.delete(variable2);
      }
    });
  } while (variables.size);
  function postqueue(variable2) {
    if (--variable2._indegree === 0) {
      queue.push(variable2);
    }
  }
  __name(postqueue, "postqueue");
}
__name(runtime_computeNow, "runtime_computeNow");
function runtime_defer(depth = 0) {
  let p = Promise.resolve();
  for (let i = 0; i < depth; ++i) p = p.then(() => {
  });
  return p;
}
__name(runtime_defer, "runtime_defer");
function variable_circular(variable) {
  const inputs = new Set(variable._inputs);
  for (const i of inputs) {
    if (i === variable) return true;
    i._inputs.forEach(inputs.add, inputs);
  }
  return false;
}
__name(variable_circular, "variable_circular");
function variable_increment(variable) {
  ++variable._indegree;
}
__name(variable_increment, "variable_increment");
function variable_decrement(variable) {
  --variable._indegree;
}
__name(variable_decrement, "variable_decrement");
function variable_value(variable) {
  return variable._promise.catch(variable._rejector);
}
__name(variable_value, "variable_value");
function variable_invalidator(variable) {
  return new Promise(function(resolve) {
    variable._invalidate = resolve;
  });
}
__name(variable_invalidator, "variable_invalidator");
function variable_intersector(invalidation, variable) {
  let node = typeof IntersectionObserver === "function" && variable._observer && variable._observer._node;
  let visible = !node, resolve = noop, reject = noop, promise, observer;
  if (node) {
    observer = new IntersectionObserver(([entry]) => (visible = entry.isIntersecting) && (promise = null, resolve()));
    observer.observe(node);
    invalidation.then(() => (observer.disconnect(), observer = null, reject()));
  }
  return function(value) {
    if (visible) return Promise.resolve(value);
    if (!observer) return Promise.reject();
    if (!promise) promise = new Promise((y, n) => (resolve = y, reject = n));
    return promise.then(() => value);
  };
}
__name(variable_intersector, "variable_intersector");
function variable_compute(variable) {
  variable._invalidate();
  variable._invalidate = noop;
  variable._pending();
  const value0 = variable._value;
  const version = ++variable._version;
  const inputs = variable._inputs;
  const definition = variable._definition;
  let invalidation = null;
  const promise = variable._promise = variable._promise.then(init, init).then(define).then(generate);
  function init() {
    return Promise.all(inputs.map(variable_value));
  }
  __name(init, "init");
  function define(inputs2) {
    if (variable._version !== version) throw variable_stale;
    for (let i = 0, n = inputs2.length; i < n; ++i) {
      switch (inputs2[i]) {
        case variable_invalidation: {
          inputs2[i] = invalidation = variable_invalidator(variable);
          break;
        }
        case variable_visibility: {
          if (!invalidation) invalidation = variable_invalidator(variable);
          inputs2[i] = variable_intersector(invalidation, variable);
          break;
        }
        case variable_variable: {
          inputs2[i] = variable;
          break;
        }
      }
    }
    return definition.apply(value0, inputs2);
  }
  __name(define, "define");
  function generate(value) {
    if (variable._version !== version) throw variable_stale;
    if (generatorish(value)) {
      (invalidation || variable_invalidator(variable)).then(variable_return(value));
      return variable_generate(variable, version, value);
    }
    return value;
  }
  __name(generate, "generate");
  promise.then((value) => {
    variable._value = value;
    variable._fulfilled(value);
  }, (error) => {
    if (error === variable_stale || variable._version !== version) return;
    variable._value = void 0;
    variable._rejected(error);
  });
}
__name(variable_compute, "variable_compute");
function variable_generate(variable, version, generator) {
  const runtime = variable._module._runtime;
  let currentValue;
  function compute(onfulfilled) {
    return new Promise((resolve) => resolve(generator.next(currentValue))).then(({ done, value }) => {
      return done ? void 0 : Promise.resolve(value).then(onfulfilled);
    });
  }
  __name(compute, "compute");
  function recompute() {
    const promise = compute((value) => {
      if (variable._version !== version) throw variable_stale;
      currentValue = value;
      postcompute(value, promise).then(() => runtime._precompute(recompute));
      variable._fulfilled(value);
      return value;
    });
    promise.catch((error) => {
      if (error === variable_stale || variable._version !== version) return;
      postcompute(void 0, promise);
      variable._rejected(error);
    });
  }
  __name(recompute, "recompute");
  function postcompute(value, promise) {
    variable._value = value;
    variable._promise = promise;
    variable._outputs.forEach(runtime._updates.add, runtime._updates);
    return runtime._compute();
  }
  __name(postcompute, "postcompute");
  return compute((value) => {
    if (variable._version !== version) throw variable_stale;
    currentValue = value;
    runtime._precompute(recompute);
    return value;
  });
}
__name(variable_generate, "variable_generate");
function variable_error(variable, error) {
  variable._invalidate();
  variable._invalidate = noop;
  variable._pending();
  ++variable._version;
  variable._indegree = NaN;
  (variable._promise = Promise.reject(error)).catch(noop);
  variable._value = void 0;
  variable._rejected(error);
}
__name(variable_error, "variable_error");
function variable_return(generator) {
  return function() {
    generator.return();
  };
}
__name(variable_return, "variable_return");
function variable_reachable(variable) {
  if (variable._observer !== no_observer) return true;
  const outputs = new Set(variable._outputs);
  for (const output of outputs) {
    if (output._observer !== no_observer) return true;
    output._outputs.forEach(outputs.add, outputs);
  }
  return false;
}
__name(variable_reachable, "variable_reachable");
function window_global(name) {
  return globalThis[name];
}
__name(window_global, "window_global");

export { Inspector, Runtime, RuntimeError };
