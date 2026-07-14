/**
 * Shared MCP validation across all three harness files — `.mcp.json`
 * (Claude), `.cursor/mcp.json` (Cursor) and `.vscode/mcp.json`
 * (VS Code / Copilot, parsed as JSONC) — plus the cross-harness checks:
 * the same server name resolving to different backends (W202) and
 * servers present on one side only (I301). This unit view across
 * harnesses is the part no single-tool validator gives you.
 */

import type { Finding, Harness } from "../types.js";
import { Project } from "../project.js";
import { checkCommand, finding, isRecord, isStringArray, loadJsonFile } from "./context.js";

interface McpFileSpec {
  harness: Harness;
  file: string;
  /** Key holding the server map. */
  serversKey: string;
  jsonc: boolean;
}

export const MCP_FILES: readonly McpFileSpec[] = [
  { harness: "claude", file: ".mcp.json", serversKey: "mcpServers", jsonc: false },
  { harness: "cursor", file: ".cursor/mcp.json", serversKey: "mcpServers", jsonc: false },
  { harness: "copilot", file: ".vscode/mcp.json", serversKey: "servers", jsonc: true },
];

const REMOTE_TYPES = ["sse", "http", "streamable-http"];

interface ServerRecord {
  harness: Harness;
  file: string;
  name: string;
  /** Normalized identity: "stdio: cmd arg1 arg2" or "url: https://…". */
  identity: string | null;
}

export function checkMcp(project: Project, activeHarnesses: readonly Harness[]): Finding[] {
  const findings: Finding[] = [];
  const servers: ServerRecord[] = [];
  const filesPresent: McpFileSpec[] = [];

  for (const spec of MCP_FILES) {
    if (!activeHarnesses.includes(spec.harness)) continue;
    if (!project.isFile(spec.file)) continue;
    filesPresent.push(spec);
    const { value, findings: loadFindings } = loadJsonFile(project, spec.harness, spec.file, { jsonc: spec.jsonc });
    findings.push(...loadFindings);
    if (value === undefined) continue;
    if (!isRecord(value)) {
      findings.push(finding("E106", spec.harness, spec.file, "", "top level must be a JSON object", `use { "${spec.serversKey}": { … } }`));
      continue;
    }
    const map = value[spec.serversKey];
    if (map === undefined) {
      // VS Code files may hold only `inputs`; Claude/Cursor files without
      // the server map configure nothing.
      const otherKey = spec.serversKey === "servers" ? "mcpServers" : "servers";
      if (otherKey in value) {
        findings.push(
          finding(
            "E106",
            spec.harness,
            spec.file,
            otherKey,
            `this file keys servers under "${spec.serversKey}", not "${otherKey}" — every server in it is ignored`,
            `rename the "${otherKey}" object to "${spec.serversKey}"`
          )
        );
      }
      continue;
    }
    if (!isRecord(map)) {
      findings.push(finding("E106", spec.harness, spec.file, spec.serversKey, `"${spec.serversKey}" must be an object of server entries`, `use { "${spec.serversKey}": { "name": { … } } }`));
      continue;
    }
    for (const [name, entry] of Object.entries(map)) {
      const identity = checkServer(project, spec, name, entry, findings);
      servers.push({ harness: spec.harness, file: spec.file, name, identity });
    }
  }

  checkDrift(servers, findings);
  checkParity(servers, filesPresent, findings);
  return findings;
}

