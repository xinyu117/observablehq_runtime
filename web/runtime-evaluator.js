import util from "node:util";
import {Runtime} from "../src/index.js";

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

function toInspectable(value) {
  return util.inspect(value, {depth: 4, colors: false});
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
      // Function expressions are treated as function values; dependencies should
      // come from explicit params, not from function argument names.
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

function normalizeOptionParams(variable) {
  const source = variable?.options?.params;
  if (!source || typeof source !== "object") return null;
  const params = {};
  for (const [key, value] of Object.entries(source)) {
    if (!key) continue;
    params[String(key)] = String(value ?? "");
  }
  return Object.keys(params).length > 0 ? params : null;
}

export async function* evaluateVariablesStream(variables) {
  const runtime = new Runtime(builtinValues);
  const module = runtime.module();
  const ordered = [...variables].sort((a, b) => a.name.localeCompare(b.name));

  try {
    for (const variable of ordered) {
      const {dependencies, definition} = createDefinition(variable);
      const optionParams = normalizeOptionParams(variable);
      module
        .variable(true, optionParams ? {params: optionParams} : undefined)
        .define(variable.name, dependencies, definition);
    }

    for (const variable of ordered) {
      try {
        const value = await module.value(variable.name);
        yield {name: variable.name, value: toInspectable(value)};
      } catch (error) {
        yield {name: variable.name, error: error.message};
      }
    }
  } finally {
    runtime.dispose();
  }
}

export async function evaluateVariables(variables) {
  const values = [];
  for await (const item of evaluateVariablesStream(variables)) {
    values.push(item);
  }
  return values;
}
