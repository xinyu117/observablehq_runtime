function normalizeDependencies(input) {
  if (input == null) return new Map();
  if (input instanceof Map) return new Map(input);
  if (typeof input === "object") return new Map(Object.entries(input));
  throw new TypeError("dependencies must be a Map or plain object");
}

function normalizeInputs(inputs) {
  if (inputs == null) return [];
  if (Array.isArray(inputs)) return inputs;
  return [inputs];
}

// Compute levels on a dependency graph where each node level is
// max(input levels) + 1, and source nodes are level 0.
export function computeLevels(dependencies) {
  const graph = normalizeDependencies(dependencies);
  const levels = new Map();
  const visiting = new Set();

  function levelOf(name) {
    if (levels.has(name)) return levels.get(name);
    if (visiting.has(name)) throw new Error("circular dependency");

    visiting.add(name);
    const inputs = normalizeInputs(graph.get(name));

    let level = 0;
    for (const input of inputs) {
      const inputLevel = levelOf(input);
      if (inputLevel + 1 > level) level = inputLevel + 1;
    }

    visiting.delete(name);
    levels.set(name, level);
    return level;
  }

  for (const [name, inputs] of graph) {
    if (!levels.has(name)) levelOf(name);
    for (const input of normalizeInputs(inputs)) {
      if (!levels.has(input)) levelOf(input);
    }
  }

  return levels;
}
