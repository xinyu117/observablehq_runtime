import {Runtime} from "@observablehq/runtime";
import assert from "assert";
import {identity} from "../../src/identity.js";
import {valueof, promiseInspector, sleep} from "./valueof.js";

/**
 * 画张图，描述派生的功能和逻辑，详细点。
 * 
 * flowchart TB
    %% Top-level
    S["源模块 Source\n例如 module0"] --> D{"调用 derive(overrides, injectModule)"}
    I["注入模块 Inject\n例如 module1"] --> D

    D --> C["创建派生模块 Derived\n例如 module1_0"]
    C --> SRC["记录来源关系\nDerived._source = Source"]

    %% Overrides mapping
    D --> O1["解析覆盖规则\n{name:d, alias:b}"]
    O1 --> O2["语义:\n在派生模块里, b 由 Inject.d 提供"]

    %% Scope copy strategy
    S --> V0["源模块变量图\na,b,c..."]
    V0 --> CP["复制变量节点到派生模块\n保持定义结构, 不直接改源模块"]
    CP --> REW["按覆盖规则重写输入依赖"]
    REW --> EX1["若变量依赖 b\n改为依赖 Inject.d"]

    %% Runtime behavior
    REW --> EVAL["运行时求值"]
    EVAL --> RES1["在派生模块中\nc = a + b 变为 c = a + Inject.d"]

    %% Important invariants
    S -.不变.-> INV1["源模块保持原语义"]
    C -.独立.-> INV2["派生模块拥有自己的连接关系"]

    %% Transitive derive
    C --> T1{"派生链?\nA -> B' -> C' ..."}
    T1 -->|是| T2["逐层建立 _source 指向\n每层只重写被注入的别名"]
    T2 --> T3["未被注入的上游模块可复用\n不强制复制"]
    T1 -->|否| T4["单层派生结束"]

    %% Lazy import-with
    D --> L1{"被注入模块尚未就绪?"}
    L1 -->|是| L2["先放占位依赖\n例如依赖 module 2 变量"]
    L2 --> L3["模块加载后, 重新定义为真正 import"]
    L3 --> L4["导入输入切换到新的派生副本\n保持最终值一致"]
    L1 -->|否| L5["直接建立 import 关系"]

    %% Concrete mini example
    subgraph EX["示例: A.derive([{name:d, alias:b}], B)"]
      EA["A: a=1,b=2,c=a+b"] --> EDer["派生 A'"]
      EB["B: d=42"] --> EDer
      EDer --> ERes["A' 中 c 读取 b 时\n实际读取 B.d\n因此 c=1+42=43"]
    end
 */

it("module.derive(overrides, module) injects variables into a copied module", async () => {
  const runtime = new Runtime();
  const module0 = runtime.module();
  const a0 = module0.variable(true).define("a", [], () => 1);
  const b0 = module0.variable(true).define("b", [], () => 2);
  const c0 = module0.variable(true).define("c", ["a", "b"], (a, b) => a + b);
  const module1 = runtime.module();
  const module1_0 = module0.derive([{name: "d", alias: "b"}], module1);
  const c1 = module1_0.variable(true).define(null, ["c"], c => c);
  const d1 = module1.define("d", [], () => 42);
  assert.deepStrictEqual(await valueof(a0), {value: 1});
  assert.deepStrictEqual(await valueof(b0), {value: 2});
  assert.deepStrictEqual(await valueof(c0), {value: 3});
  assert.deepStrictEqual(await valueof(c1), {value: 43});
  assert.deepStrictEqual(await valueof(d1), {value: 42});
});

it("module.derive(…) copies module-specific builtins", async () => {
  const runtime = new Runtime();
  const module0 = runtime.module();
  module0.builtin("a", 1);
  const b0 = module0.variable(true).define("b", ["a"], a => a + 1);
  const module1_0 = module0.derive([], module0);
  const c1 = module1_0.variable(true).define("c", ["a"], a => a + 2);
  assert.deepStrictEqual(await valueof(b0), {value: 2});
  assert.deepStrictEqual(await valueof(c1), {value: 3});
});

