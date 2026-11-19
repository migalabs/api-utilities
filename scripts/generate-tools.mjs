#!/usr/bin/env node
/**
 * scripts/generate-tools.mjs
 *
 * Uses openapi-mcp-generator's programmatic API (getToolsFromOpenApi) to
 * extract MCP tool definitions from the OpenAPI spec and write them to a
 * TypeScript module.
 *
 * We generate tool DATA only — never server code. The server entry point
 * (src/index.ts) is committed to the repo and fully typed, so there is no
 * generated code to patch and no TS2883.
 *
 * Tool names are derived purely from the API path (no hardcoded segments).
 * Descriptions use the OpenAPI title + path for clarity.
 *
 * Usage:
   node scripts/generate-tools.mjs [specFile] [outputFile]
   # defaults: openapi.json → ./mcp/src/tools.ts
 */

import { getToolsFromOpenApi } from "openapi-mcp-generator";
import { writeFileSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

const specFile = process.argv[2] ?? resolve("openapi.json");
const outputFile = process.argv[3] ?? resolve("mcp/src/tools.ts");

console.error(`[generate-tools] Reading OpenAPI spec from ${specFile}…`);
const specRaw = JSON.parse(readFileSync(specFile, "utf8"));

// Derive API base URL from spec's x-origin URL.
const xOrigin =
  Array.isArray(specRaw["x-origin"]) && specRaw["x-origin"][0]?.url
    ? specRaw["x-origin"][0].url
    : null;
const derivedBaseUrl = xOrigin
  ? xOrigin.replace(/\/docs\/doc\.json$/, "/api")
  : "";

const tools = await getToolsFromOpenApi(specFile, { dereference: true });
console.error(`[generate-tools] Extracted ${tools.length} tools.`);
console.error(
  `[generate-tools] Derived API base URL: ${derivedBaseUrl || "(none)"}`,
);

// ---------------------------------------------------------------------------
// Name generation: purely path-based, fully automatic
// ---------------------------------------------------------------------------
function toKebabCase(str) {
  return str
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/[_\s]+/g, "-")
    .toLowerCase()
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function generateMcpName(tool) {
  // Derive name purely from the API path (fully automatic, no hardcoded segments).
  const segments = tool.pathTemplate
    .split("/")
    .filter(Boolean)
    .filter((s) => !/^v\d+$/.test(s))
    .map((s) => s.replace(/[{}]/g, "").replace(/[^a-zA-Z0-9-]/g, "-"));

  // Drop generic namespace segments
  const meaningful = segments.filter(
    (s) =>
      !["eth", "api", "beacon", "consensus", "nodes"].includes(
        s.toLowerCase(),
      ) && s.length > 1,
  );

  // Take last 3 meaningful segments (or fewer if not enough)
  const last = meaningful.slice(-3);
  let name = last.join("-");

  // For node tools, prepend 'nodes-' to distinguish from beacon tools
  if (tool.pathTemplate.includes("/nodes/")) {
    const layer = tool.pathTemplate.includes("/consensus/")
      ? "consensus"
      : "execution";
    if (!name.startsWith("nodes-")) {
      name =
        "nodes-" + layer + "-" + name.replace(/^(consensus|execution)-/, "");
    }
  }

  // Deduplicate consecutive segments (e.g. client-client → client)
  name = name.replace(/(\w+)-\1/g, "$1");

  if (!name) name = "tool";

  // Add method prefix for non-GET to distinguish create/update/delete
  if (tool.method !== "get") {
    name = tool.method + "-" + name;
  }

  // Differentiate v2 variants
  if (tool.name.includes("V2")) {
    name = name + "-v2";
  }

  return toKebabCase(name);
}

function generateDescription(tool) {
  // Use the OpenAPI title as the primary description (short, human-readable)
  const title = tool.title || tool.name;
  const method = tool.method.toUpperCase();
  const path = tool.pathTemplate.replace(/\{[^}]+\}/g, "{id}");

  // Build required params hint
  const requiredParams = (tool.executionParameters || [])
    .filter((p) => p.in === "query" || p.in === "path")
    .map((p) => p.name);

  let desc = `${title} (${method} ${path})`;
  if (requiredParams.length > 0) {
    desc += ` — params: ${requiredParams.join(", ")}`;
  }
  if (tool.tags && tool.tags.length > 0) {
    desc += ` [${tool.tags.join(", ")}]`;
  }
  return desc;
}

