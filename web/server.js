import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {evaluateVariables, evaluateVariablesStream} from "./runtime-evaluator.js";
import {VariableStorage} from "./storage.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const publicDir = path.join(__dirname, "public");
const dataDir = path.join(__dirname, "data");
const runtimeSrcDir = path.join(__dirname, "..", "src");

const storage = new VariableStorage({dataDir});

const MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, {"Content-Type": "application/json; charset=utf-8"});
  res.end(JSON.stringify(payload));
}

function sendDownloadJson(res, fileName, payload) {
  res.writeHead(200, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Disposition": `attachment; filename="${fileName}"`
  });
  res.end(JSON.stringify(payload, null, 2));
}

function normalizeParams(value) {
  if (!Array.isArray(value)) return [];
  const result = [];
  const seen = new Set();

  for (const item of value) {
    if (typeof item !== "string") continue;
    const trimmed = item.trim();
    if (!trimmed) continue;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
      throw new Error(`输入参数不合法: ${trimmed}`);
    }
    if (!seen.has(trimmed)) {
      seen.add(trimmed);
      result.push(trimmed);
    }
  }

  return result;
}

function normalizeVariable(input) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const expression = typeof input?.expression === "string" ? input.expression.trim() : "";
  const params = normalizeParams(input?.params);

  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error("变量名不合法");
  }

  if (!expression) {
    throw new Error("变量值或表达式不能为空");
  }

  if (params.includes(name)) {
    throw new Error("输入参数不能包含变量自身");
  }

  return {name, params, expression};
}

function normalizeVariableList(input) {
  if (!Array.isArray(input)) {
    throw new Error("导入数据必须是变量数组");
  }

  const result = [];
  const names = new Set();

  for (const item of input) {
    const normalized = normalizeVariable(item);
    if (names.has(normalized.name)) {
      throw new Error(`导入数据中变量名重复: ${normalized.name}`);
    }
    names.add(normalized.name);
    result.push(normalized);
  }

  return result;
}

function variableEquals(a, b) {
  if (!a || !b) return false;
  if (a.expression !== b.expression) return false;
  if (!Array.isArray(a.params) || !Array.isArray(b.params)) return false;
  if (a.params.length !== b.params.length) return false;
  for (let i = 0; i < a.params.length; i += 1) {
    if (a.params[i] !== b.params[i]) return false;
  }
  return true;
}

function buildImportPreview(current, incoming, mode) {
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

  if (mode === "replace") {
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
    mode,
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

async function parseJsonBody(req) {
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks).toString("utf8").trim();
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error("请求体不是合法 JSON");
  }
}

async function serveFileFromDir(res, rootDir, pathname, defaultPath = "/index.html") {
  const cleanPath = pathname === "/" ? defaultPath : pathname;
  const targetPath = path.normalize(path.join(rootDir, cleanPath));

  if (!targetPath.startsWith(rootDir)) {
    sendJson(res, 403, {error: "禁止访问"});
    return;
  }

  try {
    const stat = await fs.stat(targetPath);
    if (stat.isDirectory()) {
      sendJson(res, 404, {error: "未找到资源"});
      return;
    }

    const ext = path.extname(targetPath).toLowerCase();
    const mime = MIME_BY_EXT[ext] || "application/octet-stream";
    const content = await fs.readFile(targetPath);
    res.writeHead(200, {"Content-Type": mime});
    res.end(content);
  } catch {
    sendJson(res, 404, {error: "未找到资源"});
  }
}

async function serveStatic(req, res, pathname) {
  await serveFileFromDir(res, publicDir, pathname, "/index.html");
}

async function serveRuntimeSource(req, res, pathname) {
  const cleanPath = pathname.slice("/runtime-src".length) || "/index.js";
  await serveFileFromDir(res, runtimeSrcDir, cleanPath, "/index.js");
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/variables") {
    sendJson(res, 200, {variables: storage.list()});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/export") {
    sendDownloadJson(res, "variables-export.json", storage.list());
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/values") {
    const values = await evaluateVariables(storage.list());
    sendJson(res, 200, {values});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/values/stream") {
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache"
    });

    for await (const item of evaluateVariablesStream(storage.list())) {
      res.write(`${JSON.stringify(item)}\n`);
    }

    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/variables") {
    const body = await parseJsonBody(req);
    const variable = normalizeVariable(body);

    await storage.upsert(variable);
    sendJson(res, 200, {ok: true, variable});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const body = await parseJsonBody(req);
    const mode = body?.mode === "merge" ? "merge" : "replace";
    const variables = normalizeVariableList(body?.variables);
    await storage.importVariables(variables, mode);
    sendJson(res, 200, {ok: true, mode, count: variables.length});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/preview") {
    const body = await parseJsonBody(req);
    const mode = body?.mode === "merge" ? "merge" : "replace";
    const variables = normalizeVariableList(body?.variables);
    const preview = buildImportPreview(storage.list(), variables, mode);
    sendJson(res, 200, {ok: true, preview});
    return;
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/variables/")) {
    const oldName = decodeURIComponent(url.pathname.slice("/api/variables/".length));
    const body = await parseJsonBody(req);
    const variable = normalizeVariable(body);

    const existing = storage.list().find((item) => item.name === oldName);
    if (!existing) {
      sendJson(res, 404, {error: "变量不存在"});
      return;
    }

    if (oldName !== variable.name) {
      const dependents = storage.getDependents(oldName);
      try {
        await storage.renameWithCascade(oldName, variable);
      } catch (error) {
        if (error.message === "新变量名已存在") {
          sendJson(res, 409, {error: "新变量名已存在"});
          return;
        }
        throw error;
      }

      sendJson(res, 200, {
        ok: true,
        variable,
        renamedFrom: oldName,
        updatedDependents: dependents
      });
      return;
    }

    await storage.upsert(variable);
    sendJson(res, 200, {ok: true, variable});
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/variables/")) {
    const name = decodeURIComponent(url.pathname.slice("/api/variables/".length));
    const force = url.searchParams.get("force") === "1";

    const exists = storage.list().some((item) => item.name === name);
    if (!exists) {
      sendJson(res, 404, {error: "变量不存在"});
      return;
    }

    const dependents = storage.getDependents(name);
    if (dependents.length > 0 && !force) {
      sendJson(res, 409, {
        error: "该变量被其他变量作为输入参数引用",
        dependents,
        needsConfirmation: true
      });
      return;
    }

    await storage.remove(name);
    sendJson(res, 200, {ok: true});
    return;
  }

  sendJson(res, 404, {error: "未找到接口"});
}

async function onRequest(req, res) {
  const url = new URL(req.url, "http://localhost");

  try {
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }

    if (url.pathname.startsWith("/runtime-src/")) {
      await serveRuntimeSource(req, res, url.pathname);
      return;
    }

    if (url.pathname === "/runtime-src") {
      await serveRuntimeSource(req, res, "/runtime-src/index.js");
      return;
    }

    await serveStatic(req, res, url.pathname);
  } catch (error) {
    sendJson(res, 500, {error: error.message || "服务器内部错误"});
  }
}

async function start() {
  await storage.init();
  const port = Number.parseInt(process.env.PORT || "5173", 10);

  const server = http.createServer((req, res) => {
    onRequest(req, res);
  });

  server.listen(port, () => {
    console.log(`Web runtime app listening on http://localhost:${port}`);
  });

  const shutdown = async () => {
    await storage.close();
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
