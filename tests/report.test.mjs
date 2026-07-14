// Renderers and the fail gate: byte-deterministic text output, a stable
// JSON shape, quiet mode, and shouldFail across every --fail-on level.
import test from "node:test";
import assert from "node:assert/strict";
import { scan, renderText, renderJson, renderList, shouldFail } from "../dist/index.js";
import { withProject } from "./helpers.mjs";

// One error (E110), one warning (W203), one info (I302: cursor has rules
// via .cursorrules, claude's settings carry no instructions).
const FIXTURE = {
  ".claude/settings.json": '{"env": {"A": 1}}',
  ".cursorrules": "Use tabs.\n",
};

test("shouldFail respects each gate level", () => {
  const findings = [
    { code: "W203", severity: "warning", harness: "cursor", file: "x", where: "", message: "", fix: "" },
    { code: "I301", severity: "info", harness: "cross", file: "x", where: "", message: "", fix: "" },
  ];
  assert.equal(shouldFail(findings, "error"), false);
  assert.equal(shouldFail(findings, "warning"), true);
  assert.equal(shouldFail(findings, "info"), true);
  assert.equal(shouldFail(findings, "never"), false);
  assert.equal(shouldFail([], "info"), false);
});

test("text report groups by file and ends with the verdict line", () => {
  const out = withProject(FIXTURE, (dir) => renderText(scan(dir), { failOn: "warning" }));
  const lines = out.trimEnd().split("\n");
  assert.match(lines[0], /^cfgvet: checking claude, cursor \(2 config files\)$/);
  assert.equal(lines.at(-1), "cfgvet: FAIL — 1 error, 1 warning, 1 info (fail-on: warning)");
  assert.ok(out.indexOf(".claude/settings.json") < out.indexOf(".cursorrules"));
});

test("quiet mode keeps only the header and verdict", () => {
  const out = withProject(FIXTURE, (dir) => renderText(scan(dir), { failOn: "never", quiet: true }));
  const lines = out.trimEnd().split("\n");
  assert.equal(lines.length, 3);
  assert.match(lines.at(-1), /^cfgvet: OK — 1 error, 1 warning, 1 info/);
});

test("JSON report has the documented stable shape", () => {
  const out = withProject(FIXTURE, (dir) => renderJson(scan(dir), { failOn: "error" }));
  const parsed = JSON.parse(out);
  assert.equal(parsed.cfgvet, "0.1.0");
  assert.deepEqual(parsed.harnesses, ["claude", "cursor"]);
  assert.deepEqual(parsed.summary, { errors: 1, warnings: 1, info: 1 });
  assert.equal(parsed.ok, false);
  assert.deepEqual(Object.keys(parsed.findings[0]), ["code", "severity", "harness", "file", "where", "message", "fix"]);
});

test("renderList groups artifacts under their harness, and says so when there are none", () => {
  const out = withProject(FIXTURE, (dir) => renderList(scan(dir)));
  assert.match(out, /claude:\n  \.claude\/settings\.json {2}\(settings\)/);
  assert.match(out, /cursor:\n  \.cursorrules {2}\(legacy rules\)/);

  const empty = withProject({}, (dir) => renderList(scan(dir)));
  assert.match(empty, /no \.claude, \.cursor or Copilot configuration found here/);
});