const processedTools = tools.map((tool) => ({
  ...tool,
  name: generateMcpName(tool),
  description: generateDescription(tool),
}));

// Deduplicate names by appending -2, -3, etc.
const seen = new Map();
for (const tool of processedTools) {
  if (seen.has(tool.name)) {
    const count = seen.get(tool.name) + 1;
    seen.set(tool.name, count);
    tool.name = `${tool.name}-${count}`;
  } else {
    seen.set(tool.name, 1);
  }
}

console.error(
  `[generate-tools] Transformed ${processedTools.length} tool names.`,
);
const examples = processedTools.slice(0, 10);
for (const t of examples) {
  console.error(`  ${t.name} ← ${t.description}`);
}

// ---------------------------------------------------------------------------
// Build dynamic instructions from actual tool tags so they never go stale.
// ---------------------------------------------------------------------------
const tagCounts = {};
for (const t of processedTools) {
  for (const tag of t.tags || ["Untagged"]) {
    tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
}
const sortedTags = Object.entries(tagCounts).sort((a, b) => b[1] - a[1]);
const instructionsLines = [
  "MigaLabs Ethereum API — provides Ethereum beacon chain, execution layer, and node network data.",
  "",
  "TOOLS AVAILABLE (" + processedTools.length + " total), grouped by category:",
];
for (const [tag, count] of sortedTags) {
  const tagTools = processedTools.filter((t) => (t.tags || []).includes(tag));
  const sampleNames = tagTools
    .slice(0, 4)
    .map((t) => t.name)
    .join(", ");
  instructionsLines.push(
    "  " +
      tag +
      " (" +
      count +
      " tools): " +
      sampleNames +
      (count > 4 ? "..." : ""),
  );
}
instructionsLines.push("");
instructionsLines.push("AUTHENTICATION: Pass apiKey in tool arguments");
instructionsLines.push("");
instructionsLines.push(
  'All tools accept a "network" parameter (mainnet, hoodi, sepolia). Most are read-only (GET).',
);
instructionsLines.push(
  "Error responses are structured JSON: { error: true, status, title, detail }.",
);
const serverInstructions = instructionsLines.join("\\n");

// ---------------------------------------------------------------------------
// Emit TypeScript module
// ---------------------------------------------------------------------------
const header = `// Auto-generated by scripts/generate-tools.mjs from ${specFile}
// Do not edit by hand; re-run: node scripts/generate-tools.mjs

export interface ToolAnnotation {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolExecutionParameter {
  name: string;
  in: string;
  style?: string;
  explode?: boolean;
}

export interface McpTool {
  name: string;
  title?: string;
  description: string;
  inputSchema: Record<string, unknown>;
  method: string;
  pathTemplate: string;
  executionParameters: ToolExecutionParameter[];
  requestBodyContentType?: string;
  securityRequirements: Record<string, unknown>[];
  tags?: string[];
  deprecated?: boolean;
  annotations: ToolAnnotation;
  outputSchema?: Record<string, unknown>;
  // OpenAPI-level fields carried through from the spec (e.g. parameters).
  [key: string]: unknown;
}

export const BASE_URL = ${JSON.stringify(derivedBaseUrl)};
export const TOOLS: McpTool[] = `;

const footer = `;
export const TOOL_NAMES = TOOLS.map((t) => t.name);
export const TOOL_BY_NAME = new Map(TOOLS.map((t) => [t.name, t]));
export function findTool(name: string): McpTool | undefined {
  return TOOL_BY_NAME.get(name);
}
export const SERVER_INSTRUCTIONS = ${JSON.stringify(serverInstructions)};
`;

mkdirSync(dirname(outputFile), { recursive: true });
writeFileSync(
  outputFile,
  header + JSON.stringify(processedTools, null, 2) + footer,
);
console.error(`[generate-tools] Wrote ${outputFile}`);
