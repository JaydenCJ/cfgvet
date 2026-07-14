// The Claude Code surface: settings schema, hooks, permissions, env,
// statusLine, local overrides, gitignore coverage, slash commands,
// agents and skills. Each test seeds a minimal temp project and asserts
// exact rule codes — the codes are stable API.
import test from "node:test";
import assert from "node:assert/strict";
import { scan, permissionRuleProblem, gitignoreCovers } from "../dist/index.js";
import { withProject, codes, ofCode } from "./helpers.mjs";

const settings = (obj) => JSON.stringify(obj, null, 2);

function scanFiles(files) {
  return withProject(files, (dir) => scan(dir));
}

test("a healthy settings file produces zero findings", () => {
  const r = scanFiles({
    ".claude/settings.json": settings({
      permissions: { allow: ["Bash(npm run test:*)", "Read"], deny: ["WebFetch"], defaultMode: "acceptEdits" },
      env: { NODE_ENV: "test" },
      hooks: {
        PreToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: ".claude/hooks/guard.sh", timeout: 30 }] }],
      },
    }),
    ".claude/hooks/guard.sh": { content: "#!/usr/bin/env bash\nexit 0\n", mode: 0o755 },
  });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.harnesses, ["claude"]);
});

test("broken JSON is E101 with line/column; duplicate keys are W212", () => {
  const broken = scanFiles({ ".claude/settings.json": '{\n  "env": {,}\n}' });
  assert.deepEqual(codes(broken.findings), ["E101"]);
  assert.equal(broken.findings[0].where, "line 2, column 11");

  const dup = scanFiles({ ".claude/settings.json": '{\n "env": {"A": "1"},\n "env": {"B": "2"}\n}' });
  assert.deepEqual(codes(dup.findings), ["W212"]);
  assert.match(dup.findings[0].message, /silently dropped/);
});

test("unknown top-level key is W201 with a did-you-mean", () => {
  const r = scanFiles({ ".claude/settings.json": settings({ permisions: {} }) });
  assert.deepEqual(codes(r.findings), ["W201"]);
  assert.match(r.findings[0].message, /did you mean "permissions"\?/);
});

test("misspelled hook event is E104 and its entries are still path-checked", () => {
  const r = scanFiles({
    ".claude/settings.json": settings({
      hooks: { postToolUse: [{ hooks: [{ type: "command", command: ".claude/hooks/x.sh" }] }] },
    }),
  });
  assert.deepEqual(codes(r.findings), ["E102", "E104"]);
});

test("hook structure mistakes are E105: wrong root, bad nesting, bad type, empty command, bad timeout", () => {
  const notObject = scanFiles({ ".claude/settings.json": settings({ hooks: ["PreToolUse"] }) });
  assert.deepEqual(codes(notObject.findings), ["E105"]);

  const r = scanFiles({
    ".claude/settings.json": settings({
      hooks: {
        PreToolUse: [{ type: "command", command: "echo hi" }], // entry where a group belongs
        Stop: [{ hooks: [{ type: "script", command: "echo" }, { type: "command", command: "" }] }],
        SessionStart: [{ hooks: [{ type: "command", command: "echo hi", timeout: "30" }] }],
      },
    }),
  });
  assert.deepEqual(codes(r.findings), ["E105", "E105", "E105", "E105"]);
});

test("permission shape errors are E109; broken rule strings are W207", () => {
  const r = scanFiles({
    ".claude/settings.json": settings({
      permissions: {
        allow: ["Bash(npm run lint", " Read", "Bash()"],
        deny: "WebFetch",
        defaultMode: "yolo",
        additionalDirectories: [1],
      },
    }),
  });
  assert.deepEqual(codes(r.findings), ["E109", "E109", "E109", "W207", "W207", "W207"]);
});

