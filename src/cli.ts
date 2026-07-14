#!/usr/bin/env node
/**
 * The cfgvet command-line interface. Thin by design: parse arguments,
 * call the pure engine, render, pick an exit code. Everything with logic
 * in it lives in unit-tested modules.
 */

import * as fs from "node:fs";
import { scan } from "./analyze.js";
import { HELP, parseArgs, UsageError } from "./cliargs.js";
import { renderJson, renderList, renderText } from "./report.js";
import { shouldFail } from "./report.js";
import { RULES, ruleByCode } from "./rules.js";
import { nearest } from "./nearest.js";
import { VERSION } from "./version.js";

function main(argv: string[]): number {
  let command;
  try {
    command = parseArgs(argv);
  } catch (e) {
    if (e instanceof UsageError) {
      process.stderr.write(`cfgvet: ${e.message}\n`);
      process.stderr.write("run `cfgvet --help` for usage\n");
      return 2;
    }
    throw e;
  }

  switch (command.kind) {
    case "help":
      process.stdout.write(HELP);
      return 0;
    case "version":
      process.stdout.write(VERSION + "\n");
      return 0;
    case "explain":
      return explain(command.topic);
    case "list": {
      const err = rootProblem(command.root);
      if (err) return usage(err);
      process.stdout.write(renderList(scan(command.root, { harnesses: command.harnesses })));
      return 0;
    }
    case "check": {
      const err = rootProblem(command.root);
      if (err) return usage(err);
      const result = scan(command.root, { harnesses: command.harnesses });
      const rendered =
        command.format === "json"
          ? renderJson(result, { failOn: command.failOn, quiet: command.quiet })
          : renderText(result, { failOn: command.failOn, quiet: command.quiet });
      process.stdout.write(rendered);
      return shouldFail(result.findings, command.failOn) ? 1 : 0;
    }
  }
}

function usage(message: string): number {
  process.stderr.write(`cfgvet: ${message}\n`);
  return 2;
}

function rootProblem(root: string): string | null {
  const st = fs.statSync(root, { throwIfNoEntry: false });
  if (st === undefined) return `no such directory: ${root}`;
  if (!st.isDirectory()) return `not a directory: ${root}`;
  return null;
}

function explain(topic: string): number {
  if (topic === "codes") {
    for (const rule of RULES) {
      process.stdout.write(`${rule.code}  ${rule.severity.padEnd(7)}  ${rule.title}\n`);
    }
    return 0;
  }
  if (topic === "exit-codes") {
    process.stdout.write(
      "0  no findings at or above --fail-on (default: warning)\n" +
        "1  findings at or above --fail-on\n" +
        "2  usage or input error — a broken invocation, not a broken config\n"
    );
    return 0;
  }
  const rule = ruleByCode(topic);
  if (rule !== undefined) {
    process.stdout.write(`${rule.code} (${rule.severity}) — ${rule.title}\n\n${rule.detail}\n`);
    return 0;
  }
  const suggestion = nearest(
    topic,
    RULES.map((r) => r.code)
  );
  process.stderr.write(
    `cfgvet: unknown topic \`${topic}\`${suggestion ? ` — did you mean ${suggestion}?` : ""} (try \`cfgvet explain codes\`)\n`
  );
  return 2;
}

process.exit(main(process.argv.slice(2)));
