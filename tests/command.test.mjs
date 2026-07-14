// The command analyzer behind E102/E103/W208/W209: shell word splitting,
// $CLAUDE_PROJECT_DIR resolution, interpreter awareness, and the
// deliberate refusal to guess at unresolvable $VARs.
import test from "node:test";
import assert from "node:assert/strict";
import { checkCommand, shellWords, Project } from "../dist/index.js";
import { withProject, codes } from "./helpers.mjs";

const OPTS = { harness: "claude", file: ".claude/settings.json", where: "hooks", mode: "shell" };

function run(files, command, opts = {}) {
  return withProject(files, (dir) => checkCommand(new Project(dir), command, { ...OPTS, ...opts }));
}

test("shellWords honors single and double quotes", () => {
  assert.deepEqual(shellWords(`bash -c 'echo "a b"' "two words" plain`), ["bash", "-c", 'echo "a b"', "two words", "plain"]);
});

test("missing script is E102, with $CLAUDE_PROJECT_DIR resolved in both spellings", () => {
  for (const cmd of [
    ".claude/hooks/gone.sh",
    "$CLAUDE_PROJECT_DIR/.claude/hooks/gone.sh",
    "${CLAUDE_PROJECT_DIR}/.claude/hooks/gone.sh",
  ]) {
    const f = run({}, cmd);
    assert.deepEqual(codes(f), ["E102"], cmd);
    assert.match(f[0].message, /\.claude\/hooks\/gone\.sh/);
  }
});

test("exec bit and shebang: E103 without +x, W209 without #!, clean with both", () => {
  const noExec = run({ ".claude/hooks/guard.sh": { content: "#!/bin/sh\n", mode: 0o644 } }, ".claude/hooks/guard.sh");
  assert.deepEqual(codes(noExec), ["E103"]);
  assert.match(noExec[0].fix, /chmod \+x/);

  const noShebang = run({ ".claude/hooks/raw.sh": { content: "echo hi\n", mode: 0o755 } }, ".claude/hooks/raw.sh");
  assert.deepEqual(codes(noShebang), ["W209"]);

  const good = run({ ".claude/hooks/ok.sh": { content: "#!/usr/bin/env bash\necho ok\n", mode: 0o755 } }, ".claude/hooks/ok.sh");
  assert.deepEqual(good, []);
});

test("interpreter-run scripts need existence but not the exec bit", () => {
  const files = { "scripts/fmt.sh": { content: "echo hi\n", mode: 0o644 } };
  assert.deepEqual(run(files, "bash scripts/fmt.sh --fix"), []);
  assert.deepEqual(codes(run(files, "bash scripts/nope.sh")), ["E102"]);
  // Flags before the script argument are skipped.
  assert.deepEqual(codes(run(files, "node --no-warnings scripts/nope.mjs")), ["E102"]);
});

test("only the first pipeline segment is analyzed", () => {
  const files = { "scripts/a.sh": { content: "#!/bin/sh\n", mode: 0o755 } };
  // The missing path after && belongs to grep, which is never reached.
  assert.deepEqual(run(files, "scripts/a.sh && grep -q ok missing/file.sh"), []);
});

test("unresolvable $VARs, bare PATH commands and system paths are out of scope", () => {
  assert.deepEqual(run({}, "$HOME/hooks/x.sh"), []);
  assert.deepEqual(run({}, "`which foo`/x.sh"), []);
  assert.deepEqual(run({}, "jq -r .tool_name"), []);
  assert.deepEqual(run({}, "/usr/bin/some-formatter --check"), []);
});

test("home-directory absolute paths are W208 on every platform spelling", () => {
  // The macOS spelling is assembled at runtime so no home-directory path
  // literal appears in the repo itself.
  const macHome = ["", "Users", "somebody", "hook.sh"].join("/");
  for (const cmd of ["/home/somebody/hook.sh", macHome, "~/hooks/x.sh", "C:\\Users\\somebody\\hook.cmd"]) {
    const f = run({}, cmd);
    assert.deepEqual(codes(f), ["W208"], `expected W208 for ${cmd}`);
  }
});

test("argv0 mode checks a bare MCP command path without word splitting", () => {
  const files = { "tools/server.js": "console.log(1)\n" };
  assert.deepEqual(run(files, "./tools/server.js", { mode: "argv0" }), []);
  assert.deepEqual(codes(run(files, "tools/missing.js", { mode: "argv0" })), ["E102"]);
  assert.deepEqual(run(files, "npx", { mode: "argv0" }), []);
});
