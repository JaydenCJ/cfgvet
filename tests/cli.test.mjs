// End-to-end CLI integration: the compiled dist/cli.js run as a child
// process against temp projects — exit codes, flags, subcommands and the
// usage-error path. This is the same surface scripts/smoke.sh exercises.
import test from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { withProject } from "./helpers.mjs";

const CLI = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "dist", "cli.js");

function run(args, cwd) {
  const res = spawnSync("node", [CLI, ...args], { cwd, encoding: "utf8" });
  return { code: res.status, stdout: res.stdout, stderr: res.stderr };
}

const BROKEN = {
  ".claude/settings.json": JSON.stringify({
    hooks: { Stop: [{ hooks: [{ type: "command", command: ".claude/hooks/bye.sh" }] }] },
  }),
  ".cursorrules": "Use tabs.\n",
};

test("--version prints the package version and --help documents the surface", () => {
  const version = run(["--version"]);
  assert.equal(version.code, 0);
  assert.equal(version.stdout.trim(), "0.1.0");

  const help = run(["--help"]);
  assert.equal(help.code, 0);
  for (const word of ["check", "list", "explain", "--fail-on", "--format", "--harness", "Exit codes"]) {
    assert.ok(help.stdout.includes(word), `help is missing ${word}`);
  }
});

test("a clean project exits 0; the default directory is the cwd", () => {
  withProject({ "CLAUDE.md": "Conventions.\n" }, (dir) => {
    const r = run(["check", dir]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /cfgvet: OK — 0 errors, 0 warnings, 0 info/);
  });
  withProject({ "CLAUDE.md": "   \n" }, (dir) => {
    const r = run(["check"], dir); // no dir argument: scans the cwd
    assert.equal(r.code, 1);
    assert.match(r.stdout, /W206/);
  });
});

test("a broken project exits 1, check is the default subcommand, quiet keeps the verdict", () => {
  withProject(BROKEN, (dir) => {
    const explicit = run(["check", dir]);
    const implicit = run([dir]);
    assert.equal(explicit.code, 1);
    assert.equal(implicit.code, 1);
    assert.equal(explicit.stdout, implicit.stdout);
    assert.match(explicit.stdout, /E102/);

    const quiet = run(["check", dir, "-q"]);
    assert.equal(quiet.code, 1);
    assert.match(quiet.stdout, /cfgvet: FAIL/);
    assert.doesNotMatch(quiet.stdout, /fix:/);
  });
});

test("--fail-on error tolerates warnings; --fail-on never tolerates everything", () => {
  withProject({ ".cursorrules": "Use tabs.\n" }, (dir) => {
    assert.equal(run(["check", dir]).code, 1); // default gate: warning
    assert.equal(run(["check", dir, "--fail-on", "error"]).code, 0);
  });
  withProject(BROKEN, (dir) => {
    assert.equal(run(["check", dir, "--fail-on", "never"]).code, 0);
  });
});

test("--format json emits valid JSON with findings and the ok flag", () => {
  withProject(BROKEN, (dir) => {
    const r = run(["check", dir, "--format", "json"]);
    assert.equal(r.code, 1);
    const parsed = JSON.parse(r.stdout);
    assert.equal(parsed.ok, false);
    assert.ok(parsed.findings.some((f) => f.code === "E102"));
  });
});

test("--harness cursor ignores the broken claude config", () => {
  withProject(BROKEN, (dir) => {
    const r = run(["check", dir, "--harness", "cursor"]);
    assert.equal(r.code, 1);
    assert.match(r.stdout, /W203/);
    assert.doesNotMatch(r.stdout, /E102/);
  });
});

test("list prints the inventory and exits 0 even for a broken project", () => {
  withProject(BROKEN, (dir) => {
    const r = run(["list", dir]);
    assert.equal(r.code, 0);
    assert.match(r.stdout, /claude:\n {2}\.claude\/settings\.json/);
    assert.match(r.stdout, /cursor:\n {2}\.cursorrules/);
  });
});

test("explain documents rule codes case-insensitively and lists the catalog", () => {
  const one = run(["explain", "e102"]);
  assert.equal(one.code, 0);
  assert.match(one.stdout, /E102 \(error\) — referenced file does not exist/);

  const all = run(["explain", "codes"]);
  assert.equal(all.code, 0);
  for (const code of ["E101", "E110", "W201", "W212", "I301", "I303"]) {
    assert.ok(all.stdout.includes(code), `catalog is missing ${code}`);
  }

  const unknown = run(["explain", "E999"]);
  assert.equal(unknown.code, 2);
  assert.match(unknown.stderr, /unknown topic/);
});

test("usage errors exit 2 and never look like findings", () => {
  assert.equal(run(["--frobnicate"]).code, 2);
  assert.equal(run(["check", "/no/such/dir/anywhere"]).code, 2);
  assert.equal(run(["check", ".", "--fail-on", "sometimes"]).code, 2);
  assert.equal(run(["check", ".", "--harness", "emacs"]).code, 2);

  // list rejects check-only flags instead of silently ignoring them,
  // but accepts --harness, which narrows its inventory too.
  const listFormat = run(["list", ".", "--format", "json"]);
  assert.equal(listFormat.code, 2);
  assert.match(listFormat.stderr, /--format only applies to check/);
  assert.equal(run(["list", ".", "--harness", "cursor"]).code, 0);
});
