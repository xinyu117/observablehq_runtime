import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";

const DEFAULT_COLLECTION = "默认集合";

function isIdentifierStart(ch) {
  return /[A-Za-z_$]/.test(ch);
}

function isIdentifierPart(ch) {
  return /[A-Za-z0-9_$]/.test(ch);
}

function rewriteIdentifier(expression, fromName, toName) {
  let quote = null;
  let escape = false;
  let result = "";

  for (let i = 0; i < expression.length; i += 1) {
    const ch = expression[i];

    if (quote) {
      result += ch;
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
      result += ch;
      continue;
    }

    if (!isIdentifierStart(ch)) {
      result += ch;
      continue;
    }

    let j = i + 1;
    while (j < expression.length && isIdentifierPart(expression[j])) j += 1;
    const token = expression.slice(i, j);
    const prev = i > 0 ? expression[i - 1] : "";

    if (token === fromName && prev !== ".") {
      result += toName;
    } else {
      result += token;
    }

    i = j - 1;
  }

  return result;
}

export class VariableStorage {
  constructor(options = {}) {
    this.dataDir = options.dataDir;
    this.jsonPath = path.join(this.dataDir, "variables.json");
    this.dbPath = path.join(this.dataDir, "variables.db");
    this.SQL = null;
    this.db = null;
  }

  async init() {
    await fs.mkdir(this.dataDir, {recursive: true});
    this.SQL = await initSqlJs();
    this.db = await this.openDatabase();

    this.db.run("PRAGMA foreign_keys = ON");
    this.ensureSchema();

    const collectionCount = this.scalar("SELECT COUNT(1) AS c FROM collections");
    if (collectionCount === 0) {
      const snapshot = await this.loadFromFile();
      if (snapshot.length > 0) {
        for (const entry of snapshot) {
          this.insertCollection(entry.name);
          for (const variable of entry.variables) {
            this.insertRow(entry.name, variable);
          }
        }
      } else {
        this.insertCollection(DEFAULT_COLLECTION);
      }
      await this.persistDatabase();
    }

    await this.writeSnapshotFile();
  }

  async close() {
    if (this.db) {
      await this.persistDatabase();
      this.db.close();
      this.db = null;
    }
  }

  list(collection = DEFAULT_COLLECTION) {
    const collectionName = this.normalizeCollectionName(collection);
    return this.queryRows(
      "SELECT name, params_json, options_params_json, expression FROM variables WHERE collection_name = ? ORDER BY name ASC",
      [collectionName]
    )
      .map((row) => ({
        name: row.name,
        params: JSON.parse(row.params_json),
        options: {
          params: row.options_params_json ? JSON.parse(row.options_params_json) : {}
        },
        expression: row.expression
      }));
  }

  listCollections() {
    return this.queryRows(`
      SELECT c.name, COUNT(v.name) AS variable_count
      FROM collections c
      LEFT JOIN variables v ON c.name = v.collection_name
      GROUP BY c.name
      ORDER BY c.name ASC
    `).map((row) => ({
      name: row.name,
      variableCount: Number(row.variable_count || 0)
    }));
  }

  async createCollection(name) {
    const collectionName = this.normalizeCollectionName(name);
    const exists = this.scalar("SELECT COUNT(1) AS c FROM collections WHERE name = ?", [collectionName]) > 0;
    if (exists) throw new Error("变量集合已存在");
    this.insertCollection(collectionName);
    await this.persistDatabase();
    await this.writeSnapshotFile();
    return collectionName;
  }

  async removeCollection(name) {
    const collectionName = this.normalizeCollectionName(name);
    const exists = this.scalar("SELECT COUNT(1) AS c FROM collections WHERE name = ?", [collectionName]) > 0;
    if (!exists) throw new Error("变量集合不存在");

    const count = this.scalar("SELECT COUNT(1) AS c FROM collections");
    if (count <= 1) throw new Error("至少保留一个变量集合");

    this.db.run("DELETE FROM collections WHERE name = ?", [collectionName]);
    await this.persistDatabase();
    await this.writeSnapshotFile();
  }

