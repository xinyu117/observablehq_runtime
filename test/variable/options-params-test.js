import {Runtime} from "@observablehq/runtime";
import {valueof} from "./valueof.js";
import assert from "assert";

it("module.variable(…, {params}) exposes params on variable instance", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  const v = module
    .variable(true, {params: {p1: "p1Value", p2: "p2Value"}})
    .define("x", ["@variable"], (self) => `${self.p1}|${self.p2}`);

  assert.deepStrictEqual(await valueof(v), {value: "p1Value|p2Value"});
  assert.deepStrictEqual(v._params, {p1: "p1Value", p2: "p2Value"});
});

it("module.variable(…, {params}) does not override internal fields", async () => {
  const runtime = new Runtime();
  const module = runtime.module();

  const v = module
    .variable(true, {params: {_name: "bad", p: "ok"}})
    .define("y", ["@variable"], (self) => [self._name, self.p]);

  assert.deepStrictEqual(await valueof(v), {value: ["y", "ok"]});
});