/** Validate one server entry; returns its normalized identity (or null if broken). */
function checkServer(
  project: Project,
  spec: McpFileSpec,
  name: string,
  entry: unknown,
  findings: Finding[]
): string | null {
  const where = `${spec.serversKey} › ${name}`;
  if (!isRecord(entry)) {
    findings.push(finding("E106", spec.harness, spec.file, where, "server entry must be an object", 'use { "command": "…" } or { "type": "http", "url": "…" }'));
    return null;
  }

  const type = entry["type"];
  const command = entry["command"];
  const url = entry["url"];

  if (type !== undefined && typeof type !== "string") {
    findings.push(finding("E106", spec.harness, spec.file, `${where} › type`, "type must be a string", 'use "stdio", "sse" or "http"'));
    return null;
  }
  const isRemote = typeof type === "string" && REMOTE_TYPES.includes(type);
  if (typeof type === "string" && !isRemote && type !== "stdio") {
    findings.push(
      finding("E106", spec.harness, spec.file, `${where} › type`, `unknown server type "${type}"`, `use one of: stdio, ${REMOTE_TYPES.join(", ")}`)
    );
    return null;
  }

  if (isRemote) {
    if (typeof url !== "string" || url.trim() === "") {
      findings.push(finding("E106", spec.harness, spec.file, where, `a ${type} server needs a string "url"`, 'add "url": "https://example.test/mcp"'));
      return null;
    }
    return `url: ${url}`;
  }

  // stdio (explicit or implied by the presence of command)
  if (typeof command !== "string" || command.trim() === "") {
    findings.push(
      finding(
        "E106",
        spec.harness,
        spec.file,
        where,
        typeof url === "string"
          ? 'has a "url" but no remote "type" — declare it, or use "command" for stdio'
          : 'a stdio server needs a string "command"',
        typeof url === "string" ? 'add "type": "http" (or "sse") next to the url' : 'add "command": "npx" (plus "args") or a script path'
      )
    );
    return null;
  }

  let ok = true;
  if ("args" in entry && !isStringArray(entry["args"])) {
    findings.push(finding("E106", spec.harness, spec.file, `${where} › args`, "args must be an array of strings", 'use e.g. "args": ["-y", "some-package"]'));
    ok = false;
  }
  if ("env" in entry) {
    const env = entry["env"];
    if (!isRecord(env) || !Object.values(env).every((v) => typeof v === "string")) {
      findings.push(finding("E106", spec.harness, spec.file, `${where} › env`, "env must be an object of string values", 'use { "TOKEN": "${env:TOKEN}" }'));
      ok = false;
    }
  }

  findings.push(...checkCommand(project, command, { harness: spec.harness, file: spec.file, where: `${where} › command`, mode: "argv0" }));

  if (!ok) return null;
  const args = isStringArray(entry["args"]) ? (entry["args"] as string[]) : [];
  return `stdio: ${[command, ...args].join(" ")}`;
}

/** W202: same server name, different backend, across harness files. */
function checkDrift(servers: readonly ServerRecord[], findings: Finding[]): void {
  const byName = new Map<string, ServerRecord[]>();
  for (const s of servers) {
    if (s.identity === null) continue;
    const list = byName.get(s.name) ?? [];
    list.push(s);
    byName.set(s.name, list);
  }
  for (const [name, list] of [...byName.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const identities = new Set(list.map((s) => s.identity));
    if (identities.size <= 1) continue;
    const detail = list.map((s) => `${s.file} has \`${s.identity}\``).join("; ");
    for (const s of list) {
      findings.push(
        finding(
          "W202",
          "cross",
          s.file,
          `server › ${name}`,
          `server "${name}" differs across harnesses: ${detail}`,
          "align the definitions so every tool talks to the same backend"
        )
      );
    }
  }
}

/** I301: a server present in one harness's MCP file but absent from another's. */
function checkParity(servers: readonly ServerRecord[], filesPresent: readonly McpFileSpec[], findings: Finding[]): void {
  if (filesPresent.length < 2) return;
  const namesByFile = new Map<string, Set<string>>();
  for (const spec of filesPresent) namesByFile.set(spec.file, new Set());
  for (const s of servers) namesByFile.get(s.file)?.add(s.name);

  const allNames = [...new Set(servers.map((s) => s.name))].sort();
  for (const name of allNames) {
    const has = filesPresent.filter((spec) => namesByFile.get(spec.file)?.has(name));
    const missing = filesPresent.filter((spec) => !namesByFile.get(spec.file)?.has(name));
    if (has.length === 0 || missing.length === 0) continue;
    const owner = has[0] as McpFileSpec;
    findings.push(
      finding(
        "I301",
        "cross",
        owner.file,
        `server › ${name}`,
        `server "${name}" is configured for ${has.map((s) => s.harness).join(" and ")} but missing from ${missing.map((s) => s.file).join(" and ")}`,
        `add it to the missing ${missing.length === 1 ? "file" : "files"} if every tool should see it`
      )
    );
  }
}
