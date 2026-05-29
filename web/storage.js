import fs from "node:fs/promises";
import path from "node:path";
import initSqlJs from "sql.js";

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

    this.db.run(`
      CREATE TABLE IF NOT EXISTS variables (
        name TEXT PRIMARY KEY,
        params_json TEXT NOT NULL,
        expression TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);

    const count = this.scalar("SELECT COUNT(1) AS c FROM variables");
    if (count === 0) {
      const fromFile = await this.loadFromFile();
      if (fromFile.length > 0) {
        for (const variable of fromFile) {
          this.insertRow(variable);
        }
        await this.persistDatabase();
      }
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

  list() {
    return this.queryRows("SELECT name, params_json, expression FROM variables ORDER BY name ASC")
      .map((row) => ({
        name: row.name,
        params: JSON.parse(row.params_json),
        expression: row.expression
      }));
  }

  async upsert(variable) {
    this.insertRow(variable);
    await this.persistDatabase();
    await this.writeSnapshotFile();
  }

  async renameWithCascade(oldName, variable) {
    const all = this.list();
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
        this.db.run("DELETE FROM variables WHERE name = ?", [oldName]);
      }

      this.insertRow(variable);

      if (oldName !== variable.name) {
        const dependents = all.filter((item) => item.params.includes(oldName));
        for (const dependent of dependents) {
          const updated = {
            ...dependent,
            params: dependent.params.map((param) => (param === oldName ? variable.name : param)),
            expression: rewriteIdentifier(dependent.expression, oldName, variable.name)
          };
          this.insertRow(updated);
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

  async remove(name) {
    this.db.run("DELETE FROM variables WHERE name = ?", [name]);
    await this.persistDatabase();
    await this.writeSnapshotFile();
  }

  async importVariables(variables, mode = "replace") {
    if (mode !== "replace" && mode !== "merge") {
      throw new Error("不支持的导入模式");
    }

    this.db.run("BEGIN TRANSACTION");
    try {
      if (mode === "replace") {
        this.db.run("DELETE FROM variables");
      }

      for (const variable of variables) {
        this.insertRow(variable);
      }

      this.db.run("COMMIT");
    } catch (error) {
      this.db.run("ROLLBACK");
      throw error;
    }

    await this.persistDatabase();
    await this.writeSnapshotFile();
  }

  getDependents(name) {
    const all = this.list();
    return all
      .filter((item) => Array.isArray(item.params) && item.params.includes(name))
      .map((item) => item.name)
      .sort((a, b) => a.localeCompare(b));
  }

  insertRow(variable) {
    this.db.run(`
      INSERT INTO variables (name, params_json, expression, updated_at)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(name) DO UPDATE SET
        params_json = excluded.params_json,
        expression = excluded.expression,
        updated_at = excluded.updated_at
    `, [
      variable.name,
      JSON.stringify(variable.params),
      variable.expression,
      new Date().toISOString()
    ]);
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
      if (!Array.isArray(parsed)) return [];
      return parsed.filter((item) => item && typeof item.name === "string");
    } catch (error) {
      if (error && error.code === "ENOENT") return [];
      throw error;
    }
  }

  async writeSnapshotFile() {
    const content = JSON.stringify(this.list(), null, 2);
    await fs.writeFile(this.jsonPath, `${content}\n`, "utf8");
  }
}
