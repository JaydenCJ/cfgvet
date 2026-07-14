// The Cursor surface: .mdc rule activation paths, dead globs, @-file
// references and the legacy .cursorrules deprecation.
import test from "node:test";
import assert from "node:assert/strict";
import { scan } from "../dist/index.js";
import { withProject, codes } from "./helpers.mjs";

function scanFiles(files) {
  return withProject(files, (dir) => scan(dir));
}

test("a well-formed rule with a live glob is clean", () => {
  const r = scanFiles({
    ".cursor/rules/style.mdc": '---\ndescription: TypeScript style\nglobs: "src/**/*.ts"\n---\nUse strict mode.\n',
    "src/app.ts": "export {}\n",
  });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.harnesses, ["cursor"]);
});

test("a rule with no activation path is W205; alwaysApply alone fixes it", () => {
  const orphan = scanFiles({ ".cursor/rules/orphan.mdc": "---\n---\nAlways be nice.\n" });
  assert.deepEqual(codes(orphan.findings), ["W205"]);
  const always = scanFiles({ ".cursor/rules/base.mdc": "---\nalwaysApply: true\n---\nProject basics.\n" });
  assert.deepEqual(always.findings, []);
});

test("each dead glob is its own W204, live ones stay silent", () => {
  const r = scanFiles({
    ".cursor/rules/mix.mdc": "---\nglobs: *.py, src/**/*.ts, *.rb\n---\nRules.\n",
    "src/app.ts": "export {}\n",
  });
  assert.deepEqual(codes(r.findings), ["W204", "W204"]);
  assert.deepEqual(
    r.findings.map((f) => f.where),
    ["globs › *.py", "globs › *.rb"]
  );
});

test("a dangling @file reference is E102; an existing one is clean", () => {
  const r = scanFiles({
    ".cursor/rules/arch.mdc": "---\nalwaysApply: true\n---\nSee the template:\n@templates/service.ts\n@docs/missing.md\n",
    "templates/service.ts": "export {}\n",
  });
  assert.deepEqual(codes(r.findings), ["E102"]);
  assert.equal(r.findings[0].where, "@docs/missing.md");
});

test("bare @mentions that are not paths are ignored", () => {
  const r = scanFiles({ ".cursor/rules/team.mdc": "---\nalwaysApply: true\n---\nPing @reviewer before merging.\n@reviewer\n" });
  assert.deepEqual(r.findings, []);
});

test("empty rule body is W206", () => {
  const r = scanFiles({ ".cursor/rules/empty.mdc": "---\nalwaysApply: true\n---\n  \n" });
  assert.deepEqual(codes(r.findings), ["W206"]);
});

test(".cursorrules is W203 even when non-empty; empty adds W206", () => {
  const nonEmpty = scanFiles({ ".cursorrules": "Use tabs.\n" });
  assert.deepEqual(codes(nonEmpty.findings), ["W203"]);
  const empty = scanFiles({ ".cursorrules": "\n" });
  assert.deepEqual(codes(empty.findings), ["W203", "W206"]);
});

test("broken .mdc frontmatter is E108 and stops further rule checks on that file", () => {
  const r = scanFiles({ ".cursor/rules/broken.mdc": "---\nglobs: *.zz\nno closing\n" });
  assert.deepEqual(codes(r.findings), ["E108"]);
});
