// The Copilot surface: copilot-instructions.md and the scoped
// *.instructions.md files with applyTo globs.
import test from "node:test";
import assert from "node:assert/strict";
import { scan } from "../dist/index.js";
import { withProject, codes } from "./helpers.mjs";

function scanFiles(files) {
  return withProject(files, (dir) => scan(dir));
}

test("non-empty instructions plus a scoped file with a live applyTo are clean", () => {
  const r = scanFiles({
    ".github/copilot-instructions.md": "Use conventional commits.\n",
    ".github/instructions/ts.instructions.md": '---\napplyTo: "src/**/*.ts"\n---\nPrefer readonly.\n',
    "src/app.ts": "export {}\n",
  });
  assert.deepEqual(r.findings, []);
  assert.deepEqual(r.harnesses, ["copilot"]);
});

test("empty copilot-instructions.md is W206", () => {
  const r = scanFiles({ ".github/copilot-instructions.md": "\n\n" });
  assert.deepEqual(codes(r.findings), ["W206"]);
});

test("scoped instructions never attach without an applyTo glob: W205 either way", () => {
  const noFm = scanFiles({ ".github/instructions/api.instructions.md": "Keep handlers small.\n" });
  assert.deepEqual(codes(noFm.findings), ["W205"]);
  assert.match(noFm.findings[0].message, /no frontmatter/);

  const noApplyTo = scanFiles({ ".github/instructions/api.instructions.md": "---\ndescription: api rules\n---\nBody.\n" });
  assert.deepEqual(codes(noApplyTo.findings), ["W205"]);
  assert.match(noApplyTo.findings[0].message, /no applyTo glob/);
});

test("an applyTo glob matching nothing is W204; the universal ** never is", () => {
  const dead = scanFiles({ ".github/instructions/py.instructions.md": '---\napplyTo: "**/*.py"\n---\nBody.\n' });
  assert.deepEqual(codes(dead.findings), ["W204"]);
  const universal = scanFiles({ ".github/instructions/all.instructions.md": '---\napplyTo: "**"\n---\nBody.\n' });
  assert.deepEqual(codes(universal.findings), []);
});

test("empty scoped-instructions body is W206 alongside nothing else", () => {
  const r = scanFiles({ ".github/instructions/blank.instructions.md": '---\napplyTo: "**"\n---\n\n' });
  assert.deepEqual(codes(r.findings), ["W206"]);
});

test("broken frontmatter in scoped instructions is E108", () => {
  const r = scanFiles({ ".github/instructions/broken.instructions.md": "---\napplyTo: **\nbody\n" });
  assert.deepEqual(codes(r.findings), ["E108"]);
});