  async upsert(variable, collection = DEFAULT_COLLECTION) {
    const collectionName = this.normalizeCollectionName(collection);
    this.ensureCollectionExists(collectionName);
    this.insertRow(collectionName, variable);
    await this.persistDatabase();
    await this.writeSnapshotFile();
  }

  async renameWithCascade(oldName, variable, collection = DEFAULT_COLLECTION) {
    const collectionName = this.normalizeCollectionName(collection);
    this.ensureCollectionExists(collectionName);
    const all = this.list(collectionName);
    const exists = all.some((item) => item.name === oldName);
    if (!exists) {
      throw new Error("变量不存在");
    }

    if (oldName !== variable.name && all.some((item) => item.name === variable.name)) {
      throw new Error("新变量名已存在");
    }

    this.db.run("BEGIN TRANSACTION");
    try {
      if (oldName !== variable.name) {
        this.db.run("DELETE FROM variables WHERE collection_name = ? AND name = ?", [collectionName, oldName]);
      }

      this.insertRow(collectionName, variable);

      if (oldName !== variable.name) {
        const dependents = all.filter((item) => item.params.includes(oldName));
        for (const dependent of dependents) {
          const updated = {
            ...dependent,
            params: dependent.params.map((param) => (param === oldName ? variable.name : param)),
            expression: rewriteIdentifier(dependent.expression, oldName, variable.name)
          };
          this.insertRow(collectionName, updated);
        }
      }

      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }

    await this.persistDatabase();
    await this.writeSnapshotFile();
  }

  async remove(name, collection = DEFAULT_COLLECTION) {
    const collectionName = this.normalizeCollectionName(collection);
    this.ensureCollectionExists(collectionName);
    this.db.run("DELETE FROM variables WHERE collection_name = ? AND name = ?", [collectionName, name]);
    await this.persistDatabase();
    await this.writeSnapshotFile();
  }

  async importVariables(variables, mode = "replace", collection = DEFAULT_COLLECTION) {
    if (mode !== "replace" && mode !== "merge") {
      throw new Error("不支持的导入模式");
    }

    const collectionName = this.normalizeCollectionName(collection);
    this.ensureCollectionExists(collectionName);

    this.db.run("BEGIN TRANSACTION");
    try {
      if (mode === "replace") {
        this.db.run("DELETE FROM variables WHERE collection_name = ?", [collectionName]);
      }

      for (const variable of variables) {
        this.insertRow(collectionName, variable);
      }

      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }

    await this.persistDatabase();
    await this.writeSnapshotFile();
  }

  getDependents(name, collection = DEFAULT_COLLECTION) {
    const all = this.list(collection);
    return all
      .filter((item) => Array.isArray(item.params) && item.params.includes(name))
      .map((item) => item.name)
      .sort((a, b) => a.localeCompare(b));
  }

  insertCollection(name) {
    this.db.run(`
      INSERT INTO collections (name, created_at, updated_at)
      VALUES (?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        updated_at = excluded.updated_at
    `, [
      name,
      new Date().toISOString(),
      new Date().toISOString()
    ]);
  }

  insertRow(collectionName, variable) {
    const optionParams = variable?.options?.params && typeof variable.options.params === "object"
      ? variable.options.params
      : {};
    this.db.run(`
      INSERT INTO variables (collection_name, name, params_json, options_params_json, expression, updated_at)
      VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(collection_name, name) DO UPDATE SET
        params_json = excluded.params_json,
        options_params_json = excluded.options_params_json,
        expression = excluded.expression,
        updated_at = excluded.updated_at
    `, [
      collectionName,
      variable.name,
      JSON.stringify(variable.params),
      JSON.stringify(optionParams),
      variable.expression,
      new Date().toISOString()
    ]);

    this.db.run("UPDATE collections SET updated_at = ? WHERE name = ?", [new Date().toISOString(), collectionName]);
  }

