import {Runtime} from "/runtime-src/index.js";

const DEFAULT_COLLECTION = "默认集合";

const homeView = document.getElementById("home-view");
const managerView = document.getElementById("manager-view");
const collectionForm = document.getElementById("collection-form");
const collectionNameInput = document.getElementById("collection-name");
const collectionsBody = document.getElementById("collections-body");
const createCollectionBtn = document.getElementById("create-collection-btn");
const backHomeBtn = document.getElementById("back-home-btn");
const currentCollectionLabel = document.getElementById("current-collection");
const emptyCollectionTemplate = document.getElementById("empty-collection-row-template");

const form = document.getElementById("variable-form");
const nameInput = document.getElementById("name");
const paramsInput = document.getElementById("params");
const optionParamsInput = document.getElementById("option-params");
const expressionInput = document.getElementById("expression");
const submitBtn = document.getElementById("submit-btn");
const cancelBtn = document.getElementById("cancel-btn");
const showValuesBtn = document.getElementById("show-values-btn");
const showValuesAsyncBtn = document.getElementById("show-values-async-btn");
const saveBtn = document.getElementById("save-btn");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");
const modeBackendBtn = document.getElementById("mode-backend-btn");
const modeLocalBtn = document.getElementById("mode-local-btn");
const modeBadge = document.getElementById("mode-badge");
const previewDialog = document.getElementById("import-preview-dialog");
const previewSummary = document.getElementById("preview-summary");
const previewCreated = document.getElementById("preview-created");
const previewUpdated = document.getElementById("preview-updated");
const previewRemoved = document.getElementById("preview-removed");
const previewUnchanged = document.getElementById("preview-unchanged");
const previewCloseBtn = document.getElementById("preview-close-btn");
const previewCopyBtn = document.getElementById("preview-copy-btn");
const previewCancelBtn = document.getElementById("preview-cancel-btn");
const previewConfirmBtn = document.getElementById("preview-confirm-btn");
const tableBody = document.getElementById("variables-body");
const valuesOutput = document.getElementById("values-output");
const emptyTemplate = document.getElementById("empty-row-template");

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
  Set
};

let mode = "backend";
let backendVariables = [];
let localVariables = [];
let localInitialized = false;
let editingName = null;
let pendingImport = null;
let currentImportPreview = null;
let asyncValuesTask = null;
let selectedCollection = null;

function getRouteCollection() {
  const url = new URL(window.location.href);
  const value = url.searchParams.get("collection");
  const collection = typeof value === "string" ? value.trim() : "";
  return collection || "";
}

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

function buildApiUrl(rawUrl) {
  const url = new URL(rawUrl, window.location.origin);
  const isApi = url.pathname.startsWith("/api/");
  const isCollectionManagementApi = url.pathname.startsWith("/api/collections");

  if (isApi && !isCollectionManagementApi && selectedCollection) {
    url.searchParams.set("collection", selectedCollection);
  }

  return `${url.pathname}${url.search}${url.hash}`;
}

function showHomeView() {
  homeView.hidden = false;
  managerView.hidden = true;
}

function showManagerView() {
  homeView.hidden = true;
  managerView.hidden = false;
}

function clearManagerState() {
  cancelValuesAsync({silent: true});
  backendVariables = [];
  localVariables = [];
  localInitialized = false;
  resetForm();
  renderTable();
  valuesOutput.textContent = "点击“查看当前所有变量和值”加载";
}

function setSelectedCollection(name) {
  selectedCollection = name || null;
  currentCollectionLabel.textContent = `集合: ${selectedCollection || "-"}`;
}

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

function activeVariables() {
  return mode === "backend" ? backendVariables : localVariables;
}

function setActiveVariables(list) {
  if (mode === "backend") {
    backendVariables = list;
  } else {
    localVariables = list;
  }
}

function parseParams(input) {
  if (!input.trim()) return [];
  return Array.from(
    new Set(
      input
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean)
    )
  );
}

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

