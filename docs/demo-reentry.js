// demo-reentry.js
// 运行方式：node demo-reentry.js

let seq = 0;
let depth = 0;

function log(msg) {
  const n = String(++seq).padStart(2, "0");
  console.log(n + " " + "  ".repeat(depth) + msg);
}

function enter(name) {
  log("> " + name);
  depth++;
  return () => {
    depth--;
    log("< " + name);
  };
}

function sleepMacrotask() {
  return new Promise((resolve) => setTimeout(resolve, 0));
}

function makeRuntime() {
  return {
    // 模拟“已有一轮计算在进行中”
    _computing: Promise.resolve("already in-flight"),
    _compute() {
      const end = enter("runtime._compute");
      if (this._computing) {
        log("reuse existing _computing (no new scheduling)");
        end();
        return this._computing;
      }
      log("create new scheduling");
      this._computing = Promise.resolve("new scheduling");
      end();
      return this._computing;
    }
  };
}

function makeGenerator() {
  let i = 0;
  return {
    next(input) {
      const end = enter("generator.next(input=" + input + ")");
      i++;
      let out;
      if (i <= 1) out = { done: false, value: "v" + i };
      else out = { done: true, value: undefined };
      log("generator returns " + JSON.stringify(out));
      end();
      return out;
    }
  };
}

// 方案 A：同步直调（你提到的改法）
function computeSync(gen, getCurrentValue, onfulfilled) {
  const end = enter("compute(sync)");
  const result = gen.next(getCurrentValue());
  let ret;
  if (!result.done) {
    ret = onfulfilled(result.value); // 直接调用，发生在同一调用栈
  }
  end();
  return ret;
}

// 方案 B：Promise.then（当前仓库里的思路）
function computePromise(gen, getCurrentValue, onfulfilled) {
  const end = enter("compute(promise)");
  const p = Promise.resolve(gen.next(getCurrentValue())).then(({ done, value }) => {
    log("then-1 fired");
    if (done) return undefined;
    return Promise.resolve(value).then((v) => {
      log("then-2 fired (before onfulfilled)");
      return onfulfilled(v); // 在微任务中执行
    });
  });
  end();
  return p;
}

async function runCase(title, computeImpl) {
  log("");
  log("===== " + title + " =====");

  const runtime = makeRuntime();
  const gen = makeGenerator();
  let currentValue;

  function postcompute(value) {
    const end = enter("postcompute(value=" + value + ")");
    runtime._compute();
    end();
  }

  function onfulfilled(value) {
    const end = enter("onfulfilled(value=" + value + ")");
    currentValue = value;
    postcompute(value);
    end();
    return value;
  }

  function recompute() {
    const end = enter("recompute");
    const ret = computeImpl(gen, () => currentValue, onfulfilled);
    const isPromise = !!ret && typeof ret.then === "function";
    log("recompute got return: " + (isPromise ? "Promise" : String(ret)));
    end();
    return ret;
  }

  queueMicrotask(() => log("[microtask marker]"));
  setTimeout(() => log("[macrotask marker]"), 0);

  const ret = recompute();
  log("after recompute() at call site");

  if (ret && typeof ret.then === "function") {
    await ret;
  }

  // 让微任务/宏任务都刷一遍，方便观察日志顺序
  await Promise.resolve();
  await sleepMacrotask();
}

(async function main() {
  await runCase("A. sync direct call", computeSync);
  await runCase("B. Promise.then", computePromise);
})();