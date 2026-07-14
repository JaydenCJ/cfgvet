// The position-aware JSON/JSONC parser: exact line/column on syntax
// errors, duplicate-key reporting, and JSONC leniency only where asked
// for. These behaviors are the foundation of E101 and W212.
import test from "node:test";
import assert from "node:assert/strict";
import { parseJson, lineColumn } from "../dist/jsonc.js";

test("parses a nested document (escapes included) to the same value as JSON.parse", () => {
  const text = '{"a": [1, 2.5, -3e2], "b": {"c": null, "d": [true, false]}, "e": "x\\n\\"y\\u0041"}';
  const result = parseJson(text);
  assert.equal(result.ok, true);
  assert.deepEqual(result.value, JSON.parse(text));
  assert.equal(result.value.e, 'x\n"yA');
});

test("a __proto__ key becomes an ordinary property, never a prototype swap", () => {
  const result = parseJson('{"__proto__": {"polluted": true}}');
  assert.equal(result.ok, true);
  assert.equal(Object.getPrototypeOf(result.value), Object.prototype);
  assert.deepEqual(result.value["__proto__"], { polluted: true });
  assert.equal({}.polluted, undefined);
});

test("reports line and column of a trailing comma in strict mode", () => {
  const result = parseJson('{\n  "a": 1,\n}');
  assert.equal(result.ok, false);
  assert.equal(result.line, 3);
  assert.equal(result.column, 1);
});

test("empty files are an error, not a crash", () => {
  const result = parseJson("   \n  ");
  assert.equal(result.ok, false);
  assert.match(result.error, /empty/);
});

test("syntax errors carry positions and targeted messages", () => {
  const trailing = parseJson('{"a": 1} {"b": 2}');
  assert.equal(trailing.ok, false);
  assert.deepEqual([trailing.line, trailing.column], [1, 10]);

  const singleQuoted = parseJson('["a", \'b\']');
  assert.equal(singleQuoted.ok, false);
  assert.match(singleQuoted.error, /double quotes, not single quotes/);

  const unterminated = parseJson('{"a": "oops\n}');
  assert.equal(unterminated.ok, false);
  assert.match(unterminated.error, /unterminated string/);
  assert.equal(unterminated.line, 1);
});

test("duplicate keys are reported with position, last one wins, nested objects included", () => {
  const flat = parseJson('{\n "x": 1,\n "x": 2\n}');
  assert.equal(flat.ok, true);
  assert.equal(flat.value.x, 2);
  assert.deepEqual(flat.issues, [{ kind: "duplicate-key", key: "x", line: 3, column: 2 }]);

  const nested = parseJson('{"outer": {"s": {"command": "a"}, "s": {"command": "b"}}}');
  assert.equal(nested.ok, true);
  assert.equal(nested.issues.length, 1);
  assert.equal(nested.issues[0].key, "s");
});

test("JSONC mode accepts comments and trailing commas; strict mode rejects the same text", () => {
  const text = '{\n // servers\n "a": 1, /* mid */ "b": [1, 2,],\n}';
  const strict = parseJson(text);
  assert.equal(strict.ok, false);
  assert.equal(strict.line, 2); // the // comment is the first offense
  const lenient = parseJson(text, { jsonc: true });
  assert.equal(lenient.ok, true);
  assert.deepEqual(lenient.value, { a: 1, b: [1, 2] });
});

test("JSONC mode still rejects an unterminated block comment", () => {
  const result = parseJson('{"a": 1} /* dangling', { jsonc: true });
  assert.equal(result.ok, false);
  assert.match(result.error, /unterminated block comment/);
});

test("lineColumn maps offsets to 1-based line/column pairs", () => {
  const text = "ab\ncd\nef";
  assert.deepEqual(lineColumn(text, 0), { line: 1, column: 1 });
  assert.deepEqual(lineColumn(text, 4), { line: 2, column: 2 });
  assert.deepEqual(lineColumn(text, 6), { line: 3, column: 1 });
});
