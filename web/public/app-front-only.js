import {Runtime, constructTangleLayout} from "/runtime-src/index.js";
import {SVG} from "./svg.js";
import {dialogManager} from "./DialogManager.js";

const form = document.getElementById("variable-form");
const nameInput = document.getElementById("name");
const paramsInput = document.getElementById("params");
const optionParamsInput = document.getElementById("option-params");
const expressionInput = document.getElementById("expression");
const submitBtn = document.getElementById("submit-btn");
const cancelBtn = document.getElementById("cancel-btn");
const saveBtn = document.getElementById("save-btn");
const csvImportBtn = document.getElementById("csv-import-btn");
const csvFile = document.getElementById("csv-file");
const objectImportBtn = document.getElementById("object-import-btn");
const objectImportFile = document.getElementById("object-import-file");
const showValuesBtn = document.getElementById("show-values-btn");
const tableBody = document.getElementById("variables-body");
const valuesOutput = document.getElementById("values-output");
const variablesViewToggleBtn = document.getElementById("variables-view-toggle-btn");
const valuesViewToggleBtn = document.getElementById("values-view-toggle-btn");
const variablesSectionBody = document.getElementById("variables-section-body");
const valuesSectionBody = document.getElementById("values-section-body");
const relationFilterInput = document.getElementById("relation-filter");
const clearRelationFilterBtn = document.getElementById("clear-relation-filter-btn");
const statusBadge = document.getElementById("front-only-status");
const collectionSelect = document.getElementById("front-collection-select");
const collectionNameInput = document.getElementById("front-collection-name");
const createCollectionBtn = document.getElementById("front-create-collection-btn");
const copyCollectionBtn = document.getElementById("front-copy-collection-btn");
const deleteCollectionBtn = document.getElementById("front-delete-collection-btn");
const emptyTemplate = document.getElementById("empty-row-template");

const DEFAULT_FRONT_COLLECTION = "front_only";

const keywordSet = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in",
  "instanceof", "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "yield", "let", "static", "await", "implements", "interface", "package",
  "private", "protected", "public", "null", "true", "false", "undefined", "NaN", "Infinity"
]);

const builtinValues = {
  Math,
  Number,
  String,
  Boolean,
  Date,
  JSON,
  Array,
  Object,
  RegExp,
  Map,
  Set,
  color: () => "red"
};

let variables = [];
let editingName = null;
let dirty = false;
let runtime = null;
let runtimeModule = null;
let valueByName = new Map();
let rawValueByName = new Map();
let relationFilterText = "";
let variablesSectionCollapsed = false;
let valuesSectionCollapsed = false;
const valueLineByName = new Map();
const variableHandles = new Map();
let selectedCollection = null;
const chartState = {
  draw: null,
  levelSignature: "",
  nodeValueTextByName: new Map()
};
const PENDING_VALUE = Symbol("pending-value");
const topicCacheById = new Map();

let markdownRendererPromise = null;
let previewDialog = null;
let previewTitle = null;
let previewBody = null;

// 从当前 URL 中读取 collection 查询参数。
// 目的：让页面刷新/回退后仍然能恢复到同一个变量集合。
function getRouteCollection() {
  const url = new URL(window.location.href);
  const value = url.searchParams.get("collection");
  const collection = typeof value === "string" ? value.trim() : "";
  return collection || "";
}

// 将集合名写回浏览器地址栏。
// replace=true 用于初始化或回退场景，避免污染历史记录；否则 push 形成可回退历史。
function updateRouteCollection(name, {replace = false} = {}) {
  const url = new URL(window.location.href);
  if (name) {
    url.searchParams.set("collection", name);
  } else {
    url.searchParams.delete("collection");
  }

  const method = replace ? "replaceState" : "pushState";
  window.history[method]({}, "", `${url.pathname}${url.search}${url.hash}`);
}

// 统一设置当前选中的集合名，兜底为前端默认集合。
function setSelectedCollection(name) {
  selectedCollection = String(name || "").trim() || DEFAULT_FRONT_COLLECTION;
}

// 组装 API 请求地址。
// 仅对“与集合绑定”的接口追加 collection 查询参数，避免影响其他公共接口。
function buildApiUrl(rawUrl) {
  const url = new URL(rawUrl, window.location.origin);
  const attachCollection = url.pathname === "/api/front-only/variables"
    || url.pathname === "/api/front-only/save";

  if (attachCollection && selectedCollection) {
    url.searchParams.set("collection", selectedCollection);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

// 深拷贝变量配置，避免直接修改来自后端或 UI 状态中的对象引用。
function cloneVariables(list) {
  return list.map((item) => ({
    name: item.name,
    params: Array.isArray(item.params) ? [...item.params] : [],
    options: {
      params: normalizeOptionParams(item?.options?.params)
    },
    expression: item.expression
  }));
}

// 解析输入参数字符串（逗号分隔）为去重后的参数数组。
function parseParams(input) {
  if (!input.trim()) return [];
  return Array.from(new Set(input.split(",").map((item) => item.trim()).filter(Boolean)));
}

// 规范化 options.params：仅保留非空键，并统一把值转成字符串。
function normalizeOptionParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};
  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey || "").trim();
    if (!key) continue;
    result[key] = String(rawValue ?? "");
  }
  return result;
}

// 解析 UI 中的 params 键值对文本（示例：a:1, b:2）。
// 会对键名做合法标识符校验，避免后续运行时参数注入异常。
function parseOptionParams(input) {
  const text = String(input || "").trim();
  if (!text) return {};

  const result = {};
  const segments = text.split(",").map((item) => item.trim()).filter(Boolean);
  for (const segment of segments) {
    const separatorAt = segment.indexOf(":");
    if (separatorAt < 0) {
      throw new Error(`params 项格式错误: ${segment}`);
    }
    const key = segment.slice(0, separatorAt).trim();
    const value = segment.slice(separatorAt + 1).trim();
    if (!key) throw new Error(`params 键不能为空: ${segment}`);
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
      throw new Error(`params 键不合法: ${key}`);
    }
    result[key] = value;
  }

  return result;
}

function stringifyOptionParams(optionParams) {
  const entries = Object.entries(normalizeOptionParams(optionParams));
  return entries.map(([key, value]) => `${key}:${value}`).join(", ");
}

function stringifyParams(params) {
  return Array.isArray(params) ? params.join(", ") : "";
}

