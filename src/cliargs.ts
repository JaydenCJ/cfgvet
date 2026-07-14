/**
 * Argument parsing for the cfgvet CLI. Hand-rolled and dependency-free:
 * three subcommands (check — the default —, list, explain), long flags
 * with values, and typed errors so the CLI can exit 2 on usage problems
 * without ever throwing raw stack traces at the user.
 */

import type { Harness } from "./types.js";
import { ALL_HARNESSES } from "./types.js";
import type { FailOn } from "./report.js";

export type Command =
  | { kind: "help" }
  | { kind: "version" }
  | { kind: "check"; root: string; failOn: FailOn; format: "text" | "json"; quiet: boolean; harnesses: Harness[] }
  | { kind: "list"; root: string; harnesses: Harness[] }
  | { kind: "explain"; topic: string };

export class UsageError extends Error {}

const FAIL_LEVELS: FailOn[] = ["error", "warning", "info", "never"];

export function parseArgs(argv: readonly string[]): Command {
  const args = [...argv];
  if (args.includes("--help") || args.includes("-h")) return { kind: "help" };
  if (args.includes("--version") || args.includes("-V")) return { kind: "version" };

  let sub = "check";
  if (args.length > 0 && !String(args[0]).startsWith("-")) {
    const head = String(args[0]);
    if (head === "check" || head === "list" || head === "explain") {
      sub = head;
      args.shift();
    }
  }

  if (sub === "explain") {
    const topic = args.shift();
    if (topic === undefined || topic.startsWith("-")) {
      throw new UsageError("explain needs a topic: a rule code (e.g. E102), `codes`, or `exit-codes`");
    }
    if (args.length > 0) throw new UsageError(`unexpected argument \`${args[0]}\``);
    return { kind: "explain", topic };
  }

  let root: string | null = null;
  let failOn: FailOn = "warning";
  let format: "text" | "json" = "text";
  let quiet = false;
  let harnesses: Harness[] = [...ALL_HARNESSES];
  /** Check-only flags seen, so `list` can reject them instead of silently ignoring them. */
  const checkOnly: string[] = [];

  while (args.length > 0) {
    const arg = String(args.shift());
    if (arg === "--fail-on") {
      checkOnly.push(arg);
      const v = takeValue(args, arg);
      if (!FAIL_LEVELS.includes(v as FailOn)) {
        throw new UsageError(`--fail-on must be one of ${FAIL_LEVELS.join(", ")}, got \`${v}\``);
      }
      failOn = v as FailOn;
    } else if (arg === "--format") {
      checkOnly.push(arg);
      const v = takeValue(args, arg);
      if (v !== "text" && v !== "json") throw new UsageError(`--format must be text or json, got \`${v}\``);
      format = v;
    } else if (arg === "--harness") {
      const v = takeValue(args, arg);
      harnesses = v.split(",").map((part) => {
        const h = part.trim();
        if (!(ALL_HARNESSES as readonly string[]).includes(h)) {
          throw new UsageError(`--harness must name ${ALL_HARNESSES.join(", ")}; got \`${h}\``);
        }
        return h as Harness;
      });
      if (harnesses.length === 0) throw new UsageError("--harness needs at least one harness");
    } else if (arg === "--quiet" || arg === "-q") {
      checkOnly.push(arg);
      quiet = true;
    } else if (arg.startsWith("-")) {
      throw new UsageError(`unknown flag \`${arg}\``);
    } else if (root === null) {
      root = arg;
    } else {
      throw new UsageError(`unexpected argument \`${arg}\` (root already given: ${root})`);
    }
  }

  const resolvedRoot = root ?? ".";
  if (sub === "list") {
    if (checkOnly.length > 0) {
      throw new UsageError(`${checkOnly[0]} only applies to check`);
    }
    return { kind: "list", root: resolvedRoot, harnesses };
  }
  return { kind: "check", root: resolvedRoot, failOn, format, quiet, harnesses };
}

function takeValue(args: string[], flag: string): string {
  const v = args.shift();
  if (v === undefined) throw new UsageError(`${flag} needs a value`);
  return String(v);
}

export const HELP = `cfgvet — doctor for .claude, .cursor and Copilot config directories

Usage:
  cfgvet [check] [dir] [flags]   scan a project (default command, default dir: .)
  cfgvet list [dir]              inventory of the config files cfgvet found
  cfgvet explain <topic>         document a rule code, \`codes\`, or \`exit-codes\`

Flags (check):
  --fail-on <level>   exit 1 at or above error | warning | info; never always exits 0
                      (default: warning)
  --format <fmt>      text | json   (default: text)
  --harness <list>    comma-separated subset of: claude, cursor, copilot
                      (also valid with list)
  -q, --quiet         summary lines only

Exit codes:
  0  no findings at or above --fail-on
  1  findings at or above --fail-on
  2  usage or input error
`;
