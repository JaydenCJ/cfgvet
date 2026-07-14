// Engine-level behavior: harness detection, --harness filtering,
// instructions parity (I302), deterministic ordering and the inventory.
import test from "node:test";
import assert from "node:assert/strict";
import { scan, discover, Project } from "../dist/index.js";
import { withProject, codes, ofCode } from "./helpers.mjs";

test("an empty directory has no harnesses, no artifacts, no findings", () => {
  const r = withProject({ "src/app.ts": "export {}\n" }, (dir) => scan(dir));
  assert.deepEqual(r.harnesses, []);
  assert.deepEqual(r.artifacts, []);
  assert.deepEqual(r.findings, []);
});

test("harnesses are detected independently and reported in canonical order", () => {
  const r = withProject(
    {
      ".github/copilot-instructions.md": "Be brief.\n",
      "CLAUDE.md": "Be brief.\n",
      ".cursor/rules/base.mdc": "---\nalwaysApply: true\n---\nBe brief.\n",
    },
    (dir) => scan(dir)
  );
  assert.deepEqual(r.harnesses, ["claude", "cursor", "copilot"]);
});

test("the harnesses option restricts which checks run", () => {
  const files = {
    "CLAUDE.md": "   \n", // would be W206
    ".cursorrules": "Use tabs.\n", // would be W203
  };
  const cursorOnly = withProject(files, (dir) => scan(dir, { harnesses: ["cursor"] }));
  assert.deepEqual(codes(cursorOnly.findings), ["W203"]);
  assert.deepEqual(cursorOnly.harnesses, ["cursor"]);
});

test("I302 fires when one active harness has instructions and another has none", () => {
  const r = withProject(
    {
      "CLAUDE.md": "Project conventions.\n",
      ".cursor/mcp.json": JSON.stringify({ mcpServers: { db: { command: "npx" } } }),
    },
    (dir) => scan(dir)
  );
  const parity = ofCode(r.findings, "I302");
  assert.equal(parity.length, 1);
  assert.match(parity[0].message, /claude ha(s|ve) project instructions, but cursor/);
});

test("I302 stays silent when every active harness has instructions, or only one is active", () => {
  const both = withProject(
    {
      "CLAUDE.md": "Conventions.\n",
      ".cursor/rules/base.mdc": "---\nalwaysApply: true\n---\nConventions.\n",
    },
    (dir) => scan(dir)
  );
  assert.deepEqual(ofCode(both.findings, "I302"), []);

  const solo = withProject({ "CLAUDE.md": "Conventions.\n" }, (dir) => scan(dir));
  assert.deepEqual(ofCode(solo.findings, "I302"), []);
});

test("findings are deterministically ordered by file, then severity, then code", () => {
  const files = {
    ".claude/settings.json": '{"env": {"A": 1}, "permisions": {}}',
    ".cursorrules": "x\n",
  };
  const [a, b] = withProject(files, (dir) => [scan(dir), scan(dir)]);
  assert.deepEqual(a, b); // two scans of the same tree are deeply identical
  assert.deepEqual(
    a.findings.map((f) => [f.file, f.code]),
    [
      [".claude/settings.json", "E110"],
      [".claude/settings.json", "W201"],
      [".cursorrules", "W203"],
      [".cursorrules", "I302"], // cursor has instructions, claude does not
    ]
  );
});

test("discover inventories every artifact kind with its harness", () => {
  const inv = withProject(
    {
      "CLAUDE.md": "x\n",
      ".claude/settings.json": "{}",
      ".claude/hooks/guard.sh": { content: "#!/bin/sh\n", mode: 0o755 },
      ".claude/commands/ship.md": "Ship.\n",
      ".claude/agents/reviewer.md": "---\nname: reviewer\ndescription: reviews\n---\nx\n",
      ".claude/skills/good/SKILL.md": "---\nname: good\ndescription: d\n---\nx\n",
      ".mcp.json": '{"mcpServers": {}}',
      ".cursor/rules/base.mdc": "---\nalwaysApply: true\n---\nx\n",
      ".github/instructions/a.instructions.md": '---\napplyTo: "**"\n---\nx\n',
    },
    (dir) => discover(new Project(dir))
  );
  const kinds = inv.artifacts.map((a) => `${a.harness}:${a.kind}`).sort();
  assert.deepEqual(kinds, [
    "claude:agent",
    "claude:hook script",
    "claude:instructions",
    "claude:mcp",
    "claude:settings",
    "claude:skill",
    "claude:slash command",
    "copilot:scoped instructions",
    "cursor:rule",
  ]);
});

test("node_modules and .git are never walked for glob liveness", () => {
  const r = withProject(
    {
      ".cursor/rules/dead.mdc": "---\nglobs: *.py\n---\nx\n",
      "node_modules/pkg/setup.py": "print()\n",
    },
    (dir) => scan(dir)
  );
  // The only .py file lives in node_modules, which is excluded — the glob is still dead.
  assert.deepEqual(codes(r.findings), ["W204"]);
});
