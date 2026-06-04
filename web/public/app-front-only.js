import {Runtime} from "/runtime-src/index.js";

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
const showValuesBtn = document.getElementById("show-values-btn");
const tableBody = document.getElementById("variables-body");
const valuesOutput = document.getElementById("values-output");
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
  Set
};

let variables = [];
let editingName = null;
let dirty = false;
let runtime = null;
let runtimeModule = null;
let valueByName = new Map();
const variableHandles = new Map();
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

function setSelectedCollection(name) {
  selectedCollection = String(name || "").trim() || DEFAULT_FRONT_COLLECTION;
}

function buildApiUrl(rawUrl) {
  const url = new URL(rawUrl, window.location.origin);
  const attachCollection = url.pathname === "/api/front-only/variables"
    || url.pathname === "/api/front-only/save";

  if (attachCollection && selectedCollection) {
    url.searchParams.set("collection", selectedCollection);
  }

  return `${url.pathname}${url.search}${url.hash}`;
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

function parseParams(input) {
  if (!input.trim()) return [];
  return Array.from(new Set(input.split(",").map((item) => item.trim()).filter(Boolean)));
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

function ensureRuntime() {
  if (runtime && runtimeModule) return;
  runtime = new Runtime(builtinValues);
  runtimeModule = runtime.module();
}

function resetRuntime() {
  if (runtime) runtime.dispose();
  runtime = null;
  runtimeModule = null;
  variableHandles.clear();
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

function renderTable() {
  tableBody.innerHTML = "";

  if (variables.length === 0) {
    tableBody.appendChild(emptyTemplate.content.cloneNode(true));
    return;
  }

  for (const variable of variables) {
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

    actions.append(editBtn, deleteBtn);
    actionTd.appendChild(actions);

    tr.append(nameTd, paramsTd, optionParamsTd, expressionTd, actionTd);
    tableBody.appendChild(tr);
  }
}

function renderValuesBoard() {
  if (variables.length === 0) {
    valuesOutput.textContent = "当前没有已定义变量。";
    return;
  }

  const ordered = [...variables].map((item) => item.name).sort((a, b) => a.localeCompare(b));
  const lines = ordered.map((name) => `${name} = ${valueByName.get(name) ?? "<pending>"}`);
  valuesOutput.textContent = lines.join("\n");
}

function clearDetachedValues() {
  const nameSet = new Set(variables.map((item) => item.name));
  for (const name of [...valueByName.keys()]) {
    if (!nameSet.has(name)) valueByName.delete(name);
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

function createDefinition(variable) {
  const params = Array.isArray(variable.params) ? variable.params : [];
  const expression = variable.expression;
  const functionExpression = isFunctionExpression(expression);

  if (params.length > 0) {
    return {
      dependencies: params.filter((d) => d !== variable.name),
      definition: new Function(...params, `return (${expression});`)
    };
  }

  if (functionExpression) {
    return {
      dependencies: [],
      definition: new Function(`return (${expression});`)
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
      renderValuesBoard();
    },
    fulfilled(value) {
      valueByName.set(name, formatInspectable(value));
      renderValuesBoard();
    },
    rejected(error) {
      valueByName.set(name, `<Error: ${error?.message || String(error)}>`);
      renderValuesBoard();
    }
  };
}

function applyVariableToRuntime(variable) {
  ensureRuntime();

  let handle = variableHandles.get(variable.name);
  if (handle) {
    handle.delete();
    variableHandles.delete(variable.name);
  }

  handle = runtimeModule.variable(createObserver(variable.name), getVariableOptions(variable));
  variableHandles.set(variable.name, handle);

  const {dependencies, definition} = safeCreateDefinition(variable);
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

function parseCsvToVariables(text) {
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  if (lines.length === 0) throw new Error("CSV 文件为空");

  const readCells = (raw) => {
    const cells = raw.split(",").map((item) => item.trim());
    while (cells.length > 0 && cells[cells.length - 1] === "") {
      cells.pop();
    }
    return cells;
  };

  const firstCells = readCells(lines[0]).map((item) => item.toLowerCase());
  const hasHeader = firstCells[0] === "name"
    && (firstCells[1] === "input" || firstCells[1] === "param")
    && (firstCells[2] === "function" || firstCells[2] === "expression");
  const optionKeys = hasHeader ? firstCells.slice(3).filter(Boolean) : [];
  const startAt = hasHeader ? 1 : 0;
  const grouped = new Map();

  for (let i = startAt; i < lines.length; i += 1) {
    const raw = lines[i];
    const cells = readCells(raw);

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

    if (!param || !/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(param)) {
      throw new Error(`第 ${i + 1} 行参数不合法: ${param}`);
    }

    if (!expression) {
      throw new Error(`第 ${i + 1} 行 expression 为空`);
    }

    const current = grouped.get(name);
    if (!current) {
      grouped.set(name, {
        name,
        params: [param],
        options: {params: optionParams},
        expression
      });
      continue;
    }

    if (current.expression !== expression) {
      throw new Error(`变量 ${name} 的 expression 不一致，无法合并`);
    }

    if (!current.params.includes(param)) current.params.push(param);
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

async function loadSavedVariables() {
  const payload = await requestJson("/api/front-only/variables");
  setSelectedCollection(payload.collection || selectedCollection || DEFAULT_FRONT_COLLECTION);
  variables = cloneVariables(payload.variables || []);
  variables.sort((a, b) => a.name.localeCompare(b.name));

  valueByName = new Map(variables.map((item) => [item.name, "<pending>"]));
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

  if (editingName === name) resetForm();

  setDirty(true);
  renderTable();
  renderValuesBoard();
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
      }
    } else {
      variables = [...variables, variable];
    }

    applyVariableToRuntime(variable);
    if (!valueByName.has(variable.name)) valueByName.set(variable.name, "<pending>");

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

showValuesBtn.addEventListener("click", () => {
  renderValuesBoard();
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

(async function boot() {
  const routeCollection = getRouteCollection();
  setSelectedCollection(routeCollection || DEFAULT_FRONT_COLLECTION);
  await loadCollections();
  if (routeCollection && routeCollection !== selectedCollection) {
    updateRouteCollection(selectedCollection, {replace: true});
  }
  await loadSavedVariables();
})();
