import {computeLevels} from "@observablehq/runtime";
import assert from "assert";

it("computeLevels calculates expected levels", () => {
  const levels = computeLevels({
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
