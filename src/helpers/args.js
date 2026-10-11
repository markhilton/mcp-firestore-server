/**
 * Unknown-argument detection with "did you mean" suggestions.
 */

const ALIASES = {
  documentid: "docId",
  document_id: "docId",
  id: "docId",
  doc_id: "docId",
  docid: "docId",
  documentids: "docIds",
  document_ids: "docIds",
  ids: "docIds",
  doc_ids: "docIds",
  path: "collection",
  collectionpath: "collection",
  collection_path: "collection",
  collectionname: "collection",
  collection_name: "collection",
};

function distance(a, b) {
  const dp = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) dp[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[a.length][b.length];
}

function suggest(key, valid) {
  const alias = ALIASES[key.toLowerCase()];
  if (alias && valid.includes(alias)) return alias;
  let best = null;
  let bestDist = Infinity;
  for (const candidate of valid) {
    const d = distance(key.toLowerCase(), candidate.toLowerCase());
    if (d < bestDist) {
      best = candidate;
      bestDist = d;
    }
  }
  return bestDist <= Math.max(2, Math.floor(key.length / 3)) ? best : null;
}

/**
 * Return an error message for the first unknown argument key, or null.
 *
 * @param {string} toolName
 * @param {object} args
 * @param {object} inputSchema - the tool's inputSchema (properties read dynamically)
 */
export function checkUnknownArgs(toolName, args, inputSchema) {
  const valid = Object.keys(inputSchema?.properties ?? {});
  if (valid.length === 0) return null;
  const unknown = Object.keys(args ?? {}).filter(k => !valid.includes(k));
  if (unknown.length === 0) return null;

  const parts = unknown.map(key => {
    const s = suggest(key, valid);
    return `Unknown argument "${key}" for ${toolName}.${s ? ` Did you mean "${s}"?` : ""}`;
  });
  return `${parts.join(" ")} Valid arguments: ${[...valid].sort().join(", ")}.`;
}
