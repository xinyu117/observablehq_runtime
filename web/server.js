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
const frontOnlyDataDir = path.join(dataDir, "front-only");
const runtimeSrcDir = path.join(__dirname, "..", "src");

const storage = new VariableStorage({dataDir});
const frontOnlyStorage = new VariableStorage({dataDir: frontOnlyDataDir});

const MIME_BY_EXT = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8"
};

const DEFAULT_COLLECTION = "默认集合";
const FRONT_ONLY_COLLECTION = "front_only";

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

function getCollectionName(url) {
  const value = url.searchParams.get("collection");
  const collection = typeof value === "string" ? value.trim() : "";
  return collection || DEFAULT_COLLECTION;
}

function getFrontOnlyCollectionName(url) {
  const value = url.searchParams.get("collection");
  const collection = typeof value === "string" ? value.trim() : "";
  return collection || FRONT_ONLY_COLLECTION;
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

function normalizeOptionParams(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const result = {};

  for (const [rawKey, rawValue] of Object.entries(value)) {
    const key = String(rawKey || "").trim();
    if (!key) continue;
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key)) {
      throw new Error(`params 键不合法: ${key}`);
    }
    result[key] = String(rawValue ?? "");
  }

  return result;
}

function normalizeVariable(input) {
  const name = typeof input?.name === "string" ? input.name.trim() : "";
  const expression = typeof input?.expression === "string" ? input.expression.trim() : "";
  const params = normalizeParams(input?.params);
  const options = {params: normalizeOptionParams(input?.options?.params)};

  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error("变量名不合法");
  }

  if (!expression) {
    throw new Error("变量值或表达式不能为空");
  }

  if (params.includes(name)) {
    throw new Error("输入参数不能包含变量自身");
  }

  return {name, params, expression, options};
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
  const aOptions = a.options?.params || {};
  const bOptions = b.options?.params || {};
  const aKeys = Object.keys(aOptions).sort();
  const bKeys = Object.keys(bOptions).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i += 1) {
    if (aKeys[i] !== bKeys[i]) return false;
    if (String(aOptions[aKeys[i]]) !== String(bOptions[bKeys[i]])) return false;
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
  if (req.method === "GET" && url.pathname === "/api/front-only/collections") {
    sendJson(res, 200, {collections: frontOnlyStorage.listCollections()});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/front-only/collections") {
    const body = await parseJsonBody(req);
    const name = typeof body?.name === "string" ? body.name : "";
    try {
      const created = await frontOnlyStorage.createCollection(name);
      sendJson(res, 200, {ok: true, name: created});
    } catch (error) {
      if (error.message === "变量集合已存在") {
        sendJson(res, 409, {error: error.message});
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/front-only/collections/copy") {
    const body = await parseJsonBody(req);
    const from = typeof body?.from === "string" ? body.from.trim() : "";
    const to = typeof body?.to === "string" ? body.to.trim() : "";

    if (!from || !to) {
      sendJson(res, 400, {error: "缺少 from 或 to"});
      return;
    }

    const collections = frontOnlyStorage.listCollections();
    if (!collections.some((item) => item.name === from)) {
      sendJson(res, 404, {error: "源集合不存在"});
      return;
    }

    try {
      await frontOnlyStorage.createCollection(to);
    } catch (error) {
      if (error.message === "变量集合已存在") {
        sendJson(res, 409, {error: error.message});
        return;
      }
      throw error;
    }

    const copiedVariables = frontOnlyStorage.list(from);
    await frontOnlyStorage.importVariables(copiedVariables, "replace", to);
    sendJson(res, 200, {ok: true, from, to, count: copiedVariables.length});
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/front-only/collections/")) {
    const name = decodeURIComponent(url.pathname.slice("/api/front-only/collections/".length));
    try {
      await frontOnlyStorage.removeCollection(name);
      sendJson(res, 200, {ok: true});
    } catch (error) {
      if (["变量集合不存在", "至少保留一个变量集合"].includes(error.message)) {
        sendJson(res, 409, {error: error.message});
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/front-only/variables") {
    const collection = getFrontOnlyCollectionName(url);
    const variables = frontOnlyStorage.list(collection);
    sendJson(res, 200, {collection, variables});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/front-only/save") {
    const collection = getFrontOnlyCollectionName(url);
    const body = await parseJsonBody(req);
    const variables = normalizeVariableList(body?.variables);
    await frontOnlyStorage.importVariables(variables, "replace", collection);
    sendJson(res, 200, {ok: true, collection, count: variables.length});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/collections") {
    sendJson(res, 200, {collections: storage.listCollections()});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/collections") {
    const body = await parseJsonBody(req);
    const name = typeof body?.name === "string" ? body.name : "";
    try {
      const created = await storage.createCollection(name);
      sendJson(res, 200, {ok: true, name: created});
    } catch (error) {
      if (error.message === "变量集合已存在") {
        sendJson(res, 409, {error: error.message});
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/collections/")) {
    const name = decodeURIComponent(url.pathname.slice("/api/collections/".length));
    try {
      await storage.removeCollection(name);
      sendJson(res, 200, {ok: true});
    } catch (error) {
      if (["变量集合不存在", "至少保留一个变量集合"].includes(error.message)) {
        sendJson(res, 409, {error: error.message});
        return;
      }
      throw error;
    }
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/variables") {
    const collection = getCollectionName(url);
    sendJson(res, 200, {collection, variables: storage.list(collection)});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/export") {
    const collection = getCollectionName(url);
    sendDownloadJson(res, "variables-export.json", {
      collection,
      variables: storage.list(collection)
    });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/values") {
    const collection = getCollectionName(url);
    const values = await evaluateVariables(storage.list(collection));
    sendJson(res, 200, {values});
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/values/stream") {
    const collection = getCollectionName(url);
    res.writeHead(200, {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache"
    });

    for await (const item of evaluateVariablesStream(storage.list(collection))) {
      res.write(`${JSON.stringify(item)}\n`);
    }

    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/variables") {
    const collection = getCollectionName(url);
    const body = await parseJsonBody(req);
    const variable = normalizeVariable(body);

    await storage.upsert(variable, collection);
    sendJson(res, 200, {ok: true, variable});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import") {
    const collection = getCollectionName(url);
    const body = await parseJsonBody(req);
    const mode = body?.mode === "merge" ? "merge" : "replace";
    const variables = normalizeVariableList(body?.variables);
    await storage.importVariables(variables, mode, collection);
    sendJson(res, 200, {ok: true, mode, count: variables.length});
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/import/preview") {
    const collection = getCollectionName(url);
    const body = await parseJsonBody(req);
    const mode = body?.mode === "merge" ? "merge" : "replace";
    const variables = normalizeVariableList(body?.variables);
    const preview = buildImportPreview(storage.list(collection), variables, mode);
    sendJson(res, 200, {ok: true, preview});
    return;
  }

  if (req.method === "PUT" && url.pathname.startsWith("/api/variables/")) {
    const collection = getCollectionName(url);
    const oldName = decodeURIComponent(url.pathname.slice("/api/variables/".length));
    const body = await parseJsonBody(req);
    const variable = normalizeVariable(body);

    const existing = storage.list(collection).find((item) => item.name === oldName);
    if (!existing) {
      sendJson(res, 404, {error: "变量不存在"});
      return;
    }

    if (oldName !== variable.name) {
      const dependents = storage.getDependents(oldName, collection);
      try {
        await storage.renameWithCascade(oldName, variable, collection);
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

    await storage.upsert(variable, collection);
    sendJson(res, 200, {ok: true, variable});
    return;
  }

  if (req.method === "DELETE" && url.pathname.startsWith("/api/variables/")) {
    const collection = getCollectionName(url);
    const name = decodeURIComponent(url.pathname.slice("/api/variables/".length));
    const force = url.searchParams.get("force") === "1";

    const exists = storage.list(collection).some((item) => item.name === name);
    if (!exists) {
      sendJson(res, 404, {error: "变量不存在"});
      return;
    }

    const dependents = storage.getDependents(name, collection);
    if (dependents.length > 0 && !force) {
      sendJson(res, 409, {
        error: "该变量被其他变量作为输入参数引用",
        dependents,
        needsConfirmation: true
      });
      return;
    }

    await storage.remove(name, collection);
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
  await frontOnlyStorage.init();
  try {
    await frontOnlyStorage.createCollection(FRONT_ONLY_COLLECTION);
  } catch (error) {
    if (error.message !== "变量集合已存在") throw error;
  }
  const port = Number.parseInt(process.env.PORT || "5173", 10);

  const server = http.createServer((req, res) => {
    onRequest(req, res);
  });

  server.listen(port, () => {
    console.log(`Web runtime app listening on http://localhost:${port}`);
  });

  const shutdown = async () => {
    await storage.close();
    await frontOnlyStorage.close();
    server.close(() => process.exit(0));
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

start().catch((error) => {
  console.error(error);
  process.exit(1);
});
