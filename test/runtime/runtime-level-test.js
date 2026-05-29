import {Runtime} from "@observablehq/runtime";
import assert from "assert";
import {constructTangleLayout} from "../../src/layout.js";
//import { constructTangleLayout } from "@observablehq/runtime"

it("runtime computes variable levels from dependencies", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  const A = module.define("A", [], () => 1);
  const B = module.define("B", ["A"], A => A + 1);
  const C = module.define("C", ["B"], B => B + 1);
  const D = module.define("D", ["B", "C"], (B, C) => B + C);
  const E = module.define("E", ["A", "D"], (A, D) => A + D);

  await runtime._compute();

  assert.strictEqual(A._level, 0);
  assert.strictEqual(B._level, 1);
  assert.strictEqual(C._level, 2);
  assert.strictEqual(D._level, 3);
  assert.strictEqual(E._level, 4);
});

it("runtime recomputes levels after redefine", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  const A = module.define("A", [], () => 1);
  const B = module.define("B", ["A"], A => A + 1);
  const C = module.define("C", ["B"], B => B + 1);

  await runtime._compute();

  assert.strictEqual(A._level, 0);
  assert.strictEqual(B._level, 1);
  assert.strictEqual(C._level, 2);

  B.define("B", [], () => 10);
  await runtime._compute();

  assert.strictEqual(A._level, 0);
  assert.strictEqual(B._level, 0);
  assert.strictEqual(C._level, 1);
});

it("runtime.variablesByLevel groups variables into a 2D array", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  const A = module.define("A", [], () => 1);
  const B = module.define("B", ["A"], A => A + 1);
  const C = module.define("C", ["A"], A => A + 2);
  const D = module.define("D", ["B", "C"], (B, C) => B + C);

  await runtime._compute();
  const grouped = runtime.variablesByLevel();

  assert.deepStrictEqual(grouped[0], [A]);
  assert.deepStrictEqual(grouped[1], [B, C]);
  assert.deepStrictEqual(grouped[2], [D]);
});

it("runtime.variablesByLevel output can be consumed by constructTangleLayout", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  module.define("A", [], () => 1);
  module.define("B", ["A"], A => A + 1);
  module.define("C", ["A"], A => A + 2);
  module.define("D", ["B", "C"], (B, C) => B + C);

  await runtime._compute();
  const levels = runtime.variablesByLevel();

  // constructTangleLayout 需要节点有 id 字段；这里直接复用变量名。
  levels.forEach(level => level.forEach(variable => {
    variable.id = variable._name;
  }));

  const originalD3 = globalThis.d3;
  globalThis.d3 = {
    min(values, accessor = d => d) {
      let found = false;
      let minValue;
      for (const value of values ?? []) {
        const mapped = accessor(value);
        if (mapped == null || Number.isNaN(mapped)) continue;
        if (!found || mapped < minValue) {
          minValue = mapped;
          found = true;
        }
      }
      return found ? minValue : undefined;
    },
    max(values, accessor = d => d) {
      let found = false;
      let maxValue;
      for (const value of values ?? []) {
        const mapped = accessor(value);
        if (mapped == null || Number.isNaN(mapped)) continue;
        if (!found || mapped > maxValue) {
          maxValue = mapped;
          found = true;
        }
      }
      return found ? maxValue : undefined;
    },
    descending(a, b) {
      return b - a;
    }
  };

  try {
    const result = constructTangleLayout(levels);
    assert.ok(result);
    assert.strictEqual(result.levels, levels);
    assert.strictEqual(result.nodes.length, 4);
    assert.ok(result.links.length > 0);
    assert.ok(result.layout.width > 0);
    assert.ok(result.layout.height > 0);
  } finally {
    globalThis.d3 = originalD3;
  }
});
