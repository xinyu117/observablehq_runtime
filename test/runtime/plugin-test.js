import {Runtime} from "@observablehq/runtime";
import assert from "assert";
import {valueof} from "../variable/valueof.js";

it("runtime.use(plugin) invokes plugin after each compute round", async () => {
  const runtime = new Runtime();
  const module = runtime.module();
  const rounds = [];

  runtime.use({
    afterCompute(_runtime, context) {
      rounds.push(context.round);
    }
  });

  const foo = module.variable(true).define("foo", [], () => 1);
  assert.deepStrictEqual(await valueof(foo), {value: 1});
  foo.define("foo", [], () => 2);
  assert.deepStrictEqual(await valueof(foo), {value: 2});

  assert.deepStrictEqual(rounds, [1, 2]);
});

it("runtime.unuse(plugin) stops plugin callbacks", async () => {
  const runtime = new Runtime();
  const module = runtime.module();
  let count = 0;

  const plugin = () => {
    count += 1;
  };

  runtime.use(plugin);
  const foo = module.variable(true).define("foo", [], () => 1);
  assert.deepStrictEqual(await valueof(foo), {value: 1});

  runtime.unuse(plugin);
  foo.define("foo", [], () => 2);
  assert.deepStrictEqual(await valueof(foo), {value: 2});

  assert.strictEqual(count, 1);
});