  ensureCollectionExists(collectionName) {
    const exists = this.scalar("SELECT COUNT(1) AS c FROM collections WHERE name = ?", [collectionName]) > 0;
    if (!exists) throw new Error("变量集合不存在");
  }

  normalizeCollectionName(name) {
    const value = typeof name === "string" ? name.trim() : "";
    if (!value) throw new Error("变量集合名不能为空");
    if (value.length > 80) throw new Error("变量集合名过长");
    return value;
  }

  ensureSchema() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS collections (
        name TEXT PRIMARY KEY,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    const hasVariables = this.scalar("SELECT COUNT(1) AS c FROM sqlite_master WHERE type = 'table' AND name = 'variables'") > 0;
    if (!hasVariables) {
      this.createVariablesTable();
      return;
    }

    const columns = this.queryRows("PRAGMA table_info(variables)").map((row) => row.name);
    const hasCollectionColumn = columns.includes("collection_name");

    if (!hasCollectionColumn) {
      this.db.run("ALTER TABLE variables RENAME TO variables_legacy");
      this.createVariablesTable();
      this.insertCollection(DEFAULT_COLLECTION);
      this.db.run(`
      INSERT INTO variables (collection_name, name, params_json, options_params_json, expression, updated_at)
      SELECT ?, name, params_json, '{}', expression, updated_at
      FROM variables_legacy
    `, [DEFAULT_COLLECTION]);
      this.db.run("DROP TABLE variables_legacy");
      return;
    }

    const hasOptionParamsColumn = columns.includes("options_params_json");
    if (!hasOptionParamsColumn) {
      this.db.run("ALTER TABLE variables ADD COLUMN options_params_json TEXT NOT NULL DEFAULT '{}' ");
    }
    return;
  }

  createVariablesTable() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS variables (
        collection_name TEXT NOT NULL,
        name TEXT NOT NULL,
        params_json TEXT NOT NULL,
        options_params_json TEXT NOT NULL,
        expression TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        PRIMARY KEY (collection_name, name),
        FOREIGN KEY (collection_name) REFERENCES collections(name) ON DELETE CASCADE
      )
    `);
  }

  async openDatabase() {
    try {
      const binary = await fs.readFile(this.dbPath);
      return new this.SQL.Database(new Uint8Array(binary));
    } catch (error) {
      if (error && error.code === "ENOENT") {
        return new this.SQL.Database();
      }
      throw error;
    }
  }

  queryRows(sql, params = []) {
    const statement = this.db.prepare(sql, params);
    const rows = [];
    try {
      while (statement.step()) {
        rows.push(statement.getAsObject());
      }
    } finally {
      statement.free();
    }
    return rows;
  }

  scalar(sql, params = []) {
    const rows = this.queryRows(sql, params);
    if (rows.length === 0) return 0;
    const first = rows[0];
    const key = Object.keys(first)[0];
    return Number(first[key] || 0);
  }

  async persistDatabase() {
    const data = this.db.export();
    await fs.writeFile(this.dbPath, Buffer.from(data));
  }

  async loadFromFile() {
    try {
      const raw = await fs.readFile(this.jsonPath, "utf8");
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return [{
          name: DEFAULT_COLLECTION,
          variables: parsed.filter((item) => item && typeof item.name === "string")
        }];
      }

      const groups = Array.isArray(parsed?.collections) ? parsed.collections : [];
      return groups
        .map((group) => ({
          name: this.normalizeCollectionName(group?.name || ""),
          variables: Array.isArray(group?.variables)
            ? group.variables.filter((item) => item && typeof item.name === "string")
            : []
        }))
        .filter((group) => group.variables.length > 0 || group.name);
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeSnapshotFile() {
    const collections = this.listCollections().map((collection) => ({
      name: collection.name,
      variables: this.list(collection.name)
    }));

    const content = JSON.stringify({
      version: 2,
      collections
    }, null, 2);
    await fs.writeFile(this.jsonPath, `${content}\n`, "utf8");
  }
}
