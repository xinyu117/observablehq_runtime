import readline from "node:readline";
import util from "node:util";
import {Runtime} from "./src/index.js";

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

const runtime = new Runtime(builtinValues);
const module = runtime.module();
const definedNames = new Set();

const keywordSet = new Set([
  "break", "case", "catch", "class", "const", "continue", "debugger", "default", "delete",
  "do", "else", "export", "extends", "finally", "for", "function", "if", "import", "in",
  "instanceof", "new", "return", "super", "switch", "this", "throw", "try", "typeof", "var",
  "void", "while", "with", "yield", "let", "static", "await", "implements", "interface", "package",
  "private", "protected", "public", "null", "true", "false", "undefined", "NaN", "Infinity"
]);

function splitTopLevel(input, separator = ";") {
  const parts = [];
  let quote = null;
  let escape = false;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;
  let start = 0;

  for (let i = 0; i < input.length; i += 1) {
    const ch = input[i];

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

    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "(") depthParen += 1;
    else if (ch === ")") depthParen -= 1;
    else if (ch === "[") depthBracket += 1;
    else if (ch === "]") depthBracket -= 1;
    else if (ch === "{") depthBrace += 1;
    else if (ch === "}") depthBrace -= 1;

    const atTopLevel = depthParen === 0 && depthBracket === 0 && depthBrace === 0;
    if (atTopLevel && ch === separator) {
      const piece = input.slice(start, i).trim();
      if (piece) parts.push(piece);
      start = i + 1;
    }
  }

  const tail = input.slice(start).trim();
  if (tail) parts.push(tail);
  return parts;
}

function findAssignmentIndex(statement) {
  let quote = null;
  let escape = false;
  let depthParen = 0;
  let depthBracket = 0;
  let depthBrace = 0;

  for (let i = 0; i < statement.length; i += 1) {
    const ch = statement[i];

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

    if (ch === "\"" || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === "(") depthParen += 1;
    else if (ch === ")") depthParen -= 1;
    else if (ch === "[") depthBracket += 1;
    else if (ch === "]") depthBracket -= 1;
    else if (ch === "{") depthBrace += 1;
    else if (ch === "}") depthBrace -= 1;

    const atTopLevel = depthParen === 0 && depthBracket === 0 && depthBrace === 0;
    if (!atTopLevel || ch !== "=") continue;

    const prev = statement[i - 1] || "";
    const next = statement[i + 1] || "";
    const isCompare = prev === "=" || next === "=" || prev === "!" || prev === "<" || prev === ">";
    const isArrow = next === ">";
    if (!isCompare && !isArrow) return i;
  }

  return -1;
}

function parseDefinition(statement) {
  const assignAt = findAssignmentIndex(statement);
  if (assignAt === -1) throw new Error(`无法识别定义: ${statement}`);

  const name = statement.slice(0, assignAt).trim();
  const expression = statement.slice(assignAt + 1).trim();

  if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(name)) {
    throw new Error(`变量名不合法: ${name}`);
  }
  if (!expression) {
    throw new Error(`变量 ${name} 缺少表达式`);
  }

  return {name, expression};
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

    if (ch === "\"" || ch === "'" || ch === "`") {
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

  const params = splitTopLevel(paramsSource, ",");
  const deps = [];
  const seen = new Set();

  for (const rawParam of params) {
    let param = rawParam.trim();
    if (!param) continue;
    if (param.startsWith("...")) param = param.slice(3).trim();
    const equalAt = param.indexOf("=");
    if (equalAt >= 0) param = param.slice(0, equalAt).trim();
    if (!/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(param)) continue;
    if (!seen.has(param)) {
      seen.add(param);
      deps.push(param);
    }
  }

  return deps;
}

function defineWithRuntime(name, expression) {
  const functionExpression = isFunctionExpression(expression);
  const dependencies = functionExpression
    ? extractFunctionDependencies(expression).filter((d) => d !== name)
    : extractDependencies(expression).filter((d) => d !== name);
  let definition;

  try {
    if (functionExpression) {
      definition = new Function(`return (${expression});`)();
      if (typeof definition !== "function") {
        throw new Error("不是函数定义");
      }
    } else {
      definition = new Function(...dependencies, `return (${expression});`);
    }
  } catch (error) {
    throw new Error(`表达式语法错误: ${error.message}`);
  }

  if (definedNames.has(name)) {
    module.redefine(name, dependencies, definition);
  } else {
    module.define(name, dependencies, definition);
    definedNames.add(name);
  }
}

function formatValue(value) {
  return util.inspect(value, {depth: 4, colors: true});
}

async function printAllVars() {
  const names = Array.from(definedNames).sort();
  if (!names.length) {
    console.log("当前没有已定义变量。");
    return;
  }

  for (const name of names) {
    try {
      const value = await module.value(name);
      console.log(`${name} = ${formatValue(value)}`);
    } catch (error) {
      console.log(`${name} = <Error: ${error.message}>`);
    }
  }
}

function printHelp() {
  console.log("输入格式示例:");
  console.log("  a = 1");
  console.log("  a = 1; b = a + 2");
  console.log("  list = [1, 2, 3]; sum = list.reduce((s, x) => s + x, 0)");
  console.log("命令:");
  console.log("  :vars   查看当前所有变量和值");
  console.log("  :help   查看帮助");
  console.log("  :quit   退出");
}

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  prompt: "runtime> "
});

let processing = Promise.resolve();
let closing = false;
let closedLogged = false;

function showPrompt() {
  if (!closing && process.stdin.isTTY) rl.prompt();
}

console.log("Runtime 交互测试已启动，输入 :help 查看帮助。");
showPrompt();

async function handleLine(line) {
  const input = line.trim();

  if (!input) {
    showPrompt();
    return;
  }

  if (input === ":quit" || input === ":exit") {
    closing = true;
    rl.close();
    return;
  }

  if (input === ":help") {
    printHelp();
    showPrompt();
    return;
  }

  if (input === ":vars") {
    await printAllVars();
    showPrompt();
    return;
  }

  const statements = splitTopLevel(input, ";");

  for (const statement of statements) {
    const {name, expression} = parseDefinition(statement);
    defineWithRuntime(name, expression);
  }

  showPrompt();
}

rl.on("line", (line) => {
  processing = processing
    .then(() => handleLine(line))
    .catch((error) => {
      console.error(`错误: ${error.message}`);
      showPrompt();
    });
});

rl.on("close", () => {
  closing = true;
  processing.finally(() => {
    if (closedLogged) return;
    closedLogged = true;
    runtime.dispose();
    console.log("已退出 Runtime 交互测试。");
  });
});
