#!/usr/bin/env node
/**
 * agentcheck CLI.
 *
 * Commands:
 *   agentcheck run     [--dir <d>] [--config <f>] [--md <out>]   compare runs vs snapshots
 *   agentcheck update  [--dir <d>] [--config <f>]                 write/refresh snapshots
 *
 * The agent under test is supplied by an "agent module": a JS/TS file exporting
 * a default function `(scenarioDef) => AgentRun`. It is resolved from the
 * `agent` key in agentcheck.yaml, or via `--agent <path>`. This keeps the CLI
 * framework-agnostic and fully offline (the bundled example uses a local fake).
 */
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { isAbsolute, resolve } from "node:path";
import { loadConfig } from "../src/scenarios.js";
import { runScenarios, type AgentRunner } from "../src/runner.js";
import { renderReportText, renderReportMarkdown } from "../src/report.js";
import type { AgentcheckConfig } from "../src/types.js";

interface CliArgs {
  command: string;
  dir: string;
  config?: string;
  agent?: string;
  md?: string;
}

function parseArgs(argv: string[]): CliArgs {
  const args: CliArgs = { command: argv[0] ?? "help", dir: "." };
  for (let i = 1; i < argv.length; i++) {
    const a = argv[i];
    const next = (): string => {
      const v = argv[++i];
      if (v === undefined) throw new Error(`Missing value for ${a}`);
      return v;
    };
    switch (a) {
      case "--dir":
      case "-d":
        args.dir = next();
        break;
      case "--config":
      case "-c":
        args.config = next();
        break;
      case "--agent":
      case "-a":
        args.agent = next();
        break;
      case "--md":
        args.md = next();
        break;
      default:
        throw new Error(`Unknown argument: ${a}`);
    }
  }
  return args;
}

function helpText(): string {
  return [
    "agentcheck - regression testing for AI agents",
    "",
    "Usage:",
    "  agentcheck run    [--dir <dir>] [--config <file>] [--agent <file>] [--md <out>]",
    "  agentcheck update [--dir <dir>] [--config <file>] [--agent <file>]",
    "",
    "Options:",
    "  -d, --dir     Directory containing agentcheck.yaml (default: .)",
    "  -c, --config  Explicit path to agentcheck.yaml",
    "  -a, --agent   Path to the agent module (default: 'agent' key in config)",
    "      --md      Write a PR-style markdown summary to this file",
    "",
    "The agent module must export a default function (scenarioDef) => AgentRun.",
  ].join("\n");
}

async function resolveAgent(
  cliAgent: string | undefined,
  config: AgentcheckConfig,
  baseDir: string,
): Promise<AgentRunner> {
  const raw = cliAgent ?? config.agent;
  if (!raw) {
    throw new Error(
      "No agent module specified. Set 'agent: <path>' in agentcheck.yaml or pass --agent.",
    );
  }
  const abs = isAbsolute(raw) ? raw : resolve(baseDir, raw);
  const mod = (await import(pathToFileURL(abs).href)) as {
    default?: unknown;
    agent?: unknown;
  };
  const fn = mod.default ?? mod.agent;
  if (typeof fn !== "function") {
    throw new Error(`Agent module ${abs} must export a default function.`);
  }
  return fn as AgentRunner;
}

async function main(): Promise<number> {
  const args = parseArgs(process.argv.slice(2));

  if (args.command === "help" || args.command === "--help" || args.command === "-h") {
    process.stdout.write(helpText() + "\n");
    return 0;
  }

  if (args.command !== "run" && args.command !== "update") {
    process.stderr.write(`Unknown command: ${args.command}\n\n${helpText()}\n`);
    return 2;
  }

  const loaded = loadConfig(args.config ?? args.dir);
  const agent = await resolveAgent(args.agent, loaded.config, loaded.baseDir);

  const report = await runScenarios({
    config: loaded.config,
    snapshotDir: loaded.snapshotDir,
    agent,
    update: args.command === "update",
  });

  if (args.command === "update") {
    process.stdout.write(
      `agentcheck: wrote ${report.results.length} snapshot(s) to ${loaded.snapshotDir}\n`,
    );
    return 0;
  }

  process.stdout.write(renderReportText(report) + "\n");

  if (args.md) {
    writeFileSync(args.md, renderReportMarkdown(report) + "\n", "utf8");
    process.stdout.write(`\nWrote markdown summary to ${args.md}\n`);
  }

  // New scenarios (no snapshot) are treated as failures so CI prompts an update.
  return report.ok ? 0 : 1;
}

main()
  .then((code) => {
    process.exitCode = code;
  })
  .catch((err: unknown) => {
    const msg = err instanceof Error ? err.message : String(err);
    process.stderr.write(`agentcheck error: ${msg}\n`);
    process.exitCode = 2;
  });
