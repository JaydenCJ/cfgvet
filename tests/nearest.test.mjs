// Did-you-mean scoring: close typos get a suggestion, distant words do
// not — a wrong suggestion in a diagnostic is worse than none.
import test from "node:test";
import assert from "node:assert/strict";
import { levenshtein, nearest } from "../dist/nearest.js";

test("levenshtein computes classic edit distances", () => {
  assert.equal(levenshtein("kitten", "sitting"), 3);
  assert.equal(levenshtein("", "abc"), 3);
  assert.equal(levenshtein("same", "same"), 0);
});

test("suggests plausible typos and refuses distant words", () => {
  assert.equal(nearest("postToolUse", ["PreToolUse", "PostToolUse", "Stop"]), "PostToolUse");
  assert.equal(nearest("permisions", ["permissions", "env", "hooks"]), "permissions");
  assert.equal(nearest("zebra", ["permissions", "env", "hooks"]), null);
});
