// The shared MCP checks across .mcp.json, .cursor/mcp.json and
// .vscode/mcp.json: entry validation (E106), command paths, the JSONC
// exception for VS Code, the wrong-key trap, drift (W202) and parity
// (I301) — the cross-harness view that motivates cfgvet.
import test from "node:test";
import assert from "node:assert/strict";
import { scan } from "../dist/index.js";
import { withProject, codes, ofCode } from "./helpers.mjs";

const json = (o) => JSON.stringify(o, null, 2);

function scanFiles(files) {
  return withProject(files, (dir) => scan(dir));
}

test("valid stdio and remote servers are clean", () => {
  const r = scanFiles({
    ".mcp.json": json({
      mcpServers: {
        db: { command: "npx", args: ["-y", "db-mcp"], env: { DSN: "${env:DSN}" } },
        docs: { type: "http", url: "https://example.test/mcp" },
      },
    }),
  });
  assert.deepEqual(r.findings, []);
});

test("a stdio server without a command and a url without a remote type get targeted E106s", () => {
  const noCommand = scanFiles({ ".mcp.json": json({ mcpServers: { db: { args: ["-y", "x"] } } }) });
  assert.deepEqual(codes(noCommand.findings), ["E106"]);
  assert.match(noCommand.findings[0].message, /needs a string "command"/);

  const noType = scanFiles({ ".mcp.json": json({ mcpServers: { docs: { url: "https://example.test/mcp" } } }) });
  assert.deepEqual(codes(noType.findings), ["E106"]);
  assert.match(noType.findings[0].message, /no remote "type"/);
});

test("bad args, bad env and unknown type are each E106", () => {
  const r = scanFiles({
    ".mcp.json": json({
      mcpServers: {
        a: { command: "npx", args: "-y x" },
        b: { command: "npx", env: { PORT: 8080 } },
        c: { type: "websocket", url: "wss://example.test" },
      },
    }),
  });
  assert.deepEqual(codes(r.findings), ["E106", "E106", "E106"]);
});

test("a project-relative server script that is missing is E102", () => {
  const r = scanFiles({ ".cursor/mcp.json": json({ mcpServers: { local: { command: "./tools/server.js" } } }) });
  assert.deepEqual(codes(r.findings), ["E102"]);
  assert.equal(r.findings[0].file, ".cursor/mcp.json");
});

test("only .vscode/mcp.json may use comments and trailing commas, and it keys servers differently", () => {
  const jsonc = '{\n  // team servers\n  "servers": { "db": { "command": "npx", "args": ["-y", "db-mcp"], } },\n}';
  const okForVsCode = scanFiles({ ".vscode/mcp.json": jsonc });
  assert.deepEqual(okForVsCode.findings, []);
  const badForClaude = scanFiles({ ".mcp.json": jsonc.replace('"servers"', '"mcpServers"') });
  assert.deepEqual(codes(badForClaude.findings), ["E101"]);

  const wrongKeyClaude = scanFiles({ ".mcp.json": json({ servers: { db: { command: "npx" } } }) });
  assert.deepEqual(codes(wrongKeyClaude.findings), ["E106"]);
  assert.match(wrongKeyClaude.findings[0].message, /keys servers under "mcpServers"/);
  const wrongKeyVsCode = scanFiles({ ".vscode/mcp.json": json({ mcpServers: { db: { command: "npx" } } }) });
  assert.deepEqual(codes(wrongKeyVsCode.findings), ["E106"]);
});

test("same name with different args across harnesses is W202 on both files; identical is silent", () => {
  const drifted = scanFiles({
    ".mcp.json": json({ mcpServers: { db: { command: "npx", args: ["-y", "db-mcp"] } } }),
    ".cursor/mcp.json": json({ mcpServers: { db: { command: "npx", args: ["-y", "db-mcp@2"] } } }),
  });
  assert.deepEqual(codes(drifted.findings), ["W202", "W202"]);
  assert.match(drifted.findings[0].message, /differs across harnesses/);

  const same = json({ mcpServers: { db: { command: "npx", args: ["-y", "db-mcp"] } } });
  const aligned = scanFiles({ ".mcp.json": same, ".cursor/mcp.json": same });
  assert.deepEqual(aligned.findings, []);
});

test("a server present on one side only is I301 naming the missing file; one file alone never is", () => {
  const r = scanFiles({
    ".mcp.json": json({ mcpServers: { db: { command: "npx" }, docs: { type: "sse", url: "https://example.test/sse" } } }),
    ".cursor/mcp.json": json({ mcpServers: { db: { command: "npx" } } }),
  });
  assert.deepEqual(codes(r.findings), ["I301"]);
  assert.match(r.findings[0].message, /missing from \.cursor\/mcp\.json/);

  const solo = scanFiles({ ".mcp.json": json({ mcpServers: { db: { command: "npx" } } }) });
  assert.deepEqual(ofCode(solo.findings, "I301"), []);
});

test("broken servers are excluded from drift comparison instead of poisoning it", () => {
  const r = scanFiles({
    ".mcp.json": json({ mcpServers: { db: {} } }), // E106, identity unknown
    ".cursor/mcp.json": json({ mcpServers: { db: { command: "npx" } } }),
  });
  assert.deepEqual(ofCode(r.findings, "W202"), []);
  assert.deepEqual(codes(r.findings), ["E106"]);
});
