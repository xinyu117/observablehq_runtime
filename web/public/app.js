const form = document.getElementById("variable-form");
const nameInput = document.getElementById("name");
const paramsInput = document.getElementById("params");
const expressionInput = document.getElementById("expression");
const submitBtn = document.getElementById("submit-btn");
const cancelBtn = document.getElementById("cancel-btn");
const showValuesBtn = document.getElementById("show-values-btn");
const exportBtn = document.getElementById("export-btn");
const importBtn = document.getElementById("import-btn");
const importFile = document.getElementById("import-file");
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

let variables = [];
let editingName = null;
let pendingImport = null;
let currentImportPreview = null;

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

function renderTable() {
  tableBody.innerHTML = "";

  if (variables.length === 0) {
    const clone = emptyTemplate.content.cloneNode(true);
    tableBody.appendChild(clone);
    return;
  }

  for (const variable of variables) {
    const tr = document.createElement("tr");

    const nameTd = document.createElement("td");
    nameTd.textContent = variable.name;

    const paramsTd = document.createElement("td");
    paramsTd.textContent = stringifyParams(variable.params);

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
    tr.append(nameTd, paramsTd, expressionTd, actionTd);
    tableBody.appendChild(tr);
  }
}

async function requestJson(url, options = {}) {
  const response = await fetch(url, {
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

async function exportVariables() {
  const response = await fetch("/api/export");
  if (!response.ok) {
    throw new Error(`导出失败: ${response.status}`);
  }

  const blob = await response.blob();
  const link = document.createElement("a");
  const now = new Date().toISOString().replace(/[:.]/g, "-");
  link.href = URL.createObjectURL(blob);
  link.download = `variables-export-${now}.json`;
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
    await requestJson("/api/import", {
      method: "POST",
      body: JSON.stringify(pendingImport)
    });

    closePreviewDialog();
    await loadVariables();
    await loadValues();
    window.alert("导入完成");
  } catch (error) {
    window.alert(`导入失败: ${error.message}`);
  } finally {
    previewConfirmBtn.disabled = false;
  }
}

async function loadVariables() {
  const payload = await requestJson("/api/variables");
  variables = payload.variables || [];
  renderTable();
}

async function loadValues() {
  valuesOutput.textContent = "加载中...";
  try {
    const payload = await requestJson("/api/values");
    const lines = (payload.values || []).map((item) => {
      if (item.error) return `${item.name} = <Error: ${item.error}>`;
      return `${item.name} = ${item.value}`;
    });
    valuesOutput.textContent = lines.length ? lines.join("\n") : "当前没有已定义变量。";
  } catch (error) {
    valuesOutput.textContent = `错误: ${error.message}`;
  }
}

async function deleteVariable(name) {
  try {
    await requestJson(`/api/variables/${encodeURIComponent(name)}`, {method: "DELETE"});
    await loadVariables();
    await loadValues();
  } catch (error) {
    if (error.status === 409 && error.payload?.needsConfirmation) {
      const dependents = (error.payload.dependents || []).join(", ");
      const ok = window.confirm(`变量 ${name} 被以下变量依赖: ${dependents}\n确认继续删除吗？`);
      if (!ok) return;

      await requestJson(`/api/variables/${encodeURIComponent(name)}?force=1`, {method: "DELETE"});
      await loadVariables();
      await loadValues();
      return;
    }

    window.alert(error.message);
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const variable = {
    name: nameInput.value.trim(),
    params: parseParams(paramsInput.value),
    expression: expressionInput.value.trim()
  };

  if (!variable.name || !variable.expression) {
    window.alert("变量名和表达式不能为空");
    return;
  }

  try {
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
    await loadVariables();
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

exportBtn.addEventListener("click", async () => {
  try {
    await exportVariables();
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
    const importedVariables = parseImportPayload(parsed);

    const modeInput = window.prompt("导入模式：输入 replace 覆盖导入，输入 merge 合并导入", "replace");
    if (modeInput === null) return;

    const mode = modeInput.trim().toLowerCase();
    if (mode !== "replace" && mode !== "merge") {
      window.alert("导入模式无效，请输入 replace 或 merge");
      return;
    }

    const previewPayload = await requestJson("/api/import/preview", {
      method: "POST",
      body: JSON.stringify({
        mode,
        variables: importedVariables
      })
    });

    const preview = previewPayload.preview || {};
    pendingImport = {
      mode,
      variables: importedVariables
    };
    renderPreviewDialog(preview);
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

(async function boot() {
  await loadVariables();
  await loadValues();
})();
