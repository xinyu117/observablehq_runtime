const fs = require("fs");
const { chain } = require("stream-chain");
const { parser } = require("stream-json/core/parser.js");
const { pick } = require("stream-json/core/filters/pick.js");
const { streamArray } = require("stream-json/core/streamers/stream-array.js");

/*
如果想保留原始 input-only 关系：
node toCsv.js --keep-input-only
带筛选：node toCsv.js --subject "Computing" --domain "Artificial Intelligence"
*/

// 1. 加载topics
const topics = JSON.parse(
  fs.readFileSync("../topics.json", "utf8")
);

const topicMetaMap = new Map();
const identifierByRaw = new Map();
const usedIdentifiers = new Set();
const dependencies = [];

function getArgValue(flagName) {
  const argv = process.argv.slice(2);
  const key = `--${flagName}`;

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === key) {
      const next = argv[i + 1];
      if (typeof next === "string" && !next.startsWith("-")) return next.trim();
      return "";
    }

    if (token.startsWith(`${key}=`)) {
      return token.slice(key.length + 1).trim();
    }

    if (token.startsWith(`${flagName}=`)) {
      return token.slice(flagName.length + 1).trim();
    }
  }

  return "";
}

function hasArgFlag(flagName) {
  const argv = process.argv.slice(2);
  const key = `--${flagName}`;
  return argv.some((token) => token === key);
}

const subjectFilter = getArgValue("subject");
const domainFilter = getArgValue("domain");
const keepInputOnly = hasArgFlag("keep-input-only");

function toBaseIdentifier(raw) {
  let base = String(raw ?? "").trim().replace(/[^A-Za-z0-9_$]/g, "_");
  if (!base) base = "_";
  if (!/^[A-Za-z_$]/.test(base)) base = `_${base}`;
  return base;
}

function getSafeIdentifier(raw) {
  const key = String(raw ?? "");
  const existing = identifierByRaw.get(key);
  if (existing) return existing;

  const base = toBaseIdentifier(key);
  let candidate = base;
  let suffix = 2;

  while (usedIdentifiers.has(candidate)) {
    candidate = `${base}_${suffix}`;
    suffix += 1;
  }

  usedIdentifiers.add(candidate);
  identifierByRaw.set(key, candidate);
  return candidate;
}

function csvEscape(value) {
  return `"${String(value ?? "").replace(/"/g, '""')}"`;
}

for (const t of topics.topics) {
  topicMetaMap.set(t.id, {
    name: String(t.name ?? "").trim(),
    subject: String(t.subject ?? "").trim(),
    domain: String(t.domain ?? "").trim()
  });
}

function buildBaseLevelByTopic() {
  const numericAges = Array.from(new Set(topics.topics
    .map((t) => Number(t.ageRangeStart))
    .filter((age) => Number.isFinite(age))))
    .sort((a, b) => a - b);

  const ageToLevel = new Map(numericAges.map((age, index) => [age, index]));
  const baseLevelByTopic = new Map();

  for (const t of topics.topics) {
    const age = Number(t.ageRangeStart);
    const baseLevel = Number.isFinite(age) ? (ageToLevel.get(age) ?? 0) : 0;
    baseLevelByTopic.set(t.id, baseLevel);
  }

  return baseLevelByTopic;
}

function computeAdjustedLevels(edges) {
  const baseLevelByTopic = buildBaseLevelByTopic();
  const nodeIds = new Set();
  const adjacency = new Map();
  const indegree = new Map();
  const levelByTopic = new Map();

  for (const edge of edges) {
    nodeIds.add(edge.topicId);
    if (edge.prerequisiteId) nodeIds.add(edge.prerequisiteId);
  }

  for (const id of nodeIds) {
    adjacency.set(id, []);
    indegree.set(id, 0);
    levelByTopic.set(id, baseLevelByTopic.get(id) ?? 0);
  }

  for (const edge of edges) {
    if (!edge.prerequisiteId) continue;
    adjacency.get(edge.prerequisiteId).push(edge.topicId);
    indegree.set(edge.topicId, (indegree.get(edge.topicId) ?? 0) + 1);
  }

  const queue = [];
  for (const [id, deg] of indegree.entries()) {
    if (deg === 0) queue.push(id);
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const currentLevel = levelByTopic.get(current) ?? 0;
    const nextTopics = adjacency.get(current) ?? [];

    for (const next of nextTopics) {
      const nextLevel = levelByTopic.get(next) ?? 0;
      if (nextLevel <= currentLevel) {
        levelByTopic.set(next, currentLevel + 1);
      }

      const nextDeg = (indegree.get(next) ?? 0) - 1;
      indegree.set(next, nextDeg);
      if (nextDeg === 0) queue.push(next);
    }
  }

  const uniqueLevels = Array.from(new Set(levelByTopic.values())).sort((a, b) => a - b);
  const compactLevelMap = new Map(uniqueLevels.map((value, index) => [value, index]));
  for (const [id, value] of levelByTopic.entries()) {
    levelByTopic.set(id, compactLevelMap.get(value) ?? 0);
  }

  return levelByTopic;
}

