import {Runtime} from "@observablehq/runtime";
import assert from "assert";

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