test("permissionRuleProblem accepts real-world rules and names what is wrong otherwise", () => {
  for (const rule of ["Read", "Bash(npm run test:*)", "mcp__server__tool", "WebFetch(domain:example.test)", "Edit(/docs/**)"]) {
    assert.equal(permissionRuleProblem(rule), null, rule);
  }
  assert.match(permissionRuleProblem("Bash(npm run lint"), /does not end/);
  assert.match(permissionRuleProblem("(x)"), /no tool name/);
  assert.match(permissionRuleProblem("Bash()"), /empty specifier/);
  assert.match(permissionRuleProblem("Read "), /whitespace/);
  assert.match(permissionRuleProblem("Bash(a(b)"), /unbalanced/);
});

test("non-string env values are E110, one per offender", () => {
  const r = scanFiles({ ".claude/settings.json": settings({ env: { A: "ok", B: 1, C: true } }) });
  assert.deepEqual(codes(r.findings), ["E110", "E110"]);
});

test("statusLine command paths get the same treatment as hooks", () => {
  const r = scanFiles({
    ".claude/settings.json": settings({ statusLine: { type: "command", command: "scripts/status.sh" } }),
  });
  assert.deepEqual(codes(r.findings), ["E102"]);
  assert.equal(r.findings[0].where, "statusLine › command");
});

test("settings.local.json without gitignore coverage is W210; coverage comes in many spellings", () => {
  const local = settings({ model: "opus" });
  const uncovered = scanFiles({ ".claude/settings.local.json": local, ".gitignore": "node_modules/\n" });
  assert.deepEqual(codes(uncovered.findings), ["W210"]);
  const covered = scanFiles({ ".claude/settings.local.json": local, ".gitignore": ".claude/settings.local.json\n" });
  assert.deepEqual(covered.findings, []);

  const file = ".claude/settings.local.json";
  assert.equal(gitignoreCovers("settings.local.json\n", file), true);
  assert.equal(gitignoreCovers("*.local.json\n", file), true);
  assert.equal(gitignoreCovers(".claude/\n", file), true);
  assert.equal(gitignoreCovers("# comment\nnode_modules/\n", file), false);
  assert.equal(gitignoreCovers("!settings.local.json\n", file), false);
});

test("local keys that shadow shared settings are I303 listing the keys", () => {
  const r = scanFiles({
    ".claude/settings.json": settings({ env: { A: "1" }, model: "sonnet" }),
    ".claude/settings.local.json": settings({ env: { A: "2" }, model: "opus" }),
    ".gitignore": ".claude/settings.local.json\n",
  });
  assert.deepEqual(codes(r.findings), ["I303"]);
  assert.equal(r.findings[0].where, "env, model");
});

test("empty CLAUDE.md and empty slash-command bodies are W206; content is clean", () => {
  const empty = scanFiles({ "CLAUDE.md": "  \n\n", ".claude/commands/ship.md": "---\ndescription: ship it\n---\n\n" });
  assert.deepEqual(codes(empty.findings), ["W206", "W206"]);
  const fine = scanFiles({ "CLAUDE.md": "Conventions.\n", ".claude/commands/ship.md": "Run the release checklist.\n" });
  assert.deepEqual(fine.findings, []);
});

test("agents: missing name/description is W211, unterminated frontmatter is E108", () => {
  const r = scanFiles({
    ".claude/agents/reviewer.md": "---\nname: reviewer\n---\nReview code.\n",
    ".claude/agents/naked.md": "Just prose.\n",
    ".claude/agents/broken.md": "---\nname: broken\nno closing delimiter\n",
  });
  assert.deepEqual(codes(r.findings), ["E108", "W211", "W211"]);
  assert.match(ofCode(r.findings, "W211")[1].message, /missing description/);
});

test("skill checks: missing SKILL.md, missing frontmatter, and name/directory mismatch are E107", () => {
  const r = scanFiles({
    ".claude/skills/empty-skill/notes.txt": "scratch notes\n",
    ".claude/skills/no-meta/SKILL.md": "No frontmatter here.\n",
    ".claude/skills/renamed/SKILL.md": "---\nname: other-name\ndescription: does things\n---\nbody\n",
    ".claude/skills/good/SKILL.md": "---\nname: good\ndescription: does things well\n---\nbody\n",
  });
  assert.deepEqual(codes(r.findings), ["E107", "E107", "E107"]);
});