it("module.derive(…) can inject into modules that inject into modules", async () => {
  const runtime = new Runtime();

  // Module A
  // a = 1
  // b = 2
  // c = a + b
  const A = runtime.module();
  A.define("a", 1);
  A.define("b", 2);
  A.define("c", ["a", "b"], (a, b) => a + b);

  // Module B
  // d = 3
  // import {c as e} with {d as b} from "A"
  const B = runtime.module();
  B.define("d", 3);
  const BA = A.derive([{name: "d", alias: "b"}], B);
  B.import("c", "e", BA);

  // Module C
  // f = 4
  // import {e as g} with {f as d} from "B"
  const C = runtime.module();
  C.define("f", 4);
  const CB = B.derive([{name: "f", alias: "d"}], C);
  const g = C.variable(true).import("e", "g", CB);

  assert.deepStrictEqual(await valueof(g), {value: 5});
  assert.strictEqual(g._module, C);
  assert.strictEqual(g._inputs[0]._module, CB);
  assert.strictEqual(g._inputs[0]._inputs[0]._module._source, BA);
  assert.strictEqual(C._source, null);
  assert.strictEqual(CB._source, B);
  assert.strictEqual(BA._source, A);
});

it("module.derive(…) can inject into modules that inject into modules that inject into modules", async () => {
  const runtime = new Runtime();

  // Module A
  // a = 1
  // b = 2
  // c = a + b
  const A = runtime.module();
  A.define("a", 1);
  A.define("b", 2);
  A.define("c", ["a", "b"], (a, b) => a + b);

  // Module B
  // d = 3
  // import {c as e} with {d as b} from "A"
  const B = runtime.module();
  B.define("d", 3);
  const BA = A.derive([{name: "d", alias: "b"}], B);
  B.import("c", "e", BA);

  // Module C
  // f = 4
  // import {e as g} with {f as d} from "B"
  const C = runtime.module();
  C.define("f", 4);
  const CB = B.derive([{name: "f", alias: "d"}], C);
  C.import("e", "g", CB);

  // Module D
  // h = 5
  // import {g as i} with {h as f} from "C"
  const D = runtime.module();
  D.define("h", 5);
  const DC = C.derive([{name: "h", alias: "f"}], D);
  const i = D.variable(true).import("g", "i", DC);

  assert.deepStrictEqual(await valueof(i), {value: 6});
  assert.strictEqual(i._module, D);
  assert.strictEqual(i._inputs[0]._module, DC);
  assert.strictEqual(i._inputs[0]._module._source, C);
  assert.strictEqual(i._inputs[0]._inputs[0]._module._source, CB);
  assert.strictEqual(i._inputs[0]._inputs[0]._module._source._source, B);
});

it("module.derive(…) does not copy non-injected modules", async () => {
  const runtime = new Runtime();

  // Module A
  // a = 1
  // b = 2
  // c = a + b
  const A = runtime.module();
  A.define("a", 1);
  A.define("b", 2);
  A.define("c", ["a", "b"], (a, b) => a + b);

  // Module B
  // import {c as e} from "A"
  const B = runtime.module();
  B.import("c", "e", A);

  // Module C
  // f = 4
  // import {e as g} with {f as d} from "B"
  const C = runtime.module();
  C.define("f", 4);
  const CB = B.derive([{name: "f", alias: "d"}], C);
  const g = C.variable(true).import("e", "g", CB);

  assert.deepStrictEqual(await valueof(g), {value: 3});
  assert.strictEqual(g._module, C);
  assert.strictEqual(g._inputs[0]._module, CB);
  assert.strictEqual(g._inputs[0]._inputs[0]._module, A);
});

it("module.derive(…) does not copy non-injected modules, again", async () => {
  const runtime = new Runtime();
  const A = runtime.module();
  A.define("a", () => ({}));
  const B = runtime.module();
  B.import("a", A);
  const C = runtime.module();
  const CB = B.derive([], C);
  const a1 = C.variable(true).import("a", "a1", CB);
  const a2 = C.variable(true).import("a", "a2", A);
  const {value: v1} = await valueof(a1);
  const {value: v2} = await valueof(a2);
  assert.deepStrictEqual(v1, {});
  assert.strictEqual(v1, v2);
});

it("module.derive() supports lazy import-with", async () => {
  let resolve2, promise2 = new Promise((resolve) => resolve2 = resolve);

  function define1(runtime, observer) {
    const main = runtime.module();
    main.define("module 1", ["@variable"], async (v) => runtime.module(await promise2).derive([{name: "b"}], v._module));
    main.define("c", ["module 1", "@variable"], (_, v) => v.import("c", _));
    main.variable(observer("b")).define("b", [], () => 3);
    main.variable(observer("imported c")).define("imported c", ["c"], c => c);
    return main;
  }

  function define2(runtime, observer) {
    const main = runtime.module();
    main.variable(observer("a")).define("a", [], () => 1);
    main.variable(observer("b")).define("b", [], () => 2);
    main.variable(observer("c")).define("c", ["a", "b"], (a, b) => a + b);
    return main;
  }

  const runtime = new Runtime();
  const inspectorC = promiseInspector();
  runtime.module(define1, name => {
    if (name === "imported c") {
      return inspectorC;
    }
  });

  await sleep();
  resolve2(define2);
  assert.deepStrictEqual(await inspectorC, 4);
});

