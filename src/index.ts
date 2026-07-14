/**
 * Public programmatic API for cfgvet. The CLI is a thin wrapper around
 * these exports; embedding cfgvet in another tool needs nothing else.
 */

export { scan, type ScanOptions } from "./analyze.js";
export { Project } from "./project.js";
export { discover, type Inventory } from "./discover.js";
export { parseJson, lineColumn, type JsonParseResult, type JsonIssue } from "./jsonc.js";
export { parseFrontmatter, type FrontmatterResult, type FrontmatterValue } from "./frontmatter.js";
export { compileGlob, globMatches, globMatchesAny, splitGlobList } from "./glob.js";
export { levenshtein, nearest } from "./nearest.js";
export { RULES, ruleByCode, type Rule } from "./rules.js";
export { renderText, renderJson, renderList, shouldFail, type FailOn, type RenderOptions } from "./report.js";
export { checkClaude, permissionRuleProblem, gitignoreCovers, HOOK_EVENTS, KNOWN_SETTINGS_KEYS } from "./checks/claude.js";
export { checkCursor } from "./checks/cursor.js";
export { checkCopilot } from "./checks/copilot.js";
export { checkMcp, MCP_FILES } from "./checks/mcp.js";
export { checkCommand, shellWords, loadJsonFile } from "./checks/context.js";
export {
  ALL_HARNESSES,
  summarize,
  compareFindings,
  type Finding,
  type Severity,
  type Harness,
  type ScanResult,
  type ConfigArtifact,
  type Summary,
} from "./types.js";
export { VERSION } from "./version.js";