function setDirty(nextDirty) {
  dirty = nextDirty;
  const modeText = dirty ? "未保存" : "已同步";
  statusBadge.textContent = `集合: ${selectedCollection || "-"} | 状态: ${modeText}`;
}

function setFormMode(isEditing) {
  submitBtn.textContent = isEditing ? "保存编辑" : "+";
  cancelBtn.hidden = !isEditing;
}

function resetForm() {
  editingName = null;
  form.reset();
  setFormMode(false);
}

function setSectionCollapsed(section, collapsed) {
  if (section === "variables") {
    variablesSectionCollapsed = collapsed;
    if (variablesSectionBody) variablesSectionBody.hidden = collapsed;
    if (variablesViewToggleBtn) {
      variablesViewToggleBtn.textContent = collapsed ? "正常表示" : "缩小表示";
      variablesViewToggleBtn.setAttribute("aria-expanded", String(!collapsed));
    }
    return;
  }

  if (section === "values") {
    valuesSectionCollapsed = collapsed;
    if (valuesSectionBody) valuesSectionBody.hidden = collapsed;
    if (valuesViewToggleBtn) {
      valuesViewToggleBtn.textContent = collapsed ? "正常表示" : "缩小表示";
      valuesViewToggleBtn.setAttribute("aria-expanded", String(!collapsed));
    }
  }
}



// 确保 Runtime 实例存在，并挂载 afterCompute 钩子以驱动图表刷新。
// 注意：这里只初始化一次，后续重复调用会直接返回。
function ensureRuntime() {
  if (runtime && runtimeModule) return;
  runtime = new Runtime(builtinValues);
  runtimeModule = runtime.module();
  
  runtime.use({
    afterCompute(_runtime, context) {
       const levels = runtime_variablesByLevel();
       //const result = constructTangleLayout(levels);
       renderInteractiveChart(levels);
    }
  });
}

// 彻底重置运行时与图表关联状态。
// 用于重新加载集合、批量导入后重建计算图，防止旧句柄残留。
function resetRuntime() {
  if (runtime) runtime.dispose();
  if (runtime) runtime.unuse();
  runtime = null;
  runtimeModule = null;
  variableHandles.clear();
  chartState.levelSignature = "";
}

// 变量定义校验：
// 1) 名称合法；2) 表达式非空；3) 参数不包含自身；4) params 键合法；5) 名称不重复。
function validateVariable(variable, excludedName = "") {
  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(variable.name)) {
    throw new Error("变量名不合法");
  }

  if (!variable.expression) {
    throw new Error("变量值或表达式不能为空");
  }

  if (variable.params.includes(variable.name)) {
    throw new Error("输入参数不能包含变量自身");
  }

  for (const key of Object.keys(normalizeOptionParams(variable?.options?.params))) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
      throw new Error(`params 键不合法: ${key}`);
    }
  }

  const duplicate = variables.find((item) => item.name === variable.name && item.name !== excludedName);
  if (duplicate) {
    throw new Error(`变量名已存在: ${variable.name}`);
  }
}

function listDependents(name) {
  return variables
    .filter((item) => Array.isArray(item.params) && item.params.includes(name))
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
}

function parseRelationFilterNames(text) {
  return Array.from(new Set(String(text || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)));
}

// 计算“关系链过滤”后可见的节点集合。
// 规则：从种子节点同时向上追溯祖先、向下遍历子孙，最终并集作为可见集合。
function getVisibleVariableNameSet() {
  const seeds = parseRelationFilterNames(relationFilterText);
  if (seeds.length === 0) return null;

  const byName = new Map(variables.map((item) => [item.name, item]));
  const validSeeds = seeds.filter((name) => byName.has(name));
  if (validSeeds.length === 0) return new Set();

  const childrenByParent = new Map();
  for (const item of variables) {
    for (const parentName of (Array.isArray(item.params) ? item.params : [])) {
      if (!byName.has(parentName)) continue;
      if (!childrenByParent.has(parentName)) childrenByParent.set(parentName, []);
      childrenByParent.get(parentName).push(item.name);
    }
  }

  const visible = new Set(validSeeds);
  const upQueue = [...validSeeds];
  while (upQueue.length > 0) {
    const currentName = upQueue.shift();
    const current = byName.get(currentName);
    if (!current) continue;
    for (const parentName of (Array.isArray(current.params) ? current.params : [])) {
      if (!byName.has(parentName) || visible.has(parentName)) continue;
      visible.add(parentName);
      upQueue.push(parentName);
    }
  }

  const downQueue = [...validSeeds];
  while (downQueue.length > 0) {
    const currentName = downQueue.shift();
    const children = childrenByParent.get(currentName) || [];
    for (const childName of children) {
      if (visible.has(childName)) continue;
      visible.add(childName);
      downQueue.push(childName);
    }
  }

  return visible;
}

function getVisibleVariables() {
  const visibleNameSet = getVisibleVariableNameSet();
  if (!visibleNameSet) return variables;
  return variables.filter((item) => visibleNameSet.has(item.name));
}

function refreshFilteredViews() {
  renderTable();
  renderValuesBoard();
  if (runtime) {
    const levels = runtime_variablesByLevel();
    renderInteractiveChart(levels);
  }
}