function setFormMode(isEditing) {
  submitBtn.textContent = isEditing ? "保存" : "+";
  cancelBtn.hidden = !isEditing;
}

function resetForm() {
  editingName = null;
  form.reset();
  setFormMode(false);
}

function setMode(nextMode) {
  // 切换模式前先中止正在进行的异步展示，避免旧任务继续写 UI。
  cancelValuesAsync({silent: true});
  mode = nextMode;
  resetForm();
  pendingImport = null;
  currentImportPreview = null;

  if (mode === "local") {
    if (!localInitialized) {
      localVariables = cloneVariables(backendVariables);
      localInitialized = true;
    }
    modeBackendBtn.className = "ghost";
    modeLocalBtn.className = "secondary";
    modeBadge.textContent = "当前: 前端 Runtime 结算";
    saveBtn.hidden = false;
  } else {
    modeBackendBtn.className = "secondary";
    modeLocalBtn.className = "ghost";
    modeBadge.textContent = "当前: 后台结算";
    saveBtn.hidden = true;
  }

  renderTable();
  loadValues();
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
  // 轻量依赖提取：忽略字符串字面量、对象键名与属性访问，仅提取自由标识符。
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
    // 显式 params 视为该变量的依赖，表达式作为定义函数体执行。
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

  const duplicate = activeVariables().find((item) => item.name === variable.name && item.name !== excludedName);
  if (duplicate) {
    throw new Error(`变量名已存在: ${variable.name}`);
  }
}

function listDependents(name) {
  return activeVariables()
    .filter((item) => Array.isArray(item.params) && item.params.includes(name))
    .map((item) => item.name)
    .sort((a, b) => a.localeCompare(b));
}