it("module.derive() supports lazy transitive import-with", async () => {
  let resolve2, promise2 = new Promise((resolve) => resolve2 = resolve);
  let resolve3, promise3 = new Promise((resolve) => resolve3 = resolve);
  let module2_1;
  let module3_2;
  let variableC_1;

  // Module 1
  // b = 4
  // imported c = c
  // import {c} with {b} from "2"
  function define1(runtime, observer) {
    const main = runtime.module();
    main.define("module 2", ["@variable"], async (v) => (module2_1 = runtime.module(await promise2).derive([{name: "b"}], v._module)));
    variableC_1 = main.define("c", ["module 2", "@variable"], (_, v) => v.import("c", _));
    main.variable(observer("b")).define("b", [], () => 4);
    main.variable(observer("imported c")).define("imported c", ["c"], c => c);
    return main;
  }

  // Module 2
  // b = 3
  // c
  // import {c} with {b} from "3"
  function define2(runtime, observer) {
    const main = runtime.module();
    main.define("module 3", ["@variable"], async (v) => (module3_2 = runtime.module(await promise3).derive([{name: "b"}], v._module)));
    main.define("c", ["module 3", "@variable"], (_, v) => v.import("c", _));
    main.variable(observer("b")).define("b", [], () => 3);
    main.variable(observer()).define(["c"], c => c);
    return main;
  }

  // Module 3
  // a = 1
  // b = 2
  // c = a + b
  function define3(runtime, observer) {
    const main = runtime.module();
    main.variable(observer("a")).define("a", [], () => 1);
    main.variable(observer("b")).define("b", [], () => 2);
    main.variable(observer("c")).define("c", ["a", "b"], (a, b) => a + b);
    return main;
  }

  const runtime = new Runtime();
  const inspectorC = promiseInspector();
  runtime.module(define1, name => {
    if (name === "imported c") {
      return inspectorC;
    }
  });

  // Initially c in module 1 is not an import; it’s a placeholder that depends
  // on an internal variable called “module 2”. Also, only one module yet
  // exists, because module 2 has not yet loaded.
  await sleep();
  const module1 = runtime.module(define1);
  const c1 = module1._scope.get("c");
  assert.strictEqual(c1, variableC_1);
  assert.deepStrictEqual(c1._inputs.map(i => i._name), ["module 2", "@variable"]);
  assert.strictEqual(runtime._modules.size, 1);

  // After module 2 loads, the variable c in module 1 has been redefined; it is
  // now an import of c from a derived copy of module 2, module 2'. In addition,
  // the variable b in module 2' is now an import from module 1.
  resolve2(define2);
  await sleep();
  const module2 = runtime.module(define2);
  assert.deepStrictEqual(c1._inputs.map(i => i._name), ["c"]);
  assert.strictEqual(c1._definition, identity);
  assert.strictEqual(c1._inputs[0]._module, module2_1);
  assert.strictEqual(module2_1._source, module2);
  assert.strictEqual(runtime._modules.size, 2);
  const b2_1 = module2_1._scope.get("b");
  assert.deepStrictEqual(b2_1._inputs.map(i => i._name), ["b"]);
  assert.deepStrictEqual(b2_1._definition, identity);
  assert.deepStrictEqual(b2_1._inputs[0]._module, module1);

  // After module 3 loads, the variable c in module 2' has been redefined; it is
  // now an import of c from a derived copy of module 3, module 3'. In addition,
  // the variable b in module 3' is now an import from module 2'.
  resolve3(define3);
  await sleep();
  const module3 = runtime.module(define3);
  const c2_1 = module2_1._scope.get("c");
  assert.strictEqual(c2_1._module, module2_1);
  assert.strictEqual(c2_1._definition, identity);
  assert.strictEqual(c2_1._inputs[0]._module, module3_2);
  assert.strictEqual(module3_2._source, module3);
  const b3_2 = module3_2._scope.get("b");
  assert.deepStrictEqual(b3_2._inputs.map(i => i._name), ["b"]);
  assert.deepStrictEqual(b3_2._definition, identity);
  assert.deepStrictEqual(b3_2._inputs[0]._module, module2_1);
  assert.deepStrictEqual(await inspectorC, 5);
});
