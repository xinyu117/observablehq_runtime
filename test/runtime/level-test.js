import {Runtime} from "@observablehq/runtime";
import {computeInputLevels, setInputLevelOfVariable} from "@observablehq/runtime";
import assert from "assert";

it("computeInputLevels calculates expected levels", () => {
  const levels = computeInputLevels({
    B: ["A"],
    C: ["B"],
    D: ["B", "C"],
    E: ["A", "D"]
  });

  assert.strictEqual(levels.get("A"), 0);
  assert.strictEqual(levels.get("B"), 1);
  assert.strictEqual(levels.get("C"), 2);
  assert.strictEqual(levels.get("D"), 3);
  assert.strictEqual(levels.get("E"), 4);
});


it("runtime computes variable levels from dependencies", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  const A = module.define("A", [], () => 1);
  const B = module.define("B", ["A"], A => A + 1);
  const C = module.define("C", ["B"], B => B + 1);
  const D = module.define("D", ["B", "C"], (B, C) => B + C);
  const E = module.define("E", ["A", "D"], (A, D) => A + D);

  await runtime._compute();

  setInputLevelOfVariable(runtime._variables);
  assert.strictEqual(A._inputLevel, 0);
  assert.strictEqual(B._inputLevel, 1);
  assert.strictEqual(C._inputLevel, 2);
  assert.strictEqual(D._inputLevel, 3);
  assert.strictEqual(E._inputLevel, 4);
});

it("runtime recomputes levels after redefine", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  const A = module.define("A", [], () => 1);
  const B = module.define("B", ["A"], A => A + 1);
  const C = module.define("C", ["B"], B => B + 1);

  await runtime._compute();

  setInputLevelOfVariable(runtime._variables);
  assert.strictEqual(A._inputLevel, 0);
  assert.strictEqual(B._inputLevel, 1);
  assert.strictEqual(C._inputLevel, 2);

  B.define("B", [], () => 10);
  await runtime._compute();

  setInputLevelOfVariable(runtime._variables);
  assert.strictEqual(A._inputLevel, 0);
  assert.strictEqual(B._inputLevel, 0);
  assert.strictEqual(C._inputLevel, 1);
});

it("runtime recomputes levels after redefine by plugin", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  runtime.use({
    afterCompute(_runtime, context) {
      setInputLevelOfVariable(_runtime._variables);
    }
  });

  const A = module.define("A", [], () => 1);
  const B = module.define("B", ["A"], A => A + 1);
  const C = module.define("C", ["B"], B => B + 1);

  await runtime._compute();

 // setInputLevelOfVariable(runtime._variables);
  assert.strictEqual(A._inputLevel, 0);
  assert.strictEqual(B._inputLevel, 1);
  assert.strictEqual(C._inputLevel, 2);

  B.define("B", [], () => 10);
  await runtime._compute();

  //setInputLevelOfVariable(runtime._variables);
  assert.strictEqual(A._inputLevel, 0);
  assert.strictEqual(B._inputLevel, 0);
  assert.strictEqual(C._inputLevel, 1);
});

it("runtime recomputes levels after redefine by plugin 2", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  const plugin = (_runtime) => {
    setInputLevelOfVariable(_runtime._variables);
  };

  runtime.use(plugin);

  const A = module.define("A", [], () => 1);
  const B = module.define("B", ["A"], A => A + 1);
  const C = module.define("C", ["B"], B => B + 1);

  await runtime._compute();

  //setInputLevelOfVariable(runtime._variables);
  assert.strictEqual(A._inputLevel, 0);
  assert.strictEqual(B._inputLevel, 1);
  assert.strictEqual(C._inputLevel, 2);

  B.define("B", [], () => 10);
  await runtime._compute();

  //setInputLevelOfVariable(runtime._variables);
  assert.strictEqual(A._inputLevel, 0);
  assert.strictEqual(B._inputLevel, 0);
  assert.strictEqual(C._inputLevel, 1);
});

