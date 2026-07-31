import {constructTangleLayout, filterInputOnlyParents} from "@observablehq/runtime";
import assert from "assert";

function mockD3() {
  const toArray = (values, accessor) => {
    const array = Array.from(values);
    return accessor ? array.map(accessor) : array;
  };

  return {
    min(values, accessor) {
      const array = toArray(values, accessor);
      if (!array.length) return undefined;
      return array.reduce((m, v) => (v < m ? v : m), array[0]);
    },
    max(values, accessor) {
      const array = toArray(values, accessor);
      if (!array.length) return undefined;
      return array.reduce((m, v) => (v > m ? v : m), array[0]);
    },
    descending(a, b) {
      return a > b ? -1 : a < b ? 1 : 0;
    }
  };
}

function createLevels() {
  const a = {id: "A", parents: []};
  const b = {id: "B", parents: []};
  const c = {id: "C", parents: []};

  const n1 = {id: "n1", parents: [a, b]};
  const n2 = {id: "n2", parents: [c]};
  const n3 = {id: "n3", parents: [b, a]};

  return [[a, b, c], [n1, n2, n3]];
}

function createLevelsWithInputOnlyParent() {
  const a = {id: "A", parents: []};
  const b = {id: "B", parents: []};
  const ghost = {id: "ghost", parents: []};

  const n1 = {id: "n1", parents: [a, ghost]};
  const n2 = {id: "n2", parents: [b]};

  return [[a, b], [n1, n2]];
}

let originalD3;

beforeEach(() => {
  originalD3 = globalThis.d3;
  globalThis.d3 = mockD3();
});

afterEach(() => {
  globalThis.d3 = originalD3;
});

it("constructTangleLayout keeps level order by default", () => {
  const levels = createLevels();
  const result = constructTangleLayout(levels);

  assert.deepStrictEqual(result.levels[1].map(n => n.id), ["n1", "n2", "n3"]);
});

it("constructTangleLayout groups same bundle ids when orderBy is levelInBundle", () => {
  const levels = createLevels();
  const result = constructTangleLayout(levels, {orderBy: "levelInBundle"});

  assert.deepStrictEqual(result.levels[1].map(n => n.id), ["n1", "n3", "n2"]);
});

it("filterInputOnlyParents removes parents that are not in levels", () => {
  const levels = createLevelsWithInputOnlyParent();
  filterInputOnlyParents(levels);

  assert.deepStrictEqual(levels[1][0].parents.map(p => p.id), ["A"]);
  assert.deepStrictEqual(levels[1][1].parents.map(p => p.id), ["B"]);
});

it("constructTangleLayout can filter input-only parents before building bundles", () => {
  const levels = createLevelsWithInputOnlyParent();
  const result = constructTangleLayout(levels, {filterInputOnlyParents: true});

  assert.strictEqual(result.links.some(link => link.target.id === "ghost"), false);
});