function renderTable() {
  const visibleVariables = getVisibleVariables();
  tableBody.innerHTML = "";

  if (visibleVariables.length === 0) {
    tableBody.appendChild(emptyTemplate.content.cloneNode(true));
    return;
  }

  for (const variable of visibleVariables) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = variable.name;

    const paramsTd = document.createElement("td");
    paramsTd.textContent = stringifyParams(variable.params);

    const optionParamsTd = document.createElement("td");
    optionParamsTd.textContent = stringifyOptionParams(variable?.options?.params);

    const expressionTd = document.createElement("td");
    expressionTd.textContent = variable.expression;

    const actionTd = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "actions";

    const viewBtn = document.createElement("button");
    viewBtn.type = "button";
    viewBtn.textContent = "查看";
    viewBtn.addEventListener("click", () => {
      void showVariablePreview(variable.name);
    });

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.textContent = "编辑";
    editBtn.addEventListener("click", () => {
      editingName = variable.name;
      nameInput.value = variable.name;
      paramsInput.value = stringifyParams(variable.params);
      optionParamsInput.value = stringifyOptionParams(variable?.options?.params);
      expressionInput.value = variable.expression;
      setFormMode(true);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.textContent = "删除";
    deleteBtn.addEventListener("click", () => {
      deleteVariable(variable.name);
    });

    actions.append(viewBtn, editBtn, deleteBtn);
    actionTd.appendChild(actions);

    tr.append(nameTd, paramsTd, optionParamsTd, expressionTd, actionTd);
    tableBody.appendChild(tr);
  }
}

function renderValuesBoard() {
  const visibleVariables = getVisibleVariables();
  valueLineByName.clear();

  if (visibleVariables.length === 0) {
    valuesOutput.innerHTML = "";
    valuesOutput.textContent = "当前没有已定义变量。";
    return;
  }

  const ordered = [...visibleVariables].map((item) => item.name).sort((a, b) => a.localeCompare(b));
  valuesOutput.innerHTML = "";
  for (let i = 0; i < ordered.length; i += 1) {
    const name = ordered[i];
    const line = document.createElement("span");
    line.textContent = `${name} = ${valueByName.get(name) ?? "<pending>"}`;
    valueLineByName.set(name, line);
    valuesOutput.appendChild(line);
    if (i < ordered.length - 1) {
      valuesOutput.appendChild(document.createTextNode("\n"));
    }
  }
}

function updateValueLine(name) {
  const line = valueLineByName.get(name);
  if (!line) return;
  line.textContent = `${name} = ${valueByName.get(name) ?? "<pending>"}`;
}

function formatChartNodeValue(name) {
  const value = valueByName.get(name) ?? "<pending>";
  const text = String(value);
  if (text.length <= 14) return text;
  return `${text.slice(0, 11)}...`;
}

function updateChartNodeValue(name) {
  const nodeText = chartState.nodeValueTextByName.get(name);
  if (!nodeText) return;
  nodeText.text(formatChartNodeValue(name));
}

function clearDetachedValues() {
  const nameSet = new Set(variables.map((item) => item.name));
  for (const name of [...valueByName.keys()]) {
    if (!nameSet.has(name)) valueByName.delete(name);
  }
  for (const name of [...rawValueByName.keys()]) {
    if (!nameSet.has(name)) rawValueByName.delete(name);
  }
}

function escapeHtml(text) {
  return String(text)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function isLikelyUrlText(text) {
  const source = String(text || "").trim();
  if (!source) return false;
  try {
    const url = new URL(source);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isLikelyMarkdownText(text) {
  const source = String(text || "");
  if (!source.trim()) return false;
  return /(^|\n)#{1,6}\s+\S+/.test(source)
    || /\*\*[^*]+\*\*/.test(source)
    || /(^|\n)\s*[-*+]\s+\S+/.test(source)
    || /\[[^\]]+\]\([^\)]+\)/.test(source)
    || /```/.test(source)
    || /(^|\n)>\s+\S+/.test(source);
}

async function getMarkdownRenderer() {
  if (!markdownRendererPromise) {
    markdownRendererPromise = Promise.all([
      import("https://cdn.jsdelivr.net/npm/marked/lib/marked.esm.js"),
      import("https://cdn.jsdelivr.net/npm/dompurify@3.2.6/+esm")
    ]).then(([markedModule, purifierModule]) => ({
      marked: markedModule.marked,
      DOMPurify: purifierModule.default
    }));
  }
  return markdownRendererPromise;
}

function ensurePreviewDialog() {
  if (previewDialog) return previewDialog;

  previewDialog = document.createElement("dialog");
  previewDialog.className = "preview-dialog";
  previewDialog.innerHTML = `
    <div class="preview-panel">
      <div class="preview-header">
        <h3 id="front-preview-title"></h3>
        <button id="front-preview-close-btn" type="button" class="ghost">关闭</button>
      </div>
      <div id="front-preview-body" class="preview-summary"></div>
    </div>
  `;

  document.body.appendChild(previewDialog);
  previewTitle = previewDialog.querySelector("#front-preview-title");
  previewBody = previewDialog.querySelector("#front-preview-body");

  previewDialog.querySelector("#front-preview-close-btn")?.addEventListener("click", () => {
    previewDialog.close();
  });

  previewDialog.addEventListener("click", (event) => {
    if (event.target === previewDialog) previewDialog.close();
  });

  return previewDialog;
}

function renderPreviewPlainText(text) {
  if (!previewBody) return;
  previewBody.innerHTML = `<pre style="margin:0;white-space:pre-wrap;word-break:break-word;">${escapeHtml(text)}</pre>`;
}

async function showVariablePreview(name) {
  const dialog = ensurePreviewDialog();
  if (!previewTitle || !previewBody) return;

  previewTitle.textContent = `${name} 的值`;
  previewBody.textContent = "加载中...";

  if (!dialog.open) dialog.showModal();

  if (!rawValueByName.has(name) || rawValueByName.get(name) === PENDING_VALUE) {
    previewBody.textContent = "<pending>";
    return;
  }

  const rawValue = rawValueByName.get(name);

  if (typeof rawValue === "string") {
    const trimmed = rawValue.trim();
    if (isLikelyUrlText(trimmed)) {
      previewBody.innerHTML = `<a href="${escapeHtml(trimmed)}" target="_blank" rel="noopener noreferrer">${escapeHtml(trimmed)}</a>`;
      return;
    }

    if (isLikelyMarkdownText(rawValue)) {
      try {
        const {marked, DOMPurify} = await getMarkdownRenderer();
        const html = marked.parse(rawValue);
        previewBody.innerHTML = DOMPurify.sanitize(html);
      } catch {
        renderPreviewPlainText(rawValue);
      }
      return;
    }

    renderPreviewPlainText(rawValue);
    return;
  }

  if (rawValue instanceof Error) {
    renderPreviewPlainText(`<Error: ${rawValue.message}>`);
    return;
  }

  if (typeof rawValue === "function") {
    renderPreviewPlainText(rawValue.toString());
    return;
  }

  renderPreviewPlainText(formatInspectable(rawValue));
}

async function requestJson(url, options = {}) {
  // 统一请求入口：自动补全集合参数、解析 JSON、并把错误包装成可读异常。
  const response = await fetch(buildApiUrl(url), {
    headers: {"Content-Type": "application/json"},
    ...options
  });

  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error || `请求失败: ${response.status}`);
    error.status = response.status;
    error.payload = payload;
    throw error;
  }

  return payload;
}

// 按 topicId 拉取 topic 详情，并做前端缓存，避免双击节点时重复请求。
async function fetchTopicById(topicId) {
  const id = String(topicId || "").trim();
  if (!id) return null;
  if (topicCacheById.has(id)) return topicCacheById.get(id);

  try {
    const payload = await requestJson(`/api/os-taxonomy/topics/${encodeURIComponent(id)}`);
    const topic = payload?.topic || null;
    topicCacheById.set(id, topic);
    return topic;
  } catch {
    topicCacheById.set(id, null);
    return null;
  }
}

// 从表达式中提取 return 的字符串字面量。
// 目的：当变量名被“安全化”后（例如 - 变 _），仍可反解出原始 topicId。
function extractReturnedStringLiteral(expression) {
  const source = String(expression || "");
  const match = source.match(/return\s+(["'])(.*?)\1\s*;?/s);
  if (!match) return "";

  const quote = match[1];
  const raw = match[2];
  const normalized = quote === "\""
    ? raw.replace(/\\"/g, "\"")
    : raw.replace(/\\'/g, "'");
  return normalized.replace(/\\\\/g, "\\");
}

// 解析节点对应的真实 topicId：
// 优先尝试从变量表达式反解原始 id；失败再回退为当前节点 id。
function resolveTopicIdForNode(nodeId) {
  const id = String(nodeId || "").trim();
  if (!id) return "";

  const variable = variables.find((item) => item.name === id);
  if (!variable) return id;

  const fromExpression = extractReturnedStringLiteral(variable.expression);
  return fromExpression || id;
}

// 双击节点时的详情入口。
// 会先查真实 topicId，再回退查节点 id，尽量命中 topics.json。
async function showTopicDialogForNode(node) {
  const nodeId = String(node?.id || "").trim();
  if (!nodeId) return;
  const resolvedTopicId = resolveTopicIdForNode(nodeId);
  const topic = await fetchTopicById(resolvedTopicId) || await fetchTopicById(nodeId);
  dialogManager.showNodeDialog({...node, topic});
}

function isIdentifierStart(ch) {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentifierPart(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

function nextNonSpace(input, index) {
  for (let i = index; i < input.length; i += 1) {
    if (!/\s/.test(input[i])) return input[i];
  }
  return "";
}

function prevNonSpace(input, index) {
  for (let i = index; i >= 0; i -= 1) {
    if (!/\s/.test(input[i])) return input[i];
  }
  return "";
}

function extractDependencies(expression) {
  // 轻量表达式词法扫描：
  // - 跳过字符串内容
  // - 识别标识符
  // - 排除关键字、属性访问和对象 key
  // 最终得到可作为输入依赖的变量名列表。
  const deps = [];
  const seen = new Set();
  let quote = null;
  let escape = false;

  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];

    if (quote) {
      if (escape) {
        escape = false;
      } else if (ch === "\\") {
        escape = true;
      } else if (ch === quote) {
        quote = null;
      }
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (!isIdentifierStart(ch)) continue;

    let j = i + 1;
    while (j < expression.length && isIdentifierPart(expression[j])) j += 1;

    const token = expression.slice(i, j);
    const prev = prevNonSpace(expression, i - 1);
    const next = nextNonSpace(expression, j);

    const isKeyword = keywordSet.has(token);
    const isPropertyAccess = prev === ".";
    const isObjectKey = next === ":";

    if (!isKeyword && !isPropertyAccess && !isObjectKey && !seen.has(token)) {
      seen.add(token);
      deps.push(token);
    }

    i = j - 1;
  }

  return deps;
}

function isFunctionExpression(expression) {
  const source = expression.trim();
  return /^async\s+function(?:\s*\*)?\b/.test(source)
    || /^function(?:\s*\*)?\b/.test(source)
    || /^(?:async\s*)?(?:\([^)]*\)|[A-Za-z_$][A-Za-z0-9_$]*)\s*=>/.test(source);
}

function extractFunctionDependencies(expression) {
  const source = expression.trim();
  let paramsSource = "";
  let match;

  match = source.match(/^(?:async\s+)?function(?:\s*\*)?(?:\s+[A-Za-z_$][A-Za-z0-9_$]*)?\s*\(([^)]*)\)/);
  if (match) {
    paramsSource = match[1] || "";
  } else {
    match = source.match(/^(?:async\s*)?\(([^)]*)\)\s*=>/);
    if (match) {
      paramsSource = match[1] || "";
    } else {
      match = source.match(/^(?:async\s*)?([A-Za-z_$][A-Za-z0-9_$]*)\s*=>/);
      if (match) paramsSource = match[1] || "";
    }
  }

  if (!paramsSource.trim()) return [];

  return paramsSource
    .split(",")
    .map((param) => param.trim())
    .map((param) => (param.startsWith("...") ? param.slice(3).trim() : param))
    .map((param) => {
      const equalAt = param.indexOf("=");
      return equalAt >= 0 ? param.slice(0, equalAt).trim() : param;
    })
    .filter((param) => /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(param));
}

function createDefinition(variable) {
  // 根据变量表达式类型创建可执行 definition：
  // - 函数表达式：直接执行后作为 definition
  // - 普通表达式：封装为 new Function
  // 同时返回依赖列表，供 runtime.define/redefine 使用。
  const params = Array.isArray(variable.params) ? variable.params : [];
  const expression = variable.expression;
  const functionExpression = isFunctionExpression(expression);

  if (functionExpression) {
    return {
      // 函数表达式会被直接作为 definition 执行，而不是作为函数值返回。
      dependencies: (params.length > 0 ? params : extractFunctionDependencies(expression)).filter((d) => d !== variable.name),
      definition: new Function(`return (${expression});`)()
    };
  }

  if (params.length > 0) {
    return {
      dependencies: params.filter((d) => d !== variable.name),
      definition: new Function(...params, `return (${expression});`)
    };
  }

  const deps = extractDependencies(expression).filter((d) => d !== variable.name);
  return {
    dependencies: deps,
    definition: new Function(...deps, `return (${expression});`)
  };
}

function getVariableOptions(variable) {
  const params = normalizeOptionParams(variable?.options?.params);
  return Object.keys(params).length > 0 ? {params} : undefined;
}

function safeCreateDefinition(variable) {
  try {
    return createDefinition(variable);
  } catch (error) {
    return {
      dependencies: [],
      definition: () => {
        throw error;
      }
    };
  }
}

function formatInspectable(value) {
  if (typeof value === "string") return JSON.stringify(value);
  if (typeof value === "function") return "[Function]";
  if (value instanceof Error) return `<Error: ${value.message}>`;
  if (typeof value === "symbol") return value.toString();
  if (typeof value === "bigint") return `${value.toString()}n`;
  if (value === undefined) return "undefined";

  try {
    return JSON.stringify(value);
  } catch {
    return Object.prototype.toString.call(value);
  }
}

function createObserver(name) {
  return {
    pending() {
      valueByName.set(name, "<pending>");
      rawValueByName.set(name, PENDING_VALUE);
      updateValueLine(name);
      updateChartNodeValue(name);
    },
    fulfilled(value) {
      valueByName.set(name, formatInspectable(value));
      rawValueByName.set(name, value);
      updateValueLine(name);
      updateChartNodeValue(name);
    },
    rejected(error) {
      valueByName.set(name, `<Error: ${error?.message || String(error)}>`);
      rawValueByName.set(name, error instanceof Error ? error : new Error(String(error)));
      updateValueLine(name);
      updateChartNodeValue(name);
    }
  };
}

function applyVariableToRuntime(variable) {
  // 增量应用到 runtime：存在则 redefine，不存在则 define。
  ensureRuntime();

  const {dependencies, definition} = safeCreateDefinition(variable);

  let handle = variableHandles.get(variable.name);
  if (handle) {
    runtimeModule.redefine(variable.name, dependencies, definition);
    return;
  }

  handle = runtimeModule.variable(createObserver(variable.name), getVariableOptions(variable));
  variableHandles.set(variable.name, handle);
  handle.define(variable.name, dependencies, definition);
}

function removeVariableFromRuntime(name) {
  const handle = variableHandles.get(name);
  if (!handle) return;
  handle.delete();
  variableHandles.delete(name);
}

function initializeRuntimeFromVariables() {
  resetRuntime();
  ensureRuntime();
  for (const variable of variables) {
    applyVariableToRuntime(variable);
  }
}

async function mergeImportedVariables(imported) {
  // 导入合并策略：同名覆盖、其余保留；随后逐个应用到 runtime。
  const map = new Map(variables.map((item) => [item.name, item]));
  for (const item of imported) {
    map.set(item.name, {
      name: item.name,
      params: [...item.params],
      options: {
        params: normalizeOptionParams(item?.options?.params)
      },
      expression: item.expression
    });
  }

  variables = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
  for (const item of imported) {
    applyVariableToRuntime(item);
  }

  clearDetachedValues();
  renderTable();
  renderValuesBoard();
}

// 解析 CSV 为变量列表。
// 支持引号字段、双引号转义、可选头部以及同名行合并（多行 param 汇总）。
function parseCsvToVariables(text) {
  // 按字符解析 CSV，避免简单 split(',') 在引号/换行场景下失效。
  const parseCsvRows = (source) => {
    const rows = [];
    let row = [];
    let cell = "";
    let inQuotes = false;

    for (let i = 0; i < source.length; i += 1) {
      const ch = source[i];

      if (inQuotes) {
        if (ch === "\"") {
          if (source[i + 1] === "\"") {
            cell += "\"";
            i += 1;
          } else {
            inQuotes = false;
          }
        } else {
          cell += ch;
        }
        continue;
      }

      if (ch === "\"") {
        inQuotes = true;
        continue;
      }

      if (ch === ",") {
        row.push(cell.trim());
        cell = "";
        continue;
      }

      if (ch === "\n" || ch === "\r") {
        if (ch === "\r" && source[i + 1] === "\n") i += 1;
        row.push(cell.trim());
        while (row.length > 0 && row[row.length - 1] === "") row.pop();
        if (row.length > 0) rows.push(row);
        row = [];
        cell = "";
        continue;
      }

      cell += ch;
    }

    if (inQuotes) {
      throw new Error("CSV 引号未闭合");
    }

    row.push(cell.trim());
    while (row.length > 0 && row[row.length - 1] === "") row.pop();
    if (row.length > 0) rows.push(row);

    return rows;
  };

  const rows = parseCsvRows(String(text || ""));
  if (rows.length === 0) throw new Error("CSV 文件为空");

  const firstCells = rows[0].map((item) => item.toLowerCase());
  const hasHeader = firstCells[0] === "name"
    && (firstCells[1] === "input" || firstCells[1] === "param")
    && (firstCells[2] === "function" || firstCells[2] === "expression");
  const optionKeys = hasHeader ? firstCells.slice(3).filter(Boolean) : [];
  const startAt = hasHeader ? 1 : 0;
  const grouped = new Map();

  for (let i = startAt; i < rows.length; i += 1) {
    const cells = rows[i];

    if (cells.length < 3) {
      throw new Error(`第 ${i + 1} 行格式错误，应至少包含 name,param,expression`);
    }

    const name = cells[0];
    const param = cells[1];
    const expression = hasHeader ? cells[2].trim() : cells.slice(2).join(",").trim();
    const optionParams = {};

    if (hasHeader) {
      for (let j = 0; j < optionKeys.length; j += 1) {
        const key = optionKeys[j];
        if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
          throw new Error(`CSV 头部 params 键不合法: ${key}`);
        }
        optionParams[key] = String(cells[3 + j] ?? "").trim();
      }
    }

    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
      throw new Error(`第 ${i + 1} 行变量名不合法: ${name}`);
    }

    if (param && !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(param)) {
      throw new Error(`第 ${i + 1} 行参数不合法: ${param}`);
    }

    if (!expression) {
      throw new Error(`第 ${i + 1} 行 expression 为空`);
    }

    const current = grouped.get(name);
    if (!current) {
      grouped.set(name, {
        name,
        params: param ? [param] : [],
        options: {params: optionParams},
        expression
      });
      continue;
    }

    if (current.expression !== expression) {
      throw new Error(`变量 ${name} 的 expression 不一致，无法合并`);
    }

    if (param && !current.params.includes(param)) current.params.push(param);
    for (const [key, value] of Object.entries(optionParams)) {
      const existing = current.options.params[key] ?? "";
      if (existing && value && existing !== value) {
        throw new Error(`变量 ${name} 的 params.${key} 不一致，无法合并`);
      }
      if (!existing) current.options.params[key] = value;
    }
  }

  const result = [...grouped.values()];
  for (const variable of result) {
    validateVariable(variable, variable.name);
  }

  return result;
}

function parseObjectValue(rawValue) {
  const value = String(rawValue || "").trim();
  if (!value) throw new Error("对象值不能为空");

  if (/^-?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(value)) return value;
  if (/^(true|false|null|undefined|NaN|Infinity|-Infinity)$/.test(value)) return value;

  const first = value[0];
  const last = value[value.length - 1];
  if ((first === "\"" && last === "\"") || (first === "'" && last === "'")) return value;
  if ((first === "{" && last === "}") || (first === "[" && last === "]") || (first === "(" && last === ")")) return value;

  return JSON.stringify(value);
}

function parseKeyValueTextToObjectExpression(text) {
  const lines = String(text || "").split(/\r?\n/);
  const entries = [];

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i].trim();
    if (!line) continue;

    const separatorAt = line.indexOf(":");
    if (separatorAt <= 0) {
      throw new Error(`第 ${i + 1} 行格式错误，应为 key:value`);
    }

    const key = line.slice(0, separatorAt).trim();
    const rawValue = line.slice(separatorAt + 1).trim();
    if (!key) throw new Error(`第 ${i + 1} 行 key 为空`);
    if (!rawValue) throw new Error(`第 ${i + 1} 行 value 为空`);

    const keyExpression = /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : JSON.stringify(key);
    const valueExpression = parseObjectValue(rawValue);
    entries.push(`  ${keyExpression}: ${valueExpression}`);
  }

  if (entries.length === 0) throw new Error("导入文件为空");
  return `({\n${entries.join(",\n")}\n})`;
}

async function loadSavedVariables() {
  const payload = await requestJson("/api/front-only/variables");
  setSelectedCollection(payload.collection || selectedCollection || DEFAULT_FRONT_COLLECTION);
  variables = cloneVariables(payload.variables || []);
  variables.sort((a, b) => a.name.localeCompare(b.name));

  valueByName = new Map(variables.map((item) => [item.name, "<pending>"]));
  rawValueByName = new Map(variables.map((item) => [item.name, PENDING_VALUE]));
  initializeRuntimeFromVariables();

  renderTable();
  renderValuesBoard();
  setDirty(false);
}

function renderCollections(collections) {
  collectionSelect.innerHTML = "";
  for (const collection of collections) {
    const option = document.createElement("option");
    option.value = collection.name;
    option.textContent = `${collection.name} (${collection.variableCount || 0})`;
    collectionSelect.appendChild(option);
  }

  if (selectedCollection) {
    collectionSelect.value = selectedCollection;
  }
}

async function loadCollections() {
  const payload = await requestJson("/api/front-only/collections");
  const collections = Array.isArray(payload.collections) ? payload.collections : [];
  if (collections.length === 0) {
    setSelectedCollection(DEFAULT_FRONT_COLLECTION);
    renderCollections([{name: DEFAULT_FRONT_COLLECTION, variableCount: 0}]);
    return;
  }

  const exists = collections.some((item) => item.name === selectedCollection);
  if (!exists) {
    setSelectedCollection(collections[0].name);
  }
  renderCollections(collections);
}

async function switchCollection(nextName, {replaceRoute = false} = {}) {
  const target = String(nextName || "").trim();
  if (!target || target === selectedCollection) return;

  if (dirty) {
    const ok = window.confirm("当前集合有未保存更改，切换后将丢失，是否继续？");
    if (!ok) {
      collectionSelect.value = selectedCollection || "";
      return;
    }
  }

  resetForm();
  setSelectedCollection(target);
  updateRouteCollection(target, {replace: replaceRoute});
  await loadSavedVariables();
  await loadCollections();
}

async function saveAllVariables() {
  saveBtn.disabled = true;
  try {
    await requestJson("/api/front-only/save", {
      method: "POST",
      body: JSON.stringify({variables: cloneVariables(variables)})
    });
    setDirty(false);
    await loadCollections();
    window.alert("保存成功：已写入独立数据库与独立 JSON 文件");
  } catch (error) {
    window.alert(`保存失败: ${error.message}`);
  } finally {
    saveBtn.disabled = false;
  }
}

function deleteVariable(name) {
  const dependents = listDependents(name);
  if (dependents.length > 0) {
    const ok = window.confirm(`变量 ${name} 被以下变量依赖: ${dependents.join(", ")}\n确认继续删除吗？`);
    if (!ok) return;
  }

  removeVariableFromRuntime(name);
  variables = variables.filter((item) => item.name !== name);
  valueByName.delete(name);
  rawValueByName.delete(name);

  if (editingName === name) resetForm();

  setDirty(true);
  renderTable();
  renderValuesBoard();
}

  const originalD3 = globalThis.d3;
  globalThis.d3 = {
    min(values, accessor = d => d) {
      let found = false;
      let minValue;
      for (const value of values ?? []) {
        const mapped = accessor(value);
        if (mapped == null || Number.isNaN(mapped)) continue;
        if (!found || mapped < minValue) {
          minValue = mapped;
          found = true;
        }
      }
      return found ? minValue : undefined;
    },
    max(values, accessor = d => d) {
      let found = false;
      let maxValue;
      for (const value of values ?? []) {
        const mapped = accessor(value);
        if (mapped == null || Number.isNaN(mapped)) continue;
        if (!found || mapped > maxValue) {
          maxValue = mapped;
          found = true;
        }
      }
      return found ? maxValue : undefined;
    },
    descending(a, b) {
      return b - a;
    }
  };

function runtime_variablesByLevel() {
  // 从 runtime 的内部变量构建绘图节点：
  // - 仅保留当前集合内变量
  // - 过滤关系链不可见节点
  // - 将 _inputs 映射为 parents
  // - 按 variable.level 分层返回
  const definedNameSet = new Set(variables.map((item) => item.name));
  const visibleNameSet = getVisibleVariableNameSet();
  const nodeByName = new Map();

  for (const variable of runtime._variables) {
    const name = variable?._name;
    const level = variable?.level;
    if (!name || !definedNameSet.has(name) /*|| !Number.isFinite(level)*/) continue;
    if (visibleNameSet && !visibleNameSet.has(name)) continue;
    nodeByName.set(name, {
      id: name,
      _name: name,
      level,
      parents: [],
      bundles: []
    });
  }

  for (const variable of runtime._variables) {
    const name = variable?._name;
    const node = nodeByName.get(name);
    if (!node) continue;

    const inputs = Array.isArray(variable._inputs) ? variable._inputs : [];
    node.parents = inputs
      .map((input) => nodeByName.get(input?._name))
      .filter(Boolean);
  }

  const levels = [];
  for (const variable of nodeByName.values()) {
    if (!levels[variable.level]) levels[variable.level] = [];
    levels[variable.level].push(variable);
  }

  return levels;
}

// 为层级结构生成稳定签名。
// 用于判断“图结构是否变化”，避免无变化时重复重绘。
function createLevelsSignature(levels) {
  return levels
    .map((level, index) => {
      const ids = (level || [])
        .map((variable) => variable?._name || variable?.id || "")
        .filter(Boolean)
        .sort((a, b) => a.localeCompare(b));
      return `${index}:${ids.join(",")}`;
    })
    .join("|");
}

form.addEventListener("submit", async (event) => {
  event.preventDefault(); // 阻止默认提交行为,不会刷新页面

  const variable = {
    name: nameInput.value.trim(),
    params: parseParams(paramsInput.value),
    options: {
      params: parseOptionParams(optionParamsInput.value)
    },
    expression: expressionInput.value.trim()
  };

  if (!variable.name || !variable.expression) {
    window.alert("变量名和表达式不能为空");
    return;
  }

  try {
    validateVariable(variable, editingName || "");
    const previousName = editingName;

    if (previousName) {
      variables = variables.map((item) => (item.name === previousName ? variable : item));
      if (previousName !== variable.name) {
        removeVariableFromRuntime(previousName);
        valueByName.delete(previousName);
        rawValueByName.delete(previousName);
      }
    } else {
      variables = [...variables, variable];
    }

    applyVariableToRuntime(variable);
    if (!valueByName.has(variable.name)) valueByName.set(variable.name, "<pending>");
    if (!rawValueByName.has(variable.name)) rawValueByName.set(variable.name, PENDING_VALUE);

    variables.sort((a, b) => a.name.localeCompare(b.name));
    resetForm();
    setDirty(true);
    renderTable();
    renderValuesBoard();
  } catch (error) {
    window.alert(error.message);
  }
});

cancelBtn.addEventListener("click", () => {
  resetForm();
});

saveBtn.addEventListener("click", async () => {
  await saveAllVariables();
});

csvImportBtn.addEventListener("click", () => {
  csvFile.value = "";
  csvFile.click();
});

objectImportBtn?.addEventListener("click", () => {
  if (!objectImportFile) return;
  objectImportFile.value = "";
  objectImportFile.click();
});

csvFile.addEventListener("change", async () => {
  const file = csvFile.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const imported = parseCsvToVariables(text);
    await mergeImportedVariables(imported);
    setDirty(true);
    window.alert(`CSV 导入完成，共生成/更新 ${imported.length} 个变量`);
  } catch (error) {
    window.alert(`CSV 导入失败: ${error.message}`);
  }
});

objectImportFile?.addEventListener("change", async () => {
  const file = objectImportFile.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    expressionInput.value = parseKeyValueTextToObjectExpression(text);
    window.alert("对象导入成功，已填入“值 / 函数 / 计算式”");
  } catch (error) {
    window.alert(`对象导入失败: ${error.message}`);
  }
});

showValuesBtn.addEventListener("click", () => {
  renderValuesBoard();
});

relationFilterInput?.addEventListener("input", () => {
  relationFilterText = relationFilterInput.value.trim();
  refreshFilteredViews();
});

clearRelationFilterBtn?.addEventListener("click", () => {
  relationFilterText = "";
  if (relationFilterInput) relationFilterInput.value = "";
  refreshFilteredViews();
});

variablesViewToggleBtn?.addEventListener("click", () => {
  setSectionCollapsed("variables", !variablesSectionCollapsed);
});

valuesViewToggleBtn?.addEventListener("click", () => {
  setSectionCollapsed("values", !valuesSectionCollapsed);
});

collectionSelect.addEventListener("change", async () => {
  await switchCollection(collectionSelect.value);
});

createCollectionBtn.addEventListener("click", async () => {
  const name = collectionNameInput.value.trim();
  if (!name) {
    window.alert("请输入集合名");
    return;
  }

  try {
    await requestJson("/api/front-only/collections", {
      method: "POST",
      body: JSON.stringify({name})
    });
    collectionNameInput.value = "";
    await loadCollections();
    await switchCollection(name);
  } catch (error) {
    window.alert(`创建集合失败: ${error.message}`);
  }
});

copyCollectionBtn.addEventListener("click", async () => {
  if (!selectedCollection) return;

  if (dirty) {
    const confirmDirty = window.confirm("当前集合有未保存更改，复制只会包含已保存内容，是否继续？");
    if (!confirmDirty) return;
  }

  const typedName = collectionNameInput.value.trim();
  const targetName = typedName || window.prompt("请输入复制后的新集合名", `${selectedCollection}-副本`)?.trim();
  if (!targetName) return;

  try {
    await requestJson("/api/front-only/collections/copy", {
      method: "POST",
      body: JSON.stringify({
        from: selectedCollection,
        to: targetName
      })
    });
    collectionNameInput.value = "";
    await loadCollections();
    await switchCollection(targetName);
  } catch (error) {
    window.alert(`复制集合失败: ${error.message}`);
  }
});

deleteCollectionBtn.addEventListener("click", async () => {
  if (!selectedCollection) return;

  if (dirty) {
    const confirmDirty = window.confirm("当前集合有未保存更改，删除后无法恢复，是否继续？");
    if (!confirmDirty) return;
  }

  const ok = window.confirm(`确认删除集合 ${selectedCollection} 吗？集合中的变量会被全部删除。`);
  if (!ok) return;

  try {
    await requestJson(`/api/front-only/collections/${encodeURIComponent(selectedCollection)}`, {
      method: "DELETE"
    });
    const routeCollection = getRouteCollection();
    if (routeCollection === selectedCollection) {
      updateRouteCollection("", {replace: true});
    }
    await loadCollections();
    await loadSavedVariables();
  } catch (error) {
    window.alert(`删除集合失败: ${error.message}`);
  }
});

window.addEventListener("popstate", async () => {
  const routeCollection = getRouteCollection();
  const target = routeCollection || selectedCollection || DEFAULT_FRONT_COLLECTION;
  await switchCollection(target, {replaceRoute: true});
});

window.addEventListener("beforeunload", (event) => {
  if (!dirty) return;
  event.preventDefault();
  event.returnValue = "";
});


/**
 * 使用 SVG.js 创建可交互的图表版本
 * @param {Array} data - 图表数据
 * @param {Object} options - 配置选项
 * @returns {HTMLElement} SVG 元素
 */
function renderInteractiveChart(data, options = {}) {

  // 若没有任何可绘制节点，清理画布并退出。

  const hasNodes = Array.isArray(data) && data.some((level) => Array.isArray(level) && level.length > 0);
  if (!hasNodes) {
    if (chartState.draw) {
      chartState.draw.remove();
      chartState.draw = null;
    }
    chartState.levelSignature = "";
    chartState.nodeValueTextByName.clear();
    return null;
  }

  const schemeDark2 = [
  "#1b9e77",
  "#d95f02",
  "#7570b3",
  "#e7298a",
  "#66a61e",
  "#e6ab02",
  "#a6761d",
  "#666666"
];

 function scaleOrdinal(range) {
  const index = new Map();
  let next = 0;

  return function(value) {
    if (!index.has(value)) {
      index.set(value, next++);
    }

    return range[index.get(value) % range.length];
  };
}

  //const color = d3.scaleOrdinal(d3.schemeDark2);
  const color = scaleOrdinal(schemeDark2);

  options.color ||= (d, i) => color(i);
  const background_color = 'white';
  const stroke_width = 5;
  const node_width = 30;
  const node_height = 40;
  const node_radius = 6;

  const nextSignature = createLevelsSignature(data, {filterInputOnlyParents: true});
  // 签名不变时复用现有图，减少不必要的 SVG 重建。
  if (chartState.draw && chartState.levelSignature === nextSignature) {
    return chartState.draw.node;
  }

  const layoutOptions = {
    ...options,
    node_width,
    node_height,
    orderBy:"levelInBundle",
    min_family_height: Math.max(node_height, 22),
    filterInputOnlyParents: true
  };
  const tangleLayout = constructTangleLayout(data, layoutOptions);
  const layoutNodeWidth = tangleLayout.layout?.node_width || node_width;
  const layoutNodeHeight = tangleLayout.layout?.node_height || node_height;

  if (chartState.draw) {
    chartState.draw.remove();
    chartState.draw = null;
  }
  chartState.nodeValueTextByName.clear();
  chartState.levelSignature = nextSignature;

     // 使用 SVG.js 创建 SVG 画布
   const draw = SVG().addTo("#svgjs").size(tangleLayout.layout.width, tangleLayout.layout.height);
  chartState.draw = draw;
  
  // 设置背景色
  draw.rect(tangleLayout.layout.width, tangleLayout.layout.height).fill(background_color);
    // 添加样式
    const style = draw.defs().element('style');
    style.node.textContent = `
      text {
        font-family: sans-serif;
        font-size: 10px;
      }
      .node {
        stroke-linecap: round;
      }
      .link {
        fill: none;
      }
    `;

  // 绘制线束（bundles）- 添加交互功能
  const bundleGroup = draw.group().addClass('bundles');
  tangleLayout.bundles.forEach((b, i) => {
    // 每个 bundle 由多段 link 组成，按顺序拼接为一条复合路径。
    const pathData = b.links.map(l => 
      ` M${l.xt} ${l.yt}
       L${l.xb - l.c1} ${l.yt}
       A${l.c1} ${l.c1} 90 0 1 ${l.xb} ${l.yt + l.c1}
       L${l.xb} ${l.ys - l.c2}
       A${l.c2} ${l.c2} 90 0 0 ${l.xb + l.c2} ${l.ys}
       L${l.xs} ${l.ys}`
    ).join("");

    const bundleGroup = draw.group().addClass('bundle');
    
    // 背景路径
    const bgPath = bundleGroup.path(pathData)
        .fill('none')
        .stroke(background_color)
        .attr('stroke-width', stroke_width);

    // 前景路径
    const fgPath = bundleGroup.path(pathData)
        .fill('none')
        .stroke(options.color(b, i))
        .attr('stroke-width', 2);

         // 添加交互效果
     bundleGroup
         .mouseover(function() {
           fgPath.attr('stroke-width', 4);
         })
         .mouseout(function() {
           fgPath.attr('stroke-width', 2);
         })
         .click(function(e) {
           e.stopPropagation();
           dialogManager.showPathDialog(b);
         })
         .attr('style', 'cursor: pointer');
  });

  // 绘制节点 - 添加交互功能
  const nodeGroup = draw.group().addClass('nodes');
  tangleLayout.nodes.forEach(n => {
    const singleNodeGroup = nodeGroup.group().addClass('node');
    const nodeVisualHeight = Math.max(layoutNodeHeight, n.height);

    const nodeRect = singleNodeGroup.rect(layoutNodeWidth, nodeVisualHeight)
        .center(n.x, n.y)
        .radius(node_radius)
        .fill('white')
        .stroke({color: 'black', width: 2});

    // 节点标签
    const titleText = singleNodeGroup.text(n.id)
      .move(n.x + 4, n.y - nodeVisualHeight / 2 - 10)
        .stroke(background_color)
        .attr('stroke-width', 2);
    singleNodeGroup.text(n.id)
      .move(n.x + 4, n.y - nodeVisualHeight / 2 - 10)
        .fill('black');

    const valueText = singleNodeGroup.text(formatChartNodeValue(n.id))
        .font({size: 8, anchor: 'middle', family: 'monospace'})
        .fill('black')
        .center(n.x, n.y);
    chartState.nodeValueTextByName.set(n.id, valueText);

         // 添加交互事件
     singleNodeGroup
       // 双击节点：打开 topic 详情对话框（带 topics.json 数据）。
         .dblclick(async function(e) {
           e.stopPropagation();
           await showTopicDialogForNode(n);
         })
         .mouseover(function() {
           titleText.attr('font-weight', 'bold');
           nodeRect.stroke({color: '#333', width: 3});
         })
         .mouseout(function() {
           titleText.attr('font-weight', 'normal');
           nodeRect.stroke({color: 'black', width: 2});
         })
         .attr('style', 'cursor: pointer');
  });

  return draw.node;
}

(async function boot() {
  setSectionCollapsed("variables", false);
  setSectionCollapsed("values", false);
  const routeCollection = getRouteCollection();
  setSelectedCollection(routeCollection || DEFAULT_FRONT_COLLECTION);
  await loadCollections();
  if (routeCollection && routeCollection !== selectedCollection) {
    updateRouteCollection(selectedCollection, {replace: true});
  }
  await loadSavedVariables();
})();
