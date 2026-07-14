// The YAML-subset frontmatter parser used for .mdc, agent, skill and
// instructions files: scalars, arrays (inline and block), quoting, and
// the failure modes that back E108.
import test from "node:test";
import assert from "node:assert/strict";
import { parseFrontmatter } from "../dist/frontmatter.js";

test("a document without frontmatter is valid and marked absent", () => {
  const r = parseFrontmatter("# Just markdown\n\nbody text\n");
  assert.equal(r.ok, true);
  assert.equal(r.absent, true);
  assert.match(r.body, /Just markdown/);
});

test("scalar values parse; comments and blank lines are ignored", () => {
  const r = parseFrontmatter(
    '---\n# metadata\n\nname: my-rule\ndescription: "Use tabs, always"\nalwaysApply: true\npriority: 3\n---\nbody'
  );
  assert.equal(r.ok, true);
  assert.deepEqual(r.data, { name: "my-rule", description: "Use tabs, always", alwaysApply: true, priority: 3 });
  assert.equal(r.body, "body");
});

test("inline arrays split on top-level commas only", () => {
  const r = parseFrontmatter('---\nglobs: ["src/**/*.ts", "a,b.md"]\n---\nx');
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.globs, ["src/**/*.ts", "a,b.md"]);
});

test("block lists under a key become string arrays", () => {
  const r = parseFrontmatter("---\nglobs:\n  - src/**\n  - docs/**\n---\nx");
  assert.equal(r.ok, true);
  assert.deepEqual(r.data.globs, ["src/**", "docs/**"]);
});

test("bare comma-separated globs stay a single string (checker splits them)", () => {
  const r = parseFrontmatter("---\nglobs: *.ts,*.tsx\n---\nx");
  assert.equal(r.ok, true);
  assert.equal(r.data.globs, "*.ts,*.tsx");
});

test("unclosed blocks and unparseable lines are errors with line numbers", () => {
  const unclosed = parseFrontmatter("---\nname: x\nbody without closing delimiter\n");
  assert.equal(unclosed.ok, false);
  assert.equal(unclosed.line, 1);
  assert.match(unclosed.error, /never closed/);

  const garbled = parseFrontmatter("---\nname: ok\n:::: what\n---\nbody");
  assert.equal(garbled.ok, false);
  assert.equal(garbled.line, 3);
});

test("an empty value parses as the empty string; body is preserved exactly", () => {
  const r = parseFrontmatter("---\ndescription:\n---\nline1\nline2");
  assert.equal(r.ok, true);
  assert.equal(r.data.description, "");
  assert.equal(r.body, "line1\nline2");
});