function renderTable() {
  const list = activeVariables();
  tableBody.innerHTML = "";

  if (list.length === 0) {
    const clone = emptyTemplate.content.cloneNode(true);
    tableBody.appendChild(clone);
    return;
  }

  for (const variable of list) {
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

    const editBtn = document.createElement("button");
    editBtn.textContent = "编辑";
    editBtn.type = "button";
    editBtn.addEventListener("click", () => {
      editingName = variable.name;
      nameInput.value = variable.name;
      paramsInput.value = stringifyParams(variable.params);
      optionParamsInput.value = stringifyOptionParams(variable?.options?.params);
      expressionInput.value = variable.expression;
      setFormMode(true);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.textContent = "删除";
    deleteBtn.type = "button";
    deleteBtn.addEventListener("click", async () => {
      await deleteVariable(variable.name);
    });

    actions.append(editBtn, deleteBtn);
    actionTd.appendChild(actions);
    tr.append(nameTd, paramsTd, optionParamsTd, expressionTd, actionTd);
    tableBody.appendChild(tr);
  }
}

async function requestJson(url, options = {}) {
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

async function exportVariablesBackend() {
  const response = await fetch(buildApiUrl("/api/export"));
  if (!response.ok) {
    throw new Error(`导出失败: ${response.status}`);
  }

  const blob = await response.blob();
  const link = document.createElement("a");
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  const safeCollection = (selectedCollection || DEFAULT_COLLECTION).replace(/\s+/g, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `variables-export-${safeCollection}-${now}.json`;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

async function exportVariablesLocal() {
  const payload = {
    exportedAt: new Date().toISOString(),
    variables: cloneVariables(activeVariables()).sort((a, b) => a.name.localeCompare(b.name))
  };

  const blob = new Blob([JSON.stringify(payload, null, 2)], {type: "application/json"});
  const link = document.createElement("a");
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `variables-local-export-${now}.json`;
  document.body.appendChild(link);
  link.click();
  URL.revokeObjectURL(link.href);
  link.remove();
}

function parseImportPayload(parsed) {
  if (Array.isArray(parsed)) return parsed;
  if (parsed && Array.isArray(parsed.variables)) return parsed.variables;
  throw new Error("导入文件格式不正确，需为变量数组或包含 variables 数组的对象");
}

function normalizeImportedVariable(raw) {
  return {
    name: String(raw?.name || "").trim(),
    params: parseParams(Array.isArray(raw?.params) ? raw.params.join(",") : String(raw?.params || "")),
    options: {
      params: normalizeOptionParams(raw?.options?.params)
    },
    expression: String(raw?.expression || "").trim()
  };
}

function validateImportedVariables(variables) {
  // 导入校验只检查“数据自身合法性”，不限制与当前已有变量同名。
  const names = new Set();

  for (const item of variables) {
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(item.name)) {
      throw new Error("变量名不合法");
    }

    if (!item.expression) {
      throw new Error("变量值或表达式不能为空");
    }

    if (item.params.includes(item.name)) {
      throw new Error("输入参数不能包含变量自身");
    }

    if (names.has(item.name)) {
      throw new Error(`导入数据中变量名重复: ${item.name}`);
    }
    names.add(item.name);
  }
}

function variableEquals(a, b) {
  if (!a || !b) return false;
  if (a.expression !== b.expression) return false;
  if (!Array.isArray(a.params) || !Array.isArray(b.params)) return false;
  if (a.params.length !== b.params.length) return false;
  for (let i = 0; i < a.params.length; i += 1) {
    if (a.params[i] !== b.params[i]) return false;
  }
  const aOptions = normalizeOptionParams(a?.options?.params);
  const bOptions = normalizeOptionParams(b?.options?.params);
  const aKeys = Object.keys(aOptions).sort();
  const bKeys = Object.keys(bOptions).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (aOptions[aKeys[i]] !== bOptions[bKeys[i]]) return false;
  }
  return true;
}

function buildImportPreview(current, incoming, modeName) {
  const currentMap = new Map(current.map((item) => [item.name, item]));
  const incomingMap = new Map(incoming.map((item) => [item.name, item]));

  const created = [];
  const updated = [];
  const unchanged = [];
  const removed = [];

  for (const item of incoming) {
    const existing = currentMap.get(item.name);
    if (!existing) {
      created.push(item.name);
      continue;
    }

    if (variableEquals(existing, item)) {
      unchanged.push(item.name);
    } else {
      updated.push(item.name);
    }
  }

  if (modeName === "replace") {
    for (const item of current) {
      if (!incomingMap.has(item.name)) {
        removed.push(item.name);
      }
    }
  }

  const sortNames = (arr) => arr.sort((a, b) => a.localeCompare(b));
  sortNames(created);
  sortNames(updated);
  sortNames(unchanged);
  sortNames(removed);

  return {
    mode: modeName,
    incomingCount: incoming.length,
    currentCount: current.length,
    createCount: created.length,
    updateCount: updated.length,
    unchangedCount: unchanged.length,
    removeCount: removed.length,
    created,
    updated,
    unchanged,
    removed
  };
}

function formatNameList(names) {
  if (!Array.isArray(names) || names.length === 0) return "无";
  return names.join(", ");
}

function formatImportPreview(preview) {
  return [
    `导入模式: ${preview.mode}`,
    `当前变量数: ${preview.currentCount}`,
    `导入变量数: ${preview.incomingCount}`,
    `将新增(${preview.createCount}): ${formatNameList(preview.created)}`,
    `将覆盖(${preview.updateCount}): ${formatNameList(preview.updated)}`,
    `将删除(${preview.removeCount}): ${formatNameList(preview.removed)}`,
    `不变(${preview.unchangedCount}): ${formatNameList(preview.unchanged)}`
  ].join("\n");
}

function renderPreviewList(element, names) {
  element.innerHTML = "";
  if (!Array.isArray(names) || names.length === 0) {
    element.classList.add("empty");
    element.textContent = "无";
    return;
  }

  element.classList.remove("empty");
  const ul = document.createElement("ul");
  for (const name of names) {
    const li = document.createElement("li");
    li.textContent = name;
    ul.appendChild(li);
  }
  element.appendChild(ul);
}

function renderPreviewDialog(preview) {
  currentImportPreview = preview;
  previewSummary.textContent = [
    `导入模式: ${preview.mode}`,
    `当前变量数: ${preview.currentCount}`,
    `导入变量数: ${preview.incomingCount}`,
    `新增: ${preview.createCount}，覆盖: ${preview.updateCount}，删除: ${preview.removeCount}，不变: ${preview.unchangedCount}`
  ].join("\n");

  renderPreviewList(previewCreated, preview.created);
  renderPreviewList(previewUpdated, preview.updated);
  renderPreviewList(previewRemoved, preview.removed);
  renderPreviewList(previewUnchanged, preview.unchanged);
}

function closePreviewDialog() {
  pendingImport = null;
  currentImportPreview = null;
  if (previewDialog.open) previewDialog.close();
}

async function confirmImportFromPreview() {
  if (!pendingImport) return;

  previewConfirmBtn.disabled = true;
  try {
    const incomingVariables = pendingImport.variables;
    const modeName = pendingImport.mode;

    if (mode === "backend") {
      await requestJson("/api/import", {
        method: "POST",
        body: JSON.stringify({
          mode: modeName,
          variables: incomingVariables
        })
      });
      await loadVariablesFromBackend();
      await loadValues();
    } else if (modeName === "replace") {
      localVariables = cloneVariables(incomingVariables);
      renderTable();
      await loadValues();
    } else {
      const map = new Map(localVariables.map((item) => [item.name, item]));
      for (const item of incomingVariables) {
        map.set(item.name, item);
      }
      localVariables = [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
      renderTable();
      await loadValues();
    }

    closePreviewDialog();
    window.alert("导入完成");
  } catch (error) {
    window.alert(`导入失败: ${error.message}`);
  } finally {
    previewConfirmBtn.disabled = false;
  }
}

async function loadVariablesFromBackend() {
  const payload = await requestJson("/api/variables");
  backendVariables = payload.variables || [];
  if (!localInitialized) {
    localVariables = cloneVariables(backendVariables);
    localInitialized = true;
  }
  renderTable();
}

function renderCollectionsTable(collections) {
  collectionsBody.innerHTML = "";

  if (!Array.isArray(collections) || collections.length === 0) {
    const clone = emptyCollectionTemplate.content.cloneNode(true);
    collectionsBody.appendChild(clone);
    return;
  }

  for (const collection of collections) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = collection.name;

    const countTd = document.createElement("td");
    countTd.textContent = String(collection.variableCount || 0);

    const actionTd = document.createElement("td");
    const actions = document.createElement("div");
    actions.className = "collections-actions";

    const enterBtn = document.createElement("button");
    enterBtn.type = "button";
    enterBtn.className = "secondary";
    enterBtn.textContent = "进入管理";
    enterBtn.addEventListener("click", async () => {
      await openCollectionManager(collection.name);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.type = "button";
    deleteBtn.className = "ghost";
    deleteBtn.textContent = "删除集合";
    deleteBtn.addEventListener("click", async () => {
      const ok = window.confirm(`确认删除变量集合“${collection.name}”吗？该集合内变量会被全部删除。`);
      if (!ok) return;

      try {
        await requestJson(`/api/collections/${encodeURIComponent(collection.name)}`, {method: "DELETE"});
        await loadCollections();
      } catch (error) {
        window.alert(error.message);
      }
    });

    actions.append(enterBtn, deleteBtn);
    actionTd.appendChild(actions);

    tr.append(nameTd, countTd, actionTd);
    collectionsBody.appendChild(tr);
  }
}

async function loadCollections() {
  const payload = await requestJson("/api/collections");
  renderCollectionsTable(payload.collections || []);
}

async function openCollectionManager(name, {replaceRoute = false} = {}) {
  const collectionName = String(name || "").trim();
  if (!collectionName) return;

  setSelectedCollection(collectionName);
  updateRouteCollection(collectionName, {replace: replaceRoute});
  clearManagerState();
  showManagerView();

  await loadVariablesFromBackend();
  setMode("backend");
}

async function backToHome({replaceRoute = false} = {}) {
  setSelectedCollection(null);
  updateRouteCollection("", {replace: replaceRoute});
  clearManagerState();
  showHomeView();
  await loadCollections();
}

async function evaluateVariablesLocal(items) {
  const runtime = new Runtime(builtinValues);
  const module = runtime.module();
  const ordered = [...items].sort((a, b) => a.name.localeCompare(b.name));

  try {
    for (const variable of ordered) {
      const {dependencies, definition} = createDefinition(variable);
      module
        .variable(true, getVariableOptions(variable))
        .define(variable.name, dependencies, definition);
    }

    const values = [];
    for (const variable of ordered) {
      try {
        const value = await module.value(variable.name);
        values.push({name: variable.name, value: formatInspectable(value)});
      } catch (error) {
        values.push({name: variable.name, error: error.message});
      }
    }

    return values;
  } finally {
    runtime.dispose();
  }
}

function createValuesBoard(names) {
  // 展示层维护一个“变量名 -> 文本状态”映射，支持先渲染名称再逐项填充值。
  const orderedNames = [...names].sort((a, b) => a.localeCompare(b));
  const statusByName = new Map(orderedNames.map((name) => [name, {kind: "pending", text: "<pending>"}]));
  let displayVersion = -1;

  function resetPending() {
    for (const name of orderedNames) {
      statusByName.set(name, {kind: "pending", text: "<pending>"});
    }
  }

  function render() {
    if (orderedNames.length === 0) {
      valuesOutput.textContent = "当前没有已定义变量。";
      return;
    }

    valuesOutput.textContent = orderedNames
      .map((name) => `${name} = ${statusByName.get(name).text}`)
      .join("\n");
  }

  // 对齐 client.js 的 display 思路：拒绝旧版本写入，并在新版本开始时统一重置。
  function display(version, item) {
    if (version < displayVersion) throw new Error("stale display");
    if (version > displayVersion) {
      resetPending();
      displayVersion = version;
    }

    if (!item?.name || !statusByName.has(item.name)) return;
    const text = item.error
      ? `<Error: ${item.error}>`
      : item.value == null ? String(item.value) : String(item.value);
    statusByName.set(item.name, item.error ? {kind: "error", text} : {kind: "value", text});
    render();
  }

  resetPending();
  render();
  return {render, display};
}

async function evaluateVariablesLocalWithObserver(items, {signal, onUpdate}) {
  // 本地模式下为每个变量挂观察者：fulfilled/rejected 时立即推送到 UI。
  const runtime = new Runtime(builtinValues);
  const module = runtime.module();
  const ordered = [...items].sort((a, b) => a.name.localeCompare(b.name));

  try {
    for (const variable of ordered) {
      const {dependencies, definition} = createDefinition(variable);
      module
        .variable(true, getVariableOptions(variable))
        .define(variable.name, dependencies, definition);
    }

    await new Promise((resolve, reject) => {
      let remaining = ordered.length;
      const settled = new Set();
      let detached = false;
      let onAbort;

      const cleanup = () => {
        if (detached) return;
        detached = true;
        if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      };

      const settle = (name, payload) => {
        if (settled.has(name)) return;
        settled.add(name);
        onUpdate(payload);
        remaining -= 1;
        if (remaining === 0) {
          cleanup();
          resolve();
        }
      };

      if (remaining === 0) {
        cleanup();
        resolve();
        return;
      }

      onAbort = () => {
        cleanup();
        reject(createAbortError());
      };
      if (signal) {
        if (signal.aborted) {
          cleanup();
          reject(createAbortError());
          return;
        }
        signal.addEventListener("abort", onAbort, {once: true});
      }

      for (const variable of ordered) {
        const variableName = variable.name;
        module.variable({
          fulfilled(value) {
            settle(variableName, {name: variableName, value: formatInspectable(value)});
          },
          rejected(error) {
            settle(variableName, {name: variableName, error: error?.message || String(error)});
          }
        }).define([variableName], (value) => value);
      }
    });
  } finally {
    runtime.dispose();
  }
}

function setAsyncValuesButtonState(running) {
  showValuesAsyncBtn.textContent = running ? "停止异步显示" : "异步显示当前所有变量和值";
}

function createAbortError() {
  const error = new Error("已取消异步加载。");
  error.name = "AbortError";
  return error;
}

function throwIfAborted(signal) {
  if (signal.aborted) throw createAbortError();
}

function cancelValuesAsync({silent = false} = {}) {
  // 仅终止当前轮异步任务，不触发额外业务逻辑。
  if (!asyncValuesTask) return false;
  asyncValuesTask.abortController.abort();
  asyncValuesTask = null;
  setAsyncValuesButtonState(false);
  if (!silent) valuesOutput.textContent = "已取消异步加载。";
  return true;
}

async function loadValuesAsync() {
  if (asyncValuesTask) {
    // 再次点击按钮即视为“停止当前异步展示”。
    cancelValuesAsync();
    return;
  }

  const abortController = new AbortController();
  const {signal} = abortController;
  const task = {abortController};
  asyncValuesTask = task;
  setAsyncValuesButtonState(true);
  valuesOutput.textContent = "异步加载中...";

  try {
    valuesOutput.textContent = "";

    const board = createValuesBoard(activeVariables().map((item) => item.name));
    const display = (() => {
      // 每轮展示绑定唯一版本号，防止旧任务回写覆盖新任务结果。
      const version = Date.now();
      return (item) => board.display(version, item);
    })();

    if (mode === "backend") {
      const response = await fetch(buildApiUrl("/api/values/stream"), {signal});
      if (!response.ok) {
        throw new Error(`请求失败: ${response.status}`);
      }

      if (!response.body) {
        throw new Error("当前浏览器不支持流式读取");
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let chunkBuffer = "";
      let count = 0;

      while (true) {
        throwIfAborted(signal);
        const {value, done} = await reader.read();
        if (done) break;

        chunkBuffer += decoder.decode(value, {stream: true});
        const lines = chunkBuffer.split("\n");
        chunkBuffer = lines.pop() || "";

        for (const line of lines) {
          throwIfAborted(signal);
          if (!line.trim()) continue;
          const item = JSON.parse(line);
          display(item.error ? {name: item.name, error: item.error} : {name: item.name, value: item.value});
          count += 1;
        }
      }

      chunkBuffer += decoder.decode();
      if (chunkBuffer.trim()) {
        throwIfAborted(signal);
        const item = JSON.parse(chunkBuffer);
        display(item.error ? {name: item.name, error: item.error} : {name: item.name, value: item.value});
        count += 1;
      }

      if (count === 0) board.render();
      return;
    }

    await evaluateVariablesLocalWithObserver(localVariables, {
      signal,
      onUpdate: (item) => {
        throwIfAborted(signal);
        display(item);
      }
    });
  } catch (error) {
    if (error?.name === "AbortError") {
      valuesOutput.textContent = "已取消异步加载。";
      return;
    }
    valuesOutput.textContent = `错误: ${error.message}`;
  } finally {
    if (asyncValuesTask === task) {
      asyncValuesTask = null;
      setAsyncValuesButtonState(false);
    }
  }
}

async function loadValues() {
  cancelValuesAsync({silent: true});
  valuesOutput.textContent = "加载中...";

  try {
    if (mode === "backend") {
      const payload = await requestJson("/api/values");
      const lines = (payload.values || []).map((item) => {
        if (item.error) return `${item.name} = <Error: ${item.error}>`;
        return `${item.name} = ${item.value}`;
      });
      valuesOutput.textContent = lines.length ? lines.join("\n") : "当前没有已定义变量。";
      return;
    }

    const values = await evaluateVariablesLocal(localVariables);
    const lines = values.map((item) => {
      if (item.error) return `${item.name} = <Error: ${item.error}>`;
      return `${item.name} = ${item.value}`;
    });
    valuesOutput.textContent = lines.length ? lines.join("\n") : "当前没有已定义变量。";
  } catch (error) {
    valuesOutput.textContent = `错误: ${error.message}`;
  }
}

async function saveLocalToBackend() {
  saveBtn.disabled = true;
  try {
    await requestJson("/api/import", {
      method: "POST",
      body: JSON.stringify({
        mode: "replace",
        variables: cloneVariables(localVariables).sort((a, b) => a.name.localeCompare(b.name))
      })
    });
    backendVariables = cloneVariables(localVariables);
    window.alert("已保存到数据库和后台文件");
  } catch (error) {
    window.alert(`保存失败: ${error.message}`);
  } finally {
    saveBtn.disabled = false;
  }
}

async function deleteVariable(name) {
  if (mode === "backend") {
    try {
      await requestJson(`/api/variables/${encodeURIComponent(name)}`, {method: "DELETE"});
      await loadVariablesFromBackend();
      await loadValues();
    } catch (error) {
      if (error.status === 409 && error.payload?.needsConfirmation) {
        const dependents = (error.payload.dependents || []).join(", ");
        const ok = window.confirm(`变量 ${name} 被以下变量依赖: ${dependents}\n确认继续删除吗？`);
        if (!ok) return;

        await requestJson(`/api/variables/${encodeURIComponent(name)}?force=1`, {method: "DELETE"});
        await loadVariablesFromBackend();
        await loadValues();
        return;
      }

      window.alert(error.message);
    }
    return;
  }

  const dependents = listDependents(name);
  if (dependents.length > 0) {
    const ok = window.confirm(`变量 ${name} 被以下变量依赖: ${dependents.join(", ")}\n确认继续删除吗？`);
    if (!ok) return;
  }

  localVariables = localVariables.filter((item) => item.name !== name);
  if (editingName === name) resetForm();
  renderTable();
  await loadValues();
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

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
    if (mode === "backend") {
      if (editingName) {
        const payload = await requestJson(`/api/variables/${encodeURIComponent(editingName)}`, {
          method: "PUT",
          body: JSON.stringify(variable)
        });

        if (Array.isArray(payload.updatedDependents) && payload.updatedDependents.length > 0) {
          window.alert(`已自动更新依赖变量的输入参数: ${payload.updatedDependents.join(", ")}`);
        }
      } else {
        await requestJson("/api/variables", {
          method: "POST",
          body: JSON.stringify(variable)
        });
      }

      resetForm();
      await loadVariablesFromBackend();
      await loadValues();
      return;
    }

    validateVariable(variable, editingName || "");
    if (editingName) {
      localVariables = localVariables.map((item) => (item.name === editingName ? variable : item));
    } else {
      localVariables = [...localVariables, variable];
    }

    localVariables.sort((a, b) => a.name.localeCompare(b.name));
    resetForm();
    renderTable();
    await loadValues();
  } catch (error) {
    const dependents = error.payload?.dependents;
    if (Array.isArray(dependents) && dependents.length > 0) {
      window.alert(`${error.message}\n依赖变量: ${dependents.join(", ")}`);
      return;
    }

    window.alert(error.message);
  }
});

cancelBtn.addEventListener("click", () => {
  resetForm();
});

showValuesBtn.addEventListener("click", async () => {
  await loadValues();
});

showValuesAsyncBtn.addEventListener("click", async () => {
  await loadValuesAsync();
});

saveBtn.addEventListener("click", async () => {
  if (mode !== "local") return;
  await saveLocalToBackend();
});

exportBtn.addEventListener("click", async () => {
  try {
    if (mode === "backend") {
      await exportVariablesBackend();
    } else {
      await exportVariablesLocal();
    }
  } catch (error) {
    window.alert(error.message);
  }
});

importBtn.addEventListener("click", () => {
  importFile.value = "";
  importFile.click();
});

importFile.addEventListener("change", async () => {
  const file = importFile.files?.[0];
  if (!file) return;

  try {
    const text = await file.text();
    const parsed = JSON.parse(text);
    const importedVariables = parseImportPayload(parsed).map(normalizeImportedVariable);
    validateImportedVariables(importedVariables);

    const modeInput = window.prompt("导入模式：输入 replace 覆盖导入，输入 merge 合并导入", "replace");
    if (modeInput === null) return;

    const modeName = modeInput.trim().toLowerCase();
    if (modeName !== "replace" && modeName !== "merge") {
      window.alert("导入模式无效，请输入 replace 或 merge");
      return;
    }

    if (mode === "backend") {
      const previewPayload = await requestJson("/api/import/preview", {
        method: "POST",
        body: JSON.stringify({
          mode: modeName,
          variables: importedVariables
        })
      });

      pendingImport = {
        mode: modeName,
        variables: importedVariables
      };
      renderPreviewDialog(previewPayload.preview || {});
      previewDialog.showModal();
      return;
    }

    pendingImport = {
      mode: modeName,
      variables: importedVariables
    };
    renderPreviewDialog(buildImportPreview(localVariables, importedVariables, modeName));
    previewDialog.showModal();
  } catch (error) {
    window.alert(`导入失败: ${error.message}`);
  }
});

previewCloseBtn.addEventListener("click", () => {
  closePreviewDialog();
});

previewCancelBtn.addEventListener("click", () => {
  closePreviewDialog();
});

previewCopyBtn.addEventListener("click", async () => {
  const preview = formatImportPreview(currentImportPreview || {
    mode: pendingImport?.mode || "replace",
    currentCount: 0,
    incomingCount: 0,
    createCount: 0,
    updateCount: 0,
    removeCount: 0,
    unchangedCount: 0,
    created: [],
    updated: [],
    removed: [],
    unchanged: []
  });

  try {
    await navigator.clipboard.writeText(preview);
    window.alert("预览内容已复制");
  } catch {
    window.alert("复制失败，请手动复制");
  }
});

previewConfirmBtn.addEventListener("click", async () => {
  await confirmImportFromPreview();
});

previewDialog.addEventListener("close", () => {
  pendingImport = null;
  currentImportPreview = null;
});

modeBackendBtn.addEventListener("click", async () => {
  setMode("backend");
});

modeLocalBtn.addEventListener("click", async () => {
  setMode("local");
});

collectionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const name = collectionNameInput.value.trim();
  if (!name) {
    window.alert("变量集合名不能为空");
    return;
  }

  createCollectionBtn.disabled = true;
  try {
    await requestJson("/api/collections", {
      method: "POST",
      body: JSON.stringify({name})
    });
    collectionForm.reset();
    await loadCollections();
  } catch (error) {
    window.alert(error.message);
  } finally {
    createCollectionBtn.disabled = false;
  }
});

backHomeBtn.addEventListener("click", async () => {
  await backToHome();
});

window.addEventListener("popstate", async () => {
  const routeCollection = getRouteCollection();
  if (routeCollection) {
    await openCollectionManager(routeCollection, {replaceRoute: true});
  } else {
    await backToHome({replaceRoute: true});
  }
});

(async function boot() {
  const routeCollection = getRouteCollection();
  if (routeCollection) {
    await openCollectionManager(routeCollection, {replaceRoute: true});
  } else {
    await backToHome({replaceRoute: true});
  }
})();
