// The glob matcher behind dead-glob (W204) and gitignore-coverage (W210)
// checks. The conventions under test are the ones Cursor/Copilot/gitignore
// actually use: bare patterns match anywhere, ** spans segments.
import test from "node:test";
import assert from "node:assert/strict";
import { compileGlob, globMatches, globMatchesAny, splitGlobList } from "../dist/glob.js";

test("* stays within one segment; ** spans any number, including zero", () => {
  assert.equal(globMatches("src/*.ts", "src/app.ts"), true);
  assert.equal(globMatches("src/*.ts", "src/deep/app.ts"), false);
  assert.equal(globMatches("src/**/*.ts", "src/a/b/c.ts"), true);
  assert.equal(globMatches("src/**/*.ts", "src/c.ts"), true);
  assert.equal(globMatches("src/**", "src/a/b/c.ts"), true);
});

test("anchoring conventions: bare patterns match anywhere, / anchors, trailing / means the subtree", () => {
  assert.equal(globMatches("*.tsx", "app/components/Button.tsx"), true);
  assert.equal(globMatches("*.tsx", "Button.tsx"), true);
  assert.equal(globMatches("*.tsx", "app/Button.ts"), false);
  assert.equal(globMatches("/README.md", "README.md"), true);
  assert.equal(globMatches("/README.md", "docs/README.md"), false);
  assert.equal(globMatches("build/", "build/out/app.js"), true);
  assert.equal(globMatches("build/", "src/build.ts"), false);
});

test("?, braces and literal regex metacharacters", () => {
  assert.equal(globMatches("file?.txt", "file1.txt"), true);
  assert.equal(globMatches("file?.txt", "file10.txt"), false);
  assert.equal(globMatches("src/**/*.{ts,tsx}", "src/a/x.tsx"), true);
  assert.equal(globMatches("src/**/*.{ts,tsx}", "src/a/x.js"), false);
  assert.equal(globMatches("a+b.txt", "a+b.txt"), true);
  assert.equal(globMatches("a+b.txt", "aab.txt"), false);
});

test("empty and whitespace-only patterns compile to null and match nothing", () => {
  assert.equal(compileGlob(""), null);
  assert.equal(compileGlob("   "), null);
  assert.equal(globMatches("", "anything"), false);
});

test("globMatchesAny scans a file list", () => {
  const files = ["src/a.ts", "docs/readme.md"];
  assert.equal(globMatchesAny("**/*.md", files), true);
  assert.equal(globMatchesAny("**/*.py", files), false);
});

test("splitGlobList normalizes arrays and comma strings alike", () => {
  assert.deepEqual(splitGlobList("*.ts, *.tsx ,"), ["*.ts", "*.tsx"]);
  assert.deepEqual(splitGlobList(["a/**", " b/** "]), ["a/**", "b/**"]);
});