function filterInputOnlyDependencies(edges) {
  const topicIds = new Set(edges.map((edge) => edge.topicId));
  const validEdges = edges.filter((edge) => topicIds.has(edge.prerequisiteId));
  const topicIdsWithRows = new Set(validEdges.map((edge) => edge.topicId));
  const placeholderTopicIds = Array.from(topicIds).filter((topicId) => !topicIdsWithRows.has(topicId));

  return {
    validEdges,
    placeholderTopicIds,
    droppedInputOnlyEdges: edges.length - validEdges.length
  };
}

// 2. CSV输出流
const csv = fs.createWriteStream("output.csv");

// 3. 流式读取dependencies[]
const pipeline = chain([
  fs.createReadStream("../dependencies.json"),
  parser(),
  pick({ filter: "dependencies" }),
  streamArray()
]);

let totalEdges = 0;
let matchedEdges = 0;

function matchesFilters(topicId) {
  if (!subjectFilter && !domainFilter) return true;

  const topicMeta = topicMetaMap.get(topicId);
  if (!topicMeta) return false;

  const matchSubject = !subjectFilter || topicMeta.subject === subjectFilter;
  const matchDomain = !domainFilter || topicMeta.domain === domainFilter;

  return matchSubject && matchDomain;
}

pipeline.on("data", ({ value }) => {
  totalEdges += 1;

  const topicId = value.topicId;
  const prerequisiteId = value.prerequisiteId;
  if (!matchesFilters(topicId)) return;

  dependencies.push({
    topicId,
    prerequisiteId
  });

  matchedEdges += 1;
});

pipeline.on("end", () => {
  const filtered = filterInputOnlyDependencies(dependencies);
  const edgesForCsv = keepInputOnly ? dependencies : filtered.validEdges;
  const placeholderTopicIds = keepInputOnly ? [] : filtered.placeholderTopicIds;
  const droppedInputOnlyEdges = keepInputOnly ? 0 : filtered.droppedInputOnlyEdges;

  const levelEdges = keepInputOnly
    ? edgesForCsv
    : edgesForCsv.concat(placeholderTopicIds.map((topicId) => ({topicId, prerequisiteId: null})));

  const levelByTopic = computeAdjustedLevels(levelEdges);

  const csvRows = edgesForCsv.map((edge) => ({
    topicId: edge.topicId,
    prerequisiteId: edge.prerequisiteId
  }));

  for (const topicId of placeholderTopicIds) {
    csvRows.push({topicId, prerequisiteId: ""});
  }

  const topicLevelValues = Array.from(new Set(csvRows
    .map((edge) => levelByTopic.get(edge.topicId) ?? 0)))
    .sort((a, b) => a - b);
  const normalizedTopicLevel = new Map(topicLevelValues.map((value, index) => [value, index]));

  csv.write("name,input,function,level\n");

  for (const edge of csvRows) {
    const topicId = edge.topicId;
    const prerequisiteId = edge.prerequisiteId;

    const topicName = getSafeIdentifier(topicId);
    const prerequisiteName = prerequisiteId ? getSafeIdentifier(prerequisiteId) : "";

    const rawLevel = levelByTopic.get(topicId) ?? 0;
    const level = normalizedTopicLevel.get(rawLevel) ?? 0;
    const topicDisplayName = topicMetaMap.get(topicId)?.name || String(topicId ?? "");
    const expression = `function() { return ${JSON.stringify(topicDisplayName)}; }`;

    const row = [topicName, prerequisiteName, expression, level].map(csvEscape).join(",");
    csv.write(`${row}\n`);
  }

  csv.end();
  const filters = [
    subjectFilter ? `subject=${subjectFilter}` : null,
    domainFilter ? `domain=${domainFilter}` : null
  ].filter(Boolean).join(", ") || "none";

  const mode = keepInputOnly ? "keep-input-only" : "drop-input-only";
  const exportedEdges = edgesForCsv.length;
  const exportedRows = csvRows.length;

  console.log(`Done: exported ${exportedEdges} edges, ${exportedRows} rows / ${matchedEdges}/${totalEdges} matched/total (mode: ${mode}, droppedInputOnly=${droppedInputOnlyEdges}, placeholders=${placeholderTopicIds.length}, filters: ${filters})`);
});